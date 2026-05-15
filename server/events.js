const db = require("./db");

const insert = db.prepare(`INSERT INTO events (kind, user_id, amount, meta, created_at) VALUES (?, ?, ?, ?, ?)`);

function logEvent(kind, userId = null, amount = null, meta = null) {
  try {
    insert.run(String(kind), userId == null ? null : Number(userId), amount == null ? null : Number(amount), meta ? JSON.stringify(meta) : null, Date.now());
  } catch (e) {
    console.error("[events] log failed", e.message);
  }
}

// Count events of a kind in a time window (ms back from now).
function countSince(kind, windowMs) {
  return db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = ? AND created_at > ?").get(kind, Date.now() - windowMs).n;
}

// Sum amount for a kind in window (used for revenue).
function sumSince(kind, windowMs) {
  return db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM events WHERE kind = ? AND created_at > ?").get(kind, Date.now() - windowMs).s;
}

// Distinct users active in window (used for visits).
function distinctUsersSince(kind, windowMs) {
  return db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE kind = ? AND user_id IS NOT NULL AND created_at > ?").get(kind, Date.now() - windowMs).n;
}

// Daily counts for the last N days. Returns an array of { date, count } UTC-day keyed.
function dailyBreakdown(kind, days = 30) {
  const start = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = db.prepare(`
    SELECT
      DATE(created_at / 1000, 'unixepoch') AS day,
      COUNT(*) AS count,
      COALESCE(SUM(amount), 0) AS amount
    FROM events
    WHERE kind = ? AND created_at > ?
    GROUP BY day
    ORDER BY day DESC
  `).all(kind, start);
  return rows;
}

module.exports = { logEvent, countSince, sumSince, distinctUsersSince, dailyBreakdown };
