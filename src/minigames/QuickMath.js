import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Quick Math — solve as many simple arithmetic problems as you can in
// 15 seconds. 4-button multiple choice (avoids keyboard friction +
// makes mobile play actually possible). +/-/× only — division is
// rejection-prone with decimals.
//
// Seeded so both players see identical problems (same difficulty
// budget). The 4 choices include one correct + three "plausible
// wrongs" (off by ±1, ±2, or order-of-magnitude swaps) so a player
// can't just spot the "very different number" without computing.

const DURATION_MS = 15000;
const OPS = ["+", "-", "×"];

function generate(rng) {
  const op = OPS[rng.int(OPS.length)];
  let a, b, ans;
  if (op === "+") {
    a = 5 + rng.int(40);
    b = 5 + rng.int(40);
    ans = a + b;
  } else if (op === "-") {
    a = 20 + rng.int(60);
    b = 5 + rng.int(a - 4); // ensure positive result
    ans = a - b;
  } else {
    a = 2 + rng.int(11);
    b = 2 + rng.int(11);
    ans = a * b;
  }
  // Build 3 plausible wrong choices.
  const wrongs = new Set();
  while (wrongs.size < 3) {
    let w = ans + (rng.int(11) - 5);
    if (w === ans || w < 0) w = ans + rng.int(7) + 1;
    if (w !== ans) wrongs.add(w);
  }
  const choices = [...wrongs, ans];
  // Deterministic shuffle of choices.
  for (let i = choices.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { text: `${a} ${op} ${b}`, ans, choices };
}

export default function QuickMath({ onComplete, seed }) {
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [problem, setProblem] = useState(null);
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
    setProblem(generate(rngRef.current));
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const t = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const left = Math.max(0, DURATION_MS - elapsed);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        finish();
      }
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

  const pick = (n) => {
    if (phase !== "racing" || !problem) return;
    if (n === problem.ans) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
    } else {
      setFlash("bad");
      sfx.wrong?.();
    }
    setTimeout(() => setFlash(null), 150);
    setProblem(generate(rngRef.current));
  };

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>🔢 Quick Math</span>
        {phase === "racing" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            ⏱ {(remaining / 1000).toFixed(1)}s · ✓ {score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
        Solve as many as you can in 15 seconds.
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

      {phase === "racing" && problem && (
        <>
          <div style={{
            padding: "28px 16px", marginBottom: 14, borderRadius: 16,
            background: flash === "good" ? "rgba(16,185,129,0.25)"
                      : flash === "bad" ? "rgba(239,68,68,0.25)"
                      : "rgba(255,255,255,0.04)",
            transition: "background 0.15s",
            fontFamily: "Fredoka", fontWeight: 800, fontSize: 44,
            letterSpacing: 2,
          }}>
            {problem.text} = ?
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {problem.choices.map((c, i) => (
              <button key={`${c}-${i}`} onClick={() => pick(c)}
                style={{
                  padding: "20px 0", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.06)", color: "var(--text)",
                  fontFamily: "Fredoka", fontWeight: 800, fontSize: 20,
                  cursor: "pointer",
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </>
      )}

      {phase === "done" && (
        <div style={{ padding: "32px 16px", fontFamily: "Fredoka", fontSize: 22, fontWeight: 800 }}>
          ✓ {score} solved
        </div>
      )}
    </div>
  );
}
