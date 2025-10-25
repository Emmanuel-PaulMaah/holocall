// AR Controller - WebXR/AR functionality

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { state, showToast, holoBtn, arClose } from './ui-controller.js';
import { toggleCam, setOnCameraToggleCallback } from './connection-manager.js';

const $ = (id) => document.getElementById(id);

let renderer, scene, camera;
let xrSession = null, refSpace = null, viewerSpace = null;
let raycaster = null, touchPointer = null;
let avatarModel = null, avatarOutline = null;
let gltfLoader = null;
let arToggledCameraOff = false; // Track if AR entry disabled camera
let frameRenderCount = 0; // Track if frames are actually rendering
let hitTestSource = null; // Hit-test source for surface placement
let reticle = null; // Visual indicator for placement

// Audio-reactive blend shape animation
let mouthMeshes = []; // Meshes with mouthOpen blend shape
let currentMouthValue = 0; // Smoothed mouth open value (0-1)
const MOUTH_SMOOTHING = 0.3; // Smoothing factor (0.1=very smooth, 0.5=responsive)
let avatarPlaced = false; // Track if avatar has been placed
let animationMixer = null; // Three.js AnimationMixer for avatar animations
let idleAction = null; // Idle/breathing animation
let speakingAction = null; // Speaking/gesturing animation
let clock = null; // Clock for animation updates

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
  if (!('xr' in navigator)) {
    return { 
      ok: false, 
      why: 'AR mode requires a compatible browser. Try Chrome or Samsung Internet.' 
    };
  }
  
  try { 
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) {
      return { 
        ok: false, 
        why: 'AR mode is not available on this device. Your device needs ARCore support. Normal video calling works great!' 
      };
    }
    return { ok: true };
  } catch(e) { 
    return { 
      ok: false, 
      why: 'AR mode is not available on this device. Normal video calling works great!' 
    }; 
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
    // Initialize audio detection for animation triggering
    initAudioDetection();
    
    // Request AR session with hit-test support for surface placement
    let sessionInit = { 
      requiredFeatures: ['local'],
      optionalFeatures: ['hit-test', 'dom-overlay', 'local-floor', 'bounded-floor', 'unbounded'], 
      domOverlay: { root: document.body } 
    };
    try { 
      xrSession = await navigator.xr.requestSession('immersive-ar', sessionInit); 
    } catch (e) { 
      console.warn('[AR] dom-overlay failed, retry without:', e); 
      sessionInit.optionalFeatures = ['hit-test', 'local-floor', 'bounded-floor', 'unbounded'];
      delete sessionInit.domOverlay;
      try {
        xrSession = await navigator.xr.requestSession('immersive-ar', sessionInit);
      } catch (e2) {
        console.warn('[AR] hit-test failed, retry minimal:', e2);
        xrSession = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local'] });
      }
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
    
    // Initialize animation clock
    clock = new THREE.Clock();
    
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
    
    // Try to initialize hit-test for surface placement
    try {
      viewerSpace = await xrSession.requestReferenceSpace('viewer');
      hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });
      console.log('[AR] Hit-test enabled - tap to place avatar on surfaces');
      showToast('👆 Tap on a surface to place avatar');
      
      // Create placement reticle (visual indicator) - ORANGE
      const geometry = new THREE.RingGeometry(0.15, 0.18, 32); // Slightly larger for visibility
      const material = new THREE.MeshBasicMaterial({ 
        color: 0xff8c00, // Orange
        side: THREE.DoubleSide,
        opacity: 0.9,
        transparent: true
      });
      reticle = new THREE.Mesh(geometry, material);
      reticle.rotation.x = -Math.PI / 2; // Lay flat
      reticle.visible = false;
      scene.add(reticle);
      console.log('[AR] ✓ ORANGE reticle created (tap to place avatar)');
    } catch(e) {
      console.warn('[AR] Hit-test not available, using fallback placement:', e);
      showToast('🎭 Avatar Mode - Audio Only');
      avatarPlaced = true; // Skip placement step
    }
    
    // Disable camera if needed to prevent dual-camera conflict
    arToggledCameraOff = false;
    if (state.camOn) {
      toggleCam(); // Turn off camera (updates UI and track)
      arToggledCameraOff = true; // Flag that we turned it off
    }
    
    // Register callback to detect user camera toggles during AR
    setOnCameraToggleCallback(() => {
      // User manually toggled camera during AR - don't auto-restore on exit
      arToggledCameraOff = false;
    });

    // Initialize raycaster for touch detection (avatar manipulation)
    raycaster = new THREE.Raycaster();
    touchPointer = new THREE.Vector2();
    
    // Attach touch gesture handlers
    attachTouchHandlers();

    // Load avatar (will be placed on tap if hit-test available, or immediately if not)
    loadRemoteAvatar();

    // Add tap-to-place handler if hit-test is available
    if (hitTestSource) {
      xrSession.addEventListener('select', onSelectPlaceAvatar);
    }

    xrSession.addEventListener('end', () => { cleanupXR(); });
    
    // Start render loop
    frameRenderCount = 0;
    renderer.setAnimationLoop(renderXR);
    
    // Safeguard: detect if AR session isn't rendering (device lacks proper ARCore support)
    setTimeout(() => {
      if (frameRenderCount === 0 && xrSession) {
        // No frames rendered after 3 seconds - device likely doesn't support AR properly
        console.warn('[AR] No frames rendered - device may lack ARCore support');
        showToast('AR mode is not working on this device. Try a device with ARCore support. Normal video calling works great!');
        endHoloMode();
      }
    }, 3000);
  } catch(e) {
    console.error('[AR] start failed:', e);
    showToast('AR mode is not available on this device. Your device needs ARCore support. Normal video calling works great!');
    await cleanupXR();
  }
}

