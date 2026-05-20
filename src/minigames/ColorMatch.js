import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import { playStinger } from "./_audio";

// Spectrum — formerly "Color Match." Same Stroop-test mechanic but
// refined:
//
//   • Sophisticated 4-color palette (not crayon primaries). The
//     word text appears in monospaced caps with letter-spacing —
//     reads as data, not a kid's book.
//   • Word and color picked from the same shared pool, deliberately
//     mismatched 75% of the time to keep the Stroop effect
//     consistently active.
//   • Wrong tap = -250ms lockout (no negative score) + combo break.
//   • Combo multiplier shown in HUD; chained correct picks build
//     ×2/×3 etc.
//
// Server cap unchanged (12).

const DURATION_MS = 12000;
const PENALTY_MS = 250;
const COLORS = [
  { name: "CRIMSON", hex: "#dc2626" },
  { name: "COBALT",  hex: "#2563eb" },
  { name: "EMERALD", hex: "#059669" },
  { name: "AMBER",   hex: "#d97706" },
];

function buildRound(rng) {
  const wordIdx = rng.int(COLORS.length);
  let colorIdx = rng.int(COLORS.length);
  // 75% of rounds force a mismatch (the actual Stroop interference).
  if (rng.float() < 0.75 && colorIdx === wordIdx) {
    colorIdx = (colorIdx + 1) % COLORS.length;
  }
  return { word: COLORS[wordIdx].name, colorIdx, hex: COLORS[colorIdx].hex };
}

export default function ColorMatch({ onComplete, seed }) {
  const accent = accentFor("color_match");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [flash, setFlash] = useState(null);
  const [lockUntil, setLockUntil] = useState(0);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(1300);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    setRound(buildRound(rngRef.current));
    playStinger("color_match");
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

  const pick = (idx) => {
    if (phase !== "racing" || !round) return;
    if (Date.now() < lockUntil) return;
    const correct = idx === round.colorIdx;
    if (correct) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
      hit();
    } else {
      setFlash("bad");
      sfx.wrong?.();
      setLockUntil(Date.now() + PENALTY_MS);
      miss();
    }
    setTimeout(() => setFlash(null), 160);
    if (correct) setRound(buildRound(rngRef.current));
  };

  return (
    <ArenaShell title="SPECTRUM" tagline="Tap the COLOR of the word — not the word." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="CALIBRATE"
                     sublabel="Ignore the meaning. Pick the hue."
                     onStart={begin} />
      )}

      {phase === "racing" && round && (
        <>
          <div style={{
            padding: "36px 16px", marginBottom: 12, borderRadius: 14,
            background: flash === "good" ? "rgba(74,222,128,0.10)"
                      : flash === "bad"  ? "rgba(248,113,113,0.10)"
                                         : "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.05)",
            transition: "background 0.10s",
            textAlign: "center",
          }}>
            <div style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 800, fontSize: 54,
              color: round.hex,
              letterSpacing: 6,
              textShadow: `0 0 28px ${round.hex}66`,
            }}>
              {round.word}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {COLORS.map((c, i) => (
              <button key={c.name} onPointerDown={() => pick(i)}
                style={{
                  padding: "20px 0", borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: c.hex,
                  color: "#fff",
                  fontFamily: '"Inter", sans-serif',
                  fontWeight: 800, fontSize: 11, letterSpacing: 2,
                  cursor: "pointer",
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15)`,
                }}
              >
                {c.name}
              </button>
            ))}
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
          {score} <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>RESOLVED</span>
        </div>
      )}
    </ArenaShell>
  );
}
