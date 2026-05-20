import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Catch the Bug — a single bug emoji wanders the arena. Every time
// you tap it, it teleports to a new random spot AND speeds up.
// Every ~900ms it teleports on its own (so a player who can't find
// it gets a fresh chance). 10-second window, score = taps that
// landed on the bug.
//
// Seeded teleport positions so both players see the same dance —
// pure target-tracking + finger-speed race.
//
// Why it's fun: predator instinct hits hard. The teleport-on-tap
// makes each successful tap immediately raise the difficulty,
// rewarding skill ceiling. Also visually delightful — the bug
// "wiggles" subtly between teleports.

const DURATION_MS = 10000;
const AUTO_TELEPORT_MS = 900;
const BUG_SIZE = 56;
const BUGS = ["🐛", "🐞", "🪲", "🦗", "🕷️"];

export default function CatchBug({ onComplete, seed }) {
  const rngRef = useRef(null);
  const arenaRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [bug, setBug] = useState("🐛");
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [pulse, setPulse] = useState(false);
  const startRef = useRef(0);
  const lastTeleportRef = useRef(0);
  const doneRef = useRef(false);

  const teleport = () => {
    const arena = arenaRef.current;
    if (!arena) return;
    const rect = arena.getBoundingClientRect();
    const margin = BUG_SIZE / 2 + 8;
    const x = margin + rngRef.current.int(Math.max(1, Math.floor(rect.width - margin * 2)));
    const y = margin + rngRef.current.int(Math.max(1, Math.floor(rect.height - margin * 2)));
    setPos({ x, y });
    setBug(BUGS[rngRef.current.int(BUGS.length)]);
    lastTeleportRef.current = Date.now();
  };

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    // Initial spawn after the arena renders.
    setTimeout(teleport, 30);
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const now = Date.now();
      const left = Math.max(0, DURATION_MS - (now - startRef.current));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(tick);
        finish();
        return;
      }
      // Auto-teleport if the bug has been stationary too long.
      if (now - lastTeleportRef.current >= AUTO_TELEPORT_MS) teleport();
    }, 60);
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

  const catchBug = (e) => {
    e.stopPropagation();
    if (phase !== "racing") return;
    setScore((s) => s + 1);
    setPulse(true);
    setTimeout(() => setPulse(false), 120);
    sfx.click?.();
    teleport();
  };

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>🐛 Catch the Bug</span>
        {phase === "racing" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            ⏱ {(remaining / 1000).toFixed(1)}s · 🎯 {score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
        Tap the bug — it teleports every time you hit it!
      </div>

      {phase === "ready" && (
        <button
          onClick={begin}
          style={{
            width: "100%", padding: "32px 16px",
            fontSize: 22, fontFamily: "Fredoka", fontWeight: 800,
            borderRadius: 18, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #84cc16, #f59e0b)",
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
            position: "relative", width: "100%", height: 340,
            background: "radial-gradient(circle at 70% 30%, rgba(132,204,22,0.18), rgba(15,23,42,0.6))",
            borderRadius: 16, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {phase === "racing" && (
            <div
              onPointerDown={catchBug}
              style={{
                position: "absolute",
                left: pos.x - BUG_SIZE / 2,
                top: pos.y - BUG_SIZE / 2,
                width: BUG_SIZE,
                height: BUG_SIZE,
                fontSize: BUG_SIZE - 6,
                lineHeight: `${BUG_SIZE}px`,
                textAlign: "center",
                cursor: "pointer",
                transform: pulse ? "scale(1.4) rotate(20deg)" : "scale(1)",
                transition: "transform 0.10s, left 0.05s linear, top 0.05s linear",
                filter: `drop-shadow(0 0 12px rgba(132,204,22,0.5))`,
              }}
              aria-label="bug"
            >
              {bug}
            </div>
          )}

          {phase === "done" && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              fontFamily: "Fredoka", fontWeight: 800, fontSize: 28,
              color: "#fff", background: "rgba(15,23,42,0.7)",
            }}>
              🎯 {score} caught
            </div>
          )}
        </div>
      )}
    </div>
  );
}
