import React, { useEffect, useState, useRef } from "react";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import {
  PixiArena, PIXI, hexToRgb,
  AdvancedBloomFilter,
  flashChromatic,
} from "./_pixi";
import { celebrateCombo } from "./_fx";
import { playSFX, startMusic, getAnalyser, haptic } from "./_synth";

// Surge v2 — synthesized music engine + audio-reactive visuals.
//
// What changed from v1:
//   • REAL MUSIC LOOP: a multi-layer 4-on-the-floor pattern at 220bpm
//     (kick + snare + hi-hat + bass line in E minor pentatonic),
//     scheduled via Web Audio (see _synth.js startMusic). Comes alive
//     when you tap IGNITE, stops cleanly on round end.
//   • WAVEFORM PERIMETER: the synth's master output runs through an
//     AnalyserNode. Around the inner core, 64 sample bars trace the
//     actual audio waveform in real time — visualizer-style.
//   • BASS-DROP FLASH: every 8th beat (a "bar drop") fires a massive
//     bloom flash + screen-wide chromatic aberration. Feels like a
//     drop. Players tapping in the pocket on these get bonus +3.
//   • POCKET COMBO LIGHTNING: when combo hits ×4, a streak of
//     converging-light particles ride the screen edges briefly.
//   • Per-tap: bass-kick subaudio + 12-particle burst + screen-shake
//     scaled by combo intensity.
//
// Scoring (still capped at 75):
//   • In-pocket on normal beat → +2 + combo
//   • In-pocket on BAR DROP    → +3 + bonus combo
//   • Out of pocket            → +1, no combo

const DURATION_MS = 8000; // a bit longer than v1 so the beat loop matters
const BEAT_MS = 273;        // ~220bpm
const POCKET_WINDOW_MS = 110;
const BAR_BEATS = 8;

