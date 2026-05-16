const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { logEvent } = require("../events");
const { getPerks } = require("../perks");

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
    perks: getPerks(userId),
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
  const row = db.prepare("SELECT last_login_date, login_streak, powerups_json FROM stats WHERE user_id = ?").get(req.user.id);
  if (row && row.last_login_date === today) {
    return res.json({ alreadyClaimed: true, streak: row.login_streak, stats: loadStats(req.user.id) });
  }
  // Yesterday continues streak; anything older resets — unless the user has a streak_saver power-up.
  const [y, m, d] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const ystr = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;
  const continued = row && row.last_login_date === ystr;
  let streakSaverUsed = false;
  let newStreak;
  if (continued) {
    newStreak = row.login_streak + 1;
  } else if (row && row.last_login_date && row.login_streak > 0) {
    // Broken streak. Check for streak_saver.
    let powerups = {};
    try { powerups = JSON.parse(row.powerups_json || "{}"); } catch (e) {}
    if ((powerups.streak_saver || 0) > 0) {
      powerups.streak_saver -= 1;
      streakSaverUsed = true;
      newStreak = row.login_streak + 1;
      db.prepare("UPDATE stats SET powerups_json = ? WHERE user_id = ?").run(JSON.stringify(powerups), req.user.id);
    } else {
      newStreak = 1;
    }
  } else {
    newStreak = 1;
  }
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
    streak_saver_used: streakSaverUsed,
    spinsReward,
    coinsReward,
    stats: loadStats(req.user.id),
  });
});

// Watch a rewarded ad and claim the reward.
// Throttle: 90-second cooldown between ads, max 10 per UTC day per user.
const AD_COOLDOWN_MS = 90 * 1000;
const AD_DAILY_LIMIT = 10;

router.post("/watch-ad-reward", requireAuth, (req, res) => {
  const reward = String((req.body && req.body.reward) || "free_spin");
  const row = db.prepare("SELECT last_ad_at, ads_today_count, ads_today_date FROM stats WHERE user_id = ?").get(req.user.id);
  const now = Date.now();
  if (row.last_ad_at && now - row.last_ad_at < AD_COOLDOWN_MS) {
    return res.status(429).json({ error: "cooldown", wait_seconds: Math.ceil((AD_COOLDOWN_MS - (now - row.last_ad_at)) / 1000) });
  }
  const today = todayKey();
  let count = row.ads_today_date === today ? row.ads_today_count : 0;
  if (count >= AD_DAILY_LIMIT) {
    return res.status(429).json({ error: "daily_limit", limit: AD_DAILY_LIMIT });
  }

  // Lives are client-only — server returns a flag and the client does the refill.
  const grant = { granted_free_spins: 0, granted_coins: 0, granted_life_refill: false };
  if (reward === "life_refill") grant.granted_life_refill = true;
  else if (reward === "coins")  grant.granted_coins = 30;
  else                          grant.granted_free_spins = 1;

  db.prepare(`
    UPDATE stats SET
      free_spins = free_spins + ?,
      coins = coins + ?,
      last_ad_at = ?,
      ads_today_count = ?,
      ads_today_date = ?,
      updated_at = ?
    WHERE user_id = ?
  `).run(
    grant.granted_free_spins,
    grant.granted_coins,
    now,
    count + 1,
    today,
    now,
    req.user.id
  );

  logEvent("ad_watch", req.user.id, null, { reward });
  res.json({ ...grant, ads_today_count: count + 1, daily_limit: AD_DAILY_LIMIT });
});

// Spend one free spin (called when the user spins the wheel if they have any).
router.post("/use-free-spin", requireAuth, (req, res) => {
  const row = db.prepare("SELECT free_spins FROM stats WHERE user_id = ?").get(req.user.id);
  if (!row || row.free_spins <= 0) return res.status(400).json({ error: "no_free_spins" });
  db.prepare("UPDATE stats SET free_spins = free_spins - 1, updated_at = ? WHERE user_id = ?").run(Date.now(), req.user.id);
  res.json({ ok: true, free_spins: row.free_spins - 1 });
});

// Daily quests — 3 quests generated per UTC date, deterministic per user.
const QUEST_TEMPLATES = [
  { id: "win_online_1",  text: "Win 1 online match",       target: 1,  metric: "online_wins_today", reward: { coins: 50, free_spins: 1 } },
  { id: "play_3",        text: "Play 3 rounds",            target: 3,  metric: "rounds_today",      reward: { coins: 30 } },
  { id: "streak_5",      text: "Hit a 5-correct streak",   target: 5,  metric: "best_streak_today", reward: { coins: 60, free_spins: 1 } },
  { id: "daily_play",    text: "Play today's Daily Challenge", target: 1, metric: "daily_played_today", reward: { coins: 40, free_spins: 1 } },
  { id: "correct_15",    text: "Get 15 questions right",   target: 15, metric: "correct_today",     reward: { coins: 70 } },
  { id: "perfect_round", text: "Get a perfect round",      target: 1,  metric: "perfect_rounds_today", reward: { coins: 100, free_spins: 2 } },
  { id: "use_powerup",   text: "Use 2 power-ups",          target: 2,  metric: "powerups_used_today", reward: { coins: 25 } },
];

