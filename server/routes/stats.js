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
  if (!row) return null;
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

// Daily login bonus — call this on app boot for authed users. Idempotent per UTC date.
function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
router.post("/daily-login", requireAuth, (req, res) => {
  const today = todayKey();
  const row = db.prepare("SELECT last_login_date, login_streak FROM stats WHERE user_id = ?").get(req.user.id);
  if (row && row.last_login_date === today) {
    return res.json({ alreadyClaimed: true, streak: row.login_streak, stats: loadStats(req.user.id) });
  }
  // Yesterday continues streak; anything older resets.
  const [y, m, d] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const ystr = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;
  const continued = row && row.last_login_date === ystr;
  const newStreak = continued ? row.login_streak + 1 : 1;
  // Reward grows with streak, capped: day 1 = 1 spin + 25 coins, day 7+ = 3 spins + 100 coins.
  const tier = Math.min(7, newStreak);
  const spinsReward = tier <= 2 ? 1 : tier <= 5 ? 2 : 3;
  const coinsReward = Math.min(100, 25 * tier);
  db.prepare(`
    UPDATE stats SET
      last_login_date = ?, login_streak = ?,
      free_spins = free_spins + ?, coins = coins + ?, updated_at = ?
    WHERE user_id = ?
  `).run(today, newStreak, spinsReward, coinsReward, Date.now(), req.user.id);
  res.json({
    alreadyClaimed: false,
    streak: newStreak,
    spinsReward,
    coinsReward,
    stats: loadStats(req.user.id),
  });
});

// Spend one free spin (called when the user spins the wheel if they have any).
router.post("/use-free-spin", requireAuth, (req, res) => {
  const row = db.prepare("SELECT free_spins FROM stats WHERE user_id = ?").get(req.user.id);
  if (!row || row.free_spins <= 0) return res.status(400).json({ error: "no_free_spins" });
  db.prepare("UPDATE stats SET free_spins = free_spins - 1, updated_at = ? WHERE user_id = ?").run(Date.now(), req.user.id);
  res.json({ ok: true, free_spins: row.free_spins - 1 });
});

// Online vs leaderboard.
router.get("/online-leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, s.online_rating, s.online_wins, s.online_losses, s.level
    FROM stats s JOIN users u ON u.id = s.user_id
    WHERE s.online_wins + s.online_losses > 0
    ORDER BY s.online_rating DESC, s.online_wins DESC
    LIMIT 50
  `).all();
  res.json(rows);
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
