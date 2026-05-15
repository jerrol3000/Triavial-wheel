import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchDailyMeta, fetchDailyQuestions, submitDaily, fetchDailyLeaderboard, setLastResult, resetDaily } from "../store/dailySlice";
import { startRound, setQuestions, fetchRoundQuestions, resetRound } from "../store/gameSlice";
import { setView, pushToast } from "../store/uiSlice";
import { addXp, addCoins, recordGame, submitGame, unlockAchievement, markAchievement } from "../store/statsSlice";
import QuestionCard from "./QuestionCard";
import { sfx } from "../utils/sound";
import { buildDailyShareText, shareText } from "../utils/share";
import { ACHIEVEMENT_MAP } from "../data/achievements";

const QPR = 10;

export default function Daily() {
  const dispatch = useDispatch();
  const daily = useSelector((s) => s.daily);
  const game = useSelector((s) => s.game);
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);

  const [phase, setPhase] = useState(daily.alreadyPlayed ? "result" : "intro");
  const [startMs, setStartMs] = useState(0);
  const [endHandled, setEndHandled] = useState(false);

  useEffect(() => { dispatch(fetchDailyMeta()); dispatch(fetchDailyLeaderboard()); }, [dispatch]);
  useEffect(() => { setPhase(daily.alreadyPlayed ? "result" : "intro"); }, [daily.alreadyPlayed]);

  const beginDaily = async () => {
    sfx.click();
    setEndHandled(false);
    const meta = await dispatch(fetchDailyQuestions({ seed: daily.seed || new Date().toISOString().slice(0,10), amount: QPR }));
    let qs = meta.payload?.results;
    if (!qs || !qs.length) {
      // fall through to opentdb general
      const r = await dispatch(fetchRoundQuestions({ categoryId: null, mode: "medium", amount: QPR }));
      qs = r.payload || [];
    }
    dispatch(startRound({ categoryId: null, mode: "medium" }));
    dispatch(setQuestions(qs));
    setStartMs(Date.now());
    setPhase("playing");
  };

  // End of round handler
  useEffect(() => {
    if (phase !== "playing" || !game.finished || endHandled) return;
    setEndHandled(true);
    const timeMs = Date.now() - startMs;
    const result = {
      score: game.score,
      correct: game.correct,
      total: game.questions.length,
      time_ms: timeMs,
      perQuestion: game.perQuestion.slice(),
    };
    dispatch(setLastResult(result));

    const xpGained = Math.round(game.score / 8) + game.correct * 12;
    const coinsGained = game.correct * 10 + (game.bestStreakRun >= 5 ? 30 : 0);
    dispatch(addXp(xpGained));
    dispatch(addCoins(coinsGained));
    dispatch(recordGame({ correct: game.correct, incorrect: game.incorrect, best_streak_run: game.bestStreakRun }));

    // Daily streak achievements (we trust server-updated counter on next fetchStats)
    const tryUnlock = (id) => {
      if (!stats.achievements.find((a) => a.achievement_id === id)) {
        const def = ACHIEVEMENT_MAP[id];
        dispatch(markAchievement(id));
        if (user) dispatch(unlockAchievement(id));
        if (def) dispatch(pushToast({ icon: def.icon, title: def.title, text: def.desc, duration: 3500 }));
      }
    };
    if (stats.current_daily_streak + 1 >= 3) tryUnlock("daily_3");
    if (stats.current_daily_streak + 1 >= 7) tryUnlock("daily_7");
    if (stats.current_daily_streak + 1 >= 30) tryUnlock("daily_30");

    if (user) {
      dispatch(submitDaily({ score: game.score, correct: game.correct, total: game.questions.length, time_ms: timeMs }))
        .then(() => dispatch(fetchDailyLeaderboard()));
      dispatch(submitGame({
        score: game.score, correct: game.correct, incorrect: game.incorrect,
        xp_gained: xpGained, coins_gained: coinsGained, best_streak_run: game.bestStreakRun,
      }));
    }
    setPhase("result");
  }, [phase, game.finished, endHandled, dispatch, game, startMs, stats.current_daily_streak, stats.achievements, user]);

  const result = daily.lastResult;

  const onShare = async () => {
    if (!result) return;
    const text = buildDailyShareText({
      date: daily.date,
      score: result.score,
      correct: result.correct,
      total: result.total,
      results: result.perQuestion,
    });
    const out = await shareText({ title: "Trivia Wheel — Daily", text });
    if (out === "copied") dispatch(pushToast({ icon: "📋", title: "Copied to clipboard" }));
  };

  return (
    <div className="tw-col">
      <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }}
              onClick={() => { dispatch(resetRound()); dispatch(resetDaily()); dispatch(setView("home")); }}>
        ← Back
      </button>

      {phase === "intro" && (
        <div className="tw-card" style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 28, fontWeight: 700 }}>📅 Daily Challenge</div>
          <div style={{ color: "var(--text-dim)", margin: "6px 0 14px" }}>
            Same 10 questions for everyone, today only.<br />
            Date: <strong>{daily.date}</strong> · Category teaser: <strong>{daily.category?.option || "—"}</strong>
          </div>
          <div className="tw-grid-2" style={{ marginBottom: 14 }}>
            <div className="tw-stat"><div className="tw-stat-value">🔥 {stats.current_daily_streak}</div><div className="tw-stat-label">Current streak</div></div>
            <div className="tw-stat"><div className="tw-stat-value">🏅 {stats.longest_daily_streak}</div><div className="tw-stat-label">Longest</div></div>
          </div>
          <button className="tw-btn block" onClick={beginDaily}>Start daily</button>
        </div>
      )}

      {phase === "playing" && <QuestionCard hidePowerups />}

      {phase === "result" && (
        <>
          <div className="tw-card" style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "Fredoka", fontSize: 26, fontWeight: 700 }}>
              {result ? "Daily complete!" : "Already played today"}
            </div>
            {result && (
              <>
                <div className="tw-share-card" style={{ marginTop: 14, fontSize: 18 }}>
                  {`Trivia Wheel — Daily ${daily.date}\nScore: ${result.score}  ·  ${result.correct}/${result.total}\n${result.perQuestion.map((r) => r === true ? "🟩" : r === false ? "🟥" : "⬛").join("")}`}
                </div>
                <button className="tw-btn block" style={{ marginTop: 14 }} onClick={onShare}>Share result</button>
              </>
            )}
            {!result && (
              <div style={{ color: "var(--text-dim)" }}>Come back tomorrow for a new puzzle.</div>
            )}
          </div>

          <div className="tw-card">
            <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Today's leaderboard</div>
            {daily.leaderboard.length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>Be the first to play today!</div>
            ) : (
              daily.leaderboard.map((r, i) => (
                <div key={r.username + i} className="tw-row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <span>{i + 1}. {r.username}</span>
                  <span style={{ color: "var(--text-dim)" }}>{r.correct}/{r.total} · <strong style={{ color: "var(--text)" }}>{r.score}</strong></span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
