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

// ── Daily VS leaderboard ─────────────────────────────────────────
// Top players by ranked wins today (UTC). Public — guests can see
// the leaderboard from the Online lobby to feel the social proof.

function todayUtcKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

router.get("/daily/today", (req, res) => {
  const date = req.query.date || todayUtcKey();
  const rows = db.prepare(`
    SELECT u.id AS user_id, u.username, u.avatar, d.wins, d.losses, d.ties
    FROM daily_vs d
    JOIN users u ON u.id = d.user_id
    WHERE d.date = ? AND u.banned_at IS NULL
    ORDER BY d.wins DESC, d.losses ASC, d.ties DESC
    LIMIT 50
  `).all(date);
  res.json({ date, leaderboard: rows });
});

// Top-3 = 1 free spin + 200 coins + cosmetic (frame_emerald);
// Top-10 = 100 coins. Both prizes awarded once per (user, date).
// Day-end is "the date != today" condition — players claim by
// hitting this endpoint after midnight rolls over.
router.post("/daily/claim", requireAuth, (req, res) => {
  const date = String((req.body && req.body.date) || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "invalid_date" });
  if (date === todayUtcKey()) return res.status(400).json({ error: "day_not_complete" });

  // Recompute the leaderboard for that date and find this user's rank.
  const rows = db.prepare(`
    SELECT user_id, wins, prizes_awarded FROM daily_vs WHERE date = ?
    ORDER BY wins DESC, losses ASC, ties DESC
    LIMIT 50
  `).all(date);
  const idx = rows.findIndex((r) => r.user_id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: "not_on_leaderboard" });
  const row = rows[idx];
  const rank = idx + 1;

  let coinsReward = 0, spinsReward = 0, cosmeticId = null;
  let bitsToSet = 0;
  if (rank <= 3) {
    if ((row.prizes_awarded & 1) === 0) {
      coinsReward = 200;
      spinsReward = 1;
      cosmeticId = "frame_emerald";
      bitsToSet |= 1;
    }
  }
  if (rank <= 10) {
    if ((row.prizes_awarded & 2) === 0) {
      coinsReward += 100;
      bitsToSet |= 2;
    }
  }
  if (!bitsToSet) return res.status(409).json({ error: "already_claimed", rank });

  // Apply prizes + mark bits in a single transaction.
  let resp;
  try {
    const tx = db.transaction(() => {
      const now = Date.now();
      if (coinsReward > 0) {
        db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?")
          .run(coinsReward, now, req.user.id);
      }
      if (spinsReward > 0) {
        db.prepare("UPDATE stats SET free_spins = free_spins + ?, updated_at = ? WHERE user_id = ?")
          .run(spinsReward, now, req.user.id);
      }
      if (cosmeticId) {
        db.prepare("INSERT OR IGNORE INTO user_cosmetics(user_id, cosmetic_id, qty, purchased_at) VALUES (?, ?, 1, ?)")
          .run(req.user.id, cosmeticId, now);
      }
      db.prepare("UPDATE daily_vs SET prizes_awarded = prizes_awarded | ?, updated_at = ? WHERE user_id = ? AND date = ?")
        .run(bitsToSet, now, req.user.id, date);
      resp = { ok: true, rank, coins: coinsReward, spins: spinsReward, cosmetic: cosmeticId };
    });
    tx.immediate();
  } catch (e) {
    console.error("[vs/daily/claim] failed", e);
    return res.status(500).json({ error: "claim_failed" });
  }
  res.json(resp);
});

module.exports = router;
