import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo, ParticleBurst,
} from "./_style";
import { playStinger } from "./_audio";

// Intercept — formerly "Whack-a-Mole." Same surface mechanic (tap
// targets in a grid) but rebuilt as a tactical-feeling threat
// intercept exercise. No more cute hamster emoji.
//
//   • 3×3 grid of dark "sentry slots". Targets appear as glowing
//     geometric markers — square (RED) or circle (CYAN).
//   • TAP RED to neutralize: +1 + combo. TAP CYAN to skip (it
//     auto-defuses): no penalty, no points. Tapping CYAN incorrectly
//     breaks the combo and counts as a friendly-fire miss.
//   • A small fraction of targets are "armored" — they require two
//     taps. Worth +3 each. Visual: brighter pulse.
//   • Spawn rate accelerates over time. Multiple targets up at once
//     in the back half of the round.
//
// Cap unchanged (30) but achievable score now has tactical texture.
// Friendly-fire prevention adds the "wait before tapping" cognitive
// load that makes it feel mature, not button-mashy.

const DURATION_MS = 12000;
const TARGET_LIFETIME_MS = 1000;
const SPAWN_INTERVAL_MS = 600;

function rollKind(rng, elapsed) {
  // Mostly hostile (red), small fraction friendly (cyan), rare armored.
  const r = rng.int(100);
  // Armored chance ramps from 0% at start to 12% at end.
  const armoredChance = Math.min(12, Math.floor(elapsed / 1000));
  if (r < armoredChance) return "armored";
  if (r < 18 + armoredChance) return "friendly";
  return "hostile";
}

export default function Whack({ onComplete, seed }) {
  const accent = accentFor("whack");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [active, setActive] = useState({}); // cell idx → { kind, spawnedAt, hits, hit }
  const [burst, setBurst] = useState(null);
  const startRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(1200);

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    lastSpawnRef.current = startRef.current - SPAWN_INTERVAL_MS;
    playStinger("whack");
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startRef.current;
      const left = Math.max(0, DURATION_MS - elapsed);
      setRemaining(left);

      // Age out expired targets. Hostile/armored expiring without hit = combo break.
      setActive((prev) => {
        const next = { ...prev };
        let changed = false;
        let expiredHostile = 0;
        for (const cell of Object.keys(next)) {
          if (now - next[cell].spawnedAt > TARGET_LIFETIME_MS) {
            if ((next[cell].kind === "hostile" || next[cell].kind === "armored") && !next[cell].hit) expiredHostile++;
            delete next[cell];
            changed = true;
          }
        }
        if (expiredHostile > 0) miss();
        return changed ? next : prev;
      });

      // Spawn cadence: 600ms → 360ms over the round.
      const cadence = Math.max(360, SPAWN_INTERVAL_MS - elapsed / 35);
      if (now - lastSpawnRef.current >= cadence && left > 0) {
        lastSpawnRef.current = now;
        setActive((prev) => {
          const free = [];
          for (let i = 0; i < 9; i++) if (!prev[i]) free.push(i);
          if (!free.length) return prev;
          const cell = free[rngRef.current.int(free.length)];
          const kind = rollKind(rngRef.current, elapsed);
          return { ...prev, [cell]: { kind, spawnedAt: now, hits: 0, hit: false } };
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

  const tap = (cellIdx, e) => {
    e.stopPropagation();
    if (phase !== "racing") return;
    const target = active[cellIdx];
    if (!target || target.hit) return;
    if (target.kind === "friendly") {
      // Friendly fire — no points, combo break, brief shake.
      miss();
      sfx.wrong?.();
      setActive((prev) => {
        const next = { ...prev };
        next[cellIdx] = { ...target, hit: true, friendlyHit: true };
        setTimeout(() => {
          setActive((cur) => { const o = { ...cur }; delete o[cellIdx]; return o; });
        }, 200);
        return next;
      });
      return;
    }
    if (target.kind === "armored") {
      const hits = target.hits + 1;
      if (hits < 2) {
        setActive((prev) => ({ ...prev, [cellIdx]: { ...target, hits } }));
        sfx.click?.();
        return;
      }
      setScore((s) => s + 3);
      hit();
      sfx.coin?.();
    } else {
      setScore((s) => s + 1);
      hit();
      sfx.click?.();
    }
    setBurst({ x: 0, y: 0, t: Date.now(), cell: cellIdx });
    setActive((prev) => {
      const next = { ...prev, [cellIdx]: { ...target, hit: true } };
      setTimeout(() => {
        setActive((cur) => { const o = { ...cur }; delete o[cellIdx]; return o; });
      }, 160);
      return next;
    });
  };

  return (
    <ArenaShell title="INTERCEPT" tagline="Neutralize threats. Spare friendlies." accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="BEGIN"
                     sublabel="🟥 = hit · 🔷 = skip · armored = double-tap"
                     onStart={begin} />
      )}

      {phase !== "ready" && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6,
          padding: 6, borderRadius: 14,
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.05)",
        }}>
          {Array.from({ length: 9 }, (_, i) => {
            const t = active[i];
            return (
              <button
                key={i}
                onPointerDown={(e) => tap(i, e)}
                style={{
                  position: "relative",
                  aspectRatio: "1",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  overflow: "hidden",
                  cursor: "pointer",
                  animation: t?.friendlyHit ? "tw-shake 0.3s ease" : undefined,
                }}
              >
                {/* Sentry slot grid lines */}
                <div style={{
                  position: "absolute", inset: 4,
                  border: "1px dashed rgba(255,255,255,0.06)",
                  borderRadius: 8,
                }} />
                {t && <TargetMarker target={t} />}
              </button>
            );
          })}
        </div>
      )}

      {phase === "done" && (
        <div style={{
          textAlign: "center", padding: "20px 0",
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 800, fontSize: 32, color: accent.hue,
          textShadow: `0 0 20px ${accent.glow}`,
        }}>
          {score} <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>NEUTRALIZED</span>
        </div>
      )}
    </ArenaShell>
  );
}

function TargetMarker({ target }) {
  const isFriendly = target.kind === "friendly";
  const isArmored = target.kind === "armored";
  const color = isFriendly ? "#22d3ee" : isArmored ? "#fbbf24" : "#f43f5e";
  const glow = isFriendly ? "rgba(34,211,238,0.5)" : isArmored ? "rgba(251,191,36,0.6)" : "rgba(244,63,94,0.7)";
  const shape = isFriendly ? "circle" : "square";
  const damaged = isArmored && target.hits > 0;
  return (
    <div style={{
      position: "absolute", left: "50%", top: "50%",
      transform: `translate(-50%, -50%) scale(${target.hit ? 0 : 1})`,
      transition: "transform 0.15s cubic-bezier(0.3, 1.8, 0.4, 1)",
      filter: damaged ? "brightness(0.7) saturate(0.7)" : "none",
      animation: "tw-pop 0.18s ease-out",
    }}>
      <div style={{
        width: 40, height: 40,
        borderRadius: shape === "circle" ? "50%" : 6,
        background: `linear-gradient(135deg, ${color}, ${color}aa)`,
        boxShadow: `0 0 24px ${glow}, inset 0 0 8px rgba(255,255,255,0.3)`,
        border: `2px solid ${color}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
      }}>
        {isArmored && (
          <div style={{
            position: "absolute", inset: -4,
            border: `2px solid ${color}80`, borderRadius: 8,
            animation: "tw-combo-pulse 0.8s ease-in-out infinite",
          }} />
        )}
        <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>
          {isFriendly ? "◌" : isArmored ? "◆" : "■"}
        </div>
      </div>
    </div>
  );
}
