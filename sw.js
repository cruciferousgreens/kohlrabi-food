// sw.js — service worker. Cache-first for the app shell + vendored decoder,
// so the scanner keeps working offline after first load. Bump on releases.
const CACHE = 'kfood-v1';
const SHELL = [
  './',
  './index.html',
  './prototype/index.html',
  './css/style.css',
  './js/app.js',
  './js/prototype.js',
  './js/scanner.js',
  './js/fake-api.js',
  './js/store.js',
  './vendor/zxing/es/reader/index.js',
  './vendor/zxing/es/share.js',
  './vendor/zxing/es/bindings/exposedReaderBindings.js',
  './vendor/zxing/zxing_reader.wasm',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // API calls go to network
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
