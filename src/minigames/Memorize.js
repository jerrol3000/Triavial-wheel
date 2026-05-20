import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";
import {
  ArenaShell, HUDBar, StartButton, MinigameKeyframes, accentFor, useCombo,
} from "./_style";
import { playStinger } from "./_audio";

// Cipher — formerly "Memorize." Replaces the food-emoji probe ("was
// that taco in the set?") with abstract glyphs drawn programmatically:
// each glyph is a unique combination of a base shape (triangle, square,
// hexagon, circle, diamond) + a fill pattern (solid, ring, dotted,
// crosshatch, gradient) + a rotation. ~25 unique glyphs from a small
// generator function. Genuinely abstract — the player has to actually
// memorize, no shortcut from emoji familiarity.
//
//   • Flash 5-7 glyphs for ~1.3s. Hide. Probe glyph appears: IS IT
//     IN THE SET?
//   • Set size grows from 5 to 7 over the first 6 rounds.
//   • Combo system: chained correct answers within 1.6s build a
//     multiplier. ×3 combo and you get a "perfect-streak" badge.
//   • 50/50 in-set vs not-in-set distribution.

const DURATION_MS = 15000;
const FLASH_MS = 1300;

// Glyph dimensions: each glyph = { shape, fill, rotation }.
const SHAPES = ["triangle", "square", "hex", "circle", "diamond"];
const FILLS = ["solid", "ring", "dotted", "lines", "split"];
const ROTATIONS = [0, 45, 90, 135];
function totalGlyphCount() { return SHAPES.length * FILLS.length * ROTATIONS.length; }
function decodeGlyph(idx) {
  const r = idx % ROTATIONS.length;
  const f = Math.floor(idx / ROTATIONS.length) % FILLS.length;
  const s = Math.floor(idx / (ROTATIONS.length * FILLS.length)) % SHAPES.length;
  return { shape: SHAPES[s], fill: FILLS[f], rotation: ROTATIONS[r] };
}

function buildRound(rng, roundIdx) {
  const setSize = Math.min(7, 5 + Math.floor(roundIdx / 3));
  const pool = Array.from({ length: totalGlyphCount() }, (_, i) => i);
  // Shuffle pool deterministically.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const set = pool.slice(0, setSize);
  const inSet = rng.int(2) === 0;
  const probe = inSet ? set[rng.int(set.length)] : pool[setSize + rng.int(pool.length - setSize - 1)];
  return { set, probe, answer: inSet };
}

