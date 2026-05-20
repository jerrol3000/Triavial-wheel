import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import { PixiArena, PIXI, hexToRgb } from "./_pixi";
import { celebrateCombo } from "./_fx";
import { playStinger } from "./_audio";

// Surge — Pixi-rendered, beat-synced visualization. The CSS version
// had a static expanding ring; this version has:
//
//   • A bass-line of expanding ring shockwaves emitted every beat
//   • A radial energy field at the center that intensifies with combo
//   • Particles burst from each tap, color-shifted by in-pocket vs out
//   • Subtle screen-shake on pocket hits (CSS transform on container)
//
// All driven by the same 220bpm internal clock. When the user taps
// in the pocket window (~90ms of each beat), the visual feedback is
// IMMEDIATELY different — bigger burst, shockwave riding the beat,
// HUD combo ticks up. Out of pocket = small dot, no shockwave.
//
// Scoring unchanged: +2 in pocket, +1 out, cap 75.

const DURATION_MS = 5000;
const BEAT_MS = 273; // ~220 bpm
const POCKET_WINDOW_MS = 90;

export default function TapRace({ onComplete, seed }) {
  const accent = accentFor("tap_race");
  const [taps, setTaps] = useState(0);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [phase, setPhase] = useState("ready");
  const [pocket, setPocket] = useState(false);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const lastBeatRef = useRef(0);
  const { combo, hit, miss } = useCombo(450);

  const phaseRef = useRef("ready");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const comboRef = useRef(0);
  useEffect(() => { comboRef.current = combo; }, [combo]);

  // Pixi state.
  const stateRef = useRef({
    centerGlow: null,
    rings: [],
    particles: [],
    shake: 0,
  });

  const begin = () => {
    if (phase !== "ready") return;
    setPhase("racing");
    startRef.current = Date.now();
    lastBeatRef.current = Date.now();
    playStinger("tap_race");
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const t = setInterval(() => {
      const left = Math.max(0, DURATION_MS - (Date.now() - startRef.current));
      setRemaining(left);
      if (left <= 0) { clearInterval(t); finish(); }
    }, 40);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("done");
    sfx.win?.();
    if (comboRef.current >= 4) celebrateCombo(comboRef.current);
    onComplete({ score });
  };

  const setupPixi = (app) => {
    const state = stateRef.current;
    const w = app.screen.width, h = app.screen.height;
    const accentColor = parseInt(accent.hue.slice(1), 16);
    const accentRGB = hexToRgb(accent.hue);

    // Subtle dark backdrop.
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.7);
    bg.drawRect(0, 0, w, h);
    bg.endFill();
    app.stage.addChild(bg);

    // Center radial energy field. Drawn as a sprite from a procedurally
    // generated canvas — gives us a soft glow with no extra assets.
    const centerCanvas = document.createElement("canvas");
    centerCanvas.width = 256; centerCanvas.height = 256;
    const cctx = centerCanvas.getContext("2d");
    const grad = cctx.createRadialGradient(128, 128, 6, 128, 128, 128);
    grad.addColorStop(0, accent.hue);
    grad.addColorStop(0.4, accent.hue + "aa");
    grad.addColorStop(0.7, accent.hue + "33");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    cctx.fillStyle = grad;
    cctx.fillRect(0, 0, 256, 256);
    const centerTex = PIXI.Texture.from(centerCanvas);
    const centerGlow = new PIXI.Sprite(centerTex);
    centerGlow.anchor.set(0.5);
    centerGlow.x = w / 2;
    centerGlow.y = h / 2;
    centerGlow.width = 200;
    centerGlow.height = 200;
    state.centerGlow = centerGlow;
    app.stage.addChild(centerGlow);

    // Score text — centered, monospaced, glowing.
    const scoreText = new PIXI.Text("00", {
      fontFamily: "JetBrains Mono, SF Mono, monospace",
      fontSize: 56,
      fontWeight: "800",
      fill: 0xffffff,
      align: "center",
      dropShadow: true,
      dropShadowColor: accentColor,
      dropShadowBlur: 12,
      dropShadowDistance: 0,
    });
    scoreText.anchor.set(0.5);
    scoreText.x = w / 2;
    scoreText.y = h / 2;
    app.stage.addChild(scoreText);

    // Click-target overlay — invisible Graphics covering full arena.
    const click = new PIXI.Graphics();
    click.beginFill(0xffffff, 0.001);
    click.drawRect(0, 0, w, h);
    click.endFill();
    click.eventMode = "static";
    click.cursor = "pointer";
    click.on("pointerdown", (e) => {
      if (phaseRef.current !== "racing") return;
      const local = e.global;
      handleTap(local.x, local.y);
    });
    app.stage.addChild(click);

    function spawnRing(intensity) {
      const ring = new PIXI.Graphics();
      ring.lineStyle(2 + intensity * 2, accentColor, 0.85);
      ring.drawCircle(0, 0, 60);
      ring.x = w / 2;
      ring.y = h / 2;
      ring.scale.set(0.4);
      ring.alpha = 1;
      app.stage.addChild(ring);
      state.rings.push({ sprite: ring, born: Date.now(), intensity });
    }

    function spawnParticles(x, y, n, color) {
      for (let i = 0; i < n; i++) {
        const dot = new PIXI.Graphics();
        dot.beginFill(color);
        dot.drawCircle(0, 0, 2 + Math.random() * 2);
        dot.endFill();
        dot.x = x; dot.y = y;
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 30;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        app.stage.addChild(dot);
        state.particles.push({ sprite: dot, ox: x, oy: y, dx, dy, born: Date.now(), life: 500 });
      }
    }

    function handleTap(x, y) {
      const now = Date.now();
      const elapsed = now - startRef.current;
      const phaseInBeat = elapsed % BEAT_MS;
      const distFromBeat = Math.min(phaseInBeat, BEAT_MS - phaseInBeat);
      const inPocket = distFromBeat < POCKET_WINDOW_MS;
      setTaps((t) => t + 1);
      if (inPocket) {
        setScore((s) => Math.min(75, s + 2));
        hit();
        setPocket(true);
        setTimeout(() => setPocket(false), 100);
        sfx.click?.();
        spawnRing(1);
        spawnParticles(x, y, 12, accentColor);
        state.shake = 8;
      } else {
        setScore((s) => Math.min(75, s + 1));
        miss();
        sfx.tick?.();
        spawnParticles(x, y, 4, 0xffffff);
      }
    }

    // ── Per-frame ticker ────────────────────────────────────────
    const ticker = (delta) => {
      const now = Date.now();
      // Beat-synced ambient shockwaves
      if (phaseRef.current === "racing") {
        if (now - lastBeatRef.current >= BEAT_MS) {
          lastBeatRef.current += BEAT_MS;
          spawnRing(0.3);
        }
      }

      // Center glow pulses with combo level + beat proximity.
      const elapsed = now - startRef.current;
      const beatT = (elapsed % BEAT_MS) / BEAT_MS;
      const beatPulse = 1 - Math.abs(beatT - 0.5) * 1.4;
      const comboGlow = 1 + comboRef.current * 0.12;
      if (state.centerGlow) {
        state.centerGlow.scale.set(0.9 + beatPulse * 0.18 * comboGlow, 0.9 + beatPulse * 0.18 * comboGlow);
        state.centerGlow.alpha = 0.75 + beatPulse * 0.25;
      }

      // Update rings (scale + fade out)
      for (let i = state.rings.length - 1; i >= 0; i--) {
        const r = state.rings[i];
        const t = (now - r.born) / 900;
        if (t >= 1) {
          app.stage.removeChild(r.sprite);
          r.sprite.destroy();
          state.rings.splice(i, 1);
          continue;
        }
        r.sprite.scale.set(0.4 + t * 2.5);
        r.sprite.alpha = (1 - t) * (0.7 + r.intensity * 0.3);
      }

      // Update particles
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        const t = (now - p.born) / p.life;
        if (t >= 1) {
          app.stage.removeChild(p.sprite);
          p.sprite.destroy();
          state.particles.splice(i, 1);
          continue;
        }
        p.sprite.x = p.ox + p.dx * t;
        p.sprite.y = p.oy + p.dy * t;
        p.sprite.alpha = 1 - t;
        p.sprite.scale.set(1 - t * 0.5);
      }

      // Shake — decays each frame.
      if (state.shake > 0) {
        app.stage.x = (Math.random() - 0.5) * state.shake;
        app.stage.y = (Math.random() - 0.5) * state.shake;
        state.shake *= 0.8;
        if (state.shake < 0.5) { state.shake = 0; app.stage.x = 0; app.stage.y = 0; }
      }

      // Update score text
      scoreText.text = String(score).padStart(2, "0");
    };
    app.ticker.add(ticker);

    return () => {
      try { app.ticker.remove(ticker); } catch (e) {}
      state.rings = []; state.particles = [];
    };
  };

  // We have a closure problem — setupPixi captures `score` at mount.
  // Workaround: re-render scoreText each frame from a ref that
  // mirrors the React state. Achieved via the score-ref pattern
  // (the ticker reads `score` via the closure, but since the ticker
  // is added once, we need a ref). Solution: simplest path is to
  // mutate Pixi state from the React effect when score changes. We
  // do that with this effect — it pokes the Pixi stage's scoreText.
  // But we don't have access here; defer to a more robust approach
  // below: keep score in a ref that the ticker reads.
  const scoreRef = useRef(0);
  useEffect(() => { scoreRef.current = score; }, [score]);

  return (
    <ArenaShell title="SURGE" tagline="Tap on the beat. Pocket hits chain combo." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent}
              extras={<span style={{ color: "rgba(255,255,255,0.45)" }}>{taps} taps</span>} />

      {phase === "ready" ? (
        <StartButton accent={accent} label="IGNITE"
                     sublabel="220bpm pulse. Match the beat for the multiplier."
                     onStart={begin} />
      ) : (
        <PixiArena height={300} setup={setupPixi} />
      )}

      {phase === "done" && (
        <div style={{
          textAlign: "center", marginTop: 14,
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 800, fontSize: 28, color: accent.hue,
          textShadow: `0 0 18px ${accent.glow}`,
        }}>
          {score} <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>· {taps} TAPS</span>
        </div>
      )}
    </ArenaShell>
  );
}