function renderXR(_t, frame) {
  frameRenderCount++; // Track that frames are rendering
  
  if (!frame) { 
    renderer?.render(scene, camera); 
    return; 
  }

  // Handle hit-test for placement reticle (before avatar is placed)
  if (hitTestSource && !avatarPlaced && reticle) {
    const hitTestResults = frame.getHitTestResults(hitTestSource);
    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(refSpace);
      
      if (pose) {
        reticle.visible = true;
        reticle.position.set(
          pose.transform.position.x,
          pose.transform.position.y,
          pose.transform.position.z
        );
        reticle.updateMatrixWorld(true);
        
        // Log once per second to avoid spam
        if (frameRenderCount % 60 === 0) {
          console.log('[AR] 🎯 Reticle tracking surface at y=' + pose.transform.position.y.toFixed(3));
        }
      }
    } else {
      if (reticle.visible) {
        console.log('[AR] ⚠️ Lost surface tracking');
      }
      reticle.visible = false;
    }
  }

  // Update avatar animations if mixer exists
  if (animationMixer && clock) {
    const delta = clock.getDelta();
    animationMixer.update(delta);
  }

  // Update audio-reactive mouth movement
  updateMouthAnimation();

  // Render the scene with avatar and/or reticle
  renderer.render(scene, camera);
}

