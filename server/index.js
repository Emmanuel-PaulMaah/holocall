import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { AccessToken } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET environment variable is not set!');
  console.error('The application cannot start without a secure JWT secret.');
  console.error('Please set JWT_SECRET in your environment variables.');
  process.exit(1);
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase credentials not configured');
  }
  
  return createClient(url, key);
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
      } catch (refreshErr) {
        return res.status(401).json({ error: 'unauthorized', message: 'Session refresh failed' });
      }
    }
    
    if (!user) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid session' });
    }
    
    req.user = user;
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
app.use(express.static(path.join(__dirname, '..', 'public')));

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
    supabaseKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

// token minting endpoint (protected)
app.get('/api/token', requireAuth, async (req, res) => {
  try {
    const room = (req.query.room || 'default').toString();
    const userName = req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'User';

    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: `${userName} (${req.user.id.substring(0, 8)})`,
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

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ server running on http://0.0.0.0:${port}`);
});
