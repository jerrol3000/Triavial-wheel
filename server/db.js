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

  -- Anonymous play counter for the public daily marketing surface
  -- (spinlore.app/d/<date>). One row per date; incremented every
  -- time a guest hits POST /api/daily/public/play. Powers the
  -- "247 people played today" social-proof line on the share card
  -- without storing any PII about anonymous players.
  CREATE TABLE IF NOT EXISTS daily_play_counter (
    date TEXT PRIMARY KEY,
    plays INTEGER NOT NULL DEFAULT 0
  );

  -- Season Pass (a.k.a. Battle Pass). Each season is a time-bounded
  -- progression ladder: players earn season XP by playing, every
  -- tier unlocks a reward. Free track gets a subset; premium track
  -- gets all of them. Premium unlocked once-per-season for a flat
  -- coin/USD price.
  --
  -- Season definitions are HARDCODED in src/server/seasons.js (not
  -- DB-driven) — they don't change at runtime and embedding the
  -- tier definitions in code keeps the migration story simple.
  -- Per-user progress is what lives here.
  CREATE TABLE IF NOT EXISTS user_season (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    premium INTEGER NOT NULL DEFAULT 0,
    -- Bitmask of claimed tiers (tier 0 = bit 0, tier 1 = bit 1, …).
    -- 64-bit signed → supports up to 63 tiers per season, plenty.
    claimed_mask INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, season_id)
  );

  -- Higher/Lower best-streak per dataset. Each row = the player's
  -- personal best in that dataset. UNIQUE on (user_id, dataset) so
  -- the row is in-place updated when a higher streak is recorded.
  -- Drives the H/L global leaderboard + the per-user personal best
  -- display in the picker.
  CREATE TABLE IF NOT EXISTS hl_scores (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dataset TEXT NOT NULL,
    best_streak INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, dataset)
  );
  CREATE INDEX IF NOT EXISTS idx_hl_dataset_score ON hl_scores(dataset, best_streak DESC);

  -- Daily VS leaderboard tally. One row per (user, UTC date) counting
  -- ranked match wins for the day. Resolved at day-end (or lazily on
  -- first read after the date rolls over) into cosmetic + coin prizes
  -- for top placements. Simpler than running a synchronous tournament:
  -- the daily leaderboard ALREADY embodies the "compete to climb"
  -- mechanic, plus it scales without a real-time scheduler.
  CREATE TABLE IF NOT EXISTS daily_vs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    ties INTEGER NOT NULL DEFAULT 0,
    -- prizes are awarded once per (user, date) at day-end. Bitflag:
    -- bit 0 = top-3 prize claimed, bit 1 = top-10 prize claimed.
    prizes_awarded INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_vs_leaderboard ON daily_vs(date, wins DESC);

  -- VS rivalry tracker. Persistent head-to-head record between any
  -- two players who have ever played each other online. Drives the
  -- "You're 5-3 against MrAlex" callouts in the VS lobby + match-end
  -- screens. Ordered tuple (user_a < user_b) keeps the row unique
  -- regardless of which side initiated.
  CREATE TABLE IF NOT EXISTS vs_rivalries (
    user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- "wins" counters are from each side's POV. a_wins = # times A won.
    a_wins INTEGER NOT NULL DEFAULT 0,
    b_wins INTEGER NOT NULL DEFAULT 0,
    ties   INTEGER NOT NULL DEFAULT 0,
    last_played_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b)
  );

  -- Friend Challenge: one player sends a 5-question challenge to
  -- another. Receiver has 24h to play the SAME 5 questions. The
  -- challenge resolves automatically once both have played (or the
  -- receiver expires), splitting the wager: winner takes the pot,
  -- tie returns the wager.
  CREATE TABLE IF NOT EXISTS friend_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    questions_json TEXT NOT NULL,
    wager INTEGER NOT NULL DEFAULT 0,
    sender_correct INTEGER,
    sender_time_ms INTEGER,
    receiver_correct INTEGER,
    receiver_time_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | resolved | expired
    winner_id INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_fc_receiver ON friend_challenges(receiver_id, status);
  CREATE INDEX IF NOT EXISTS idx_fc_sender ON friend_challenges(sender_id, status);

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
ensureColumn("stats", "free_spins", "INTEGER NOT NULL DEFAULT 5");
// Stamps when the player's free_spins last crossed the regen floor —
// used by /stats/use-free-spin to start the regen clock and by
// /stats/spin-claim to compute how many ticks of regen are claimable.
// Without this column, /use-free-spin throws SqliteError "no such
// column" → 500 → wheel debit silently fails on the deployed DB
// (the migration was missed in an earlier commit). Default = now so
// existing rows aren't treated as having infinite regen pending.
ensureColumn("stats", "free_spins_updated_at", "INTEGER NOT NULL DEFAULT 0");
// Comeback Boost: flag flipped to 1 the moment the player loses a
// ranked (quick) VS match. Their NEXT ranked win then applies a
// +50% rating bonus and clears the flag. Small psychological hook
// ("just one more, I can climb back") — and a natural monetization
// vector if we later add a paid "extra boost" SKU.
ensureColumn("stats", "comeback_boost_active", "INTEGER NOT NULL DEFAULT 0");
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

