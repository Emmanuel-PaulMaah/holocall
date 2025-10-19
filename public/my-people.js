const $ = (id) => document.getElementById(id);

let currentUser = null;
let friends = [];
let currentIndex = 0;
let touchStartX = 0;
let touchEndX = 0;
let isDragging = false;

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
  
  if (diffSeconds < 60) {
    return 'Active just now';
  } else if (diffMinutes < 60) {
    return `Active ${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
  } else if (diffHours < 24) {
    return `Active ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  } else if (diffDays < 7) {
    return `Active ${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  } else {
    return `Active ${Math.floor(diffDays / 7)} ${Math.floor(diffDays / 7) === 1 ? 'week' : 'weeks'} ago`;
  }
}

function createFriendCard(friend, index, total) {
  const card = document.createElement('div');
  card.className = 'friend-card';
  card.dataset.friendId = friend.id;
  card.dataset.index = index;
  
  const isOnline = friend.online_status;
  const statusClass = isOnline ? 'online' : 'offline';
  const statusText = isOnline ? 'Online' : formatRelativeTime(friend.last_seen);
  
  const avatar = friend.profile_picture_url
    ? `<img src="${friend.profile_picture_url}" alt="${friend.username}" class="friend-card-avatar" />`
    : `<div class="friend-card-avatar default">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="50" fill="#1a1a1a"/>
          <circle cx="50" cy="35" r="15" fill="#6d7480"/>
          <path d="M50 55c-12 0-22 8-25 18h50c-3-10-13-18-25-18z" fill="#6d7480"/>
        </svg>
      </div>`;
  
  const bio = friend.bio ? `<p class="friend-card-bio">${friend.bio}</p>` : '';
  
  let tagsHtml = '';
  if (friend.tags && friend.tags.length > 0) {
    const tagsList = friend.tags.slice(0, 5).map(tag => 
      `<span class="friend-tag">${tag}</span>`
    ).join('');
    tagsHtml = `<div class="friend-tags">${tagsList}</div>`;
  }
  
  const callBtnClass = isOnline ? 'call-btn online' : 'call-btn offline';
  const callBtnText = isOnline ? 'Call Now' : 'Share Call Link';
  
  card.innerHTML = `
    ${avatar}
    <div class="friend-card-content">
      <h2 class="friend-card-name">${friend.username}</h2>
      <div class="friend-card-status ${statusClass}">
        <span class="status-dot"></span>
        <span class="status-text">${statusText}</span>
      </div>
      ${bio}
      ${tagsHtml}
    </div>
    <button class="${callBtnClass}" data-friend-id="${friend.id}" data-online="${isOnline}">
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M6.62 10.79a15.05 15.05 0 0 1 10.76 0l1.43.57a1 1 0 0 1 .6.92v3.12a1 1 0 0 1-1.38.93l-3.06-1.22a1 1 0 0 1-.62-.74L5 16.33a1 1 0 0 1-1.38-.93V12.28a1 1 0 0 1 .6-.92l1.43-.57z"/>
      </svg>
      ${callBtnText}
    </button>
  `;
  
  const callBtn = card.querySelector('.call-btn');
  callBtn.addEventListener('click', () => handleCall(friend));
  
  return card;
}

function generateRoomId(friendId) {
  const timestamp = Date.now();
  return `${currentUser.id}_${friendId}_${timestamp}`;
}

async function handleCall(friend) {
  const isOnline = friend.online_status;
  const roomId = generateRoomId(friend.id);
  
  if (isOnline) {
    showToast(`Calling ${friend.username}...`);
    
    setTimeout(() => {
      window.location.href = `/?room=${roomId}`;
    }, 500);
  } else {
    const baseUrl = window.location.origin;
    const callLink = `${baseUrl}/?room=${roomId}`;
    
    try {
      await navigator.clipboard.writeText(callLink);
      showToast(`Call link copied! Share it with ${friend.username}`);
    } catch (err) {
      showToast(`Call link: ${callLink}`);
    }
  }
}

function createCardIndicators(total) {
  const container = document.createElement('div');
  container.className = 'card-indicators';
  
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('span');
    dot.className = i === 0 ? 'indicator-dot active' : 'indicator-dot';
    dot.dataset.index = i;
    dot.addEventListener('click', () => goToCard(i));
    container.appendChild(dot);
  }
  
  return container;
}

function createNavigationControls() {
  const controls = document.createElement('div');
  controls.className = 'card-navigation';
  
  controls.innerHTML = `
    <button class="nav-btn prev-btn" aria-label="Previous friend">
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
      </svg>
    </button>
    <button class="nav-btn next-btn" aria-label="Next friend">
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
      </svg>
    </button>
  `;
  
  const prevBtn = controls.querySelector('.prev-btn');
  const nextBtn = controls.querySelector('.next-btn');
  
  prevBtn.addEventListener('click', () => navigateCard(-1));
  nextBtn.addEventListener('click', () => navigateCard(1));
  
  updateNavigationButtons(prevBtn, nextBtn);
  
  return controls;
}

function updateNavigationButtons(prevBtn = null, nextBtn = null) {
  if (!prevBtn) {
    prevBtn = document.querySelector('.prev-btn');
  }
  if (!nextBtn) {
    nextBtn = document.querySelector('.next-btn');
  }
  
  if (!prevBtn || !nextBtn) return;
  
  prevBtn.disabled = currentIndex === 0;
  nextBtn.disabled = currentIndex === friends.length - 1;
}

function navigateCard(direction) {
  const newIndex = currentIndex + direction;
  
  if (newIndex < 0 || newIndex >= friends.length) {
    return;
  }
  
  goToCard(newIndex);
}

function goToCard(index) {
  if (index < 0 || index >= friends.length) return;
  
  currentIndex = index;
  
  const cardsWrapper = document.querySelector('.cards-wrapper');
  if (cardsWrapper) {
    cardsWrapper.style.transform = `translateX(-${currentIndex * 100}%)`;
  }
  
  const indicators = document.querySelectorAll('.indicator-dot');
  indicators.forEach((dot, i) => {
    dot.classList.toggle('active', i === currentIndex);
  });
  
  updateNavigationButtons();
}

function handleTouchStart(e) {
  touchStartX = e.touches[0].clientX;
  isDragging = true;
}

function handleTouchMove(e) {
  if (!isDragging) return;
  touchEndX = e.touches[0].clientX;
}

function handleTouchEnd() {
  if (!isDragging) return;
  isDragging = false;
  
  const diff = touchStartX - touchEndX;
  const threshold = 50;
  
  if (Math.abs(diff) > threshold) {
    if (diff > 0) {
      navigateCard(1);
    } else {
      navigateCard(-1);
    }
  }
  
  touchStartX = 0;
  touchEndX = 0;
}

function displayFriends() {
  const container = $('cardsContainer');
  
  if (friends.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
        <p>No friends yet</p>
        <small>Add friends to start calling them</small>
        <a href="/find-people.html" class="find-people-link">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          Find People
        </a>
      </div>
    `;
    return;
  }
  
  const cardsWrapper = document.createElement('div');
  cardsWrapper.className = 'cards-wrapper';
  
  friends.forEach((friend, index) => {
    const card = createFriendCard(friend, index, friends.length);
    cardsWrapper.appendChild(card);
  });
  
  const cardsViewport = document.createElement('div');
  cardsViewport.className = 'cards-viewport';
  cardsViewport.appendChild(cardsWrapper);
  
  cardsViewport.addEventListener('touchstart', handleTouchStart, { passive: true });
  cardsViewport.addEventListener('touchmove', handleTouchMove, { passive: true });
  cardsViewport.addEventListener('touchend', handleTouchEnd);
  
  const indicators = createCardIndicators(friends.length);
  const navigation = createNavigationControls();
  
  container.innerHTML = '';
  container.appendChild(cardsViewport);
  container.appendChild(indicators);
  container.appendChild(navigation);
}

async function loadFriends() {
  try {
    const res = await fetch('/api/friends', {
      credentials: 'include'
    });
    
    if (!res.ok) {
      throw new Error('Failed to load friends');
    }
    
    const data = await res.json();
    friends = data.friends || [];
    
    displayFriends();
  } catch (err) {
    console.error('Load friends error:', err);
    showToast('Failed to load friends');
    
    const container = $('cardsContainer');
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
        <p>Failed to load friends</p>
        <small>Please try again later</small>
      </div>
    `;
  }
}

document.addEventListener('keydown', (e) => {
  if (friends.length === 0) return;
  
  if (e.key === 'ArrowLeft') {
    navigateCard(-1);
  } else if (e.key === 'ArrowRight') {
    navigateCard(1);
  }
});

async function init() {
  const user = await checkAuth();
  if (!user) return;
  
  await loadFriends();
}

init();
