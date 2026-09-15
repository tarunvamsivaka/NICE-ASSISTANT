const CACHE_NAME = 'nice-app-v7';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/favicon.svg',
    '/manifest.json',
];

// Install — cache core shell assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch — cache-first for same-origin assets, network-first for navigation
// Allow privacy-safe API calls to Wikipedia and Open-Meteo (no user data sent)
self.addEventListener('fetch', (event) => {
    // SECURITY: Only handle GET requests
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    // Allow API calls to pass through without caching (privacy-safe endpoints)
    if (url.hostname === 'en.wikipedia.org' || url.hostname === 'api.open-meteo.com') {
        event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
            status: 503, headers: { 'Content-Type': 'application/json' }
        })));
        return;
    }

    if (url.origin !== self.location.origin) return; // Block other cross-origin caching

    // Navigation requests: network-first
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    // Static assets: cache-first for speed
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                // Only cache successful responses
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            });
        }).catch(() => {
            // Offline fallback
            return caches.match('/index.html');
        })
    );
});