// Handle tap to place avatar on surface
function onSelectPlaceAvatar(event) {
  console.log('[AR] 🔵 TAP DETECTED - Attempting to place avatar...');
  console.log('[AR] - avatarModel exists:', !!avatarModel);
  console.log('[AR] - avatarPlaced:', avatarPlaced);
  console.log('[AR] - reticle exists:', !!reticle);
  console.log('[AR] - reticle visible:', reticle?.visible);
  
  if (!avatarModel) {
    console.log('[AR] ❌ No avatar model loaded yet');
    return;
  }
  
  if (avatarPlaced) {
    console.log('[AR] ⚠️ Avatar already placed');
    return;
  }
  
  // Place avatar at reticle position
  if (reticle && reticle.visible) {
    const x = reticle.position.x;
    const y = reticle.position.y;
    const z = reticle.position.z;
    
    avatarModel.position.copy(reticle.position);
    console.log('[AR] 📍 Avatar position set to:', { x: x.toFixed(3), y: y.toFixed(3), z: z.toFixed(3) });
    
    scene.add(avatarModel);
    console.log('[AR] ✓ Avatar added to scene');
    
    // Hide reticle and mark as placed
    reticle.visible = false;
    avatarPlaced = true;
    
    console.log('[AR] ✅ AVATAR PLACED SUCCESSFULLY!');
    console.log('[AR] - Scale:', avatarModel.scale.x.toFixed(2) + 'x (FULL HUMAN HEIGHT)');
    console.log('[AR] - Position:', { 
      x: avatarModel.position.x.toFixed(2), 
      y: avatarModel.position.y.toFixed(2), 
      z: avatarModel.position.z.toFixed(2) 
    });
    
    showToast('✓ Avatar placed! Pinch to resize, drag to move');
  } else {
    console.log('[AR] ⚠️ Reticle not visible - point at a surface first');
    showToast('Point at a surface to place avatar');
  }
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
        
        // Scale avatar to FULL HUMAN HEIGHT (~1.7m tall)
        // RPM avatars are already human-sized, so scale to 1.0 for realistic height
        avatarModel.scale.set(1.0, 1.0, 1.0);
        console.log('[AR] ✓ Avatar scaled to FULL human height (1.0x scale)');
        
        // Keep avatar upright - standing naturally
        avatarModel.rotation.set(0, 0, 0);
        
        // Create orange bounding box outline for avatar (initially hidden)
        createAvatarOutline();
        
        // Set up animation mixer for avatar
        animationMixer = new THREE.AnimationMixer(avatarModel);
        console.log('[AR] AnimationMixer created for avatar');
        
        // Check if avatar has embedded animations
        if (gltf.animations && gltf.animations.length > 0) {
          console.log('[AR] Avatar has', gltf.animations.length, 'embedded animations');
          gltf.animations.forEach((anim, i) => {
            console.log(`  [${i}]: ${anim.name || 'Unnamed'} (${anim.duration.toFixed(2)}s)`);
          });
        } else {
          console.log('[AR] No embedded animations - will load external animations');
        }
        
        // Position avatar based on placement mode
        if (avatarPlaced || !hitTestSource) {
          // No hit-test available - place in front of user
          avatarModel.position.set(0, 0, -1.5);
          scene.add(avatarModel);
          console.log('Avatar placed in fallback position');
        } else {
          // Hit-test available - avatar will be placed on tap
          // Don't add to scene yet, wait for user tap
          console.log('Avatar ready - waiting for placement tap');
        }
        
        console.log('Avatar loaded successfully');
        if (avatarPlaced || !hitTestSource) {
          showToast('3D Avatar loaded!');
        }
        
        // Load idle and speaking animations
        loadIdleAnimation();
        loadSpeakingAnimation();
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
  
  // Store references to meshes with mouthOpen blend shape for audio-reactive animation
  storeMouthMeshes(gltf);
}

