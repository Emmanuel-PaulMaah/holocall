import {
  Room, RoomEvent, createLocalTracks, setLogLevel, Track
} from 'https://cdn.jsdelivr.net/npm/livekit-client/+esm';

const $ = (id) => document.getElementById(id);
const setDisabled = (id, val) => { const el = $(id); if (el) el.disabled = val; };
const log = (m) => { console.log(m); const L=$('log'); if (L){ L.textContent += m + '\n'; L.scrollTop = L.scrollHeight; } };

const state = {
  room: null,
  localTracks: [],
  micOn: true,
  camOn: true,
  livekitUrl: null,
  remoteAudioEl: null,
  joined: false,
};

const icon = {
  mute:  $('muteIconBtn'),
  cam:   $('cameraIconBtn'),
  leave: $('leaveIconBtn'),
};

function showToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

function setUIState({ joined = state.joined, micOn = state.micOn, camOn = state.camOn } = {}) {
  state.joined = joined; state.micOn = micOn; state.camOn = camOn;
  setDisabled('joinBtn', joined);
  setDisabled('leaveBtn', !joined);
  setDisabled('muteBtn',  !joined);
  setDisabled('camBtn',   !joined);

  if (icon.mute) {
    icon.mute.setAttribute('aria-pressed', String(micOn));
    icon.mute.classList.toggle('is-muted', !micOn);
  }
  if (icon.cam) {
    icon.cam.setAttribute('aria-pressed', String(camOn));
    icon.cam.classList.toggle('is-camoff', !camOn);
  }
}

/* ---------- AR stubs ---------- */
let _arStream = null;

export async function enableARPreview() {
  try {
    _arStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    const ar = $('arBg');
    if (ar) {
      ar.srcObject = _arStream;
      await ar.play().catch(()=>{});
    }
    $('videos')?.classList.add('ar-on');
    showToast('AR preview on');
  } catch (e) {
    console.error('[AR] failed to enable preview', e);
    showToast('camera access failed');
  }
}
export function disableARPreview() {
  try {
    if (_arStream) {
      _arStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      _arStream = null;
    }
    const ar = $('arBg');
    if (ar) ar.srcObject = null;
    $('videos')?.classList.remove('ar-on');
    showToast('AR preview off');
  } catch (e) {
    console.error('[AR] failed to disable preview', e);
  }
}
window.enableARPreview = enableARPreview;
window.disableARPreview = disableARPreview;

/* ---------- Core helpers ---------- */
async function fetchConfig() {
  const res = await fetch('/api/config', { cache: 'no-store' });
  const j = await res.json();
  state.livekitUrl = j.livekitUrl;
  if (!state.livekitUrl) throw new Error('LIVEKIT_URL missing on server');
}

