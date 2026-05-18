import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import CelebrationEffect from "./CelebrationEffect";
import QuestionCard from "./QuestionCard";
import GameOver from "./GameOver";
import { resetRound } from "../store/gameSlice";
import { addXp, addCoins, recordGame, submitGame, unlockAchievement, markAchievement, grantPowerup } from "../store/statsSlice";
import { awardLocal } from "../store/badgesSlice";
import { setView, pushToast } from "../store/uiSlice";
import { safeNavigate } from "../utils/navigate";
import { sfx } from "../utils/sound";
import { haptic } from "../utils/haptics";
import { ACHIEVEMENT_MAP } from "../data/achievements";
import { levelForXp } from "../utils/level";

export default function Play() {
  const dispatch = useDispatch();
  const store = useStore();
  const isFinished = useSelector((s) => s.game.finished);
  const isLoading = useSelector((s) => s.game.loading);
  const hasQuestions = useSelector((s) => s.game.questions.length > 0);
  const [showConfetti, setShowConfetti] = useState(false);

  // Ref-based "handled" flag so the end-of-round logic runs exactly once per round,
  // regardless of how many re-renders the dispatches inside the effect trigger.
  const handledRef = useRef(false);

  // Watchdog: if we land on the Play screen with no questions and nothing in
  // flight (network blip, fetch failed, HMR), bounce back to the wheel after
  // 12s. Was 4s but slow mobile networks can legitimately take 5-8s for the
  // initial round fetch — the old timeout yanked the user home mid-load.
  useEffect(() => {
    if (isFinished || isLoading || hasQuestions) return;
    const t = setTimeout(() => {
      dispatch(resetRound());
      dispatch(setView("home"));
    }, 12000);
    return () => clearTimeout(t);
  }, [isFinished, isLoading, hasQuestions, dispatch]);

  useEffect(() => {
    if (!isFinished) { handledRef.current = false; return; }
    if (handledRef.current) return;
    handledRef.current = true;

    // Read state once, at the moment we run — no need to depend on it in the dep array.
    const { game, stats, auth } = store.getState();
    const user = auth.user;

    const xpGained = Math.round(game.score / 10) + game.correct * 10;
    // Base coin reward — what the previous version sent to the server.
    // Tracked separately from the FULL total so we know how much to
    // add locally for the base portion (the per-question + 5/correct
    // was already credited in QuestionCard as each question landed,
    // and the achievement/level-up bonuses are added below).
    const baseCoinsGained = game.correct * 8 + (game.bestStreakRun >= 5 ? 25 : 0);
    const prevLevel = stats.level;
    dispatch(addXp(xpGained));
    dispatch(addCoins(baseCoinsGained));
    dispatch(recordGame({ correct: game.correct, incorrect: game.incorrect, best_streak_run: game.bestStreakRun }));

    const unlockedIds = new Set(stats.achievements.map((a) => a.achievement_id));
    const newlyUnlocked = [];
    const tryUnlock = (id) => { if (!unlockedIds.has(id)) newlyUnlocked.push(id); };
    if (game.correct >= 1) tryUnlock("first_correct");
    if (game.bestStreakRun >= 5) tryUnlock("streak_5");
    if (game.bestStreakRun >= 10) tryUnlock("streak_10");
    if (game.correct === game.questions.length && game.questions.length >= 10) tryUnlock("perfect_round");
    if (game.score >= 1000) tryUnlock("high_score_1000");
    const nextLevel = levelForXp(stats.xp + xpGained);
    if (nextLevel >= 5) tryUnlock("level_5");
    if (nextLevel >= 10) tryUnlock("level_10");
    if (nextLevel >= 25) tryUnlock("level_25");

    let achievementCoins = 0;
    newlyUnlocked.forEach((id) => {
      const def = ACHIEVEMENT_MAP[id];
      // markAchievement both records the unlock AND pushes onto the
      // achievement-unlock queue — AchievementUnlock drains it and
      // plays the side-slide celebration (with its own sfx +
      // haptic), so the previous inline sfx.achieve + pushToast is
      // no longer needed (those now happen inside the component).
      dispatch(markAchievement(id));
      if (user) dispatch(unlockAchievement(id));
      if (def) {
        dispatch(addCoins(20));
        achievementCoins += 20;
      }
    });

    let levelUpCoins = 0;
    if (nextLevel > prevLevel) {
      sfx.levelup();
      const reward = nextLevel * 50;
      dispatch(addCoins(reward));
      levelUpCoins = reward;
      dispatch(grantPowerup({ id: "freeze", count: 1 }));
      dispatch(pushToast({ icon: "🆙", title: `Level ${nextLevel}!`, text: `+${reward} 🪙 and a freeze power-up`, duration: 3500 }));
    }

    // Spin cost is now performance-based — players don't pay to play,
    // they pay when they fail. "Failure" = either knocked out by the
    // 3-strikes elimination rule, OR ≥4 wrong (out of 10). Anything
    // better keeps your spin pool intact so good players have effectively
    // unlimited play. Pro never pays regardless.
    const QUESTIONS_TOTAL = game.questions.length || 10;
    const FAILURE_THRESHOLD = Math.max(3, Math.ceil(QUESTIONS_TOTAL * 0.4));
    const failed = !!game.eliminated_out || game.incorrect >= FAILURE_THRESHOLD;
    if (game.correct >= QUESTIONS_TOTAL * 0.7) {
      sfx.win();
      haptic.win();
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
    } else {
      sfx.lose();
      haptic.heavy();
    }
    // NOTE: NO spin debit here. Every spin is debited up-front via
    // /stats/use-free-spin when the wheel is clicked in Home.onSpin.
    // The previous failure-based debit (free_spins_spent: 1 here)
    // would have double-charged on top of that.

    if (user) {
      // Send the FULL coin total — every stream that was previously
      // added only client-side (per-question +5 from QuestionCard,
      // achievement +20s, level-up reward) now goes to the server so
      // a page refresh / fetchStats doesn't roll the coin count back
      // to "base only". Per-question +5 has already been credited
      // locally during the game, so we add it to the gained total here.
      const perQuestionCoins = game.correct * 5;
      const totalCoinsGained =
        baseCoinsGained + perQuestionCoins + achievementCoins + levelUpCoins;
      dispatch(submitGame({
        score: game.score,
        correct: game.correct,
        incorrect: game.incorrect,
        xp_gained: xpGained,
        coins_gained: totalCoinsGained,
        best_streak_run: game.bestStreakRun,
        // Send the round's category so the server can mark it
        // played-today and drive the "play N different categories"
        // daily quest. Without this, those quests were unwinnable
        // since submitGame omitted the field entirely.
        category_id: game.activeCategoryId || null,
      })).then((r) => {
        // Server tells us which badges were unlocked by this game; mirror
        // into local state and fire a celebration toast for each one.
        const data = r && r.payload;
        const newBadges = (data && data.new_badges) || [];
        if (newBadges.length) {
          dispatch(awardLocal(newBadges));
          for (const b of newBadges) {
            dispatch(pushToast({
              icon: b.icon || "🏅",
              title: `Badge unlocked: ${b.name}`,
              text: b.description || "Showcase it from your profile.",
              duration: 6000,
            }));
          }
        }
      });
    }
  }, [isFinished, dispatch, store]);

  if (isFinished) {
    return (
      <>
        <CelebrationEffect show={showConfetti} />
        <GameOver
          onPlayAgain={() => { dispatch(resetRound()); dispatch(setView("home")); }}
          onHome={() => { dispatch(resetRound()); dispatch(setView("home")); }}
        />
      </>
    );
  }

  return (
    <div>
      <button className="tw-pill" style={{ marginBottom: 12, cursor: "pointer" }}
              title="Quit this round — costs 1 life and 5 coins"
              onClick={() => dispatch(safeNavigate("home"))}>
        ← Quit
      </button>
      <QuestionCard onEmpty={() => { dispatch(resetRound()); dispatch(setView("home")); }} />
    </div>
  );
}
