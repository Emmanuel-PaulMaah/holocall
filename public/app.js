import { Room, RoomEvent, createLocalTracks, setLogLevel } from 'https://cdn.jsdelivr.net/npm/livekit-client/+esm';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158/build/three.module.js';

const $ = (id) => document.getElementById(id);
const setDisabled = (id, val) => { const el = $(id); if (el) el.disabled = val; };
const log = (m) => { console.log(m); const L=$('log'); if(L){ L.textContent += m + '\n'; L.scrollTop=L.scrollHeight; } };

const state = { room:null, localTracks:[], micOn:true, camOn:true, livekitUrl:null, remoteAudioEl:null, joined:false };

const icon = { mute:$('muteIconBtn'), cam:$('cameraIconBtn'), leave:$('leaveIconBtn') };
const holoBtn = $('holoBtn'), arClose = $('arClose');

/* ---------------- UI helpers ---------------- */
function showToast(msg){ const t=$('toast'); if(!t) return; t.textContent=msg; t.classList.add('show'); clearTimeout(showToast._t); showToast._t=setTimeout(()=>t.classList.remove('show'), 2200); }
function setUIState({joined=state.joined, micOn=state.micOn, camOn=state.camOn}={}) {
  state.joined=joined; state.micOn=micOn; state.camOn=camOn;
  setDisabled('joinBtn', joined); setDisabled('leaveBtn', !joined); setDisabled('muteBtn', !joined); setDisabled('camBtn', !joined);
  if(icon.mute){ icon.mute.setAttribute('aria-pressed', String(micOn)); icon.mute.classList.toggle('is-muted', !micOn); }
  if(icon.cam){  icon.cam.setAttribute('aria-pressed', String(camOn));  icon.cam.classList.toggle('is-camoff', !camOn); }
}
function recalcHoloVisibility(){ const hasRemote = !!state.room && (state.room.remoteParticipants?.size||0)>0; if(holoBtn) holoBtn.hidden = !(state.joined && hasRemote); }

/* ---------------- server helpers ---------------- */
async function fetchConfig(){ const r=await fetch('/api/config',{cache:'no-store'}); const j=await r.json(); state.livekitUrl=j.livekitUrl; if(!state.livekitUrl) throw new Error('LIVEKIT_URL missing'); }
async function getToken(room,user){ const r=await fetch(`/api/token?room=${encodeURIComponent(room)}&user=${encodeURIComponent(user)}`,{cache:'no-store'}); if(!r.ok) throw new Error('token fetch failed'); return r.text(); }

/* ---------------- media helpers ---------------- */
function ensureAttrs(v){ v.muted=true; v.autoplay=true; v.playsInline=true; v.setAttribute('muted',''); v.setAttribute('autoplay',''); v.setAttribute('playsinline',''); }
function previewLocal(tracks){
  const v=$('localVideo'); ensureAttrs(v); try{ v.srcObject=null; }catch{}
  const vt=tracks.find(t=>t.kind==='video');
  if(vt && typeof vt.attach==='function'){ vt.attach(v); }
  else { const s=new MediaStream(tracks.map(t=>t.mediaStreamTrack)); v.srcObject=s; v.play().catch(()=>{}); }
  v.classList.remove('muted');
}
function attachRemoteTrack(track, pub){
  if(pub.kind === 'video'){
    const rv = $('remoteVideo');
    ensureAttrs(rv);
    try { rv.srcObject = null; } catch {}
    track.attach(rv);

    // feed the hidden AR texture source and FORCE playback
    const hv = $('remoteHoloVideo');
    ensureAttrs(hv);               // playsinline/autoplay/muted attributes
    hv.muted = true;               // allow autoplay on mobile
    hv.srcObject = rv.srcObject;   // mirror the same MediaStream
    // kick playback; ignore promise rejection (some browsers resolve later)
    const tryPlay = () => hv.play().catch(() => {});
    hv.addEventListener('loadeddata', tryPlay, { once: true });
    hv.addEventListener('playing',    () => {}, { once: true });
    // also try immediately (if track was already flowing)
    tryPlay();

  } else if(pub.kind === 'audio'){
    if(!state.remoteAudioEl){
      const a = document.createElement('audio');
      a.autoplay = true;
      a.style.display = 'none';
      document.body.appendChild(a);
      state.remoteAudioEl = a;
    }
    track.attach(state.remoteAudioEl);
    state.remoteAudioEl.muted = false;
    state.remoteAudioEl.play().catch(()=>{});
  }
}


