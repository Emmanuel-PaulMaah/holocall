// Push Notification Manager - Handles web push notifications

let swRegistration = null;
let isSubscribed = false;

// Convert VAPID public key from base64 to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Check if browser supports push notifications
function checkBrowserSupport() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Workers not supported');
    return false;
  }
  if (!('PushManager' in window)) {
    console.warn('Push API not supported');
    return false;
  }
  if (!('Notification' in window)) {
    console.warn('Notifications not supported');
    return false;
  }
  return true;
}

// Register service worker
export async function registerServiceWorker() {
  if (!checkBrowserSupport()) {
    return null;
  }
  
  try {
    swRegistration = await navigator.serviceWorker.register('/service-worker.js');
    console.log('Service Worker registered:', swRegistration);
    
    // Listen for messages from service worker
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    
    return swRegistration;
  } catch (err) {
    console.error('Service Worker registration failed:', err);
    return null;
  }
}

// Handle messages from service worker
function handleServiceWorkerMessage(event) {
  const data = event.data;
  
  if (data.type === 'ACCEPT_CALL') {
    console.log('User accepted call from notification:', data);
    // The navigation is handled by service worker
  } else if (data.type === 'DECLINE_CALL') {
    console.log('User declined call from notification:', data);
    // Send decline notification to server
    sendDeclineNotification(data.callerId, data.roomId);
  }
}

// Request notification permission
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    return 'denied';
  }
  
  const permission = await Notification.requestPermission();
  console.log('Notification permission:', permission);
  return permission;
}

// Subscribe to push notifications
export async function subscribeToPushNotifications() {
  if (!swRegistration) {
    console.error('Service Worker not registered');
    return null;
  }
  
  try {
    // Check if already subscribed
    let subscription = await swRegistration.pushManager.getSubscription();
    
    if (subscription) {
      console.log('Already subscribed to push notifications');
      isSubscribed = true;
      return subscription;
    }
    
    // Get VAPID public key from server
    const configResponse = await fetch('/api/config');
    const config = await configResponse.json();
    
    if (!config.vapidPublicKey) {
      console.error('VAPID public key not configured');
      return null;
    }
    
    // Subscribe to push notifications
    const applicationServerKey = urlBase64ToUint8Array(config.vapidPublicKey);
    
    subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey
    });
    
    console.log('Push subscription created:', subscription);
    isSubscribed = true;
    
    // Send subscription to server
    await sendSubscriptionToServer(subscription);
    
    return subscription;
  } catch (err) {
    console.error('Failed to subscribe to push notifications:', err);
    return null;
  }
}

// Send subscription to server
async function sendSubscriptionToServer(subscription) {
  try {
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(subscription)
    });
    
    if (!response.ok) {
      throw new Error('Failed to save subscription');
    }
    
    console.log('Push subscription saved to server');
  } catch (err) {
    console.error('Error saving subscription:', err);
  }
}

// Send decline notification (called from service worker message)
async function sendDeclineNotification(callerId, roomId) {
  try {
    const { sendCallDeclined } = await import('./call-notifications.js');
    await sendCallDeclined(callerId, roomId);
  } catch (err) {
    console.error('Error sending decline notification:', err);
  }
}

// Initialize push notifications
export async function initPushNotifications() {
  if (!checkBrowserSupport()) {
    console.log('Push notifications not supported in this browser');
    return false;
  }
  
  try {
    // Register service worker
    await registerServiceWorker();
    
    // Request permission
    const permission = await requestNotificationPermission();
    
    if (permission === 'granted') {
      // Subscribe to push
      await subscribeToPushNotifications();
      return true;
    } else {
      console.log('Notification permission denied');
      return false;
    }
  } catch (err) {
    console.error('Error initializing push notifications:', err);
    return false;
  }
}

// Check if subscribed
export function isPushSubscribed() {
  return isSubscribed;
}
