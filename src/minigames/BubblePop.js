import React, { useEffect, useState, useRef } from "react";
import Matter from "matter-js";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import {
  PixiArena, PIXI, hexToRgb,
  AdvancedBloomFilter, GlowFilter,
  flashChromatic,
} from "./_pixi";
import { celebrateCombo } from "./_fx";
import { playSFX, haptic } from "./_synth";

// Cascade v2 — falling orbs with real physics + STRATEGIC variety.
//
// What changed from v1:
//   • POWERUP ORB TYPES (rolled at spawn time):
//       Normal (75%)   → +tier (1/2/3 by Y position), gold body
//       Gold star (8%) → +5 + extra combo + golden particle burst
//       Bomb (12%)     → AVOID. Tapping = -1 combo + screen shake.
//       Chain (5%)     → +2 + triggers a CHAIN REACTION: any orbs
//                        within 80px of the chain orb auto-pop too,
//                        worth +1 each (no combo gating). Rare,
//                        delicious moment.
//   • CHAIN REACTIONS: when a normal orb pops, any other orb within
//     50px pops too with a 50ms delay — feels like clusters explode.
//     Chain pops give +1 each but don't break combo if missed.
//   • SMOKE TRAILS: each falling orb leaves a brief alpha-fading
//     trail of small dots — the air feels charged.
//   • BLOOM + GLOW on the full stage for the "everything alive" feel.
//   • PARTICLES on EVERY pop, scaled by tier.
//   • HAPTIC + SOUND per orb type.
//
// Scoring (still capped at 35 server-side):
//   • Normal orb pop  → +1/+2/+3 by height
//   • Gold pop        → +5
//   • Chain pop       → +2 + ripple
//   • Bomb tap        → 0 + combo break + shake
//   • Floor escape    → combo break

const DURATION_MS = 10000;
const SPAWN_INTERVAL_MS = 380;
const ORB_RADIUS = 26;
const MEGA_RADIUS = 60;
const CHAIN_RANGE = 50;
const MEGA_THRESHOLD = 18; // mega orb spawns once when crossing this score

const KIND_NORMAL = "n";
const KIND_GOLD = "g";
const KIND_BOMB = "b";
const KIND_CHAIN = "c";
const KIND_MEGA = "m";

function rollKind(rng, score) {
  // Bombs more common as score climbs — risk scales with reward.
  const bombChance = Math.min(15, 8 + Math.floor(score / 3));
  const goldChance = 8;
  const chainChance = 5;
  const r = rng.int(100);
  if (r < bombChance) return KIND_BOMB;
  if (r < bombChance + goldChance) return KIND_GOLD;
  if (r < bombChance + goldChance + chainChance) return KIND_CHAIN;
  return KIND_NORMAL;
}

