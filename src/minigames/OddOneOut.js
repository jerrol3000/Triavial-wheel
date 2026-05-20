import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Odd One Out — 3×3 grid of colored cells. Eight share the same hue;
// one is shifted by a hair. Spot the odd one and tap it. Each correct
// pick, the color delta SHRINKS — gets brutal fast. 12 seconds.
//
// Seeded so both players see identical grids in identical order.
// Wrong tap = -300ms penalty (lockout for that long, no negative
// score) to punish spam-tapping without being too punishing.
//
// Why it's fun: pure visual challenge with a clear "I can see it!"
// dopamine spike each round. The shrinking color delta means even
// fast players cap out as the rounds get genuinely hard.

const DURATION_MS = 12000;
const PENALTY_MS = 300;
// HSL lightness delta starts at 18%, shrinks by ~1.4% per correct.
// At round 12 the delta is ~1.2% — extremely subtle.
const START_DELTA = 18;
const SHRINK_PER_ROUND = 1.4;
const MIN_DELTA = 2;

function buildRound(rng, roundIdx) {
  // Random base hue per round so it doesn't feel like the same color.
  const hue = rng.int(360);
  const sat = 55 + rng.int(20);
  const baseL = 45 + rng.int(15);
  const delta = Math.max(MIN_DELTA, START_DELTA - roundIdx * SHRINK_PER_ROUND);
  const oddIdx = rng.int(9);
  // Randomize direction (lighter or darker) so the eye can't just
  // train on "look for the brighter one".
  const dir = rng.int(2) === 0 ? -1 : 1;
  return {
    baseColor: `hsl(${hue}, ${sat}%, ${baseL}%)`,
    oddColor: `hsl(${hue}, ${sat}%, ${Math.max(0, Math.min(100, baseL + dir * delta))}%)`,
    oddIdx,
  };
}

export default function OddOneOut({ onComplete, seed }) {
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [round, setRound] = useState(null);
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
    setRound(buildRound(rngRef.current, 0));
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

  const tap = (idx) => {
    if (phase !== "racing" || !round) return;
    if (Date.now() < lockUntil) return; // wrong-pick lockout active
    if (idx === round.oddIdx) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
      setRound(buildRound(rngRef.current, score + 1));
    } else {
      setFlash("bad");
      sfx.wrong?.();
      setLockUntil(Date.now() + PENALTY_MS);
    }
    setTimeout(() => setFlash(null), 160);
  };

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>👀 Odd One Out</span>
        {phase === "racing" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            ⏱ {(remaining / 1000).toFixed(1)}s · ✓ {score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
        Tap the cell that's slightly different. Gets harder each round!
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

      {phase === "racing" && round && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6,
          padding: 8, borderRadius: 16,
          background: flash === "good" ? "rgba(16,185,129,0.15)"
                    : flash === "bad"  ? "rgba(239,68,68,0.15)"
                                       : "rgba(255,255,255,0.02)",
          transition: "background 0.15s",
        }}>
          {Array.from({ length: 9 }, (_, i) => {
            const isOdd = i === round.oddIdx;
            return (
              <button
                key={`${score}-${i}`}
                onPointerDown={() => tap(i)}
                aria-label={`cell-${i}`}
                style={{
                  aspectRatio: "1", borderRadius: 12,
                  background: isOdd ? round.oddColor : round.baseColor,
                  border: "1px solid rgba(255,255,255,0.08)",
                  cursor: "pointer",
                  transition: "transform 0.08s",
                }}
              />
            );
          })}
        </div>
      )}

      {phase === "done" && (
        <div style={{ padding: "32px 16px", fontFamily: "Fredoka", fontSize: 22, fontWeight: 800 }}>
          ✓ {score} spotted
        </div>
      )}
    </div>
  );
}
