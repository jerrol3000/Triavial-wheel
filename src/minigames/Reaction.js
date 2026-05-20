import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor,
} from "./_style";
import { playStinger } from "./_audio";

// Trigger — formerly "Reaction." Same surface mechanic (wait for
// signal, tap fast) but rebuilt with sophisticated visual language:
//
//   • Three-phase status display (instead of red/green crayon flash):
//       STANDBY (deep slate, scan lines) → ARMED (subtle warning
//       pulse) → FIRE (full cyan flood + scan-line burst).
//   • Score = max(0, 1000 - reaction_ms). 200ms → 800. False start
//     = 0 with an "EARLY" status flash.
//   • Status text in monospaced caps, timer telemetry visible while
//     waiting (gives a sense of the system "thinking").
//
// Seeded wait window so both players in a VS match face identical
// timing pressure.

const MIN_WAIT_MS = 1400;
const MAX_WAIT_MS = 3800;

export default function Reaction({ onComplete, seed }) {
  const accent = accentFor("reaction");
  const [phase, setPhase] = useState("ready"); // ready | wait | go | done
  const [reactionMs, setReactionMs] = useState(null);
  const goAtRef = useRef(0);
  const timerRef = useRef(null);
  const doneRef = useRef(false);

  const begin = () => {
    if (phase !== "ready") return;
    setPhase("wait");
    const rng = makeRng(seed);
    const waitMs = MIN_WAIT_MS + Math.floor(rng.float() * (MAX_WAIT_MS - MIN_WAIT_MS));
    goAtRef.current = Date.now() + waitMs;
    timerRef.current = setTimeout(() => {
      setPhase("go");
      goAtRef.current = Date.now();
    }, waitMs);
    playStinger("reaction");
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const finish = (score, ms) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setReactionMs(ms);
    setPhase("done");
    if (score > 700) sfx.win?.();
    else if (score > 400) sfx.coin?.();
    else sfx.tick?.();
    onComplete({ score });
  };

  const onTap = () => {
    if (phase === "ready") return begin();
    if (phase === "wait") {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      finish(0, -1);
      return;
    }
    if (phase === "go") {
      const ms = Date.now() - goAtRef.current;
      const score = Math.max(0, 1000 - ms);
      finish(score, ms);
    }
  };

  const status = phase === "ready" ? "OFFLINE"
               : phase === "wait"  ? "STANDBY"
               : phase === "go"    ? "FIRE"
               :                     (reactionMs === -1 ? "EARLY" : "LOGGED");

  const statusColor = phase === "go" ? accent.hue
                    : phase === "wait" ? "rgba(251,191,36,0.9)"
                    : phase === "done" && reactionMs === -1 ? "#f87171"
                    : "rgba(255,255,255,0.7)";

  const bg = phase === "go" ? `linear-gradient(135deg, ${accent.hue}30, ${accent.hue}80)`
           : phase === "wait" ? "linear-gradient(135deg, rgba(248,113,113,0.05), rgba(248,113,113,0.15))"
           : "transparent";

  return (
    <ArenaShell title="TRIGGER" tagline="Wait for FIRE. Faster reaction = higher score." accent={accent}>
      <MinigameKeyframes />

      {phase === "ready" ? (
        <StartButton accent={accent} label="ARM"
                     sublabel="System will signal randomly between 1.4–3.8s"
                     onStart={begin} />
      ) : (
        <button
          onPointerDown={onTap}
          disabled={phase === "done"}
          style={{
            width: "100%", padding: "60px 16px", borderRadius: 14,
            border: `1px solid ${phase === "go" ? accent.hue : "rgba(255,255,255,0.08)"}`,
            background: bg,
            cursor: phase === "done" ? "default" : "pointer",
            color: "#fff",
            transition: "background 0.05s, border-color 0.1s",
            position: "relative", overflow: "hidden",
          }}
        >
          {/* Scan-line during wait phase */}
          {phase === "wait" && (
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(transparent, rgba(255,255,255,0.05), transparent)",
              height: "30%", animation: "tw-scan-line 1.4s linear infinite",
              pointerEvents: "none",
            }} />
          )}

          <div style={{
            fontSize: 11, letterSpacing: 4,
            color: statusColor,
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 700, marginBottom: 10,
          }}>
            STATUS · {status}
          </div>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 800, fontSize: 36,
            color: statusColor,
            fontVariantNumeric: "tabular-nums",
            textShadow: phase === "go" ? `0 0 24px ${accent.glow}` : "none",
            transition: "color 0.05s",
          }}>
            {phase === "wait" ? "––––ms"
             : phase === "go" ? "TAP NOW"
             : reactionMs === -1 ? "PENALTY"
             : reactionMs != null ? `${reactionMs}ms`
             : "––––ms"}
          </div>
          {phase === "done" && reactionMs > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.5)", letterSpacing: 1 }}>
              SCORE · {Math.max(0, 1000 - reactionMs)}
            </div>
          )}
        </button>
      )}
    </ArenaShell>
  );
}
