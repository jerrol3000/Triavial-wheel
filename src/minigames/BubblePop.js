import React, { useEffect, useState, useRef } from "react";
import Matter from "matter-js";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import { PixiArena, PIXI, hexToRgb } from "./_pixi";
import { celebrateCombo } from "./_fx";
import { playStinger } from "./_audio";

// Cascade — Pixi-rendered orbs with matter.js physics. Orbs spawn at
// the top of the arena, fall under gravity, drift with a subtle wind,
// and bounce off the floor + walls. Tap an orb to pop it — better
// timing (orb closer to the top) = more points.
//
// The physics is what sells the upgrade: the CSS divs felt static and
// fake. Real falling-bouncing geometry feels SATISFYING, even on
// missed taps you watch them tumble naturally.
//
// Scoring:
//   • Catch in upper third (high) → +3 + combo
//   • Catch in middle third       → +2 + combo
//   • Catch in lower third        → +1
//   • Orb falls past floor        → combo break, no points
//   • Combo HUD multiplier visible

const DURATION_MS = 10000;
const SPAWN_INTERVAL_MS = 400;
const ORB_RADIUS = 26;

export default function BubblePop({ onComplete, seed }) {
  const accent = accentFor("bubble_pop");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(1400);

  const phaseRef = useRef("ready");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // matter + pixi shared state.
  const stateRef = useRef({
    engine: null,
    runner: null,
    orbs: [], // {body, sprite, born}
    spawnLast: 0,
    arenaH: 360,
    arenaW: 320,
  });

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    playStinger("bubble_pop");
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
    sfx.win?.();
    onComplete({ score });
  };

  const setupPixi = (app) => {
    const state = stateRef.current;
    state.arenaW = app.screen.width;
    state.arenaH = app.screen.height;

    // ── Matter physics engine ────────────────────────────────────
    const engine = Matter.Engine.create({
      gravity: { x: 0, y: 0.85 }, // not quite earth gravity — more game-y
    });
    state.engine = engine;

    // Boundaries — floor, walls.
    const wall = (x, y, w, h) => Matter.Bodies.rectangle(x, y, w, h, { isStatic: true });
    Matter.Composite.add(engine.world, [
      wall(state.arenaW / 2, state.arenaH + 30, state.arenaW + 200, 60),     // floor
      wall(-30, state.arenaH / 2, 60, state.arenaH * 2),                     // left
      wall(state.arenaW + 30, state.arenaH / 2, 60, state.arenaH * 2),       // right
    ]);

    const runner = Matter.Runner.create();
    state.runner = runner;
    Matter.Runner.run(runner, engine);

    // ── Pixi: dark gradient background ───────────────────────────
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.5);
    bg.drawRect(0, 0, state.arenaW, state.arenaH);
    bg.endFill();
    app.stage.addChild(bg);

    // Per-frame: sync Pixi sprites to Matter bodies + handle spawn/expiry.
    const ticker = (delta) => {
      const now = Date.now();
      if (phaseRef.current === "racing") {
        // Spawn cadence accelerates over the round.
        const elapsed = now - startRef.current;
        const cadence = Math.max(260, SPAWN_INTERVAL_MS - elapsed / 60);
        if (now - state.spawnLast >= cadence) {
          state.spawnLast = now;
          spawnOrb(app);
        }
      }
      // Sync sprites to bodies + cull off-screen orbs (missed pops).
      for (let i = state.orbs.length - 1; i >= 0; i--) {
        const orb = state.orbs[i];
        if (orb.popped) continue;
        if (orb.body.position.y > state.arenaH + 40) {
          // Fell past the floor — combo break.
          Matter.Composite.remove(engine.world, orb.body);
          app.stage.removeChild(orb.container);
          orb.container.destroy({ children: true });
          state.orbs.splice(i, 1);
          if (phaseRef.current === "racing") miss();
        } else {
          orb.container.x = orb.body.position.x;
          orb.container.y = orb.body.position.y;
          orb.container.rotation = orb.body.angle;
        }
      }
    };
    app.ticker.add(ticker);

    function spawnOrb(app) {
      const rng = rngRef.current;
      const x = ORB_RADIUS + 8 + rng.int(Math.max(1, state.arenaW - (ORB_RADIUS + 8) * 2));
      const body = Matter.Bodies.circle(x, -ORB_RADIUS, ORB_RADIUS, {
        restitution: 0.65,
        friction: 0.04,
        density: 0.001,
      });
      // Give orbs a small initial sideways drift for variety.
      Matter.Body.setVelocity(body, { x: (rng.int(40) - 20) / 100, y: 0 });
      Matter.Body.setAngularVelocity(body, (rng.int(20) - 10) / 100);
      Matter.Composite.add(engine.world, body);

      // Pixi visual: a small container with a faceted hex + glow.
      const container = new PIXI.Container();
      const glow = new PIXI.Graphics();
      glow.beginFill(parseInt(accent.hue.slice(1), 16), 0.2);
      glow.drawCircle(0, 0, ORB_RADIUS + 10);
      glow.endFill();
      container.addChild(glow);
      const orb = new PIXI.Graphics();
      // Hex faceted shape
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        pts.push(Math.cos(a) * ORB_RADIUS, Math.sin(a) * ORB_RADIUS);
      }
      orb.beginFill(parseInt(accent.hue.slice(1), 16));
      orb.drawPolygon(pts);
      orb.endFill();
      orb.lineStyle(1.5, 0xffffff, 0.55);
      orb.drawPolygon(pts);
      // Inner highlight
      const inner = new PIXI.Graphics();
      inner.beginFill(0xffffff, 0.25);
      inner.drawCircle(-6, -8, 6);
      inner.endFill();
      container.addChild(orb, inner);

      container.x = body.position.x;
      container.y = body.position.y;
      container.eventMode = "static";
      container.cursor = "pointer";
      container.hitArea = new PIXI.Circle(0, 0, ORB_RADIUS + 4);

      const orbRecord = { body, container, born: Date.now(), popped: false };

      container.on("pointerdown", () => {
        if (phaseRef.current !== "racing" || orbRecord.popped) return;
        orbRecord.popped = true;
        // Score by vertical position — caught higher = more points.
        const y = body.position.y;
        const tier = y < state.arenaH * 0.33 ? 3
                   : y < state.arenaH * 0.66 ? 2
                                              : 1;
        setScore((s) => s + tier);
        if (tier >= 2) hit(); else hit(); // any pop chains combo
        sfx.click?.();
        // Visual: burst, then remove.
        for (let i = 0; i < 8; i++) {
          const dot = new PIXI.Graphics();
          dot.beginFill(parseInt(accent.hue.slice(1), 16));
          dot.drawCircle(0, 0, 3);
          dot.endFill();
          dot.x = container.x;
          dot.y = container.y;
          const angle = (Math.PI * 2 * i) / 8;
          const dx = Math.cos(angle) * 35;
          const dy = Math.sin(angle) * 35;
          app.stage.addChild(dot);
          const start = Date.now();
          const fx = () => {
            const t = (Date.now() - start) / 350;
            if (t >= 1) { try { app.stage.removeChild(dot); dot.destroy(); } catch (e) {} app.ticker.remove(fx); return; }
            dot.x = container.x + dx * t;
            dot.y = container.y + dy * t;
            dot.alpha = 1 - t;
          };
          app.ticker.add(fx);
        }
        // Remove orb body + sprite
        Matter.Composite.remove(engine.world, body);
        app.stage.removeChild(container);
        container.destroy({ children: true });
        const idx = state.orbs.indexOf(orbRecord);
        if (idx >= 0) state.orbs.splice(idx, 1);
      });

      app.stage.addChild(container);
      state.orbs.push(orbRecord);
    }

    return () => {
      try { app.ticker.remove(ticker); } catch (e) {}
      try { Matter.Runner.stop(runner); } catch (e) {}
      try { Matter.Engine.clear(engine); } catch (e) {}
      state.orbs = [];
    };
  };

  return (
    <ArenaShell title="CASCADE" tagline="Catch them high. Combos for chained pops." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="BEGIN"
                     sublabel="Falling orbs. Higher catch = more points."
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
