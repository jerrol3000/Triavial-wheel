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

module.exports = router;
