// Main App Orchestrator - Coordinates all modules

import { checkAuth, state, icon, setUIState, recalcHoloVisibility, setupConfirmDialog } from './ui-controller.js';
import { join, leave, toggleMic, toggleCam } from './connection-manager.js';
import { setupARControls } from './ar-controller.js';

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
