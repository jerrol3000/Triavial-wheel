const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAdmin } = require("../auth");
const { refreshAllBuckets, getTotalCount, getBucketCount, CATEGORIES, DIFFICULTIES, pickDailyQuestions } = require("../questions");
const { muteUser, unmuteUser } = require("../moderation");
const { countSince, sumSince, distinctUsersSince, dailyBreakdown } = require("../events");
const settings = require("../settings");
const audit = require("../audit");
const cryptoEnv = require("../crypto");

const router = express.Router();
router.use(requireAdmin);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Bootstrap admins — emails pinned in the ADMIN_EMAILS env var. These
// accounts are auto-promoted on boot + register, and they cannot be
// demoted, banned, or deleted by any other admin via the panel. This
// guarantees the owner can never be locked out by a rogue promotee.
const BOOTSTRAP_ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
function isBootstrapAdmin(userId) {
  const row = db.prepare("SELECT email FROM users WHERE id = ?").get(userId);
  return !!(row && row.email && BOOTSTRAP_ADMIN_EMAILS.has(row.email.toLowerCase()));
}

// ─── Settings (encrypted PayPal/Stripe creds, editable in admin UI) ─────────
router.get("/settings", (req, res) => {
  res.json({
    encryption_configured: settings.isEncryptionConfigured(),
    suggest_key: settings.isEncryptionConfigured() ? null : cryptoEnv.suggestKey(),
    settings: settings.list(),
  });
});

router.put("/settings", (req, res) => {
  const body = req.body || {};
  if (!settings.isEncryptionConfigured()) {
    return res.status(503).json({ error: "encryption_not_configured", hint: "Set ADMIN_SETTINGS_KEY in server/.env first; the response from GET /admin/settings includes a suggested key." });
  }
  const errors = [];
  const applied = [];
  for (const [key, value] of Object.entries(body)) {
    if (!settings.isAllowedKey(key)) { errors.push({ key, error: "not_allowed" }); continue; }
    try {
      settings.set(key, value, req.user.id);
      applied.push(key);
      audit.logAdmin(req.user.id, "settings.set", key, { source: "admin_ui" });
    } catch (e) {
      errors.push({ key, error: e.message });
    }
  }
  res.json({ applied, errors, settings: settings.list() });
});

router.get("/audit", (req, res) => {
  res.json(audit.recent(Math.min(200, Math.max(1, Number(req.query.limit || 100)))));
});

// ─── Analytics ──────────────────────────────────────────────────────────────
router.get("/analytics", (req, res) => {
  const windows = { today: DAY, week: 7 * DAY, month: 30 * DAY };
  function rollup(kind, sumAmount = false) {
    const out = {};
    for (const [name, ms] of Object.entries(windows)) {
      out[name] = sumAmount
        ? { count: countSince(kind, ms), revenue: Number(sumSince(kind, ms).toFixed(2)) }
        : { count: countSince(kind, ms) };
    }
    return out;
  }
  res.json({
    visits: {
      ...rollup("visit"),
      unique_today: distinctUsersSince("visit", DAY),
      unique_week: distinctUsersSince("visit", 7 * DAY),
      unique_month: distinctUsersSince("visit", 30 * DAY),
    },
    signups: rollup("signup"),
    logins: rollup("login"),
    ad_watches: rollup("ad_watch"),
    payments: rollup("payment", true),
    daily: {
      visits: dailyBreakdown("visit", 30),
      ad_watches: dailyBreakdown("ad_watch", 30),
      payments: dailyBreakdown("payment", 30),
    },
  });
});

// ─── Moderation ─────────────────────────────────────────────────────────────
router.get("/moderation/reports", (req, res) => {
  const open = req.query.open !== "0";
  const rows = db.prepare(`
    SELECT r.id, r.message_id, r.reason, r.created_at, r.resolved_at,
           m.text, m.username AS author, m.user_id AS author_id, m.filtered, m.room_code,
           u.username AS reporter
    FROM chat_reports r
    JOIN chat_messages m ON m.id = r.message_id
    JOIN users u ON u.id = r.reporter_id
    ${open ? "WHERE r.resolved_at IS NULL" : ""}
    ORDER BY r.created_at DESC LIMIT 100
  `).all();
  res.json(rows);
});

