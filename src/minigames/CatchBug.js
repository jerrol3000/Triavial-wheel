import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import { PixiArena, PIXI, PlasmaFilter, hexToRgb } from "./_pixi";
import { celebrateCombo } from "./_fx";
import { playStinger } from "./_audio";

// Anomaly — rebuilt with WebGL. The previous CSS-div implementation
// always looked fake. This version runs on Pixi.js with a custom
// GLSL fragment shader (see PlasmaFilter in _pixi.js) that draws a
// real-time animated plasma/distortion effect inside the anomaly's
// containment ring. When you tap, the whole arena pulses, particles
// burst, and the anomaly teleports with a brief warp trail.
//
// Why this matters: WebGL + a real shader = "I can't tell this is a
// browser app" reaction. The plasma shader runs at 60fps on the GPU,
// looks like an actual energy field, not concentric divs.
//
// Mechanics unchanged from the CSS version:
//   • Drifting anomaly, faster after each tap
//   • +1 per tap, combo system
//   • Every 5 hits a "core" spawns for 1.5s, worth +3
//
// Score cap unchanged (25).

const DURATION_MS = 10000;
const SIZE = 96;
const AUTO_MOVE_MS = 850;

export default function CatchBug({ onComplete, seed }) {
  const accent = accentFor("catch_bug");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit } = useCombo(1500);

  // Pixi state — kept in refs so we mutate without re-rendering React.
  const stateRef = useRef({
    pos: { x: 200, y: 200 },
    targetPos: { x: 200, y: 200 },
    lastMove: 0,
    hits: 0,
    coreActive: false,
    coreSpawnedAt: 0,
    spriteContainer: null,
    coreSprite: null,
    plasmaFilter: null,
    tickerFn: null,
  });

  // Phase tracking via ref so the Pixi ticker can read current phase
  // without a stale closure.
  const phaseRef = useRef("ready");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    playStinger("catch_bug");
  };

  // Lifecycle timer driving remaining + finish.
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
    sfx.win?.();
    onComplete({ score });
  };

  // Pixi scene setup. Receives the Pixi Application; builds:
  //   • A background plasma sprite (full-area filter target)
  //   • An anomaly container (rotating geometric layers + plasma)
  //   • A core sprite (hidden until earned)
  //   • Ticker that updates positions + shader uniforms
  const setupPixi = (app) => {
    const state = stateRef.current;
    const accentRGB = hexToRgb(accent.hue);

    // ── Background ambient — radial glow behind everything ──────────
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.65);
    bg.drawRect(0, 0, app.screen.width, app.screen.height);
    bg.endFill();
    // Subtle vignette via radial gradient drawn as a sprite. Build it
    // procedurally to avoid asset loading.
    const vignetteCanvas = document.createElement("canvas");
    vignetteCanvas.width = 256; vignetteCanvas.height = 256;
    const vctx = vignetteCanvas.getContext("2d");
    const grad = vctx.createRadialGradient(128, 128, 20, 128, 128, 128);
    grad.addColorStop(0, accent.hue + "44");
    grad.addColorStop(0.6, "rgba(15,23,42,0.4)");
    grad.addColorStop(1, "rgba(0,0,0,0.95)");
    vctx.fillStyle = grad;
    vctx.fillRect(0, 0, 256, 256);
    const vTex = PIXI.Texture.from(vignetteCanvas);
    const vSprite = new PIXI.Sprite(vTex);
    vSprite.width = app.screen.width;
    vSprite.height = app.screen.height;
    app.stage.addChild(bg, vSprite);

    // ── Anomaly container ─────────────────────────────────────────
    const container = new PIXI.Container();
    container.x = app.screen.width / 2;
    container.y = app.screen.height / 2;
    state.pos = { x: container.x, y: container.y };
    state.targetPos = { x: container.x, y: container.y };
    state.spriteContainer = container;

    // Plasma core: a square graphic with the PlasmaFilter applied. The
    // shader animates inside the sprite bounds, giving us a real-time
    // GPU-rendered energy field where divs used to be.
    const plasmaGfx = new PIXI.Graphics();
    plasmaGfx.beginFill(0xffffff);
    plasmaGfx.drawRect(-SIZE, -SIZE, SIZE * 2, SIZE * 2);
    plasmaGfx.endFill();
    const filter = new PlasmaFilter(accentRGB);
    plasmaGfx.filters = [filter];
    plasmaGfx.filterArea = new PIXI.Rectangle(-SIZE, -SIZE, SIZE * 2, SIZE * 2);
    state.plasmaFilter = filter;
    container.addChild(plasmaGfx);

    // Outer diamond ring + inner rotating square for definition.
    const outerRing = new PIXI.Graphics();
    outerRing.lineStyle(2, parseInt(accent.hue.slice(1), 16), 0.95);
    outerRing.drawPolygon([0, -SIZE / 2, SIZE / 2, 0, 0, SIZE / 2, -SIZE / 2, 0]);
    container.addChild(outerRing);

    const innerSquare = new PIXI.Graphics();
    innerSquare.lineStyle(1.5, parseInt(accent.hue.slice(1), 16), 0.5);
    const s = SIZE / 3;
    innerSquare.drawRect(-s, -s, s * 2, s * 2);
    container.addChild(innerSquare);

    // Glow filter on the whole container.
    container.filters = [new PIXI.BlurFilter(2, 4)];

    app.stage.addChild(container);

    // Core sprite (hidden initially) — appears every 5 hits.
    const core = new PIXI.Graphics();
    core.beginFill(0xffffff);
    core.drawCircle(0, 0, 14);
    core.endFill();
    core.beginFill(parseInt(accent.hue.slice(1), 16), 0.7);
    core.drawCircle(0, 0, 22);
    core.endFill();
    core.visible = false;
    container.addChild(core);
    state.coreSprite = core;

    // ── Click handling ─────────────────────────────────────────────
    container.eventMode = "static";
    container.cursor = "pointer";
    container.hitArea = new PIXI.Circle(0, 0, SIZE / 2 + 8);
    container.on("pointerdown", () => {
      if (phaseRef.current !== "racing") return;
      // Pixi pulse — scale up briefly + spawn particle dots.
      container.scale.set(1.45);
      setTimeout(() => container.scale.set(1), 90);
      // Burst of small particles radiating from current position.
      for (let i = 0; i < 10; i++) {
        const dot = new PIXI.Graphics();
        dot.beginFill(parseInt(accent.hue.slice(1), 16));
        dot.drawCircle(0, 0, 3 + Math.random() * 2);
        dot.endFill();
        dot.x = container.x;
        dot.y = container.y;
        const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.3;
        const dist = 50 + Math.random() * 30;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        app.stage.addChild(dot);
        let life = 0;
        const lifespan = 450 + Math.random() * 200;
        const start = Date.now();
        const tick = () => {
          life = Date.now() - start;
          const t = life / lifespan;
          if (t >= 1) {
            app.ticker.remove(tick);
            try { app.stage.removeChild(dot); dot.destroy(); } catch (e) {}
            return;
          }
          dot.x = container.x + dx * t;
          dot.y = container.y + dy * t;
          dot.alpha = 1 - t;
          dot.scale.set(1 - t * 0.6);
        };
        app.ticker.add(tick);
      }

      // Scoring + teleport
      const isCore = state.coreActive;
      if (isCore) {
        setScore((s) => s + 3);
        hit();
        celebrateCombo(3, { origin: { x: 0.5, y: 0.55 } });
        state.coreActive = false;
        state.coreSprite.visible = false;
        sfx.coin?.();
      } else {
        setScore((s) => s + 1);
        hit();
        sfx.click?.();
      }
      state.hits += 1;
      if (state.hits % 5 === 0) {
        state.coreActive = true;
        state.coreSprite.visible = true;
        state.coreSpawnedAt = Date.now();
      }
      teleport(app);
    });

    // ── Per-frame ticker — shader animation + drift + auto-teleport
    let frameElapsed = 0;
    const ticker = (delta) => {
      // delta is in ticks (~1 per frame at 60fps). Convert to seconds.
      const dt = delta / 60;
      frameElapsed += dt;
      state.plasmaFilter.tick(dt);

      // Subtle rotation on inner square + outer ring (slow on outer,
      // faster on inner — visually layered).
      outerRing.rotation += dt * 0.6;
      innerSquare.rotation -= dt * 1.2;

      // Smooth drift toward target position.
      const dx = state.targetPos.x - state.pos.x;
      const dy = state.targetPos.y - state.pos.y;
      state.pos.x += dx * 0.18;
      state.pos.y += dy * 0.18;
      container.x = state.pos.x;
      container.y = state.pos.y;

      // Auto-teleport if idle too long.
      if (phaseRef.current === "racing") {
        const now = Date.now();
        if (now - state.lastMove > Math.max(420, AUTO_MOVE_MS - state.hits * 25)) {
          teleport(app);
        }
        // Decay core if no tap.
        if (state.coreActive && now - state.coreSpawnedAt > 1500) {
          state.coreActive = false;
          state.coreSprite.visible = false;
        }
      }

      // Core has a slight pulse via scale modulation.
      if (state.coreSprite.visible) {
        const p = 1 + Math.sin(frameElapsed * 8) * 0.15;
        state.coreSprite.scale.set(p);
      }
    };
    app.ticker.add(ticker);
    state.tickerFn = ticker;

    // First teleport once stage is ready.
    setTimeout(() => teleport(app), 50);

    return () => {
      try { app.ticker.remove(ticker); } catch (e) {}
    };
  };

  const teleport = (app) => {
    if (!app) return;
    const state = stateRef.current;
    const rng = rngRef.current;
    if (!rng) return;
    const margin = SIZE / 2 + 20;
    const w = app.screen.width;
    const h = app.screen.height;
    const x = margin + rng.int(Math.max(1, Math.floor(w - margin * 2)));
    const y = margin + rng.int(Math.max(1, Math.floor(h - margin * 2)));
    state.targetPos = { x, y };
    state.lastMove = Date.now();
  };

  return (
    <ArenaShell title="ANOMALY" tagline="Contain the field. Core = ×3." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="ENGAGE"
                     sublabel="Tap the anomaly. Every 5 contacts spawn a +3 core."
                     onStart={begin} />
      )}

      {phase !== "ready" && (
        <PixiArena
          height={340}
          setup={setupPixi}
        />
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
