import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { startMatch, recordPlayerResult, nextPlayerTurn, resetMatch } from "../store/multiplayerSlice";
import { startRound, setQuestions, fetchRoundQuestions, resetRound, answerSelected } from "../store/gameSlice";
import { setView, pushToast } from "../store/uiSlice";
import { unlockAchievement, markAchievement } from "../store/statsSlice";
import QuestionCard from "./QuestionCard";
import { sfx } from "../utils/sound";
import { ACHIEVEMENT_MAP } from "../data/achievements";

export default function Multiplayer() {
  const dispatch = useDispatch();
  const mp = useSelector((s) => s.multiplayer);
  const game = useSelector((s) => s.game);
  const user = useSelector((s) => s.auth.user);

  const [names, setNames] = useState(["", ""]);
  const [qpp, setQpp] = useState(3);
  const [phase, setPhase] = useState("setup"); // setup | handoff | playing | finished

  const begin = async () => {
    const cleaned = names.map((n) => n.trim()).filter(Boolean);
    if (cleaned.length < 2) {
      dispatch(pushToast({ icon: "⚠️", title: "Add at least 2 players" }));
      return;
    }
    sfx.click();
    dispatch(startMatch({ players: cleaned, questionsPerPlayer: qpp }));
    const totalQs = cleaned.length * qpp;
    const r = await dispatch(fetchRoundQuestions({ categoryId: null, mode: "medium", amount: totalQs }));
    dispatch(startRound({ categoryId: null, mode: "medium" }));
    dispatch(setQuestions(r.payload || []));
    setPhase("handoff");
  };

  const setName = (i, v) => { const next = names.slice(); next[i] = v; setNames(next); };
  const addPlayer = () => setNames([...names, ""]);
  const removePlayer = (i) => setNames(names.filter((_, idx) => idx !== i));

  // After each answer, record into multiplayer state then advance.
  // We use a fixed scoring per-question in MP (game.score is cumulative across the whole round,
  // not per-player, so we can't reuse it directly here).
  const onAnswered = (wasCorrect, picked) => {
    if (wasCorrect === null) {
      dispatch(recordPlayerResult({ score: 0, correct: false }));
    } else {
      const speedBonus = Math.max(0, Math.round((game.timeLeft / 20) * 50));
      const points = wasCorrect ? 100 + speedBonus : 0;
      dispatch(recordPlayerResult({ score: points, correct: !!wasCorrect }));
    }
    const isLastOverall = mp.questionIndex + 1 >= mp.players.length * mp.questionsPerPlayer;
    setTimeout(() => {
      if (isLastOverall) {
        sfx.win();
        setPhase("finished");
        // Achievement: friend_winner — unlock for logged-in user if they're top
        const sorted = mp.players.slice().sort((a, b) => b.score - a.score);
        if (user && sorted[0] && sorted[0].name === user.username) {
          dispatch(markAchievement("friend_winner"));
          dispatch(unlockAchievement("friend_winner"));
          const def = ACHIEVEMENT_MAP["friend_winner"];
          dispatch(pushToast({ icon: def.icon, title: def.title, text: def.desc }));
        }
      } else {
        dispatch(nextPlayerTurn());
        setPhase("handoff");
      }
    }, 600);
  };

  // Reset internal game per-player so score doesn't leak between turns
  const beginTurn = () => {
    sfx.click();
    setPhase("playing");
  };

  const podiumOrder = mp.players.slice().sort((a, b) => b.score - a.score);

  return (
    <div className="tw-col">
      <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }}
              onClick={() => { dispatch(resetRound()); dispatch(resetMatch()); dispatch(setView("home")); }}>
        ← Quit match
      </button>

      {phase === "setup" && (
        <div className="tw-card">
          <div style={{ fontFamily: "Fredoka", fontSize: 24, fontWeight: 700 }}>👥 Pass & Play</div>
          <div style={{ color: "var(--text-dim)", marginBottom: 14 }}>
            Take turns on one device. Up to 6 players.
          </div>
          {names.map((n, i) => (
            <div key={i} className="tw-row" style={{ marginBottom: 8 }}>
              <input className="tw-input" placeholder={`Player ${i + 1}`} value={n} onChange={(e) => setName(i, e.target.value)} />
              {names.length > 2 && <button className="tw-pill" style={{ cursor: "pointer" }} onClick={() => removePlayer(i)}>✕</button>}
            </div>
          ))}
          {names.length < 6 && (
            <button className="tw-btn ghost block" onClick={addPlayer} style={{ marginTop: 6 }}>+ Add player</button>
          )}
          <div className="tw-row" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-dim)" }}>Questions per player</span>
            <div className="tw-row">
              {[3, 5, 7].map((n) => (
                <button key={n} className="tw-pill" style={{ cursor: "pointer", background: qpp === n ? "rgba(124,58,237,0.4)" : undefined }}
                        onClick={() => setQpp(n)}>{n}</button>
              ))}
            </div>
          </div>
          <button className="tw-btn block" style={{ marginTop: 14 }} onClick={begin}>Start match</button>
        </div>
      )}

      {phase === "handoff" && mp.players[mp.currentPlayer] && (
        <div className="tw-card" style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 22 }}>Pass the device to</div>
          <div style={{ fontFamily: "Fredoka", fontSize: 36, fontWeight: 700, margin: "10px 0" }}>
            {mp.players[mp.currentPlayer].name}
          </div>
          <div style={{ color: "var(--text-dim)" }}>
            Question {mp.questionIndex + 1} of {mp.players.length * mp.questionsPerPlayer}
          </div>
          <button className="tw-btn block" style={{ marginTop: 14 }} onClick={beginTurn}>I'm ready</button>
        </div>
      )}

      {phase === "playing" && <QuestionCard hidePowerups onAnswered={(c) => onAnswered(c)} />}

      {phase === "finished" && (
        <div className="tw-card" style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 28, fontWeight: 700 }}>🏆 Final scores</div>
          {podiumOrder.map((p, i) => (
            <div key={p.name + i} className="tw-row" style={{ justifyContent: "space-between", padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontWeight: 600 }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "·"} {p.name}</span>
              <span>{p.correctCount} right · <strong>{p.score}</strong></span>
            </div>
          ))}
          <div className="tw-row" style={{ justifyContent: "center", marginTop: 14 }}>
            <button className="tw-btn" onClick={() => { dispatch(resetRound()); dispatch(resetMatch()); setPhase("setup"); }}>
              Rematch
            </button>
            <button className="tw-btn ghost" onClick={() => { dispatch(resetRound()); dispatch(resetMatch()); dispatch(setView("home")); }}>
              Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
