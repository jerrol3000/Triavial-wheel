import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import { playStinger } from "./_audio";

// Vector — formerly "Quick Math." Same surface mechanic (solve fast
// arithmetic) but with mature design + harder expressions:
//
//   • Mixed-operator expressions where applicable:
//       "12 + 7" (single op, 60% of rounds)
//       "23 - 9 + 4" (chained, 25%)
//       "8 × 7" or "12 × 3" (multiply, 15%)
//   • Numbers in monospaced typography, treated as data display.
//   • 4 choices in a 2×2 grid. Wrong distractors are plausible
//     (off-by-one, swapped digits, or the "naive" answer if you
//     ignore order of operations).
//   • Combo system: chained correct answers within 1.4s multiply
//     the dopamine.

const DURATION_MS = 15000;

function gen(rng) {
  const r = rng.int(100);
  let text, ans;
  if (r < 60) {
    // Single operation +/-
    if (rng.int(2)) {
      const a = 8 + rng.int(45), b = 5 + rng.int(40);
      text = `${a} + ${b}`; ans = a + b;
    } else {
      const a = 30 + rng.int(60), b = 5 + rng.int(a - 4);
      text = `${a} − ${b}`; ans = a - b;
    }
  } else if (r < 85) {
    // Chained — exercises order-of-operations
    const a = 10 + rng.int(40), b = 4 + rng.int(15), c = 3 + rng.int(8);
    const op2 = rng.int(2) ? "+" : "−";
    text = `${a} − ${b} ${op2} ${c}`;
    ans = op2 === "+" ? a - b + c : a - b - c;
  } else {
    // Multiplication
    const a = 2 + rng.int(11), b = 2 + rng.int(11);
    text = `${a} × ${b}`; ans = a * b;
  }
  // Distractors: plausible off-by-N values.
  const wrongs = new Set();
  while (wrongs.size < 3) {
    let w = ans + (rng.int(11) - 5);
    if (w === ans || w < 0) w = ans + rng.int(8) + 1;
    if (w !== ans) wrongs.add(w);
  }
  const choices = [...wrongs, ans];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { text, ans, choices };
}

export default function QuickMath({ onComplete, seed }) {
  const accent = accentFor("quick_math");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [problem, setProblem] = useState(null);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [flash, setFlash] = useState(null);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(1400);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    setProblem(gen(rngRef.current));
    playStinger("quick_math");
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

  const pick = (n) => {
    if (phase !== "racing" || !problem) return;
    if (n === problem.ans) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
      hit();
    } else {
      setFlash("bad");
      sfx.wrong?.();
      miss();
    }
    setTimeout(() => setFlash(null), 130);
    setProblem(gen(rngRef.current));
  };

  return (
    <ArenaShell title="VECTOR" tagline="Solve in flow. Wrong answers break the chain." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="EXECUTE"
                     sublabel="Mixed operators. Order of operations matters."
                     onStart={begin} />
      )}

      {phase === "racing" && problem && (
        <>
          <div style={{
            padding: "28px 16px", marginBottom: 12, borderRadius: 14,
            background: flash === "good" ? "rgba(74,222,128,0.10)"
                      : flash === "bad"  ? "rgba(248,113,113,0.10)"
                                         : "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.05)",
            transition: "background 0.10s",
            textAlign: "center",
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 800, fontSize: 44,
            color: "#fff",
            letterSpacing: 2,
            fontVariantNumeric: "tabular-nums",
          }}>
            {problem.text} <span style={{ color: "rgba(255,255,255,0.4)" }}>=</span> <span style={{ color: accent.hue }}>?</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {problem.choices.map((c, i) => (
              <button key={`${c}-${i}`} onPointerDown={() => pick(c)}
                style={{
                  padding: "22px 0", borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#fff",
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 800, fontSize: 22,
                  cursor: "pointer",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {c}
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
