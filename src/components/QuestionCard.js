import React, { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { decode } from "html-entities";
import {
  tickTimer, answerSelected, nextQuestion, skipQuestion, TIME_PER_QUESTION,
  usePowerupFifty, usePowerupFreeze, usePowerupDouble,
} from "../store/gameSlice";
import { usePowerup, addCoins, markAchievement, unlockAchievement } from "../store/statsSlice";
import { sfx } from "../utils/sound";
import { haptic } from "../utils/haptics";
import { pushToast } from "../store/uiSlice";

const POW = [
  { id: "fifty",  icon: "✂️", action: "fifty"  },
  { id: "skip",   icon: "⏭️", action: "skip"   },
  { id: "freeze", icon: "❄️", action: "freeze" },
  { id: "double", icon: "✖️2", action: "double" },
];

export default function QuestionCard({ onAnswered, hidePowerups = false, onEmpty }) {
  const dispatch = useDispatch();
  const game = useSelector((s) => s.game);
  const powerups = useSelector((s) => s.stats.powerups);

  const tickRef = useRef();

  useEffect(() => {
    if (game.finished || game.showResult || !game.questions.length) return;
    tickRef.current = setInterval(() => dispatch(tickTimer()), 1000);
    return () => clearInterval(tickRef.current);
  }, [dispatch, game.finished, game.showResult, game.questions.length, game.index]);

  useEffect(() => {
    if (game.timeLeft <= 5 && game.timeLeft > 0 && !game.showResult) sfx.tick();
  }, [game.timeLeft, game.showResult]);

  // Keyboard shortcuts: 1–4 pick the corresponding answer, Enter advances after reveal.
  useEffect(() => {
    if (!game.questions.length || game.finished) return;
    const onKey = (e) => {
      // Skip if the user is typing in an input/textarea (e.g. chat).
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || e.isComposing) return;
      if (game.showResult) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
          e.preventDefault();
          handleNextRef.current && handleNextRef.current();
        }
        return;
      }
      const n = Number(e.key);
      if (!Number.isNaN(n) && n >= 1 && n <= game.answers.length) {
        const ans = game.answers[n - 1];
        if (!game.eliminated.includes(ans)) {
          e.preventDefault();
          handlePickRef.current && handlePickRef.current(ans);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game.questions.length, game.finished, game.showResult, game.answers, game.eliminated]);

  // Refs so the keyboard handler always sees the latest handlePick/handleNext closures.
  const handlePickRef = useRef(null);
  const handleNextRef = useRef(null);

  if (game.loading) return <div className="tw-card" style={{ textAlign: "center" }}>Loading questions...</div>;
  if (!game.questions.length) {
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No questions available</div>
        <div style={{ color: "var(--text-dim)", marginBottom: 14 }}>
          The question bank couldn't be reached. Spin again to retry.
        </div>
        {onEmpty && <button className="tw-btn block" onClick={onEmpty}>Back to wheel</button>}
      </div>
    );
  }

  const q = game.questions[game.index];
  if (!q) return null;

  const correct = decode(String(q.correct_answer));

  const handlePick = (a) => {
    if (game.showResult) return;
    const isCorrect = a === correct;
    sfx[isCorrect ? "correct" : "wrong"]();
    (isCorrect ? haptic.success : haptic.fail)();
    // Snapshot timeLeft BEFORE dispatching answerSelected (which
    // freezes the per-question timer). `timeLeft` is the remaining
    // seconds, so seconds-used = TIME_PER_QUESTION - timeLeft.
    const secondsToAnswer = Math.max(0, TIME_PER_QUESTION - game.timeLeft);
    dispatch(answerSelected(a));
    if (isCorrect) dispatch(addCoins(5));
    // first_correct fires the moment you land your first right answer
    // (was previously only fired at round end via Play.js' aggregate
    // check — feels delayed). speed_demon fires when a correct
    // answer comes in under 3 seconds. markAchievement de-dupes
    // server-side AND client-side so re-firing is harmless.
    if (isCorrect) {
      dispatch(markAchievement("first_correct"));
      dispatch(unlockAchievement("first_correct"));
      if (secondsToAnswer < 3) {
        dispatch(markAchievement("speed_demon"));
        dispatch(unlockAchievement("speed_demon"));
      }
    }
    if (onAnswered) onAnswered(isCorrect, a);
  };

  const handleNext = () => {
    sfx.click();
    if (game.index + 1 >= game.questions.length) {
      dispatch(nextQuestion()); // marks finished
      if (onAnswered) onAnswered(null, null); // signal end-of-round
    } else {
      dispatch(nextQuestion());
    }
  };

  handlePickRef.current = handlePick;
  handleNextRef.current = handleNext;

  const usePow = (id) => {
    if ((powerups[id] || 0) <= 0) return;
    sfx.powerup();
    dispatch(usePowerup(id));
    if (id === "fifty") {
      dispatch(usePowerupFifty());
      // The "fifty_used" achievement was never being dispatched
      // before — it's now the canonical "I tried a power-up" hook.
      // markAchievement de-dupes internally, so safe to call on every
      // 50/50 use even after the first.
      dispatch(markAchievement("fifty_used"));
      dispatch(unlockAchievement("fifty_used"));
    }
    if (id === "freeze") dispatch(usePowerupFreeze());
    if (id === "double") {
      dispatch(usePowerupDouble());
      dispatch(pushToast({ icon: "✖️", title: "Double points armed!", text: "Next correct answer scores 2x." }));
    }
    if (id === "skip") {
      dispatch(skipQuestion());
      if (onAnswered) onAnswered(null, null);
    }
  };

  const tCls =
    game.timeLeft <= 3 ? "urgent" :
    game.timeLeft <= 7 ? "warn" : "";

  return (
    <div className="tw-col tw-fade-in" key={game.index}>
      <div className={`tw-countdown ${tCls}`}>{game.timeLeft}</div>

      <div className="tw-card" style={{ position: "relative" }}>
        {game.showResult && game.lastScoreDelta > 0 && (
          <div className="tw-score-pop" key={`pop-${game.index}-${game.lastScoreDelta}`}>+{game.lastScoreDelta}</div>
        )}
        <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <span className="tw-pill" title="Question progress">Q {game.index + 1} / {game.questions.length}</span>
          <span className="tw-pill tw-streak-flame" title="Correct answers in a row">🔥 {game.streak}</span>
          <span className="tw-pill" title="Score this round">★ {game.score}</span>
        </div>

        {game.wrongStreak >= 2 && !game.showResult && (
          <div className="tw-warn-banner" title="Get one more wrong and the round ends">
            ⚠️ One more miss ends the round
          </div>
        )}
        <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 600, lineHeight: 1.3, margin: "10px 0 18px" }}>
          {decode(String(q.question))}
        </div>

        {game.answers.map((a, i) => {
          const eliminated = game.eliminated.includes(a);
          let cls = "tw-answer";
          if (game.showResult) {
            if (a === correct) cls += " correct";
            else if (a === game.selectedAnswer) cls += " wrong";
          }
          if (eliminated) cls += " eliminated";
          return (
            <button
              key={a}
              className={cls}
              disabled={game.showResult || eliminated}
              onClick={() => handlePick(a)}
              title={`Press ${i + 1} to pick`}
            >
              <span className="tw-answer-key" aria-hidden="true">{i + 1}</span>
              <span>{a}</span>
            </button>
          );
        })}

        {game.doubleArmed && !game.showResult && (
          <div style={{ textAlign: "center", color: "var(--warn)", fontWeight: 600, marginTop: 6 }}>
            ✖️ Next correct = 2x points
          </div>
        )}

        {!hidePowerups && !game.showResult && (
          <div className="tw-grid-2" style={{ marginTop: 14 }}>
            {POW.map((p) => (
              <button key={p.id} className="tw-btn ghost" disabled={(powerups[p.id] || 0) <= 0}
                      onClick={() => usePow(p.id)}>
                {p.icon} <span style={{ marginLeft: 6 }}>{p.id}</span>
                <span style={{ marginLeft: 6, opacity: 0.7 }}>x{powerups[p.id] || 0}</span>
              </button>
            ))}
          </div>
        )}

        {game.showResult && (
          <button className="tw-btn block" style={{ marginTop: 14 }} onClick={handleNext}>
            {game.index + 1 >= game.questions.length ? "See results →" : "Next →"}
          </button>
        )}
      </div>
    </div>
  );
}