router.post("/moderation/reports/:id/resolve", (req, res) => {
  db.prepare("UPDATE chat_reports SET resolved_at = ?, resolved_by = ? WHERE id = ?")
    .run(Date.now(), req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

router.get("/moderation/chat", (req, res) => {
  const filtered = req.query.filtered === "1";
  const rows = db.prepare(`
    SELECT id, user_id, username, room_code, text, filtered, created_at
    FROM chat_messages
    ${filtered ? "WHERE filtered = 1" : ""}
    ORDER BY created_at DESC LIMIT 100
  `).all();
  res.json(rows);
});

router.get("/moderation/mutes", (req, res) => {
  const rows = db.prepare(`
    SELECT m.user_id, u.username, m.muted_until, m.reason, m.muted_by, m.created_at
    FROM chat_mutes m JOIN users u ON u.id = m.user_id
    WHERE m.muted_until > ?
    ORDER BY m.muted_until DESC
  `).all(Date.now());
  res.json(rows);
});

router.post("/moderation/mute", (req, res) => {
  const { user_id, hours = 24, reason = "" } = req.body || {};
  if (!user_id) return res.status(400).json({ error: "user_id required" });
  const until = muteUser(Number(user_id), Math.max(1, Number(hours)) * 60 * 60 * 1000, String(reason), req.user.id);
  res.json({ ok: true, muted_until: until });
});

router.post("/moderation/unmute", (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: "user_id required" });
  unmuteUser(Number(user_id));
  res.json({ ok: true });
});

// ─── Overview / dashboard ───────────────────────────────────────────────────
router.get("/overview", (req, res) => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const newUsers7d = db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at > ?").get(now - 7 * day).n;
  const banned = db.prepare("SELECT COUNT(*) AS n FROM users WHERE banned_at IS NOT NULL").get().n;
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1").get().n;
  const proCount = db.prepare("SELECT COUNT(*) AS n FROM stats WHERE pro_until > ?").get(now).n;
  const questionCount = getTotalCount();
  const dailyToday = db.prepare("SELECT COUNT(*) AS n FROM daily_scores WHERE date = ?").get(todayKey()).n;
  const gamesTotal = db.prepare("SELECT SUM(games_played) AS n FROM stats").get().n || 0;
  const totalCorrect = db.prepare("SELECT SUM(correct) AS n FROM stats").get().n || 0;
  const totalIncorrect = db.prepare("SELECT SUM(incorrect) AS n FROM stats").get().n || 0;
  const proEventsCount = db.prepare("SELECT COUNT(*) AS n FROM pro_events").get().n;

  const recentSignups = db
    .prepare("SELECT id, email, username, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT 10")
    .all()
    .map((r) => ({ ...r, is_admin: !!r.is_admin }));

  const topLeaderboard = db.prepare(`
    SELECT u.username, l.high_score, s.level
    FROM leaderboard l
    JOIN users u ON u.id = l.user_id
    JOIN stats s ON s.user_id = l.user_id
    ORDER BY l.high_score DESC LIMIT 10
  `).all();

  // Bucket health
  const buckets = [];
  for (const cat of CATEGORIES) {
    for (const diff of DIFFICULTIES) {
      buckets.push({ category: cat.name, category_id: cat.id, difficulty: diff, count: getBucketCount(cat.id, diff) });
    }
  }

  res.json({
    users: { total: userCount, new_7d: newUsers7d, banned, admins, pro: proCount },
    questions: { total: questionCount, buckets },
    daily: { plays_today: dailyToday, date: todayKey() },
    games: { total: gamesTotal, correct: totalCorrect, incorrect: totalIncorrect },
    pro_events: proEventsCount,
    recent_signups: recentSignups,
    top_leaderboard: topLeaderboard,
  });
});

