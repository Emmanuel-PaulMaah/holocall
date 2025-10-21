import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { AccessToken } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const app = express();

const allowedOrigins = new Set();
const isProduction = process.env.NODE_ENV === 'production';

// Helper to safely add origin to allowlist
function addOrigin(hostname) {
  if (!hostname) return;
  
  try {
    // Parse and normalize the hostname
    const normalized = hostname.trim().toLowerCase();
    
    // Validate it's a valid hostname (no protocols, paths, etc.)
    if (normalized.includes('://') || normalized.includes('/') || normalized.includes('@')) {
      console.warn(`Rejected invalid hostname format: ${hostname}`);
      return;
    }
    
    // Add with https protocol
    allowedOrigins.add(`https://${normalized}`);
  } catch (e) {
    console.warn(`Failed to add origin ${hostname}:`, e.message);
  }
}

// Development localhost origins
if (!isProduction) {
  allowedOrigins.add('http://localhost:5000');
  allowedOrigins.add('http://127.0.0.1:5000');
}

// Replit domains (explicitly configured only)
if (process.env.REPLIT_DOMAINS) {
  process.env.REPLIT_DOMAINS.split(',').forEach(domain => {
    const trimmed = domain.trim();
    if (trimmed.endsWith('.replit.dev') || trimmed.endsWith('.repl.co')) {
      addOrigin(trimmed);
    } else {
      console.warn(`Rejected non-Replit domain: ${trimmed}`);
    }
  });
}

if (process.env.REPLIT_DEV_DOMAIN) {
  const domain = process.env.REPLIT_DEV_DOMAIN.trim();
  if (domain.endsWith('.replit.dev') || domain.endsWith('.repl.co')) {
    addOrigin(domain);
  }
}

// Vercel auto-generated URL
if (process.env.VERCEL_URL) {
  addOrigin(process.env.VERCEL_URL);
}

// Vercel custom domain (e.g., holocall.vercel.app)
if (process.env.VERCEL_CUSTOM_DOMAIN) {
  const domain = process.env.VERCEL_CUSTOM_DOMAIN.trim();
  if (domain.endsWith('.vercel.app') && !domain.includes(' ')) {
    addOrigin(domain);
  } else {
    console.warn(`Rejected invalid Vercel custom domain: ${domain}`);
  }
}

console.log('Allowed CORS origins:', Array.from(allowedOrigins));

app.use(cors({ 
  credentials: true, 
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., mobile apps, curl)
    if (!origin) {
      callback(null, true);
      return;
    }
    
    // Check if origin is in allowlist
    if (allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    
    // Try normalized comparison (lowercase)
    const normalizedOrigin = origin.toLowerCase();
    if (allowedOrigins.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }
    
    console.error(`CORS blocked origin: ${origin}`);
    console.error(`Allowed origins:`, Array.from(allowedOrigins));
    callback(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET environment variable is not set!');
  console.error('The application cannot start without a secure JWT secret.');
  console.error('Please set JWT_SECRET in your environment variables.');
  process.exit(1);
}

// Configure web push
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:support@holocall.app',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  console.log('✅ Web Push configured');
} else {
  console.warn('⚠️ VAPID keys not configured - push notifications disabled');
}

// Track used decline tokens with expiry times to prevent replay attacks
const usedDeclineTokens = new Map(); // token -> expiryTime
// Clean up expired tokens every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of usedDeclineTokens.entries()) {
    if (expiry < now) {
      usedDeclineTokens.delete(token);
    }
  }
}, 30000);

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase credentials not configured');
  }
  
  return createClient(url, key);
}

// Get authenticated Supabase client for a specific user
function getAuthenticatedSupabaseClient(accessToken) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase credentials not configured');
  }
  
  const supabase = createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
  
  return supabase;
}

// auth middleware with token refresh
const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies.session_token;
    
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'No session token' });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const supabase = getSupabaseClient();
    
    let { data: { user }, error } = await supabase.auth.getUser(decoded.access_token);
    
    if (error) {
      try {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: decoded.refresh_token
        });
        
        if (refreshError || !refreshData.session) {
          return res.status(401).json({ error: 'unauthorized', message: 'Session expired' });
        }
        
        const newSessionToken = jwt.sign({
          access_token: refreshData.session.access_token,
          refresh_token: refreshData.session.refresh_token,
          user_id: refreshData.user.id
        }, JWT_SECRET, {
          expiresIn: '7d'
        });
        
        res.cookie('session_token', newSessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000
        });
        
        user = refreshData.user;
        decoded.access_token = refreshData.session.access_token;
      } catch (refreshErr) {
        return res.status(401).json({ error: 'unauthorized', message: 'Session refresh failed' });
      }
    }
    
    if (!user) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid session' });
    }
    
    req.user = user;
    req.accessToken = decoded.access_token;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid token' });
  }
};

