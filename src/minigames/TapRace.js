import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo, ParticleBurst,
} from "./_style";
import { playStinger } from "./_audio";

// Surge — formerly "Tap Race." Same surface mechanic (tap fast in
// 5s) but redesigned around RHYTHM and INTENSITY:
//
//   • Big pulsing beat indicator (concentric rings expanding to a
//     steady 220bpm tempo) — tapping IN the inner ring = +2 + combo,
//     tapping out of phase = +1 (no combo).
//   • Combo multiplier shown in HUD. Sustained-rhythm taps build
//     to ×4. Hits within rhythm window count as "in the pocket."
//   • Geometric arena — no cartoony button. The whole arena IS the
//     tap target, with a centered glowing pulse you're trying to
//     sync with.
//
// Server max is 75 (15 tps × 5s). Surface ceiling: in-rhythm tappers
// hit higher score per tap, so 75 is much harder than the old
// "spam any button" version. Skill ceiling exists where it didn't.

const DURATION_MS = 5000;
const BEAT_MS = 273; // ~220 bpm
const POCKET_WINDOW_MS = 90;

export default function TapRace({ onComplete, seed }) {
  const accent = accentFor("tap_race");
  const [taps, setTaps] = useState(0);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [phase, setPhase] = useState("ready");
  const [burst, setBurst] = useState(null);
  const [pocket, setPocket] = useState(false);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const arenaRef = useRef(null);
  const { combo, hit, miss } = useCombo(450);

  const begin = () => {
    if (phase !== "ready") return;
    setPhase("racing");
    startRef.current = Date.now();
    playStinger("tap_race");
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
    }, 40);
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

  const onTap = (e) => {
    if (phase === "ready") return begin();
    if (phase !== "racing") return;
    const now = Date.now();
    const elapsed = now - startRef.current;
    // Phase within the current beat — 0 at beat start, BEAT_MS at end.
    const phaseInBeat = elapsed % BEAT_MS;
    const distFromBeat = Math.min(phaseInBeat, BEAT_MS - phaseInBeat);
    const inPocket = distFromBeat < POCKET_WINDOW_MS;
    setTaps((t) => t + 1);
    if (inPocket) {
      // In the pocket — +2 + combo build.
      setScore((s) => Math.min(75, s + 2));
      hit();
      setPocket(true);
      setTimeout(() => setPocket(false), 100);
      sfx.click?.();
    } else {
      setScore((s) => Math.min(75, s + 1));
      miss();
      sfx.tick?.();
    }
    // Particle burst at the click coordinate.
    if (arenaRef.current && e?.clientX != null) {
      const r = arenaRef.current.getBoundingClientRect();
      setBurst({ x: e.clientX - r.left, y: e.clientY - r.top, t: now });
    }
  };

  // Time since round start, used to drive the pulsing beat indicator.
  const beatElapsed = phase === "racing" ? (Date.now() - startRef.current) % BEAT_MS : 0;
  const beatT = beatElapsed / BEAT_MS;

  return (
    <ArenaShell title="SURGE" tagline="Tap in rhythm. In-the-pocket = ×combo." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent}
              extras={<span style={{ color: "rgba(255,255,255,0.45)" }}>{taps} taps</span>} />

      {phase === "ready" ? (
        <StartButton accent={accent} label="IGNITE"
                     sublabel="Match the beat. Pocket hits chain combos."
                     onStart={begin} />
      ) : (
        <div
          ref={arenaRef}
          onPointerDown={onTap}
          style={{
            position: "relative", width: "100%", height: 280,
            background: `radial-gradient(circle at center, ${accent.hue}10, rgba(15,23,42,0.7))`,
            borderRadius: 14, overflow: "hidden",
            border: `1px solid ${pocket ? accent.hue + "60" : "rgba(255,255,255,0.05)"}`,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "border-color 0.1s",
          }}
        >
          {/* Outer expanding beat ring */}
          <div style={{
            position: "absolute",
            width: 200 + beatT * 80, height: 200 + beatT * 80,
            borderRadius: "50%",
            border: `2px solid ${accent.hue}`,
            opacity: 1 - beatT,
            pointerEvents: "none",
          }} />
          {/* Inner stable core */}
          <div style={{
            position: "absolute",
            width: 120, height: 120, borderRadius: "50%",
            background: `radial-gradient(circle, ${accent.hue}, ${accent.hue}40 70%, transparent)`,
            boxShadow: pocket ? `0 0 60px ${accent.glow}` : `0 0 30px ${accent.glow}`,
            transform: pocket ? "scale(1.12)" : "scale(1)",
            transition: "transform 0.10s, box-shadow 0.10s",
            pointerEvents: "none",
          }} />
          {/* Big score in center, dim until racing */}
          <div style={{
            position: "relative",
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 800, fontSize: 56, color: "#fff",
            fontVariantNumeric: "tabular-nums",
            zIndex: 1,
            textShadow: `0 0 12px ${accent.glow}`,
            pointerEvents: "none",
          }}>
            {String(score).padStart(2, "0")}
          </div>
          {burst && <ParticleBurst at={burst} accent={accent} n={4} />}
        </div>
      )}

      {phase === "done" && (
        <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, letterSpacing: 2, color: "rgba(255,255,255,0.45)", textTransform: "uppercase" }}>
          {taps} taps · {score} pts
        </div>
      )}
    </ArenaShell>
  );
}
