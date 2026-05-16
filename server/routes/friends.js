const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();
router.use(requireAuth);

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// List of accepted friends. Returns id, username, level, last_seen, online_now
// (online_now is set from the realtime in-memory presence map).
router.get("/", (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`
    SELECT
      CASE WHEN user_a = ? THEN user_b ELSE user_a END AS friend_id,
      accepted_at
    FROM friendships
    WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'
    ORDER BY accepted_at DESC
  `).all(me, me, me);

  if (!rows.length) return res.json([]);
  const ids = rows.map((r) => r.friend_id);
  const placeholders = ids.map(() => "?").join(",");
  const users = db.prepare(`
    SELECT u.id, u.username, u.avatar, s.level, s.online_rating
    FROM users u LEFT JOIN stats s ON s.user_id = u.id
    WHERE u.id IN (${placeholders})
  `).all(...ids);
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const realtime = require("../realtime");
  const onlineSet = realtime.getOnlineUserIds ? realtime.getOnlineUserIds() : new Set();
  res.json(rows.map((r) => ({
    id: r.friend_id,
    username: byId[r.friend_id]?.username || "unknown",
    avatar: byId[r.friend_id]?.avatar || null,
    level: byId[r.friend_id]?.level || 1,
    online_rating: byId[r.friend_id]?.online_rating || 1000,
    online_now: onlineSet.has(r.friend_id),
    accepted_at: r.accepted_at,
  })));
});

// Incoming pending requests (the user is the recipient).
router.get("/pending", (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`
    SELECT u.id, u.username, f.created_at
    FROM friendships f
    JOIN users u ON u.id = f.requester_id
    WHERE (f.user_a = ? OR f.user_b = ?) AND f.status = 'pending' AND f.requester_id != ?
    ORDER BY f.created_at DESC
  `).all(me, me, me);
  res.json(rows);
});

router.post("/add", (req, res) => {
  const me = req.user.id;
  const username = String(req.body?.username || "").trim();
  if (!username) return res.status(400).json({ error: "missing_username" });
  const target = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!target) return res.status(404).json({ error: "user_not_found" });
  if (target.id === me) return res.status(400).json({ error: "cant_add_self" });

  const [a, b] = pair(me, target.id);
  const existing = db.prepare("SELECT status, requester_id FROM friendships WHERE user_a = ? AND user_b = ?").get(a, b);
  if (existing) {
    if (existing.status === "accepted") return res.status(409).json({ error: "already_friends" });
    if (existing.status === "pending" && existing.requester_id === me) return res.status(409).json({ error: "request_already_sent" });
    // Auto-accept: they sent a request to us first.
    if (existing.status === "pending") {
      db.prepare("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?")
        .run(Date.now(), a, b);
      return res.json({ ok: true, status: "accepted" });
    }
  }

  db.prepare(`
    INSERT INTO friendships (user_a, user_b, status, requester_id, created_at)
    VALUES (?, ?, 'pending', ?, ?)
  `).run(a, b, me, Date.now());
  res.json({ ok: true, status: "pending" });
});

router.post("/accept", (req, res) => {
  const me = req.user.id;
  const requesterId = Number(req.body?.user_id);
  if (!requesterId) return res.status(400).json({ error: "missing_user_id" });
  const [a, b] = pair(me, requesterId);
  const row = db.prepare("SELECT status, requester_id FROM friendships WHERE user_a = ? AND user_b = ?").get(a, b);
  if (!row) return res.status(404).json({ error: "no_request" });
  if (row.status === "accepted") return res.json({ ok: true, status: "accepted" });
  if (row.requester_id === me) return res.status(400).json({ error: "cant_accept_own" });
  db.prepare("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?")
    .run(Date.now(), a, b);
  res.json({ ok: true, status: "accepted" });
});

