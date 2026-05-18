import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { fetchDailyMeta, fetchDailyQuestions, submitDaily, fetchDailyLeaderboard, setLastResult, resetDaily } from "../store/dailySlice";
import { startRound, setQuestions, fetchRoundQuestions, resetRound } from "../store/gameSlice";
import { setView, pushToast } from "../store/uiSlice";
import { safeNavigate } from "../utils/navigate";
import { addXp, addCoins, recordGame, submitGame, unlockAchievement, markAchievement } from "../store/statsSlice";
import QuestionCard from "./QuestionCard";
import Icon from "./Icon";
import { sfx } from "../utils/sound";
import { buildDailyShareText, shareText } from "../utils/share";
import { ACHIEVEMENT_MAP } from "../data/achievements";

const QPR = 10;

export default function Daily() {
  const dispatch = useDispatch();
  const store = useStore();
  const daily = useSelector((s) => s.daily);
  const isFinished = useSelector((s) => s.game.finished);
  const currentDailyStreak = useSelector((s) => s.stats.current_daily_streak);
  const longestDailyStreak = useSelector((s) => s.stats.longest_daily_streak);

  const [phase, setPhase] = useState(daily.alreadyPlayed ? "result" : "intro");
  const startMsRef = useRef(0);
  const handledRef = useRef(false);

  useEffect(() => {
    dispatch(fetchDailyMeta());
    dispatch(fetchDailyLeaderboard());
    // Refresh meta when the tab is brought back to the foreground. Long
    // sessions can roll past midnight UTC otherwise — daily.date stays
    // stale and the user gets yesterday's already-played puzzle.
    const onVis = () => {
      if (document.visibilityState === "visible") {
        dispatch(fetchDailyMeta());
        dispatch(fetchDailyLeaderboard());
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [dispatch]);
  useEffect(() => { setPhase(daily.alreadyPlayed ? "result" : "intro"); }, [daily.alreadyPlayed]);

  const beginDaily = async () => {
    sfx.click();
    handledRef.current = false;
    const meta = await dispatch(fetchDailyQuestions({ seed: daily.seed || new Date().toISOString().slice(0,10), amount: QPR }));
    let qs = meta.payload?.results;
    if (!qs || !qs.length) {
      const r = await dispatch(fetchRoundQuestions({ categoryId: null, mode: "medium", amount: QPR }));
      qs = r.payload || [];
    }
    dispatch(startRound({ categoryId: null, mode: "medium" }));
    dispatch(setQuestions(qs));
    startMsRef.current = Date.now();
    setPhase("playing");
  };

  // End-of-round handler. Runs exactly once when the game is finished while we're playing.
  useEffect(() => {
    if (phase !== "playing") { handledRef.current = false; return; }
    if (!isFinished) return;
    if (handledRef.current) return;
    handledRef.current = true;

    const { game, stats, auth } = store.getState();
    const user = auth.user;
    const timeMs = Date.now() - startMsRef.current;
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

    // tryUnlock relies on markAchievement to (a) dedupe + (b) push
    // onto the AchievementUnlock queue so the slide-in toast fires.
    // Removed the old inline pushToast since it was double-toasting
    // every daily-streak unlock (the queue already shows one).
    const tryUnlock = (id) => {
      dispatch(markAchievement(id));
      if (user) dispatch(unlockAchievement(id));
    };

    // Perfect round inside the Daily: 10/10 questions correct.
    // Was missing — Play.js fired it for normal rounds but Daily
    // had its own end-of-round path that skipped the check.
    if (game.correct === game.questions.length && game.questions.length >= 10) {
      tryUnlock("perfect_round");
    }

    if (user) {
      // Use the server-computed `streak` from the submitDaily
      // response — was previously a `current_daily_streak + 1`
      // estimate from stale local state, which fired wrong-day or
      // skipped legitimate unlocks when the local cache lagged the
      // server (e.g., user skipped a day between sessions).
      dispatch(submitDaily({ score: game.score, correct: game.correct, total: game.questions.length, time_ms: timeMs }))
        .then((r) => {
          const newStreak = r?.payload?.streak;
          if (typeof newStreak === "number") {
            if (newStreak >= 3) tryUnlock("daily_3");
            if (newStreak >= 7) tryUnlock("daily_7");
            if (newStreak >= 30) tryUnlock("daily_30");
          }
          dispatch(fetchDailyLeaderboard());
        });
      dispatch(submitGame({
        score: game.score, correct: game.correct, incorrect: game.incorrect,
        xp_gained: xpGained, coins_gained: coinsGained, best_streak_run: game.bestStreakRun,
      }));
    } else {
      // Guest fallback — use the +1 estimate since there's no
      // server response to read from.
      const projected = (stats.current_daily_streak || 0) + 1;
      if (projected >= 3) tryUnlock("daily_3");
      if (projected >= 7) tryUnlock("daily_7");
      if (projected >= 30) tryUnlock("daily_30");
    }
    setPhase("result");
  }, [phase, isFinished, dispatch, store]);

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
              title="Back — forfeits the daily and costs 1 life if mid-round"
              onClick={() => { dispatch(resetDaily()); dispatch(safeNavigate("home")); }}>
        ← Back
      </button>

      {phase === "intro" && (
        <div className="tw-card" style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 28, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
            <Icon name="daily" size={30} /> Daily Challenge
          </div>
          <div style={{ color: "var(--text-dim)", margin: "6px 0 14px" }}>
            Same 10 questions for everyone, today only.<br />
            Date: <strong>{daily.date}</strong> · Category teaser: <strong>{daily.category?.option || "—"}</strong>
          </div>
          <div className="tw-grid-2" style={{ marginBottom: 14 }}>
            <div className="tw-stat"><div className="tw-stat-value">🔥 {currentDailyStreak}</div><div className="tw-stat-label">Current streak</div></div>
            <div className="tw-stat"><div className="tw-stat-value">🏅 {longestDailyStreak}</div><div className="tw-stat-label">Longest</div></div>
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
