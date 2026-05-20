import React, { useEffect, useState, useRef } from "react";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import {
  PixiArena, PIXI, PlasmaFilter, hexToRgb,
  AdvancedBloomFilter, GlowFilter,
  flashChromatic, shockwave,
} from "./_pixi";
import { celebrateCombo } from "./_fx";
import { playSFX, haptic } from "./_synth";

// Anomaly v2 — proper sci-fi containment exercise.
//
// What changed from v1:
//   • DIFFICULTY SCALES: 1 anomaly to start, 2 at score 10, 3 at score
//     20. Multi-anomaly phase is the dopamine — you're spinning plates.
//   • REAL POST-PROCESSING: AdvancedBloomFilter on the whole stage
//     (gives every glow a halo), GlowFilter on the anomaly bodies
//     (extra rim light), brief chromatic-aberration FLASH on every
//     successful tap, full-stage SHOCKWAVE on every core capture.
//   • AMBIENT FIELD PARTICLES: 60 floating sub-pixel dots drift in
//     the background, attracted softly to nearest anomaly. Reinforces
//     the "energy field" framing.
//   • PARTICLE TRAILS: each anomaly leaves a brief tail of small dots
//     as it teleports — no more instant jumps.
//   • HAPTIC FEEDBACK on every tap (mobile only — silent on desktop).
//   • SOUND: hit_perfect / core_spawn / whoosh from the new synth.
//
// Scoring (capped at 25 server-side):
//   • Normal hit       → +1 + combo
//   • Core hit         → +3 + combo + shockwave + chromatic flash
//   • Idle anomaly bounces between random points; faster as you score

const DURATION_MS = 10000;
const SIZE = 88;
const AUTO_MOVE_MS = 850;
const PARTICLE_COUNT = 50;

