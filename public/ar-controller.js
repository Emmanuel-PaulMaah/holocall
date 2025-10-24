// AR Controller - WebXR/AR functionality

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { state, showToast, holoBtn, arClose } from './ui-controller.js';

const $ = (id) => document.getElementById(id);

let renderer, scene, camera;
let xrSession = null, refSpace = null;
let raycaster = null, touchPointer = null;
let avatarModel = null, avatarOutline = null;
let gltfLoader = null;

// Touch gesture state (avatar only)
let touchState = {
  active: false,
  touches: [],
  initialScale: 1,
  initialDistance: 0,
  dragStart: null,
  avatarStartPos: null
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


export async function startHoloMode() {
  const sup = await isARSupported();
  if (!sup.ok) { 
    showToast(sup.why); 
    return; 
  }

  try {
    // Minimal AR session - no hit-test needed for avatar-only mode
    let sessionInit = { 
      optionalFeatures: ['dom-overlay', 'local-floor', 'bounded-floor', 'unbounded'], 
      domOverlay: { root: document.body } 
    };
    try { 
      xrSession = await navigator.xr.requestSession('immersive-ar', sessionInit); 
    } catch (e) { 
      console.warn('[AR] dom-overlay failed, retry minimal:', e); 
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

    // scene/camera
    scene = new THREE.Scene(); 
    camera = new THREE.PerspectiveCamera();
    
    // Add lighting for 3D avatars
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    // link session
    await renderer.xr.setSession(xrSession);

    // get reference space
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

    if (!refSpace) { 
      showToast('no compatible ref space'); 
      await endHoloMode(); 
      return; 
    }

    console.log(`[AR] Avatar Mode started - ref=${got.type || 'unknown'}`);
    showToast('🎭 Avatar Mode - Audio Only');

    // Initialize raycaster for touch detection (avatar only)
    raycaster = new THREE.Raycaster();
    touchPointer = new THREE.Vector2();
    
    // Attach touch gesture handlers
    attachTouchHandlers();

    // Load avatar immediately
    loadRemoteAvatar();

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

  // Simple render loop - just render the scene with avatar
  renderer.render(scene, camera);
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
        
        // Position avatar in AR space: 1.5m in front of user, at ground level
        avatarModel.position.set(0, 0, -1.5);
        
        // Keep avatar upright - standing naturally
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

function getTouchedObject(clientX, clientY) {
  if (!raycaster || !renderer || !camera || !avatarModel) return null;
  
  // Convert touch coordinates to normalized device coordinates (-1 to +1)
  const rect = renderer.domElement.getBoundingClientRect();
  touchPointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  touchPointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  
  // Get XR camera
  const xrCam = renderer.xr.getCamera(camera);
  
  // Update raycaster with camera and pointer position
  raycaster.setFromCamera(touchPointer, xrCam);
  
  // Check for intersections with avatar only
  const intersects = raycaster.intersectObjects([avatarModel], true); // true = check children
  
  if (intersects.length > 0) {
    // Return the top-level object that was intersected
    const intersectedObj = intersects[0].object;
    
    // Check if it's the avatar or a child of the avatar
    if (avatarModel && (intersectedObj === avatarModel || avatarModel.children.includes(intersectedObj) || isDescendantOf(intersectedObj, avatarModel))) {
      return avatarModel;
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
  if (!avatarModel) return;
  
  touchState.touches = Array.from(e.touches);
  
  // Check if first touch is on avatar
  const firstTouch = touchState.touches[0];
  const touchedObj = getTouchedObject(firstTouch.clientX, firstTouch.clientY);
  
  if (!touchedObj) {
    // Touch is not on avatar - allow normal UI interaction
    return;
  }
  
  // Touch is on avatar - activate gesture controls
  e.preventDefault();
  touchState.active = true;
  
  if (touchState.touches.length === 1) {
    // Single finger drag setup
    touchState.dragStart = { x: firstTouch.clientX, y: firstTouch.clientY };
    touchState.avatarStartPos = avatarModel.position.clone();
  } else if (touchState.touches.length === 2) {
    // Two finger pinch setup
    const t1 = touchState.touches[0];
    const t2 = touchState.touches[1];
    touchState.initialDistance = getTouchDistance(t1, t2);
    touchState.initialScale = avatarModel.scale.x;
  }
  
  // Show orange outline when touching avatar
  if (avatarOutline) {
    avatarOutline.visible = true;
    updateAvatarOutline();
  }
}

function handleTouchMove(e) {
  if (!touchState.active || !avatarModel) return;
  
  e.preventDefault();
  touchState.touches = Array.from(e.touches);
  
  if (touchState.touches.length === 1 && touchState.dragStart) {
    // Single finger drag - move avatar parallel to camera
    const touch = touchState.touches[0];
    const deltaX = touch.clientX - touchState.dragStart.x;
    const deltaY = touch.clientY - touchState.dragStart.y;
    
    // Convert screen delta to world-space movement (camera-relative)
    const xrCam = renderer.xr.getCamera(camera);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(xrCam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(xrCam.quaternion);
    
    // Scale factor based on distance from camera (farther = larger movements)
    const distanceFromCam = avatarModel.position.distanceTo(xrCam.position);
    const movementScale = distanceFromCam * 0.001;
    
    const newPos = touchState.avatarStartPos.clone();
    newPos.add(right.multiplyScalar(deltaX * movementScale));
    newPos.add(up.multiplyScalar(-deltaY * movementScale));
    
    avatarModel.position.copy(newPos);
    
  } else if (touchState.touches.length === 2 && touchState.initialDistance > 0) {
    // Two finger pinch - scale avatar
    const t1 = touchState.touches[0];
    const t2 = touchState.touches[1];
    const currentDistance = getTouchDistance(t1, t2);
    const scaleChange = currentDistance / touchState.initialDistance;
    
    // Apply scale with min/max constraints (0.3x to 4x)
    const newScale = Math.max(0.3, Math.min(4.0, touchState.initialScale * scaleChange));
    
    // Avatar uses uniform scale
    avatarModel.scale.set(newScale, newScale, newScale);
  }
  
  // Update outline to match avatar
  updateAvatarOutline();
}

function handleTouchEnd(e) {
  if (!touchState.active) return;
  
  e.preventDefault();
  touchState.touches = Array.from(e.touches);
  
  if (touchState.touches.length === 0) {
    // All fingers lifted - hide outline
    touchState.active = false;
    touchState.dragStart = null;
    touchState.avatarStartPos = null;
    touchState.initialDistance = 0;
    
    if (avatarOutline) {
      avatarOutline.visible = false;
    }
  } else if (touchState.touches.length === 1) {
    // Went from two fingers to one - reset drag
    const touch = touchState.touches[0];
    touchState.dragStart = { x: touch.clientX, y: touch.clientY };
    touchState.avatarStartPos = avatarModel ? avatarModel.position.clone() : null;
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
    avatarStartPos: null
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
  renderer = scene = camera = null;
  xrSession = refSpace = null;
  raycaster = touchPointer = null;
  gltfLoader = null;
}

// Export setup function for event listeners
export function setupARControls() {
  if (holoBtn) holoBtn.addEventListener('click', startHoloMode);
  if (arClose) arClose.addEventListener('click', endHoloMode);
}
