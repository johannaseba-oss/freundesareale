// Service Worker: hält Grafiken/Sprites offline vor. Spielstände laufen NIE über diesen Cache (Supabase = andere Domain).
const CACHE = 'freundesareale-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isArt = /\/(sprites|art)\//.test(url.pathname) || /\.(png|woff2?)$/.test(url.pathname);
  if (isArt) {
    // Grafiken: Cache zuerst
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else {
    // App-Code/Konfiguration: Netzwerk zuerst, offline aus dem Cache
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
  }
});
