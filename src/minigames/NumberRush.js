import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import { playStinger } from "./_audio";

// Sequence — formerly "Number Rush." Same core mechanic (tap numbers
// in ascending order on a scrambled grid) but reframed:
//
//   • Numbers rendered as monospaced tabular figures in dark
//     "data panel" tiles — feels like running command line ops,
//     not pre-K math worksheets.
//   • Each tile reveals its "consumed" state via a subtle scan-out:
//     fills with accent, then dims to a faded number with a
//     diagonal strike-through.
//   • "Target" indicator at the top shows the next number prominently;
//     visually pulls the eye through the grid as you progress.

const DURATION_MS = 15000;
const GRID = 12;

function buildBoard(rng) {
  const nums = Array.from({ length: GRID }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

export default function NumberRush({ onComplete, seed }) {
  const accent = accentFor("sequence_tap");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [board, setBoard] = useState([]);
  const [tapped, setTapped] = useState(new Set());
  const [nextN, setNextN] = useState(1);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [flash, setFlash] = useState(null);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(900);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    setBoard(buildBoard(rngRef.current));
    setTapped(new Set());
    setNextN(1);
    playStinger("sequence_tap");
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

  const tap = (n) => {
    if (phase !== "racing") return;
    if (n !== nextN || tapped.has(n)) {
      sfx.wrong?.();
      setFlash("bad");
      setTimeout(() => setFlash(null), 110);
      miss();
      return;
    }
    sfx.click?.();
    setFlash("good");
    setTimeout(() => setFlash(null), 80);
    hit();
    const newTapped = new Set(tapped);
    newTapped.add(n);
    setTapped(newTapped);
    setScore((s) => s + 1);
    if (n === GRID) {
      setBoard(buildBoard(rngRef.current));
      setTapped(new Set());
      setNextN(1);
    } else {
      setNextN(n + 1);
    }
  };

  return (
    <ArenaShell title="SEQUENCE" tagline="Tap ascending. Clear the grid. Repeat." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="LOAD"
                     sublabel="Tap 1 → 2 → 3 … through 12. Then again."
                     onStart={begin} />
      )}

      {phase === "racing" && (
        <>
          <div style={{
            padding: "10px 14px", marginBottom: 10, borderRadius: 12,
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.05)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 11, letterSpacing: 2, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>
              TARGET
            </span>
            <span style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 800, fontSize: 28, color: accent.hue,
              textShadow: `0 0 12px ${accent.glow}`,
              fontVariantNumeric: "tabular-nums",
            }}>
              {String(nextN).padStart(2, "0")}
            </span>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6,
            padding: 6, borderRadius: 14,
            background: flash === "bad"  ? "rgba(248,113,113,0.10)"
                      : flash === "good" ? "rgba(74,222,128,0.06)"
                                         : "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.05)",
            transition: "background 0.08s",
          }}>
            {board.map((n) => {
              const done = tapped.has(n);
              return (
                <button
                  key={n}
                  onPointerDown={() => tap(n)}
                  disabled={done}
                  style={{
                    aspectRatio: "1.2", borderRadius: 10,
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 22, fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                    background: done ? `linear-gradient(135deg, ${accent.hue}20, ${accent.hue}10)` : "rgba(255,255,255,0.03)",
                    color: done ? "rgba(255,255,255,0.25)" : "#fff",
                    border: done ? `1px solid ${accent.hue}50` : "1px solid rgba(255,255,255,0.10)",
                    cursor: done ? "default" : "pointer",
                    position: "relative",
                    transition: "all 0.12s",
                  }}
                >
                  {n}
                  {done && (
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <div style={{
                        width: "70%", height: 1, background: accent.hue,
                        transform: "rotate(-20deg)", opacity: 0.6,
                      }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {phase === "done" && (
        <div style={{
          textAlign: "center", padding: "20px 0",
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 800, fontSize: 32, color: accent.hue,
          textShadow: `0 0 20px ${accent.glow}`,
        }}>
          {score} <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>CYCLED</span>
        </div>
      )}
    </ArenaShell>
  );
}
