const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

const ALLOWED_FIELDS = new Set([
  "xp", "level", "coins", "games_played", "correct", "incorrect",
  "best_streak", "longest_daily_streak", "current_daily_streak",
  "last_daily_date", "powerups_json", "themes_json", "active_theme",
]);

function loadStats(userId) {
  const row = db.prepare("SELECT * FROM stats WHERE user_id = ?").get(userId);
  const achievements = db
    .prepare("SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?")
    .all(userId);
  return {
    ...row,
    powerups: row.powerups_json ? JSON.parse(row.powerups_json) : {},
    themes: row.themes_json ? JSON.parse(row.themes_json) : ["classic"],
    pro: !!(row.pro_until && row.pro_until > Date.now()),
    achievements,
  };
}

router.get("/", requireAuth, (req, res) => {
  res.json(loadStats(req.user.id));
});

router.put("/", requireAuth, (req, res) => {
  const body = req.body || {};
  const updates = [];
  const values = [];
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(k)) {
      updates.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (!updates.length) return res.json(loadStats(req.user.id));
  updates.push("updated_at = ?");
  values.push(Date.now());
  values.push(req.user.id);
  db.prepare(`UPDATE stats SET ${updates.join(", ")} WHERE user_id = ?`).run(...values);
  res.json(loadStats(req.user.id));
});

router.post("/game", requireAuth, (req, res) => {
  const { score = 0, correct = 0, incorrect = 0, xp_gained = 0, coins_gained = 0, best_streak_run = 0 } = req.body || {};
  const now = Date.now();
  const stats = db.prepare("SELECT * FROM stats WHERE user_id = ?").get(req.user.id);
  const newXp = stats.xp + Math.max(0, Math.floor(xp_gained));
  const newLevel = 1 + Math.floor(Math.sqrt(newXp / 100));
  const newBest = Math.max(stats.best_streak, Math.floor(best_streak_run));
  db.prepare(`
    UPDATE stats SET
      xp = ?,
      level = ?,
      coins = coins + ?,
      games_played = games_played + 1,
      correct = correct + ?,
      incorrect = incorrect + ?,
      best_streak = ?,
      updated_at = ?
    WHERE user_id = ?
  `).run(newXp, newLevel, Math.max(0, Math.floor(coins_gained)), Math.max(0, correct), Math.max(0, incorrect), newBest, now, req.user.id);

  const lbRow = db.prepare("SELECT high_score FROM leaderboard WHERE user_id = ?").get(req.user.id);
  if (!lbRow || score > lbRow.high_score) {
    db.prepare("INSERT INTO leaderboard (user_id, high_score, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET high_score = excluded.high_score, updated_at = excluded.updated_at").run(req.user.id, score, now);
  }
  res.json(loadStats(req.user.id));
});

router.post("/achievement", requireAuth, (req, res) => {
  const { achievement_id } = req.body || {};
  if (!achievement_id) return res.status(400).json({ error: "missing achievement_id" });
  db.prepare(
    "INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)"
  ).run(req.user.id, String(achievement_id), Date.now());
  res.json(loadStats(req.user.id));
});

router.get("/leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, l.high_score, s.level
    FROM leaderboard l
    JOIN users u ON u.id = l.user_id
    JOIN stats s ON s.user_id = l.user_id
    ORDER BY l.high_score DESC
    LIMIT 50
  `).all();
  res.json(rows);
});

module.exports = router;
module.exports.loadStats = loadStats;
