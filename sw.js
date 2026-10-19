// Service worker: simpan app shell untuk buka laju & offline. Data Google Sheet sentiasa dari network.
const CACHE = 'kliki-dash-shell-v9';
const SHELL = ['./', 'index.html', 'styles.css?v=9', 'js/config.js?v=9', 'js/data.js?v=9', 'js/app.js?v=9', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo-white.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google Sheet & font: terus ke network
  // network dulu supaya update GitHub terus nampak, fallback cache bila offline
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
