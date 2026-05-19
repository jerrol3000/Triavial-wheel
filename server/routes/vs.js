const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

// GET /vs/rivalry/:opponentId — head-to-head record between THIS user
// and the given opponent. Used by the VS lobby + match-end screen to
// surface "You're 3-2 against MrAlex" callouts. Returns zeroes if
// they've never played, so the UI doesn't need a special "unknown
// rivalry" branch.
router.get("/rivalry/:opponentId", requireAuth, (req, res) => {
  const oppId = Number(req.params.opponentId);
  if (!Number.isInteger(oppId) || oppId <= 0 || oppId === req.user.id) {
    return res.status(400).json({ error: "invalid_opponent" });
  }
  const lo = Math.min(req.user.id, oppId);
  const hi = Math.max(req.user.id, oppId);
  const row = db.prepare("SELECT * FROM vs_rivalries WHERE user_a = ? AND user_b = ?").get(lo, hi);
  // Project the row into "my POV": myWins = the side I'm on.
  const meIsLo = req.user.id === lo;
  const myWins   = row ? (meIsLo ? row.a_wins : row.b_wins) : 0;
  const oppWins  = row ? (meIsLo ? row.b_wins : row.a_wins) : 0;
  const ties     = row ? row.ties : 0;
  const total    = myWins + oppWins + ties;
  res.json({
    opponent_id: oppId,
    my_wins: myWins,
    opp_wins: oppWins,
    ties,
    total,
    last_played_at: row ? row.last_played_at : null,
  });
});

// GET /vs/rivalries — top rivalries for this user (most played first).
// Surfaces who you've battled most so the UI can show a "Top rivals"
// panel — the persistent re-engagement hook ("you and Alex are 7-7,
// settle it").
router.get("/rivalries", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT v.*, u_a.username AS user_a_name, u_b.username AS user_b_name
    FROM vs_rivalries v
    JOIN users u_a ON u_a.id = v.user_a
    JOIN users u_b ON u_b.id = v.user_b
    WHERE v.user_a = ? OR v.user_b = ?
    ORDER BY (v.a_wins + v.b_wins + v.ties) DESC, v.last_played_at DESC
    LIMIT 10
  `).all(req.user.id, req.user.id);
  res.json(rows.map((r) => {
    const meIsLo = req.user.id === r.user_a;
    return {
      opponent_id: meIsLo ? r.user_b : r.user_a,
      opponent_username: meIsLo ? r.user_b_name : r.user_a_name,
      my_wins: meIsLo ? r.a_wins : r.b_wins,
      opp_wins: meIsLo ? r.b_wins : r.a_wins,
      ties: r.ties,
      total: r.a_wins + r.b_wins + r.ties,
      last_played_at: r.last_played_at,
    };
  }));
});

module.exports = router;
