import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Memory (Simon-style) — 4 colored pads light up in a sequence; you
// repeat the sequence. Each correct repeat, the sequence grows by 1.
// First wrong tap = game over. Score = level reached (number of
// correct rounds completed). 60-second hard cap so a perfect player
// doesn't stall the match — they'll naturally fail before then.
//
// Seeded sequence so both players see the IDENTICAL sequence and the
// race is purely about who can hold longer.

// Capped at 25s (was 60s) so an AFK opponent can't hold a match
// hostage. Serious Memory players naturally fail by ~level 8-12
// which lands inside 25s anyway. Matches the server's per-game
// duration in minigames.js — keep them in sync.
const TOTAL_TIME_MS = 25000;
const PAD_FLASH_MS = 500;
const PAD_GAP_MS = 200;
const PADS = [
  { hex: "#ef4444", glow: "rgba(239,68,68,0.7)" },
  { hex: "#3b82f6", glow: "rgba(59,130,246,0.7)" },
  { hex: "#10b981", glow: "rgba(16,185,129,0.7)" },
  { hex: "#facc15", glow: "rgba(250,204,21,0.7)" },
];

export default function Memory({ onComplete, seed }) {
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready"); // ready | showing | input | done
  const [sequence, setSequence] = useState([]);
  const [activePad, setActivePad] = useState(null);
  const [inputIdx, setInputIdx] = useState(0);
  const [level, setLevel] = useState(0);
  const startedRef = useRef(0);
  const doneRef = useRef(false);
  const timeoutsRef = useRef([]);

  const clearAllTimeouts = () => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
  };
  useEffect(() => () => clearAllTimeouts(), []);

  // Hard time cap — even a perfect player ends the round eventually.
  useEffect(() => {
    if (phase === "ready" || phase === "done") return;
    const t = setTimeout(() => finish(), TOTAL_TIME_MS - (Date.now() - startedRef.current));
    timeoutsRef.current.push(t);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    startedRef.current = Date.now();
    // Start sequence with one pad.
    const first = [rngRef.current.int(PADS.length)];
    setSequence(first);
    playSequence(first);
  };

  const playSequence = (seq) => {
    setPhase("showing");
    setInputIdx(0);
    clearAllTimeouts();
    seq.forEach((padIdx, i) => {
      const onT = setTimeout(() => setActivePad(padIdx), i * (PAD_FLASH_MS + PAD_GAP_MS));
      const offT = setTimeout(() => setActivePad(null), i * (PAD_FLASH_MS + PAD_GAP_MS) + PAD_FLASH_MS);
      timeoutsRef.current.push(onT, offT);
    });
    const endT = setTimeout(() => setPhase("input"), seq.length * (PAD_FLASH_MS + PAD_GAP_MS) + 100);
    timeoutsRef.current.push(endT);
  };

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    clearAllTimeouts();
    setPhase("done");
    sfx.win?.();
    onComplete({ score: level });
  };

  const tapPad = (idx) => {
    if (phase !== "input") return;
    setActivePad(idx);
    setTimeout(() => setActivePad(null), 120);
    if (sequence[inputIdx] === idx) {
      sfx.click?.();
      const next = inputIdx + 1;
      if (next >= sequence.length) {
        // Round complete — advance level, extend sequence by 1.
        setLevel((l) => l + 1);
        const nextSeq = [...sequence, rngRef.current.int(PADS.length)];
        setSequence(nextSeq);
        // Brief pause before the new sequence plays.
        const t = setTimeout(() => playSequence(nextSeq), 600);
        timeoutsRef.current.push(t);
      } else {
        setInputIdx(next);
      }
    } else {
      sfx.wrong?.();
      finish();
    }
  };

  const padSize = "calc(40vw - 20px)";
  const padStyle = (i) => ({
    width: padSize, height: padSize, maxWidth: 160, maxHeight: 160,
    borderRadius: 16, border: "none",
    background: PADS[i].hex,
    boxShadow: activePad === i ? `0 0 30px 8px ${PADS[i].glow}` : "none",
    transform: activePad === i ? "scale(1.04)" : "scale(1)",
    transition: "transform 0.08s, box-shadow 0.08s",
    cursor: phase === "input" ? "pointer" : "default",
    opacity: phase === "input" ? 1 : phase === "showing" ? 0.85 : 0.6,
  });

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>🧠 Memory</span>
        {phase !== "ready" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            Level {level}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
        {phase === "ready"   ? "Watch the sequence, then repeat it. Sequence grows each round."
       : phase === "showing" ? "Watch carefully…"
       : phase === "input"   ? "Your turn!"
                             : `Final level: ${level}`}
      </div>

      {phase === "ready" ? (
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
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, justifyItems: "center", padding: "10px 0" }}>
          {PADS.map((_, i) => (
            <button key={i} onClick={() => tapPad(i)} style={padStyle(i)} aria-label={`pad-${i}`} />
          ))}
        </div>
      )}
    </div>
  );
}