// Weekly quest set — refreshed every Monday 00:00 UTC. Same shape as the
// daily quests but with a separate templates pool and bigger targets /
// rewards. weekly_quests_week is an ISO week key like "2026-W21".
ensureColumn("stats", "weekly_quests_week", "TEXT");
ensureColumn("stats", "weekly_quests_json", "TEXT NOT NULL DEFAULT '[]'");

// Boost timestamps + flag for the cosmetics store consumables.
// xp/coins multipliers store expiry as ms; streak_saver is a 0/1 flag
// consumed on the next missed-day daily streak check.
ensureColumn("stats", "lives", "INTEGER NOT NULL DEFAULT 5");
ensureColumn("stats", "lives_updated_at", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "xp_2x_until", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "coins_2x_until", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "streak_saver_active", "INTEGER NOT NULL DEFAULT 0");

// Lifetime tracking columns used by the badge award engine. coins_spent_total
// covers everything (cosmetics, refills, themes), online_games_played and
// online_wins_total mirror existing online_wins/online_losses but capture
// total played for "Veteran of 50 online matches" style badges.
ensureColumn("stats", "coins_spent_total", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "cosmetics_owned_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "pro_lifetime_months", "INTEGER NOT NULL DEFAULT 0");

// Notification read-state. The notifications endpoint derives
// notifications from existing tables (friendships, events) on demand;
// this column just records the last time the user opened the bell so
// we can compute unread counts without a separate notifications table.
// `notifications_cleared_at` is separate from seen_at — opening the
// panel sets seen_at (clears the unread badge); the Clear All button
// sets cleared_at (hides ALL items at or before that time from the
// returned list entirely).
ensureColumn("stats", "notifications_seen_at", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stats", "notifications_cleared_at", "INTEGER NOT NULL DEFAULT 0");

// Per-user privacy toggle for the public-profile showcase. When 0,
// /api/players/:id returns the minimal {username, level, pro} only —
// no cosmetics, no badges, no stats. Defaults to 1 (show everything)
// since the whole purpose of buying cosmetics is to flaunt them.
ensureColumn("stats", "showcase_public", "INTEGER NOT NULL DEFAULT 1");

// Distinct-category set played today (JSON array of category_ids).
// Reset to '[]' whenever the daily quest set rolls (ensureQuests).
// Used to turn `categories_today` quests into a true distinct-set
// counter — without this, the metric was just a per-round counter
// (and two rounds of the same category counted as 2).
ensureColumn("stats", "categories_today_json", "TEXT NOT NULL DEFAULT '[]'");

// Backfill for cosmetics columns added after the table was first created.
// CREATE TABLE IF NOT EXISTS is a no-op on schema-changed tables, so the
// limited-edition windows + bundle pointer need an explicit migration.
ensureColumn("cosmetics", "available_from", "INTEGER");
ensureColumn("cosmetics", "available_until", "INTEGER");
ensureColumn("cosmetics", "bundle_contents", "TEXT");

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
// `available_from` / `available_until` make limited-edition drops possible
// (catalog filter strips items outside their window).
// `bundle_contents` is a JSON array of cosmetic ids granted when a bundle
// is purchased (server-side atomic). Bundles use a "bundle" category and
// have a single price that's deliberately discounted vs the sum-of-parts.
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
    sort_order INTEGER NOT NULL DEFAULT 0,
    available_from INTEGER,
    available_until INTEGER,
    bundle_contents TEXT
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

// Badges — earned through gameplay, spending, or milestones. Catalog is
// seeded from data/badges-catalog.json (idempotent). user_badges records
// when each badge was earned. Players can showcase up to 3 in their
// "badge case" (the equipped_slot column 1-3 = displayed, null = not).
db.exec(`
  CREATE TABLE IF NOT EXISTS badges (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'bronze',
    icon TEXT,
    criteria_type TEXT NOT NULL,
    criteria_value INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_badges_category ON badges(category, sort_order);

  CREATE TABLE IF NOT EXISTS user_badges (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id TEXT NOT NULL,
    earned_at INTEGER NOT NULL,
    equipped_slot INTEGER,
    PRIMARY KEY (user_id, badge_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_badges_equipped ON user_badges(user_id, equipped_slot);
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