export default function BubblePop({ onComplete, seed }) {
  const accent = accentFor("bubble_pop");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(1400);
  const scoreRef = useRef(0);
  useEffect(() => { scoreRef.current = score; }, [score]);

  const phaseRef = useRef("ready");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const stateRef = useRef({
    engine: null,
    runner: null,
    orbs: [],
    spawnLast: 0,
    arenaH: 360,
    arenaW: 320,
    shake: 0,
    megaSpawned: false,    // single mega per round
    glintLayer: null,      // ambient background glints
    glints: [],            // small decorative drift particles
    appRef: null,          // app handle for spawnMega
    spawnFn: null,         // setter so we can spawn mega imperatively
  });

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    playSFX("whoosh");
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const t = setInterval(() => {
      const left = Math.max(0, DURATION_MS - (Date.now() - startRef.current));
      setRemaining(left);
      if (left <= 0) { clearInterval(t); finish(); }
    }, 50);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("done");
    playSFX("win_stinger");
    onComplete({ score: scoreRef.current });
  };

  const setupPixi = (app) => {
    const state = stateRef.current;
    const W = app.screen.width, H = app.screen.height;
    state.arenaW = W; state.arenaH = H;
    const accentColor = parseInt(accent.hue.slice(1), 16);

    // ── Backdrop ─────────────────────────────────────────────────
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.55);
    bg.drawRect(0, 0, W, H);
    bg.endFill();
    app.stage.addChild(bg);

    // Subtle vertical gradient via a sprite — gives the falling-arena feel.
    const gradCanvas = document.createElement("canvas");
    gradCanvas.width = 8; gradCanvas.height = 256;
    const gctx = gradCanvas.getContext("2d");
    const gg = gctx.createLinearGradient(0, 0, 0, 256);
    gg.addColorStop(0, "rgba(96,165,250,0.18)");
    gg.addColorStop(1, "rgba(15,23,42,0.0)");
    gctx.fillStyle = gg; gctx.fillRect(0, 0, 8, 256);
    const gTex = PIXI.Texture.from(gradCanvas);
    const gradSprite = new PIXI.Sprite(gTex);
    gradSprite.width = W; gradSprite.height = H;
    app.stage.addChild(gradSprite);

    // ── Physics ──────────────────────────────────────────────────
    const engine = Matter.Engine.create({ gravity: { x: 0, y: 0.85 } });
    state.engine = engine;
    const wall = (x, y, w, h) => Matter.Bodies.rectangle(x, y, w, h, { isStatic: true });
    Matter.Composite.add(engine.world, [
      wall(W / 2, H + 30, W + 200, 60),
      wall(-30, H / 2, 60, H * 2),
      wall(W + 30, H / 2, 60, H * 2),
    ]);
    const runner = Matter.Runner.create();
    state.runner = runner;
    Matter.Runner.run(runner, engine);

    // ── Orb layer + trail layer + post-fx ────────────────────────
    const trailLayer = new PIXI.Container();
    const orbLayer = new PIXI.Container();
    const fxLayer = new PIXI.Container();
    app.stage.addChild(trailLayer, orbLayer, fxLayer);

    app.stage.filters = [
      new AdvancedBloomFilter({ threshold: 0.4, bloomScale: 0.7, brightness: 1, blur: 6, quality: 4 }),
    ];

    // ── Ambient glint layer (background) ────────────────────────
    // Small decorative dots drift across the back of the arena —
    // gives the space a sense of life even when no orbs are active.
    const glintLayer = new PIXI.Container();
    app.stage.addChildAt(glintLayer, 2); // behind orbs but above bg
    state.glintLayer = glintLayer;
    for (let i = 0; i < 24; i++) {
      const g = new PIXI.Graphics();
      g.beginFill(accentColor, 0.4);
      g.drawCircle(0, 0, 1 + Math.random());
      g.endFill();
      g.x = Math.random() * W;
      g.y = Math.random() * H;
      glintLayer.addChild(g);
      state.glints.push({
        sprite: g,
        vy: 0.2 + Math.random() * 0.4,
        baseAlpha: 0.2 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
      });
    }

    // ── Orb factory ──────────────────────────────────────────────
    function spawnOrb(forcedKind) {
      const rng = rngRef.current;
      const kind = forcedKind || rollKind(rng, scoreRef.current);
      const radius = kind === KIND_MEGA ? MEGA_RADIUS : ORB_RADIUS;
      const x = radius + 8 + rng.int(Math.max(1, W - (radius + 8) * 2));
      const body = Matter.Bodies.circle(x, -radius, radius, {
        restitution: 0.65,
        friction: 0.04,
        density: kind === KIND_MEGA ? 0.002 : 0.001,
      });
      Matter.Body.setVelocity(body, { x: (rng.int(40) - 20) / 100, y: 0 });
      Matter.Body.setAngularVelocity(body, (rng.int(20) - 10) / 100);
      Matter.Composite.add(engine.world, body);

      // Visual depends on kind.
      const container = new PIXI.Container();
      const color = kind === KIND_GOLD  ? 0xfbbf24
                  : kind === KIND_BOMB  ? 0x475569
                  : kind === KIND_CHAIN ? 0x22d3ee
                  : kind === KIND_MEGA  ? 0xf472b6
                                        : accentColor;
      // Outer halo
      const halo = new PIXI.Graphics();
      halo.beginFill(color, 0.25);
      halo.drawCircle(0, 0, radius + 12);
      halo.endFill();
      container.addChild(halo);
      // Body — hex faceted (octagonal for mega for distinctness)
      const orb = new PIXI.Graphics();
      const sides = kind === KIND_MEGA ? 8 : 6;
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = (Math.PI * 2 / sides) * i;
        pts.push(Math.cos(a) * radius, Math.sin(a) * radius);
      }
      orb.beginFill(color);
      orb.drawPolygon(pts);
      orb.endFill();
      orb.lineStyle(kind === KIND_MEGA ? 2.5 : 1.5, 0xffffff, kind === KIND_MEGA ? 0.7 : 0.55);
      orb.drawPolygon(pts);
      // Inner highlight
      const inner = new PIXI.Graphics();
      inner.beginFill(0xffffff, kind === KIND_MEGA ? 0.4 : 0.3);
      inner.drawCircle(-radius * 0.25, -radius * 0.3, radius * 0.22);
      inner.endFill();
      container.addChild(orb, inner);

      // Symbol overlay for special orbs.
      if (kind !== KIND_NORMAL) {
        const sym = new PIXI.Text(
          kind === KIND_GOLD ? "★" : kind === KIND_BOMB ? "✕" : kind === KIND_CHAIN ? "↯" : "◈",
          {
            fontFamily: "JetBrains Mono, monospace",
            fontSize: kind === KIND_MEGA ? 36 : 18, fontWeight: "900",
            fill: kind === KIND_BOMB ? 0xfb7185 : 0xffffff,
            dropShadow: true, dropShadowColor: 0x000000, dropShadowDistance: 1,
          }
        );
        sym.anchor.set(0.5);
        container.addChild(sym);
      }

      // Glow ring per type for visual telegraph
      container.filters = [new GlowFilter({
        distance: kind === KIND_MEGA ? 18 : 10,
        outerStrength: kind === KIND_BOMB ? 1.0 : kind === KIND_MEGA ? 2.5 : 1.6,
        innerStrength: 0,
        color: color,
        quality: 0.2,
      })];

      container.x = body.position.x;
      container.y = body.position.y;
      container.eventMode = "static";
      container.cursor = "pointer";
      container.hitArea = new PIXI.Circle(0, 0, radius + 4);

      const orbRecord = {
        body, container, kind, radius, born: Date.now(), popped: false,
        trailLastEmit: 0,
      };

      container.on("pointerdown", () => handlePop(orbRecord, false));
      orbLayer.addChild(container);
      state.orbs.push(orbRecord);
    }
    state.spawnFn = spawnOrb;
    state.appRef = app;

    // Pop a single orb. `isChain` = true if this pop was triggered by
    // a chain reaction (no combo break on miss, no combo gating).
    function handlePop(orbRecord, isChain) {
      if (phaseRef.current !== "racing" || orbRecord.popped) return;
      orbRecord.popped = true;
      const { body, container, kind } = orbRecord;

      if (kind === KIND_BOMB && !isChain) {
        // Tapped a bomb (only player can do this; chain reactions skip bombs).
        haptic([30, 50, 30]);
        miss();
        playSFX("combo_break");
        state.shake = 14;
        flashChromatic(app.stage, 220, 14);
        spawnBurst(container.x, container.y, 12, 0xfb7185);
        // Remove the bomb
        Matter.Composite.remove(engine.world, body);
        try { orbLayer.removeChild(container); container.destroy({ children: true }); } catch (e) {}
        state.orbs = state.orbs.filter((o) => o !== orbRecord);
        return;
      }

      // Determine tier by vertical position (only normal orbs use tier).
      let points = 0;
      let burstColor = 0xffffff;
      let burstCount = 8;

      if (kind === KIND_GOLD) {
        points = 5;
        burstColor = 0xfbbf24;
        burstCount = 16;
        if (!isChain) { hit(); playSFX("power_up"); haptic([15, 25, 15]); }
        celebrateCombo(2, { origin: { x: container.x / W, y: container.y / H } });
      } else if (kind === KIND_CHAIN) {
        points = 2;
        burstColor = 0x22d3ee;
        burstCount = 14;
        if (!isChain) { hit(); playSFX("power_up"); haptic([10, 15, 10]); }
        // The defining feature of chain orbs: pop everything in range.
        const nearby = state.orbs.filter((o) =>
          o !== orbRecord && !o.popped && o.kind !== KIND_BOMB &&
          Math.hypot(o.body.position.x - body.position.x, o.body.position.y - body.position.y) <= 90
        );
        nearby.forEach((n, i) => setTimeout(() => handlePop(n, true), 60 + i * 40));
      } else if (kind === KIND_MEGA) {
        // MEGA orb — the rare-event score moment.
        points = 25;
        burstColor = 0xf472b6;
        burstCount = 40;
        if (!isChain) {
          hit(); hit(); // double combo for mega
          playSFX("hit_perfect");
          playSFX("bass_drop");
          haptic([25, 40, 25, 40, 25]);
          // Earthquake shake
          state.shake = 28;
          flashChromatic(app.stage, 320, 16);
          celebrateCombo(5, { origin: { x: container.x / W, y: container.y / H } });
          // Confetti shower
          import("./_fx").then(({ celebratePB }) => celebratePB({ origin: { x: container.x / W, y: container.y / H } }));
        }
      } else {
        // Normal orb — tier by height. "Perfect" = top 12% of arena.
        const y = body.position.y;
        const isPerfect = y < H * 0.12 && !isChain;
        const tier = isPerfect ? 5
                  : y < H * 0.33 ? 3
                  : y < H * 0.66 ? 2
                                 : 1;
        points = tier;
        burstColor = accentColor;
        burstCount = isPerfect ? 18 : 6 + tier * 2;
        if (!isChain) {
          hit();
          if (isPerfect) {
            hit(); // bonus combo on perfect
            playSFX("hit_perfect");
            playSFX("power_up");
            haptic([12, 18, 12]);
          } else {
            playSFX(tier === 3 ? "hit_perfect" : tier === 2 ? "hit_good" : "hit_late");
            haptic(tier === 3 ? 14 : tier === 2 ? 10 : 6);
          }
        }
      }

      setScore((s) => s + points);
      spawnBurst(container.x, container.y, burstCount, burstColor);
      // Adjacent chain reaction on NORMAL orbs (smaller proximity than KIND_CHAIN's blast).
      if (!isChain && kind === KIND_NORMAL) {
        const nearby = state.orbs.filter((o) =>
          o !== orbRecord && !o.popped && o.kind === KIND_NORMAL &&
          Math.hypot(o.body.position.x - body.position.x, o.body.position.y - body.position.y) <= CHAIN_RANGE
        );
        nearby.forEach((n, i) => setTimeout(() => handlePop(n, true), 50 + i * 35));
      }

      // Remove the popped orb
      Matter.Composite.remove(engine.world, body);
      try { orbLayer.removeChild(container); container.destroy({ children: true }); } catch (e) {}
      state.orbs = state.orbs.filter((o) => o !== orbRecord);
    }

    function spawnBurst(x, y, n, color) {
      for (let i = 0; i < n; i++) {
        const dot = new PIXI.Graphics();
        dot.beginFill(color);
        dot.drawCircle(0, 0, 2 + Math.random() * 2);
        dot.endFill();
        dot.x = x; dot.y = y;
        const angle = (Math.PI * 2 * i) / n + Math.random() * 0.3;
        const dist = 35 + Math.random() * 40;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        fxLayer.addChild(dot);
        const start = Date.now();
        const lifespan = 450 + Math.random() * 200;
        const t = () => {
          const p = (Date.now() - start) / lifespan;
          if (p >= 1) { try { fxLayer.removeChild(dot); dot.destroy(); } catch (e) {} app.ticker.remove(t); return; }
          dot.x = x + dx * p;
          dot.y = y + dy * p;
          dot.alpha = 1 - p;
          dot.scale.set(1 - p * 0.6);
        };
        app.ticker.add(t);
      }
    }

    // ── Per-frame ticker ─────────────────────────────────────────
    let frameTime = 0;
    const ticker = (delta) => {
      const now = Date.now();
      frameTime += delta / 60;
      if (phaseRef.current === "racing") {
        const elapsed = now - startRef.current;
        const cadence = Math.max(260, SPAWN_INTERVAL_MS - elapsed / 60);
        if (now - state.spawnLast >= cadence) {
          state.spawnLast = now;
          spawnOrb();
        }
        // MEGA ORB: spawns once when score crosses MEGA_THRESHOLD.
        // High score = mega orb appears as the reward for staying
        // alive. Worth +25 if caught — single biggest moment.
        if (!state.megaSpawned && scoreRef.current >= MEGA_THRESHOLD) {
          state.megaSpawned = true;
          spawnOrb(KIND_MEGA);
        }
      }

      // Update orbs — sync positions, emit trails, cull falls.
      for (let i = state.orbs.length - 1; i >= 0; i--) {
        const orb = state.orbs[i];
        if (orb.popped) continue;
        if (orb.body.position.y > H + 40) {
          // Missed — fell past floor.
          Matter.Composite.remove(engine.world, orb.body);
          try { orbLayer.removeChild(orb.container); orb.container.destroy({ children: true }); } catch (e) {}
          state.orbs.splice(i, 1);
          if (phaseRef.current === "racing" && orb.kind !== KIND_BOMB) miss();
          continue;
        }
        orb.container.x = orb.body.position.x;
        orb.container.y = orb.body.position.y;
        orb.container.rotation = orb.body.angle;
        // Mega orb subtly pulses to telegraph its rarity.
        if (orb.kind === KIND_MEGA) {
          const p = 1 + Math.sin(frameTime * 4) * 0.08;
          orb.container.scale.set(p);
        }
        // Emit a soft smoke trail
        if (now - orb.trailLastEmit > 65) {
          orb.trailLastEmit = now;
          const trail = new PIXI.Graphics();
          const c = orb.kind === KIND_GOLD ? 0xfbbf24
                  : orb.kind === KIND_BOMB ? 0x475569
                  : orb.kind === KIND_CHAIN ? 0x22d3ee
                  : orb.kind === KIND_MEGA ? 0xf472b6
                                            : accentColor;
          trail.beginFill(c, 0.25);
          trail.drawCircle(0, 0, (orb.radius || ORB_RADIUS) * 0.6);
          trail.endFill();
          trail.x = orb.body.position.x;
          trail.y = orb.body.position.y;
          trailLayer.addChild(trail);
          const start = Date.now();
          const t = () => {
            const p = (Date.now() - start) / 350;
            if (p >= 1) { try { trailLayer.removeChild(trail); trail.destroy(); } catch (e) {} app.ticker.remove(t); return; }
            trail.alpha = (1 - p) * 0.25;
            trail.scale.set(1 + p * 0.5);
          };
          app.ticker.add(t);
        }
      }

      // Ambient glints drift slowly down + twinkle.
      for (const g of state.glints) {
        g.sprite.y += g.vy;
        if (g.sprite.y > H + 4) {
          g.sprite.y = -4;
          g.sprite.x = Math.random() * W;
        }
        g.sprite.alpha = g.baseAlpha * (0.7 + 0.3 * Math.sin(frameTime * 2 + g.phase));
      }

      // Screen shake decay
      if (state.shake > 0) {
        app.stage.x = (Math.random() - 0.5) * state.shake;
        app.stage.y = (Math.random() - 0.5) * state.shake;
        state.shake *= 0.82;
        if (state.shake < 0.5) { state.shake = 0; app.stage.x = 0; app.stage.y = 0; }
      }
    };
    app.ticker.add(ticker);

    return () => {
      try { app.ticker.remove(ticker); } catch (e) {}
      try { Matter.Runner.stop(runner); } catch (e) {}
      try { Matter.Engine.clear(engine); } catch (e) {}
      state.orbs = [];
    };
  };

  return (
    <ArenaShell title="CASCADE" tagline="Catch high. Avoid bombs. Chain orbs ignite ⚡" accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="BEGIN"
                     sublabel="★ gold = +5 · ↯ chain = ignites cluster · ✕ bomb = avoid"
                     onStart={begin} />
      )}

      {phase !== "ready" && (
        <PixiArena height={360} setup={setupPixi} />
      )}

      {phase === "done" && (
        <div style={{
          textAlign: "center", padding: "20px 0",
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 800, fontSize: 32, color: accent.hue,
          textShadow: `0 0 20px ${accent.glow}`,
        }}>
          {score} <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>FINAL</span>
        </div>
      )}
    </ArenaShell>
  );
}
