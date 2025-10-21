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
let avatarModel = null, avatarOutline = null;
let gltfLoader = null;

// Touch gesture state
let touchState = {
  active: false,
  touches: [],
  initialScale: 1,
  initialDistance: 0,
  dragStart: null,
  planeStartPos: null,
  targetObject: null // Track which object (videoPlane or avatarModel) is being manipulated
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
    
    // Add lighting for 3D avatars
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

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
        
        // Inspect model for rigging and blend shapes
        inspectAvatarModel(gltf);
        
        // Scale avatar to reasonable size (RPM avatars are typically human-sized)
        avatarModel.scale.set(0.5, 0.5, 0.5);
        
        // Position avatar upright and fixed to ground level
        if (videoPlane) {
          // Use video plane position as horizontal reference only
          avatarModel.position.x = videoPlane.position.x + 0.5; // 0.5m to the right
          avatarModel.position.z = videoPlane.position.z;
          // Fix avatar to ground level (y=0 or slightly above)
          avatarModel.position.y = 0;
        } else {
          // Fallback position if video plane not yet placed
          avatarModel.position.set(0.5, 0, -1);
        }
        
        // Keep avatar upright - no rotation copying from video plane
        avatarModel.rotation.set(0, 0, 0);
        
        // Create orange bounding box outline for avatar (initially hidden)
        createAvatarOutline();
        
        // Add to scene independently (not parented to video plane)
        scene.add(avatarModel);
        
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

// Inspect avatar model for rigging and blend shapes
function inspectAvatarModel(gltf) {
  console.log('=== Avatar Model Inspection ===');
  
  let hasRigging = false;
  let hasMorphTargets = false;
  let boneCount = 0;
  let morphTargetInfo = [];
  
  gltf.scene.traverse((child) => {
    // Check for rigging (SkinnedMesh and bones)
    if (child.isSkinnedMesh) {
      hasRigging = true;
      if (child.skeleton) {
        boneCount = child.skeleton.bones.length;
        console.log(`✓ Found SkinnedMesh: "${child.name}" with ${boneCount} bones`);
        
        // Log some bone names for reference
        if (child.skeleton.bones.length > 0) {
          const sampleBones = child.skeleton.bones.slice(0, 5).map(b => b.name);
          console.log(`  Sample bones: ${sampleBones.join(', ')}...`);
        }
      }
    }
    
    // Check for blend shapes (morph targets)
    if (child.morphTargetDictionary && child.morphTargetInfluences) {
      hasMorphTargets = true;
      const morphCount = Object.keys(child.morphTargetDictionary).length;
      console.log(`✓ Found morph targets in "${child.name}": ${morphCount} blend shapes`);
      
      // Log morph target names
      const morphNames = Object.keys(child.morphTargetDictionary);
      morphTargetInfo.push({
        mesh: child.name,
        morphTargets: morphNames
      });
      
      if (morphNames.length > 0) {
        console.log(`  Blend shapes: ${morphNames.slice(0, 10).join(', ')}${morphNames.length > 10 ? '...' : ''}`);
      }
    }
  });
  
  // Summary
  console.log('\n--- Summary ---');
  console.log(`Rigged: ${hasRigging ? 'YES' : 'NO'} ${hasRigging ? `(${boneCount} bones)` : ''}`);
  console.log(`Blend Shapes: ${hasMorphTargets ? 'YES' : 'NO'} ${hasMorphTargets ? `(${morphTargetInfo.length} meshes with morph targets)` : ''}`);
  
  if (hasRigging) {
    console.log('→ Avatar can be animated with skeletal animations');
  }
  if (hasMorphTargets) {
    console.log('→ Avatar supports facial expressions and blend shape animations');
  }
  
  console.log('===============================\n');
  
  // Store for potential future use
  avatarModel.userData.hasRigging = hasRigging;
  avatarModel.userData.hasMorphTargets = hasMorphTargets;
  avatarModel.userData.boneCount = boneCount;
  avatarModel.userData.morphTargetInfo = morphTargetInfo;
}

// Create bounding box outline for avatar
function createAvatarOutline() {
  if (!avatarModel || avatarOutline) return;
  
  // Calculate bounding box for the avatar at current scale
  const box = new THREE.Box3().setFromObject(avatarModel);
  const size = new THREE.Vector3();
  box.getSize(size);
  
  // Create unit box geometry (1x1x1), we'll scale it to match avatar bounds
  const outlineGeom = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(outlineGeom);
  const outlineMat = new THREE.LineBasicMaterial({ 
    color: 0xff8c00, // Orange color
    linewidth: 3,
    transparent: true,
    opacity: 1.0
  });
  
  avatarOutline = new THREE.LineSegments(edges, outlineMat);
  avatarOutline.visible = false;
  avatarOutline.renderOrder = 999;
  
  // Add to scene
  scene.add(avatarOutline);
  
  console.log('Avatar outline created');
}

// Update avatar outline to match avatar position, rotation, and scale
function updateAvatarOutline() {
  if (!avatarModel || !avatarOutline) return;
  
  // Recalculate bounding box with current scale
  const box = new THREE.Box3().setFromObject(avatarModel);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  
  // Update outline position to center of bounding box
  avatarOutline.position.copy(center);
  avatarOutline.rotation.copy(avatarModel.rotation);
  
  // Scale the unit box to match current bounding box dimensions
  avatarOutline.scale.set(size.x, size.y, size.z);
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

function getTouchedObject(clientX, clientY) {
  if (!raycaster || !renderer || !camera) return null;
  
  // Convert touch coordinates to normalized device coordinates (-1 to +1)
  const rect = renderer.domElement.getBoundingClientRect();
  touchPointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  touchPointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  
  // Get XR camera
  const xrCam = renderer.xr.getCamera(camera);
  
  // Update raycaster with camera and pointer position
  raycaster.setFromCamera(touchPointer, xrCam);
  
  // Check for intersections with both avatar and video plane
  const objectsToCheck = [];
  if (avatarModel) objectsToCheck.push(avatarModel);
  if (videoPlane) objectsToCheck.push(videoPlane);
  
  if (objectsToCheck.length === 0) return null;
  
  const intersects = raycaster.intersectObjects(objectsToCheck, true); // true = check children
  
  if (intersects.length > 0) {
    // Return the top-level object that was intersected
    const intersectedObj = intersects[0].object;
    
    // Check if it's the avatar or a child of the avatar
    if (avatarModel && (intersectedObj === avatarModel || avatarModel.children.includes(intersectedObj) || isDescendantOf(intersectedObj, avatarModel))) {
      return avatarModel;
    }
    
    // Check if it's the video plane
    if (videoPlane && intersectedObj === videoPlane) {
      return videoPlane;
    }
  }
  
  return null;
}

// Helper to check if an object is a descendant of a parent
function isDescendantOf(obj, parent) {
  let current = obj.parent;
  while (current) {
    if (current === parent) return true;
    current = current.parent;
  }
  return false;
}

function handleTouchStart(e) {
  if (!videoPlane && !avatarModel) return;
  
  touchState.touches = Array.from(e.touches);
  
  // Check if first touch is on video plane or avatar
  const firstTouch = touchState.touches[0];
  const touchedObj = getTouchedObject(firstTouch.clientX, firstTouch.clientY);
  
  if (!touchedObj) {
    // Touch is not on any interactive object - allow normal UI interaction
    return;
  }
  
  // Touch is on an object - activate gesture controls
  e.preventDefault();
  touchState.active = true;
  touchState.targetObject = touchedObj;
  
  if (touchState.touches.length === 1) {
    // Single finger drag setup
    touchState.dragStart = { x: firstTouch.clientX, y: firstTouch.clientY };
    touchState.planeStartPos = touchedObj.position.clone();
  } else if (touchState.touches.length === 2) {
    // Two finger pinch setup
    const t1 = touchState.touches[0];
    const t2 = touchState.touches[1];
    touchState.initialDistance = getTouchDistance(t1, t2);
    touchState.initialScale = touchedObj.scale.x;
  }
  
  // Show orange outline for touched object
  if (touchedObj === videoPlane && videoOutline) {
    videoOutline.visible = true;
    updateOutline();
  } else if (touchedObj === avatarModel && avatarOutline) {
    avatarOutline.visible = true;
    updateAvatarOutline();
  }
}

function handleTouchMove(e) {
  if (!touchState.active || !touchState.targetObject) return;
  
  e.preventDefault();
  touchState.touches = Array.from(e.touches);
  
  const targetObj = touchState.targetObject;
  
  if (touchState.touches.length === 1 && touchState.dragStart) {
    // Single finger drag - move object parallel to camera
    const touch = touchState.touches[0];
    const deltaX = touch.clientX - touchState.dragStart.x;
    const deltaY = touch.clientY - touchState.dragStart.y;
    
    // Convert screen delta to world-space movement (camera-relative)
    const xrCam = renderer.xr.getCamera(camera);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(xrCam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(xrCam.quaternion);
    
    // Scale factor based on distance from camera (farther = larger movements)
    const distanceFromCam = targetObj.position.distanceTo(xrCam.position);
    const movementScale = distanceFromCam * 0.001;
    
    const newPos = touchState.planeStartPos.clone();
    newPos.add(right.multiplyScalar(deltaX * movementScale));
    newPos.add(up.multiplyScalar(-deltaY * movementScale));
    
    targetObj.position.copy(newPos);
    
  } else if (touchState.touches.length === 2 && touchState.initialDistance > 0) {
    // Two finger pinch - scale object
    const t1 = touchState.touches[0];
    const t2 = touchState.touches[1];
    const currentDistance = getTouchDistance(t1, t2);
    const scaleChange = currentDistance / touchState.initialDistance;
    
    // Apply scale with min/max constraints (0.3x to 4x)
    const newScale = Math.max(0.3, Math.min(4.0, touchState.initialScale * scaleChange));
    
    // Avatar uses uniform scale, video plane keeps z=1
    if (targetObj === avatarModel) {
      targetObj.scale.set(newScale, newScale, newScale);
    } else if (targetObj === videoPlane) {
      targetObj.scale.set(newScale, newScale, 1);
    }
  }
  
  // Update outline to match the manipulated object
  if (targetObj === videoPlane) {
    updateOutline();
  } else if (targetObj === avatarModel) {
    updateAvatarOutline();
  }
}

function handleTouchEnd(e) {
  if (!touchState.active) return;
  
  e.preventDefault();
  touchState.touches = Array.from(e.touches);
  
  if (touchState.touches.length === 0) {
    // All fingers lifted - hide outlines and clear target
    touchState.active = false;
    touchState.dragStart = null;
    touchState.planeStartPos = null;
    touchState.initialDistance = 0;
    touchState.targetObject = null;
    
    if (videoOutline) {
      videoOutline.visible = false;
    }
    if (avatarOutline) {
      avatarOutline.visible = false;
    }
  } else if (touchState.touches.length === 1) {
    // Went from two fingers to one - reset drag
    const touch = touchState.touches[0];
    touchState.dragStart = { x: touch.clientX, y: touch.clientY };
    touchState.planeStartPos = touchState.targetObject ? touchState.targetObject.position.clone() : null;
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
  
  // Clean up avatar outline
  if (avatarOutline) {
    if (avatarOutline.parent) {
      avatarOutline.parent.remove(avatarOutline);
    }
    if (avatarOutline.geometry) avatarOutline.geometry.dispose();
    if (avatarOutline.material) avatarOutline.material.dispose();
    avatarOutline = null;
  }
  
  // Clean up avatar model
  if (avatarModel) {
    // Remove from parent
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
