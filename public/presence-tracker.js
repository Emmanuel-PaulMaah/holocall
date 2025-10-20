// Online Presence Tracker
// Automatically tracks user online status with heartbeat

let heartbeatInterval = null;
let isTracking = false;

// Start tracking presence
export async function startPresenceTracking() {
  if (isTracking) return;
  
  console.log('Starting presence tracking...');
  isTracking = true;
  
  // Set online immediately
  await updateOnlineStatus(true);
  
  // Send heartbeat every 30 seconds
  heartbeatInterval = setInterval(async () => {
    await updateOnlineStatus(true);
  }, 30000);
  
  // Set offline when page is closing
  window.addEventListener('beforeunload', handlePageUnload);
  window.addEventListener('pagehide', handlePageUnload);
  
  // Handle visibility changes (tab switching)
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

// Stop tracking presence
export function stopPresenceTracking() {
  if (!isTracking) return;
  
  console.log('Stopping presence tracking...');
  isTracking = false;
  
  // Send offline status via beacon (synchronous and reliable during unload)
  const blob = new Blob([JSON.stringify({ online: false })], { type: 'application/json' });
  navigator.sendBeacon('/api/profile/status', blob);
  
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  window.removeEventListener('beforeunload', handlePageUnload);
  window.removeEventListener('pagehide', handlePageUnload);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

// Update online status on server
async function updateOnlineStatus(online) {
  try {
    await fetch('/api/profile/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ online })
    });
  } catch (err) {
    console.error('Failed to update online status:', err);
  }
}

// Handle page unload
function handlePageUnload() {
  // Use sendBeacon for reliable offline status update
  const blob = new Blob([JSON.stringify({ online: false })], { type: 'application/json' });
  navigator.sendBeacon('/api/profile/status', blob);
}

// Handle visibility changes
function handleVisibilityChange() {
  if (document.hidden) {
    // Tab is hidden - still online but update last_seen
    updateOnlineStatus(true);
  } else {
    // Tab is visible - ensure we're online
    updateOnlineStatus(true);
  }
}
