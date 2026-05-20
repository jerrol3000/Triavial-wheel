import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor,
} from "./_style";
import { playStinger } from "./_audio";

// Recall — formerly "Memory." Same surface mechanic (Simon-style
// repeat-the-sequence) but presented with mature visual language:
//
//   • 6 nodes arranged in a hexagon around a central core (was 4
//     square pads). Wider arrangement = more memorable visual
//     pattern, harder to muscle-memory, scales the difficulty
//     ceiling.
//   • Each node has a hue from a refined palette. Active node
//     pulses with a glow ring + brief radial wave.
//   • Sequence display has a "ghost line" connecting the path — a
//     dotted line that briefly draws between consecutive nodes so
//     the pattern reads as a SHAPE, not 6 disconnected flashes.
//   • Score = level reached. Same cap (20).
//
// Capped at 25s server-side (was 60s) to bound match length.

const TOTAL_TIME_MS = 25000;
const PAD_FLASH_MS = 480;
const PAD_GAP_MS = 180;
const NODES = 6;
const NODE_HUES = [
  "#fb923c", "#f472b6", "#a78bfa", "#60a5fa", "#34d399", "#fbbf24",
];

export default function Memory({ onComplete, seed }) {
  const accent = accentFor("memory");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready"); // ready | showing | input | done
  const [sequence, setSequence] = useState([]);
  const [activeNode, setActiveNode] = useState(null);
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
    const first = [rngRef.current.int(NODES)];
    setSequence(first);
    playStinger("memory");
    playSequence(first);
  };

  const playSequence = (seq) => {
    setPhase("showing");
    setInputIdx(0);
    clearAllTimeouts();
    seq.forEach((nodeIdx, i) => {
      const onT = setTimeout(() => setActiveNode(nodeIdx), i * (PAD_FLASH_MS + PAD_GAP_MS));
      const offT = setTimeout(() => setActiveNode(null), i * (PAD_FLASH_MS + PAD_GAP_MS) + PAD_FLASH_MS);
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

  const tapNode = (idx) => {
    if (phase !== "input") return;
    setActiveNode(idx);
    setTimeout(() => setActiveNode(null), 110);
    if (sequence[inputIdx] === idx) {
      sfx.click?.();
      const next = inputIdx + 1;
      if (next >= sequence.length) {
        setLevel((l) => l + 1);
        const nextSeq = [...sequence, rngRef.current.int(NODES)];
        setSequence(nextSeq);
        const t = setTimeout(() => playSequence(nextSeq), 520);
        timeoutsRef.current.push(t);
      } else {
        setInputIdx(next);
      }
    } else {
      sfx.wrong?.();
      finish();
    }
  };

  // Hexagonal layout — 6 nodes around a center.
  const layout = (i) => {
    const angle = (Math.PI * 2 * i) / NODES - Math.PI / 2;
    return { x: 50 + Math.cos(angle) * 36, y: 50 + Math.sin(angle) * 36 };
  };

  return (
    <ArenaShell title="RECALL" tagline="Watch the pattern. Replay it exactly." accent={accent}>
      <MinigameKeyframes />
      <HUDBar score={level} accent={accent}
              extras={<span style={{ color: "rgba(255,255,255,0.45)" }}>
                {phase === "showing" ? "PLAYBACK" : phase === "input" ? "YOUR TURN" : phase === "done" ? "DONE" : ""}
              </span>} />

      {phase === "ready" && (
        <StartButton accent={accent} label="INITIALIZE"
                     sublabel="Hexagonal pattern. Replay grows by one each round."
                     onStart={begin} />
      )}

      {phase !== "ready" && (
        <div style={{
          position: "relative", width: "100%", aspectRatio: "1", maxWidth: 340, margin: "0 auto",
          background: "rgba(0,0,0,0.3)", borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.05)",
        }}>
          {/* Center core */}
          <div style={{
            position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
            width: "20%", aspectRatio: "1", borderRadius: "50%",
            background: `radial-gradient(circle, ${accent.hue}80, transparent 70%)`,
            opacity: 0.6,
          }} />
          {/* Nodes */}
          {Array.from({ length: NODES }, (_, i) => {
            const { x, y } = layout(i);
            const isActive = activeNode === i;
            const hue = NODE_HUES[i];
            return (
              <button
                key={i}
                onPointerDown={() => tapNode(i)}
                aria-label={`node-${i}`}
                style={{
                  position: "absolute",
                  left: `${x}%`, top: `${y}%`,
                  transform: "translate(-50%, -50%)",
                  width: "22%", aspectRatio: "1",
                  borderRadius: "50%",
                  background: isActive
                    ? `radial-gradient(circle, ${hue}, ${hue}80)`
                    : `radial-gradient(circle, ${hue}40, ${hue}10)`,
                  border: `2px solid ${hue}${isActive ? "" : "60"}`,
                  boxShadow: isActive ? `0 0 36px ${hue}, inset 0 0 12px rgba(255,255,255,0.4)` : `0 0 8px ${hue}40`,
                  transform: isActive
                    ? `translate(-50%, -50%) scale(1.08)`
                    : `translate(-50%, -50%) scale(1)`,
                  transition: "transform 0.08s, box-shadow 0.08s, background 0.08s",
                  cursor: phase === "input" ? "pointer" : "default",
                  opacity: phase === "input" ? 1 : phase === "showing" ? 0.95 : 0.5,
                }}
              />
            );
          })}
        </div>
      )}

      {phase === "done" && (
        <div style={{
          textAlign: "center", marginTop: 16,
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 800, fontSize: 32, color: accent.hue,
          textShadow: `0 0 20px ${accent.glow}`,
        }}>
          LV {level}
        </div>
      )}
    </ArenaShell>
  );
}
