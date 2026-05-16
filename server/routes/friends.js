const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();
router.use(requireAuth);

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// Live push to a user's open WS socket. Required late so the realtime
// module is fully initialized (attach() runs after route mounting in
// server/index.js). Silent no-op if the recipient is offline — they'll
// see the notification on their next /api/notifications poll instead.
function pushNotification(userId, payload) {
  try {
    const realtime = require("../realtime");
    if (realtime.sendToUser) realtime.sendToUser(userId, { type: "notification", notification: payload });
  } catch (e) { /* best-effort */ }
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
    // Auto-accept: they sent a request to us first. Tell the original
    // requester their request just went through, in real time.
    if (existing.status === "pending") {
      const now = Date.now();
      db.prepare("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?")
        .run(now, a, b);
      const myName = req.user.username || "Someone";
      pushNotification(existing.requester_id, {
        id: `facc-${me}-${now}`,
        type: "friend_accepted",
        icon: "🤝",
        title: `${myName} accepted your friend request`,
        text: "Send a gift to celebrate!",
        at: now,
        actor: { id: me, username: myName },
        actionType: "view_friends",
      });
      return res.json({ ok: true, status: "accepted" });
    }
  }

  const now = Date.now();
  db.prepare(`
    INSERT INTO friendships (user_a, user_b, status, requester_id, created_at)
    VALUES (?, ?, 'pending', ?, ?)
  `).run(a, b, me, now);
  const myName = req.user.username || "Someone";
  pushNotification(target.id, {
    id: `freq-${me}-${now}`,
    type: "friend_request",
    icon: "👋",
    title: `${myName} wants to be your friend`,
    text: "Tap to accept or view in Profile → Friends.",
    at: now,
    actor: { id: me, username: myName },
    actionType: "view_friends",
  });
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
  const now = Date.now();
  db.prepare("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?")
    .run(now, a, b);
  const myName = req.user.username || "Someone";
  pushNotification(requesterId, {
    id: `facc-${me}-${now}`,
    type: "friend_accepted",
    icon: "🤝",
    title: `${myName} accepted your friend request`,
    text: "Send a gift to celebrate!",
    at: now,
    actor: { id: me, username: myName },
    actionType: "view_friends",
  });
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
  // Recipient encoded into the meta JSON since the events table doesn't
  // have a dedicated target column.
  const today = todayKey();
  const sentToday = db.prepare(
    `SELECT COALESCE(SUM(json_extract(meta, '$.amount')), 0) AS total
     FROM events
     WHERE kind = 'friend_gift' AND user_id = ?
       AND json_extract(meta, '$.to') = ?
       AND json_extract(meta, '$.date') = ?
       AND json_extract(meta, '$.gift_kind') = ?`
  ).get(me, recipientId, today, kind).total || 0;
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

  // Verify recipient still has a stats row BEFORE we start the tx —
  // otherwise the sender would be debited and the recipient's UPDATE
  // would silently affect 0 rows, vanishing coins.
  const recipExists = db.prepare("SELECT 1 FROM stats WHERE user_id = ?").get(recipientId);
  if (!recipExists) return res.status(404).json({ error: "recipient_not_found" });

  const tx = db.transaction(() => {
    // RE-CHECK the daily cap INSIDE the tx by reading sum-of-amounts
    // from events. Two concurrent gift requests from the same sender
    // would otherwise both pass the pre-check and double the cap.
    const inTxSent = db.prepare(
      `SELECT COALESCE(SUM(json_extract(meta, '$.amount')), 0) AS total
       FROM events
       WHERE kind = 'friend_gift' AND user_id = ?
         AND json_extract(meta, '$.to') = ?
         AND json_extract(meta, '$.date') = ?
         AND json_extract(meta, '$.gift_kind') = ?`
    ).get(me, recipientId, today, kind).total || 0;
    if (inTxSent + amount > GIFT_DAILY_CAPS[kind]) throw new Error("daily_cap_race");

    if (kind === "coins") {
      const s = db.prepare("UPDATE stats SET coins = coins - ?, updated_at = ? WHERE user_id = ?")
        .run(amount, Date.now(), me);
      if (s.changes !== 1) throw new Error("sender_update_failed");
      const r = db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?")
        .run(amount, Date.now(), recipientId);
      if (r.changes !== 1) throw new Error("recipient_update_failed");
    } else {
      const s = db.prepare("UPDATE stats SET free_spins = free_spins - ?, updated_at = ? WHERE user_id = ?")
        .run(amount, Date.now(), me);
      if (s.changes !== 1) throw new Error("sender_update_failed");
      const r = db.prepare("UPDATE stats SET free_spins = free_spins + ?, updated_at = ? WHERE user_id = ?")
        .run(amount, Date.now(), recipientId);
      if (r.changes !== 1) throw new Error("recipient_update_failed");
    }
    db.prepare(
      `INSERT INTO events (kind, user_id, amount, meta, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run("friend_gift", me, amount, JSON.stringify({ gift_kind: kind, amount, to: recipientId, date: today }), Date.now());
  });
  try { tx(); }
  catch (e) {
    if (e && e.message === "daily_cap_race") return res.status(429).json({ error: "daily_cap" });
    console.error("[friends] gift_failed", e);
    return res.status(500).json({ error: "gift_failed" });
  }

  // Live notification to the recipient so their bell + toast fire
  // immediately instead of waiting on their next 30s poll.
  const myName = req.user.username || "A friend";
  const kindLabel = kind === "free_spins" ? `${amount} free spin${amount === 1 ? "" : "s"}`
                  : kind === "coins"      ? `${amount} coin${amount === 1 ? "" : "s"}`
                  : `${amount} gift`;
  pushNotification(recipientId, {
    id: `gift-live-${me}-${Date.now()}`,
    type: "gift_received",
    icon: kind === "free_spins" ? "🎡" : "🎁",
    title: `${myName} sent you ${kindLabel}`,
    text: "Tap to send one back.",
    at: Date.now(),
    actor: { id: me, username: myName },
    actionType: "view_friends",
  });

  res.json({ ok: true, kind, amount });
});

function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

module.exports = router;
