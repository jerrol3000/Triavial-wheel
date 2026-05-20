import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Whack-a-Mole — 3×3 grid of holes. Moles pop up at seeded random
// holes; you tap them before they retreat (~900ms window). As time
// progresses, two moles can be up at once. Score = moles whacked.
//
// Seeded so both players see identical pop sequences — the race is
// purely about reaction + accuracy. Mobile-friendly because the hit
// targets are large grid cells.
//
// Why it's fun: the 3×3 grid is intuitive at a glance, moles
// telegraph their arrival with a "rising" animation, and there's
// a satisfying squish on a successful whack.

const DURATION_MS = 12000;
const MOLE_LIFETIME_MS = 900;
const SPAWN_INTERVAL_MS = 600;

export default function Whack({ onComplete, seed }) {
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [activeMoles, setActiveMoles] = useState({}); // { cellIdx: { spawnedAt, hit } }
  const startRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const doneRef = useRef(false);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    lastSpawnRef.current = startRef.current - SPAWN_INTERVAL_MS;
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startRef.current;
      const left = Math.max(0, DURATION_MS - elapsed);
      setRemaining(left);

      // Age out expired moles.
      setActiveMoles((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const cell of Object.keys(next)) {
          if (now - next[cell].spawnedAt > MOLE_LIFETIME_MS) {
            delete next[cell];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      // Spawn cadence: faster as time progresses.
      const cadence = Math.max(380, SPAWN_INTERVAL_MS - elapsed / 50);
      if (now - lastSpawnRef.current >= cadence && left > 0) {
        lastSpawnRef.current = now;
        setActiveMoles((prev) => {
          // Find a free cell.
          const free = [];
          for (let i = 0; i < 9; i++) if (!prev[i]) free.push(i);
          if (!free.length) return prev;
          const cell = free[rngRef.current.int(free.length)];
          return { ...prev, [cell]: { spawnedAt: now, hit: false } };
        });
      }

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

  const whack = (cellIdx, e) => {
    e.stopPropagation();
    if (phase !== "racing") return;
    setActiveMoles((prev) => {
      if (!prev[cellIdx] || prev[cellIdx].hit) return prev;
      const next = { ...prev, [cellIdx]: { ...prev[cellIdx], hit: true } };
      // Remove the dead mole after the squish animation.
      setTimeout(() => {
        setActiveMoles((cur) => {
          if (!cur[cellIdx]) return cur;
          const out = { ...cur };
          delete out[cellIdx];
          return out;
        });
      }, 180);
      return next;
    });
    setScore((s) => s + 1);
    sfx.click?.();
  };

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>🔨 Whack-a-Mole</span>
        {phase === "racing" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            ⏱ {(remaining / 1000).toFixed(1)}s · 🔨 {score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
        Tap the moles before they hide!
      </div>

      {phase === "ready" && (
        <button
          onClick={begin}
          style={{
            width: "100%", padding: "32px 16px",
            fontSize: 22, fontFamily: "Fredoka", fontWeight: 800,
            borderRadius: 18, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #84cc16, #65a30d)",
            color: "#fff",
          }}
        >
          Tap to start
        </button>
      )}

      {phase !== "ready" && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
          padding: 8, background: "rgba(34,197,94,0.05)", borderRadius: 16,
          border: "1px solid rgba(34,197,94,0.15)",
        }}>
          {Array.from({ length: 9 }, (_, i) => {
            const mole = activeMoles[i];
            const isUp = !!mole;
            const isHit = mole?.hit;
            return (
              <button
                key={i}
                onPointerDown={(e) => whack(i, e)}
                aria-label={`hole-${i}`}
                style={{
                  position: "relative",
                  aspectRatio: "1",
                  borderRadius: 16,
                  background: "radial-gradient(circle at 50% 80%, #422006, #1c1917)",
                  border: "2px solid #292524",
                  overflow: "hidden",
                  cursor: "pointer",
                }}
              >
                {/* Dirt ring */}
                <div style={{
                  position: "absolute", inset: "auto 8% 0", height: "30%",
                  background: "radial-gradient(ellipse at center, #78350f, #422006 70%)",
                  borderRadius: "50%",
                }} />
                {/* Mole */}
                <div style={{
                  position: "absolute", left: "50%", top: "50%",
                  transform: `translate(-50%, ${isUp ? (isHit ? "10%" : "-10%") : "60%"}) scale(${isHit ? 0.7 : 1})`,
                  transition: "transform 0.15s cubic-bezier(0.3, 1.8, 0.4, 1)",
                  fontSize: "min(48px, 9vw)",
                  filter: isHit ? "grayscale(0.5)" : "none",
                }}>
                  {isHit ? "💥" : "🐹"}
                </div>
              </button>
            );
          })}

          {phase === "done" && (
            <div style={{
              gridColumn: "1 / -1", fontFamily: "Fredoka", fontWeight: 800,
              fontSize: 22, padding: 16,
            }}>
              🔨 {score} whacked
            </div>
          )}
        </div>
      )}
    </div>
  );
}
