// Connection Manager - LiveKit connection logic

import { Room, RoomEvent, createLocalTracks, setLogLevel } from 'https://cdn.jsdelivr.net/npm/livekit-client/+esm';
import { state, showToast, setUIState, recalcHoloVisibility } from './ui-controller.js';

const $ = (id) => document.getElementById(id);

/* ---------------- server helpers ---------------- */
async function fetchConfig() { 
  try {
    const r = await fetch('/api/config', {cache: 'no-store'}); 
    if (!r.ok) {
      throw new Error(`Config fetch failed: ${r.status}`);
    }
    const j = await r.json(); 
    state.livekitUrl = j.livekitUrl; 
    if (!state.livekitUrl) throw new Error('LIVEKIT_URL not configured'); 
  } catch (err) {
    if (err.name === 'TypeError' || err.message.includes('fetch')) {
      throw new Error('Network error - check your connection');
    }
    throw err;
  }
}

async function getToken(room) { 
  try {
    const r = await fetch(`/api/token?room=${encodeURIComponent(room)}`, {cache: 'no-store', credentials: 'include'}); 
    
    if (r.status === 401) {
      throw new Error('Session expired - please login again');
    }
    if (r.status === 403) {
      throw new Error('Access denied - check your permissions');
    }
    if (!r.ok) {
      throw new Error(`Server error (${r.status})`);
    }
    
    return r.text();
  } catch (err) {
    if (err.name === 'TypeError' || err.message.includes('fetch')) {
      throw new Error('Network error - check your connection');
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
        const reasonText = reason === 'server_shutdown' 
          ? 'Server restarted' 
          : reason === 'network_timeout'
          ? 'Network timeout'
          : 'Connection lost';
        showToast(`${reasonText} - please rejoin`);
        cleanup();
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
        video: { facingMode: 'user', width: 960, frameRate: 24 } 
      });
    } catch (err) {
      // Try audio-only fallback if camera fails
      if (err.name === 'NotAllowedError') {
        showToast('Camera/mic permission denied - trying audio only');
        try {
          local = await createLocalTracks({ audio: true });
        } catch (audioErr) {
          throw new Error('Microphone permission denied. Please allow access in your browser settings.');
        }
      } else if (err.name === 'NotFoundError') {
        throw new Error('No camera or microphone found. Please connect a device and try again.');
      } else if (err.name === 'NotReadableError') {
        throw new Error('Camera/microphone is already in use by another app');
      } else {
        throw new Error(`Media error: ${err.message || 'Could not access camera/microphone'}`);
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
        throw new Error('Invalid room token - please try again');
      } else if (err.message?.includes('timeout')) {
        throw new Error('Connection timeout - check your internet');
      } else {
        throw new Error(`Connection failed: ${err.message || 'Unknown error'}`);
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
  
  setUIState({ joined: false, micOn: true, camOn: true });
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
