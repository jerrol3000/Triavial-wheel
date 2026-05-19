// Minimal offline-first cache for shell assets.
// Cache name is versioned — bump it to force-evict old caches on the next deploy.
// v20: Home tile icons bumped — hero 56 → 84 px, secondary 44 → 68
// px — with negative margins on the wrapper so the tiles
// themselves stay the same size. Bigger glyphs, identical boxes.
const CACHE = "trivia-wheel-v20";
const SHELL = ["/", "/manifest.json", "/logo-no-background.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Bypass anything we shouldn't touch.
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // Navigation requests (top-level page loads, including /admin and SPA routes)
  // go straight to the network. Lets the server / dev-server's history fallback
  // decide what HTML to serve, and avoids cache-miss → undefined Response bugs.
  if (req.mode === "navigate") return;

  // JS/CSS bundles are NETWORK-FIRST. Webpack hashes filenames per build
  // so a new bundle has a new URL — but a stale SW serving the OLD URL
  // from cache would freeze the client on whatever code shipped last
  // time. Network-first guarantees the user always pulls the live bundle
  // (with cache as offline fallback). This is the key defense against
  // "I deployed a fix but my browser keeps running the old code".
  const pn = url.pathname;
  const isCodeAsset = pn.endsWith(".js") || pn.endsWith(".css") || pn.endsWith(".map");
  if (isCodeAsset) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || Response.error()))
    );
    return;
  }

  // Everything else (images, fonts, manifest) stays cache-first with a
  // background network update.
  e.respondWith(
    caches.match(req).then((cached) => {
      const fromNetwork = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || fromNetwork;
    }).catch(() => Response.error())
  );
});
