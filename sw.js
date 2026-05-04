const CACHE_NAME = 'quiz-app-v3';

// Alles immer frisch vom Netzwerk — Cache nur als Offline-Fallback
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Externe URLs (Supabase, CDN, Ads) nicht anfassen
  if (url.origin !== self.location.origin) return;

  // Network-first für alles: immer aktuelle Version, Cache als Fallback
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
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
