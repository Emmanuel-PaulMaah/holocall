const $ = (id) => document.getElementById(id);

let currentUser = null;

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

function formatRelativeTime(timestamp) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  
  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  } else if (diffWeeks < 4) {
    return `${diffWeeks} ${diffWeeks === 1 ? 'week' : 'weeks'} ago`;
  } else {
    return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;
  }
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function createRequestCard(request) {
  const card = document.createElement('div');
  card.className = 'request-card';
  card.dataset.requestId = request.id;
  
  const profile = request.profiles;
  const username = profile?.username || 'Unknown User';
  const bio = profile?.bio || '';
  const profilePicture = profile?.profile_picture_url;
  
  const avatar = profilePicture
    ? `<img src="${profilePicture}" alt="${username}" class="request-avatar" />`
    : `<div class="request-avatar default">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#1a1a1a"/>
          <circle cx="50" cy="35" r="15" fill="#6d7480"/>
          <path d="M50 55c-12 0-22 8-25 18h50c-3-10-13-18-25-18z" fill="#6d7480"/>
        </svg>
      </div>`;
  
  const bioHtml = bio ? `<p class="request-bio">${truncateText(bio, 120)}</p>` : '';
  const timeAgo = formatRelativeTime(request.created_at);
  
  card.innerHTML = `
    ${avatar}
    <div class="request-info">
      <h3 class="request-username">${username}</h3>
      ${bioHtml}
      <p class="request-time">${timeAgo}</p>
    </div>
    <div class="request-actions">
      <button class="accept-btn" data-request-id="${request.id}">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        Accept
      </button>
      <button class="reject-btn" data-request-id="${request.id}">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
        Reject
      </button>
    </div>
  `;
  
  const acceptBtn = card.querySelector('.accept-btn');
  const rejectBtn = card.querySelector('.reject-btn');
  
  acceptBtn.addEventListener('click', () => handleAccept(request.id, card));
  rejectBtn.addEventListener('click', () => handleReject(request.id, card));
  
  return card;
}

async function handleAccept(requestId, card) {
  const acceptBtn = card.querySelector('.accept-btn');
  const rejectBtn = card.querySelector('.reject-btn');
  
  if (acceptBtn.disabled) return;
  
  acceptBtn.disabled = true;
  rejectBtn.disabled = true;
  acceptBtn.textContent = 'Accepting...';
  
  card.style.opacity = '0.5';
  card.style.pointerEvents = 'none';
  
  try {
    const res = await fetch('/api/friends/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ request_id: requestId })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.message || 'Failed to accept request');
    }
    
    card.style.transition = 'all 0.3s ease';
    card.style.transform = 'translateX(100%)';
    card.style.opacity = '0';
    
    setTimeout(() => {
      card.remove();
      checkIfEmpty();
    }, 300);
    
    showToast('Friend request accepted!');
  } catch (err) {
    console.error('Accept error:', err);
    showToast(err.message || 'Failed to accept request');
    
    card.style.opacity = '1';
    card.style.pointerEvents = 'auto';
    acceptBtn.disabled = false;
    rejectBtn.disabled = false;
    acceptBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
      Accept
    `;
  }
}

async function handleReject(requestId, card) {
  const acceptBtn = card.querySelector('.accept-btn');
  const rejectBtn = card.querySelector('.reject-btn');
  
  if (rejectBtn.disabled) return;
  
  acceptBtn.disabled = true;
  rejectBtn.disabled = true;
  rejectBtn.textContent = 'Rejecting...';
  
  card.style.opacity = '0.5';
  card.style.pointerEvents = 'none';
  
  try {
    const res = await fetch('/api/friends/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ request_id: requestId })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.message || 'Failed to reject request');
    }
    
    card.style.transition = 'all 0.3s ease';
    card.style.transform = 'translateX(-100%)';
    card.style.opacity = '0';
    
    setTimeout(() => {
      card.remove();
      checkIfEmpty();
    }, 300);
    
    showToast('Friend request rejected');
  } catch (err) {
    console.error('Reject error:', err);
    showToast(err.message || 'Failed to reject request');
    
    card.style.opacity = '1';
    card.style.pointerEvents = 'auto';
    acceptBtn.disabled = false;
    rejectBtn.disabled = false;
    rejectBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
      Reject
    `;
  }
}

function checkIfEmpty() {
  const container = $('requestsContainer');
  const cards = container.querySelectorAll('.request-card');
  
  if (cards.length === 0) {
    showEmptyState();
  }
}

function showLoading() {
  const container = $('requestsContainer');
  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading requests...</p>
    </div>
  `;
}

function showEmptyState() {
  const container = $('requestsContainer');
  container.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
      </svg>
      <p>No pending requests</p>
      <small>You don't have any friend requests at the moment</small>
    </div>
  `;
}

function displayRequests(requests) {
  const container = $('requestsContainer');
  
  if (requests.length === 0) {
    showEmptyState();
    return;
  }
  
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'requests-list';
  
  requests.forEach(request => {
    list.appendChild(createRequestCard(request));
  });
  
  container.appendChild(list);
}

async function loadRequests() {
  showLoading();
  
  try {
    const res = await fetch('/api/friends/requests', {
      credentials: 'include'
    });
    
    if (!res.ok) {
      throw new Error('Failed to load requests');
    }
    
    const data = await res.json();
    const requests = data.requests || [];
    
    displayRequests(requests);
  } catch (err) {
    console.error('Load requests error:', err);
    showToast('Failed to load friend requests');
    showEmptyState();
  }
}

(async () => {
  await checkAuth();
  await loadRequests();
})();
