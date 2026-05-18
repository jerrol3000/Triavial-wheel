import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Confetti from "react-confetti";
import { startMatch, recordPlayerResult, nextPlayerTurn, resetMatch } from "../store/multiplayerSlice";
import { startRound, setQuestions, fetchRoundQuestions, resetRound } from "../store/gameSlice";
import { setView, pushToast } from "../store/uiSlice";
import { safeNavigate } from "../utils/navigate";
import { unlockAchievement, markAchievement } from "../store/statsSlice";
import QuestionCard from "./QuestionCard";
import { sfx } from "../utils/sound";
import { ACHIEVEMENT_MAP } from "../data/achievements";

// Pass-and-Play: one device, 2–6 players take turns. Smoother handoff than v1
// — animated VS splash, running scoreboard at the top, auto-advance between turns.
export default function Multiplayer() {
  const dispatch = useDispatch();
  const mp = useSelector((s) => s.multiplayer);
  const game = useSelector((s) => s.game);
  const user = useSelector((s) => s.auth.user);

  const [names, setNames] = useState(["", ""]);
  const [qpp, setQpp] = useState(3);
  const [phase, setPhase] = useState("setup"); // setup | splash | playing | finished
  const splashTimerRef = useRef(null);

  useEffect(() => () => { if (splashTimerRef.current) clearTimeout(splashTimerRef.current); }, []);

  const begin = async () => {
    const cleaned = names.map((n) => n.trim()).filter(Boolean);
    if (cleaned.length < 2) {
      dispatch(pushToast({ icon: "⚠️", title: "Need at least 2 players" }));
      return;
    }
    sfx.click();
    dispatch(startMatch({ players: cleaned, questionsPerPlayer: qpp }));
    const totalQs = cleaned.length * qpp;
    const r = await dispatch(fetchRoundQuestions({ categoryId: null, mode: "medium", amount: totalQs }));
    dispatch(startRound({ categoryId: null, mode: "medium" }));
    dispatch(setQuestions(r.payload || []));
    goToSplash();
  };

  const setName = (i, v) => { const next = names.slice(); next[i] = v; setNames(next); };
  const addPlayer = () => setNames([...names, ""]);
  const removePlayer = (i) => setNames(names.filter((_, idx) => idx !== i));

  // VS splash auto-advances after 1.6s — no more "I'm ready" button friction.
  const goToSplash = () => {
    setPhase("splash");
    if (splashTimerRef.current) clearTimeout(splashTimerRef.current);
    splashTimerRef.current = setTimeout(() => setPhase("playing"), 1600);
  };

  const onAnswered = (wasCorrect) => {
    if (wasCorrect === null) {
      dispatch(recordPlayerResult({ score: 0, correct: false }));
    } else {
      const speedBonus = Math.max(0, Math.round((game.timeLeft / 20) * 50));
      const points = wasCorrect ? 100 + speedBonus : 0;
      if (wasCorrect) sfx.correct(); else sfx.wrong();
      dispatch(recordPlayerResult({ score: points, correct: !!wasCorrect }));
    }
    const isLastOverall = mp.questionIndex + 1 >= mp.players.length * mp.questionsPerPlayer;
    setTimeout(() => {
      if (isLastOverall) {
        sfx.win();
        setPhase("finished");
        const sorted = mp.players.slice().sort((a, b) => b.score - a.score);
        // Pass-and-play winner check. markAchievement queues the
        // slide-in AchievementUnlock celebration so no extra toast
        // is needed here. Trim + lowercase the comparison since
        // the player can input any name during the pass-and-play
        // round and the user.username casing might differ.
        const winnerName = (sorted[0]?.name || "").trim().toLowerCase();
        const me = (user?.username || "").trim().toLowerCase();
        if (user && winnerName && winnerName === me) {
          dispatch(markAchievement("friend_winner"));
          dispatch(unlockAchievement("friend_winner"));
        }
      } else {
        dispatch(nextPlayerTurn());
        goToSplash();
      }
    }, 1100); // pause shows result before passing device
  };

  const podiumOrder = mp.players.slice().sort((a, b) => b.score - a.score);
  const winnerScore = podiumOrder[0]?.score ?? 0;
  const isTieAtTop = podiumOrder.filter((p) => p.score === winnerScore).length > 1;

  const quit = () => {
    // Pre-match (setup phase / finished phase): just leave, no penalty.
    if (phase === "setup" || phase === "finished") {
      dispatch(resetRound()); dispatch(resetMatch()); dispatch(setView("home"));
      return;
    }
    // Mid-match (splash / playing): safeNavigate handles confirm + −1 life.
    dispatch(resetMatch());
    dispatch(safeNavigate("home"));
  };

  return (
    <div className="tw-col">
      <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }} onClick={quit}>← Quit</button>

      {/* Always show the live scoreboard during play */}
      {(phase === "playing" || phase === "splash") && mp.players.length > 0 && (
        <Scoreboard mp={mp} />
      )}

      {phase === "setup" && (
        <div className="tw-card tw-fade-in">
          <div style={{ fontFamily: "Fredoka", fontSize: 24, fontWeight: 700 }}>🛋️ Pass & Play</div>
          <div style={{ color: "var(--text-dim)", marginBottom: 14 }}>
            Take turns on the same device. Up to 6 players.
          </div>
          {names.map((n, i) => (
            <div key={i} className="tw-row" style={{ marginBottom: 8 }}>
              <input
                className="tw-input"
                placeholder={`Player ${i + 1} name`}
                value={n}
                onChange={(e) => setName(i, e.target.value.slice(0, 16))}
                maxLength={16}
                autoFocus={i === 0}
              />
              {names.length > 2 && (
                <button className="tw-pill" style={{ cursor: "pointer" }} onClick={() => removePlayer(i)}>✕</button>
              )}
            </div>
          ))}
          {names.length < 6 && (
            <button className="tw-btn ghost block" onClick={addPlayer} style={{ marginTop: 6 }}>+ Add player</button>
          )}
          <div className="tw-row" style={{ marginTop: 14, justifyContent: "space-between", flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-dim)" }}>Questions per player</span>
            <div className="tw-row" style={{ gap: 6 }}>
              {[3, 5, 7].map((n) => (
                <button key={n} className="tw-pill"
                        style={{ cursor: "pointer", background: qpp === n ? "linear-gradient(135deg, var(--primary), var(--primary-2))" : undefined, border: qpp === n ? "none" : undefined, color: "#fff" }}
                        onClick={() => setQpp(n)}>{n}</button>
              ))}
            </div>
          </div>
          <button className="tw-btn block" style={{ marginTop: 14 }} onClick={begin}>Start match</button>
        </div>
      )}

      {phase === "splash" && mp.players[mp.currentPlayer] && (
        <VsSplash
          current={mp.players[mp.currentPlayer]}
          questionNum={mp.questionIndex + 1}
          totalQuestions={mp.players.length * mp.questionsPerPlayer}
        />
      )}

      {phase === "playing" && (
        <div key={`turn-${mp.questionIndex}`} className="tw-fade-in">
          <div className="tw-card" style={{ marginBottom: 12, padding: 10, textAlign: "center", background: "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(236,72,153,0.2))" }}>
            <span style={{ fontFamily: "Fredoka", fontSize: 14, color: "var(--text-dim)" }}>NOW PLAYING</span>
            <span style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginLeft: 8 }}>
              {mp.players[mp.currentPlayer]?.name}
            </span>
          </div>
          <QuestionCard hidePowerups onAnswered={(c) => onAnswered(c)} />
        </div>
      )}

      {phase === "finished" && (
        <>
          {!isTieAtTop && <Confetti recycle={false} numberOfPieces={300} />}
          <div className="tw-card tw-fade-in" style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "Fredoka", fontSize: 30, fontWeight: 700 }}>🏆 Final Scores</div>
            <div style={{ color: "var(--text-dim)", marginBottom: 14 }}>
              {isTieAtTop ? "It's a tie at the top!" : `${podiumOrder[0].name} wins!`}
            </div>
            <div className="tw-podium">
              {podiumOrder.map((p, i) => (
                <div key={p.name + i} className={`tw-podium-row rank-${i + 1}`}>
                  <span className="tw-podium-rank">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                  </span>
                  <span className="tw-podium-name">{p.name}</span>
                  <span className="tw-podium-right">{p.correctCount} ✓</span>
                  <span className="tw-podium-score">{p.score}</span>
                </div>
              ))}
            </div>
            <div className="tw-row" style={{ justifyContent: "center", marginTop: 18 }}>
              <button className="tw-btn" onClick={() => { dispatch(resetRound()); dispatch(resetMatch()); setPhase("setup"); setNames(mp.players.map((p) => p.name)); }}>
                Rematch (same crew)
              </button>
              <button className="tw-btn ghost" onClick={() => { dispatch(resetRound()); dispatch(resetMatch()); dispatch(setView("home")); }}>
                Home
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Scoreboard({ mp }) {
  return (
    <div className="tw-mp-scoreboard">
      {mp.players.map((p, i) => {
        const active = i === mp.currentPlayer;
        return (
          <div key={p.name + i} className={`tw-mp-score ${active ? "active" : ""}`}>
            <div className="tw-mp-score-name">{p.name}</div>
            <div className="tw-mp-score-value">{p.score}</div>
          </div>
        );
      })}
    </div>
  );
}

function VsSplash({ current, questionNum, totalQuestions }) {
  return (
    <div className="tw-vs-splash">
      <div style={{ color: "var(--text-dim)", fontSize: 14, letterSpacing: 1 }}>PASS THE DEVICE TO</div>
      <div className="tw-vs-name">{current.name}</div>
      <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Question {questionNum} of {totalQuestions}</div>
    </div>
  );
}