// Store references to meshes with mouthOpen blend shape
function storeMouthMeshes(gltf) {
  mouthMeshes = []; // Clear previous references
  
  gltf.scene.traverse((child) => {
    if (child.morphTargetDictionary && child.morphTargetInfluences) {
      const mouthOpenIndex = child.morphTargetDictionary['mouthOpen'];
      
      if (mouthOpenIndex !== undefined) {
        mouthMeshes.push({
          mesh: child,
          morphIndex: mouthOpenIndex
        });
        console.log(`[AR] 👄 Found mouthOpen blend shape in "${child.name}" at index ${mouthOpenIndex}`);
      }
    }
  });
  
  if (mouthMeshes.length > 0) {
    console.log(`[AR] ✓ Audio-reactive mouth movement ready (${mouthMeshes.length} meshes)`);
  } else {
    console.warn('[AR] ⚠️ No mouthOpen blend shapes found - mouth animation disabled');
  }
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

/* ---------------- Animation Functions ---------------- */

// Update audio-reactive mouth animation based on audio volume
function updateMouthAnimation() {
  // Only update if we have mouth meshes and audio analyser
  if (mouthMeshes.length === 0 || !audioAnalyser) {
    return;
  }
  
  // Get audio volume data
  const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
  audioAnalyser.getByteFrequencyData(dataArray);
  
  // Calculate average volume (0-255 range)
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  const avgVolume = sum / dataArray.length;
  
  // Normalize to 0-1 range and apply threshold
  // Volume below 10 is considered silence
  const volumeThreshold = 10;
  let targetMouthValue = 0;
  
  if (avgVolume > volumeThreshold) {
    // Map volume (10-255) to mouth open (0-1)
    // We'll use a smaller range (0-0.6) for more natural looking mouth
    targetMouthValue = Math.min((avgVolume - volumeThreshold) / 100, 0.6);
  }
  
  // Apply smoothing to avoid jitter
  currentMouthValue += (targetMouthValue - currentMouthValue) * MOUTH_SMOOTHING;
  
  // Apply to all meshes with mouthOpen blend shape
  mouthMeshes.forEach(({ mesh, morphIndex }) => {
    mesh.morphTargetInfluences[morphIndex] = currentMouthValue;
  });
  
  // Debug log every 2 seconds (120 frames at 60fps)
  if (frameRenderCount % 120 === 0 && currentMouthValue > 0.01) {
    console.log(`[AR] 🎤 Audio volume: ${avgVolume.toFixed(1)} → Mouth open: ${(currentMouthValue * 100).toFixed(1)}%`);
  }
}

// Audio detection state
let audioContext = null;
let audioAnalyser = null;
let audioSource = null; // MediaElementSource - can only be created once per element
let isSpeaking = false;
let audioCheckInterval = null;

// Initialize audio level detection for remote participant
export function initAudioDetection() {
  if (!state.remoteAudioEl) {
    console.warn('[AR] No remote audio element to analyze');
    return;
  }
  
  try {
    // Create or reuse AudioContext
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('[AR] Created new AudioContext');
    } else if (audioContext.state === 'suspended') {
      audioContext.resume();
      console.log('[AR] Resumed existing AudioContext');
    }
    
    // Create or reuse analyser
    if (!audioAnalyser) {
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 256;
      console.log('[AR] Created new AnalyserNode');
    }
    
    // Create MediaElementSource only once (Web Audio API constraint)
    if (!audioSource) {
      audioSource = audioContext.createMediaElementSource(state.remoteAudioEl);
      audioSource.connect(audioAnalyser);
      audioAnalyser.connect(audioContext.destination);
      console.log('[AR] Created MediaElementAudioSourceNode');
    } else {
      console.log('[AR] Reusing existing MediaElementAudioSourceNode');
    }
    
    console.log('[AR] Audio detection initialized');
    
    // Start checking audio levels periodically
    startAudioMonitoring();
  } catch (err) {
    console.error('[AR] Failed to initialize audio detection:', err);
  }
}

// Monitor audio levels and update isSpeaking state
function startAudioMonitoring() {
  if (audioCheckInterval) return;
  
  const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
  const SPEAKING_THRESHOLD = 30; // Adjust based on testing
  const CHECK_INTERVAL = 100; // Check every 100ms
  
  audioCheckInterval = setInterval(() => {
    if (!audioAnalyser) {
      stopAudioMonitoring();
      return;
    }
    
    audioAnalyser.getByteFrequencyData(dataArray);
    
    // Calculate average audio level
    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    
    const wasSpeaking = isSpeaking;
    isSpeaking = average > SPEAKING_THRESHOLD;
    
    // Log state changes for debugging
    if (isSpeaking !== wasSpeaking) {
      console.log('[AR] Speaking state changed:', isSpeaking, '(level:', average.toFixed(1), ')');
      handleSpeakingChange(isSpeaking);
    }
  }, CHECK_INTERVAL);
}

// Stop audio monitoring
function stopAudioMonitoring() {
  if (audioCheckInterval) {
    clearInterval(audioCheckInterval);
    audioCheckInterval = null;
  }
  isSpeaking = false;
}

// Handle speaking state change - blend animations
function handleSpeakingChange(speaking) {
  if (!animationMixer || !idleAction) return;
  
  if (speaking && speakingAction) {
    // Fade from idle to speaking
    idleAction.fadeOut(0.3);
    speakingAction.reset().fadeIn(0.3).play();
  } else if (!speaking && idleAction) {
    // Fade from speaking back to idle
    if (speakingAction) {
      speakingAction.fadeOut(0.3);
    }
    idleAction.reset().fadeIn(0.3).play();
  }
}