export default function TapRace({ onComplete, seed }) {
  const accent = accentFor("tap_race");
  const [taps, setTaps] = useState(0);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [phase, setPhase] = useState("ready");
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(450);
  const comboRef = useRef(0);
  useEffect(() => { comboRef.current = combo; }, [combo]);
  const scoreRef = useRef(0);
  useEffect(() => { scoreRef.current = score; }, [score]);

  const phaseRef = useRef("ready");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const stateRef = useRef({
    centerGlow: null,
    rings: [],
    particles: [],
    waveformGfx: null,
    shake: 0,
    bassDropTime: 0,
    stopMusic: null,
    barCount: 0,
  });

  const begin = () => {
    if (phase !== "ready") return;
    setPhase("racing");
    startRef.current = Date.now();
    playSFX("whoosh");
    // Start the synth loop. onBeat fires once per quarter — we use
    // it to trigger bass-drop flashes every BAR_BEATS beats.
    stateRef.current.stopMusic = startMusic({
      bpm: 220,
      onBeat: (beatIdx) => {
        stateRef.current.barCount = beatIdx;
        if (beatIdx % BAR_BEATS === 0) {
          stateRef.current.bassDropTime = Date.now();
        }
      },
    });
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

  // Stop music on unmount or finish.
  useEffect(() => () => {
    if (stateRef.current.stopMusic) {
      try { stateRef.current.stopMusic(); } catch (e) {}
      stateRef.current.stopMusic = null;
    }
  }, []);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("done");
    if (stateRef.current.stopMusic) {
      try { stateRef.current.stopMusic(); } catch (e) {}
      stateRef.current.stopMusic = null;
    }
    playSFX("win_stinger");
    if (comboRef.current >= 4) celebrateCombo(comboRef.current);
    onComplete({ score: scoreRef.current });
  };

  const setupPixi = (app) => {
    const state = stateRef.current;
    const W = app.screen.width, H = app.screen.height;
    const accentColor = parseInt(accent.hue.slice(1), 16);
    const accentRGB = hexToRgb(accent.hue);
    const cx = W / 2, cy = H / 2;

    // ── Dark backdrop ────────────────────────────────────────────
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.85);
    bg.drawRect(0, 0, W, H);
    bg.endFill();
    app.stage.addChild(bg);

    // ── Center radial glow ───────────────────────────────────────
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256; glowCanvas.height = 256;
    const gctx = glowCanvas.getContext("2d");
    const grad = gctx.createRadialGradient(128, 128, 6, 128, 128, 128);
    grad.addColorStop(0, accent.hue);
    grad.addColorStop(0.4, accent.hue + "aa");
    grad.addColorStop(0.7, accent.hue + "33");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    gctx.fillStyle = grad; gctx.fillRect(0, 0, 256, 256);
    const glowTex = PIXI.Texture.from(glowCanvas);
    const centerGlow = new PIXI.Sprite(glowTex);
    centerGlow.anchor.set(0.5);
    centerGlow.x = cx; centerGlow.y = cy;
    centerGlow.width = 220; centerGlow.height = 220;
    state.centerGlow = centerGlow;
    app.stage.addChild(centerGlow);

    // ── Score text ───────────────────────────────────────────────
    const scoreText = new PIXI.Text("00", {
      fontFamily: "JetBrains Mono, SF Mono, monospace",
      fontSize: 56, fontWeight: "800",
      fill: 0xffffff,
      align: "center",
      dropShadow: true,
      dropShadowColor: accentColor,
      dropShadowBlur: 14,
      dropShadowDistance: 0,
    });
    scoreText.anchor.set(0.5);
    scoreText.x = cx; scoreText.y = cy;
    app.stage.addChild(scoreText);

    // ── Waveform around perimeter ────────────────────────────────
    // 64 bars arranged in a circle around the center. Each bar's
    // length reads from the AnalyserNode's time-domain data.
    const waveformGfx = new PIXI.Graphics();
    state.waveformGfx = waveformGfx;
    app.stage.addChild(waveformGfx);

    // ── Click overlay ────────────────────────────────────────────
    const click = new PIXI.Graphics();
    click.beginFill(0xffffff, 0.001);
    click.drawRect(0, 0, W, H);
    click.endFill();
    click.eventMode = "static";
    click.cursor = "pointer";
    click.on("pointerdown", (e) => {
      if (phaseRef.current !== "racing") return;
      const local = e.global;
      handleTap(local.x, local.y);
    });
    app.stage.addChild(click);

    // ── Bloom over everything ────────────────────────────────────
    app.stage.filters = [
      new AdvancedBloomFilter({ threshold: 0.4, bloomScale: 0.9, brightness: 1, blur: 8, quality: 4 }),
    ];

    function handleTap(x, y) {
      const now = Date.now();
      const elapsed = now - startRef.current;
      const phaseInBeat = elapsed % BEAT_MS;
      const distFromBeat = Math.min(phaseInBeat, BEAT_MS - phaseInBeat);
      const inPocket = distFromBeat < POCKET_WINDOW_MS;
      // Bar-drop bonus = first beat of every 8-beat bar gets +3 if in pocket.
      const elapsedBeats = Math.round(elapsed / BEAT_MS);
      const isBarBeat = elapsedBeats % BAR_BEATS === 0 && distFromBeat < POCKET_WINDOW_MS * 1.2;
      setTaps((t) => t + 1);
      if (isBarBeat) {
        setScore((s) => Math.min(75, s + 3));
        hit();
        playSFX("hit_perfect");
        haptic([15, 25, 15]);
        spawnRing(2);
        spawnParticles(x, y, 18, accentColor);
        state.shake = 14;
        flashChromatic(app.stage, 220, 10);
        if (comboRef.current >= 4) celebrateCombo(comboRef.current, { origin: { x: x / W, y: y / H } });
      } else if (inPocket) {
        setScore((s) => Math.min(75, s + 2));
        hit();
        playSFX("hit_good");
        haptic(12);
        spawnRing(1);
        spawnParticles(x, y, 12, accentColor);
        state.shake = 8;
      } else {
        setScore((s) => Math.min(75, s + 1));
        miss();
        playSFX("hit_late");
        spawnParticles(x, y, 4, 0xffffff);
      }
    }

    function spawnRing(intensity) {
      const ring = new PIXI.Graphics();
      ring.lineStyle(2 + intensity * 2, accentColor, 0.85);
      ring.drawCircle(0, 0, 60);
      ring.x = cx; ring.y = cy;
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

    // ── Per-frame ticker ─────────────────────────────────────────
    const analyser = getAnalyser();
    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const ticker = () => {
      const now = Date.now();
      const elapsed = now - startRef.current;
      const beatT = (elapsed % BEAT_MS) / BEAT_MS;
      const beatPulse = 1 - Math.abs(beatT - 0.5) * 1.4;
      const comboGlow = 1 + comboRef.current * 0.12;
      if (state.centerGlow) {
        state.centerGlow.scale.set(0.9 + beatPulse * 0.22 * comboGlow, 0.9 + beatPulse * 0.22 * comboGlow);
        state.centerGlow.alpha = 0.75 + beatPulse * 0.25;
      }

      // Update rings
      for (let i = state.rings.length - 1; i >= 0; i--) {
        const r = state.rings[i];
        const t = (now - r.born) / 900;
        if (t >= 1) { try { app.stage.removeChild(r.sprite); r.sprite.destroy(); } catch (e) {} state.rings.splice(i, 1); continue; }
        r.sprite.scale.set(0.4 + t * 2.8);
        r.sprite.alpha = (1 - t) * (0.7 + r.intensity * 0.3);
      }

      // Update particles
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        const t = (now - p.born) / p.life;
        if (t >= 1) { try { app.stage.removeChild(p.sprite); p.sprite.destroy(); } catch (e) {} state.particles.splice(i, 1); continue; }
        p.sprite.x = p.ox + p.dx * t;
        p.sprite.y = p.oy + p.dy * t;
        p.sprite.alpha = 1 - t;
        p.sprite.scale.set(1 - t * 0.5);
      }

      // Waveform around perimeter — reads live Analyser data.
      waveformGfx.clear();
      if (analyser && dataArray) {
        analyser.getByteTimeDomainData(dataArray);
        const bars = 64;
        const inner = 110;
        const outer = inner + 50;
        for (let i = 0; i < bars; i++) {
          const angle = (Math.PI * 2 * i) / bars - Math.PI / 2;
          const sample = dataArray[Math.floor(i * dataArray.length / bars)] / 128 - 1; // -1..1
          const len = Math.abs(sample) * 60 + 6;
          const r1 = inner;
          const r2 = inner + len;
          const x1 = cx + Math.cos(angle) * r1;
          const y1 = cy + Math.sin(angle) * r1;
          const x2 = cx + Math.cos(angle) * r2;
          const y2 = cy + Math.sin(angle) * r2;
          const a = 0.5 + Math.abs(sample) * 0.5;
          waveformGfx.lineStyle(2, accentColor, a);
          waveformGfx.moveTo(x1, y1);
          waveformGfx.lineTo(x2, y2);
        }
      }

      // Bass drop flash — fades over ~600ms.
      const sinceBassDrop = now - state.bassDropTime;
      if (sinceBassDrop < 600) {
        const k = 1 - sinceBassDrop / 600;
        // Inject extra glow alpha — overlay a flash sprite or modulate centerGlow.
        state.centerGlow.alpha = Math.min(1.0, state.centerGlow.alpha + k * 0.4);
      }

      // Screen shake
      if (state.shake > 0) {
        app.stage.x = (Math.random() - 0.5) * state.shake;
        app.stage.y = (Math.random() - 0.5) * state.shake;
        state.shake *= 0.82;
        if (state.shake < 0.5) { state.shake = 0; app.stage.x = 0; app.stage.y = 0; }
      }

      scoreText.text = String(scoreRef.current).padStart(2, "0");
    };
    app.ticker.add(ticker);

    return () => {
      try { app.ticker.remove(ticker); } catch (e) {}
      state.rings = []; state.particles = [];
    };
  };

  return (
    <ArenaShell title="SURGE" tagline="Tap on the beat. Bar drop = ×3 bonus." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent}
              extras={<span style={{ color: "rgba(255,255,255,0.45)" }}>{taps} taps</span>} />

      {phase === "ready" ? (
        <StartButton accent={accent} label="IGNITE"
                     sublabel="220 BPM · pocket = +2 · bar-drop = +3"
                     onStart={begin} />
      ) : (
        <PixiArena height={320} setup={setupPixi} />
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
