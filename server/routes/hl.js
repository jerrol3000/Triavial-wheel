const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

// Higher/Lower leaderboards + best-streak tracking.
//
// Why server-side: the client kept a localStorage best ("if i clear
// my browser my legacy dies"), which is fine for solo flex but fails
// the social proof loop ("I'm rank #12 globally on Songs"). Now the
// server is the authoritative record + the leaderboard query
// surfaces top players per dataset.

// Whitelist the dataset keys we accept — must match the client's
// src/data/higherLowerData.js. Adding a new dataset means adding it
// here too (and to the client). Better than allowing arbitrary
// strings because that'd let a malicious client pollute the
// leaderboard with garbage dataset names.
const VALID_DATASETS = new Set(["songs", "movies", "instagram", "youtube"]);

// POST /hl/score — submit a streak. Server keeps the MAX between the
// existing best and the new value (so a worse streak after a great
// one doesn't downgrade the leaderboard entry). Idempotent: hitting
// this with the same streak twice is a no-op.
router.post("/score", requireAuth, (req, res) => {
  const dataset = String((req.body && req.body.dataset) || "");
  const streak = Math.max(0, Math.min(500, Math.floor(Number(req.body && req.body.streak) || 0)));
  if (!VALID_DATASETS.has(dataset)) return res.status(400).json({ error: "invalid_dataset" });
  const now = Date.now();
  // INSERT-or-bump-MAX in one statement so a concurrent submission
  // can't race the read-modify-write path. updated_at only bumps
  // when the new streak ACTUALLY beats the old one — preserves the
  // "when was your best set?" timestamp across worse re-submissions.
  db.prepare(`
    INSERT INTO hl_scores (user_id, dataset, best_streak, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, dataset) DO UPDATE SET
      best_streak = MAX(hl_scores.best_streak, excluded.best_streak),
      updated_at = CASE
        WHEN hl_scores.best_streak < excluded.best_streak THEN excluded.updated_at
        ELSE hl_scores.updated_at
      END
  `).run(req.user.id, dataset, streak, now);
  const row = db.prepare("SELECT best_streak FROM hl_scores WHERE user_id = ? AND dataset = ?").get(req.user.id, dataset);
  res.json({ ok: true, best_streak: row ? row.best_streak : streak });
});

// GET /hl/best — this user's best streak per dataset. Returns an
// object keyed by dataset so the H/L picker can show "🏆 12" inline
// next to each dataset's label without N follow-up queries.
router.get("/best", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT dataset, best_streak FROM hl_scores WHERE user_id = ?").all(req.user.id);
  const out = {};
  for (const r of rows) out[r.dataset] = r.best_streak;
  res.json(out);
});

// GET /hl/leaderboard/:dataset — top 25 streaks for that dataset.
// Public (no auth required) so a guest can see the leaderboard from
// the H/L picker and feel the social proof / aspiration to climb.
router.get("/leaderboard/:dataset", (req, res) => {
  const dataset = String(req.params.dataset || "");
  if (!VALID_DATASETS.has(dataset)) return res.status(400).json({ error: "invalid_dataset" });
  const rows = db.prepare(`
    SELECT u.username, u.avatar, h.best_streak, h.updated_at
    FROM hl_scores h
    JOIN users u ON u.id = h.user_id
    WHERE h.dataset = ? AND u.banned_at IS NULL
    ORDER BY h.best_streak DESC, h.updated_at ASC
    LIMIT 25
  `).all(dataset);
  res.json({ dataset, leaderboard: rows });
});

module.exports = router;
