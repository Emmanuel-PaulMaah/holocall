// Connection Manager - LiveKit connection logic

import { Room, RoomEvent, createLocalTracks, setLogLevel } from 'https://cdn.jsdelivr.net/npm/livekit-client/+esm';
import { state, showToast, setUIState, recalcHoloVisibility } from './ui-controller.js';

const $ = (id) => document.getElementById(id);

/* ---------------- server helpers ---------------- */
async function fetchConfig() { 
  const r = await fetch('/api/config', {cache: 'no-store'}); 
  const j = await r.json(); 
  state.livekitUrl = j.livekitUrl; 
  if (!state.livekitUrl) throw new Error('LIVEKIT_URL missing'); 
}

async function getToken(room) { 
  const r = await fetch(`/api/token?room=${encodeURIComponent(room)}`, {cache: 'no-store', credentials: 'include'}); 
  if (!r.ok) throw new Error('token fetch failed'); 
  return r.text(); 
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

  await fetchConfig(); 
  const token = await getToken(room);
  setLogLevel('warn'); 
  state.room = new Room({ adaptiveStream: true, dynacast: true });

  state.room.on(RoomEvent.Reconnecting, () => showToast('reconnecting…'));
  state.room.on(RoomEvent.Connected, () => { if (state.joined) showToast('reconnected'); });

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

  const local = await createLocalTracks({ 
    audio: true, 
    video: { facingMode: 'user', width: 960, frameRate: 24 } 
  });
  state.localTracks = local; 
  previewLocal(local);

  await state.room.connect(state.livekitUrl, await token);
  for (const t of local) await state.room.localParticipant.publishTrack(t);

  setUIState({ joined: true }); 
  showToast(`joined: ${room}`); 
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
