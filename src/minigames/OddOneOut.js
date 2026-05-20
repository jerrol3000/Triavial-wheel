import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import { playStinger } from "./_audio";

// Outlier — formerly "Odd One Out." Same surface mechanic but with
// proper visual depth:
//
//   • 3×3 grid of GEOMETRIC TILES rendered via SVG. 8 share an
//     identity (shape + hue + rotation); one is shifted on ONE
//     dimension at random (hue, rotation, or scale).
//   • Difficulty ramps as you score: round 1 has a 22% color delta,
//     round 12 has a 5% color delta or a 3° rotation shift.
//   • Wrong pick = 280ms lockout + combo break.
//   • Tile has a faint pulsing animation so the visual isn't dead —
//     reads as a screen of "data points" you're scanning.

const DURATION_MS = 12000;
const PENALTY_MS = 280;
const BASE_DELTA = 22;
const SHRINK = 1.5;
const MIN_DELTA = 4;

function buildRound(rng, roundIdx) {
  const hue = rng.int(360);
  const sat = 55 + rng.int(20);
  const lit = 48 + rng.int(12);
  const delta = Math.max(MIN_DELTA, BASE_DELTA - roundIdx * SHRINK);
  const oddIdx = rng.int(9);
  const baseRot = rng.int(360);
  // Pick which dimension shifts. Higher rounds prefer rotation
  // (the trickier perception).
  const dimensionRoll = rng.int(roundIdx > 6 ? 3 : 2);
  let baseColor = `hsl(${hue}, ${sat}%, ${lit}%)`;
  let oddColor = baseColor;
  let baseRotation = baseRot, oddRotation = baseRot;
  let baseScale = 1, oddScale = 1;
  if (dimensionRoll === 0) {
    const dir = rng.int(2) === 0 ? -1 : 1;
    oddColor = `hsl(${hue}, ${sat}%, ${Math.max(0, Math.min(100, lit + dir * delta))}%)`;
  } else if (dimensionRoll === 1) {
    oddRotation = baseRot + (rng.int(2) === 0 ? -1 : 1) * (delta + 3);
  } else {
    oddScale = 1 - delta / 100;
  }
  return { baseColor, oddColor, baseRotation, oddRotation, baseScale, oddScale, oddIdx };
}

function Tile({ color, rotation, scale, isOdd }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" style={{
      transform: `rotate(${rotation}deg) scale(${scale})`,
      transition: "transform 0.18s ease-out",
    }}>
      <defs>
        <linearGradient id={`g-${color}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <polygon
        points="50,8 88,30 88,70 50,92 12,70 12,30"
        fill={`url(#g-${color})`}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
      />
      <polygon
        points="50,22 76,36 76,64 50,78 24,64 24,36"
        fill="rgba(0,0,0,0.18)"
      />
    </svg>
  );
}

export default function OddOneOut({ onComplete, seed }) {
  const accent = accentFor("odd_one_out");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [flash, setFlash] = useState(null);
  const [lockUntil, setLockUntil] = useState(0);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(1400);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    setRound(buildRound(rngRef.current, 0));
    playStinger("odd_one_out");
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const left = Math.max(0, DURATION_MS - (Date.now() - startRef.current));
      setRemaining(left);
      if (left <= 0) { clearInterval(tick); finish(); }
    }, 50);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("done");
    sfx.win?.();
    onComplete({ score });
  };

  const tap = (idx) => {
    if (phase !== "racing" || !round) return;
    if (Date.now() < lockUntil) return;
    if (idx === round.oddIdx) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
      hit();
      setRound(buildRound(rngRef.current, score + 1));
    } else {
      setFlash("bad");
      sfx.wrong?.();
      setLockUntil(Date.now() + PENALTY_MS);
      miss();
    }
    setTimeout(() => setFlash(null), 160);
  };

  return (
    <ArenaShell title="OUTLIER" tagline="One tile breaks the pattern. Tap it." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="SCAN"
                     sublabel="Eight tiles match. One drifts on color, rotation, or scale."
                     onStart={begin} />
      )}

      {phase === "racing" && round && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6,
          padding: 6, borderRadius: 14,
          background: flash === "good" ? "rgba(74,222,128,0.10)"
                    : flash === "bad"  ? "rgba(248,113,113,0.10)"
                                       : "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.05)",
          transition: "background 0.10s",
        }}>
          {Array.from({ length: 9 }, (_, i) => {
            const isOdd = i === round.oddIdx;
            return (
              <button
                key={`${score}-${i}`}
                onPointerDown={() => tap(i)}
                aria-label={`tile-${i}`}
                style={{
                  aspectRatio: "1", borderRadius: 10,
                  background: "rgba(255,255,255,0.015)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  cursor: "pointer",
                  padding: 6,
                  overflow: "hidden",
                }}
              >
                <Tile
                  color={isOdd ? round.oddColor : round.baseColor}
                  rotation={isOdd ? round.oddRotation : round.baseRotation}
                  scale={isOdd ? round.oddScale : round.baseScale}
                  isOdd={isOdd}
                />
              </button>
            );
          })}
        </div>
      )}

      {phase === "done" && (
        <div style={{
          textAlign: "center", padding: "20px 0",
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 800, fontSize: 32, color: accent.hue,
          textShadow: `0 0 20px ${accent.glow}`,
        }}>
          {score} <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>SPOTTED</span>
        </div>
      )}
    </ArenaShell>
  );
}
