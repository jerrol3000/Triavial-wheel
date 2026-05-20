import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Memorize — show 5-7 emoji for 1.4 seconds, then hide them. A probe
// emoji appears: was it in the set? Yes / No. New round, set grows
// by 1 every 3 rounds. 15-second window. Score = correct yes/no.
//
// Seeded set + probe so both players see the IDENTICAL trial sequence.
// Wrong answer = no score (no negative), but you can't lock-in your
// answer until the set has been hidden — prevents pattern-tap spam.
//
// Why it's fun: working-memory load + time pressure. The "is this in
// the set?" trial format is the canonical n-back style cognitive
// challenge, and you can FEEL yourself getting smarter (or
// embarrassed) across the 15 seconds.

const DURATION_MS = 15000;
const FLASH_MS = 1400;
const POOL = ["🍕","🍔","🍟","🌮","🍣","🍩","🍎","🍌","🍇","🍉","🥑","🥕","🌽","🥨","🧀","🥐","🍪","🎂","🍰","🍦","🍫","🍿","🥒","🥦","🍑","🍓","🥝","🍒","🥭","🫐","🥥","🍐"];

function buildRound(rng, roundIdx) {
  // Set size grows from 5 to 7 over the first 6 rounds, then caps.
  const size = Math.min(7, 5 + Math.floor(roundIdx / 3));
  const shuffled = [...POOL];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const set = shuffled.slice(0, size);
  // 50/50: probe is in the set or not.
  const inSet = rng.int(2) === 0;
  const probe = inSet ? set[rng.int(set.length)] : shuffled[size + rng.int(shuffled.length - size)];
  return { set, probe, answer: inSet };
}

export default function Memorize({ onComplete, seed }) {
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
  };

  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const left = Math.max(0, DURATION_MS - (Date.now() - startRef.current));
      setRemaining(left);
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

  const answer = (guess) => {
    if (phase !== "racing" || step !== "probe" || !round) return;
    if (guess === round.answer) {
      setScore((s) => s + 1);
      setFlash("good");
      sfx.correct?.();
    } else {
      setFlash("bad");
      sfx.wrong?.();
    }
    setTimeout(() => setFlash(null), 180);
    const nextIdx = roundIdx + 1;
    setRoundIdx(nextIdx);
    next(nextIdx);
  };

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>👁️ Memorize</span>
        {phase === "racing" && (
          <span className="tw-pill" style={{ fontSize: 11 }}>
            ⏱ {(remaining / 1000).toFixed(1)}s · ✓ {score}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
        Watch the set. Then: was the next emoji in it?
      </div>

      {phase === "ready" && (
        <button
          onClick={begin}
          style={{
            width: "100%", padding: "32px 16px",
            fontSize: 22, fontFamily: "Fredoka", fontWeight: 800,
            borderRadius: 18, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #6366f1, #ec4899)",
            color: "#fff",
          }}
        >
          Tap to start
        </button>
      )}

      {phase === "racing" && round && (
        <>
          <div style={{
            padding: "26px 16px", borderRadius: 16, marginBottom: 12,
            background: flash === "good" ? "rgba(16,185,129,0.25)"
                      : flash === "bad"  ? "rgba(239,68,68,0.25)"
                                         : "rgba(255,255,255,0.04)",
            minHeight: 92, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 36, gap: 8, flexWrap: "wrap",
            transition: "background 0.15s",
          }}>
            {step === "show"
              ? round.set.map((e, i) => <span key={i}>{e}</span>)
              : <span style={{ fontSize: 64 }}>{round.probe}</span>
            }
          </div>

          {step === "show" && (
            <div style={{ fontSize: 13, color: "var(--text-dim)", fontStyle: "italic" }}>
              Remember these…
            </div>
          )}
          {step === "probe" && (
            <div className="tw-row" style={{ gap: 8 }}>
              <button onClick={() => answer(true)}
                style={{
                  flex: 1, padding: "20px 0", borderRadius: 14,
                  border: "1px solid rgba(16,185,129,0.5)",
                  background: "linear-gradient(135deg, rgba(16,185,129,0.25), rgba(34,197,94,0.25))",
                  color: "#fff", fontFamily: "Fredoka", fontWeight: 800, fontSize: 18,
                  cursor: "pointer",
                }}
              >
                ✓ In set
              </button>
              <button onClick={() => answer(false)}
                style={{
                  flex: 1, padding: "20px 0", borderRadius: 14,
                  border: "1px solid rgba(239,68,68,0.5)",
                  background: "linear-gradient(135deg, rgba(239,68,68,0.25), rgba(244,63,94,0.25))",
                  color: "#fff", fontFamily: "Fredoka", fontWeight: 800, fontSize: 18,
                  cursor: "pointer",
                }}
              >
                ✕ Not in set
              </button>
            </div>
          )}
        </>
      )}

      {phase === "done" && (
        <div style={{ padding: "32px 16px", fontFamily: "Fredoka", fontSize: 22, fontWeight: 800 }}>
          ✓ {score} correct
        </div>
      )}
    </div>
  );
}
