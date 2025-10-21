// Incoming Call Modal Component
// Shows caller info with Accept/Decline buttons

import { sendCallAnswered, sendCallDeclined } from './call-notifications.js';
import { startRingingSound, stopAllSounds } from './call-sounds.js';

let currentCallData = null;
let onAcceptCallback = null;
let onDeclineCallback = null;
let dismissTimeout = null;

const $ = (id) => document.getElementById(id);

// Create modal HTML
export function createIncomingCallModal() {
  const modalHTML = `
    <div id="incomingCallModal" class="call-modal" hidden style="display: none;">
      <div class="call-modal-overlay"></div>
      <div class="call-modal-content">
        <div class="call-modal-header">
          <h3>Incoming Call</h3>
          <button id="closeCallBtn" class="call-close-btn" aria-label="Ignore call">
            <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="call-modal-body">
          <div class="caller-avatar" id="callerAvatar"></div>
          <div class="caller-name" id="callerName"></div>
          <div class="caller-subtitle">wants to video call</div>
        </div>
        <div class="call-modal-actions">
          <button id="declineCallBtn" class="call-btn decline-btn">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"/>
            </svg>
            Decline
          </button>
          <button id="acceptCallBtn" class="call-btn accept-btn">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
            </svg>
            Accept
          </button>
        </div>
        <div class="call-timeout-indicator" id="callTimeoutIndicator"></div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // Attach event listeners
  $('acceptCallBtn').addEventListener('click', handleAcceptCall);
  $('declineCallBtn').addEventListener('click', handleDeclineCall);
  $('closeCallBtn').addEventListener('click', handleCloseCall);
  
  console.log('Incoming call modal created and hidden');
}

// Handle close/ignore call (silent dismiss without notifying caller)
function handleCloseCall() {
  console.log('Close button clicked - ignoring call');
  dismissIncomingCall();
}

// Show incoming call modal
export function showIncomingCall(callData, callbacks = {}) {
  console.log('showIncomingCall called with:', callData);
  
  // Validate call data
  if (!callData || !callData.roomId || !callData.callerName) {
    console.error('Cannot show call modal: invalid call data', callData);
    return;
  }
  
  currentCallData = callData;
  onAcceptCallback = callbacks.onAccept;
  onDeclineCallback = callbacks.onDecline;
  
  const modal = $('incomingCallModal');
  if (!modal) {
    console.error('Incoming call modal element not found');
    return;
  }
  
  const avatar = $('callerAvatar');
  const name = $('callerName');
  
  // Set caller info
  name.textContent = callData.callerName || 'Unknown User';
  
  if (callData.callerPhoto) {
    avatar.style.backgroundImage = `url(${callData.callerPhoto})`;
    avatar.style.backgroundColor = 'transparent';
  } else {
    avatar.style.backgroundImage = 'none';
    avatar.style.backgroundColor = `hsl(${hashString(callData.callerName) % 360}, 70%, 60%)`;
    avatar.textContent = (callData.callerName || 'U')[0].toUpperCase();
  }
  
  // Show modal
  modal.hidden = false;
  modal.style.display = 'flex';
  
  // Start ringing sound for recipient
  startRingingSound();
  
  // Auto-dismiss after 30 seconds
  dismissTimeout = setTimeout(() => {
    // Save callback and data before dismissing (dismiss clears them)
    const callback = onDeclineCallback;
    const data = currentCallData;
    
    dismissIncomingCall();
    
    // Call decline callback after auto-dismiss (using saved reference)
    if (callback && data) {
      callback(data);
    }
  }, 30000);
  
  // Animate timeout indicator
  const indicator = $('callTimeoutIndicator');
  indicator.style.animation = 'none';
  setTimeout(() => {
    indicator.style.animation = 'timeout-progress 30s linear';
  }, 10);
}

// Handle accept call
async function handleAcceptCall() {
  console.log('Accept button clicked, callData:', currentCallData);
  
  if (!currentCallData) {
    console.error('No call data available');
    return;
  }
  
  clearTimeout(dismissTimeout);
  
  // Save callback and data before dismissing (dismiss clears them)
  const callback = onAcceptCallback;
  const data = currentCallData;
  
  try {
    // Send answered notification
    await sendCallAnswered(data.callerId, data.roomId);
    
    dismissIncomingCall();
    
    // Call callback after dismiss (using saved reference)
    if (callback) {
      callback(data);
    }
  } catch (err) {
    console.error('Error accepting call:', err);
  }
}

// Handle decline call
async function handleDeclineCall() {
  console.log('Decline button clicked, callData:', currentCallData);
  
  if (!currentCallData) {
    console.error('No call data available');
    dismissIncomingCall();
    return;
  }
  
  clearTimeout(dismissTimeout);
  
  // Save callback and data before dismissing (dismiss clears them)
  const callback = onDeclineCallback;
  const data = currentCallData;
  
  try {
    // Send declined notification
    await sendCallDeclined(data.callerId, data.roomId);
    
    dismissIncomingCall();
    
    // Call callback after dismiss (using saved reference)
    if (callback) {
      callback(data);
    }
  } catch (err) {
    console.error('Error declining call:', err);
    dismissIncomingCall();
  }
}

// Dismiss modal
function dismissIncomingCall() {
  const modal = $('incomingCallModal');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
  clearTimeout(dismissTimeout);
  
  // Stop ringing sound
  stopAllSounds();
  
  currentCallData = null;
  onAcceptCallback = null;
  onDeclineCallback = null;
  console.log('Incoming call modal dismissed');
}

// Hash string for consistent avatar colors
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}
