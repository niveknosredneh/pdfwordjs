const CACHE_NAME = 'kwpdf-v0.94';
const LOCAL_ASSETS = [
    './index.html',
    './index.js',
    './style.css',
    './keywords.json',
    './manifest.json',
    './icons/favicon.ico',
    './icons/folder.svg',
    './icons/pdf.svg',
    './icons/docx.svg',
    './icons/zip.svg',
    './icons/github.svg',
    './utils/keywords.js',
    './utils/keyword_regex.js',
    './utils/file_handler.js',
    './utils/docx_engine.js',
    './utils/pdf_search.js',
    './utils/pdf_renderer.js',
    './utils/pdf_loader.js',
    './utils/state_handler.js',
    './utils/ui.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Caching local assets');
            return Promise.all(
                LOCAL_ASSETS.map(url =>
                    cache.add(url).catch(err => {
                        console.warn('[SW] Failed to cache:', url, err);
                    })
                )
            );
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(
                names.map(name => {
                    if (name !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    }
                })
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                // Serve from cache, update in background
                fetch(event.request).then(response => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, copy);
                        });
                    }
                }).catch(() => {});
                return cached;
            }

            return fetch(event.request).then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, copy);
                    });
                }
                return response;
            }).catch(() => {
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
