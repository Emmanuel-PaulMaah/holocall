// Main App Orchestrator - Coordinates all modules

import { checkAuth, state, icon, setUIState, recalcHoloVisibility, setupConfirmDialog, showToast } from './ui-controller.js';
import { join, leave, toggleMic, toggleCam } from './connection-manager.js';
import { setupARControls } from './ar-controller.js';
import { subscribeToCallNotifications, unsubscribeFromCallNotifications } from './call-notifications.js';
import { createIncomingCallModal, showIncomingCall } from './incoming-call-modal.js';
import { startPresenceTracking, stopPresenceTracking } from './presence-tracker.js';
import { initPushNotifications } from './push-notifications.js';

const $ = (id) => document.getElementById(id);


// Handle incoming call
function handleIncomingCall(callData) {
  console.log('handleIncomingCall called with:', callData);
  
  if (!callData || !callData.roomId || !callData.callerName) {
    console.error('Invalid call data received:', callData);
    return;
  }
  
  if (state.joined) {
    console.log('Already in a call, ignoring incoming call');
    return;
  }
  
  showIncomingCall(callData, {
    onAccept: async (data) => {
      console.log('Call accepted, joining room:', data.roomId);
      
      // If on index.html, join directly
      if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        $('roomInput').value = data.roomId;
        await join();
        showToast(`Connected with ${data.callerName}`);
      } else {
        // Navigate to index.html with room parameter
        window.location.href = `/?room=${data.roomId}`;
      }
    },
    onDecline: (data) => {
      console.log('Call declined');
      showToast('Call declined');
    }
  });
}

// Handle call answered by friend
function handleCallAnswered(data) {
  showToast('Call connected!');
}

// Handle call declined by friend
function handleCallDeclined(data) {
  showToast('Call was declined', true);
}

// Check URL for auto-join room
function checkAutoJoinFromURL() {
  // Check for ?room= query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  
  if (roomParam) {
    const roomId = roomParam.trim();
    $('roomInput').value = roomId;
    showToast(`Joining room: ${roomId}`);
    
    setTimeout(() => {
      if (!state.joined) {
        join();
      }
    }, 1000);
    
    window.history.replaceState({}, '', '/');
    return;
  }
  
  // Also check for legacy /call/room-id pattern
  const path = window.location.pathname;
  const match = path.match(/^\/call\/([a-z]+-[a-z]+-[a-z]+)$/i);
  
  if (match && match[1]) {
    const roomId = match[1];
    $('roomInput').value = roomId;
    showToast(`Joining room: ${roomId}`);
    
    setTimeout(() => {
      if (!state.joined) {
        join();
      }
    }, 1000);
    
    window.history.replaceState({}, '', '/');
  }
}

// Initialize app - check auth before setting up UI
async function init() {
  const isAuthenticated = await checkAuth();
  if (!isAuthenticated) return; // Auth check will redirect to login
  
  // Setup event listeners only if authenticated
  $('joinBtn').addEventListener('click', join);
  $('leaveBtn').addEventListener('click', leave);
  $('muteBtn').addEventListener('click', toggleMic);
  $('camBtn').addEventListener('click', toggleCam);
  
  // Icon button listeners
  icon.mute?.addEventListener('click', () => $('muteBtn')?.click());
  icon.cam?.addEventListener('click', () => $('camBtn')?.click());
  
  // Setup leave confirmation dialog
  setupConfirmDialog(() => $('leaveBtn')?.click());
  
  // Setup AR controls
  setupARControls();
  
  // Create incoming call modal
  createIncomingCallModal();
  
  // Subscribe to call notifications
  subscribeToCallNotifications({
    onIncomingCall: handleIncomingCall,
    onCallAnswered: handleCallAnswered,
    onCallDeclined: handleCallDeclined
  });
  
  // Start online presence tracking
  startPresenceTracking();
  
  // Initialize push notifications (request permission)
  initPushNotifications().then(success => {
    if (success) {
      console.log('Push notifications enabled');
    } else {
      console.log('Push notifications not available or denied');
    }
  });
  
  // Check for auto-join from URL
  checkAutoJoinFromURL();
}

// Start the app
init();

// Page lifecycle handlers
window.addEventListener('pagehide', () => { 
  if (state.joined) { 
    try { leave(); } catch {} 
  }
  stopPresenceTracking();
});

window.addEventListener('beforeunload', () => { 
  if (state.joined) { 
    try { leave(); } catch {} 
  }
  stopPresenceTracking();
});

window.addEventListener('pageshow', () => { 
  setUIState({ joined: false, micOn: true, camOn: true }); 
  recalcHoloVisibility(); 
});
