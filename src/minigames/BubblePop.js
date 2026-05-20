import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo, ParticleBurst,
} from "./_style";
import { playStinger } from "./_audio";

// Cascade — formerly "Bubble Pop." Same surface mechanic (tap things
// before they vanish) but redesigned for sophistication:
//
//   • Orbs spawn with a visible DECAY RING that shrinks. Tapping at
//     peak (decay ≈ 1.0) yields 3 points + combo. Late taps yield 1
//     point. Missed orbs reset combo.
//   • Combo multiplier x2/x3/x4 displayed in HUD — chains of perfect
//     timing snowball.
//   • Geometric "tessellated" orb visuals (concentric hexagons), no
//     soft "bubble" look. Single accent hue per orb.
//   • Dark arena. Particle burst on every tap, intensity scales
//     with hit quality.
//
// Score model:
//   Perfect (decay > 0.65)  → +3
//   Good    (0.35-0.65)     → +2
//   Late    (< 0.35)        → +1
//   Missed                  → combo reset (no negative)
//
// Cap remains 35 server-side; max realistic = ~25 perfects + combo.

const DURATION_MS = 10000;
const SPAWN_INTERVAL_MS = 380;
const ORB_LIFETIME_MS = 1500;

export default function BubblePop({ onComplete, seed }) {
  const accent = accentFor("bubble_pop");
  const rngRef = useRef(null);
  const arenaRef = useRef(null);
  const orbsRef = useRef([]);
  const nextIdRef = useRef(1);
  const [phase, setPhase] = useState("ready");
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [orbs, setOrbs] = useState([]);
  const [burst, setBurst] = useState(null);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(1400);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    playStinger("bubble_pop");
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startRef.current;
      const left = Math.max(0, DURATION_MS - elapsed);
      setRemaining(left);

      // Age out expired orbs (combo break on natural expiry).
      const stillAlive = [];
      let expired = 0;
      for (const o of orbsRef.current) {
        if (now - o.born < ORB_LIFETIME_MS) stillAlive.push(o);
        else if (!o.popped) expired++;
      }
      if (expired > 0) miss();
      orbsRef.current = stillAlive;

      // Spawn cadence: starts at 380ms, accelerates to 240ms by the end.
      const cadence = Math.max(240, SPAWN_INTERVAL_MS - elapsed / 60);
      const sinceLast = now - (orbsRef.current.at(-1)?.born || startRef.current - cadence);
      if (sinceLast >= cadence && left > 0) {
        const arena = arenaRef.current;
        if (arena) {
          const rect = arena.getBoundingClientRect();
          const size = 64 + rngRef.current.int(20); // 64-84px (slightly smaller, more orbs)
          const margin = size / 2 + 10;
          const x = margin + rngRef.current.int(Math.max(1, Math.floor(rect.width - margin * 2)));
          const y = margin + rngRef.current.int(Math.max(1, Math.floor(rect.height - margin * 2)));
          orbsRef.current.push({ id: nextIdRef.current++, x, y, size, born: now, popped: false });
        }
      }
      setOrbs([...orbsRef.current]);

      if (left <= 0) {
        clearInterval(tick);
        finish();
      }
    }, 45);
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

  const pop = (orb, e) => {
    e.stopPropagation();
    if (phase !== "racing" || orb.popped) return;
    const age = Date.now() - orb.born;
    const decay = 1 - age / ORB_LIFETIME_MS;
    let points;
    if (decay > 0.65)      points = 3;
    else if (decay > 0.35) points = 2;
    else                   points = 1;
    orb.popped = true;
    orbsRef.current = orbsRef.current.filter((o) => o.id !== orb.id);
    setOrbs([...orbsRef.current]);
    setScore((s) => s + points);
    hit();
    sfx.click?.();
    setBurst({ x: orb.x, y: orb.y, t: Date.now() });
  };

  return (
    <ArenaShell title="CASCADE" tagline="Hit at the peak. Chain perfect timing." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="BEGIN" sublabel="Tap orbs while their ring is full"
                     onStart={begin} />
      )}

      {phase !== "ready" && (
        <div
          ref={arenaRef}
          style={{
            position: "relative", width: "100%", height: 360,
            background: "radial-gradient(circle at 30% 30%, rgba(96,165,250,0.08), rgba(15,23,42,0.6))",
            borderRadius: 14, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {orbs.map((orb) => {
            const age = Date.now() - orb.born;
            const decay = 1 - age / ORB_LIFETIME_MS;
            const scale = age < 200 ? age / 200 : 1;
            const ringSize = orb.size + 8;
            return (
              <div
                key={orb.id}
                onPointerDown={(e) => pop(orb, e)}
                style={{
                  position: "absolute",
                  left: orb.x - ringSize / 2,
                  top: orb.y - ringSize / 2,
                  width: ringSize, height: ringSize,
                  cursor: "pointer",
                  transform: `scale(${scale.toFixed(3)})`,
                  transition: "transform 0.04s linear",
                }}
              >
                {/* Decay ring */}
                <svg width={ringSize} height={ringSize} style={{ position: "absolute", inset: 0 }}>
                  <circle
                    cx={ringSize / 2} cy={ringSize / 2}
                    r={(ringSize - 6) / 2}
                    fill="none"
                    stroke={accent.hue}
                    strokeWidth="2"
                    strokeDasharray={Math.PI * (ringSize - 6)}
                    strokeDashoffset={Math.PI * (ringSize - 6) * (1 - decay)}
                    style={{ filter: `drop-shadow(0 0 6px ${accent.glow})`, transition: "stroke-dashoffset 0.05s linear" }}
                  />
                </svg>
                {/* Geometric orb body — hexagon-stack */}
                <div style={{
                  position: "absolute", left: 4, top: 4,
                  width: orb.size, height: orb.size,
                  borderRadius: orb.size / 4,
                  background: `linear-gradient(135deg, ${accent.hue}, ${accent.hue}88)`,
                  boxShadow: `inset 0 0 20px rgba(255,255,255,0.2), 0 0 16px ${accent.glow}`,
                  transform: "rotate(45deg)",
                }}>
                  <div style={{
                    position: "absolute", inset: "20%",
                    borderRadius: "20%",
                    border: "2px solid rgba(255,255,255,0.5)",
                    transform: "rotate(-45deg)",
                  }} />
                </div>
              </div>
            );
          })}
          {burst && <ParticleBurst at={burst} accent={accent} n={6} />}
        </div>
      )}

      {phase === "done" && (
        <div style={{
          textAlign: "center", padding: "20px 0",
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 800, fontSize: 32, color: accent.hue,
          textShadow: `0 0 20px ${accent.glow}`,
        }}>
          {score} <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>FINAL</span>
        </div>
      )}
    </ArenaShell>
  );
}
