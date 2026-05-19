import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { setView, setModal } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import { snarkForAnswer } from "../utils/snark";
import { decode } from "html-entities";
import DailyShareCard from "./DailyShareCard";

// The viral entry point: spinlore.app/d/<YYYY-MM-DD>
//
// A friend opens this URL → they play 5 fast questions with no signup,
// no modals, no tutorials. At the end they see a Wordle-style result
// card with a one-tap share. The share text links back HERE so the
// loop closes and their friends can play the same 5 questions.
//
// Deliberately bare-bones compared to the full Daily.js used inside
// the authed app:
//   - 5 questions instead of 10 (90s play time, not 4 minutes)
//   - no powerups (the public surface should feel like a single
//     mechanic, not a feature buffet)
//   - no streak persistence for guests (local-only counter; sign up
//     to save it)
//   - server-side snark every question (the "personality" hook —
//     more important than any number on the result card)
//
// Reads the date from the URL pathname so a stale tab doesn't drift
// to "today" mid-session — whatever date you opened with is the date
// you play.

const GUEST_STREAK_KEY = "spinlore_public_daily_streak";

function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateFromPath() {
  if (typeof window === "undefined") return todayKey();
  const m = window.location.pathname.match(/^\/d\/(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : todayKey();
}

// Per-question screen. Renders one question + 4 choices + a 15s timer
// + the snark line AFTER answering. The snark is intentionally
// withheld until the answer is locked so it lands as feedback, not
// as accompaniment.
function Question({ q, index, total, onAnswer }) {
  const [picked, setPicked] = useState(null);
  const [snark, setSnark] = useState(null);
  const startMs = useRef(Date.now());
  const correct = q.correct_answer;

  // Soft 15s per-question cap. Hitting zero counts as a timeout (yellow
  // square on the share grid). Set briskly so the round feels snappy.
  const [remaining, setRemaining] = useState(15);
  useEffect(() => {
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (remaining === 0 && picked === null) {
      handlePick(null, /* timedOut */ true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const handlePick = (choice, timedOut) => {
    if (picked !== null) return;
    sfx.click();
    const ms = Date.now() - startMs.current;
    const isCorrect = !timedOut && choice === correct;
    if (isCorrect) sfx.correct?.(); else sfx.wrong?.();
    setPicked(timedOut ? "__timeout__" : choice);
    const line = snarkForAnswer({ correct: isCorrect, timedOut, ms });
    setSnark(line);
    // Give the player ~1.6s to read the snark + see green/red, then
    // advance. Time-out skip gets a longer pause (2.2s) because the
    // snark is the only feedback they get.
    setTimeout(() => onAnswer({ correct: isCorrect, timedOut: !!timedOut, ms }), timedOut ? 2200 : 1600);
  };

  // Build the 4-option list. Server returns `incorrect_answers[]` +
  // `correct_answer`; we shuffle deterministically by question id so
  // re-renders during the answer-reveal animation don't re-order the
  // buttons under the player's finger.
  const choices = React.useMemo(() => {
    const all = [...(q.incorrect_answers || []), correct];
    // Deterministic shuffle keyed by question id so all players see
    // the SAME order (essential for the share card emoji grid to be
    // comparable across friends).
    const seed = (q.id || 0) >>> 0;
    let s = seed;
    const shuffled = all.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [q.id]);

  return (
    <div className="tw-card">
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span className="tw-pill" style={{ fontSize: 12 }}>Q{index + 1} / {total}</span>
        <span className="tw-pill" style={{ fontSize: 12, color: remaining <= 5 ? "var(--bad)" : "var(--text-dim)" }}>
          ⏱ {remaining}s
        </span>
      </div>

      <div style={{ fontFamily: "Fredoka", fontSize: 20, fontWeight: 600, margin: "8px 0 14px", minHeight: 80 }}>
        {decode(q.question || "")}
      </div>

      <div className="tw-col" style={{ gap: 8 }}>
        {choices.map((c, i) => {
          const isPickedRight = picked !== null && c === correct;
          const isPickedWrong = picked === c && c !== correct;
          const isPicked = picked === c;
          const style = {
            textAlign: "left",
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: isPickedRight ? "rgba(16,185,129,0.25)"
                      : isPickedWrong ? "rgba(239,68,68,0.25)"
                      : (picked !== null && c === correct) ? "rgba(16,185,129,0.18)"
                      : "rgba(255,255,255,0.04)",
            color: isPicked || (picked !== null && c === correct) ? "#fff" : "var(--text)",
            cursor: picked === null ? "pointer" : "default",
            fontSize: 15,
            fontWeight: 600,
            transition: "background 0.15s ease",
          };
          return (
            <button key={i} style={style} onClick={() => handlePick(c, false)} disabled={picked !== null}>
              {decode(c)}
            </button>
          );
        })}
      </div>

      {snark && (
        <div
          style={{
            marginTop: 16, padding: "12px 14px", borderRadius: 12,
            background: "rgba(124,58,237,0.18)",
            border: "1px solid rgba(124,58,237,0.4)",
            fontSize: 15, fontWeight: 600, textAlign: "center",
            fontFamily: "Fredoka", letterSpacing: 0.3,
            animation: "fadeIn 0.25s ease",
          }}
        >
          {snark}
        </div>
      )}
    </div>
  );
}

export default function PublicDaily() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [date] = useState(parseDateFromPath());
  const [phase, setPhase] = useState("loading"); // loading | playing | done | error
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState([]); // bool per question; true=right, false=wrong, null=timeout
  const [plays, setPlays] = useState(null);

  // Track streak in localStorage for guests so the share card can flex
  // "7-day streak". Sign-in path persists to the real stats row.
  const computeGuestStreak = (todayResult) => {
    try {
      const raw = JSON.parse(localStorage.getItem(GUEST_STREAK_KEY) || "{}");
      const last = raw.last_date || null;
      const cur = raw.streak || 0;
      const [y, m, d] = date.split("-").map(Number);
      const yesterday = new Date(Date.UTC(y, m - 1, d));
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const ystr = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;
      const continued = last === ystr;
      const newStreak = continued ? cur + 1 : 1;
      if (last !== date) {
        localStorage.setItem(GUEST_STREAK_KEY, JSON.stringify({ last_date: date, streak: newStreak }));
      }
      return newStreak;
    } catch (e) { return 1; }
  };
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/daily/public/${date}`);
        if (cancelled) return;
        setQuestions(r.data.questions || []);
        setPhase("playing");
        // Fire-and-forget play counter — drives "X players played
        // today" on the share card. Failure is silent because the
        // game shouldn't depend on it.
        api.post("/daily/public/play").then((r2) => {
          if (!cancelled) setPlays(r2.data && r2.data.plays);
        }).catch(() => {});
      } catch (e) {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const onAnswer = ({ correct, timedOut }) => {
    const r = timedOut ? null : correct;
    const nextResults = [...results, r];
    setResults(nextResults);
    if (index + 1 < questions.length) {
      setIndex(index + 1);
    } else {
      // Round complete. Compute guest streak ONLY if they got at
      // least 1 right — defending against bots/abandoned plays
      // inflating the streak for nothing.
      const correctCount = nextResults.filter((x) => x === true).length;
      if (correctCount > 0) setStreak(computeGuestStreak(nextResults));
      setPhase("done");
    }
  };

  const onPlayAgain = () => {
    // Same date = same questions (deterministic) so "play again" just
    // resets the local state for a re-attempt. Useful for sharing
    // your BEST score, not a one-shot trial.
    setIndex(0);
    setResults([]);
    setPhase("playing");
  };

  if (phase === "loading") {
    return (
      <div className="tw-card" style={{ textAlign: "center", padding: 40 }}>
        <div className="tw-spinner" style={{ margin: "0 auto" }} />
        <div style={{ marginTop: 12, color: "var(--text-dim)" }}>Loading today's challenge…</div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "Fredoka", marginBottom: 8 }}>Couldn't load today's questions</div>
        <div style={{ color: "var(--text-dim)", marginBottom: 14 }}>Try again in a moment, or jump into the full app.</div>
        <button className="tw-btn block" onClick={() => { window.location.href = "/"; }}>Open Spinlore</button>
      </div>
    );
  }

  if (phase === "playing") {
    const q = questions[index];
    if (!q) return null;
    return (
      <div className="tw-col">
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>
            🎡 Spinlore · Daily
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
            {date} · 5 questions · 15s each
          </div>
        </div>
        <Question key={index} q={q} index={index} total={questions.length} onAnswer={onAnswer} />
      </div>
    );
  }

  // phase === "done"
  const correctCount = results.filter((x) => x === true).length;
  return (
    <div className="tw-col">
      <DailyShareCard
        date={date}
        correct={correctCount}
        total={questions.length}
        perQuestion={results}
        streak={streak}
        plays={plays}
        onPlayAgain={onPlayAgain}
      />

      {/* Sign-up nag — only for guests. Frames the value-prop as
          "save your streak + unlock more stuff" rather than gating. */}
      {!user && (
        <div className="tw-card" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(236,72,153,0.18))", borderColor: "rgba(236,72,153,0.4)", textAlign: "center" }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>Save your streak?</div>
          <div style={{ color: "var(--text-dim)", fontSize: 13, margin: "6px 0 12px" }}>
            Sign up to keep your daily streak, unlock VS mode, cosmetics, and friend challenges.
          </div>
          <button className="tw-btn block" onClick={() => dispatch(setModal({ name: "auth", data: { tab: "register", reason: "save_streak" } }))}>
            Sign up free
          </button>
          <button className="tw-pill" style={{ marginTop: 8, cursor: "pointer" }} onClick={() => {
            // Drop the public-daily route + drop into the full app
            // home view. History replace so the browser's Back button
            // doesn't bounce them back to the result card.
            if (typeof window !== "undefined") window.history.replaceState({}, "", "/");
            dispatch(setView("home"));
          }}>
            Explore the full app →
          </button>
        </div>
      )}

      {user && (
        <button className="tw-btn block" style={{ marginTop: 10 }} onClick={() => {
          if (typeof window !== "undefined") window.history.replaceState({}, "", "/");
          dispatch(setView("home"));
        }}>
          Back to Spinlore
        </button>
      )}
    </div>
  );
}
