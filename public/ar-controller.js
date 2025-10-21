// AR Controller - WebXR/AR functionality

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { state, showToast, holoBtn, arClose } from './ui-controller.js';
import { makeVideoTinyVisible } from './connection-manager.js';

const $ = (id) => document.getElementById(id);

let renderer, scene, camera, reticle, videoPlane, videoOutline;
let xrSession = null, refSpace = null, viewerSpace = null, hitTestSource = null;
let onSelectRef = null;
let raycaster = null, touchPointer = null;
let avatarModel = null;
let gltfLoader = null;

// Touch gesture state
let touchState = {
  active: false,
  touches: [],
  initialScale: 1,
  initialDistance: 0,
  dragStart: null,
  planeStartPos: null
};

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

    // Create orange wireframe outline for visual feedback (initially hidden)
    const outlineGeom = new THREE.EdgesGeometry(geom);
    const outlineMat = new THREE.LineBasicMaterial({ 
      color: 0xff8c00,
      linewidth: 3,
      transparent: true,
      opacity: 1.0
    });
    videoOutline = new THREE.LineSegments(outlineGeom, outlineMat);
    videoOutline.visible = false;
    videoOutline.renderOrder = 999;

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
    scene.add(videoOutline);
    
    // Initialize raycaster for touch detection
    raycaster = new THREE.Raycaster();
    touchPointer = new THREE.Vector2();
    
    // Attach touch gesture handlers
    attachTouchHandlers();
    
    // Store initial scale for pinch gestures
    touchState.initialScale = videoPlane.scale.x;
    
    // Load avatar if available
    loadRemoteAvatar();
  });
}

// Load Ready Player Me avatar for remote participant
async function loadRemoteAvatar() {
  try {
    // Get remote participant's avatar URL from their profile
    const remoteParticipants = Array.from(state.room?.remoteParticipants?.values() || []);
    if (remoteParticipants.length === 0) {
      console.log('No remote participant found');
      return;
    }
    
    const remoteParticipant = remoteParticipants[0];
    const remoteUserId = remoteParticipant.identity;
    
    // Fetch remote user's profile to get avatar URL
    const response = await fetch(`/api/user/${remoteUserId}/profile`, { credentials: 'include' });
    if (!response.ok) {
      console.log('Could not fetch remote user profile');
      return;
    }
    
    const { profile } = await response.json();
    if (!profile || !profile.avatar_url) {
      console.log('Remote user has no avatar URL set');
      return;
    }
    
    console.log('Loading avatar from:', profile.avatar_url);
    
    // Initialize GLTFLoader if needed
    if (!gltfLoader) {
      gltfLoader = new GLTFLoader();
    }
    
    // Load the avatar model
    gltfLoader.load(
      profile.avatar_url,
      (gltf) => {
        avatarModel = gltf.scene;
        
        // Scale avatar to reasonable size (RPM avatars are typically human-sized)
        avatarModel.scale.set(0.5, 0.5, 0.5);
        
        // Position avatar behind the video plane (relative to video plane)
        avatarModel.position.set(0, 0, -0.3); // Slightly behind in local space
        
        // Parent avatar to video plane so gestures move them together
        if (videoPlane) {
          videoPlane.add(avatarModel);
        }
        
        console.log('Avatar loaded successfully');
        showToast('3D Avatar loaded!');
      },
      (progress) => {
        console.log('Loading avatar:', Math.round((progress.loaded / progress.total) * 100) + '%');
      },
      (error) => {
        console.error('Failed to load avatar:', error);
      }
    );
  } catch (err) {
    console.error('Error loading avatar:', err);
  }
}

/* ---------------- Touch Gesture Handlers ---------------- */

