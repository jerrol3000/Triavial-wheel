# Neon Strike Arena — Build Roadmap

74 tasks across 11 phases, sequenced so **no task depends on something below it**.
Each phase ends at a stable, shippable point. Execute one task at a time.

> **How to use this file:** Find the next unchecked `[ ]` task, build it, ship
> it, check it off, move to the next. Don't skip ahead — later tasks assume
> earlier ones are done.

---

## Status legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Shipped
- `[!]` Skipped / deferred (explain in notes)

---

## Already shipped (foundation)

The FPS foundation that justifies all the work below:

- [x] three.js + WebGL renderer wired into existing React/Webpack app
- [x] Procedural neon arena with AABB collision
- [x] Pointer-lock first-person controls (WASD + mouse-look)
- [x] Combo movement: jump, slide, air-dash, wall-run, sprint
- [x] Hit-scan plasma rifle with raycaster + recoil + visible tracers
- [x] Weapon Evolution (Mk 1-5, every 3 kills tier-up)
- [x] 3 AI bots with personality state machines (AGGRO / SNIPER / FLANKER)
- [x] Energy Shift dimension-phase mechanic (Q key)
- [x] Web Speech announcer (FIRST BLOOD, RAMPAGE, etc.)
- [x] HUD overlay (health / energy / ammo / score / timer / kill feed)
- [x] Particle pool (200 pre-allocated impact bursts)
- [x] Solo Arena integration (90-sec match vs 3 bots, share-clip ready)

---

## Phase 1 — Foundation polish (8 tasks)

Goal: the solo experience feels **complete** before adding new content.
Stable ship point: a polished single-game FPS you'd be proud to demo.

- [x] **P1-1** Hit markers + floating damage numbers
- [x] **P1-2** Per-weapon recoil patterns (visual recoil curves, not just pitch nudge)
- [x] **P1-3** Mobile touch controls (virtual joystick + fire/jump/dash/Q buttons)
- [x] **P1-4** Pause menu (ESC: resume / settings / quit, pointer unlocks)
- [x] **P1-5** Settings panel (mouse sensitivity, FOV, audio volume, perf preset)
- [x] **P1-6** Minimap (top-down arena view with player + bot positions)
- [x] **P1-7** Scoreboard (TAB-toggle K/D/score table for all combatants)
- [x] **P1-8** Animated stylized fragment shader on phase walls (data-noise pattern)

---

## Phase 2 — Solo depth (6 tasks)

Goal: multiple solo experiences so a player has reasons to keep grinding.
Stable ship point: 4 distinct solo modes (quick match, aim training, wave survival, tournament).

- [x] **P2-1** Adjustable difficulty (Easy / Normal / Hard — bot accuracy / count / RoF)
- [x] **P2-2** Aim training mode (stationary spawn-able targets, score by hits/time)
- [~] **P2-3** Training arena (separate room with target dummies + movement practice) _(folded into P2-2 — Aim mode is the training mode)_
- [x] **P2-4** Wave survival mode (escalating bot waves + intermissions for ammo)
- [x] **P2-5** Boss encounter (large bot with shield + AOE attack at wave 5)
- [ ] **P2-6** Ranked bot tournament (best-of-3 runs with cumulative ranking) _(deferred — overlaps with P5 progression)_

---

## Phase 3 — Weapons (10 tasks)

Goal: combat variety. 7 unique weapons with switching + alt-fire + pickups.
Stable ship point: a real weapon-meta game emerges, every match has loadout decisions.

> Dependency: P3-1 (refactor) **must** ship before any other P3 task.

