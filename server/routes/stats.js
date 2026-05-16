const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { logEvent } = require("../events");
const { getPerks } = require("../perks");

const router = express.Router();

// Whitelist of fields a client may directly set. Economy stuff (coins,
// xp, level, powerups_json, themes_json) is intentionally OMITTED —
// otherwise any authed user can POST { coins: 999999 } and grant
// themselves infinite currency. Those values are mutated only through
// /stats/game, /watch-ad-reward, /store/buy, /quests/claim, etc.
const ALLOWED_FIELDS = new Set([
  "active_theme",       // pure cosmetic preference, no economic value
]);

// Sanity-clamp client-supplied integer fields. Rejects NaN, negatives,
// and values above the cap. Used by /stats/game to prevent leaderboard
// pollution from a tampered or buggy client.
function clampInt(v, min, max) {
  const n = Math.floor(Number(v) || 0);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function loadStats(userId) {
  const row = db.prepare("SELECT * FROM stats WHERE user_id = ?").get(userId);
  if (!row) return null;
  const achievements = db
    .prepare("SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?")
    .all(userId);
  // Strip the legacy `lives` column — the game uses `free_spins` as the
  // sole spin/energy resource now. Sending lives from the server would
  // overwrite the client's regenerating spin counter on every fetch.
  const { lives, lives_updated_at, ...clean } = row;
  return {
    ...clean,
    powerups: clean.powerups_json ? JSON.parse(clean.powerups_json) : {},
    themes: clean.themes_json ? JSON.parse(clean.themes_json) : ["classic"],
    pro: !!(clean.pro_until && clean.pro_until > Date.now()),
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
  // Wrapped in a transaction so two near-simultaneous boots can't both
  // grant the daily login bonus (or both spend the streak_saver flag).
  // Re-checks `last_login_date === today` INSIDE the tx as the lock.
  const today = todayKey();
  let response;
  try {
    const tx = db.transaction(() => {
      const row = db.prepare(
        "SELECT last_login_date, login_streak, powerups_json, streak_saver_active FROM stats WHERE user_id = ?"
      ).get(req.user.id);
      if (!row) { response = { error: "no_stats_row" }; return; }
      if (row.last_login_date === today) {
        response = { alreadyClaimed: true, streak: row.login_streak };
        return;
      }
      const [y, m, d] = today.split("-").map(Number);
      const yesterday = new Date(Date.UTC(y, m - 1, d));
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const ystr = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;
      const continued = row.last_login_date === ystr;
      let streakSaverUsed = false;
      let newStreak;
      if (continued) {
        newStreak = row.login_streak + 1;
      } else if (row.last_login_date && row.login_streak > 0) {
        let powerups = {};
        try { powerups = JSON.parse(row.powerups_json || "{}") || {}; } catch (e) {}
        if (row.streak_saver_active) {
          streakSaverUsed = true;
          newStreak = row.login_streak + 1;
          db.prepare("UPDATE stats SET streak_saver_active = 0 WHERE user_id = ?").run(req.user.id);
        } else if ((powerups.streak_saver || 0) > 0) {
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
      const tier = Math.min(7, newStreak);
      const spinsReward = tier <= 2 ? 1 : tier <= 5 ? 2 : 3;
      const coinsReward = Math.min(100, 25 * tier);
      // The single-row guard against double-credit: only update if
      // last_login_date is still NOT today (race-safe).
      const upd = db.prepare(`
        UPDATE stats SET
          last_login_date = ?, login_streak = ?,
          free_spins = free_spins + ?, coins = coins + ?, updated_at = ?
        WHERE user_id = ? AND (last_login_date IS NULL OR last_login_date != ?)
      `).run(today, newStreak, spinsReward, coinsReward, Date.now(), req.user.id, today);
      if (upd.changes === 0) {
        // Another request just won the race — treat as already claimed.
        response = { alreadyClaimed: true, streak: newStreak };
        return;
      }
      response = {
        alreadyClaimed: false,
        streak: newStreak,
        streak_saver_used: streakSaverUsed,
        spinsReward,
        coinsReward,
      };
    });
    tx();
  } catch (e) {
    console.error("[daily-login] failed", e);
    return res.status(500).json({ error: "daily_login_failed" });
  }
  if (response.error) return res.status(404).json(response);
  res.json({ ...response, stats: loadStats(req.user.id) });
});

// Watch a rewarded ad and claim the reward.
// Throttle: 90-second cooldown between ads, max 10 per UTC day per user.
const AD_COOLDOWN_MS = 90 * 1000;
const AD_DAILY_LIMIT = 10;

router.post("/watch-ad-reward", requireAuth, (req, res) => {
  const reward = String((req.body && req.body.reward) || "free_spin");
  const row = db.prepare("SELECT last_ad_at, ads_today_count, ads_today_date FROM stats WHERE user_id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "no_stats_row" });
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
  progressAllQuestsFor(req.user.id, [{ metric: "ads_watched_today", amount: 1 }]);
  res.json({ ...grant, ads_today_count: count + 1, daily_limit: AD_DAILY_LIMIT });
});

// Spend one free spin (called when the user spins the wheel if they have any).
router.post("/use-free-spin", requireAuth, (req, res) => {
  // Atomic decrement guarded by `free_spins > 0` in the WHERE clause.
  // The previous read-then-write let two concurrent requests both
  // pass the check and drop the column to -1.
  const upd = db.prepare(
    "UPDATE stats SET free_spins = free_spins - 1, updated_at = ? WHERE user_id = ? AND free_spins > 0"
  ).run(Date.now(), req.user.id);
  if (upd.changes === 0) return res.status(400).json({ error: "no_free_spins" });
  const row = db.prepare("SELECT free_spins FROM stats WHERE user_id = ?").get(req.user.id);
  res.json({ ok: true, free_spins: row ? row.free_spins : 0 });
});

// Daily quests — 3 quests generated per UTC date, deterministic per user
// (so refreshes don't shuffle them) but pulled from a wide pool so the
// same set rarely repeats day-to-day. Server auto-progresses these on
// the events it already sees (game-end, online-win, ad-watch, etc.) so
// no client-side instrumentation is required.
const QUEST_TEMPLATES = [
  // Volume — easy daily floor
  { id: "play_3",        text: "Play 3 rounds",                     target: 3,  metric: "rounds_today",         reward: { coins: 30 } },
  { id: "play_5",        text: "Play 5 rounds",                     target: 5,  metric: "rounds_today",         reward: { coins: 60, free_spins: 1 } },
  { id: "correct_15",    text: "Get 15 questions right",            target: 15, metric: "correct_today",        reward: { coins: 70 } },
  { id: "correct_30",    text: "Get 30 questions right",            target: 30, metric: "correct_today",        reward: { coins: 130, free_spins: 1 } },
  { id: "earn_coins_200",text: "Earn 200 coins from play",          target: 200,metric: "coins_earned_today",   reward: { coins: 50 } },
  { id: "earn_xp_300",   text: "Earn 300 XP",                       target: 300,metric: "xp_earned_today",      reward: { coins: 60 } },

  // Streak / accuracy — skill plays
  { id: "streak_5",      text: "Hit a 5-correct streak",            target: 5,  metric: "best_streak_today",    reward: { coins: 60, free_spins: 1 } },
  { id: "streak_10",     text: "Hit a 10-correct streak",           target: 10, metric: "best_streak_today",    reward: { coins: 120, free_spins: 1 } },
  { id: "perfect_round", text: "Get a perfect round (10/10)",       target: 1,  metric: "perfect_rounds_today", reward: { coins: 100, free_spins: 2 } },
  { id: "perfect_round_x2", text: "Get 2 perfect rounds",           target: 2,  metric: "perfect_rounds_today", reward: { coins: 200, free_spins: 2 } },

  // Daily / Online — drives the social + ritual hooks
  { id: "daily_play",    text: "Play today's Daily Challenge",      target: 1,  metric: "daily_played_today",   reward: { coins: 40, free_spins: 1 } },
  { id: "win_online_1",  text: "Win 1 online match",                target: 1,  metric: "online_wins_today",    reward: { coins: 50, free_spins: 1 } },
  { id: "win_online_3",  text: "Win 3 online matches",              target: 3,  metric: "online_wins_today",    reward: { coins: 180, free_spins: 2 } },
  { id: "play_online",   text: "Play 2 online matches",             target: 2,  metric: "online_played_today",  reward: { coins: 50 } },

  // Power-ups / progression
  { id: "use_powerup",   text: "Use 2 power-ups",                   target: 2,  metric: "powerups_used_today",  reward: { coins: 25 } },
  { id: "use_powerup_5", text: "Use 5 power-ups",                   target: 5,  metric: "powerups_used_today",  reward: { coins: 75, free_spins: 1 } },
  { id: "level_up",      text: "Level up once",                     target: 1,  metric: "level_ups_today",      reward: { coins: 80, free_spins: 1 } },

  // Engagement
  { id: "watch_ad",      text: "Watch 1 reward ad",                 target: 1,  metric: "ads_watched_today",    reward: { coins: 20 } },
  { id: "watch_ads_3",   text: "Watch 3 reward ads",                target: 3,  metric: "ads_watched_today",    reward: { coins: 80, free_spins: 1 } },
  { id: "spin_wheel_3",  text: "Spin the wheel 3 times",            target: 3,  metric: "spins_today",          reward: { coins: 30 } },
  { id: "spin_wheel_8",  text: "Spin the wheel 8 times",            target: 8,  metric: "spins_today",          reward: { coins: 100, free_spins: 1 } },

  // Spending — gentle nudges to the store
  { id: "buy_anything",  text: "Buy something from the store",      target: 1,  metric: "purchases_today",      reward: { coins: 50, free_spins: 1 } },
  { id: "category_2",    text: "Play 2 different categories",       target: 2,  metric: "categories_today",     reward: { coins: 40 } },
  { id: "category_4",    text: "Play 4 different categories",       target: 4,  metric: "categories_today",     reward: { coins: 110, free_spins: 1 } },
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

// ─── Weekly quests ──────────────────────────────────────────────────────
// Bigger targets, fatter rewards, fresh pool every Monday 00:00 UTC.
// Metric names mirror the daily ones but with a `_this_week` suffix so
// progressWeeklyQuestsFor can sum across the full week independently of
// daily progress (which resets every midnight).
const WEEKLY_QUEST_TEMPLATES = [
  // Volume — multi-day commitments
  { id: "w_play_25",       text: "Play 25 rounds this week",         target: 25,  metric: "rounds_this_week",        reward: { coins: 250, free_spins: 5 } },
  { id: "w_play_75",       text: "Play 75 rounds this week",         target: 75,  metric: "rounds_this_week",        reward: { coins: 750, free_spins: 10 } },
  { id: "w_correct_150",   text: "Get 150 questions right this week",target: 150, metric: "correct_this_week",       reward: { coins: 400, free_spins: 5 } },
  { id: "w_correct_500",   text: "Get 500 questions right this week",target: 500, metric: "correct_this_week",       reward: { coins: 1000, free_spins: 12 } },
  { id: "w_earn_coins_2k", text: "Earn 2,000 coins from play",       target: 2000,metric: "coins_earned_this_week",  reward: { coins: 400, free_spins: 5 } },
  { id: "w_earn_xp_3k",    text: "Earn 3,000 XP this week",          target: 3000,metric: "xp_earned_this_week",     reward: { coins: 500, free_spins: 5 } },

  // Skill / accuracy
  { id: "w_streak_15",     text: "Hit a 15-correct streak",          target: 15,  metric: "best_streak_this_week",   reward: { coins: 500, free_spins: 5 } },
  { id: "w_streak_25",     text: "Hit a 25-correct streak",          target: 25,  metric: "best_streak_this_week",   reward: { coins: 1000, free_spins: 10 } },
  { id: "w_perfect_5",     text: "Get 5 perfect rounds this week",   target: 5,   metric: "perfect_rounds_this_week",reward: { coins: 800, free_spins: 8 } },

  // Daily ritual
  { id: "w_daily_3",       text: "Play the Daily Challenge 3 times", target: 3,   metric: "daily_played_this_week",  reward: { coins: 300, free_spins: 5 } },
  { id: "w_daily_7",       text: "Complete the Daily every day",     target: 7,   metric: "daily_played_this_week",  reward: { coins: 1500, free_spins: 15 } },

  // Online / social
  { id: "w_online_play_5", text: "Play 5 online matches",            target: 5,   metric: "online_played_this_week", reward: { coins: 350, free_spins: 5 } },
  { id: "w_online_win_5",  text: "Win 5 online matches",             target: 5,   metric: "online_wins_this_week",   reward: { coins: 700, free_spins: 8 } },
  { id: "w_online_win_15", text: "Win 15 online matches",            target: 15,  metric: "online_wins_this_week",   reward: { coins: 1800, free_spins: 15 } },

  // Engagement
  { id: "w_spin_30",       text: "Spin the wheel 30 times",          target: 30,  metric: "spins_this_week",         reward: { coins: 300, free_spins: 5 } },
  { id: "w_watch_ads_10",  text: "Watch 10 reward ads",              target: 10,  metric: "ads_watched_this_week",   reward: { coins: 250, free_spins: 5 } },
  { id: "w_powerups_15",   text: "Use 15 power-ups",                 target: 15,  metric: "powerups_used_this_week", reward: { coins: 350, free_spins: 5 } },

  // Exploration / collection
  { id: "w_categories_all",text: "Play all 10 categories this week", target: 10,  metric: "categories_this_week",    reward: { coins: 600, free_spins: 8 } },
  { id: "w_buy_2",         text: "Buy 2 things from the store",      target: 2,   metric: "purchases_this_week",     reward: { coins: 400, free_spins: 5 } },
  { id: "w_level_up_3",    text: "Level up 3 times this week",       target: 3,   metric: "level_ups_this_week",     reward: { coins: 700, free_spins: 8 } },
];

// ISO week key — same week for all timezones because we always use UTC.
function weekKey(d = new Date()) {
  // ISO 8601: week starts Monday; week containing the first Thursday of
  // the year is week 1.
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function ensureWeeklyQuests(userId) {
  const wk = weekKey();
  const row = db.prepare("SELECT weekly_quests_week, weekly_quests_json FROM stats WHERE user_id = ?").get(userId);
  if (row && row.weekly_quests_week === wk) {
    try { const parsed = JSON.parse(row.weekly_quests_json); if (Array.isArray(parsed)) return parsed; } catch (e) {}
  }
  // Deterministic shuffle from a different hash space than dailies so
  // a player's weekly + daily quests rarely overlap on the same metric.
  const seedStr = `weekly|${userId}|${wk}`;
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) { h = (h * 31 + seedStr.charCodeAt(i)) >>> 0; }
  const pool = [...WEEKLY_QUEST_TEMPLATES];
  const chosen = [];
  while (chosen.length < 3 && pool.length) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const idx = h % pool.length;
    chosen.push({ ...pool[idx], progress: 0, claimed: false });
    pool.splice(idx, 1);
  }
  db.prepare("UPDATE stats SET weekly_quests_week = ?, weekly_quests_json = ?, updated_at = ? WHERE user_id = ?")
    .run(wk, JSON.stringify(chosen), Date.now(), userId);
  return chosen;
}

// Same shape as progressQuestsFor but matches *_this_week metrics. All
// quest progression is server-driven from the same event sources that
// fire daily progression — see the call sites in /stats/game,
// /watch-ad-reward, realtime.endMatch, /store/buy, /daily/submit.
function progressWeeklyQuestsFor(userId, events) {
  const quests = ensureWeeklyQuests(userId);
  let changed = false;
  for (const ev of events) {
    const metric = String(ev.metric || "");
    const amount = Math.max(0, Math.floor(ev.amount || 0));
    for (const q of quests) {
      if (q.metric === metric && !q.claimed) {
        const prev = q.progress || 0;
        const next = ev.setMode === "max"
          ? Math.min(q.target, Math.max(prev, amount))
          : Math.min(q.target, prev + amount);
        if (next !== prev) { q.progress = next; changed = true; }
      }
    }
  }
  if (changed) {
    db.prepare("UPDATE stats SET weekly_quests_json = ?, updated_at = ? WHERE user_id = ?")
      .run(JSON.stringify(quests), Date.now(), userId);
  }
  return quests;
}

// One-stop helper for callers — bumps BOTH daily and weekly progress
// from a single event list. Each `metric` should be the daily form
// (e.g. "rounds_today") and this helper automatically also fires the
// weekly variant ("rounds_this_week"). Saves having to call two
// functions everywhere and risk forgetting one.
function progressAllQuestsFor(userId, events) {
  const dailyEvents = events;
  const weeklyEvents = events.map((ev) => ({
    ...ev,
    metric: String(ev.metric || "").replace(/_today$/, "_this_week"),
  })).filter((ev) => ev.metric.endsWith("_this_week"));
  const daily = progressQuestsFor(userId, dailyEvents);
  const weekly = progressWeeklyQuestsFor(userId, weeklyEvents);
  return { daily, weekly };
}

router.get("/quests", requireAuth, (req, res) => {
  const quests = ensureQuests(req.user.id);
  res.json({ date: todayKey(), quests });
});

// Apply quest progress for a list of events. Used by both the public
// endpoint AND server-internal flows (game-end, ad-watch, online match,
// store purchase) so quests advance without any client cooperation.
// `setMode: 'max'` lets best_streak_today take the larger of two
// reported values instead of summing — same pattern other one-shot
// metrics like categories_today could use later.
function progressQuestsFor(userId, events) {
  const quests = ensureQuests(userId);
  let changed = false;
  for (const ev of events) {
    const metric = String(ev.metric || "");
    const amount = Math.max(0, Math.floor(ev.amount || 0));
    for (const q of quests) {
      if (q.metric === metric && !q.claimed) {
        const prev = q.progress || 0;
        const next = ev.setMode === "max"
          ? Math.min(q.target, Math.max(prev, amount))
          : Math.min(q.target, prev + amount);
        if (next !== prev) { q.progress = next; changed = true; }
      }
    }
  }
  if (changed) {
    db.prepare("UPDATE stats SET quests_json = ?, updated_at = ? WHERE user_id = ?")
      .run(JSON.stringify(quests), Date.now(), userId);
  }
  return quests;
}

// Public endpoint REMOVED — was a giant exploit surface. The server
// now drives all quest progression from authoritative event sources
// (/stats/game, /watch-ad-reward, /daily/submit, online endMatch,
// /store/buy). A client posting `events: [{metric:"perfect_rounds_
// today", amount: 999}]` could complete every daily quest instantly
// for free. Read-only progress is exposed via GET /stats/quests.
router.post("/quests/progress", requireAuth, (req, res) => {
  res.status(410).json({
    error: "endpoint_removed",
    hint: "Quest progression is server-driven now.",
  });
});

router.post("/quests/claim", requireAuth, (req, res) => {
  const id = String(req.body?.id || "");
  // Wrap the whole claim flow in a transaction with a re-check inside.
  // Two concurrent claim calls for the same quest used to both pass the
  // pre-tx `claimed:false` check and both UPDATE — second clobbered
  // first's JSON but both applied the coin/spin grant.
  let result;
  try {
    const tx = db.transaction(() => {
      const row = db.prepare("SELECT quests_json FROM stats WHERE user_id = ?").get(req.user.id);
      if (!row) { result = { status: 404, body: { error: "no_stats_row" } }; return; }
      let quests = [];
      try { quests = JSON.parse(row.quests_json || "[]"); } catch (e) { quests = []; }
      const q = quests.find((x) => x.id === id);
      if (!q) { result = { status: 404, body: { error: "no_such_quest" } }; return; }
      if (q.claimed) { result = { status: 400, body: { error: "already_claimed" } }; return; }
      if ((q.progress || 0) < q.target) { result = { status: 400, body: { error: "not_complete" } }; return; }
      q.claimed = true;
      const reward = q.reward || {};
      db.prepare(`
        UPDATE stats SET
          quests_json = ?, coins = coins + ?, free_spins = free_spins + ?, updated_at = ?
        WHERE user_id = ?
      `).run(JSON.stringify(quests), reward.coins || 0, reward.free_spins || 0, Date.now(), req.user.id);
      result = { status: 200, body: { ok: true, reward } };
    });
    tx();
  } catch (e) {
    console.error("[quests/claim] failed", e);
    return res.status(500).json({ error: "claim_failed" });
  }
  if (result.status !== 200) return res.status(result.status).json(result.body);
  res.json({ ...result.body, stats: loadStats(req.user.id) });
});

// ─── Weekly quest endpoints (mirror of /quests) ────────────────────────
router.get("/weekly-quests", requireAuth, (req, res) => {
  const quests = ensureWeeklyQuests(req.user.id);
  res.json({ week: weekKey(), quests });
});

router.post("/weekly-quests/claim", requireAuth, (req, res) => {
  const id = String(req.body?.id || "");
  // Same transactional pattern as /quests/claim — weekly rewards
  // (up to 1800 coins + 15 spins) make the double-claim race even
  // more attractive, so it MUST be race-safe.
  let result;
  try {
    const tx = db.transaction(() => {
      const row = db.prepare("SELECT weekly_quests_json FROM stats WHERE user_id = ?").get(req.user.id);
      if (!row) { result = { status: 404, body: { error: "no_stats_row" } }; return; }
      let quests = [];
      try { quests = JSON.parse(row.weekly_quests_json || "[]"); } catch (e) { quests = []; }
      const q = quests.find((x) => x.id === id);
      if (!q) { result = { status: 404, body: { error: "no_such_quest" } }; return; }
      if (q.claimed) { result = { status: 400, body: { error: "already_claimed" } }; return; }
      if ((q.progress || 0) < q.target) { result = { status: 400, body: { error: "not_complete" } }; return; }
      q.claimed = true;
      const reward = q.reward || {};
      db.prepare(`
        UPDATE stats SET
          weekly_quests_json = ?, coins = coins + ?, free_spins = free_spins + ?, updated_at = ?
        WHERE user_id = ?
      `).run(JSON.stringify(quests), reward.coins || 0, reward.free_spins || 0, Date.now(), req.user.id);
      result = { status: 200, body: { ok: true, reward } };
    });
    tx();
  } catch (e) {
    console.error("[weekly-quests/claim] failed", e);
    return res.status(500).json({ error: "claim_failed" });
  }
  if (result.status !== 200) return res.status(result.status).json(result.body);
  res.json({ ...result.body, stats: loadStats(req.user.id) });
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
  // Include the user's own level so the pinned "you" row on the live
  // leaderboard can show the correct value instead of the leader's level.
  const myLevel = db.prepare("SELECT level FROM stats WHERE user_id = ?").get(req.user.id);
  res.json({
    rank, total, high_score: me.high_score,
    level: myLevel ? myLevel.level : 1,
    online_rank: onlineRank, online_total: onlineTotal,
  });
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
  const body = req.body || {};
  // Clamp every numeric input so a malicious client can't write huge
  // values into the leaderboard. Hard caps cover the largest plausible
  // single-round outcome (10 questions × hard difficulty × multipliers).
  const score        = clampInt(body.score,           0, 20000);
  const correct      = clampInt(body.correct,         0, 50);
  const incorrect    = clampInt(body.incorrect,       0, 50);
  const xp_gained    = clampInt(body.xp_gained,       0, 5000);
  const coins_gained = clampInt(body.coins_gained,    0, 5000);
  const best_streak_run = clampInt(body.best_streak_run, 0, 50);
  const category_id  = body.category_id != null ? Number(body.category_id) : null;
  const now = Date.now();

  const stats = db.prepare("SELECT * FROM stats WHERE user_id = ?").get(req.user.id);
  if (!stats) return res.status(404).json({ error: "no_stats_row" });
  const newXp = stats.xp + xp_gained;
  const newLevel = 1 + Math.floor(Math.sqrt(newXp / 100));
  const newBest = Math.max(stats.best_streak, best_streak_run);
  const leveledUp = newLevel > stats.level;

  // Grant a streak_saver power-up on every level-up. Defends against
  // a NULL/malformed powerups_json (e.g. row inserted before migration)
  // by treating it as the default object.
  let powerupsUpdate = stats.powerups_json;
  if (leveledUp) {
    let p = {};
    try { p = JSON.parse(stats.powerups_json || "{}") || {}; } catch (e) { p = {}; }
    p.streak_saver = (p.streak_saver || 0) + 1;
    powerupsUpdate = JSON.stringify(p);
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

  // Auto-progress today's quests from the game event. Sum metrics get
  // incremented; best_streak uses 'max' so two rounds with a 4-streak
  // and a 6-streak record 6 (not 10) for the day.
  const isPerfect = correct >= 10 && incorrect === 0;
  const questEvents = [
    { metric: "rounds_today",         amount: 1 },
    { metric: "spins_today",          amount: 1 },
    { metric: "correct_today",        amount: Math.max(0, correct) },
    { metric: "best_streak_today",    amount: Math.floor(best_streak_run), setMode: "max" },
    { metric: "coins_earned_today",   amount: Math.max(0, Math.floor(coins_gained)) },
    { metric: "xp_earned_today",      amount: Math.max(0, Math.floor(xp_gained)) },
  ];
  if (isPerfect) questEvents.push({ metric: "perfect_rounds_today", amount: 1 });
  if (leveledUp) questEvents.push({ metric: "level_ups_today", amount: 1 });
  if (category_id) questEvents.push({ metric: "categories_today", amount: 1 });
  progressAllQuestsFor(req.user.id, questEvents);

  // Award any newly-eligible badges from this game. New ones come back in
  // the response so the client can fire a celebration toast.
  let newBadges = [];
  try {
    const badges = require("../badges");
    newBadges = badges.awardEligible(req.user.id);
  } catch (e) {}

  res.json({ ...loadStats(req.user.id), leveled_up: leveledUp, new_badges: newBadges });
});

// Whitelist of valid achievement ids. Must stay in sync with the
// frontend's src/data/achievements.js. Stops clients from polluting
// the achievements table with arbitrary strings and prevents future
// rewards (if achievements ever pay out) from being exploitable.
const VALID_ACHIEVEMENTS = new Set([
  "first_round", "perfect_round", "ten_rounds", "fifty_rounds", "hundred_rounds",
  "first_win_online", "ten_wins_online", "five_streak", "ten_streak", "twenty_streak",
  "daily_3", "daily_7", "daily_30",
  "level_5", "level_10", "level_25", "level_50",
  "first_friend", "pro_subscriber", "first_theme", "all_themes",
]);

router.post("/achievement", requireAuth, (req, res) => {
  const { achievement_id } = req.body || {};
  const id = String(achievement_id || "");
  if (!id) return res.status(400).json({ error: "missing achievement_id" });
  if (!VALID_ACHIEVEMENTS.has(id)) return res.status(400).json({ error: "unknown_achievement" });
  db.prepare(
    "INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)"
  ).run(req.user.id, id, Date.now());
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
module.exports.progressQuestsFor = progressQuestsFor;
module.exports.progressAllQuestsFor = progressAllQuestsFor;
module.exports.ensureWeeklyQuests = ensureWeeklyQuests;
module.exports.weekKey = weekKey;
