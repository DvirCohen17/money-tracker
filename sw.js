const APP_VERSION = '1.0.6';
const CACHE_NAME = `money-tracker-${APP_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.webmanifest',
  './version.json'
];

async function cacheFreshAsset(cache, url) {
  const requestUrl = `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(APP_VERSION)}&t=${Date.now()}`;
  const response = await fetch(requestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Asset ${url} returned ${response.status}`);
  await cache.put(url, response.clone());
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(ASSETS.map((asset) => cacheFreshAsset(cache, asset)));
    })
  );
  // The page decides when to activate the new worker by pressing "עדכן".
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
      fetch(event.request, { cache: 'no-store' }).catch(() => caches.match('./version.json'))
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
    event.source?.postMessage({ action: 'version', version: APP_VERSION });
  }
});