async function getToken(room, user) {
  const r = await fetch(`/api/token?room=${encodeURIComponent(room)}&user=${encodeURIComponent(user)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Token fetch failed');
  return r.text();
}

function ensureAttrs(videoEl) {
  videoEl.muted = true; videoEl.autoplay = true; videoEl.playsInline = true;
  videoEl.setAttribute('muted',''); videoEl.setAttribute('autoplay',''); videoEl.setAttribute('playsinline','');
}

function previewLocal(tracks) {
  const v = $('localVideo');
  ensureAttrs(v);
  try { v.srcObject = null; } catch {}
  const videoTrack = tracks.find(t => t.kind === 'video');
  if (videoTrack && typeof videoTrack.attach === 'function') {
    videoTrack.attach(v);
  } else {
    const stream = new MediaStream(tracks.map(t => t.mediaStreamTrack));
    v.srcObject = stream; v.play().catch(()=>{});
  }
  v.classList.remove('muted');
}

function attachRemoteTrack(track, pub, participant) {
  if (pub.kind === Track.Kind.Video) {
    const videoEl = $('remoteVideo');
    ensureAttrs(videoEl);
    try { videoEl.srcObject = null; } catch {}
    track.attach(videoEl);
  } else if (pub.kind === Track.Kind.Audio) {
    if (!state.remoteAudioEl) {
      const a = document.createElement('audio');
      a.autoplay = true; a.style.display = 'none';
      document.body.appendChild(a);
      state.remoteAudioEl = a;
    }
    track.attach(state.remoteAudioEl);
    state.remoteAudioEl.muted = false;
    state.remoteAudioEl.play().catch(()=>{});
  }
}

/* ---------- Join / leave ---------- */
async function join() {
  const roomName = $('room').value.trim();
  const userName = $('name').value.trim();

  if (!roomName) { showToast('enter a room name'); $('room')?.focus(); return; }
  if (!userName) { showToast('enter your name');  $('name')?.focus(); return; }

  await fetchConfig();
  const token = await getToken(roomName, userName);

  setLogLevel('warn');
  const room = new Room({ adaptiveStream: true, dynacast: true });
  state.room = room;

  room.on(RoomEvent.Connected, () => {});
  room.on(RoomEvent.Reconnecting, () => showToast('reconnecting…'));
  room.on(RoomEvent.Connected, () => { if (state.joined) showToast('reconnected'); });
  room.on(RoomEvent.Disconnected, () => {});

  room.on(RoomEvent.ParticipantConnected, (p) => showToast(`${p.identity} joined`));
  room.on(RoomEvent.ParticipantDisconnected, (p) => showToast(`${p.identity} left`));

  room.on(RoomEvent.TrackSubscribed, (track, pub, p) => attachRemoteTrack(track, pub, p));
  room.on(RoomEvent.TrackUnsubscribed, () => { $('remoteVideo').srcObject = null; });

  const localTracks = await createLocalTracks({ audio: true, video: { facingMode: 'user', width: 960, frameRate: 24 } });
  state.localTracks = localTracks;
  previewLocal(localTracks);

  await room.connect(state.livekitUrl, await token);
  for (const t of localTracks) await room.localParticipant.publishTrack(t);

  setUIState({ joined: true });
  showToast(`joined: ${roomName}`);
}

async function leave() {
  try {
    if (state.room) await state.room.disconnect();
    for (const t of state.localTracks) { try { t.stop(); } catch {} }
  } finally {
    state.room = null; state.localTracks = [];
    $('localVideo').srcObject = null;
    $('remoteVideo').srcObject = null;
    if (state.remoteAudioEl) state.remoteAudioEl.srcObject = null;
    setUIState({ joined: false, micOn: true, camOn: true });
    showToast('left the room');
  }
}

function toggleMic() {
  const next = !state.micOn;
  for (const t of state.localTracks) if (t.kind === 'audio') t.mediaStreamTrack.enabled = next;
  setUIState({ micOn: next });
}

function toggleCam() {
  const next = !state.camOn;
  for (const t of state.localTracks) if (t.kind === 'video') t.mediaStreamTrack.enabled = next;
  setUIState({ camOn: next });
}

/* ---------- Event wiring ---------- */
$('joinBtn').addEventListener('click', join);
$('leaveBtn').addEventListener('click', leave);
$('muteBtn').addEventListener('click',  toggleMic);
$('camBtn').addEventListener('click',   toggleCam);

icon.mute ?.addEventListener('click', () => $('muteBtn') ?.click());
icon.cam  ?.addEventListener('click', () => $('camBtn')  ?.click());
icon.leave?.addEventListener('click', () => openConfirm());

// leave confirm
const overlay = $('confirmOverlay');
const confirmCancel = $('confirmCancel');
const confirmLeave  = $('confirmLeave');

function openConfirm() {
  if (!state.joined) return;
  overlay.hidden = false; overlay.classList.add('show');
  confirmLeave.focus();
  document.addEventListener('keydown', trapEsc, { once: true });
  overlay.addEventListener('click', backdropClose);
}
function closeConfirm() {
  overlay.classList.remove('show'); overlay.hidden = true;
  overlay.removeEventListener('click', backdropClose);
}
function trapEsc(e) { if (e.key === 'Escape') closeConfirm(); }
function backdropClose(e) { if (e.target === overlay) closeConfirm(); }
confirmCancel.addEventListener('click', closeConfirm);
confirmLeave .addEventListener('click', () => { closeConfirm(); $('leaveBtn')?.click(); });

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Escape') openConfirm();
});

/* ---------- BFCache / lifecycle ---------- */
window.addEventListener('pagehide', () => { if (state.joined) { try { leave(); } catch {} } });
window.addEventListener('beforeunload', () => { if (state.joined) { try { leave(); } catch {} } });
window.addEventListener('pageshow', () => { setUIState({ joined: false, micOn: true, camOn: true }); });
