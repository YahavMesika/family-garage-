importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyA5iZApm2exIKN71QkT1Raq3fZVVXHq7Tg",
  authDomain: "family-garage-35d86.firebaseapp.com",
  projectId: "family-garage-35d86",
  storageBucket: "family-garage-35d86.firebasestorage.app",
  messagingSenderId: "187401871001",
  appId: "1:187401871001:web:e13c3933dcfe6b4cace208"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage(p => {
  const d = p.data || {};
  return self.registration.showNotification(d.title || 'המוסך המשפחתי', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'he', tag: d.tag || 'garage'
  });
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return clients.openWindow(self.registration.scope);
  }));
});
