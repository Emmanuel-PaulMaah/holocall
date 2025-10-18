// Connection Manager - LiveKit connection logic

import { Room, RoomEvent, createLocalTracks, setLogLevel } from 'https://cdn.jsdelivr.net/npm/livekit-client/+esm';
import { state, showToast, setUIState, recalcHoloVisibility, getVideoConstraints } from './ui-controller.js';

const $ = (id) => document.getElementById(id);

/* ---------------- server helpers ---------------- */
async function fetchConfig() { 
  try {
    const r = await fetch('/api/config', {cache: 'no-store'}); 
    if (!r.ok) {
      throw new Error('Server temporarily unavailable. Please try again.');
    }
    const j = await r.json(); 
    state.livekitUrl = j.livekitUrl; 
    if (!state.livekitUrl) {
      throw new Error('Video service not configured. Please contact support.');
    }
  } catch (err) {
    if (err.name === 'TypeError' || err.message.includes('fetch')) {
      throw new Error('Cannot reach server. Check your internet connection.');
    }
    throw err;
  }
}

async function getToken(room) { 
  try {
    const r = await fetch(`/api/token?room=${encodeURIComponent(room)}`, {cache: 'no-store', credentials: 'include'}); 
    
    if (r.status === 401) {
      throw new Error('Your session expired. Please refresh the page and login again.');
    }
    if (r.status === 403) {
      throw new Error('You don\'t have permission to join this room. Contact the room owner for access.');
    }
    if (r.status === 404) {
      throw new Error('Room service unavailable. Please try again later.');
    }
    if (!r.ok) {
      throw new Error('Server error. Please try again in a moment.');
    }
    
    return r.text();
  } catch (err) {
    if (err.name === 'TypeError' || err.message.includes('fetch')) {
      throw new Error('Cannot reach server. Check your internet connection.');
    }
    throw err;
  }
}

/* ---------------- media helpers ---------------- */
function ensureAttrs(v) { 
  v.muted = true; 
  v.autoplay = true; 
  v.playsInline = true;
  v.setAttribute('muted', ''); 
  v.setAttribute('autoplay', ''); 
  v.setAttribute('playsinline', ''); 
}

/** On some Android builds, fully hidden videos won't decode. Make it tiny-but-visible. */
export function makeVideoTinyVisible(v) {
  if (!v) return;
  v.removeAttribute('hidden');
  v.style.position = 'fixed';
  v.style.left = '0';
  v.style.top = '0';
  v.style.width = '2px';
  v.style.height = '2px';
  v.style.opacity = '0.001';
  v.style.pointerEvents = 'none';
  v.style.zIndex = '0';
  ensureAttrs(v);
  v.muted = true;
}

function previewLocal(tracks) {
  const v = $('localVideo'); 
  ensureAttrs(v); 
  try { v.srcObject = null; } catch {}
  
  const vt = tracks.find(t => t.kind === 'video');
  if (vt && typeof vt.attach === 'function') { 
    vt.attach(v); 
  } else { 
    const s = new MediaStream(tracks.map(t => t.mediaStreamTrack)); 
    v.srcObject = s; 
    v.play().catch(() => {}); 
  }
  v.classList.remove('muted');
}

function attachRemoteTrack(track, pub) {
  if (pub.kind === 'video') {
    // visible remote video
    const rv = $('remoteVideo');
    ensureAttrs(rv);
    try { rv.srcObject = null; } catch {}
    track.attach(rv);

    // hidden-but-visible AR source
    const hv = $('remoteHoloVideo');
    makeVideoTinyVisible(hv);
    try { hv.srcObject = null; } catch {}
    track.attach(hv);

    // force playback (autoplay on mobile)
    const tryPlay = () => hv.play().catch(() => {});
    if (hv.readyState >= 2) tryPlay();
    else hv.addEventListener('loadeddata', tryPlay, { once: true });

  } else if (pub.kind === 'audio') {
    if (!state.remoteAudioEl) {
      const a = document.createElement('audio'); 
      a.autoplay = true; 
      a.style.display = 'none';
      document.body.appendChild(a); 
      state.remoteAudioEl = a;
    }
    track.attach(state.remoteAudioEl);
    state.remoteAudioEl.muted = false;
    state.remoteAudioEl.play().catch(() => {});
  }
}