// serve the static client from ../public
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In Vercel, serve from /var/task/public, otherwise from ../public
const publicPath = process.env.VERCEL 
  ? path.join(process.cwd(), 'public')
  : path.join(__dirname, '..', 'public');

app.use(express.static(publicPath));

// auth session endpoint
app.post('/api/auth/session', async (req, res) => {
  try {
    const { access_token, refresh_token, user } = req.body;
    
    if (!access_token || !refresh_token || !user) {
      return res.status(400).json({ error: 'missing_data', message: 'Missing required authentication data' });
    }
    
    const sessionToken = jwt.sign({ 
      access_token, 
      refresh_token,
      user_id: user.id 
    }, JWT_SECRET, {
      expiresIn: '7d'
    });
    
    res.cookie('session_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Session creation error:', err);
    res.status(500).json({ error: 'session_failed', message: err.message });
  }
});

// logout endpoint
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('session_token');
  res.json({ success: true });
});

// get current user endpoint
app.get('/api/auth/user', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// config endpoint (public but also returns Supabase config)
app.get('/api/config', (req, res) => {
  res.json({ 
    livekitUrl: process.env.LIVEKIT_URL || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_ANON_KEY || '',
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || ''
  });
});

// token minting endpoint (protected)
app.get('/api/token', requireAuth, async (req, res) => {
  try {
    const room = (req.query.room || 'default').toString();
    const userName = req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'User';

    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: req.user.id, // Use actual Supabase user ID as identity
      name: `${userName} (${req.user.id.substring(0, 8)})`, // Display name
    });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    res.type('text/plain').send(token);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_create_token' });
  }
});

// ============ PROFILE ENDPOINTS ============

// Get current user's profile
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      throw error;
    }
    
    res.json({ profile: data || null });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'failed_to_get_profile', message: err.message });
  }
});

// Get any user's profile by user ID (for avatars in AR mode)
app.get('/api/user/:userId/profile', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    
    const { data, error } = await supabase
      .from('profiles')
      .select('username, avatar_url, profile_picture_url')
      .eq('id', userId)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    res.json({ profile: data || null });
  } catch (err) {
    console.error('Get user profile error:', err);
    res.status(500).json({ error: 'failed_to_get_profile', message: err.message });
  }
});

// Create or update profile
app.post('/api/profile', requireAuth, async (req, res) => {
  try {
    const { username, bio, tags, profile_picture_url, avatar_url } = req.body;
    
    if (!username || username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'invalid_username', message: 'Username must be 3-30 characters' });
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'invalid_username', message: 'Username can only contain letters, numbers, and underscores' });
    }
    
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    
    const profileData = {
      id: req.user.id,
      username,
      bio: bio || '',
      tags: tags || [],
      profile_picture_url: profile_picture_url || null,
      avatar_url: avatar_url || null,
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' })
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return res.status(409).json({ error: 'username_taken', message: 'Username already taken' });
      }
      throw error;
    }
    
    res.json({ profile: data });
  } catch (err) {
    console.error('Save profile error:', err);
    res.status(500).json({ error: 'failed_to_save_profile', message: err.message });
  }
});

// Update online status
app.post('/api/profile/status', requireAuth, async (req, res) => {
  try {
    const { online } = req.body;
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    
    const { data, error} = await supabase
      .from('profiles')
      .update({
        online_status: online === true,
        last_seen: new Date().toISOString()
      })
      .eq('id', req.user.id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ status: data.online_status });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'failed_to_update_status', message: err.message });
  }
});

// ============ FRIEND ENDPOINTS ============

// Search users by username
app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ users: [] });
    }
    
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, bio, profile_picture_url')
      .ilike('username', `%${q}%`)
      .neq('id', req.user.id)
      .limit(20);
    
    if (error) throw error;
    
    res.json({ users: data || [] });
  } catch (err) {
    console.error('Search users error:', err);
    res.status(500).json({ error: 'failed_to_search', message: err.message });
  }
});

