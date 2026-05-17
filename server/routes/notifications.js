const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();
router.use(requireAuth);

// All notifications are derived on-demand from existing tables:
//   - friendships (pending → friend_request, recently-accepted → friend_accepted)
//   - events (friend_gift → gift_received)
// This avoids a separate notifications table + write fan-out for every
// gift/request. Unread state comes from comparing each item's created
// time against stats.notifications_seen_at — opening the bell calls
// /read which advances that timestamp.

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // ignore items older than 7 days

function buildNotifications(userId) {
  // Notifications older than the user's last "Clear all" press are
  // hidden entirely (cleared_at is per-user). Fall back to the 7-day
  // lookback if they've never cleared, so the list isn't infinitely
  // backfilled either.
  const clearedAt = (db.prepare("SELECT notifications_cleared_at FROM stats WHERE user_id = ?").get(userId) || {}).notifications_cleared_at || 0;
  const lookbackCutoff = Date.now() - LOOKBACK_MS;
  const since = Math.max(clearedAt, lookbackCutoff);
  const items = [];

  // Pending friend requests where someone ELSE asked us.
  const pending = db.prepare(`
    SELECT f.requester_id, f.created_at, u.username, u.avatar
    FROM friendships f
    JOIN users u ON u.id = f.requester_id
    WHERE (f.user_a = ? OR f.user_b = ?)
      AND f.status = 'pending'
      AND f.requester_id != ?
      AND f.created_at >= ?
    ORDER BY f.created_at DESC
    LIMIT 25
  `).all(userId, userId, userId, since);
  for (const r of pending) {
    items.push({
      id: `freq-${r.requester_id}-${r.created_at}`,
      type: "friend_request",
      icon: "👋",
      title: `${r.username} wants to be your friend`,
      text: "Tap to accept or view in Profile → Friends.",
      at: r.created_at,
      actor: { id: r.requester_id, username: r.username, avatar: r.avatar },
      actionType: "view_friends",
    });
  }

  // Recently accepted friend requests (where WE were the requester and
  // someone accepted) — surface so the requester knows their request
  // went through.
  const accepted = db.prepare(`
    SELECT f.user_a, f.user_b, f.requester_id, f.accepted_at, ua.username AS ua_name, ua.avatar AS ua_avatar,
           ub.username AS ub_name, ub.avatar AS ub_avatar
    FROM friendships f
    JOIN users ua ON ua.id = f.user_a
    JOIN users ub ON ub.id = f.user_b
    WHERE (f.user_a = ? OR f.user_b = ?)
      AND f.status = 'accepted'
      AND f.requester_id = ?
      AND f.accepted_at IS NOT NULL
      AND f.accepted_at >= ?
    ORDER BY f.accepted_at DESC
    LIMIT 25
  `).all(userId, userId, userId, since);
  for (const r of accepted) {
    const otherId = r.user_a === userId ? r.user_b : r.user_a;
    const otherName = r.user_a === userId ? r.ub_name : r.ua_name;
    const otherAvatar = r.user_a === userId ? r.ub_avatar : r.ua_avatar;
    items.push({
      id: `facc-${otherId}-${r.accepted_at}`,
      type: "friend_accepted",
      icon: "🤝",
      title: `${otherName} accepted your friend request`,
      text: "Send a gift to celebrate!",
      at: r.accepted_at,
      actor: { id: otherId, username: otherName, avatar: otherAvatar },
      actionType: "view_friends",
    });
  }

  // Gifts received from friends. The sender is the user_id on the
  // gift event; the recipient lives inside the meta JSON, which we
  // filter on. JSON1 is built into the bundled SQLite.
  const gifts = db.prepare(`
    SELECT e.id, e.user_id AS sender_id, e.amount, e.created_at,
           json_extract(e.meta, '$.gift_kind') AS gift_kind,
           u.username AS sender_name, u.avatar AS sender_avatar
    FROM events e
    JOIN users u ON u.id = e.user_id
    WHERE e.kind = 'friend_gift'
      AND json_extract(e.meta, '$.to') = ?
      AND e.created_at >= ?
    ORDER BY e.created_at DESC
    LIMIT 25
  `).all(userId, since);
  for (const r of gifts) {
    const kindLabel = r.gift_kind === "free_spins" ? `${r.amount} free spin${r.amount === 1 ? "" : "s"}`
                    : r.gift_kind === "coins"      ? `${r.amount} coin${r.amount === 1 ? "" : "s"}`
                    : `${r.amount} gift`;
    items.push({
      id: `gift-${r.id}`,
      type: "gift_received",
      icon: r.gift_kind === "free_spins" ? "🎡" : "🎁",
      title: `${r.sender_name} sent you ${kindLabel}`,
      text: "Tap to send one back.",
      at: r.created_at,
      actor: { id: r.sender_id, username: r.sender_name, avatar: r.sender_avatar },
      actionType: "view_friends",
    });
  }

  // Sort newest first across all sources.
  items.sort((a, b) => b.at - a.at);
  return items.slice(0, 30);
}

router.get("/", (req, res) => {
  const userId = req.user.id;
  const seenAt = (db.prepare("SELECT notifications_seen_at FROM stats WHERE user_id = ?").get(userId) || {}).notifications_seen_at || 0;
  const notifications = buildNotifications(userId).map((n) => ({
    ...n,
    unread: n.at > seenAt,
  }));
  const unread_count = notifications.filter((n) => n.unread).length;
  res.json({ notifications, unread_count, seen_at: seenAt });
});

router.post("/read", (req, res) => {
  const userId = req.user.id;
  const now = Date.now();
  db.prepare("UPDATE stats SET notifications_seen_at = ?, updated_at = ? WHERE user_id = ?").run(now, now, userId);
  res.json({ ok: true, seen_at: now });
});

// Clear all current notifications from the user's bell. Bumps both
// cleared_at (so the items vanish from /notifications GET) AND
// seen_at (so the unread badge resets). Future notifications (those
// with at > cleared_at) will still appear.
router.post("/clear", (req, res) => {
  const userId = req.user.id;
  const now = Date.now();
  db.prepare(
    "UPDATE stats SET notifications_cleared_at = ?, notifications_seen_at = ?, updated_at = ? WHERE user_id = ?"
  ).run(now, now, now, userId);
  res.json({ ok: true, cleared_at: now });
});

module.exports = router;
