// MAESTRO service worker
// Caches the app shell so saved guides can be read with no connection at all.
const CACHE = "maestro-v1";
const SHELL = [
  "/", "/index.html", "/manifest.json",
  "/icon-192.png", "/icon-512.png", "/icon-180.png", "/favicon.ico",
];

self.addEventListener("install", (e) => {
  // addAll fails the whole install if any single file 404s, so fetch each
  // one independently and keep whatever succeeds.
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never cache the AI endpoints: a stale guide would be worse than an error.
  if (/anthropic\.com|googleapis\.com/.test(url.hostname)) return;

  // Navigations: try the network so updates land, fall back to the cached shell.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Everything else: serve from cache first, refresh in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
