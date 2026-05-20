import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Color Match (Stroop test) — a colored WORD appears (e.g. the
// letters spell "RED" but the text color is blue). Pick the COLOR
// of the text, not the word. 12 seconds, infinite rounds. Score =
// correct count.
//
// The Stroop effect is one of the most-studied cognitive games and is
// genuinely difficult under time pressure — perfect for a friend
// race where one of you outscores the other by 3 because the brain
// gets stuck "reading" instead of "looking".

const DURATION_MS = 12000;
const COLORS = [
  { name: "RED",    hex: "#ef4444" },
  { name: "BLUE",   hex: "#3b82f6" },
  { name: "GREEN",  hex: "#10b981" },
  { name: "YELLOW", hex: "#facc15" },
];

function generateRound(rng) {
  const wordIdx = rng.int(COLORS.length);
  let colorIdx = rng.int(COLORS.length);
  // 70% of the time, force a mismatch (that's where the Stroop
  // difficulty comes from). Matching word + color is too easy.
  if (rng.float() < 0.7 && colorIdx === wordIdx) {
    colorIdx = (colorIdx + 1) % COLORS.length;
  }
  return { word: COLORS[wordIdx].name, colorIdx, hex: COLORS[colorIdx].hex };
}

export default function ColorMatch({ onComplete, seed }) {
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [flash, setFlash] = useState(null); // "good" | "bad" | null
  const startRef = useRef(0);
  const doneRef = useRef(false);

  const next = () => {
    if (!rngRef.current) return;
    setRound(generateRound(rngRef.current));
  };

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    setRound(generateRound(rngRef.current));
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const left = Math.max(0, DURATION_MS - elapsed);
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

  const pick = (idx) => {
    if (phase !== "racing" || !round) return;
    const correct = idx === round.colorIdx;
    if (correct) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
    } else {
      setFlash("bad");
      sfx.wrong?.();
    }
    setTimeout(() => setFlash(null), 180);
    next();
  };

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>🎨 Color Match</span>
        {phase === "racing" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            ⏱ {(remaining / 1000).toFixed(1)}s · ✓ {score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
        Pick the COLOR of the text — not the word!
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

      {phase === "racing" && round && (
        <>
          <div style={{
            padding: "32px 16px", marginBottom: 14, borderRadius: 16,
            background: flash === "good" ? "rgba(16,185,129,0.25)"
                      : flash === "bad" ? "rgba(239,68,68,0.25)"
                      : "rgba(255,255,255,0.04)",
            transition: "background 0.15s",
          }}>
            <div style={{
              fontFamily: "Fredoka", fontWeight: 800, fontSize: 56,
              color: round.hex, letterSpacing: 2,
            }}>
              {round.word}
            </div>
          </div>
          <div className="tw-row" style={{ gap: 8 }}>
            {COLORS.map((c, i) => (
              <button key={c.name} onClick={() => pick(i)}
                style={{
                  flex: 1, padding: "16px 0", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: c.hex, color: "#fff",
                  fontFamily: "Fredoka", fontWeight: 800, fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {c.name}
              </button>
            ))}
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
