const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "trivia.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    coins INTEGER NOT NULL DEFAULT 50,
    games_played INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    incorrect INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    longest_daily_streak INTEGER NOT NULL DEFAULT 0,
    current_daily_streak INTEGER NOT NULL DEFAULT 0,
    last_daily_date TEXT,
    powerups_json TEXT NOT NULL DEFAULT '{"fifty":1,"skip":1,"freeze":1,"double":1,"streak_saver":0}',
    themes_json TEXT NOT NULL DEFAULT '["classic"]',
    active_theme TEXT NOT NULL DEFAULT 'classic',
    pro_until INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS achievements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
  );

  CREATE TABLE IF NOT EXISTS daily_scores (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    score INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    time_ms INTEGER NOT NULL,
    submitted_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_scores_date ON daily_scores(date, score DESC);

  CREATE TABLE IF NOT EXISTS leaderboard (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    high_score INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard(high_score DESC);

  CREATE TABLE IF NOT EXISTS pro_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    stripe_event_id TEXT UNIQUE,
    kind TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    category_name TEXT NOT NULL,
    difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
    question TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    incorrect_answers TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'seed',
    question_hash TEXT UNIQUE NOT NULL,
    served_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_questions_lookup ON questions(category_id, difficulty);
  CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);

  CREATE TABLE IF NOT EXISTS daily_questions (
    date TEXT NOT NULL,
    position INTEGER NOT NULL,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    PRIMARY KEY (date, position)
  );

  CREATE TABLE IF NOT EXISTS question_fetch_log (
    bucket TEXT PRIMARY KEY,
    last_fetched_at INTEGER NOT NULL,
    last_outcome TEXT
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    player1_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    player2_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    player1_score INTEGER NOT NULL DEFAULT 0,
    player2_score INTEGER NOT NULL DEFAULT 0,
    winner_id INTEGER,
    finished_at INTEGER NOT NULL,
    started_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_matches_p1 ON matches(player1_id, finished_at DESC);
  CREATE INDEX IF NOT EXISTS idx_matches_p2 ON matches(player2_id, finished_at DESC);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    room_code TEXT,
    text TEXT NOT NULL,
    filtered INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_recent ON chat_messages(created_at DESC);

  CREATE TABLE IF NOT EXISTS chat_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT,
    resolved_at INTEGER,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_reports_open ON chat_reports(resolved_at, created_at DESC);

  CREATE TABLE IF NOT EXISTS chat_mutes (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    muted_until INTEGER NOT NULL,
    reason TEXT,
    muted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );

  -- Telemetry / analytics. One row per event (visit, ad_watch, payment, etc).
  -- Use SQL aggregations to answer "ads watched today / this week / this month".
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    amount REAL,
    meta TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_kind_time ON events(kind, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at DESC);

  -- Admin-editable encrypted settings (PayPal/Stripe keys, etc.).
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_encrypted TEXT NOT NULL,
    is_secret INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  -- Friendships. Always store user_a < user_b so each pair has one row.
  CREATE TABLE IF NOT EXISTS friendships (
    user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending', 'accepted')),
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    accepted_at INTEGER,
    PRIMARY KEY (user_a, user_b)
  );
  CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(user_a, status);
  CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b, status);

  -- Per-category mastery stats.
  CREATE TABLE IF NOT EXISTS category_stats (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    incorrect INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, category_id)
  );

  -- Audit log of admin actions. Append-only.
  CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target TEXT,
    meta TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit(created_at DESC);
`);

// Migration: add columns to users if they're missing (idempotent).
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "banned_at", "INTEGER");
ensureColumn("users", "country", "TEXT");
ensureColumn("users", "language", "TEXT");

// v3 schema additions: free spins economy + online match stats + daily login streak.
ensureColumn("stats", "free_spins", "INTEGER NOT NULL DEFAULT 3");
ensureColumn("stats", "last_login_date", "TEXT");
ensureColumn("stats", "login_streak", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "online_wins", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "online_losses", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "online_rating", "INTEGER NOT NULL DEFAULT 1000");
ensureColumn("stats", "win_streak", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "last_ad_at", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "ads_today_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "ads_today_date", "TEXT");
ensureColumn("stats", "quests_date", "TEXT");
ensureColumn("stats", "quests_json", "TEXT NOT NULL DEFAULT '[]'");

// Boost timestamps + flag for the cosmetics store consumables.
// xp/coins multipliers store expiry as ms; streak_saver is a 0/1 flag
// consumed on the next missed-day daily streak check.
ensureColumn("stats", "lives", "INTEGER NOT NULL DEFAULT 5");
ensureColumn("stats", "lives_updated_at", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "xp_2x_until", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "coins_2x_until", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "streak_saver_active", "INTEGER NOT NULL DEFAULT 0");

// 2FA columns on users (admin TOTP).
ensureColumn("users", "totp_secret_enc", "TEXT");
ensureColumn("users", "totp_enabled", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "totp_backup_codes_json", "TEXT");

// Profile avatar (data URL or preset id). Capped at ~3MB encoded.
ensureColumn("users", "avatar", "TEXT");

// Single-device enforcement: every login mints a fresh random session_id
// and writes it here. JWTs embed it as `sid`; auth middleware rejects any
// token whose sid doesn't match. Logging in on a new device replaces the
// session_id and effectively signs out every other device.
ensureColumn("users", "session_id", "TEXT");

// Per-user question-seen ledger. When a logged-in user starts a round, the
// picker filters this table out so they don't see repeats until the
// (category, difficulty) pool is exhausted; at that point the rows for
// that bucket are wiped and the cycle starts over.
db.exec(`
  CREATE TABLE IF NOT EXISTS seen_questions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, question_id)
  );
  CREATE INDEX IF NOT EXISTS idx_seen_user_time ON seen_questions(user_id, seen_at DESC);
`);

// Cosmetics store. `cosmetics` is the catalog (seeded from a JSON file at
// boot, idempotent by id), `user_cosmetics` is per-user ownership (qty
// supports consumables like XP boosts), and `user_equipped` is the one-
// equipped-per-category state (frames, pointers, celebrations, titles).
db.exec(`
  CREATE TABLE IF NOT EXISTS cosmetics (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price_coins INTEGER NOT NULL DEFAULT 0,
    rarity TEXT NOT NULL DEFAULT 'common',
    icon TEXT,
    data TEXT,
    pro_only INTEGER NOT NULL DEFAULT 0,
    consumable INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_cosmetics_category ON cosmetics(category, sort_order);

  CREATE TABLE IF NOT EXISTS user_cosmetics (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cosmetic_id TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    purchased_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, cosmetic_id)
  );

  CREATE TABLE IF NOT EXISTS user_equipped (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    cosmetic_id TEXT,
    PRIMARY KEY (user_id, category)
  );
`);

// On boot, promote any user whose email is listed in ADMIN_EMAILS env var.
const adminEmails = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
if (adminEmails.length) {
  const stmt = db.prepare("UPDATE users SET is_admin = 1 WHERE email = ?");
  for (const e of adminEmails) stmt.run(e);
}


module.exports = db;