/* ---------------- join / leave ---------------- */
export async function join() {
  const room = $('room').value.trim();
  if (!room) { 
    showToast('enter a room name'); 
    $('room')?.focus(); 
    return; 
  }

  try {
    // Fetch config and token
    await fetchConfig(); 
    const token = await getToken(room);
    
    setLogLevel('warn'); 
    state.room = new Room({ adaptiveStream: true, dynacast: true });

    // Setup room event listeners with reconnection tracking
    let reconnectAttempt = 0;
    
    state.room.on(RoomEvent.Reconnecting, () => {
      reconnectAttempt++;
      if (reconnectAttempt === 1) {
        showToast('reconnecting…');
      } else {
        showToast(`reconnecting (attempt ${reconnectAttempt})…`);
      }
    });
    
    state.room.on(RoomEvent.Reconnected, () => { 
      reconnectAttempt = 0;
      showToast('reconnected ✓'); 
    });
    
    state.room.on(RoomEvent.Connected, () => { 
      if (state.joined && reconnectAttempt > 0) {
        reconnectAttempt = 0;
        showToast('reconnected ✓');
      }
    });
    
    state.room.on(RoomEvent.Disconnected, (reason) => {
      if (state.joined) {
        // Clean up first to re-enable Join button
        cleanup();
        
        // Then show message so button is available when user sees it
        const reasonText = reason === 'server_shutdown' 
          ? 'Server restarted. ' 
          : reason === 'network_timeout'
          ? 'Network connection lost. '
          : 'Disconnected. ';
        showToast(`${reasonText}Click Join to reconnect.`);
      }
    });

    state.room.on(RoomEvent.ParticipantConnected, (p) => { 
      showToast(`${p.identity} joined`);  
      recalcHoloVisibility(); 
    });
    state.room.on(RoomEvent.ParticipantDisconnected, (p) => { 
      showToast(`${p.identity} left`);    
      recalcHoloVisibility(); 
    });

    state.room.on(RoomEvent.TrackSubscribed, (track, pub, p) => attachRemoteTrack(track, pub, p));
    state.room.on(RoomEvent.TrackUnsubscribed, () => { 
      const rv = $('remoteVideo'); 
      if (rv) rv.srcObject = null; 
      recalcHoloVisibility(); 
    });

    // Request media permissions with error handling
    let local;
    try {
      local = await createLocalTracks({ 
        audio: true, 
        video: getVideoConstraints()
      });
    } catch (err) {
      // Try audio-only fallback if camera fails
      if (err.name === 'NotAllowedError') {
        showToast('Camera permission denied - click the lock icon in your address bar to allow access');
        try {
          local = await createLocalTracks({ audio: true });
          showToast('Joined in audio-only mode ✓');
        } catch (audioErr) {
          throw new Error('Microphone access also denied. Click the lock icon in your browser\'s address bar, allow microphone access, then click Join again.');
        }
      } else if (err.name === 'NotFoundError') {
        throw new Error('No camera or microphone found. Please connect a device and try again.');
      } else if (err.name === 'NotReadableError') {
        throw new Error('Camera/microphone is already in use. Close other apps and try again.');
      } else if (err.name === 'OverconstrainedError') {
        throw new Error('Your camera doesn\'t support the required settings. Please try a different device.');
      } else {
        throw new Error('Could not access your camera or microphone. Please check your device settings and try again.');
      }
    }
    
    state.localTracks = local; 
    previewLocal(local);

    // Connect to room
    try {
      await state.room.connect(state.livekitUrl, token);
    } catch (err) {
      // Clean up tracks on connection failure
      for (const t of local) {
        try { t.stop(); } catch {}
      }
      
      if (err.message?.includes('token')) {
        throw new Error('Could not join room. Please check the room name and try again.');
      } else if (err.message?.includes('timeout')) {
        throw new Error('Connection timed out. Check your internet and try again.');
      } else if (err.message?.includes('websocket')) {
        throw new Error('Cannot connect to video server. Please try again.');
      } else {
        throw new Error('Connection failed. Please try again in a moment.');
      }
    }

    // Publish tracks
    try {
      for (const t of local) {
        await state.room.localParticipant.publishTrack(t);
      }
    } catch (err) {
      console.error('Failed to publish tracks:', err);
      // Continue anyway - connection is established
    }

    setUIState({ joined: true }); 
    showToast(`joined: ${room}`); 
    recalcHoloVisibility();
    
  } catch (err) {
    console.error('Join failed:', err);
    showToast(err.message || 'Failed to join room');
    
    // Cleanup on error
    cleanup();
  }
}

function cleanup() {
  // Immediately re-enable Join button so user can retry
  setUIState({ joined: false, micOn: true, camOn: true });
  
  if (state.room) {
    try { state.room.disconnect(); } catch {}
    state.room = null;
  }
  
  for (const t of state.localTracks) {
    try { t.stop(); } catch {}
  }
  state.localTracks = [];
  
  const lv = $('localVideo');
  if (lv) lv.srcObject = null;
  
  recalcHoloVisibility();
}

export async function leave() {
  try { 
    if (state.room) await state.room.disconnect(); 
    for (const t of state.localTracks) { 
      try { t.stop(); } catch {} 
    } 
  } finally {
    state.room = null; 
    state.localTracks = [];
    
    const lv = $('localVideo'), rv = $('remoteVideo'), hv = $('remoteHoloVideo');
    if (lv) lv.srcObject = null; 
    if (rv) rv.srcObject = null;
    if (hv) { 
      hv.pause(); 
      hv.srcObject = null; 
      hv.setAttribute('hidden', ''); 
      hv.removeAttribute('style'); 
    }
    if (state.remoteAudioEl) state.remoteAudioEl.srcObject = null;
    
    setUIState({ joined: false, micOn: true, camOn: true }); 
    recalcHoloVisibility(); 
    showToast('left the room');
  }
}

export function toggleMic() { 
  const next = !state.micOn; 
  for (const t of state.localTracks) {
    if (t.kind === 'audio') t.mediaStreamTrack.enabled = next; 
  }
  setUIState({ micOn: next }); 
}

export function toggleCam() { 
  const next = !state.camOn; 
  for (const t of state.localTracks) {
    if (t.kind === 'video') t.mediaStreamTrack.enabled = next; 
  }
  setUIState({ camOn: next }); 
}