function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ─── Users ──────────────────────────────────────────────────────────────────
router.get("/users", (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  // Filter shortcuts for bulk-management workflows. Stack with each
  // other AND with the search query, so an admin can find e.g.
  // "banned users with 'test' in the email, inactive for 30+ days"
  // before clicking bulk-delete.
  //   filter=banned     — banned_at IS NOT NULL
  //   filter=admins     — is_admin = 1
  //   filter=pro        — pro_until > now
  //   filter=test       — email or username contains "test"
  //   inactive_days=30  — created > 30 days ago AND last login (or
  //                       updated_at) older than 30 days ago. We use
  //                       stats.updated_at as a proxy for "last active".
  const filter = String(req.query.filter || "").toLowerCase();
  const inactiveDays = Math.max(0, Number(req.query.inactive_days || 0)) | 0;
  const params = [];
  const conds = [];
  if (q) {
    conds.push("(LOWER(u.email) LIKE ? OR LOWER(u.username) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }
  if (filter === "banned") conds.push("u.banned_at IS NOT NULL");
  if (filter === "admins") conds.push("u.is_admin = 1");
  if (filter === "pro") { conds.push("s.pro_until > ?"); params.push(Date.now()); }
  if (filter === "test") {
    conds.push("(LOWER(u.email) LIKE '%test%' OR LOWER(u.username) LIKE '%test%')");
  }
  if (inactiveDays > 0) {
    const cutoff = Date.now() - inactiveDays * DAY;
    // updated_at tracks last stats change (any gameplay action bumps it);
    // created_at is the registration timestamp. We want "registered MORE
    // than N days ago AND no activity in the last N days" — that
    // excludes brand-new dormant signups.
    conds.push("u.created_at < ?");
    conds.push("COALESCE(s.updated_at, 0) < ?");
    params.push(cutoff, cutoff);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT u.id, u.email, u.username, u.is_admin, u.banned_at, u.created_at,
           s.xp, s.level, s.coins, s.games_played, s.pro_until, s.updated_at AS last_active_at,
           l.high_score
    FROM users u
    LEFT JOIN stats s ON s.user_id = u.id
    LEFT JOIN leaderboard l ON l.user_id = u.id
    ${where}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users u LEFT JOIN stats s ON s.user_id = u.id ${where}`).get(...params).n;
  res.json({
    total,
    users: rows.map((r) => ({
      ...r,
      is_admin: !!r.is_admin,
      pro: !!(r.pro_until && r.pro_until > Date.now()),
    })),
  });
});

router.get("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare(`
    SELECT u.id, u.email, u.username, u.is_admin, u.banned_at, u.created_at,
           s.*, l.high_score
    FROM users u
    LEFT JOIN stats s ON s.user_id = u.id
    LEFT JOIN leaderboard l ON l.user_id = u.id
    WHERE u.id = ?
  `).get(id);
  if (!u) return res.status(404).json({ error: "not found" });
  const achievements = db.prepare("SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?").all(id);
  res.json({
    ...u,
    is_admin: !!u.is_admin,
    pro: !!(u.pro_until && u.pro_until > Date.now()),
    powerups: u.powerups_json ? JSON.parse(u.powerups_json) : {},
    themes: u.themes_json ? JSON.parse(u.themes_json) : ["classic"],
    achievements,
  });
});

router.put("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const { is_admin, banned, grant_pro_days, set_coins, reset_stats } = req.body || {};
  audit.logAdmin(req.user.id, "user.update", String(id), req.body);
  const u = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!u) return res.status(404).json({ error: "not found" });

  // Bootstrap admins (emails in ADMIN_EMAILS) cannot be demoted or banned
  // by anyone — guarantees the owner can't be locked out.
  const targetIsBootstrap = isBootstrapAdmin(id);

  if (typeof is_admin === "boolean") {
    if (id === req.user.id && !is_admin) return res.status(400).json({ error: "cannot demote yourself" });
    if (targetIsBootstrap && !is_admin) return res.status(403).json({ error: "cannot demote bootstrap admin" });
    db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(is_admin ? 1 : 0, id);
  }
  if (typeof banned === "boolean") {
    if (id === req.user.id && banned) return res.status(400).json({ error: "cannot ban yourself" });
    if (targetIsBootstrap && banned) return res.status(403).json({ error: "cannot ban bootstrap admin" });
    db.prepare("UPDATE users SET banned_at = ? WHERE id = ?").run(banned ? Date.now() : null, id);
  }
  if (typeof grant_pro_days === "number" && grant_pro_days > 0) {
    const until = Date.now() + Math.floor(grant_pro_days) * 24 * 60 * 60 * 1000;
    db.prepare("UPDATE stats SET pro_until = ?, updated_at = ? WHERE user_id = ?").run(until, Date.now(), id);
  }
  if (grant_pro_days === 0) {
    db.prepare("UPDATE stats SET pro_until = NULL, updated_at = ? WHERE user_id = ?").run(Date.now(), id);
  }
  if (typeof set_coins === "number" && set_coins >= 0) {
    db.prepare("UPDATE stats SET coins = ?, updated_at = ? WHERE user_id = ?").run(Math.floor(set_coins), Date.now(), id);
  }
  if (reset_stats) {
    // Full wipe — every counter/derived stat back to defaults, plus the
    // tables that hang off the user (badges, quests, online ladder).
    // pro_until is intentionally preserved so admin doesn't accidentally
    // void a paid subscription by clicking "reset".
    db.prepare(`
      UPDATE stats SET
        xp = 0, level = 1, games_played = 0, correct = 0, incorrect = 0,
        best_streak = 0, longest_daily_streak = 0, current_daily_streak = 0, last_daily_date = NULL,
        online_wins = 0, online_losses = 0, online_rating = 1000, win_streak = 0,
        coins_spent_total = 0, cosmetics_owned_count = 0,
        xp_2x_until = 0, coins_2x_until = 0, streak_saver_active = 0,
        quests_date = NULL, quests_json = '[]',
        ads_today_count = 0, ads_today_date = NULL,
        updated_at = ?
      WHERE user_id = ?
    `).run(Date.now(), id);
    db.prepare("UPDATE leaderboard SET high_score = 0, updated_at = ? WHERE user_id = ?").run(Date.now(), id);
    db.prepare("DELETE FROM user_badges WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM seen_questions WHERE user_id = ?").run(id);
    // Also clear cosmetics ownership + equipped state so the
    // cosmetics_owned_count we just zeroed stays accurate. Otherwise
    // the next /store/buy would re-count owned items and silently
    // re-award collector badges based on stale ownership.
    db.prepare("DELETE FROM user_cosmetics WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM user_equipped WHERE user_id = ?").run(id);
  }
  res.json({ ok: true });
});

router.delete("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "cannot delete yourself" });
  if (isBootstrapAdmin(id)) return res.status(403).json({ error: "cannot delete bootstrap admin" });
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  audit.logAdmin(req.user.id, "user.delete", String(id));
  res.json({ ok: true });
});

// ─── Bulk user management ──────────────────────────────────────────────────
//
// All three endpoints share the same shape:
//   POST { user_ids: [int, int, ...] }
//   → { deleted|banned|unbanned: N, skipped: [{id, reason, ...}] }
//
// Safety:
//   - Hard cap of 500 IDs per request — accidental "select all from
//     a 10k-user database" pings can't bring down the box or get
//     audit-logged to oblivion.
//   - Self-ID + bootstrap admins always go into `skipped`, never the
//     destructive list. Server is the source of truth; the client UI
//     also hides the checkboxes on those rows but a tampered client
//     can't bypass these guards.
//   - All deletes happen in a single transaction so a malformed ID
//     mid-batch rolls back the whole thing — admin sees a clean
//     all-or-nothing failure, not a half-applied wipe.
//   - Audit log: one entry per affected user_id, prefixed with
//     "bulk." so a later forensic search can correlate the batch.
//   - users → all dependent tables have ON DELETE CASCADE FKs +
//     `PRAGMA foreign_keys = ON` (see db.js), so a user delete
//     also wipes stats, friendships, friend_challenges, leaderboard,
//     daily_scores, user_cosmetics, user_equipped, user_badges,
//     seen_questions, season progress, hl_scores, etc. No orphan
//     rows possible.
const BULK_MAX = 500;
function partitionIds(rawIds, selfId) {
  // Normalize, dedupe, filter invalid, split into actionable vs
  // skipped. Returns { actionable: [ids], skipped: [{id, reason}] }.
  const seen = new Set();
  const actionable = [];
  const skipped = [];
  for (const raw of rawIds || []) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      skipped.push({ id: raw, reason: "invalid_id" });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === selfId) { skipped.push({ id, reason: "self" }); continue; }
    if (isBootstrapAdmin(id)) { skipped.push({ id, reason: "bootstrap_admin" }); continue; }
    actionable.push(id);
  }
  return { actionable, skipped };
}

router.post("/users/bulk-delete", (req, res) => {
  const ids = req.body && req.body.user_ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "user_ids must be an array" });
  if (ids.length === 0) return res.status(400).json({ error: "no_ids" });
  if (ids.length > BULK_MAX) return res.status(400).json({ error: "too_many", max: BULK_MAX });

  const { actionable, skipped } = partitionIds(ids, req.user.id);
  if (actionable.length === 0) {
    return res.json({ deleted: 0, skipped });
  }

  // One transaction so any FK violation / unexpected error rolls
  // back ALL deletes. Admin sees a clean "nothing happened"
  // instead of a half-applied wipe they can't recover from.
  let deleted = 0;
  try {
    const del = db.prepare("DELETE FROM users WHERE id = ?");
    const tx = db.transaction((batch) => {
      let n = 0;
      for (const id of batch) {
        const r = del.run(id);
        if (r.changes > 0) n += 1;
      }
      return n;
    });
    deleted = tx(actionable);
  } catch (e) {
    console.error("[admin/bulk-delete] failed", e);
    return res.status(500).json({ error: "bulk_delete_failed", detail: String(e.message || e) });
  }

  // Audit log AFTER successful delete — one row per user, all sharing
  // the bulk action name + same timestamp so a forensic query can
  // correlate which delete was part of which batch.
  for (const id of actionable) {
    audit.logAdmin(req.user.id, "user.bulk_delete", String(id), { batch_size: actionable.length });
  }

  res.json({ deleted, skipped });
});

router.post("/users/bulk-ban", (req, res) => {
  const ids = req.body && req.body.user_ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "user_ids must be an array" });
  if (ids.length === 0) return res.status(400).json({ error: "no_ids" });
  if (ids.length > BULK_MAX) return res.status(400).json({ error: "too_many", max: BULK_MAX });

  const { actionable, skipped } = partitionIds(ids, req.user.id);
  if (actionable.length === 0) return res.json({ banned: 0, skipped });

  const now = Date.now();
  let banned = 0;
  try {
    const upd = db.prepare("UPDATE users SET banned_at = ? WHERE id = ? AND banned_at IS NULL");
    const tx = db.transaction((batch) => {
      let n = 0;
      for (const id of batch) {
        const r = upd.run(now, id);
        if (r.changes > 0) n += 1;
      }
      return n;
    });
    banned = tx(actionable);
  } catch (e) {
    console.error("[admin/bulk-ban] failed", e);
    return res.status(500).json({ error: "bulk_ban_failed" });
  }

  for (const id of actionable) {
    audit.logAdmin(req.user.id, "user.bulk_ban", String(id), { batch_size: actionable.length });
  }
  res.json({ banned, skipped });
});

router.post("/users/bulk-unban", (req, res) => {
  const ids = req.body && req.body.user_ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "user_ids must be an array" });
  if (ids.length === 0) return res.status(400).json({ error: "no_ids" });
  if (ids.length > BULK_MAX) return res.status(400).json({ error: "too_many", max: BULK_MAX });

  // Bootstrap-admin filter still applies (idempotent — they're never
  // banned anyway), self-id too. partitionIds handles both.
  const { actionable, skipped } = partitionIds(ids, req.user.id);
  if (actionable.length === 0) return res.json({ unbanned: 0, skipped });

  let unbanned = 0;
  try {
    const upd = db.prepare("UPDATE users SET banned_at = NULL WHERE id = ? AND banned_at IS NOT NULL");
    const tx = db.transaction((batch) => {
      let n = 0;
      for (const id of batch) {
        const r = upd.run(id);
        if (r.changes > 0) n += 1;
      }
      return n;
    });
    unbanned = tx(actionable);
  } catch (e) {
    console.error("[admin/bulk-unban] failed", e);
    return res.status(500).json({ error: "bulk_unban_failed" });
  }

  for (const id of actionable) {
    audit.logAdmin(req.user.id, "user.bulk_unban", String(id), { batch_size: actionable.length });
  }
  res.json({ unbanned, skipped });
});

// ─── Questions ──────────────────────────────────────────────────────────────
router.get("/questions", (req, res) => {
  const q = String(req.query.q || "").trim();
  const category = req.query.category ? Number(req.query.category) : null;
  const difficulty = req.query.difficulty ? String(req.query.difficulty) : null;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const params = [];
  const where = [];
  if (q) { where.push("(LOWER(question) LIKE ? OR LOWER(correct_answer) LIKE ?)"); const like = `%${q.toLowerCase()}%`; params.push(like, like); }
  if (category) { where.push("category_id = ?"); params.push(category); }
  if (difficulty) { where.push("difficulty = ?"); params.push(difficulty); }
  const wh = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM questions ${wh} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM questions ${wh}`).get(...params).n;
  res.json({
    total,
    questions: rows.map((r) => ({ ...r, incorrect_answers: JSON.parse(r.incorrect_answers) })),
  });
});

function hashQ(text, categoryId, difficulty) {
  return crypto.createHash("sha1").update(`${categoryId}|${difficulty}|${String(text).trim().toLowerCase()}`).digest("hex");
}

function validateQuestion(q) {
  if (!q.category_id || !CATEGORIES.find((c) => c.id === q.category_id)) return "invalid category_id";
  if (!DIFFICULTIES.includes(q.difficulty)) return "invalid difficulty";
  if (!q.question || typeof q.question !== "string") return "missing question";
  if (!q.correct_answer || typeof q.correct_answer !== "string") return "missing correct_answer";
  if (!Array.isArray(q.incorrect_answers) || q.incorrect_answers.length !== 3) return "incorrect_answers must be 3 strings";
  return null;
}

router.post("/questions", (req, res) => {
  const err = validateQuestion(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const { category_id, difficulty, question, correct_answer, incorrect_answers } = req.body;
  const cat = CATEGORIES.find((c) => c.id === category_id);
  try {
    const info = db.prepare(`
      INSERT INTO questions (category_id, category_name, difficulty, question, correct_answer, incorrect_answers, source, question_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)
    `).run(category_id, cat.name, difficulty, question, correct_answer, JSON.stringify(incorrect_answers), hashQ(question, category_id, difficulty), Date.now());
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "duplicate question" });
    res.status(500).json({ error: "server error" });
  }
});

router.put("/questions/:id", (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT * FROM questions WHERE id = ?").get(id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const merged = {
    category_id: req.body.category_id ?? cur.category_id,
    difficulty: req.body.difficulty ?? cur.difficulty,
    question: req.body.question ?? cur.question,
    correct_answer: req.body.correct_answer ?? cur.correct_answer,
    incorrect_answers: req.body.incorrect_answers ?? JSON.parse(cur.incorrect_answers),
  };
  const err = validateQuestion(merged);
  if (err) return res.status(400).json({ error: err });
  const cat = CATEGORIES.find((c) => c.id === merged.category_id);
  db.prepare(`
    UPDATE questions SET category_id = ?, category_name = ?, difficulty = ?, question = ?,
      correct_answer = ?, incorrect_answers = ?, question_hash = ?
    WHERE id = ?
  `).run(
    merged.category_id, cat.name, merged.difficulty, merged.question,
    merged.correct_answer, JSON.stringify(merged.incorrect_answers),
    hashQ(merged.question, merged.category_id, merged.difficulty), id
  );
  res.json({ ok: true });
});

