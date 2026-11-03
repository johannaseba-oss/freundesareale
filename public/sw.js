// Service Worker: hält Grafiken/Sprites offline vor. Spielstände laufen NIE über diesen Cache (Supabase = andere Domain).
const CACHE = 'freundesareale-v2'; // alte Caches werden beim Aktivieren gelöscht
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isArt = /\/(sprites|art)\//.test(url.pathname) || /\.(png|woff2?)$/.test(url.pathname);
  if (isArt) {
    // Grafiken: sofort aus dem Cache, im Hintergrund aktualisieren, damit neue Bilder ankommen
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
      if (hit) { net.catch(() => {}); return hit; }
      return net;
    }));
  } else {
    // App-Code/Konfiguration: Netzwerk zuerst, offline aus dem Cache
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
  }
});
