import { startPresenceTracking, stopPresenceTracking } from './presence-tracker.js';
import { subscribeToCallNotifications } from './call-notifications.js';
import { createIncomingCallModal, showIncomingCall } from './incoming-call-modal.js';

const $ = (id) => document.getElementById(id);

let currentUser = null;
let friendIds = new Set();
let pendingRequestIds = new Set();
let searchTimeout = null;

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

async function loadFriendsAndRequests() {
  try {
    const [friendsRes, requestsRes] = await Promise.all([
      fetch('/api/friends', { credentials: 'include' }),
      fetch('/api/friends/requests', { credentials: 'include' })
    ]);
    
    if (friendsRes.ok) {
      const friendsData = await friendsRes.json();
      friendIds = new Set((friendsData.friends || []).map(f => f.id));
    }
    
    if (requestsRes.ok) {
      const requestsData = await requestsRes.json();
      const requests = requestsData.requests || [];
      pendingRequestIds = new Set(requests.map(r => r.from_user_id));
      
      const badge = document.getElementById('requestsBadge');
      if (badge && requests.length > 0) {
        badge.textContent = requests.length > 99 ? '99+' : requests.length;
        badge.style.display = 'flex';
      }
    }
  } catch (err) {
    console.error('Failed to load friends/requests:', err);
  }
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function createUserCard(user) {
  const card = document.createElement('div');
  card.className = 'user-card';
  
  const isFriend = friendIds.has(user.id);
  const hasPendingRequest = pendingRequestIds.has(user.id);
  
  const avatar = user.profile_picture_url 
    ? `<img src="${user.profile_picture_url}" alt="${user.username}" class="user-avatar" />`
    : `<div class="user-avatar default">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#1a1a1a"/>
          <circle cx="50" cy="35" r="15" fill="#6d7480"/>
          <path d="M50 55c-12 0-22 8-25 18h50c-3-10-13-18-25-18z" fill="#6d7480"/>
        </svg>
      </div>`;
  
  const bio = user.bio ? `<p class="user-bio">${truncateText(user.bio, 100)}</p>` : '';
  
  let buttonHtml;
  if (isFriend) {
    buttonHtml = '<button class="add-friend-btn disabled" disabled>Already Friends</button>';
  } else if (hasPendingRequest) {
    buttonHtml = '<button class="add-friend-btn disabled" disabled>Request Sent</button>';
  } else {
    buttonHtml = `<button class="add-friend-btn" data-user-id="${user.id}">Add Friend</button>`;
  }
  
  card.innerHTML = `
    ${avatar}
    <div class="user-info">
      <h3 class="user-username">${user.username}</h3>
      ${bio}
    </div>
    ${buttonHtml}
  `;
  
  const btn = card.querySelector('.add-friend-btn:not(.disabled)');
  if (btn) {
    btn.addEventListener('click', () => sendFriendRequest(user.id, btn));
  }
  
  return card;
}

async function sendFriendRequest(userId, btn) {
  if (!btn || btn.disabled) return;
  
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Sending...';
  
  try {
    const res = await fetch('/api/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ to_user_id: userId })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      if (data.error === 'already_friends') {
        btn.textContent = 'Already Friends';
        btn.classList.add('disabled');
        showToast('You are already friends with this user');
        friendIds.add(userId);
        return;
      }
      
      if (data.error === 'request_exists') {
        btn.textContent = 'Request Sent';
        btn.classList.add('disabled');
        showToast('Friend request already sent');
        pendingRequestIds.add(userId);
        return;
      }
      
      throw new Error(data.message || 'Failed to send friend request');
    }
    
    btn.textContent = 'Request Sent';
    btn.classList.add('disabled');
    pendingRequestIds.add(userId);
    showToast('Friend request sent!');
  } catch (err) {
    console.error('Send friend request error:', err);
    showToast(err.message || 'Failed to send friend request');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function showLoading() {
  const container = $('resultsContainer');
  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Searching...</p>
    </div>
  `;
}

function showEmptyState() {
  const container = $('resultsContainer');
  container.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <p>Search for people to connect with</p>
      <small>Enter a username to find new friends</small>
    </div>
  `;
}

function showNoResults(query) {
  const container = $('resultsContainer');
  container.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <p>No users found</p>
      <small>No results for "${truncateText(query, 30)}"</small>
    </div>
  `;
}

function displayResults(users) {
  const container = $('resultsContainer');
  
  if (users.length === 0) {
    return;
  }
  
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'users-grid';
  
  users.forEach(user => {
    grid.appendChild(createUserCard(user));
  });
  
  container.appendChild(grid);
}

async function searchUsers(query) {
  if (!query || query.trim().length < 2) {
    showEmptyState();
    return;
  }
  
  const trimmedQuery = query.trim();
  showLoading();
  
  try {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(trimmedQuery)}`, {
      credentials: 'include'
    });
    
    if (!res.ok) {
      throw new Error('Search failed');
    }
    
    const data = await res.json();
    const users = data.users || [];
    
    if (users.length === 0) {
      showNoResults(trimmedQuery);
    } else {
      displayResults(users);
    }
  } catch (err) {
    console.error('Search error:', err);
    showToast('Failed to search users');
    showEmptyState();
  }
}

function debounce(func, delay) {
  return function(...args) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => func.apply(this, args), delay);
  };
}

const debouncedSearch = debounce((query) => {
  searchUsers(query);
}, 300);

$('searchInput').addEventListener('input', (e) => {
  const query = e.target.value;
  if (query.trim().length === 0) {
    clearTimeout(searchTimeout);
    showEmptyState();
  } else {
    debouncedSearch(query);
  }
});

$('searchInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimeout);
    searchUsers(e.target.value);
  }
});

$('searchBtn').addEventListener('click', () => {
  clearTimeout(searchTimeout);
  searchUsers($('searchInput').value);
});

// Handle incoming call
function handleIncomingCall(callData) {
  console.log('Incoming call received on Find People page:', callData);
  
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
  await loadFriendsAndRequests();
  $('searchInput').focus();
  
  // Create incoming call modal
  createIncomingCallModal();
  
  // Subscribe to call notifications
  subscribeToCallNotifications({
    onIncomingCall: handleIncomingCall,
    onCallAnswered: () => {
      showToast('Call connected!');
    },
    onCallDeclined: () => {
      showToast('Call was declined', true);
    }
  });
  
  // Start online presence tracking
  startPresenceTracking();
})();
