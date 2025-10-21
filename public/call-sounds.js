// Call Sound Manager - Handles ringing and buzzing sounds

let audioContext = null;
let currentSound = null;
let ringInterval = null;

// Initialize audio context
function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume audio context if suspended (required for mobile)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

// Initialize audio on user gesture (for mobile support)
export function initAudioForMobile() {
  try {
    const ctx = getAudioContext();
    // Play silent tone to unlock audio on mobile
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    gainNode.gain.value = 0; // Silent
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.01);
  } catch (err) {
    console.warn('Failed to init audio:', err);
  }
}

// Play a tone with specific frequency and duration
function playTone(frequency, duration, volume = 0.3) {
  const ctx = getAudioContext();
  
  // Create oscillator for the tone
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  
  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  
  // Volume envelope (fade in/out)
  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.05);
  gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + duration - 0.05);
  gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
  
  return oscillator;
}

// Play ringing sound (repeating tones for recipient)
export function startRingingSound() {
  console.log('Starting ringing sound...');
  stopAllSounds(); // Stop any existing sounds
  
  const playRing = () => {
    // Two-tone ring: 440Hz and 523Hz (A4 and C5)
    playTone(440, 0.4, 0.2);
    setTimeout(() => playTone(523, 0.4, 0.2), 0.1);
  };
  
  // Play immediately
  playRing();
  
  // Repeat every 2 seconds
  ringInterval = setInterval(playRing, 2000);
  currentSound = 'ringing';
}

// Play buzzing sound (vibrate-like for caller)
export function startBuzzingSound() {
  console.log('Starting buzzing sound...');
  stopAllSounds(); // Stop any existing sounds
  
  const playBuzz = () => {
    // Low frequency buzz: 200Hz
    playTone(200, 0.3, 0.15);
  };
  
  // Play immediately
  playBuzz();
  
  // Repeat every 1.5 seconds
  ringInterval = setInterval(playBuzz, 1500);
  currentSound = 'buzzing';
}

// Stop all sounds
export function stopAllSounds() {
  console.log('Stopping all call sounds...');
  
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  
  currentSound = null;
}

// Check if sound is currently playing
export function isSoundPlaying() {
  return currentSound !== null;
}

// Get current sound type
export function getCurrentSound() {
  return currentSound;
}
