// Call Notification Manager
// Handles real-time call notifications using Supabase Realtime

import { generateRoomId } from './room-generator.js';

let supabase = null;
let currentUserId = null;
let callChannel = null;
let incomingCallHandler = null;
let callAnsweredHandler = null;
let callDeclinedHandler = null;

// Initialize Supabase client for Realtime
async function initSupabase() {
  if (supabase) return;
  
  const configResponse = await fetch('/api/config');
  const config = await configResponse.json();
  
  const { createClient } = window.supabase;
  supabase = createClient(config.supabaseUrl, config.supabaseKey);
  
  // Get current user from our backend session
  const userResponse = await fetch('/api/auth/user', { credentials: 'include' });
  if (userResponse.ok) {
    const { user } = await userResponse.json();
    currentUserId = user?.id;
  }
}

// Subscribe to call notifications for current user
export async function subscribeToCallNotifications(handlers = {}) {
  await initSupabase();
  
  if (!currentUserId) {
    console.error('No authenticated user');
    return;
  }
  
  // Store handlers
  incomingCallHandler = handlers.onIncomingCall;
  callAnsweredHandler = handlers.onCallAnswered;
  callDeclinedHandler = handlers.onCallDeclined;
  
  // Create user-specific channel
  const channelName = `call:${currentUserId}`;
  
  callChannel = supabase.channel(channelName)
    .on('broadcast', { event: 'incoming_call' }, (payload) => {
      console.log('Incoming call received:', payload);
      if (payload && payload.payload && incomingCallHandler) {
        incomingCallHandler(payload.payload);
      } else {
        console.error('Invalid call payload:', payload);
      }
    })
    .on('broadcast', { event: 'call_answered' }, (payload) => {
      console.log('Call answered:', payload);
      if (payload && payload.payload && callAnsweredHandler) {
        callAnsweredHandler(payload.payload);
      }
    })
    .on('broadcast', { event: 'call_declined' }, (payload) => {
      console.log('Call declined:', payload);
      if (payload && payload.payload && callDeclinedHandler) {
        callDeclinedHandler(payload.payload);
      }
    })
    .subscribe((status) => {
      console.log(`Channel subscription status: ${status}`);
    });
  
  console.log(`Subscribed to call notifications on channel: ${channelName}`);
}

// Send call notification to a friend
export async function sendCallNotification(friendId, callerProfile, roomId) {
  await initSupabase();
  
  const channelName = `call:${friendId}`;
  const channel = supabase.channel(channelName);
  
  await channel.subscribe();
  
  const payload = {
    callerId: currentUserId,
    callerName: callerProfile.username,
    callerPhoto: callerProfile.profile_picture_url,
    roomId: roomId,
    timestamp: Date.now()
  };
  
  await channel.send({
    type: 'broadcast',
    event: 'incoming_call',
    payload: payload
  });
  
  console.log('Call notification sent to:', friendId);
  
  // Unsubscribe after sending
  setTimeout(() => channel.unsubscribe(), 1000);
  
  return payload;
}

// Send call answered notification
export async function sendCallAnswered(callerId, roomId) {
  await initSupabase();
  
  const channelName = `call:${callerId}`;
  const channel = supabase.channel(channelName);
  
  await channel.subscribe();
  
  await channel.send({
    type: 'broadcast',
    event: 'call_answered',
    payload: { roomId, answeredBy: currentUserId }
  });
  
  console.log('Call answered notification sent');
  
  setTimeout(() => channel.unsubscribe(), 1000);
}

// Send call declined notification
export async function sendCallDeclined(callerId, roomId) {
  await initSupabase();
  
  const channelName = `call:${callerId}`;
  const channel = supabase.channel(channelName);
  
  await channel.subscribe();
  
  await channel.send({
    type: 'broadcast',
    event: 'call_declined',
    payload: { roomId, declinedBy: currentUserId }
  });
  
  console.log('Call declined notification sent');
  
  setTimeout(() => channel.unsubscribe(), 1000);
}

// Initiate a call to a friend
export async function initiateCall(friend) {
  const roomId = generateRoomId();
  
  // Get current user's profile for the notification
  const profileResponse = await fetch('/api/profile', { credentials: 'include' });
  const { profile } = await profileResponse.json();
  
  if (friend.online_status) {
    // Friend is online - send real-time notification
    await sendCallNotification(friend.id, profile, roomId);
  }
  
  return {
    roomId,
    isOnline: friend.online_status,
    shareableUrl: `${window.location.origin}/?room=${roomId}`
  };
}

// Unsubscribe from call notifications
export function unsubscribeFromCallNotifications() {
  if (callChannel) {
    callChannel.unsubscribe();
    callChannel = null;
  }
}

// Generate shareable call link
export function generateCallLink() {
  const roomId = generateRoomId();
  return {
    roomId,
    url: `${window.location.origin}/?room=${roomId}`
  };
}
