// Main App Orchestrator - Coordinates all modules

import { checkAuth, state, icon, setUIState, recalcHoloVisibility, setupConfirmDialog } from './ui-controller.js';
import { join, leave, toggleMic, toggleCam } from './connection-manager.js';
import { setupARControls } from './ar-controller.js';

const $ = (id) => document.getElementById(id);

// Check authentication on load
checkAuth();

// Setup event listeners
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