function ensureQuests(userId) {
  const today = todayKey();
  const row = db.prepare("SELECT quests_date, quests_json FROM stats WHERE user_id = ?").get(userId);
  if (row && row.quests_date === today) {
    try { return JSON.parse(row.quests_json); } catch (e) { /* regenerate */ }
  }
  // Pick 3 quests deterministically using user id + date as the seed.
  const seedStr = `${userId}|${today}`;
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) { h = (h * 31 + seedStr.charCodeAt(i)) >>> 0; }
  const pool = [...QUEST_TEMPLATES];
  const chosen = [];
  while (chosen.length < 3 && pool.length) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const idx = h % pool.length;
    chosen.push({ ...pool[idx], progress: 0, claimed: false });
    pool.splice(idx, 1);
  }
  db.prepare("UPDATE stats SET quests_date = ?, quests_json = ?, updated_at = ? WHERE user_id = ?")
    .run(today, JSON.stringify(chosen), Date.now(), userId);
  return chosen;
}

router.get("/quests", requireAuth, (req, res) => {
  const quests = ensureQuests(req.user.id);
  res.json({ date: todayKey(), quests });
});

// Bump quest progress; client calls this after game events (correct, win, daily, etc.)
router.post("/quests/progress", requireAuth, (req, res) => {
  const updates = Array.isArray(req.body?.events) ? req.body.events : [];
  const quests = ensureQuests(req.user.id);
  for (const ev of updates) {
    const metric = String(ev.metric || "");
    const amount = Math.max(0, Math.floor(ev.amount || 0));
    for (const q of quests) {
      if (q.metric === metric && !q.claimed) {
        q.progress = Math.min(q.target, (q.progress || 0) + amount);
      }
    }
  }
  db.prepare("UPDATE stats SET quests_json = ?, updated_at = ? WHERE user_id = ?")
    .run(JSON.stringify(quests), Date.now(), req.user.id);
  res.json({ quests });
});

router.post("/quests/claim", requireAuth, (req, res) => {
  const id = String(req.body?.id || "");
  const quests = ensureQuests(req.user.id);
  const q = quests.find((x) => x.id === id);
  if (!q) return res.status(404).json({ error: "no_such_quest" });
  if (q.claimed) return res.status(400).json({ error: "already_claimed" });
  if ((q.progress || 0) < q.target) return res.status(400).json({ error: "not_complete" });
  q.claimed = true;
  const reward = q.reward || {};
  db.prepare(`
    UPDATE stats SET
      quests_json = ?, coins = coins + ?, free_spins = free_spins + ?, updated_at = ?
    WHERE user_id = ?
  `).run(JSON.stringify(quests), reward.coins || 0, reward.free_spins || 0, Date.now(), req.user.id);
  res.json({ ok: true, reward, stats: loadStats(req.user.id) });
});

// Where am I on the global leaderboard?
router.get("/my-rank", requireAuth, (req, res) => {
  const me = db.prepare("SELECT high_score FROM leaderboard WHERE user_id = ?").get(req.user.id);
  if (!me) return res.json({ rank: null, total: 0, high_score: 0 });
  const rank = db.prepare("SELECT COUNT(*) AS n FROM leaderboard WHERE high_score > ?").get(me.high_score).n + 1;
  const total = db.prepare("SELECT COUNT(*) AS n FROM leaderboard WHERE high_score > 0").get().n;
  // Online rank from rating.
  const myRating = db.prepare("SELECT online_rating, online_wins, online_losses FROM stats WHERE user_id = ?").get(req.user.id);
  let onlineRank = null;
  let onlineTotal = 0;
  if (myRating && (myRating.online_wins + myRating.online_losses) > 0) {
    onlineRank = db.prepare("SELECT COUNT(*) AS n FROM stats WHERE online_rating > ? AND (online_wins + online_losses) > 0").get(myRating.online_rating).n + 1;
    onlineTotal = db.prepare("SELECT COUNT(*) AS n FROM stats WHERE (online_wins + online_losses) > 0").get().n;
  }
  res.json({ rank, total, high_score: me.high_score, online_rank: onlineRank, online_total: onlineTotal });
});

