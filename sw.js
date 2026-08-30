const APP_VERSION = '1.0.4';
const CACHE_NAME = `money-tracker-${APP_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.webmanifest',
  './version.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  // Intentionally wait for the user to press "עדכן".
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('money-tracker-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(event.request, {cache:'no-store'}).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.action === 'skipWaiting') self.skipWaiting();

  if (event.data?.action === 'getVersion') {
    event.source?.postMessage({action:'version', version:APP_VERSION});
  }
});
