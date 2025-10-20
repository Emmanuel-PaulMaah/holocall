// Main App Orchestrator - Coordinates all modules

import { checkAuth, state, icon, setUIState, recalcHoloVisibility, setupConfirmDialog, showToast } from './ui-controller.js';
import { join, leave, toggleMic, toggleCam } from './connection-manager.js';
import { setupARControls } from './ar-controller.js';
import { subscribeToCallNotifications, unsubscribeFromCallNotifications } from './call-notifications.js';
import { createIncomingCallModal, showIncomingCall } from './incoming-call-modal.js';

const $ = (id) => document.getElementById(id);

// Fetch and display pending friend requests count
async function updateRequestsBadge() {
  try {
    const response = await fetch('/api/friends/requests', {
      credentials: 'include'
    });
    if (!response.ok) return;
    
    const { requests } = await response.json();
    const badge = $('requestsBadge');
    
    if (!badge) return;
    
    if (requests && requests.length > 0) {
      badge.textContent = requests.length > 9 ? '9+' : requests.length;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch (err) {
    console.error('Failed to fetch friend requests count:', err);
  }
}

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
      $('roomInput').value = data.roomId;
      await join();
      showToast(`Connected with ${data.callerName}`);
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
  const path = window.location.pathname;
  const match = path.match(/^\/call\/([a-z]+-[a-z]+-[a-z]+)$/i);
  
  if (match && match[1]) {
    const roomId = match[1];
    $('roomInput').value = roomId;
    showToast(`Auto-joining room: ${roomId}`);
    
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
  
  // Update friend requests badge
  updateRequestsBadge();
  
  // Refresh badge every 30 seconds
  setInterval(updateRequestsBadge, 30000);
  
  // Create incoming call modal
  createIncomingCallModal();
  
  // Subscribe to call notifications
  subscribeToCallNotifications({
    onIncomingCall: handleIncomingCall,
    onCallAnswered: handleCallAnswered,
    onCallDeclined: handleCallDeclined
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
});

window.addEventListener('beforeunload', () => { 
  if (state.joined) { 
    try { leave(); } catch {} 
  } 
});

window.addEventListener('pageshow', () => { 
  setUIState({ joined: false, micOn: true, camOn: true }); 
  recalcHoloVisibility(); 
});
