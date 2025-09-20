import {
  Room, RoomEvent, createLocalTracks, setLogLevel, Track
} from 'https://cdn.jsdelivr.net/npm/livekit-client/+esm';

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158/build/three.module.js';
import { ARButton } from 'https://cdn.jsdelivr.net/npm/three@0.158/examples/jsm/webxr/ARButton.js';

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
const holoBtn = $('holoBtn');
const arClose = $('arClose');

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

/* ---------- helpers ---------- */
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
  const v = $('localVideo'); ensureAttrs(v);
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
    // also mirror into hidden holo video
    const holoVid = $('remoteHoloVideo');
    holoVid.srcObject = videoEl.srcObject;
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

/* ---------- join/leave ---------- */
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

  room.on(RoomEvent.ParticipantConnected, (p) => {
    showToast(`${p.identity} joined`);
    holoBtn.hidden = false; // show Holo Mode
  });
  room.on(RoomEvent.ParticipantDisconnected, (p) => {
    showToast(`${p.identity} left`);
    holoBtn.hidden = true;
  });

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
    $('remoteHoloVideo').srcObject = null;
    if (state.remoteAudioEl) state.remoteAudioEl.srcObject = null;
    setUIState({ joined: false, micOn: true, camOn: true });
    holoBtn.hidden = true;
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

/* ---------- event wiring ---------- */
$('joinBtn').addEventListener('click', join);
$('leaveBtn').addEventListener('click', leave);
$('muteBtn').addEventListener('click', toggleMic);
$('camBtn').addEventListener('click', toggleCam);

icon.mute ?.addEventListener('click', () => $('muteBtn') ?.click());
icon.cam  ?.addEventListener('click', () => $('camBtn')  ?.click());
icon.leave?.addEventListener('click', () => openConfirm());

/* leave confirm overlay */
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

/* ---------- lifecycle safety ---------- */
window.addEventListener('pagehide', () => { if (state.joined) { try { leave(); } catch {} } });
window.addEventListener('beforeunload', () => { if (state.joined) { try { leave(); } catch {} } });
window.addEventListener('pageshow', () => { setUIState({ joined: false, micOn: true, camOn: true }); });

/* ==========================================================
   Holo Mode (WebXR + Three.js)
   ========================================================== */
let renderer, scene, camera, reticle, videoPlane;

if(holoBtn){
  holoBtn.addEventListener('click', startHoloMode);
}
if(arClose){
  arClose.addEventListener('click', endHoloMode);
}

function startHoloMode(){
  if(!navigator.xr){ showToast('WebXR not supported'); return; }

  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();

  const ringGeo = new THREE.RingGeometry(0.05,0.06,32).rotateX(-Math.PI/2);
  const mat = new THREE.MeshBasicMaterial({ color:0x00ff00 });
  reticle = new THREE.Mesh(ringGeo,mat);
  reticle.matrixAutoUpdate=false;
  reticle.visible=false;
  scene.add(reticle);

  const arButton = ARButton.createButton(renderer, { requiredFeatures:['hit-test'] });
  arButton.style.display='none'; // hide UI, auto-trigger
  document.body.appendChild(arButton);
  arButton.click();

  renderer.setAnimationLoop(renderXR);
  arClose.hidden=false;

  // tap to place
  renderer.domElement.addEventListener('click', ()=>{
    if(reticle.visible && !videoPlane){
      const geom = new THREE.PlaneGeometry(1.5,1.0);
      const remoteVid = $('remoteHoloVideo');
      const texture = new THREE.VideoTexture(remoteVid);
      const mat = new THREE.MeshBasicMaterial({ map:texture, side:THREE.DoubleSide });
      videoPlane = new THREE.Mesh(geom, mat);
      videoPlane.matrixAutoUpdate=true;
      videoPlane.position.setFromMatrixPosition(reticle.matrix);
      scene.add(videoPlane);
    }
  });
}

async function renderXR(timestamp, frame){
  const session = renderer.xr.getSession();
  if(!session) return;

  const refSpace = renderer.xr.getReferenceSpace();
  if(!refSpace) return;

  if(!frame) return;
  if(!session.hitTestSourceRequested){
    const viewerSpace = await session.requestReferenceSpace('viewer');
    session.hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    session.hitTestSourceRequested = true;
  }
  if(session.hitTestSource){
    const hits = frame.getHitTestResults(session.hitTestSource);
    if(hits.length){
      const hit = hits[0];
      const pose = hit.getPose(refSpace);
      reticle.visible=true;
      reticle.matrix.fromArray(pose.transform.matrix);
    }
  }

  renderer.render(scene,camera);
}

function endHoloMode(){
  renderer.setAnimationLoop(null);
  if(renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  arClose.hidden=true;
  videoPlane=null;
  reticle=null;
}
