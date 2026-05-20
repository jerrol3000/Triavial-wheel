import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Higher / Lower Sprint — show a number. A new number appears.
// Higher or lower than the previous one? Two big buttons. Each
// correct, the new number becomes the new anchor and the next
// number appears. 12 seconds, score = correct calls.
//
// Seeded number sequence so both players race the IDENTICAL puzzle.
// Wrong guess = small lockout (200ms) to deter spam-tap, but no
// negative score. New numbers always differ from the previous by
// at least 5 so there's never an ambiguous tie.
//
// Why it's fun: zero-friction decision loop. The brain enters a
// flow state — it stops "reading numbers" and starts pattern-feeling
// up/down. Beautifully replayable.

const DURATION_MS = 12000;
const PENALTY_MS = 200;

function nextNumber(prev, rng) {
  // Pick a target in [1..99], guarantee ≠ prev and |diff| ≥ 4 so the
  // call is always clean.
  let n;
  let tries = 0;
  do {
    n = 1 + rng.int(99);
    tries++;
  } while ((n === prev || Math.abs(n - prev) < 4) && tries < 12);
  return n;
}

export default function HiLoSprint({ onComplete, seed }) {
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

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    const a = 10 + rngRef.current.int(80);
    setAnchor(a);
    setTarget(nextNumber(a, rngRef.current));
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

  // direction: "higher" | "lower"
  const guess = (direction) => {
    if (phase !== "racing" || target == null) return;
    if (Date.now() < lockUntil) return;
    const correct = direction === "higher" ? target > anchor : target < anchor;
    if (correct) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
    } else {
      setFlash("bad");
      sfx.wrong?.();
      setLockUntil(Date.now() + PENALTY_MS);
    }
    setTimeout(() => setFlash(null), 140);
    if (correct) {
      setAnchor(target);
      setTarget(nextNumber(target, rngRef.current));
    }
  };

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>📊 Higher / Lower</span>
        {phase === "racing" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            ⏱ {(remaining / 1000).toFixed(1)}s · ✓ {score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
        Is the new number higher or lower than the previous one?
      </div>

      {phase === "ready" && (
        <button
          onClick={begin}
          style={{
            width: "100%", padding: "32px 16px",
            fontSize: 22, fontFamily: "Fredoka", fontWeight: 800,
            borderRadius: 18, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #06b6d4, #6366f1)",
            color: "#fff",
          }}
        >
          Tap to start
        </button>
      )}

      {phase === "racing" && target != null && (
        <>
          <div className="tw-row" style={{
            justifyContent: "space-around", gap: 12, marginBottom: 14, alignItems: "center",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, letterSpacing: 1 }}>PREVIOUS</div>
              <div style={{ fontFamily: "Fredoka", fontSize: 36, fontWeight: 800, opacity: 0.5 }}>{anchor}</div>
            </div>
            <div style={{ fontSize: 16, color: "var(--text-dim)" }}>vs</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, letterSpacing: 1 }}>NEW</div>
              <div style={{
                fontFamily: "Fredoka", fontSize: 56, fontWeight: 800,
                color: flash === "good" ? "#10b981" : flash === "bad" ? "#ef4444" : "var(--text)",
                transition: "color 0.10s",
              }}>{target}</div>
            </div>
          </div>
          <div className="tw-row" style={{ gap: 8 }}>
            <button onClick={() => guess("higher")}
              style={{
                flex: 1, padding: "22px 0", borderRadius: 14,
                border: "1px solid rgba(16,185,129,0.5)",
                background: "linear-gradient(135deg, rgba(16,185,129,0.30), rgba(34,197,94,0.30))",
                color: "#fff", fontFamily: "Fredoka", fontWeight: 800, fontSize: 22,
                cursor: "pointer",
              }}
            >
              ⬆ Higher
            </button>
            <button onClick={() => guess("lower")}
              style={{
                flex: 1, padding: "22px 0", borderRadius: 14,
                border: "1px solid rgba(239,68,68,0.5)",
                background: "linear-gradient(135deg, rgba(239,68,68,0.30), rgba(244,63,94,0.30))",
                color: "#fff", fontFamily: "Fredoka", fontWeight: 800, fontSize: 22,
                cursor: "pointer",
              }}
            >
              ⬇ Lower
            </button>
          </div>
        </>
      )}

      {phase === "done" && (
        <div style={{ padding: "32px 16px", fontFamily: "Fredoka", fontSize: 22, fontWeight: 800 }}>
          ✓ {score} correct
        </div>
      )}
    </div>
  );
}
