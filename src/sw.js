/*
 * The service worker: what lets the game open with no connection, and shows notifications.
 * Plain JavaScript, not bundled with the game: build.mjs copies it to dist/sw.js, putting the build's own
 * version where __VERSION__ is, so every new build replaces the saved copy. The website serves it; a page
 * opened as a file has none (main.ts registers it only on the website).
 *
 * - The game page: from the network when there is one, so an update shows at once; the copy saved last time
 *   when there is not (or the network takes more than 4 seconds). Local play then works offline.
 * - The font and the icons: kept once fetched, and used from the copy.
 * - /api/ (online rooms, notifications) is never touched: it needs the network.
 * - A notification (push): the server's message (locked for this phone; the browser opens it) says who
 *   wants to play and in which room. Tapping it opens the game at that room's join panel.
 */
const VERSION = '__VERSION__';
const CACHE = `bomberbot-${VERSION}`;
// The font is kept apart and outlives updates: it never changes with the game, and an update that threw it
// away would leave the next visit without it until it had been fetched again (offline: not at all).
const FONTS = 'bomberbot-fonts';
const SHELL = ['/', '/manifest.webmanifest', '/icon-180.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bomberbot-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** The network, giving up after `ms`. */
function fetchWithin(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('slow')), ms);
    fetch(req).then(
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // rooms and notifications: network only

  // the game page itself (any address of it, ?room=CODE included): network first, the saved copy without one
  if (req.mode === 'navigate') {
    event.respondWith(
      fetchWithin(req, 4000)
        .then((r) => {
          if (r.ok && url.origin === location.origin) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return r;
        })
        .catch(() =>
          caches
            .open(CACHE)
            .then((c) => c.match('/'))
            .then((r) => r || caches.match('/'))
            .then((r) => r || Response.error()),
        ),
    );
    return;
  }

  // the font (Google's) and the game's own files: the saved copy if there is one, else fetch and save it
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!font && url.origin !== location.origin) return;
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((r) => {
          if (r.ok || r.type === 'opaque') {
            const copy = r.clone();
            caches.open(font ? FONTS : CACHE).then((c) => c.put(req, copy));
          }
          return r;
        }),
    ),
  );
});

// ---------------------------------------------------------------- notifications

self.addEventListener('push', (event) => {
  let n = null;
  try {
    n = event.data ? event.data.json() : null;
  } catch {
    n = null;
  }
  event.waitUntil(
    self.registration.showNotification(n && n.title ? n.title : 'BomberBot', {
      body: n && n.body ? n.body : 'A friend wants to play.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: n && n.code ? `room-${n.code}` : 'bomberbot',
      data: { url: n && n.url ? n.url : '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
