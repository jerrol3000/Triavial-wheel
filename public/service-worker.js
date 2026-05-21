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
// v34: ARENA v3 — bar raised. Real game-shaped depth + cinema moments.
//
// CASCADE v3
//   • PERFECT TIER: catch an orb in the top 12% of the arena = +5
//     (double the normal high-tier reward) + 18-particle burst + bonus
//     combo. The reflex skill ceiling is now a real thing.
//   • MEGA ORB ◈: once per round, spawns when score crosses 18.
//     Twice the size, +25 if caught — single biggest moment per match.
//     Earthquake screen-shake, bass drop, ×5 combo celebration, PB-style
//     confetti shower at the impact point.
//   • AMBIENT GLINTS: 24 small drift particles in the background give
//     the empty arena texture even before orbs land.
//
// ANOMALY v3
//   • CORE STACKING: missed cores accumulate. coreStack 1→2→3→4+ scores
//     +3→+6→+10→+15. Stacked cores tint gold then pink and pulse faster.
//     The temptation to "wait for the stack" creates real risk/reward.
//   • CONTAINMENT SUCCESS CINEMATIC: at score 25 (cap), once-per-round,
//     stage-wide ShockwaveFilter ripple + 500ms chromatic-aberration
//     flash + bass_drop + win confetti + all ambient particles converge
//     toward the center at 8× speed. The biggest "I won't believe this
//     is a browser" moment.
//
// SURGE v3
//   • DROP every 16th beat: full-screen white flash (35% alpha) + extra
//     screen-shake + bass_drop sample + all active particles velocity-
//     boost outward. Players time their tap on the drop for the max
//     drama clip.
//   • COMBO GATES with cumulative visual escalation:
//       ×3 → particles linger longer + center glow brightens
//       ×5 → glow even brighter
//       ×8 → LIGHTNING ARCS jagged across the screen at random,
//            10-segment polyline with random horizontal jitter,
//            spawns every 180-380ms while ×8 is held.
//
// TRIGGER v2
//   • Fully Pixi-rendered with bloom + glow.
//   • Three discrete state panels (STANDBY/ARMED/FIRE) along the top,
//     active one pulses; status text + ms readout in monospace.
//   • Scrolling scan-line during STANDBY makes the wait feel mechanical.
//   • Core flare on FIRE — bursts radially the instant the signal hits.
//   • Haptic FIRE pulse + bass_kick SFX.
// v35: ARENA PIVOT — STRIPPED TO 3 + NEON STRIKE ARENA FPS LAUNCHED.
//
// What's gone (removed from the registry; source files retained for
// future reactivation):
//   Surge · Trigger · Spectrum · Recall · Vector · Intercept ·
//   Outlier · Sequence · Cipher · Tide
//
// What's in:
//   ✦ Anomaly       — Pixi WebGL energy-field containment + plasma shader
//   ◇ Cascade       — Matter.js physics orb catcher + MEGA + chain orbs
//   ◈ Neon Strike   — NEW. Full 3D first-person shooter (90s vs 3 AI bots)
//
// Neon Strike Arena (src/minigames/neon-strike/):
//   • Engine.js          three.js scene + camera + renderer + main loop
//   • Arena.js           procedural neon arena, AABB colliders, phase wall
//   • PlayerController   kinematic FPS controller (WASD + jump + slide
//                        + air-dash + wall-run + combo movement)
//   • Weapon.js          hit-scan plasma rifle + recoil + Mk evolution
//   • Bot.js             3 personalities (AGGRO/SNIPER/FLANKER), state
//                        machine, line-of-sight, accuracy modeling
//   • EnergyShift.js     dimensional phase mechanic — pass through walls,
//                        immune to bullets, drains energy 35/sec
//   • Announcer.js       Web Speech API contextual commentator (FIRST
//                        BLOOD, DOUBLE KILL, RAMPAGE, etc.)
//   • ParticlePool.js    200-particle pre-allocated pool for impacts
//   • NeonStrikeArena    React wrapper + HUD overlay
//
// Bundle: 1.5MB → 2.0MB (three.js core ~600kb). Still within PWA
// norms; lazy code-split available if needed later.
// v36: Neon Strike — Phase 1 polish complete.
//   P1-1  Hit markers (animated X reticle) + floating damage numbers
//         (project world point to screen, drift up + fade, gold on
//         kill, pink on headshot).
//   P1-2  Per-weapon recoil pattern (6-step plasma curve, settles
//         over ~250ms when not firing, scaled by Mk level).
//   P1-3  Mobile virtual joystick + look-pad + FIRE/JUMP/DASH/Q
//         action buttons (auto-hidden on desktop).
//   P1-4  ESC pause menu — resume/settings/quit. Timer freezes,
//         pointer unlocks, speech synth pauses + resumes.
//   P1-5  Settings panel (mouse sensitivity, FOV 60-110, master
//         volume, announcer toggle, perf preset). Persists via
//         localStorage. Applies live to engine on change.
//   P1-6  Minimap (top-left, 140px square) — static arena plan
//         drawn once, dynamic player triangle + bot dots at ~10Hz.
//         Phase walls drawn pink, spawn rings circled.
//   P1-7  TAB-hold scoreboard with K/D/score/best-streak per
//         player + bot, color-coded by personality.
//   P1-8  Custom ShaderMaterial on phase walls — animated scanlines
//         + value-noise data stream + Fresnel rim glow. uShifted
//         uniform smoothly eases between solid (0.85 alpha) and
//         phased (translucent data weave) states during Energy
//         Shift activation.
// v37: hotfix — Neon Strike "see nothing" bug.
//
// Root cause: the previous flyctl deploy reused a cached Docker layer
// and never rebuilt server/minigames.js, so the live server's
// MINI_GAMES registry was the OLD 12-game version without neon_strike.
// When the client posted {game_type:"neon_strike"} to /api/solo/play,
// the server's `MINI_GAMES[rawType] ? rawType : random` fallback
// returned a random OTHER game type — quick_math / catch_bug / etc.
// The client then tried to render the returned type via the new
// 3-game GAMES registry, which doesn't have those IDs, and the
// MiniGameRunner's fallback fired (auto-submit 0, blank screen).
//
// Fix: redeployed with `flyctl deploy --no-cache`. Live registry now
// returns neon_strike on request.
//
// Also added: diagnostic engine-error overlay. If Engine construction
// fails for any reason (WebGL unsupported, asset error, runtime
// throw) the player now sees a clear "ENGINE FAILED TO LOAD" message
// with the error text and a Skip button — instead of a silent blank
// canvas.
//
// v44: SWITCHED WEAPON TO 2D SVG OVERLAY (away from WebGL viewmodel).
//
// After multiple iterations failed to reliably make the three.js
// camera-child viewmodel render on every browser / device (mobile
// FIRE button covering it, FOV clipping, bundler resolution issues,
// production-only WebGL quirks), we punted to a DOM-only solution:
//
//   • The weapon is now a stylized SVG sprite rendered as a React
//     component (`WeaponOverlay`) at the bottom-center of the HUD.
//     DOM-only — no WebGL rendering pipeline involved.
//   • Each of the 7 weapons has its own SVG silhouette: rifle,
//     SMG, shotgun, sniper-with-scope, railgun-with-coils,
//     launcher-with-muzzle, pistol. Per-weapon color palette +
//     accent gradient.
//   • Animations: subtle idle bob, recoil kick on each shot,
//     muzzle-flash circle that pulses at the barrel tip on fire,
//     reload spin (full 360°).
//   • The 3D viewmodel still exists in the WebGL scene but is now
//     supplemental — the SVG is the primary visibility guarantee.
//
// This is what "casual web FPS" games actually do for the same
// reason: getting a three.js camera-child to render reliably
// across every device + browser + bundler config is fragile, but
// DOM/SVG just works.
//
// v43: PRODUCTION BUNDLE FIX — buildViewmodel module extraction.
//
// Player kept reporting "still no weapon on live version" despite
// the local dev preview showing the gun rendering correctly. Root
// cause was a bundler-resolution issue specific to the production
// build:
//
//   6 of 7 weapons had `import { buildViewmodel } from "./PlasmaRifle.js"`
//   at the BOTTOM of the file. While ES module imports are technically
//   hoisted, the combination of:
//     • PlasmaRifle.js exporting `buildViewmodel` AFTER its default
//       class export
//     • Webpack production mode with tree-shaking + terser
//     • Module evaluation order with 6 cross-references
//   resulted in `buildViewmodel` being `undefined` at viewmodel
//   construction time in the minified bundle. Dev mode resolved it
//   fine; production stripped or reordered the export.
//
// Fix: extracted `buildViewmodel` to its own module
// `viewmodelBuilder.js`. Each weapon imports it cleanly at the top.
// No circular-looking reference patterns, no late exports.
//
// v42: ARENA VISIBILITY + WEAPON HAND + LARGER VIEWMODEL.
//
// Player feedback after v41: "still no weapon and the environment is
// not very eye friendly. there is no floor or ceiling i can see the
// weapon cross air but no weapon or who holding the weapon".
//
// Confirmed via local pixel-sampling that the weapon WAS rendering
// (verified body color + trim color present at expected pixels) but
// (a) was too small to dominate the player's attention, (b) had no
// visible hand/forearm so it didn't read as "held", and (c) the
// arena was painted so dark (floor 0x070a18, walls 0x0b1024) that
// the world felt like infinite void with no floor or ceiling.
//
// Fixes:
//   • Floor lifted from 0x070a18 → 0x1a2050 (visible mid-tone navy)
//     with bright grid lines (0x5a7adf primary, 0x2030a0 secondary)
//   • Ceiling added — a plane at y=6 + bright accent grid so the
//     arena reads as an enclosed space
//   • Walls + cover blocks brightened ~3x (0x0b1024 → 0x202a5a)
//   • Fog density halved (0.022 → 0.010) so back walls are visible
//   • Scene background lifted to 0x0c1030 (deep navy not pure black)
//   • All 7 viewmodels now include a HAND GRIP (cyber-glove) +
//     FOREARM with accent stripe so the gun reads as held by a
//     first-person character, not floating in space
//   • Viewmodels right-sized — small enough to leave the arena
//     visible above + around the gun
//
// v41: VIEWMODEL VISIBILITY — ROOT CAUSE FIXED.
//
// Player kept reporting "I don't see the weapon" through v37–v40
// despite multiple position / size / color tweaks. Deep dive via
// pixel-sampling the WebGLRenderer drawing buffer revealed the gun
// WAS rendering all along — but at NDC x≈0.60 (lower-right), which
// is EXACTLY where the mobile FIRE button (92px, right=24 bottom=100)
// sits on touchscreen devices. The button completely covered the
// viewmodel.
//
// Diagnostic methodology: read pixel colors directly out of the
// renderer's drawing buffer at the projected body coords. Trim color
// (193,167,229) and body color (44,29,134) were present at the
// expected pixels — visible to the GL framebuffer but obscured by
// DOM overlays in the rendered page.
//
// Fix: all 7 viewmodels now anchor at x=0.0 (dead center horizontally)
// instead of x=0.16-0.34. The gun renders BETWEEN the joystick
// (bottom-left) and the FIRE button (bottom-right). The 2D HUD
// weapon panel sits below the gun for redundant visibility.
//
// Also: the 2D weapon panel landed in v41 as a primary visibility
// guarantee — large icon + weapon name + ammo bar + alt-fire label
// rendered as DOM (always visible regardless of GL state).
//
// v38: Neon Strike — Phases 2 + 3 land. Three game modes (Arena,
// Aim training, Survive waves) live behind a pre-match picker, with
// a difficulty selector (Easy / Normal / Hard). Wave mode escalates
// each round and drops an OVERLORD boss every 5th wave (shield phase
// + AOE telegraph). Seven distinct weapons live behind an abstract
// Weapon base class + registry — PlasmaRifle, Pulse-SMG, Pulse-12
// Shotgun, Quantum Sniper, Railgun, Gravity Launcher, Smart Pistol —
// each with primary + alt-fire + 5-tier evolution. Weapon pickups
// spawn around the arena (visible bobbing capsules) and equipping
// resets evolution to the new weapon's own level. HUD now shows
// the current weapon name + icon + alt-fire label and surfaces wave
// progress / "WAVE COMPLETE" banners during Survive mode. Bot AOE
// + damage scale with difficulty (×0.7 easy, ×1.3 hard).
//
// v39: VISIBILITY OVERHAUL. Player feedback: "i dont see the weapon,
// i dont see who is shooting, i dont know what is going on." Fixed:
//   • Viewmodels are now ~60% bigger with bright neon trim strips
//     and accent-colored barrel tips that pop against the dark
//     scene (was: tiny dark-navy boxes barely visible).
//   • Every weapon shot now spawns a muzzle flash at the barrel tip
//     (auto-fired by Weapon.fire() so all 7 weapons inherit it).
//   • Bots now fire VISIBLE TRACER LINES from their muzzle to the
//     target (player) or stray point — was previously just a 3-px
//     particle burst. You can now SEE who is shooting at you and
//     from where.
//   • Bots get a muzzle-flash sphere + body-band white-flash when
//     they fire, so a bot mid-shot is unmistakable in the scene.
//   • Directional damage indicator: a red arc-arrow on the HUD
//     points toward the bot that last hit you, fading over 1.2s.
//     No more "where did that shot come from."
//   • Onboarding tooltip: brief overlay during the first 5 seconds
//     of every match explains LEFT-CLICK / RIGHT-CLICK / R / Q
//     and the pickup mechanic.
//   • Mid-match weapon swap now resets the engine's Mk-level mirror
//     to the new weapon's own level (no insta-Mk-4 from carry-over).
//
// v40: VIEWMODEL VISIBILITY hotfix. Player still couldn't see the
// weapon in v39. Three causes identified + fixed:
//
//   • Anchor offset was x=0.32 — at any FOV below ~70° the gun fell
//     OUTSIDE the right edge of the frustum. Pulled all 7 viewmodels
//     in to x=0.16 (more central) and z=-0.42 to -0.62 (closer +
//     larger apparent size). Guaranteed in-frustum at FOV ≥ 60°.
//   • A persisted FOV setting could be set below 60°, clipping the
//     weapon regardless. applySettingsToEngine() now clamps FOV to
//     [60, 110] before applying.
//   • Camera-to-scene attachment was happening implicitly inside the
//     first weapon's _attachViewmodel(). Moved that to the Engine
//     constructor explicitly, BEFORE any weapon is built, so the
//     viewmodel is guaranteed to be inside the scene tree.
//
// Additional polish: body colors are now 2-3× brighter, every weapon
// has a neon wireframe (EdgesGeometry) outline so the silhouette
// pops against the dark scene even when the body fill blends, and a
// new bright muzzle ring sits at the barrel tip.
const CACHE = "trivia-wheel-v44";
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
