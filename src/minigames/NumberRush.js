import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Number Rush — twelve numbered buttons 1-12 scrambled across a
// grid. Tap them in ascending order (1 → 2 → 3 → …). When you
// finish all 12, a new scramble appears. 15-second window, score =
// total correct taps across all rounds.
//
// Seeded grid layout so both players race the IDENTICAL puzzle.
// Wrong taps do nothing (no penalty); the score is what matters.
//
// Why it's fun: visual scanning + planning + reflex all combined.
// Tournament-quality skill expression — top players will routinely
// clear 2-3 boards (24-36 numbers) while beginners get 8-15.

const DURATION_MS = 15000;
const GRID = 12;

function buildBoard(rng) {
  // Shuffle 1-12 deterministically.
  const nums = Array.from({ length: GRID }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

export default function NumberRush({ onComplete, seed }) {
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [board, setBoard] = useState([]);
  const [tapped, setTapped] = useState(new Set()); // numbers already tapped this board
  const [next, setNext] = useState(1);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [flash, setFlash] = useState(null);
  const startRef = useRef(0);
  const doneRef = useRef(false);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    setBoard(buildBoard(rngRef.current));
    setTapped(new Set());
    setNext(1);
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const left = Math.max(0, DURATION_MS - (Date.now() - startRef.current));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(tick);
        finish();
      }
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

  const tap = (n) => {
    if (phase !== "racing") return;
    if (n !== next || tapped.has(n)) {
      sfx.wrong?.();
      setFlash("bad");
      setTimeout(() => setFlash(null), 120);
      return;
    }
    sfx.correct?.();
    setFlash("good");
    setTimeout(() => setFlash(null), 100);
    const newTapped = new Set(tapped);
    newTapped.add(n);
    setTapped(newTapped);
    setScore((s) => s + 1);
    if (n === GRID) {
      // Cleared the board — fresh scramble, reset target.
      setBoard(buildBoard(rngRef.current));
      setTapped(new Set());
      setNext(1);
    } else {
      setNext(n + 1);
    }
  };

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>1️⃣ Number Rush</span>
        {phase === "racing" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            ⏱ {(remaining / 1000).toFixed(1)}s · ✓ {score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
        Tap 1 → 2 → 3 … in order, as fast as you can!
      </div>

      {phase === "ready" && (
        <button
          onClick={begin}
          style={{
            width: "100%", padding: "32px 16px",
            fontSize: 22, fontFamily: "Fredoka", fontWeight: 800,
            borderRadius: 18, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #f59e0b, #ef4444)",
            color: "#fff",
          }}
        >
          Tap to start
        </button>
      )}

      {phase === "racing" && (
        <>
          <div style={{ fontFamily: "Fredoka", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
            Next: <span style={{ color: "var(--accent, #fb923c)" }}>{next}</span>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
            padding: 8, borderRadius: 16,
            background: flash === "bad"  ? "rgba(239,68,68,0.10)"
                      : flash === "good" ? "rgba(16,185,129,0.10)"
                                         : "rgba(255,255,255,0.02)",
            transition: "background 0.10s",
          }}>
            {board.map((n) => {
              const done = tapped.has(n);
              return (
                <button
                  key={n}
                  onPointerDown={() => tap(n)}
                  disabled={done}
                  style={{
                    aspectRatio: "1.2", borderRadius: 12,
                    fontFamily: "Fredoka", fontSize: 24, fontWeight: 800,
                    background: done ? "rgba(16,185,129,0.20)" : "rgba(255,255,255,0.08)",
                    color: done ? "rgba(255,255,255,0.4)" : "var(--text)",
                    border: done ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(255,255,255,0.12)",
                    cursor: done ? "default" : "pointer",
                    textDecoration: done ? "line-through" : "none",
                  }}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </>
      )}

      {phase === "done" && (
        <div style={{ padding: "32px 16px", fontFamily: "Fredoka", fontSize: 22, fontWeight: 800 }}>
          ✓ {score} numbers
        </div>
      )}
    </div>
  );
}
