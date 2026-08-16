// Service worker — offline cache for the whole games collection.
//
// RELEASING AN UPDATE: bump the version in CACHE below, commit, push.
// Phones re-fetch this file whenever the app is opened online; a changed
// version triggers a background download of everything in PRECACHE, and the
// menu page shows an "Update ready" banner to switch over.
const CACHE = 'games-v10';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './wakelock.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './24game/',
  './3xo/',
  './9menmorris/',
  './backgammon/',
  './blokus/',
  './boggle/',
  './boggle/settings.html',
  './boggle/classic.html',
  './boggle/tv.html',
  './boggle/solo.html',
  './boggle/daily.html',
  './boggle/multi.html',
  './boggle/style.css',
  './boggle/core.js',
  './boggle/words.js',
  './boggle/firebase-config.js',
  './character-sheet/',
  './chess/',
  './crafting-puzzle/',
  './cribbage/',
  './dots-and-boxes/',
  './go/',
  './hex/',
  './mancala/',
  './quoridor/',
  './reversi/',
  './rules/',
  './scattergories/',
  './scattergories/settings.html',
  './scattergories/tabletop.html',
  './scattergories/tv.html',
  './scattergories/daily.html',
  './scattergories/style.css',
  './scattergories/core.js',
  './scattergories/categories.js',
  './scattergories/firebase-config.js',
  './settlers/',
  './sudoku/',
];

self.addEventListener('install', (e) => {
  // Fetch every page fresh from the network: a version-stamped query plus
  // no-store bypasses the browser's HTTP cache, which could otherwise serve
  // stale copies (GitHub Pages uses max-age=600) into the new app cache.
  e.waitUntil(caches.open(CACHE).then((c) =>
    Promise.all(PRECACHE.map(async (u) => {
      const resp = await fetch(u + '?swv=' + encodeURIComponent(CACHE), { cache: 'no-store' });
      if (!resp.ok) throw new Error('precache failed: ' + u);
      await c.put(u, resp); // stored under the clean URL; match uses ignoreSearch
    }))
  ));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data.type === 'GET_VERSION' && e.ports[0]) e.ports[0].postMessage(CACHE);
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        // Runtime-cache same-origin files and the Google Fonts assets the menu
        // uses (opaque cross-origin responses are fine to store).
        const cacheable = resp.ok || resp.type === 'opaque';
        const wanted = url.origin === location.origin ||
          url.hostname.endsWith('fonts.googleapis.com') ||
          url.hostname.endsWith('fonts.gstatic.com') ||
          url.hostname === 'www.gstatic.com'; // Firebase SDK for Boggle
        if (cacheable && wanted) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => {
        // Offline navigation to something we never cached: fall back to the menu
        if (e.request.mode === 'navigate') return caches.match('./');
      });
    })
  );
});
