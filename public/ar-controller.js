// AR Controller - WebXR/AR functionality

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158/build/three.module.js';
import { state, showToast, holoBtn, arClose } from './ui-controller.js';
import { makeVideoTinyVisible } from './connection-manager.js';

const $ = (id) => document.getElementById(id);

let renderer, scene, camera, reticle, videoPlane;
let xrSession = null, refSpace = null, viewerSpace = null, hitTestSource = null;
let onSelectRef = null;

async function isARSupported() {
  if (!('xr' in navigator)) return { ok: false, why: 'WebXR not available in this browser' };
  try { 
    return (await navigator.xr.isSessionSupported('immersive-ar')) 
      ? {ok: true} 
      : {ok: false, why: 'immersive-AR not supported on this device'}; 
  } catch(e) { 
    return { ok: false, why: e?.message || 'XR support check failed' }; 
  }
}

/* ref-space negotiation with hard fallbacks */
async function requestRefSpace(session, order) {
  for (const type of order) {
    try { 
      const space = await session.requestReferenceSpace(type); 
      return {space, type}; 
    } catch(e) { /* try next */ }
  }
  return {space: null, type: null};
}

/** Drive a VideoTexture so it updates every frame. */
function createVideoTextureWithUpdates(video) {
  const tex = new THREE.VideoTexture(video);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  if (typeof video.requestVideoFrameCallback === 'function') {
    const tick = () => { 
      tex.needsUpdate = true; 
      try { video.requestVideoFrameCallback(tick); } catch {} 
    };
    try { video.requestVideoFrameCallback(tick); } catch {}
  } else {
    const iv = setInterval(() => { tex.needsUpdate = true; }, 33); // ~30fps
    const oldDispose = tex.dispose.bind(tex);
    tex.dispose = () => { clearInterval(iv); oldDispose(); };
  }
  return tex;
}

export async function startHoloMode() {
  const sup = await isARSupported();
  if (!sup.ok) { 
    showToast(sup.why); 
    return; 
  }

  try {
    // prefer hit-test + dom overlay; soft-fallback to minimal
    let sessionInit = { 
      requiredFeatures: ['hit-test'], 
      optionalFeatures: ['dom-overlay', 'local-floor', 'bounded-floor', 'unbounded'], 
      domOverlay: { root: document.body } 
    };
    try { 
      xrSession = await navigator.xr.requestSession('immersive-ar', sessionInit); 
    } catch (e) { 
      console.warn('[AR] hit-test/dom-overlay failed, retry minimal:', e); 
      xrSession = await navigator.xr.requestSession('immersive-ar', {}); 
    }

    // renderer canvas (full-screen)
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.domElement.classList.add('ar-layer');
    document.body.appendChild(renderer.domElement);

    // UI takeover
    document.body.classList.add('ar-active');
    holoBtn.hidden = true; 
    arClose.hidden = false;

    // make sure AR video source is visible + playing (even if track attached earlier)
    const hv = $('remoteHoloVideo');
    makeVideoTinyVisible(hv);
    try { hv.play().catch(() => {}); } catch {}

    // scene/camera
    scene = new THREE.Scene(); 
    camera = new THREE.PerspectiveCamera();

    // reticle (for hit-test path)
    const ringGeo = new THREE.RingGeometry(0.05, 0.06, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    reticle = new THREE.Mesh(ringGeo, ringMat);
    reticle.matrixAutoUpdate = false; 
    reticle.visible = false; 
    scene.add(reticle);

    // link session
    await renderer.xr.setSession(xrSession);

    // try to get a world-ish space; fallback to renderer default then viewer
    let got = await requestRefSpace(xrSession, ['local', 'local-floor', 'bounded-floor', 'unbounded']);
    if (!got.space) {
      got.space = renderer.xr.getReferenceSpace?.() || null;
      got.type = got.space ? 'renderer-default' : null;
    }
    if (!got.space) {
      const viewerTry = await requestRefSpace(xrSession, ['viewer']);
      got = viewerTry.space ? viewerTry : got;
    }
    refSpace = got.space;
    const viewerTry = await requestRefSpace(xrSession, ['viewer']);
    viewerSpace = viewerTry.space || null;

    if (!refSpace) { 
      showToast('no compatible ref space'); 
      await endHoloMode(); 
      return; 
    }

    // hit-test only if we have a viewerSpace and the API exists
    try {
      hitTestSource = (viewerSpace && xrSession.requestHitTestSource)
        ? await xrSession.requestHitTestSource({ space: viewerSpace })
        : null;
    } catch (e) { 
      console.warn('[AR] hit-test init failed', e); 
      hitTestSource = null; 
    }

    const labelRS = viewerTry.type || got.type || 'unknown';
    const labelHT = hitTestSource ? 'on' : 'off';
    showToast(`AR ready · ref=${labelRS} · hitTest=${labelHT}`);

    // place plane on XR select (works cross-device)
    onSelectRef = () => tryPlaceVideoPlane();
    xrSession.addEventListener('select', onSelectRef);

    xrSession.addEventListener('end', () => { cleanupXR(); });
    renderer.setAnimationLoop(renderXR);
  } catch(e) {
    console.error('[AR] start failed:', e);
    showToast(e?.message || e?.name || 'AR start failed');
  }
}

function renderXR(_t, frame) {
  if (!frame) { 
    renderer?.render(scene, camera); 
    return; 
  }

  if (hitTestSource && refSpace) {
    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length) {
      const pose = hits[0].getPose(refSpace);
      if (pose) { 
        reticle.visible = true; 
        reticle.matrix.fromArray(pose.transform.matrix); 
      }
    } else { 
      reticle.visible = false; 
    }
  }

  // Ensure the texture uploads every XR frame (extra safety on Android)
  if (videoPlane && videoPlane.material && videoPlane.material.map) {
    videoPlane.material.map.needsUpdate = true;
  }

  renderer.render(scene, camera);
}

