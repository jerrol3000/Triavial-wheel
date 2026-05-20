import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo, ParticleBurst,
} from "./_style";
import { playStinger } from "./_audio";

// Anomaly — formerly "Catch the Bug." Same core mechanic (intercept
// a moving target) reframed as a sci-fi anomaly containment exercise.
// No more bug emoji.
//
//   • A pulsing geometric "anomaly" (concentric rotating shapes)
//     drifts across the arena on smooth bezier-style paths — not
//     instant teleport. Drift speed accelerates with each tap.
//   • Tap connects = +1 + combo, anomaly DESTABILIZES (visible
//     glitch effect) and warps to a new position with a brief
//     particle trail.
//   • Missed tap = nothing happens (no penalty, but combo decays
//     naturally if you go > 1.5s between hits).
//   • Special: every 5 successful taps, a "core" appears for 1.5s.
//     Tapping the core within that window = +3 + combo amplifier.
//     This rewards aggressive players with a high ceiling.
//
// The anomaly visual is pure CSS — rotating diamond + glow + scan-line
// over a 3-second motion path. Feels otherworldly compared to the
// previous bug emoji.

const DURATION_MS = 10000;
const SIZE = 64;
const MOVE_INTERVAL_MS = 850;

export default function CatchBug({ onComplete, seed }) {
  const accent = accentFor("catch_bug");
  const rngRef = useRef(null);
  const arenaRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [destabilized, setDestabilized] = useState(false);
  const [coreActive, setCoreActive] = useState(false);
  const [coreSpawnedAt, setCoreSpawnedAt] = useState(0);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [burst, setBurst] = useState(null);
  const startRef = useRef(0);
  const lastMoveRef = useRef(0);
  const hitsRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit } = useCombo(1500);

  const teleport = () => {
    const arena = arenaRef.current;
    if (!arena) return;
    const rect = arena.getBoundingClientRect();
    const margin = SIZE / 2 + 10;
    const x = margin + rngRef.current.int(Math.max(1, Math.floor(rect.width - margin * 2)));
    const y = margin + rngRef.current.int(Math.max(1, Math.floor(rect.height - margin * 2)));
    setPos({ x, y });
    lastMoveRef.current = Date.now();
  };

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    setTimeout(teleport, 30);
    playStinger("catch_bug");
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const now = Date.now();
      const left = Math.max(0, DURATION_MS - (now - startRef.current));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(tick);
        finish();
        return;
      }
      // Anomaly drifts on its own if it's been idle. Pace accelerates
      // with hits (more frantic late game).
      const driftWindow = Math.max(420, MOVE_INTERVAL_MS - hitsRef.current * 25);
      if (now - lastMoveRef.current >= driftWindow) teleport();
      // Decay core if no tap.
      if (coreActive && now - coreSpawnedAt > 1500) setCoreActive(false);
    }, 60);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, coreActive, coreSpawnedAt]);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("done");
    sfx.win?.();
    onComplete({ score });
  };

  const catchAnomaly = (isCore, e) => {
    e.stopPropagation();
    if (phase !== "racing") return;
    if (isCore) {
      setScore((s) => s + 3);
      hit();
      setCoreActive(false);
      sfx.coin?.();
      setBurst({ x: pos.x, y: pos.y, t: Date.now() });
      hitsRef.current += 1;
      teleport();
      return;
    }
    setScore((s) => s + 1);
    hit();
    sfx.click?.();
    setBurst({ x: pos.x, y: pos.y, t: Date.now() });
    setDestabilized(true);
    setTimeout(() => setDestabilized(false), 150);
    hitsRef.current += 1;
    // Spawn a core every 5 hits.
    if (hitsRef.current % 5 === 0) {
      setCoreActive(true);
      setCoreSpawnedAt(Date.now());
    }
    teleport();
  };

  return (
    <ArenaShell title="ANOMALY" tagline="Contain it before it stabilizes. Core grants ×3." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="ENGAGE"
                     sublabel="Tap the anomaly. Every 5 contacts spawn a +3 core."
                     onStart={begin} />
      )}

      {phase !== "ready" && (
        <div
          ref={arenaRef}
          style={{
            position: "relative", width: "100%", height: 340,
            background: "radial-gradient(circle at 70% 30%, rgba(192,132,252,0.10), rgba(15,23,42,0.7))",
            borderRadius: 14, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {/* Scan-line ambience */}
          <div style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(transparent, ${accent.glow}, transparent)`,
            height: "20%",
            animation: "tw-scan-line 4s linear infinite",
            opacity: 0.4, pointerEvents: "none",
          }} />

          {phase === "racing" && (
            <div
              onPointerDown={(e) => catchAnomaly(coreActive, e)}
              style={{
                position: "absolute",
                left: pos.x - SIZE / 2,
                top: pos.y - SIZE / 2,
                width: SIZE, height: SIZE,
                cursor: "pointer",
                transition: "left 0.32s cubic-bezier(0.4, 0, 0.2, 1), top 0.32s cubic-bezier(0.4, 0, 0.2, 1), transform 0.10s",
                transform: destabilized ? "scale(1.4) rotate(45deg)" : "scale(1) rotate(0deg)",
                filter: destabilized ? "blur(2px) hue-rotate(90deg)" : "none",
              }}
            >
              {/* Outer diamond ring */}
              <div style={{
                position: "absolute", inset: 0,
                border: `2px solid ${accent.hue}`,
                transform: "rotate(45deg)",
                animation: "tw-combo-pulse 1.2s ease-in-out infinite",
                boxShadow: `0 0 18px ${accent.glow}`,
              }} />
              {/* Inner rotating square */}
              <div style={{
                position: "absolute", inset: 12,
                border: `1.5px solid ${accent.hue}88`,
                animation: "tw-combo-pulse 0.6s ease-in-out infinite reverse",
              }} />
              {/* Core dot (or pulsing core if active) */}
              <div style={{
                position: "absolute",
                left: "50%", top: "50%",
                transform: "translate(-50%, -50%)",
                width: coreActive ? 24 : 10, height: coreActive ? 24 : 10,
                borderRadius: "50%",
                background: coreActive ? `radial-gradient(circle, #fff, ${accent.hue})` : accent.hue,
                boxShadow: coreActive ? `0 0 30px ${accent.glow}, 0 0 60px ${accent.glow}` : `0 0 12px ${accent.glow}`,
                animation: coreActive ? "tw-combo-pulse 0.4s ease-in-out infinite" : "none",
                transition: "width 0.15s, height 0.15s",
              }} />
            </div>
          )}

          {burst && <ParticleBurst at={burst} accent={accent} n={10} />}
        </div>
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