function getTouchDistance(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function updateOutline() {
  if (!videoPlane || !videoOutline) return;
  
  // Match video plane position, rotation, and scale exactly
  videoOutline.position.copy(videoPlane.position);
  videoOutline.quaternion.copy(videoPlane.quaternion);
  videoOutline.scale.copy(videoPlane.scale);
}

function isTouchOnVideoPlane(clientX, clientY) {
  if (!videoPlane || !raycaster || !renderer || !camera) return false;
  
  // Convert touch coordinates to normalized device coordinates (-1 to +1)
  const rect = renderer.domElement.getBoundingClientRect();
  touchPointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  touchPointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  
  // Get XR camera
  const xrCam = renderer.xr.getCamera(camera);
  
  // Update raycaster with camera and pointer position
  raycaster.setFromCamera(touchPointer, xrCam);
  
  // Check for intersections with video plane
  const intersects = raycaster.intersectObject(videoPlane, false);
  return intersects.length > 0;
}

function handleTouchStart(e) {
  if (!videoPlane) return;
  
  touchState.touches = Array.from(e.touches);
  
  // Check if first touch is on the video plane
  const firstTouch = touchState.touches[0];
  if (!isTouchOnVideoPlane(firstTouch.clientX, firstTouch.clientY)) {
    // Touch is not on video plane - allow normal UI interaction
    return;
  }
  
  // Touch is on video plane - activate gesture controls
  e.preventDefault();
  touchState.active = true;
  
  if (touchState.touches.length === 1) {
    // Single finger drag setup
    touchState.dragStart = { x: firstTouch.clientX, y: firstTouch.clientY };
    touchState.planeStartPos = videoPlane.position.clone();
  } else if (touchState.touches.length === 2) {
    // Two finger pinch setup
    const t1 = touchState.touches[0];
    const t2 = touchState.touches[1];
    touchState.initialDistance = getTouchDistance(t1, t2);
    touchState.initialScale = videoPlane.scale.x;
  }
  
  // Show orange outline
  if (videoOutline) {
    videoOutline.visible = true;
    updateOutline();
  }
}

function handleTouchMove(e) {
  if (!touchState.active || !videoPlane) return;
  
  e.preventDefault();
  touchState.touches = Array.from(e.touches);
  
  if (touchState.touches.length === 1 && touchState.dragStart) {
    // Single finger drag - move video plane parallel to camera
    const touch = touchState.touches[0];
    const deltaX = touch.clientX - touchState.dragStart.x;
    const deltaY = touch.clientY - touchState.dragStart.y;
    
    // Convert screen delta to world-space movement (camera-relative)
    const xrCam = renderer.xr.getCamera(camera);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(xrCam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(xrCam.quaternion);
    
    // Scale factor based on distance from camera (farther = larger movements)
    const distanceFromCam = videoPlane.position.distanceTo(xrCam.position);
    const movementScale = distanceFromCam * 0.001;
    
    const newPos = touchState.planeStartPos.clone();
    newPos.add(right.multiplyScalar(deltaX * movementScale));
    newPos.add(up.multiplyScalar(-deltaY * movementScale));
    
    videoPlane.position.copy(newPos);
    
  } else if (touchState.touches.length === 2 && touchState.initialDistance > 0) {
    // Two finger pinch - scale video plane
    const t1 = touchState.touches[0];
    const t2 = touchState.touches[1];
    const currentDistance = getTouchDistance(t1, t2);
    const scaleChange = currentDistance / touchState.initialDistance;
    
    // Apply scale with min/max constraints (0.3x to 4x)
    const newScale = Math.max(0.3, Math.min(4.0, touchState.initialScale * scaleChange));
    videoPlane.scale.set(newScale, newScale, 1);
  }
  
  // Update outline to match
  updateOutline();
}

function handleTouchEnd(e) {
  if (!touchState.active) return;
  
  e.preventDefault();
  touchState.touches = Array.from(e.touches);
  
  if (touchState.touches.length === 0) {
    // All fingers lifted - hide outline
    touchState.active = false;
    touchState.dragStart = null;
    touchState.planeStartPos = null;
    touchState.initialDistance = 0;
    
    if (videoOutline) {
      videoOutline.visible = false;
    }
  } else if (touchState.touches.length === 1) {
    // Went from two fingers to one - reset drag
    const touch = touchState.touches[0];
    touchState.dragStart = { x: touch.clientX, y: touch.clientY };
    touchState.planeStartPos = videoPlane ? videoPlane.position.clone() : null;
    touchState.initialDistance = 0;
  }
}

function attachTouchHandlers() {
  if (!renderer || !renderer.domElement) return;
  
  const canvas = renderer.domElement;
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
}

function detachTouchHandlers() {
  if (!renderer || !renderer.domElement) return;
  
  const canvas = renderer.domElement;
  canvas.removeEventListener('touchstart', handleTouchStart);
  canvas.removeEventListener('touchmove', handleTouchMove);
  canvas.removeEventListener('touchend', handleTouchEnd);
  canvas.removeEventListener('touchcancel', handleTouchEnd);
  
  // Reset touch state
  touchState = {
    active: false,
    touches: [],
    initialScale: 1,
    initialDistance: 0,
    dragStart: null,
    planeStartPos: null
  };
}

export async function endHoloMode() { 
  try { await xrSession?.end(); } catch {} 
  cleanupXR(); 
}

function cleanupXR() {
  // Detach touch handlers before cleanup
  detachTouchHandlers();
  
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
  
  // Clean up avatar model
  if (avatarModel) {
    // Remove from parent (videoPlane)
    if (avatarModel.parent) {
      avatarModel.parent.remove(avatarModel);
    }
    
    // Dispose geometries, materials, and textures
    avatarModel.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
          // Dispose all textures
          if (mat.map) mat.map.dispose();
          if (mat.normalMap) mat.normalMap.dispose();
          if (mat.roughnessMap) mat.roughnessMap.dispose();
          if (mat.metalnessMap) mat.metalnessMap.dispose();
          if (mat.aoMap) mat.aoMap.dispose();
          if (mat.emissiveMap) mat.emissiveMap.dispose();
          if (mat.bumpMap) mat.bumpMap.dispose();
          if (mat.displacementMap) mat.displacementMap.dispose();
          if (mat.alphaMap) mat.alphaMap.dispose();
          if (mat.envMap) mat.envMap.dispose();
          mat.dispose();
        });
      }
    });
    avatarModel = null;
  }

  if (renderer) { 
    renderer.setAnimationLoop(null); 
    if (renderer.domElement?.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement); 
    }
  }
  renderer = scene = camera = reticle = videoPlane = videoOutline = null;
  xrSession = refSpace = viewerSpace = hitTestSource = null;
  raycaster = touchPointer = null;
  gltfLoader = null;
}

// Export setup function for event listeners
export function setupARControls() {
  if (holoBtn) holoBtn.addEventListener('click', startHoloMode);
  if (arClose) arClose.addEventListener('click', endHoloMode);
}
