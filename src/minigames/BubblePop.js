import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Bubble Pop — colorful circles appear at random positions, grow,
// and then shrink + disappear. Tap a bubble before it vanishes to
// score. 10-second window. Seeded spawn positions/colors so both
// players in a VS match get the IDENTICAL bubble sequence — pure
// finger-speed race.
//
// Why it's fun: instant feedback loop (every tap pops, satisfying
// pop sfx, visible burst), and it scales naturally for skill ceiling
// — beginners get plenty of easy pops, fast players juggle multiple
// bubbles at once near the end.

const DURATION_MS = 10000;
const SPAWN_INTERVAL_MS = 380;
const BUBBLE_LIFETIME_MS = 1300;
const COLORS = [
  { fill: "#f472b6", glow: "#ec4899" },
  { fill: "#60a5fa", glow: "#3b82f6" },
  { fill: "#fbbf24", glow: "#f59e0b" },
  { fill: "#34d399", glow: "#10b981" },
  { fill: "#a78bfa", glow: "#8b5cf6" },
  { fill: "#fb7185", glow: "#f43f5e" },
];

export default function BubblePop({ onComplete, seed }) {
  const rngRef = useRef(null);
  const arenaRef = useRef(null);
  const bubblesRef = useRef([]);
  const nextIdRef = useRef(1);
  const [phase, setPhase] = useState("ready");
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [bubbles, setBubbles] = useState([]);
  const startRef = useRef(0);
  const doneRef = useRef(false);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
  };

  // Main tick — spawns bubbles, ages them, expires them.
  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startRef.current;
      const left = Math.max(0, DURATION_MS - elapsed);
      setRemaining(left);

      // Age out expired bubbles + spawn new ones.
      bubblesRef.current = bubblesRef.current.filter((b) => now - b.born < BUBBLE_LIFETIME_MS);

      // Spawn on interval.
      const sinceLast = now - (bubblesRef.current.at(-1)?.born || startRef.current - SPAWN_INTERVAL_MS);
      if (sinceLast >= SPAWN_INTERVAL_MS && left > 0) {
        const arena = arenaRef.current;
        if (arena) {
          const rect = arena.getBoundingClientRect();
          const size = 56 + rngRef.current.int(28); // 56-84px
          const margin = size / 2 + 6;
          const x = margin + rngRef.current.int(Math.max(1, Math.floor(rect.width - margin * 2)));
          const y = margin + rngRef.current.int(Math.max(1, Math.floor(rect.height - margin * 2)));
          const color = COLORS[rngRef.current.int(COLORS.length)];
          bubblesRef.current.push({ id: nextIdRef.current++, x, y, size, color, born: now });
        }
      }

      setBubbles([...bubblesRef.current]);

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

  const pop = (id, e) => {
    e.stopPropagation();
    if (phase !== "racing") return;
    bubblesRef.current = bubblesRef.current.filter((b) => b.id !== id);
    setBubbles([...bubblesRef.current]);
    setScore((s) => s + 1);
    sfx.click?.();
  };

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>🫧 Bubble Pop</span>
        {phase === "racing" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            ⏱ {(remaining / 1000).toFixed(1)}s · 💥 {score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
        Pop the bubbles before they vanish!
      </div>

      {phase === "ready" && (
        <button
          onClick={begin}
          style={{
            width: "100%", padding: "32px 16px",
            fontSize: 22, fontFamily: "Fredoka", fontWeight: 800,
            borderRadius: 18, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
            color: "#fff",
          }}
        >
          Tap to start
        </button>
      )}

      {phase !== "ready" && (
        <div
          ref={arenaRef}
          style={{
            position: "relative", width: "100%", height: 360,
            background: "radial-gradient(circle at 30% 30%, rgba(124,58,237,0.18), rgba(15,23,42,0.5))",
            borderRadius: 16, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {bubbles.map((b) => {
            const age = Date.now() - b.born;
            const t = age / BUBBLE_LIFETIME_MS;
            // Grow in for first 30%, peak, shrink for last 50%.
            const scale = t < 0.3 ? t / 0.3 : t > 0.5 ? Math.max(0, 1 - (t - 0.5) / 0.5) : 1;
            return (
              <div
                key={b.id}
                onPointerDown={(e) => pop(b.id, e)}
                style={{
                  position: "absolute",
                  left: b.x - b.size / 2,
                  top: b.y - b.size / 2,
                  width: b.size,
                  height: b.size,
                  borderRadius: "50%",
                  background: `radial-gradient(circle at 30% 30%, ${b.color.fill}, ${b.color.glow})`,
                  boxShadow: `0 0 24px ${b.color.glow}88`,
                  transform: `scale(${scale.toFixed(3)})`,
                  cursor: "pointer",
                  transition: "transform 0.04s linear",
                  // Tighter hit area: inner circle. Outer shadow doesn't block.
                  pointerEvents: scale > 0.2 ? "auto" : "none",
                }}
                aria-label="bubble"
              />
            );
          })}

          {phase === "done" && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              fontFamily: "Fredoka", fontWeight: 800, fontSize: 28,
              color: "#fff", background: "rgba(15,23,42,0.7)",
            }}>
              💥 {score} popped
            </div>
          )}
        </div>
      )}
    </div>
  );
}
