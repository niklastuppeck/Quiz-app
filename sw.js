const CACHE_NAME = 'quiz-app-v2';

// HTML immer frisch vom Netzwerk holen, alles andere cachen
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Externe URLs (Supabase, CDN, Ads) nicht anfassen
  if (url.origin !== self.location.origin) return;

  // HTML: immer vom Netzwerk, kein Cache
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Alles andere: Cache first, dann Netzwerk
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});

// Alte Caches beim Update löschen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});