- [x] **P3-1** Weapon system refactor (abstract base + multi-weapon loadout)
- [x] **P3-2** Railgun (charge + pierce, instant high-damage, slow RoF)
- [x] **P3-3** Energy shotgun (close-range cone, 6 pellets, fast reload)
- [x] **P3-4** Smart pistol (light aim-assist, fast fire, low damage)
- [x] **P3-5** Gravity launcher (projectile that pulls bots toward impact)
- [x] **P3-6** Pulse SMG (full-auto, high RoF, low damage)
- [x] **P3-7** Quantum sniper (scoped, charge-up + dimension-pierce alt-fire)
- [x] **P3-8** Weapon switching (number keys 1-7 + scroll wheel)
- [x] **P3-9** Secondary fire modes per weapon (right-click)
- [x] **P3-10** Weapon pickups on arena floor (spawn timer + animation)

---

## Phase 4 — Maps + Dynamic arenas (9 tasks)

Goal: 5 distinct maps with verticality, hazards, and interactives.
Stable ship point: replay value via map rotation.

> Dependency: P4-1 (map system) **must** ship before any P4-2..6.

- [ ] **P4-1** Map system (data-driven arena builder, swappable definitions)
- [ ] **P4-2** Cyber City map (verticality + rooftops + parkour routes)
- [ ] **P4-3** Orbital Station map (low gravity + floating platforms)
- [ ] **P4-4** Neon Temple map (narrow corridors + ambush angles)
- [ ] **P4-5** Abandoned AI Lab map (interactive consoles + power cores)
- [ ] **P4-6** Gravity Arena map (zones with reversed gravity)
- [ ] **P4-7** Dynamic hazards (collapsing floors, gravity toggles, energy fences)
- [ ] **P4-8** Map interactives (switches that move walls, portals that teleport)
- [ ] **P4-9** Map selection screen

---

## Phase 5 — Persistent progression (7 tasks)

Goal: account-level XP + cosmetics so play has long-term meaning.
Stable ship point: players come back to grind XP toward unlocks.

> Dependency: P5-1 (DB schema) before any other P5 task.

- [ ] **P5-1** DB schema for FPS player stats (kills, deaths, wins, XP, mastery per weapon)
- [ ] **P5-2** XP system + account level (persistent across matches)
- [ ] **P5-3** Achievements engine (kills milestones, headshot %, evolution count)
- [ ] **P5-4** Daily missions (5/day, UTC midnight rotation, coin rewards)
- [ ] **P5-5** Unlockable cosmetics catalog (weapon skins, player skins, trails)
- [ ] **P5-6** Weapon skin equip + render in viewmodel
- [ ] **P5-7** Player emotes (radial menu, voice line + visual)

---

## Phase 6 — Online multiplayer foundations (8 tasks) ⚠️ HARDEST PHASE

Goal: real netcode capable of competitive PvP.
Stable ship point: a player can match against another human and the match feels responsive.

> This is the phase that genuinely makes or breaks the product. Each task
> here is a deep engineering problem. Pace will slow.
>
> Dependency chain is sequential — you cannot do P6-3 without P6-2, etc.

