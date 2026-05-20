import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import { playStinger } from "./_audio";

// Tide — formerly "Higher/Lower Sprint." Same surface mechanic but
// reframed as a market-ticker / signal-analysis aesthetic:
//
//   • Two large monospaced numbers: a faded "PRIOR" (left, low
//     contrast) and a brilliant "NEW" reading (right, accent
//     colored). Subtle animated rise/fall arrow next to the new
//     reading.
//   • Buttons read "RISE" / "FALL" (or up-arrow / down-arrow) in
//     stark green / red. No emoji.
//   • Each correct read, the new reading slides left to become the
//     prior, a fresh number animates in from the right. Cinematic.
//   • Combo system shown in HUD.

const DURATION_MS = 12000;
const PENALTY_MS = 200;

function nextNumber(prev, rng) {
  let n; let tries = 0;
  do {
    n = 1 + rng.int(99);
    tries++;
  } while ((n === prev || Math.abs(n - prev) < 4) && tries < 12);
  return n;
}

export default function HiLoSprint({ onComplete, seed }) {
  const accent = accentFor("hilo_sprint");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [anchor, setAnchor] = useState(50);
  const [target, setTarget] = useState(null);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [flash, setFlash] = useState(null);
  const [lockUntil, setLockUntil] = useState(0);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(1200);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    const a = 10 + rngRef.current.int(80);
    setAnchor(a);
    setTarget(nextNumber(a, rngRef.current));
    playStinger("hilo_sprint");
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

  const guess = (direction) => {
    if (phase !== "racing" || target == null) return;
    if (Date.now() < lockUntil) return;
    const correct = direction === "rise" ? target > anchor : target < anchor;
    if (correct) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
      hit();
      setAnchor(target);
      setTarget(nextNumber(target, rngRef.current));
    } else {
      setFlash("bad");
      sfx.wrong?.();
      setLockUntil(Date.now() + PENALTY_MS);
      miss();
    }
    setTimeout(() => setFlash(null), 140);
  };

  const direction = target != null ? (target > anchor ? "rise" : "fall") : null;

  return (
    <ArenaShell title="TIDE" tagline="Direction call. New reading vs prior." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="OPEN MARKET"
                     sublabel="Tap RISE or FALL. Each correct read locks in."
                     onStart={begin} />
      )}

      {phase === "racing" && target != null && (
        <>
          <div style={{
            padding: "22px 20px", marginBottom: 12, borderRadius: 14,
            background: flash === "good" ? "rgba(74,222,128,0.10)"
                      : flash === "bad"  ? "rgba(248,113,113,0.10)"
                                         : "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.05)",
            transition: "background 0.10s",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>
                PRIOR
              </div>
              <div style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 800, fontSize: 32, color: "rgba(255,255,255,0.3)",
                fontVariantNumeric: "tabular-nums",
              }}>{String(anchor).padStart(2, "0")}</div>
            </div>

            <div style={{ fontSize: 18, color: "rgba(255,255,255,0.25)", letterSpacing: 4 }}>→</div>

            <div style={{ flex: 1.5, textAlign: "right" }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: accent.hue, textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>
                NEW READING
              </div>
              <div style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 800, fontSize: 64, color: accent.hue,
                fontVariantNumeric: "tabular-nums",
                textShadow: `0 0 20px ${accent.glow}`,
                lineHeight: 1,
              }}>{String(target).padStart(2, "0")}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <button onPointerDown={() => guess("rise")}
              style={{
                padding: "26px 0", borderRadius: 12,
                border: "1px solid rgba(74,222,128,0.4)",
                background: "linear-gradient(180deg, rgba(74,222,128,0.18), rgba(74,222,128,0.04))",
                color: "#fff",
                fontFamily: '"Inter", sans-serif',
                fontWeight: 800, fontSize: 14, letterSpacing: 3,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              ▲ RISE
            </button>
            <button onPointerDown={() => guess("fall")}
              style={{
                padding: "26px 0", borderRadius: 12,
                border: "1px solid rgba(248,113,113,0.4)",
                background: "linear-gradient(0deg, rgba(248,113,113,0.18), rgba(248,113,113,0.04))",
                color: "#fff",
                fontFamily: '"Inter", sans-serif',
                fontWeight: 800, fontSize: 14, letterSpacing: 3,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              ▼ FALL
            </button>
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
