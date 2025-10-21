// HoloCall Service Worker - Handles push notifications

self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(clients.claim());
});

// Handle push notifications
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  let data = {};
  
  try {
    data = event.data.json();
  } catch (e) {
    console.error('Error parsing push data:', e);
    data = {
      title: 'HoloCall',
      body: 'New notification',
      icon: '/icon.png'
    };
  }
  
  const options = {
    body: data.body || 'Someone is calling you',
    icon: data.icon || '/icon.png',
    badge: '/icon.png',
    tag: data.tag || 'holocall-notification',
    requireInteraction: true,
    data: {
      url: data.url || '/',
      roomId: data.roomId,
      callerId: data.callerId,
      callerName: data.callerName,
      declineToken: data.declineToken // Pass through secure token for background decline
    },
    actions: [
      { action: 'accept', title: 'Accept' },
      { action: 'decline', title: 'Decline' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Incoming Call', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const action = event.action;
  const notificationData = event.notification.data;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If user clicked Accept
      if (action === 'accept' && notificationData.roomId) {
        const url = `/?room=${notificationData.roomId}`;
        
        // Check if a window is already open
        for (let client of clientList) {
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            client.postMessage({
              type: 'ACCEPT_CALL',
              roomId: notificationData.roomId,
              callerId: notificationData.callerId,
              callerName: notificationData.callerName
            });
            return client.focus().then(() => client.navigate(url));
          }
        }
        
        // No window open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      } else if (action === 'decline' && notificationData.callerId) {
        // Send decline message to any open windows
        let hasOpenClient = false;
        for (let client of clientList) {
          if (client.url.includes(self.registration.scope)) {
            client.postMessage({
              type: 'DECLINE_CALL',
              callerId: notificationData.callerId,
              roomId: notificationData.roomId
            });
            hasOpenClient = true;
          }
        }
        
        // If no open clients, send decline via fetch with secure token
        if (!hasOpenClient && notificationData.declineToken) {
          return fetch('/api/push/decline-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callerId: notificationData.callerId,
              roomId: notificationData.roomId,
              token: notificationData.declineToken
            })
          }).catch(err => console.error('Failed to send decline from service worker:', err));
        }
      } else {
        // Default click (no action button) - open the app
        const url = notificationData.url || '/';
        
        for (let client of clientList) {
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            return client.focus().then(() => {
              if (notificationData.roomId) {
                return client.navigate(`/?room=${notificationData.roomId}`);
              }
            });
          }
        }
        
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      }
    })
  );
});