/* ---------------- join / leave ---------------- */
async function join(){
  const room=$('room').value.trim(), name=$('name').value.trim();
  if(!room){ showToast('enter a room name'); $('room')?.focus(); return; }
  if(!name){ showToast('enter your name');  $('name')?.focus(); return; }

  await fetchConfig(); const token=await getToken(room,name);
  setLogLevel('warn'); state.room=new Room({ adaptiveStream:true, dynacast:true });

  state.room.on(RoomEvent.Reconnecting, ()=> showToast('reconnecting…'));
  state.room.on(RoomEvent.Connected,   ()=> { if(state.joined) showToast('reconnected'); });

  state.room.on(RoomEvent.ParticipantConnected,  (p)=>{ showToast(`${p.identity} joined`);  recalcHoloVisibility(); });
  state.room.on(RoomEvent.ParticipantDisconnected,(p)=>{ showToast(`${p.identity} left`);    recalcHoloVisibility(); });

  state.room.on(RoomEvent.TrackSubscribed,   (track,pub,p)=> attachRemoteTrack(track,pub,p));
  state.room.on(RoomEvent.TrackUnsubscribed, ()=> { const rv=$('remoteVideo'); if(rv) rv.srcObject=null; recalcHoloVisibility(); });

  const local=await createLocalTracks({ audio:true, video:{ facingMode:'user', width:960, frameRate:24 } });
  state.localTracks=local; previewLocal(local);

  await state.room.connect(state.livekitUrl, await token);
  for(const t of local) await state.room.localParticipant.publishTrack(t);

  setUIState({ joined:true }); showToast(`joined: ${room}`); recalcHoloVisibility();
}
async function leave(){
  try{ if(state.room) await state.room.disconnect(); for(const t of state.localTracks){ try{ t.stop(); }catch{} } }
  finally{
    state.room=null; state.localTracks=[];
    const lv=$('localVideo'), rv=$('remoteVideo'), hv=$('remoteHoloVideo');
    if(lv) lv.srcObject=null; if(rv) rv.srcObject=null; if(hv) hv.srcObject=null;
    if(state.remoteAudioEl) state.remoteAudioEl.srcObject=null;
    setUIState({ joined:false, micOn:true, camOn:true }); recalcHoloVisibility(); showToast('left the room');
  }
}
function toggleMic(){ const next=!state.micOn; for(const t of state.localTracks) if(t.kind==='audio') t.mediaStreamTrack.enabled=next; setUIState({ micOn:next }); }
function toggleCam(){ const next=!state.camOn; for(const t of state.localTracks) if(t.kind==='video') t.mediaStreamTrack.enabled=next; setUIState({ camOn:next }); }

/* ---------------- wires ---------------- */
$('joinBtn').addEventListener('click', join);
$('leaveBtn').addEventListener('click', leave);
$('muteBtn'). addEventListener('click', toggleMic);
$('camBtn').  addEventListener('click', toggleCam);
icon.mute ?.addEventListener('click', ()=> $('muteBtn')?.click());
icon.cam  ?.addEventListener('click', ()=> $('camBtn') ?.click());
icon.leave?.addEventListener('click', ()=> openConfirm());

