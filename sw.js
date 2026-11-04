/* DriveDeck service worker: lets the installed app open without a connection.
   Network first (so updates arrive as soon as you're online), cached copy as fallback.
   Only this app's own files are handled; maps, routing and weather go straight to the network. */
const CACHE = 'drivedeck-v9';
const CORE = [
  './',
  'index.html',
  'drive.css',
  'drive.js',
  'game.js',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
  'vendor/fonts/inter-latin-wght-normal.woff2',
  'vendor/fonts/inter-latin-ext-wght-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isVersionCheck = new URL(req.url).pathname.endsWith('/version.json');
  event.respondWith(
    // "no-cache" revalidates with the server every time, so a new release shows up on the next
    // open instead of waiting out the browser cache.
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok && !isVersionCheck) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined))
        .then((hit) => hit || Response.error())),
  );
});
