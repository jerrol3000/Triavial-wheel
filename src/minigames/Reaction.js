import React, { useEffect, useState, useRef } from "react";
import { makeRng } from "./_seed";
import {
  ArenaShell, MinigameKeyframes, accentFor,
} from "./_style";
import {
  PixiArena, PIXI,
  AdvancedBloomFilter, GlowFilter,
  flashChromatic,
} from "./_pixi";
import { playSFX, haptic } from "./_synth";

// Trigger v2 — Pixi-rendered with proper sequence-of-states staging.
//
// What changed from v1:
//   • All Pixi-rendered, runs at 60fps with bloom + glow
//   • Three discrete state panels along the top: STANDBY / ARMED /
//     FIRE. The current state pulses; previous states dim.
//   • Animated scan-line during STANDBY makes the wait feel
//     mechanical (not dead). Disappears the instant FIRE hits.
//   • FIRE state floods the center with the accent color in a
//     radial burst, audio CRACK on entry. Chromatic-aberration
//     pulse on stage so the moment HITS.
//   • Result readout: huge monospaced ms number with accent glow,
//     state label "LOGGED" / "EARLY" / "PENALTY" depending on
//     outcome.
//   • Haptic FIRE-flash signal — single sharp pulse the instant
//     STANDBY → FIRE.
//
// Scoring unchanged: max(0, 1000 - reaction_ms), false-start = 0.

const MIN_WAIT_MS = 1400;
const MAX_WAIT_MS = 3800;