// Load idle/breathing animation for avatar
async function loadIdleAnimation() {
  if (!animationMixer || !avatarModel) {
    console.warn('[AR] Cannot load idle animation - mixer or model not ready');
    return;
  }
  
  // Use a reliable Mixamo idle animation
  // Alternative URLs if primary fails
  const animationURLs = [
    'https://models.readyplayer.me/animations/idle.glb',
    'https://cdn.jsdelivr.net/gh/readyplayerme/animation-library@main/Breathing_Idle.glb'
  ];
  
  let currentURLIndex = 0;
  
  const tryLoadAnimation = () => {
    if (currentURLIndex >= animationURLs.length) {
      console.error('[AR] ❌ ALL IDLE ANIMATION URLs FAILED - Avatar will be static');
      showToast('⚠️ Animation loading failed');
      return;
    }
    
    const url = animationURLs[currentURLIndex];
    console.log('[AR] 🎬 Loading idle animation from URL #' + (currentURLIndex + 1) + ':', url);
    
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        console.log('[AR] ✓ Idle animation file loaded, checking for animations...');
        console.log('[AR] - Animations found:', gltf.animations?.length || 0);
        
        if (gltf.animations && gltf.animations.length > 0) {
          const idleClip = gltf.animations[0];
          console.log('[AR] - Animation name:', idleClip.name || 'Unnamed');
          console.log('[AR] - Animation duration:', idleClip.duration.toFixed(2) + 's');
          
          idleAction = animationMixer.clipAction(idleClip);
          idleAction.setLoop(THREE.LoopRepeat);
          idleAction.clampWhenFinished = false;
          idleAction.weight = 1.0;
          idleAction.play();
          
          console.log('[AR] ✅ IDLE ANIMATION PLAYING!');
          showToast('✨ Idle animation active');
        } else {
          console.warn('[AR] ⚠️ No animations in file, trying next URL...');
          currentURLIndex++;
          tryLoadAnimation();
        }
      },
      (progress) => {
        const percent = Math.round((progress.loaded / progress.total) * 100);
        if (percent === 50 || percent === 100) {
          console.log('[AR] 📥 Idle animation loading:', percent + '%');
        }
      },
      (error) => {
        console.error('[AR] ❌ Failed to load from URL #' + (currentURLIndex + 1));
        console.error('[AR] Error:', error.message || error);
        currentURLIndex++;
        console.log('[AR] Trying next URL...');
        tryLoadAnimation();
      }
    );
  };
  
  tryLoadAnimation();
}

