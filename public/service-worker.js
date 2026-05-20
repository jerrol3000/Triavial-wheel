// Minimal offline-first cache for shell assets.
// Cache name is versioned — bump it to force-evict old caches on the next deploy.
// v27: ARENA LAUNCH LINEUP EXPANDED. Mini-game roster grows from 5
// to 12 with 7 new games:
//   🫧 Bubble Pop      — pop bubbles before they vanish
//   🔨 Whack-a-Mole    — 3×3 grid, moles pop up
//   👀 Odd One Out     — spot the slightly different cell
//   1️⃣ Number Rush     — tap 1→12 in order on a scrambled grid
//   🐛 Catch the Bug   — bug teleports every tap
//   👁️ Memorize        — was that emoji in the set?
//   📊 Higher / Lower  — number sprint
// With 12 games picked-5-at-a-time, every match is a different
// combination. Server's pickGames() shuffle is deterministic per
// match seed so VS opponents + friend-duel sides race identical
// content.
// v28: post-bot-playthrough bug fixes
//   1. findRoomForUser ignored finished rooms → quick_match after a
//      loss got stuck for ~20s until continue-vote teardown ran.
//      Now filters out rooms where finished=true so the queue takes
//      effect immediately.
//   2. Memory's per-round duration cut 60s → 25s — an AFK opponent
//      could otherwise hold the match for 5+ min on Memory alone.
//      Serious Memory players naturally fail inside 25s, so no
//      legitimate play is cut short.
//   3. Power Card UI labels updated to Arena names (Spy / Sabotage /
//      Multiplier) — old labels still said "see opponent's pick"
//      which doesn't apply to mini-game rounds. Server IDs kept as
//      sniper/cut/double for back-compat with deployed clients.
// v29: ENGAGEMENT PACK 1.
//   • Solo Arena — play any of the 12 mini-games against your own PB,
//     no opponent needed. Critical fix for the zero-DAU dead-end where
//     VS Arena would "Find an opponent…" forever. New Home tile +
//     /solo/play + /solo/submit endpoints. Coins per run = score/max × 25.
//   • Per-game personal bests — new mini_game_bests table, tracked on
//     every score submit (VS, Friend Challenge, Solo). PB chip "🏆 best
//     N" surfaced on each game's intro. "New personal best!" celebration
//     toast + glow on the result card.
//   • Per-round breakdown card in MatchEnd — game-by-game receipt
//     showing who scored what on each mini-game. The natural marketing
//     screenshot for a mini-game arena.
const CACHE = "trivia-wheel-v29";
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