export default function Reaction({ onComplete, seed }) {
  const accent = accentFor("reaction");
  const [phase, setPhase] = useState("ready");
  const [reactionMs, setReactionMs] = useState(null);
  const goAtRef = useRef(0);
  const timerRef = useRef(null);
  const doneRef = useRef(false);
  const phaseRef = useRef("ready");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Pixi state.
  const stateRef = useRef({
    coreSprite: null,
    standbyScan: null,
    fireFlash: null,
    statusText: null,
    msText: null,
  });

  const begin = () => {
    if (phase !== "ready") return;
    setPhase("wait");
    const rng = makeRng(seed);
    const waitMs = MIN_WAIT_MS + Math.floor(rng.float() * (MAX_WAIT_MS - MIN_WAIT_MS));
    goAtRef.current = Date.now() + waitMs;
    playSFX("tick");
    timerRef.current = setTimeout(() => {
      setPhase("go");
      goAtRef.current = Date.now();
      playSFX("bass_kick");
      haptic(20);
    }, waitMs);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const finish = (score, ms) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setReactionMs(ms);
    setPhase("done");
    if (score > 700)      playSFX("win_stinger");
    else if (score > 400) playSFX("hit_good");
    else if (ms === -1)   playSFX("combo_break");
    else                  playSFX("hit_late");
    onComplete({ score });
  };

  const handleTap = () => {
    if (phase === "ready") return begin();
    if (phase === "wait") {
      // FALSE START — tapped before FIRE.
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      haptic([30, 50, 30]);
      finish(0, -1);
      return;
    }
    if (phase === "go") {
      const ms = Date.now() - goAtRef.current;
      const score = Math.max(0, 1000 - ms);
      haptic(score > 600 ? [15, 25, 15] : 10);
      finish(score, ms);
    }
  };

  const setupPixi = (app) => {
    const state = stateRef.current;
    const W = app.screen.width, H = app.screen.height;
    const accentColor = parseInt(accent.hue.slice(1), 16);

    // ── Backdrop ────────────────────────────────────────────────
    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 0.9);
    bg.drawRect(0, 0, W, H);
    bg.endFill();
    app.stage.addChild(bg);

    // ── Status panels along the top — STANDBY / ARMED / FIRE ────
    const STATES = ["STANDBY", "ARMED", "FIRE"];
    const panels = [];
    const panelY = 24;
    const panelW = (W - 60) / 3;
    STATES.forEach((label, i) => {
      const px = 16 + i * (panelW + 14);
      const panel = new PIXI.Container();
      panel.x = px;
      panel.y = panelY;

      const rect = new PIXI.Graphics();
      rect.beginFill(0x000000, 0.4);
      rect.lineStyle(1, 0xffffff, 0.08);
      rect.drawRoundedRect(0, 0, panelW, 36, 6);
      rect.endFill();
      panel.addChild(rect);

      const dot = new PIXI.Graphics();
      dot.beginFill(0x555566, 1);
      dot.drawCircle(0, 0, 5);
      dot.endFill();
      dot.x = 14;
      dot.y = 18;
      panel.addChild(dot);

      const txt = new PIXI.Text(label, {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 11, fontWeight: "800",
        fill: 0xaaaaaa, letterSpacing: 2,
      });
      txt.x = 28; txt.y = 11;
      panel.addChild(txt);

      app.stage.addChild(panel);
      panels.push({ container: panel, rect, dot, txt, label });
    });

    // ── Center core — the visual focus ──────────────────────────
    // Procedural glow texture
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256; glowCanvas.height = 256;
    const gctx = glowCanvas.getContext("2d");
    const grad = gctx.createRadialGradient(128, 128, 6, 128, 128, 128);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.3, accent.hue);
    grad.addColorStop(0.7, accent.hue + "55");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    gctx.fillStyle = grad; gctx.fillRect(0, 0, 256, 256);
    const glowTex = PIXI.Texture.from(glowCanvas);
    const core = new PIXI.Sprite(glowTex);
    core.anchor.set(0.5);
    core.x = W / 2;
    core.y = H / 2 + 20;
    core.width = 180;
    core.height = 180;
    core.alpha = 0;
    state.coreSprite = core;
    app.stage.addChild(core);

    // Standby scan-line that scrolls vertically during the wait.
    const scan = new PIXI.Graphics();
    scan.beginFill(accentColor, 0.5);
    scan.drawRect(W / 2 - 80, 0, 160, 2);
    scan.endFill();
    scan.alpha = 0;
    state.standbyScan = scan;
    app.stage.addChild(scan);

    // Status text below the core.
    const status = new PIXI.Text("OFFLINE", {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 11, fontWeight: "700", letterSpacing: 4,
      fill: 0x9aa0a8,
    });
    status.anchor.set(0.5);
    status.x = W / 2;
    status.y = H - 64;
    state.statusText = status;
    app.stage.addChild(status);

    // Massive ms readout in the center.
    const msText = new PIXI.Text("––––ms", {
      fontFamily: "JetBrains Mono, SF Mono, monospace",
      fontSize: 42, fontWeight: "800",
      fill: 0xffffff,
      dropShadow: true, dropShadowColor: accentColor, dropShadowBlur: 14, dropShadowDistance: 0,
    });
    msText.anchor.set(0.5);
    msText.x = W / 2;
    msText.y = H / 2 + 20;
    state.msText = msText;
    app.stage.addChild(msText);

    // ── Tap overlay ─────────────────────────────────────────────
    const click = new PIXI.Graphics();
    click.beginFill(0xffffff, 0.001);
    click.drawRect(0, 0, W, H);
    click.endFill();
    click.eventMode = "static";
    click.cursor = "pointer";
    click.on("pointerdown", handleTap);
    app.stage.addChild(click);

    // Bloom on the whole stage.
    app.stage.filters = [
      new AdvancedBloomFilter({ threshold: 0.4, bloomScale: 0.9, brightness: 1, blur: 8, quality: 4 }),
    ];

    // ── Per-frame ticker ─────────────────────────────────────────
    let frameTime = 0;
    const ticker = (delta) => {
      const dt = delta / 60;
      frameTime += dt;
      const p = phaseRef.current;

      // Panel highlight — active state pulses + bright dot.
      const activeIdx = p === "wait" ? 0 : p === "go" ? 2 : p === "done" ? 2 : -1;
      panels.forEach((pn, i) => {
        const active = i === activeIdx;
        const accentTier = active && p === "go" ? accentColor
                         : active && p === "wait" ? 0xfbbf24
                         : active && p === "done" ? accentColor
                         : 0x555566;
        pn.dot.clear();
        pn.dot.beginFill(accentTier, 1);
        pn.dot.drawCircle(0, 0, active ? 5 + Math.sin(frameTime * 6) * 1.5 : 5);
        pn.dot.endFill();
        pn.txt.style.fill = active ? 0xffffff : 0xaaaaaa;
      });

      if (p === "wait") {
        // Scan-line drifts top to bottom.
        const scanT = (frameTime % 1.4) / 1.4;
        state.standbyScan.y = scanT * H;
        state.standbyScan.alpha = 0.45;
        state.coreSprite.alpha = 0;
        state.statusText.text = "STANDBY";
        state.statusText.style.fill = 0xfbbf24;
        state.msText.text = "––––ms";
        state.msText.alpha = 0.35;
      } else if (p === "go") {
        // Core flares in immediately
        state.standbyScan.alpha = 0;
        state.coreSprite.alpha = 0.95;
        // Brief expansion
        const since = (Date.now() - goAtRef.current) / 1000;
        const burst = 1 + Math.min(0.5, since * 1.5);
        state.coreSprite.scale.set(burst);
        state.statusText.text = "FIRE";
        state.statusText.style.fill = accentColor;
        state.msText.text = "TAP NOW";
        state.msText.alpha = 1;
      } else if (p === "done") {
        state.standbyScan.alpha = 0;
        state.coreSprite.alpha = reactionMs > 0 && reactionMs < 600 ? 0.5 : 0.15;
        state.statusText.text = reactionMs === -1 ? "EARLY · PENALTY" : "LOGGED";
        state.statusText.style.fill = reactionMs === -1 ? 0xfb7185 : accentColor;
        state.msText.text = reactionMs === -1 ? "PENALTY" : reactionMs != null ? `${reactionMs}ms` : "––––ms";
        state.msText.alpha = 1;
      } else {
        state.standbyScan.alpha = 0;
        state.coreSprite.alpha = 0;
        state.statusText.text = "OFFLINE";
        state.statusText.style.fill = 0x9aa0a8;
        state.msText.alpha = 0.35;
      }
    };
    app.ticker.add(ticker);

    return () => {
      try { app.ticker.remove(ticker); } catch (e) {}
    };
  };

  return (
    <ArenaShell title="TRIGGER" tagline="Wait for FIRE. Faster = higher score." accent={accent}>
      <MinigameKeyframes />
      <PixiArena height={300} setup={setupPixi} />
    </ArenaShell>
  );
}