// Get user's friends list
app.get('/api/friends', requireAuth, async (req, res) => {
  try {
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    const { data, error } = await supabase
      .from('friendships')
      .select(`
        friend_id,
        profiles!friendships_friend_id_fkey (
          id,
          username,
          bio,
          tags,
          profile_picture_url,
          online_status,
          last_seen
        )
      `)
      .eq('user_id', req.user.id);
    
    if (error) throw error;
    
    const friends = data.map(f => f.profiles);
    
    // Sort: online friends first
    friends.sort((a, b) => {
      if (a.online_status && !b.online_status) return -1;
      if (!a.online_status && b.online_status) return 1;
      return 0;
    });
    
    res.json({ friends });
  } catch (err) {
    console.error('Get friends error:', err);
    res.status(500).json({ error: 'failed_to_get_friends', message: err.message });
  }
});

// Send friend request
app.post('/api/friends/request', requireAuth, async (req, res) => {
  try {
    const { to_user_id } = req.body;
    
    if (!to_user_id) {
      return res.status(400).json({ error: 'missing_user_id', message: 'User ID required' });
    }
    
    if (to_user_id === req.user.id) {
      return res.status(400).json({ error: 'invalid_request', message: 'Cannot send request to yourself' });
    }
    
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    
    // Check if already friends
    const { data: existing } = await supabase
      .from('friendships')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('friend_id', to_user_id)
      .single();
    
    if (existing) {
      return res.status(409).json({ error: 'already_friends', message: 'Already friends' });
    }
    
    // Check for existing request
    const { data: existingRequest } = await supabase
      .from('friend_requests')
      .select('id, status')
      .or(`and(from_user_id.eq.${req.user.id},to_user_id.eq.${to_user_id}),and(from_user_id.eq.${to_user_id},to_user_id.eq.${req.user.id})`)
      .single();
    
    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return res.status(409).json({ error: 'request_exists', message: 'Request already sent' });
      }
    }
    
    const { data, error } = await supabase
      .from('friend_requests')
      .insert({
        from_user_id: req.user.id,
        to_user_id,
        status: 'pending'
      })
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'request_exists', message: 'Request already sent' });
      }
      throw error;
    }
    
    res.json({ request: data });
  } catch (err) {
    console.error('Send friend request error:', err);
    res.status(500).json({ error: 'failed_to_send_request', message: err.message });
  }
});

// Get pending friend requests
app.get('/api/friends/requests', requireAuth, async (req, res) => {
  try {
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    const { data, error } = await supabase
      .from('friend_requests')
      .select(`
        id,
        from_user_id,
        created_at,
        profiles!friend_requests_from_user_id_fkey (
          username,
          bio,
          profile_picture_url
        )
      `)
      .eq('to_user_id', req.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ requests: data || [] });
  } catch (err) {
    console.error('Get requests error:', err);
    res.status(500).json({ error: 'failed_to_get_requests', message: err.message });
  }
});

// Accept friend request
app.post('/api/friends/accept', requireAuth, async (req, res) => {
  try {
    const { request_id } = req.body;
    
    if (!request_id) {
      return res.status(400).json({ error: 'missing_request_id', message: 'Request ID required' });
    }
    
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    
    const { data, error } = await supabase
      .from('friend_requests')
      .update({ status: 'accepted' })
      .eq('id', request_id)
      .eq('to_user_id', req.user.id)
      .select()
      .single();
    
    if (error) throw error;
    
    if (!data) {
      return res.status(404).json({ error: 'request_not_found', message: 'Request not found' });
    }
    
    res.json({ success: true, request: data });
  } catch (err) {
    console.error('Accept request error:', err);
    res.status(500).json({ error: 'failed_to_accept', message: err.message });
  }
});

// Reject friend request
app.post('/api/friends/reject', requireAuth, async (req, res) => {
  try {
    const { request_id } = req.body;
    
    if (!request_id) {
      return res.status(400).json({ error: 'missing_request_id', message: 'Request ID required' });
    }
    
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    
    const { error } = await supabase
      .from('friend_requests')
      .delete()
      .eq('id', request_id)
      .eq('to_user_id', req.user.id);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (err) {
    console.error('Reject request error:', err);
    res.status(500).json({ error: 'failed_to_reject', message: err.message });
  }
});

// ============ PUSH NOTIFICATION ENDPOINTS ============

// Subscribe to push notifications
app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const subscription = req.body;
    
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'invalid_subscription', message: 'Invalid push subscription' });
    }
    
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    
    // Store subscription in profiles table
    const { data, error } = await supabase
      .from('profiles')
      .update({
        push_subscription: subscription,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user.id)
      .select();
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (err) {
    console.error('Subscribe push error:', err);
    res.status(500).json({ error: 'failed_to_subscribe', message: err.message });
  }
});