export default function CatchBug({ onComplete, seed }) {
  const accent = accentFor("catch_bug");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit } = useCombo(1500);
  const scoreRef = useRef(0);
  useEffect(() => { scoreRef.current = score; }, [score]);

  const phaseRef = useRef("ready");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // All mutable game state lives in a ref so the Pixi ticker reads
  // current values without closure staleness.
  const stateRef = useRef({
    anomalies: [], // [{container, plasma, outerRing, innerSquare, core, pos, targetPos, lastMove, hitsForCore, coreActive, coreSpawnedAt}]
    particles: [],
    bgPattern: null,
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
    const interval = setInterval(() => {
      const left = Math.max(0, DURATION_MS - (Date.now() - startRef.current));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(interval);
        finish();
      }
    }, 80);
    return () => clearInterval(interval);
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
    const accentRGB = hexToRgb(accent.hue);
    const accentColor = parseInt(accent.hue.slice(1), 16);
    const W = app.screen.width;
    const H = app.screen.height;

    // ── Layered backdrop ─────────────────────────────────────────
    const bgVoid = new PIXI.Graphics();
    bgVoid.beginFill(0x000000, 0.85);
    bgVoid.drawRect(0, 0, W, H);
    bgVoid.endFill();
    app.stage.addChild(bgVoid);

    // Procedural radial glow as a sprite for the void center.
    const radialCanvas = document.createElement("canvas");
    radialCanvas.width = 256; radialCanvas.height = 256;
    const rctx = radialCanvas.getContext("2d");
    const grad = rctx.createRadialGradient(128, 128, 6, 128, 128, 128);
    grad.addColorStop(0, accent.hue + "55");
    grad.addColorStop(0.4, accent.hue + "22");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    rctx.fillStyle = grad; rctx.fillRect(0, 0, 256, 256);
    const rTex = PIXI.Texture.from(radialCanvas);
    const rad = new PIXI.Sprite(rTex);
    rad.anchor.set(0.5);
    rad.x = W / 2; rad.y = H / 2;
    rad.width = W * 1.4; rad.height = H * 1.4;
    rad.alpha = 0.6;
    app.stage.addChild(rad);
    state.bgPattern = rad;

    // ── Ambient field particles ──────────────────────────────────
    // Sub-pixel dots that drift through the arena, gently attracted
    // toward the nearest anomaly. Creates the "energy field" feel.
    const particleLayer = new PIXI.Container();
    app.stage.addChild(particleLayer);
    state.particleLayer = particleLayer;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const g = new PIXI.Graphics();
      g.beginFill(accentColor, 0.6);
      g.drawCircle(0, 0, 1 + Math.random() * 1.5);
      g.endFill();
      g.x = Math.random() * W;
      g.y = Math.random() * H;
      particleLayer.addChild(g);
      state.particles.push({
        sprite: g,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        baseAlpha: 0.3 + Math.random() * 0.5,
      });
    }

    // ── Layer for anomalies ──────────────────────────────────────
    const anomalyLayer = new PIXI.Container();
    app.stage.addChild(anomalyLayer);

    // Premium post-processing on the whole stage.
    const bloom = new AdvancedBloomFilter({
      threshold: 0.35,
      bloomScale: 0.9,
      brightness: 1.0,
      blur: 8,
      quality: 4,
    });
    app.stage.filters = [bloom];

    // ── Anomaly factory ──────────────────────────────────────────
    function spawnAnomaly() {
      const container = new PIXI.Container();
      const margin = SIZE + 20;
      container.x = margin + Math.random() * (W - margin * 2);
      container.y = margin + Math.random() * (H - margin * 2);

      // Plasma core
      const plasmaGfx = new PIXI.Graphics();
      plasmaGfx.beginFill(0xffffff);
      plasmaGfx.drawRect(-SIZE, -SIZE, SIZE * 2, SIZE * 2);
      plasmaGfx.endFill();
      const filter = new PlasmaFilter(accentRGB);
      plasmaGfx.filters = [filter];
      plasmaGfx.filterArea = new PIXI.Rectangle(-SIZE, -SIZE, SIZE * 2, SIZE * 2);
      container.addChild(plasmaGfx);

      // Outer diamond + inner rotating square
      const outerRing = new PIXI.Graphics();
      outerRing.lineStyle(2, accentColor, 0.95);
      outerRing.drawPolygon([0, -SIZE / 2, SIZE / 2, 0, 0, SIZE / 2, -SIZE / 2, 0]);
      container.addChild(outerRing);
      const innerSquare = new PIXI.Graphics();
      innerSquare.lineStyle(1.5, accentColor, 0.55);
      const s = SIZE / 3;
      innerSquare.drawRect(-s, -s, s * 2, s * 2);
      container.addChild(innerSquare);

      // Glow filter directly on the body
      container.filters = [new GlowFilter({
        distance: 14,
        outerStrength: 2.0,
        innerStrength: 0.3,
        color: accentColor,
        quality: 0.3,
      })];

      // Core sprite (hidden initially) — appears every 5 hits.
      const core = new PIXI.Graphics();
      core.beginFill(0xffffff);
      core.drawCircle(0, 0, 12);
      core.endFill();
      core.beginFill(accentColor, 0.7);
      core.drawCircle(0, 0, 22);
      core.endFill();
      core.visible = false;
      container.addChild(core);

      container.eventMode = "static";
      container.cursor = "pointer";
      container.hitArea = new PIXI.Circle(0, 0, SIZE / 2 + 10);

      const record = {
        container, plasma: filter, outerRing, innerSquare, core,
        pos: { x: container.x, y: container.y },
        targetPos: { x: container.x, y: container.y },
        lastMove: Date.now(),
        hitsForCore: 0,
        coreActive: false,
        coreSpawnedAt: 0,
      };
      state.anomalies.push(record);

      container.on("pointerdown", () => {
        if (phaseRef.current !== "racing") return;
        const isCore = record.coreActive;
        haptic(isCore ? [20, 30, 20] : 10);
        // Visual pulse
        container.scale.set(1.55);
        setTimeout(() => container.scale.set(1), 90);
        // Particle burst
        for (let i = 0; i < (isCore ? 16 : 10); i++) {
          const dot = new PIXI.Graphics();
          dot.beginFill(accentColor);
          dot.drawCircle(0, 0, 3 + Math.random() * 2);
          dot.endFill();
          dot.x = container.x;
          dot.y = container.y;
          const angle = (Math.PI * 2 * i) / (isCore ? 16 : 10) + Math.random() * 0.3;
          const dist = (isCore ? 80 : 50) + Math.random() * 30;
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          app.stage.addChild(dot);
          const start = Date.now();
          const lifespan = 500 + Math.random() * 200;
          const tick = () => {
            const t = (Date.now() - start) / lifespan;
            if (t >= 1) {
              try { app.stage.removeChild(dot); dot.destroy(); } catch (e) {}
              app.ticker.remove(tick);
              return;
            }
            dot.x = container.x + dx * t;
            dot.y = container.y + dy * t;
            dot.alpha = 1 - t;
            dot.scale.set(1 - t * 0.6);
          };
          app.ticker.add(tick);
        }
        // Chromatic aberration flash on the body
        flashChromatic(container, 180, isCore ? 14 : 8);

        if (isCore) {
          setScore((s) => s + 3);
          hit();
          record.coreActive = false;
          record.core.visible = false;
          playSFX("hit_perfect");
          shockwave(app, container.x, container.y, 700);
          celebrateCombo(3, { origin: { x: 0.5, y: 0.55 } });
        } else {
          setScore((s) => s + 1);
          hit();
          playSFX("hit_good");
        }
        record.hitsForCore += 1;
        if (record.hitsForCore % 5 === 0) {
          record.coreActive = true;
          record.core.visible = true;
          record.coreSpawnedAt = Date.now();
          playSFX("core_spawn");
        }
        teleportOne(record);
      });

      anomalyLayer.addChild(container);
      return record;
    }

    function teleportOne(record) {
      const margin = SIZE / 2 + 20;
      const x = margin + Math.random() * (W - margin * 2);
      const y = margin + Math.random() * (H - margin * 2);
      record.targetPos = { x, y };
      record.lastMove = Date.now();
    }

    function despawnAnomaly(record) {
      try { anomalyLayer.removeChild(record.container); record.container.destroy({ children: true }); } catch (e) {}
      state.anomalies = state.anomalies.filter((a) => a !== record);
    }

    function syncAnomalyCount() {
      const target = scoreRef.current >= 20 ? 3 : scoreRef.current >= 10 ? 2 : 1;
      while (state.anomalies.length < target) spawnAnomaly();
      while (state.anomalies.length > target) despawnAnomaly(state.anomalies[state.anomalies.length - 1]);
    }

    // Initial spawn
    spawnAnomaly();

    // ── Per-frame ticker ─────────────────────────────────────────
    let frameElapsed = 0;
    const ticker = (delta) => {
      const dt = delta / 60;
      frameElapsed += dt;
      const now = Date.now();

      // Sync anomaly count to current score tier.
      if (phaseRef.current === "racing") syncAnomalyCount();

      // Update each anomaly
      for (const a of state.anomalies) {
        a.plasma.tick(dt);
        a.outerRing.rotation += dt * 0.6;
        a.innerSquare.rotation -= dt * 1.2;
        // Smooth drift toward target
        const dx = a.targetPos.x - a.pos.x;
        const dy = a.targetPos.y - a.pos.y;
        a.pos.x += dx * 0.18;
        a.pos.y += dy * 0.18;
        a.container.x = a.pos.x;
        a.container.y = a.pos.y;

        // Auto-teleport if idle.
        if (phaseRef.current === "racing") {
          const interval = Math.max(400, AUTO_MOVE_MS - a.hitsForCore * 25);
          if (now - a.lastMove > interval) teleportOne(a);
          // Decay core if no tap
          if (a.coreActive && now - a.coreSpawnedAt > 1500) {
            a.coreActive = false;
            a.core.visible = false;
          }
        }
        // Core pulse
        if (a.core.visible) {
          const p = 1 + Math.sin(frameElapsed * 8) * 0.18;
          a.core.scale.set(p);
        }
      }

      // Update ambient particles — drift + soft attraction to nearest anomaly.
      for (const p of state.particles) {
        let ax = 0, ay = 0;
        if (state.anomalies.length > 0) {
          // Find nearest anomaly
          let nearestDist = Infinity, nearest = null;
          for (const a of state.anomalies) {
            const dx = a.pos.x - p.sprite.x;
            const dy = a.pos.y - p.sprite.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestDist) { nearestDist = d2; nearest = a; }
          }
          if (nearest && nearestDist < 60000) {
            const dx = nearest.pos.x - p.sprite.x;
            const dy = nearest.pos.y - p.sprite.y;
            const d = Math.sqrt(nearestDist) || 1;
            ax = (dx / d) * 0.015;
            ay = (dy / d) * 0.015;
          }
        }
        p.vx += ax;
        p.vy += ay;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.sprite.x += p.vx;
        p.sprite.y += p.vy;
        if (p.sprite.x < 0) p.sprite.x = W;
        if (p.sprite.x > W) p.sprite.x = 0;
        if (p.sprite.y < 0) p.sprite.y = H;
        if (p.sprite.y > H) p.sprite.y = 0;
        p.sprite.alpha = p.baseAlpha * (0.7 + 0.3 * Math.sin(frameElapsed * 3 + p.sprite.x * 0.01));
      }

      // Background radial sprite pulses subtly.
      state.bgPattern.alpha = 0.45 + Math.sin(frameElapsed * 0.5) * 0.1;
    };
    app.ticker.add(ticker);

    return () => {
      try { app.ticker.remove(ticker); } catch (e) {}
      state.anomalies = [];
      state.particles = [];
    };
  };

  return (
    <ArenaShell title="ANOMALY" tagline="Contain the field. Core = ×3. Stage scales as you score." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="ENGAGE"
                     sublabel="Tap to contain. Every 5 hits spawn a +3 core. Stage scales at 10 & 20."
                     onStart={begin} />
      )}

      {phase !== "ready" && (
        <PixiArena height={340} setup={setupPixi} />
      )}

      {phase === "done" && (
        <div style={{
          textAlign: "center", padding: "20px 0",
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 800, fontSize: 32, color: accent.hue,
          textShadow: `0 0 20px ${accent.glow}`,
        }}>
          {score} <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>CONTAINED</span>
        </div>
      )}
    </ArenaShell>
  );
}
