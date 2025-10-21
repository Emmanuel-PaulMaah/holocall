import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { startPresenceTracking, stopPresenceTracking } from './presence-tracker.js';
import { subscribeToCallNotifications } from './call-notifications.js';
import { createIncomingCallModal, showIncomingCall } from './incoming-call-modal.js';
import { stopAllSounds } from './call-sounds.js';

let supabase;
let currentUser = null;
let uploadedFileUrl = null;

async function initSupabase() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    const config = await r.json();
    
    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error('Supabase credentials not configured');
    }
    
    supabase = createClient(config.supabaseUrl, config.supabaseKey);
    return supabase;
  } catch (err) {
    console.error('Failed to initialize Supabase:', err);
    throw err;
  }
}

const $ = (id) => document.getElementById(id);
const showError = (msg) => {
  const err = $('error');
  if (err) {
    err.textContent = msg;
    err.style.display = 'block';
  }
};
const hideError = () => {
  const err = $('error');
  if (err) err.style.display = 'none';
};

function showToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/user', {
      credentials: 'include'
    });
    
    if (!res.ok) {
      window.location.href = '/login.html';
      return null;
    }
    
    const data = await res.json();
    currentUser = data.user;
    return currentUser;
  } catch (err) {
    console.error('Auth check failed:', err);
    window.location.href = '/login.html';
    return null;
  }
}

async function loadProfile() {
  try {
    const res = await fetch('/api/profile', {
      credentials: 'include'
    });
    
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/login.html';
        return;
      }
      return;
    }
    
    const data = await res.json();
    
    if (data.profile) {
      $('username').value = data.profile.username || '';
      $('bio').value = data.profile.bio || '';
      
      if (data.profile.tags && Array.isArray(data.profile.tags)) {
        $('tags').value = data.profile.tags.join(', ');
      }
      
      if (data.profile.profile_picture_url) {
        uploadedFileUrl = data.profile.profile_picture_url;
        displayPreview(data.profile.profile_picture_url);
      }
      
      $('skipLink').textContent = 'Back to app';
    }
  } catch (err) {
    console.error('Failed to load profile:', err);
  }
}

function displayPreview(url) {
  const preview = $('picturePreview');
  const img = $('pictureImg');
  const svg = preview.querySelector('.default-avatar');
  
  if (svg) svg.style.display = 'none';
  img.src = url;
  img.style.display = 'block';
}

async function uploadProfilePicture(file) {
  if (!file) return null;
  
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('File size must be less than 5MB');
  }
  
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Only JPG, PNG, WebP, and GIF files are allowed');
  }
  
  await initSupabase();
  
  const fileExt = file.name.split('.').pop();
  const fileName = `${currentUser.id}-${Date.now()}.${fileExt}`;
  const filePath = `${fileName}`;
  
  const { data, error } = await supabase.storage
    .from('profile-pictures')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false
    });
  
  if (error) {
    console.error('Upload error:', error);
    throw new Error('Failed to upload image');
  }
  
  const { data: urlData } = supabase.storage
    .from('profile-pictures')
    .getPublicUrl(filePath);
  
  return urlData.publicUrl;
}

$('profilePicture').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  hideError();
  
  try {
    const reader = new FileReader();
    reader.onload = (e) => {
      displayPreview(e.target.result);
    };
    reader.readAsDataURL(file);
    
    showToast('Uploading image...');
    uploadedFileUrl = await uploadProfilePicture(file);
    showToast('Image uploaded successfully!');
  } catch (err) {
    showError(err.message);
    e.target.value = '';
  }
});

$('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  
  const username = $('username').value.trim();
  const bio = $('bio').value.trim();
  const tagsInput = $('tags').value.trim();
  
  if (username.length < 3 || username.length > 30) {
    showError('Username must be 3-30 characters');
    return;
  }
  
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showError('Username can only contain letters, numbers, and underscores');
    return;
  }
  
  const tags = tagsInput
    ? tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0)
    : [];
  
  const btn = $('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  
  try {
    const profileData = {
      username,
      bio,
      tags,
      profile_picture_url: uploadedFileUrl
    };
    
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(profileData)
    });
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      
      if (errData.error === 'username_taken') {
        throw new Error('Username already taken. Please choose another.');
      }
      
      throw new Error(errData.message || 'Failed to save profile');
    }
    
    showToast('Profile saved successfully!');
    setTimeout(() => window.location.href = '/', 800);
  } catch (err) {
    showError(err.message || 'Failed to save profile');
    btn.disabled = false;
    btn.textContent = 'Save Profile';
  }
});

// Handle incoming call
function handleIncomingCall(callData) {
  console.log('Incoming call received on Profile page:', callData);
  
  if (!callData || !callData.roomId || !callData.callerName) {
    console.error('Invalid call data received:', callData);
    return;
  }
  
  showIncomingCall(callData, {
    onAccept: (data) => {
      console.log('Call accepted, navigating to call page:', data.roomId);
      window.location.href = `/?room=${data.roomId}`;
    },
    onDecline: (data) => {
      console.log('Call declined');
      showToast('Call declined');
    }
  });
}

(async () => {
  await checkAuth();
  await loadProfile();
  
  // Create incoming call modal
  createIncomingCallModal();
  
  // Subscribe to call notifications
  subscribeToCallNotifications({
    onIncomingCall: handleIncomingCall,
    onCallAnswered: (data) => {
      stopAllSounds();
      // Navigate to the room when call is accepted
      if (data && data.roomId) {
        window.location.href = `/?room=${data.roomId}`;
      }
    },
    onCallDeclined: () => {
      stopAllSounds();
      showToast('Call was declined', true);
    }
  });
  
  // Start online presence tracking
  startPresenceTracking();
})();
