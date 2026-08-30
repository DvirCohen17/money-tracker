const CACHE_NAME = 'money-tracker-v1.0.1'; // כשתוציא גרסה חדשה בעתיד, שנה את המספר פה ל-v1.0.2

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js'
];

// התקנה ושמירת הקבצים ב-Cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// מחיקת גרסאות ישנות מה-Cache בעת שינוי גרסה
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// הגשת קבצים מה-Cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});

// האזנה להודעת רענון מ-script.js
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
