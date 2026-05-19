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

// PUBLIC daily — no auth, deterministic per date, exactly 5 questions.
// This is the marketing surface: a friend opens spinlore.app/d/<date>,
// plays in ~90 seconds, shares a Wordle-style result card with a
// deep-link back. No /stats fetch, no auth handshake, no daily-login
// modal — guests just play. Date param is optional; defaults to today.
// Older dates work too (the question picker is deterministic) so the
// share card's link is still playable if a friend opens it after
// midnight UTC rolls over.
router.get("/public/:date?", (req, res) => {
  const today = todayKey();
  // Validate the date param — must match YYYY-MM-DD. Anything else
  // (including future dates more than 24h ahead) falls back to today
  // so a malformed URL still plays something rather than 404'ing.
  let date = today;
  const param = String(req.params.date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(param)) {
    // Reject more than 1 day in the future to stop crawlers from
    // pre-generating tomorrow's set via this endpoint.
    const future = new Date(param + "T00:00:00Z").getTime();
    const nowMs = Date.now();
    if (future <= nowMs + 86400000) date = param;
  }
  const questions = pickDailyQuestions(date, 5);
  res.json({
    date,
    isToday: date === today,
    total: questions.length,
    questions,
  });
});

// Public submit — anonymous play counter. Records that ONE play happened
// for today's date without identifying the player. Used purely to drive
// the "X players played today" social-proof number on the share card.
// No score, no streak, no leaderboard entry — guest play data is
// deliberately not stored beyond a counter to keep this endpoint
// abuse-cheap and privacy-light.
router.post("/public/play", (req, res) => {
  const date = todayKey();
  try {
    db.prepare(`
      INSERT INTO daily_play_counter (date, plays) VALUES (?, 1)
      ON CONFLICT(date) DO UPDATE SET plays = plays + 1
    `).run(date);
  } catch (e) { /* counter is best-effort */ }
  const row = db.prepare("SELECT plays FROM daily_play_counter WHERE date = ?").get(date);
  res.json({ date, plays: row ? row.plays : 1 });
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
