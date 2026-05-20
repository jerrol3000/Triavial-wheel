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
// v30: ARENA PREMIUM REDESIGN. All 12 mini-games rebuilt against a
// unified dark-slate, geometric, monospace-data design language.
// No more children's-app emoji fest — every game now reads as a
// premium-casual product (reference: Threes! / Reigns / Mini Metro).
//
// Renamed (server IDs unchanged for back-compat):
//   Tap Race → Surge          Bubble Pop → Cascade
//   Reaction → Trigger        Whack-a-Mole → Intercept
//   Color Match → Spectrum    Catch the Bug → Anomaly
//   Memory → Recall           Memorize → Cipher
//   Quick Math → Vector       Number Rush → Sequence
//   Odd One Out → Outlier     Higher/Lower → Tide
//
// New mechanics on top of the original game loops:
//   Combo multiplier shared across all games (build chains for ×N)
//   Surge: rhythm-pocket scoring (in-tempo taps = +2)
//   Intercept: friend/foe + armored targets (3-tier scoring)
//   Anomaly: every 5 hits spawns a +3 core for 1.5s
//   Cipher: abstract glyph generator (~125 unique glyphs)
//   Outlier: difficulty shifts dimension (color / rotation / scale)
//   Tide: market-ticker visual aesthetic
//
// Shared infrastructure (src/minigames/_style.js):
//   ArenaShell · HUDBar · BigDisplay · StartButton · ParticleBurst
//   · useCombo() hook · per-game accent colors · keyframes
// v31: ARENA GOES WEBGL. Three flagship mini-games now render via
// PixiJS instead of CSS divs — the "made in CSS" ceiling is gone:
//   ✦ Anomaly: custom GLSL plasma fragment shader (concentric noise
//     + ripple + core glow, animated on the GPU)
//   ◇ Cascade: matter.js physics — falling/bouncing orbs with real
//     gravity, restitution, and angular velocity
//   ◉ Surge: audio-reactive Pixi visuals — beat-synced shockwaves
//     emanate from a glowing core, screen-shake on pocket hits,
//     particle bursts on every tap
// New shared infrastructure:
//   - _pixi.js: PixiArena wrapper + PlasmaFilter custom shader +
//     active-canvas registry (so the recorder can grab it without
//     prop drilling)
//   - _fx.js: canvas-confetti presets (celebrate / celebratePB /
//     celebrateWin / celebrateCombo / commiserate) + Howler audio
//     loader with synth fallback
//   - _recorder.js: MediaRecorder + canvas.captureStream → 10-sec
//     gameplay clips, navigator.share / download fallback
//
// New deps in the bundle: pixi.js, canvas-confetti, framer-motion,
// howler, matter-js. Bundle grew from ~810kb to 1.5MB (well within
// PWA norms — Twitter is 2MB, Instagram 3MB).
//
// Confetti wired everywhere: SoloArena PBs trigger gold-forward
// shower, VS match wins fire celebrateWin, friend-challenge wins
// fire same, losses get soft slate commiseration.
//
// Share-clip button: live on SoloArena result after a Pixi-game run.
// MediaRecorder captures the last ~10 seconds of canvas activity at
// 30fps + 2.5Mbps. One tap → Web Share API or download fallback.
// v32: hotfix — SoloArena was missing `useRef` from the React import
// (added in the WebGL pivot for the recorder ref). Crashed on entry
// to the Solo screen with "ReferenceError: useRef is not defined".
// v33: ARENA v2 — actual depth + premium audio + real post-processing.
//
// Three flagship games rebuilt to a much higher quality bar:
//
// ✦ Anomaly v2
//    • Difficulty SCALES: 1 anomaly → 2 (score 10) → 3 (score 20)
//    • AdvancedBloomFilter on the stage + GlowFilter on every body
//    • Chromatic-aberration flash via RGBSplitFilter on every tap,
//      double-strength on core captures
//    • Full-stage SHOCKWAVE on core captures (ShockwaveFilter)
//    • 50 ambient field particles drift in the background, attracted
//      toward the nearest anomaly — sells the "energy field" feel
//    • Haptic feedback (navigator.vibrate) per tap
//
// ◇ Cascade v2
//    • Four ORB TYPES with strategic depth:
//        Normal (75%) → +1/+2/+3 by height + chain to neighbors
//        ★ Gold (8%)  → +5 + golden burst + gold confetti
//        ↯ Chain (5%) → +2 + IGNITES every orb within 90px
//        ✕ Bomb (12%) → AVOID — tapping breaks combo + screen shake
//    • Chain reactions on normal pops too (50px proximity)
//    • Smoke trails on every falling orb
//    • AdvancedBloomFilter on stage, GlowFilter on each orb
//
// ◉ Surge v2
//    • REAL MUSIC LOOP — synthesized 220bpm 4-on-the-floor kick/snare/
//      hat/bass scheduled via Web Audio (see _synth.js startMusic)
//    • LIVE WAVEFORM around the perimeter (64 bars trace the master
//      out's time-domain data — AnalyserNode driven)
//    • BAR-DROP bonus: every 8th beat is worth +3 instead of +2,
//      with screen-wide chromatic aberration + bloom flash
//    • Lightning combo celebration at ×4
//
// New shared infrastructure:
//   _synth.js — multi-osc voice engine, FX chain (filter + reverb),
//               10+ rich SFX presets, music scheduler, AnalyserNode
//               for audio-reactive visuals, navigator.vibrate haptics
//   _pixi.js  — adds AdvancedBloomFilter, GlowFilter, RGBSplitFilter,
//               ShockwaveFilter from pixi-filters. flashChromatic()
//               and shockwave() helpers for one-line effects.
const CACHE = "trivia-wheel-v33";
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
