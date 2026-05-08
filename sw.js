// Service Worker: App-Shell cachen, API-Requests durchlassen
const CACHE_NAME = 'quexler-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase-API und externe Requests nie cachen
  if (url.hostname !== self.location.hostname) return;

  // Nur GET cachen
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      // Cached Version sofort + Netzwerk im Hintergrund (stale-while-revalidate)
      return cached || networkFetch;
    })
  );
});