// Decline call from service worker with secure token
app.post('/api/push/decline-call', async (req, res) => {
  try {
    const { callerId, roomId, token } = req.body;
    
    if (!callerId || !roomId || !token) {
      return res.status(400).json({ error: 'missing_data', message: 'Caller ID, room ID, and token required' });
    }
    
    // Check if token was already used
    if (usedDeclineTokens.has(token)) {
      return res.status(403).json({ error: 'token_used', message: 'Decline token already used' });
    }
    
    // Verify the token
    let tokenExpiry;
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Check token is for this specific call
      if (decoded.callerId !== callerId || decoded.roomId !== roomId) {
        return res.status(403).json({ error: 'invalid_token', message: 'Token mismatch' });
      }
      
      // Check token hasn't expired (1 minute max)
      const tokenAge = Date.now() - decoded.timestamp;
      if (tokenAge > 60000) {
        return res.status(403).json({ error: 'token_expired', message: 'Decline token expired' });
      }
      
      // Calculate when this token will expire
      tokenExpiry = decoded.timestamp + 60000;
    } catch (err) {
      return res.status(403).json({ error: 'invalid_token', message: 'Invalid decline token' });
    }
    
    // Mark token as used with its expiry time
    usedDeclineTokens.set(token, tokenExpiry);
    
    // Create temporary Supabase client
    const supabase = getSupabaseClient();
    
    // Send decline broadcast
    const channelName = `call:${callerId}`;
    const channel = supabase.channel(channelName);
    
    await channel.subscribe();
    
    await channel.send({
      type: 'broadcast',
      event: 'call_declined',
      payload: { roomId, declinedBy: 'service-worker' }
    });
    
    await channel.unsubscribe();
    
    res.json({ success: true });
  } catch (err) {
    console.error('Decline call from SW error:', err);
    res.status(500).json({ error: 'failed_to_decline', message: err.message });
  }
});

// Send push notification to a user
app.post('/api/push/send', requireAuth, async (req, res) => {
  try {
    const { user_id, title, body, data } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'missing_user_id', message: 'User ID required' });
    }
    
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(503).json({ error: 'push_disabled', message: 'Push notifications not configured' });
    }
    
    const supabase = getAuthenticatedSupabaseClient(req.accessToken);
    
    // Get target user's push subscription
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('push_subscription')
      .eq('id', user_id)
      .single();
    
    if (error || !profile || !profile.push_subscription) {
      return res.status(404).json({ error: 'no_subscription', message: 'User not subscribed to push' });
    }
    
    // Generate a one-time decline token (valid for 1 minute)
    const declineToken = jwt.sign({
      callerId: data.callerId,
      roomId: data.roomId,
      timestamp: Date.now()
    }, JWT_SECRET, {
      expiresIn: '1m'
    });
    
    const payload = JSON.stringify({
      title: title || 'HoloCall',
      body: body || 'New notification',
      icon: '/icon.png',
      badge: '/icon.png',
      tag: 'holocall-notification',
      ...data,
      declineToken // Add secure token for service worker decline
    });
    
    await webpush.sendNotification(profile.push_subscription, payload);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Send push error:', err);
    
    // Handle expired subscriptions
    if (err.statusCode === 410) {
      // Remove expired subscription
      try {
        const supabase = getAuthenticatedSupabaseClient(req.accessToken);
        await supabase
          .from('profiles')
          .update({ push_subscription: null })
          .eq('id', req.body.user_id);
      } catch (cleanupErr) {
        console.error('Failed to cleanup expired subscription:', cleanupErr);
      }
      
      return res.status(410).json({ error: 'subscription_expired', message: 'Push subscription expired' });
    }
    
    res.status(500).json({ error: 'failed_to_send_push', message: err.message });
  }
});

// Export the app for Vercel serverless functions
export default app;

// Only start the server if not running in Vercel
if (process.env.VERCEL !== '1') {
  const port = process.env.PORT || 5000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`✅ server running on http://0.0.0.0:${port}`);
  });
}