- [ ] **P6-1** WebSocket FPS netcode (60Hz state broadcast + delta encoding)
- [ ] **P6-2** Server-authoritative player position model
- [ ] **P6-3** Client-side prediction (run input locally, reconcile from server)
- [ ] **P6-4** Server reconciliation (rollback on prediction mismatch)
- [ ] **P6-5** Snapshot interpolation for remote players (smooth at variable latency)
- [ ] **P6-6** Lag compensation for hit-scan (rewind targets to shooter's view-time)
- [ ] **P6-7** Anti-cheat baseline (sane-input bounds + speedhack + movement validation)
- [ ] **P6-8** Session reconnect (rejoin match-in-progress after WS drop)

---

## Phase 7 — Online modes (8 tasks)

Goal: matchmaking + the full PvP mode lineup.
Stable ship point: a player has every mode they'd expect from a 2026 web FPS.

- [ ] **P7-1** Quick Match (random pairing matchmaking)
- [ ] **P7-2** Casual mode (no ranked rating impact)
- [ ] **P7-3** Ranked mode (rating + tier badges)
- [ ] **P7-4** Skill-based matchmaking (rating bucket pairing)
- [ ] **P7-5** Private rooms (invite by 6-char code)
- [ ] **P7-6** Spectator mode (watch ongoing match)
- [ ] **P7-7** Global leaderboards (top kills/wins/ranking, per season)
- [ ] **P7-8** Match history (last 20 matches with replay-ready stats)

---

## Phase 8 — Social systems (4 tasks)

Goal: friend / party / clan loops for retention.
Stable ship point: players come back because their friends are online.

- [ ] **P8-1** Friend system FPS integration (invite-to-match from existing friend list)
- [ ] **P8-2** Party matchmaking (2-4 player squads queue together)
- [ ] **P8-3** Clan system (create/join, perks, clan tags above name)
- [ ] **P8-4** Player profile page (stats + badges + season ranking)

---

## Phase 9 — Seasonal economy (4 tasks)

Goal: monetization layer + recurring engagement reset.
Stable ship point: the app has a sustainable economy.

- [ ] **P9-1** Battle pass architecture (seasonal tracks: free + premium tiers)
- [ ] **P9-2** Seasonal rewards calendar (week-by-week unlocks)
- [ ] **P9-3** Ranked end-of-season rewards payout
- [ ] **P9-4** Cosmetic shop integration (use existing coin / Pro store)

---

## Phase 10 — Audio + polish (4 tasks)

Goal: replace synthesized audio + add cinematic polish.
Stable ship point: the game **sounds** like a finished product.

- [ ] **P10-1** Real audio sample library (replace synth SFX with curated CC0 samples)
- [ ] **P10-2** Background music tracks per map
- [ ] **P10-3** Expanded announcer voice line variety
- [ ] **P10-4** Lottie animations for menu transitions + match-end stinger

---

## Phase 11 — Performance (7 tasks)

Goal: final optimization pass against the **full** game (not premature opt).
Stable ship point: 60fps on integrated graphics, sub-3s load on 4G.

> Done LAST — optimize against real content, not stubs.

- [ ] **P11-1** GPU instancing for repeating arena elements
- [ ] **P11-2** Texture atlases for skins + weapons
- [ ] **P11-3** Code-split NSA chunk (lazy-load FPS bundle on demand)
- [ ] **P11-4** Asset compression (gzip/brotli/basis universal where applicable)
- [ ] **P11-5** Projectile + tracer object pools (zero GC during matches)
- [ ] **P11-6** Frustum culling + LOD tuning
- [ ] **P11-7** Performance presets in settings (low/medium/high render quality)

---

## Realistic time budget

| Phase | Effort | Cumulative |
|---|---|---|
| P1 — Polish | ~1 week | 1w |
| P2 — Solo depth | ~1-2 weeks | 2-3w |
| P3 — Weapons | ~2 weeks | 4-5w |
| P4 — Maps | ~2-3 weeks | 6-8w |
| P5 — Progression | ~1 week | 7-9w |
| **P6 — Netcode** ⚠️ | **~3-4 weeks** | **10-13w** |
| P7 — Online modes | ~1-2 weeks | 11-15w |
| P8 — Social | ~1 week | 12-16w |
| P9 — Economy | ~1 week | 13-17w |
| P10 — Audio | ~3-5 days | 14-18w |
| P11 — Perf | ~1 week | 15-19w |

**Total: ~3-4 months of focused dev work** for a senior engineer
with AI pair-programming. P6 (netcode) is the genuine wall — every
task there is a deep engineering problem.

---

## Working notes

Add per-task notes here as you ship them. Example format:

### P1-1 — Hit markers + damage numbers
- **Started:** 2026-05-XX
- **Shipped:** 2026-05-XX (commit `abc1234`)
- **Files touched:** `Engine.js`, `Weapon.js`, `NeonStrikeArena.js`
- **Notes:** Damage numbers float upward 60px over 600ms, fade to 0. Headshots show in gold, body in white. Hit marker is a 4-spoke X that scales 1.4× on hit then snaps back.

---

## Decision log

Notable scope or sequencing changes go here.

- _(none yet)_