// Recent match history (online matches the user participated in).
router.get("/match-history", requireAuth, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const me = req.user.id;
  const rows = db.prepare(`
    SELECT
      m.id, m.kind, m.player1_id, m.player2_id,
      m.player1_score, m.player2_score, m.winner_id,
      m.started_at, m.finished_at,
      u1.username AS player1_username,
      u2.username AS player2_username
    FROM matches m
    LEFT JOIN users u1 ON u1.id = m.player1_id
    LEFT JOIN users u2 ON u2.id = m.player2_id
    WHERE m.player1_id = ? OR m.player2_id = ?
    ORDER BY m.finished_at DESC
    LIMIT ?
  `).all(me, me, limit);
  res.json(rows.map((r) => {
    const youArePlayer1 = r.player1_id === me;
    const yourScore = youArePlayer1 ? r.player1_score : r.player2_score;
    const oppScore = youArePlayer1 ? r.player2_score : r.player1_score;
    const opp = youArePlayer1 ? r.player2_username : r.player1_username;
    const outcome = !r.winner_id ? "tie" : (r.winner_id === me ? "win" : "loss");
    return {
      id: r.id, kind: r.kind, outcome,
      your_score: yourScore, opponent_score: oppScore,
      opponent: opp || "unknown",
      duration_ms: r.finished_at - r.started_at,
      finished_at: r.finished_at,
    };
  }));
});

// Per-category mastery. Returns rows for every category the user has played.
router.get("/category-stats", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT category_id, games_played, correct, incorrect, best_score, updated_at
    FROM category_stats WHERE user_id = ?
    ORDER BY games_played DESC
  `).all(req.user.id);
  res.json(rows.map((r) => ({
    category_id: r.category_id,
    games_played: r.games_played,
    correct: r.correct,
    incorrect: r.incorrect,
    best_score: r.best_score,
    accuracy_pct: (r.correct + r.incorrect) > 0
      ? Math.round((r.correct / (r.correct + r.incorrect)) * 100)
      : 0,
  })));
});

// Online vs leaderboard.
router.get("/online-leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, u.avatar, s.online_rating, s.online_wins, s.online_losses, s.level
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
  const { score = 0, correct = 0, incorrect = 0, xp_gained = 0, coins_gained = 0, best_streak_run = 0, category_id = null } = req.body || {};
  const now = Date.now();
  const stats = db.prepare("SELECT * FROM stats WHERE user_id = ?").get(req.user.id);
  const newXp = stats.xp + Math.max(0, Math.floor(xp_gained));
  const newLevel = 1 + Math.floor(Math.sqrt(newXp / 100));
  const newBest = Math.max(stats.best_streak, Math.floor(best_streak_run));
  const leveledUp = newLevel > stats.level;

  // Grant a streak_saver power-up on every level-up — small, valuable, retention boost.
  let powerupsUpdate = stats.powerups_json;
  if (leveledUp) {
    try {
      const p = JSON.parse(stats.powerups_json);
      p.streak_saver = (p.streak_saver || 0) + 1;
      powerupsUpdate = JSON.stringify(p);
    } catch (e) {}
  }

  db.prepare(`
    UPDATE stats SET
      xp = ?, level = ?,
      coins = coins + ?,
      games_played = games_played + 1,
      correct = correct + ?,
      incorrect = incorrect + ?,
      best_streak = ?,
      powerups_json = ?,
      updated_at = ?
    WHERE user_id = ?
  `).run(newXp, newLevel, Math.max(0, Math.floor(coins_gained)), Math.max(0, correct), Math.max(0, incorrect), newBest, powerupsUpdate, now, req.user.id);

  // Per-category mastery.
  if (category_id) {
    db.prepare(`
      INSERT INTO category_stats (user_id, category_id, games_played, correct, incorrect, best_score, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(user_id, category_id) DO UPDATE SET
        games_played = games_played + 1,
        correct = correct + excluded.correct,
        incorrect = incorrect + excluded.incorrect,
        best_score = MAX(best_score, excluded.best_score),
        updated_at = excluded.updated_at
    `).run(req.user.id, Number(category_id), Math.max(0, correct), Math.max(0, incorrect), Math.max(0, Math.floor(score)), now);
  }

  const lbRow = db.prepare("SELECT high_score FROM leaderboard WHERE user_id = ?").get(req.user.id);
  if (!lbRow || score > lbRow.high_score) {
    db.prepare("INSERT INTO leaderboard (user_id, high_score, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET high_score = excluded.high_score, updated_at = excluded.updated_at").run(req.user.id, score, now);
  }

  // Award any newly-eligible badges from this game. New ones come back in
  // the response so the client can fire a celebration toast.
  let newBadges = [];
  try {
    const badges = require("../badges");
    newBadges = badges.awardEligible(req.user.id);
  } catch (e) {}

  res.json({ ...loadStats(req.user.id), leveled_up: leveledUp, new_badges: newBadges });
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
    SELECT u.id AS user_id, u.username, u.avatar, l.high_score, s.level
    FROM leaderboard l
    JOIN users u ON u.id = l.user_id
    JOIN stats s ON s.user_id = l.user_id
    ORDER BY l.high_score DESC
    LIMIT 50
  `).all();
  // Decorate with the visible cosmetic (frame + title) + showcase badge
  // so the leaderboard can render each player's flair next to the name.
  const cosmetics = require("../cosmetics");
  const badges = require("../badges");
  for (const r of rows) {
    r.public_cosmetics = cosmetics.getPublicCosmetics(r.user_id);
    r.badges = badges.listEquipped(r.user_id);
  }
  res.json(rows);
});

module.exports = router;
module.exports.loadStats = loadStats;