// Load speaking/gesturing animation for avatar
async function loadSpeakingAnimation() {
  if (!animationMixer || !avatarModel) {
    console.warn('[AR] Cannot load speaking animation - mixer or model not ready');
    return;
  }
  
  // Use reliable Mixamo talking animations
  const animationURLs = [
    'https://models.readyplayer.me/animations/male-talking.glb',
    'https://cdn.jsdelivr.net/gh/readyplayerme/animation-library@main/Male_Talking.glb'
  ];
  
  let currentURLIndex = 0;
  
  const tryLoadAnimation = () => {
    if (currentURLIndex >= animationURLs.length) {
      console.warn('[AR] ⚠️ All speaking animation URLs failed - using idle only');
      return;
    }
    
    const url = animationURLs[currentURLIndex];
    console.log('[AR] 🎬 Loading speaking animation from URL #' + (currentURLIndex + 1) + ':', url);
    
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        console.log('[AR] ✓ Speaking animation file loaded, checking for animations...');
        console.log('[AR] - Animations found:', gltf.animations?.length || 0);
        
        if (gltf.animations && gltf.animations.length > 0) {
          const speakingClip = gltf.animations[0];
          console.log('[AR] - Animation name:', speakingClip.name || 'Unnamed');
          console.log('[AR] - Animation duration:', speakingClip.duration.toFixed(2) + 's');
          
          speakingAction = animationMixer.clipAction(speakingClip);
          speakingAction.setLoop(THREE.LoopRepeat);
          speakingAction.clampWhenFinished = false;
          speakingAction.weight = 1.0;
          // Don't play yet - only when speaking detected
          
          console.log('[AR] ✅ SPEAKING ANIMATION LOADED (will play when audio detected)');
        } else {
          console.warn('[AR] ⚠️ No animations in file, trying next URL...');
          currentURLIndex++;
          tryLoadAnimation();
        }
      },
      undefined,
      (error) => {
        console.error('[AR] ❌ Failed to load from URL #' + (currentURLIndex + 1));
        console.error('[AR] Error:', error.message || error);
        currentURLIndex++;
        console.log('[AR] Trying next URL...');
        tryLoadAnimation();
      }
    );
  };
  
  tryLoadAnimation();
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
  
  // If already active and adding fingers, handle transition in touchmove
  if (touchState.active) {
    e.preventDefault();
    
    // Adding a second finger - setup for pinch
    if (touchState.touches.length === 2) {
      const t1 = touchState.touches[0];
      const t2 = touchState.touches[1];
      touchState.dragStart = null;
      touchState.avatarStartPos = null;
      touchState.initialDistance = getTouchDistance(t1, t2);
      touchState.initialScale = avatarModel.scale.x;
    }
    return;
  }
  
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
    touchState.initialDistance = 0;
    touchState.initialScale = 0;
  } else if (touchState.touches.length === 2) {
    // Two finger pinch setup
    const t1 = touchState.touches[0];
    const t2 = touchState.touches[1];
    touchState.dragStart = null;
    touchState.avatarStartPos = null;
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
    // All fingers lifted - completely reset state for next gesture
    touchState.active = false;
    touchState.dragStart = null;
    touchState.avatarStartPos = null;
    touchState.initialDistance = 0;
    touchState.initialScale = 0; // Reset scale for next pinch
    
    if (avatarOutline) {
      avatarOutline.visible = false;
    }
  } else if (touchState.touches.length === 1) {
    // Went from two fingers to one - reset for single-finger drag
    const touch = touchState.touches[0];
    touchState.dragStart = { x: touch.clientX, y: touch.clientY };
    touchState.avatarStartPos = avatarModel ? avatarModel.position.clone() : null;
    touchState.initialDistance = 0;
    touchState.initialScale = 0; // Clear scale state
  } else if (touchState.touches.length === 2) {
    // Went from one finger to two - reset for two-finger pinch
    const t1 = touchState.touches[0];
    const t2 = touchState.touches[1];
    touchState.dragStart = null;
    touchState.avatarStartPos = null;
    touchState.initialDistance = getTouchDistance(t1, t2);
    touchState.initialScale = avatarModel ? avatarModel.scale.x : 1;
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
  // Unregister camera toggle callback
  setOnCameraToggleCallback(null);
  
  // Restore camera only if AR entry turned it off AND user didn't manually toggle it
  if (arToggledCameraOff && !state.camOn) {
    toggleCam(); // Turn camera back on (updates UI and track)
  }
  arToggledCameraOff = false;
  
  // Detach touch handlers before cleanup
  detachTouchHandlers();
  
  // Clean up hit-test resources
  if (hitTestSource) {
    hitTestSource.cancel();
    hitTestSource = null;
  }
  
  // Clean up reticle
  if (reticle) {
    if (reticle.parent) scene.remove(reticle);
    if (reticle.geometry) reticle.geometry.dispose();
    if (reticle.material) reticle.material.dispose();
    reticle = null;
  }
  
  // Reset placement state
  avatarPlaced = false;
  
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
  
  // Clean up audio detection
  stopAudioMonitoring();
  // Note: We keep audioContext, audioAnalyser, and audioSource alive for reuse
  // They will be reused on next AR entry to avoid Web Audio API constraint
  // (MediaElementSource can only be created once per element)
  isSpeaking = false;
  
  // Clean up animation system
  if (idleAction) {
    idleAction.stop();
    idleAction = null;
  }
  if (speakingAction) {
    speakingAction.stop();
    speakingAction = null;
  }
  if (animationMixer) {
    animationMixer.stopAllAction();
    animationMixer = null;
  }
  if (clock) {
    clock = null;
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
  xrSession = refSpace = viewerSpace = null;
  raycaster = touchPointer = null;
  gltfLoader = null;
  frameRenderCount = 0;
}

// Export setup function for event listeners
export function setupARControls() {
  if (holoBtn) holoBtn.addEventListener('click', startHoloMode);
  if (arClose) arClose.addEventListener('click', endHoloMode);
}
