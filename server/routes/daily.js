const express = require("express");
const db = require("../db");
const { requireAuth, optionalAuth } = require("../auth");
const { pickDailyQuestions } = require("../questions");

const router = express.Router();

function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

router.get("/today", optionalAuth, (req, res) => {
  const date = todayKey();
  let alreadyPlayed = false;
  if (req.user) {
    const row = db.prepare("SELECT score FROM daily_scores WHERE user_id = ? AND date = ?").get(req.user.id, date);
    alreadyPlayed = !!row;
  }
  res.json({ date, seed: date, alreadyPlayed });
});

router.get("/questions", (req, res) => {
  const date = todayKey();
  const questions = pickDailyQuestions(date, 10);
  res.json({ date, questions });
});

router.post("/submit", requireAuth, (req, res) => {
  const body = req.body || {};
  if (typeof body.score !== "number" || typeof body.correct !== "number" || typeof body.total !== "number" || typeof body.time_ms !== "number") {
    return res.status(400).json({ error: "invalid payload" });
  }
  // Sanity caps on every client-supplied number — the daily is 10
  // questions, so anything outside these ranges is a tampered client.
  const total = Math.max(1, Math.min(10, Math.floor(body.total)));
  const correct = Math.max(0, Math.min(total, Math.floor(body.correct)));
  // Max possible score is ~250/question with mystery + streak multipliers
  // → ~2500 for a perfect daily. Cap generously at 5000.
  const score = Math.max(0, Math.min(5000, Math.floor(body.score)));
  // Reading + answering 10 questions can't realistically take under 8s.
  // Reject anything faster — that's a tampered client.
  const time_ms = Math.max(8000, Math.min(30 * 60 * 1000, Math.floor(body.time_ms)));
  const date = todayKey();

  // INSERT OR IGNORE + check changes for race-safe single-submission.
  const ins = db.prepare(
    "INSERT OR IGNORE INTO daily_scores (user_id, date, score, correct, total, time_ms, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(req.user.id, date, score, correct, total, time_ms, Date.now());
  if (ins.changes === 0) return res.status(409).json({ error: "already submitted today" });

  // Update daily streak.
  const stats = db.prepare("SELECT current_daily_streak, longest_daily_streak, last_daily_date FROM stats WHERE user_id = ?").get(req.user.id);
  if (!stats) return res.status(404).json({ error: "no_stats_row" });
  const [y, m, d] = date.split("-").map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const ystr = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;
  const continued = stats.last_daily_date === ystr;
  const newStreak = continued ? (stats.current_daily_streak + 1) : 1;
  const newLongest = Math.max(stats.longest_daily_streak, newStreak);
  db.prepare("UPDATE stats SET current_daily_streak = ?, longest_daily_streak = ?, last_daily_date = ?, updated_at = ? WHERE user_id = ?")
    .run(newStreak, newLongest, date, Date.now(), req.user.id);

  // Bump today's "Play Daily Challenge" quest if it's in this user's set.
  try {
    const stats = require("./stats");
    if (stats.progressAllQuestsFor) stats.progressAllQuestsFor(req.user.id, [{ metric: "daily_played_today", amount: 1 }]);
    else if (stats.progressQuestsFor) stats.progressQuestsFor(req.user.id, [{ metric: "daily_played_today", amount: 1 }]);
  } catch (e) {}

  res.json({ ok: true, streak: newStreak });
});

router.get("/leaderboard", (req, res) => {
  const date = req.query.date || todayKey();
  const rows = db.prepare(`
    SELECT u.username, d.score, d.correct, d.total, d.time_ms
    FROM daily_scores d
    JOIN users u ON u.id = d.user_id
    WHERE d.date = ?
    ORDER BY d.score DESC, d.time_ms ASC
    LIMIT 50
  `).all(date);
  res.json({ date, leaderboard: rows });
});

module.exports = router;