/* leave confirm */
const overlay=$('confirmOverlay'), confirmCancel=$('confirmCancel'), confirmLeave=$('confirmLeave');
function openConfirm(){ if(!state.joined) return; overlay.hidden=false; overlay.classList.add('show'); confirmLeave.focus(); document.addEventListener('keydown', trapEsc, {once:true}); overlay.addEventListener('click', backdropClose); }
function closeConfirm(){ overlay.classList.remove('show'); overlay.hidden=true; overlay.removeEventListener('click', backdropClose); }
function trapEsc(e){ if(e.key==='Escape') closeConfirm(); }
function backdropClose(e){ if(e.target===overlay) closeConfirm(); }
confirmCancel.addEventListener('click', closeConfirm);
confirmLeave .addEventListener('click', ()=>{ closeConfirm(); $('leaveBtn')?.click(); });

/* lifecycle */
window.addEventListener('pagehide',     ()=>{ if(state.joined){ try{ leave(); }catch{} } });
window.addEventListener('beforeunload', ()=>{ if(state.joined){ try{ leave(); }catch{} } });
window.addEventListener('pageshow',     ()=>{ setUIState({ joined:false, micOn:true, camOn:true }); recalcHoloVisibility(); });

/* ================== Holo Mode (WebXR) ================== */
let renderer, scene, camera, reticle, videoPlane;
let xrSession=null, refSpace=null, viewerSpace=null, hitTestSource=null;
let onSelectRef=null;

/* capability */
async function isARSupported(){
  if(!('xr' in navigator)) return { ok:false, why:'WebXR not available in this browser' };
  try{ return (await navigator.xr.isSessionSupported('immersive-ar')) ? {ok:true} : {ok:false, why:'immersive-AR not supported on this device'}; }
  catch(e){ return { ok:false, why: e?.message || 'XR support check failed' }; }
}

/* ref-space negotiation with hard fallbacks */
async function requestRefSpace(session, order){
  for(const type of order){
    try { const space = await session.requestReferenceSpace(type); return {space, type}; }
    catch(e){ /* try next */ }
  }
  return {space:null, type:null};
}

if(holoBtn)  holoBtn.addEventListener('click', startHoloMode);
if(arClose)  arClose.addEventListener('click', endHoloMode);

async function startHoloMode(){
  const sup = await isARSupported();
  if(!sup.ok){ showToast(sup.why); return; }

  try{
    // prefer hit-test + dom overlay; soft-fallback to minimal
    let sessionInit = { requiredFeatures:['hit-test'], optionalFeatures:['dom-overlay','local-floor','bounded-floor','unbounded'], domOverlay:{ root: document.body } };
    try { xrSession = await navigator.xr.requestSession('immersive-ar', sessionInit); }
    catch (e) { console.warn('[AR] hit-test/dom-overlay failed, retry minimal:', e); xrSession = await navigator.xr.requestSession('immersive-ar', {}); }

    // renderer canvas (full-screen)
    renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.domElement.classList.add('ar-layer');
    document.body.appendChild(renderer.domElement);

    // UI takeover
    document.body.classList.add('ar-active');
    holoBtn.hidden = true; arClose.hidden = false;

    // scene/camera
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera();

    // reticle (for hit-test path)
    const ringGeo=new THREE.RingGeometry(0.05,0.06,32).rotateX(-Math.PI/2);
    const ringMat=new THREE.MeshBasicMaterial({ color:0x00ff00 });
    reticle=new THREE.Mesh(ringGeo,ringMat);
    reticle.matrixAutoUpdate=false; reticle.visible=false; scene.add(reticle);

    // link session
    await renderer.xr.setSession(xrSession);

    // try to get a world-ish space; if none, fall back to renderer's default then viewer
    let got = await requestRefSpace(xrSession, ['local','local-floor','bounded-floor','unbounded']);
    if (!got.space) {
      // renderer may supply a default reference space
      got.space = renderer.xr.getReferenceSpace?.() || null;
      got.type  = got.space ? 'renderer-default' : null;
    }
    if (!got.space) {
      // last resort: pure viewer
      const viewerTry = await requestRefSpace(xrSession, ['viewer']);
      got = viewerTry.space ? viewerTry : got;
    }
    refSpace = got.space;
    // now try to get a true viewer space (for hit-test); if not, we’ll skip hit-test
    const viewerTry = await requestRefSpace(xrSession, ['viewer']);
    viewerSpace = viewerTry.space || null;

    if (!refSpace) { showToast('no compatible ref space'); await endHoloMode(); return; }

    // hit-test only if we have a viewerSpace and the API exists
    try {
      hitTestSource = (viewerSpace && xrSession.requestHitTestSource)
        ? await xrSession.requestHitTestSource({ space: viewerSpace })
        : null;
    } catch (e) { console.warn('[AR] hit-test init failed', e); hitTestSource = null; }

    const labelRS  = viewerTry.type || got.type || 'unknown';
    const labelHT  = hitTestSource ? 'on' : 'off';
    showToast(`AR ready · ref=${labelRS} · hitTest=${labelHT}`);

    // place plane on XR select (works cross-device)
    onSelectRef = ()=> tryPlaceVideoPlane();
    xrSession.addEventListener('select', onSelectRef);

    xrSession.addEventListener('end', ()=>{ cleanupXR(); });
    renderer.setAnimationLoop(renderXR);
  }catch(e){
    console.error('[AR] start failed:', e);
    showToast(e?.message || e?.name || 'AR start failed');
  }
}