router.delete("/questions/:id", (req, res) => {
  db.prepare("DELETE FROM questions WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

router.post("/questions/bulk", (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: "items must be array" });
  const insert = db.prepare(`
    INSERT OR IGNORE INTO questions (category_id, category_name, difficulty, question, correct_answer, incorrect_answers, source, question_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'admin-bulk', ?, ?)
  `);
  let added = 0, skipped = 0, errors = [];
  const tx = db.transaction(() => {
    for (const q of items) {
      const err = validateQuestion(q);
      if (err) { errors.push({ q, err }); continue; }
      const cat = CATEGORIES.find((c) => c.id === q.category_id);
      const info = insert.run(q.category_id, cat.name, q.difficulty, q.question, q.correct_answer, JSON.stringify(q.incorrect_answers), hashQ(q.question, q.category_id, q.difficulty), Date.now());
      if (info.changes > 0) added += 1; else skipped += 1;
    }
  });
  tx();
  res.json({ added, skipped, errors });
});

router.post("/questions/refresh", async (req, res) => {
  res.json({ ok: true, started: true, message: "Background refresh started — check /api/admin/overview" });
  // run async so the request returns immediately
  refreshAllBuckets({ force: !!req.body?.force }).catch((e) => console.error("[admin] refresh error", e));
});

// ─── Daily challenge ────────────────────────────────────────────────────────
router.get("/daily/:date?", (req, res) => {
  const date = req.params.date || todayKey();
  const rows = db.prepare(`
    SELECT q.*, dq.position FROM daily_questions dq
    JOIN questions q ON q.id = dq.question_id
    WHERE dq.date = ? ORDER BY dq.position
  `).all(date);
  const scores = db.prepare(`
    SELECT u.username, d.score, d.correct, d.total, d.time_ms, d.submitted_at
    FROM daily_scores d JOIN users u ON u.id = d.user_id
    WHERE d.date = ?
    ORDER BY d.score DESC, d.time_ms ASC
    LIMIT 50
  `).all(date);
  res.json({
    date,
    questions: rows.map((r) => ({ ...r, incorrect_answers: JSON.parse(r.incorrect_answers) })),
    scores,
  });
});

router.post("/daily/regenerate", (req, res) => {
  const date = req.body?.date || todayKey();
  db.prepare("DELETE FROM daily_questions WHERE date = ?").run(date);
  const picks = pickDailyQuestions(date, 10);
  res.json({ ok: true, date, count: picks.length });
});

// ─── Pro events / scores ────────────────────────────────────────────────────
router.get("/pro-events", (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const rows = db.prepare("SELECT id, user_id, stripe_event_id, kind, created_at FROM pro_events ORDER BY created_at DESC LIMIT ?").all(limit);
  res.json(rows);
});

router.get("/scores", (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const rows = db.prepare(`
    SELECT d.date, u.username, d.score, d.correct, d.total, d.time_ms, d.submitted_at
    FROM daily_scores d JOIN users u ON u.id = d.user_id
    ORDER BY d.submitted_at DESC LIMIT ?
  `).all(limit);
  res.json(rows);
});

module.exports = router;
