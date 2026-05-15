import React, { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { decode } from "html-entities";
import {
  tickTimer, answerSelected, nextQuestion, skipQuestion,
  usePowerupFifty, usePowerupFreeze, usePowerupDouble,
} from "../store/gameSlice";
import { usePowerup, addCoins } from "../store/statsSlice";
import { sfx } from "../utils/sound";
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
    sfx[a === correct ? "correct" : "wrong"]();
    dispatch(answerSelected(a));
    if (a === correct) dispatch(addCoins(5));
    if (onAnswered) onAnswered(a === correct, a);
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

  const usePow = (id) => {
    if ((powerups[id] || 0) <= 0) return;
    sfx.powerup();
    dispatch(usePowerup(id));
    if (id === "fifty") dispatch(usePowerupFifty());
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

      <div className="tw-card">
        <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <span className="tw-pill">Q {game.index + 1} / {game.questions.length}</span>
          <span className="tw-pill tw-streak-flame">🔥 {game.streak}</span>
          <span className="tw-pill">★ {game.score}</span>
        </div>
        <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 600, lineHeight: 1.3, margin: "10px 0 18px" }}>
          {decode(String(q.question))}
        </div>

        {game.answers.map((a) => {
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
            >
              {a}
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
