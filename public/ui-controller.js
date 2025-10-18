// UI Controller - Handles UI state and DOM updates

const $ = (id) => document.getElementById(id);
const setDisabled = (id, val) => { const el = $(id); if (el) el.disabled = val; };
const log = (m) => { console.log(m); const L=$('log'); if(L){ L.textContent += m + '\n'; L.scrollTop=L.scrollHeight; } };

export const state = { 
  room: null, 
  localTracks: [], 
  micOn: true, 
  camOn: true, 
  livekitUrl: null, 
  remoteAudioEl: null, 
  joined: false, 
  user: null,
  videoQuality: 720
};

export const icon = { 
  mute: $('muteIconBtn'), 
  cam: $('cameraIconBtn'), 
  leave: $('leaveIconBtn') 
};

export const holoBtn = $('holoBtn');
export const arClose = $('arClose');

/* ---------------- auth check ---------------- */
export async function checkAuth() {
  try {
    const r = await fetch('/api/auth/user', { credentials: 'include' });
    if (!r.ok) {
      window.location.href = '/login.html';
      return false;
    }
    const data = await r.json();
    state.user = data.user;
    updateUserUI();
    return true;
  } catch (err) {
    window.location.href = '/login.html';
    return false;
  }
}

function updateUserUI() {
  const userInfo = $('userInfo');
  const logoutBtn = $('logoutBtn');
  const qualitySelector = $('qualitySelector');
  
  if (state.user && userInfo) {
    const name = state.user.user_metadata?.full_name || state.user.email?.split('@')[0] || 'User';
    userInfo.textContent = name;
  }
  
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/login.html';
    });
  }
  
  if (qualitySelector) {
    qualitySelector.addEventListener('change', async (e) => {
      const newQuality = parseInt(e.target.value, 10);
      const qualityText = e.target.options[e.target.selectedIndex].text;
      state.videoQuality = newQuality;
      
      // If already in a call, switch quality live
      if (state.joined) {
        try {
          qualitySelector.disabled = true;
          showToast(`Switching to ${qualityText}...`);
          
          // Dynamic import to avoid circular dependency
          const { switchVideoQuality } = await import('./connection-manager.js');
          await switchVideoQuality();
        } finally {
          qualitySelector.disabled = false;
        }
      } else {
        showToast(`Video quality: ${qualityText}`);
      }
    });
  }
}

/* ---------------- video quality ---------------- */
export function getVideoConstraints() {
  const quality = state.videoQuality;
  
  if (quality === 360) {
    return { facingMode: 'user', width: 640, height: 360, frameRate: 24 };
  } else if (quality === 1080) {
    return { facingMode: 'user', width: 1920, height: 1080, frameRate: 30 };
  } else {
    // 720p default
    return { facingMode: 'user', width: 1280, height: 720, frameRate: 30 };
  }
}

/* ---------------- UI helpers ---------------- */
export function showToast(msg) { 
  const t = $('toast'); 
  if (!t) return; 
  t.textContent = msg; 
  t.classList.add('show'); 
  clearTimeout(showToast._t); 
  showToast._t = setTimeout(() => t.classList.remove('show'), 2200); 
}

export function setUIState({joined = state.joined, micOn = state.micOn, camOn = state.camOn} = {}) {
  state.joined = joined; 
  state.micOn = micOn; 
  state.camOn = camOn;
  
  setDisabled('joinBtn', joined); 
  setDisabled('leaveBtn', !joined); 
  setDisabled('muteBtn', !joined); 
  setDisabled('camBtn', !joined);
  
  if (icon.mute) { 
    icon.mute.setAttribute('aria-pressed', String(micOn)); 
    icon.mute.classList.toggle('is-muted', !micOn); 
  }
  if (icon.cam) {  
    icon.cam.setAttribute('aria-pressed', String(camOn));  
    icon.cam.classList.toggle('is-camoff', !camOn); 
  }
}

export function recalcHoloVisibility() { 
  const hasRemote = !!state.room && (state.room.remoteParticipants?.size || 0) > 0; 
  if (holoBtn) holoBtn.hidden = !(state.joined && hasRemote); 
}

/* leave confirm */
const overlay = $('confirmOverlay');
const confirmCancel = $('confirmCancel');
const confirmLeave = $('confirmLeave');

function openConfirm() { 
  if (!state.joined) return; 
  overlay.hidden = false; 
  overlay.classList.add('show'); 
  confirmLeave.focus(); 
  document.addEventListener('keydown', trapEsc, {once: true}); 
  overlay.addEventListener('click', backdropClose); 
}

function closeConfirm() { 
  overlay.classList.remove('show'); 
  overlay.hidden = true; 
  overlay.removeEventListener('click', backdropClose); 
}

function trapEsc(e) { 
  if (e.key === 'Escape') closeConfirm(); 
}

function backdropClose(e) { 
  if (e.target === overlay) closeConfirm(); 
}

export function setupConfirmDialog(onLeaveCallback) {
  confirmCancel.addEventListener('click', closeConfirm);
  confirmLeave.addEventListener('click', () => { 
    closeConfirm(); 
    onLeaveCallback(); 
  });
  
  if (icon.leave) {
    icon.leave.addEventListener('click', () => openConfirm());
  }
}