function Glyph({ idx, size = 48, accent }) {
  const g = decodeGlyph(idx);
  const stroke = "rgba(255,255,255,0.9)";
  const fillSolid = accent?.hue || "#fcd34d";
  const inner = size * 0.7;
  return (
    <div style={{
      width: size, height: size,
      display: "flex", alignItems: "center", justifyContent: "center",
      transform: `rotate(${g.rotation}deg)`,
      filter: `drop-shadow(0 0 8px ${accent?.glow || "rgba(252,211,77,0.4)"})`,
    }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <pattern id={`p-dots-${idx}`} width="4" height="4" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill={fillSolid} />
          </pattern>
          <pattern id={`p-lines-${idx}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" fill={fillSolid} />
          </pattern>
          <linearGradient id={`p-split-${idx}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="50%" stopColor={fillSolid} />
            <stop offset="50%" stopColor="rgba(255,255,255,0.15)" />
          </linearGradient>
        </defs>
        {(() => {
          const f = g.fill === "ring" ? "transparent"
                  : g.fill === "dotted" ? `url(#p-dots-${idx})`
                  : g.fill === "lines"  ? `url(#p-lines-${idx})`
                  : g.fill === "split"  ? `url(#p-split-${idx})`
                  :                       fillSolid;
          const sw = g.fill === "ring" ? 3 : 1.5;
          const cx = size / 2, cy = size / 2, r = inner / 2;
          if (g.shape === "circle") return <circle cx={cx} cy={cy} r={r} fill={f} stroke={stroke} strokeWidth={sw} />;
          if (g.shape === "square") {
            const x = cx - r, y = cy - r;
            return <rect x={x} y={y} width={r * 2} height={r * 2} fill={f} stroke={stroke} strokeWidth={sw} />;
          }
          if (g.shape === "diamond") {
            return <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} fill={f} stroke={stroke} strokeWidth={sw} />;
          }
          if (g.shape === "triangle") {
            return <polygon points={`${cx},${cy - r} ${cx + r * 0.9},${cy + r * 0.6} ${cx - r * 0.9},${cy + r * 0.6}`} fill={f} stroke={stroke} strokeWidth={sw} />;
          }
          // hex
          const pts = [];
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 2;
            pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`);
          }
          return <polygon points={pts.join(" ")} fill={f} stroke={stroke} strokeWidth={sw} />;
        })()}
      </svg>
    </div>
  );
}

export default function Memorize({ onComplete, seed }) {
  const accent = accentFor("memorize");
  const rngRef = useRef(null);
  const [phase, setPhase] = useState("ready");
  const [step, setStep] = useState("show"); // show | probe
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [roundIdx, setRoundIdx] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [flash, setFlash] = useState(null);
  const startRef = useRef(0);
  const flashTimerRef = useRef(null);
  const doneRef = useRef(false);
  const { combo, hit, miss } = useCombo(1600);

  const next = (idx) => {
    if (!rngRef.current) return;
    const r = buildRound(rngRef.current, idx);
    setRound(r);
    setStep("show");
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setStep("probe"), FLASH_MS);
  };

  const begin = () => {
    if (phase !== "ready") return;
    rngRef.current = makeRng(seed);
    setPhase("racing");
    startRef.current = Date.now();
    next(0);
    playStinger("memorize");
  };

  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const left = Math.max(0, DURATION_MS - (Date.now() - startRef.current));
      setRemaining(left);
      if (left <= 0) { clearInterval(tick); finish(); }
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

  const answer = (guess) => {
    if (phase !== "racing" || step !== "probe" || !round) return;
    if (guess === round.answer) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
      hit();
    } else {
      setFlash("bad");
      sfx.wrong?.();
      miss();
    }
    setTimeout(() => setFlash(null), 180);
    const nextIdx = roundIdx + 1;
    setRoundIdx(nextIdx);
    next(nextIdx);
  };

  return (
    <ArenaShell title="CIPHER" tagline="Memorize the set. Was the probe in it?" accent={accent}>
      <MinigameKeyframes />
      <HUDBar remainingMs={remaining} score={score} combo={combo} accent={accent} />

      {phase === "ready" && (
        <StartButton accent={accent} label="DECRYPT"
                     sublabel="Glyphs flash briefly. Confirm or deny the probe."
                     onStart={begin} />
      )}

      {phase === "racing" && round && (
        <>
          <div style={{
            padding: 18, borderRadius: 14, marginBottom: 12,
            background: flash === "good" ? "rgba(74,222,128,0.10)"
                      : flash === "bad"  ? "rgba(248,113,113,0.10)"
                                         : "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.05)",
            transition: "background 0.15s",
            minHeight: 110, display: "flex", alignItems: "center", justifyContent: "center",
            flexWrap: "wrap", gap: 10,
          }}>
            {step === "show"
              ? round.set.map((g, i) => <Glyph key={i} idx={g} size={42} accent={accent} />)
              : <Glyph idx={round.probe} size={80} accent={accent} />
            }
          </div>

          {step === "show" && (
            <div style={{ fontSize: 11, letterSpacing: 2, color: "rgba(255,255,255,0.45)", textAlign: "center", textTransform: "uppercase" }}>
              Memorize…
            </div>
          )}
          {step === "probe" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => answer(true)}
                style={{
                  flex: 1, padding: "20px 0", borderRadius: 12,
                  border: "1px solid rgba(74,222,128,0.4)",
                  background: "rgba(74,222,128,0.08)",
                  color: "#fff", fontFamily: '"Inter", sans-serif', fontWeight: 800, fontSize: 14,
                  letterSpacing: 2, textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                In set
              </button>
              <button onClick={() => answer(false)}
                style={{
                  flex: 1, padding: "20px 0", borderRadius: 12,
                  border: "1px solid rgba(248,113,113,0.4)",
                  background: "rgba(248,113,113,0.08)",
                  color: "#fff", fontFamily: '"Inter", sans-serif', fontWeight: 800, fontSize: 14,
                  letterSpacing: 2, textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Not in set
              </button>
            </div>
          )}
        </>
      )}

      {phase === "done" && (
        <div style={{
          textAlign: "center", padding: "20px 0",
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 800, fontSize: 32, color: accent.hue,
          textShadow: `0 0 20px ${accent.glow}`,
        }}>
          {score} <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>DECRYPTED</span>
        </div>
      )}
    </ArenaShell>
  );
}