function renderXR(_t, frame){
  if(!frame){ renderer?.render(scene,camera); return; }
  if(hitTestSource && refSpace){
    const hits = frame.getHitTestResults(hitTestSource);
    if(hits.length){
      const pose = hits[0].getPose(refSpace);
      if (pose) { reticle.visible=true; reticle.matrix.fromArray(pose.transform.matrix); }
    } else { reticle.visible=false; }
  }
  renderer.render(scene,camera);
}

function tryPlaceVideoPlane(){
  if(videoPlane) return;

  const remoteVid = $('remoteHoloVideo');
  if(!remoteVid.srcObject){
    showToast('remote video not ready');
    return;
  }

  // helper: wait until the hidden video has decodable frames
  const ensureReady = () => {
    if (remoteVid.readyState >= 2) return Promise.resolve();
    return new Promise(resolve => {
      const onReady = () => { remoteVid.removeEventListener('loadeddata', onReady); resolve(); };
      remoteVid.addEventListener('loadeddata', onReady, { once: true });
      // also try to play again (android)
      remoteVid.play().catch(()=>{});
    });
  };

  ensureReady().then(() => {
    const geom = new THREE.PlaneGeometry(1.5, 1.0);
    const texture = new THREE.VideoTexture(remoteVid);
    // optional: slightly better sampling on phones
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const mat = new THREE.MeshBasicMaterial({ map:texture, side:THREE.DoubleSide });
    videoPlane = new THREE.Mesh(geom, mat);

    if(hitTestSource && reticle?.visible){
      const m = new THREE.Matrix4(); m.copy(reticle.matrix);
      videoPlane.position.setFromMatrixPosition(m);
      videoPlane.quaternion.setFromRotationMatrix(m);
    } else {
      // fallback: ~2m in front of XR camera
      const xrCam = renderer.xr.getCamera(camera);
      const camPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
      const forward = new THREE.Vector3(0,0,-1).applyQuaternion(xrCam.quaternion).normalize();
      const pos = camPos.clone().add(forward.multiplyScalar(2.0));
      videoPlane.position.copy(pos);
      videoPlane.lookAt(camPos);
    }

    scene.add(videoPlane);
  });
}


async function endHoloMode(){ try{ await xrSession?.end(); }catch{} cleanupXR(); }
function cleanupXR(){
  document.body.classList.remove('ar-active');
  holoBtn.hidden = false; arClose.hidden = true;
  if(xrSession && onSelectRef){ try{ xrSession.removeEventListener('select', onSelectRef); }catch{} }
  onSelectRef=null;
  if(renderer){ renderer.setAnimationLoop(null); if(renderer.domElement?.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
  renderer=scene=camera=reticle=videoPlane=null;
  xrSession=refSpace=viewerSpace=hitTestSource=null;
}