function tryPlaceVideoPlane() {
  if (videoPlane) return;

  const remoteVid = $('remoteHoloVideo');
  if (!remoteVid.srcObject) {
    showToast('remote video not ready');
    return;
  }

  // wait until the hidden video has decodable frames
  const ensureReady = () => {
    if (remoteVid.readyState >= 2 && remoteVid.videoWidth > 0 && remoteVid.videoHeight > 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const onReady = () => { 
        remoteVid.removeEventListener('loadeddata', onReady); 
        resolve(); 
      };
      remoteVid.addEventListener('loadeddata', onReady, { once: true });
      remoteVid.play().catch(() => {});
    });
  };

  ensureReady().then(() => {
    const geom = new THREE.PlaneGeometry(1.5, 1.0);
    const texture = createVideoTextureWithUpdates(remoteVid);
    const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    videoPlane = new THREE.Mesh(geom, mat);

    if (hitTestSource && reticle?.visible) {
      const m = new THREE.Matrix4(); 
      m.copy(reticle.matrix);
      videoPlane.position.setFromMatrixPosition(m);
      videoPlane.quaternion.setFromRotationMatrix(m);
    } else {
      // fallback: 2m in front of XR camera
      const xrCam = renderer.xr.getCamera(camera);
      const camPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCam.quaternion).normalize();
      const pos = camPos.clone().add(forward.multiplyScalar(2.0));
      videoPlane.position.copy(pos);
      videoPlane.lookAt(camPos);
    }

    scene.add(videoPlane);
  });
}

export async function endHoloMode() { 
  try { await xrSession?.end(); } catch {} 
  cleanupXR(); 
}

function cleanupXR() {
  document.body.classList.remove('ar-active');
  holoBtn.hidden = false; 
  arClose.hidden = true;

  const hv = $('remoteHoloVideo');
  if (hv) { 
    hv.setAttribute('hidden', ''); 
    hv.removeAttribute('style'); 
  }

  if (xrSession && onSelectRef) { 
    try { xrSession.removeEventListener('select', onSelectRef); } catch {} 
  }
  onSelectRef = null;

  if (renderer) { 
    renderer.setAnimationLoop(null); 
    if (renderer.domElement?.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement); 
    }
  }
  renderer = scene = camera = reticle = videoPlane = null;
  xrSession = refSpace = viewerSpace = hitTestSource = null;
}

// Export setup function for event listeners
export function setupARControls() {
  if (holoBtn) holoBtn.addEventListener('click', startHoloMode);
  if (arClose) arClose.addEventListener('click', endHoloMode);
}
