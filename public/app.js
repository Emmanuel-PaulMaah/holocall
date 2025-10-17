// Main App Orchestrator - Coordinates all modules

import { checkAuth, state, icon, setUIState, recalcHoloVisibility, setupConfirmDialog } from './ui-controller.js';
import { join, leave, toggleMic, toggleCam } from './connection-manager.js';
import { setupARControls } from './ar-controller.js';

const $ = (id) => document.getElementById(id);

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