router.post("/reject", (req, res) => {
  const me = req.user.id;
  const otherId = Number(req.body?.user_id);
  if (!otherId) return res.status(400).json({ error: "missing_user_id" });
  const [a, b] = pair(me, otherId);
  db.prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'pending'").run(a, b);
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  const me = req.user.id;
  const otherId = Number(req.params.id);
  const [a, b] = pair(me, otherId);
  db.prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ?").run(a, b);
  res.json({ ok: true });
});

// ─── Friend gifts (coins / spins) ────────────────────────────────────────
// Players can send coins or free spins to confirmed friends. Daily caps
// per recipient prevent farming. Sender's balance is checked + deducted
// atomically with the recipient's credit.
const GIFT_DAILY_CAPS = { coins: 200, free_spins: 5 };

router.post("/gift", (req, res) => {
  const me = req.user.id;
  const recipientId = Number(req.body && req.body.to);
  const kind = String(req.body && req.body.kind || "");
  const amount = Math.max(1, Math.min(GIFT_DAILY_CAPS[kind] || 0, Math.floor(req.body && req.body.amount || 0)));
  if (!recipientId || recipientId === me) return res.status(400).json({ error: "invalid_recipient" });
  if (!(kind in GIFT_DAILY_CAPS)) return res.status(400).json({ error: "invalid_kind" });
  if (!amount) return res.status(400).json({ error: "invalid_amount" });

  // Confirm friendship — only accepted (status='accepted') pairs may gift.
  const [a, b] = pair(me, recipientId);
  const friendship = db.prepare(
    `SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'accepted'`
  ).get(a, b);
  if (!friendship) return res.status(403).json({ error: "not_friends" });

  // Cap by today's gifts received by this recipient from this sender.
  // Tracked via a lightweight events row to avoid a new table.
  const today = todayKey();
  const sentToday = db.prepare(
    `SELECT COALESCE(SUM(json_extract(meta, '$.amount')), 0) AS total
     FROM events
     WHERE kind = 'friend_gift' AND user_id = ? AND target = ?
       AND json_extract(meta, '$.date') = ? AND json_extract(meta, '$.gift_kind') = ?`
  ).get(me, String(recipientId), today, kind).total || 0;
  if (sentToday + amount > GIFT_DAILY_CAPS[kind]) {
    return res.status(429).json({
      error: "daily_cap",
      sent_today: sentToday,
      cap: GIFT_DAILY_CAPS[kind],
      remaining: Math.max(0, GIFT_DAILY_CAPS[kind] - sentToday),
    });
  }

  const senderStats = db.prepare("SELECT coins, free_spins FROM stats WHERE user_id = ?").get(me);
  if (!senderStats) return res.status(404).json({ error: "no_sender_stats" });
  if (kind === "coins" && senderStats.coins < amount) return res.status(402).json({ error: "insufficient_coins" });
  if (kind === "free_spins" && senderStats.free_spins < amount) return res.status(402).json({ error: "insufficient_spins" });

  const tx = db.transaction(() => {
    if (kind === "coins") {
      db.prepare("UPDATE stats SET coins = coins - ?, updated_at = ? WHERE user_id = ?").run(amount, Date.now(), me);
      db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?").run(amount, Date.now(), recipientId);
    } else {
      db.prepare("UPDATE stats SET free_spins = free_spins - ?, updated_at = ? WHERE user_id = ?").run(amount, Date.now(), me);
      db.prepare("UPDATE stats SET free_spins = free_spins + ?, updated_at = ? WHERE user_id = ?").run(amount, Date.now(), recipientId);
    }
    db.prepare(
      `INSERT INTO events (kind, user_id, target, meta, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run("friend_gift", me, String(recipientId), JSON.stringify({ gift_kind: kind, amount, date: today }), Date.now());
  });
  try { tx(); }
  catch (e) { return res.status(500).json({ error: "gift_failed" }); }

  res.json({ ok: true, kind, amount });
});

function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

module.exports = router;
