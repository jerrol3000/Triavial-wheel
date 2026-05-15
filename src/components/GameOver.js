import React from "react";
import { useSelector } from "react-redux";

export default function GameOver({ onPlayAgain, onHome }) {
  const game = useSelector((s) => s.game);
  const total = game.questions.length;
  const pct = total ? Math.round((game.correct / total) * 100) : 0;

  let title = "Nice try!";
  if (game.eliminated_out) title = "💥 Knocked out!";
  else if (pct === 100) title = "🏆 Perfect!";
  else if (pct >= 80) title = "🔥 Crushed it!";
  else if (pct >= 50) title = "👍 Not bad!";

  return (
    <div className="tw-card tw-fade-in" style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "Fredoka", fontSize: 28, fontWeight: 700 }}>{title}</div>
      <div style={{ color: "var(--text-dim)" }}>
        {game.eliminated_out
          ? "Three wrong in a row — round over. Try a 50/50 next time!"
          : `You got ${game.correct} of ${total} right`}
      </div>

      <div className="tw-grid-2" style={{ marginTop: 14 }}>
        <div className="tw-stat"><div className="tw-stat-value">{game.score}</div><div className="tw-stat-label">Score</div></div>
        <div className="tw-stat"><div className="tw-stat-value">🔥 {game.bestStreakRun}</div><div className="tw-stat-label">Best streak</div></div>
        <div className="tw-stat"><div className="tw-stat-value">{game.correct}</div><div className="tw-stat-label">Correct</div></div>
        <div className="tw-stat"><div className="tw-stat-value">{pct}%</div><div className="tw-stat-label">Accuracy</div></div>
      </div>

      <div className="tw-row" style={{ marginTop: 16, justifyContent: "center" }}>
        <button className="tw-btn" onClick={onPlayAgain}>Play again</button>
        <button className="tw-btn ghost" onClick={onHome}>Home</button>
      </div>
    </div>
  );
}
