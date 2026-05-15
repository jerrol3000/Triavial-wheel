import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Confetti from "react-confetti";
import QuestionCard from "./QuestionCard";
import GameOver from "./GameOver";
import { resetRound } from "../store/gameSlice";
import { spendLife, addXp, addCoins, recordGame, submitGame, unlockAchievement, markAchievement, grantPowerup } from "../store/statsSlice";
import { setView, pushToast } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import { ACHIEVEMENT_MAP } from "../data/achievements";
import { levelForXp } from "../utils/level";

export default function Play() {
  const dispatch = useDispatch();
  const game = useSelector((s) => s.game);
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);
  const [showConfetti, setShowConfetti] = useState(false);
  const [endTime, setEndTime] = useState(null);

  // Trigger end-of-round when finished flag flips on
  useEffect(() => {
    if (!game.finished || endTime) return;
    setEndTime(Date.now());
    const xpGained = Math.round(game.score / 10) + game.correct * 10;
    const coinsGained = game.correct * 8 + (game.bestStreakRun >= 5 ? 25 : 0);
    const prevLevel = stats.level;
    dispatch(addXp(xpGained));
    dispatch(addCoins(coinsGained));
    dispatch(recordGame({ correct: game.correct, incorrect: game.incorrect, best_streak_run: game.bestStreakRun }));

    // Achievement checks
    const unlockedIds = new Set(stats.achievements.map((a) => a.achievement_id));
    const newlyUnlocked = [];
    const tryUnlock = (id) => {
      if (!unlockedIds.has(id)) newlyUnlocked.push(id);
    };
    if (game.correct >= 1) tryUnlock("first_correct");
    if (game.bestStreakRun >= 5) tryUnlock("streak_5");
    if (game.bestStreakRun >= 10) tryUnlock("streak_10");
    if (game.correct === game.questions.length && game.questions.length >= 10) tryUnlock("perfect_round");
    if (game.score >= 1000) tryUnlock("high_score_1000");
    const nextLevel = levelForXp(stats.xp + xpGained);
    if (nextLevel >= 5) tryUnlock("level_5");
    if (nextLevel >= 10) tryUnlock("level_10");
    if (nextLevel >= 25) tryUnlock("level_25");

    newlyUnlocked.forEach((id) => {
      const def = ACHIEVEMENT_MAP[id];
      dispatch(markAchievement(id));
      if (user) dispatch(unlockAchievement(id));
      if (def) {
        sfx.achieve();
        dispatch(pushToast({ icon: def.icon, title: def.title, text: def.desc, duration: 3500 }));
        dispatch(addCoins(20));
      }
    });

    if (nextLevel > prevLevel) {
      sfx.levelup();
      const reward = nextLevel * 50;
      dispatch(addCoins(reward));
      dispatch(grantPowerup({ id: "freeze", count: 1 }));
      dispatch(pushToast({ icon: "🆙", title: `Level ${nextLevel}!`, text: `+${reward} 🪙 and a freeze power-up`, duration: 3500 }));
    }

    if (game.correct >= game.questions.length * 0.7) {
      sfx.win();
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
    } else {
      sfx.lose();
      if (!stats.pro) dispatch(spendLife());
    }

    if (user) {
      dispatch(submitGame({
        score: game.score,
        correct: game.correct,
        incorrect: game.incorrect,
        xp_gained: xpGained,
        coins_gained: coinsGained,
        best_streak_run: game.bestStreakRun,
      }));
    }
  }, [game.finished, endTime, dispatch, game, stats.achievements, stats.level, stats.pro, stats.xp, user]);

  if (game.finished) {
    return (
      <>
        {showConfetti && <Confetti recycle={false} numberOfPieces={250} />}
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
              onClick={() => { dispatch(resetRound()); dispatch(setView("home")); }}>
        ← Quit
      </button>
      <QuestionCard />
    </div>
  );
}
