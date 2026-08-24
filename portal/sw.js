/* BirdBox Coaching Portal — service worker
   Strategy: network-first. The network answer always wins when it is
   available, so a commit to GitHub reaches coaches on their next load.
   The cache exists only as a fallback for a dropped connection. */

const VERSION = 'birdbox-portal-v1';
const CACHE = VERSION;

// Only the shell. Deliberately short: if any single URL here 404s,
// the whole install fails and the worker never activates.
const PRECACHE = [
  '/portal/',
  '/icon-192.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never touch anything that changes data or lives elsewhere.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase, Stripe, Resend
  if (!url.pathname.startsWith('/portal/')
      && !url.pathname.startsWith('/icon-')
      && url.pathname !== '/apple-touch-icon.png'
      && url.pathname !== '/manifest.json') return;
  if (url.pathname.startsWith('/api/')) return;      // Netlify functions

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          if (req.mode === 'navigate') {
            return new Response(
              '<!doctype html><meta charset="utf-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<title>Offline</title>' +
              '<body style="font-family:-apple-system,sans-serif;padding:40px;' +
              'text-align:center;color:#1c1f24">' +
              '<h2>No connection</h2>' +
              '<p>The portal needs a connection to load course data. ' +
              'Reconnect and try again.</p></body>',
              { headers: { 'Content-Type': 'text/html' } }
            );
          }
          return Response.error();
        })
      )
  );
});
