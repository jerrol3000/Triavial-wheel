const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { currentSeason, getSeason, tierFromXp } = require("../seasons");

const router = express.Router();

// Read (and lazy-create) the user's progress row for the current
// active season. Centralized so every endpoint sees the same shape
// and we don't fork the lazy-init code in three places.
function ensureRow(userId, season) {
  let row = db.prepare("SELECT * FROM user_season WHERE user_id = ? AND season_id = ?").get(userId, season.id);
  if (!row) {
    db.prepare("INSERT INTO user_season(user_id, season_id, xp, premium, claimed_mask, updated_at) VALUES (?, ?, 0, 0, 0, ?)")
      .run(userId, season.id, Date.now());
    row = db.prepare("SELECT * FROM user_season WHERE user_id = ? AND season_id = ?").get(userId, season.id);
  }
  return row;
}

// Build the response shape returned to the client. Includes the full
// tier definition so the UI doesn't need a parallel hardcoded copy
// of the season config (DRY across server + client).
function buildProgress(userId) {
  const season = currentSeason();
  if (!season) return null;
  const row = ensureRow(userId, season);
  const tier = tierFromXp(season, row.xp);
  return {
    season: {
      id: season.id,
      name: season.name,
      ends_at: season.ends_at,
      xp_per_tier: season.xp_per_tier,
      tiers: season.tiers,
      premium_price_coins: season.premium_price_coins,
    },
    user: {
      xp: row.xp,
      tier,                       // highest tier UNLOCKED (claimed or claimable)
      claimed_mask: row.claimed_mask,
      premium: !!row.premium,
    },
  };
}

// Helper: apply a single reward to the player. Mirrors the same
// fulfillment routes the store uses (coins, spins, powerups, cosmetics)
// — kept inline so it's clear what the season pass actually grants.
function grantReward(userId, reward) {
  if (!reward) return;
  const now = Date.now();
  if (reward.type === "coins") {
    db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?")
      .run(Math.max(0, reward.amount | 0), now, userId);
  } else if (reward.type === "spins") {
    db.prepare("UPDATE stats SET free_spins = free_spins + ?, updated_at = ? WHERE user_id = ?")
      .run(Math.max(0, reward.amount | 0), now, userId);
  } else if (reward.type === "powerup") {
    const row = db.prepare("SELECT powerups_json FROM stats WHERE user_id = ?").get(userId);
    let p = {};
    try { p = JSON.parse(row?.powerups_json || "{}") || {}; } catch (e) {}
    p[reward.id] = (p[reward.id] || 0) + Math.max(0, reward.amount | 0);
    db.prepare("UPDATE stats SET powerups_json = ?, updated_at = ? WHERE user_id = ?")
      .run(JSON.stringify(p), now, userId);
  } else if (reward.type === "cosmetic") {
    // Grant the cosmetic if not already owned. Falls through silently
    // if the id isn't in the catalog (shouldn't happen — defensive).
    db.prepare("INSERT OR IGNORE INTO user_cosmetics(user_id, cosmetic_id, qty, purchased_at) VALUES (?, ?, 1, ?)")
      .run(userId, reward.id, now);
  }
}

// GET /season/current — full snapshot of the active season + this
// user's progress in it. Renders the entire Season Pass UI from one
// request; no follow-up fetch needed for any single tier.
router.get("/current", requireAuth, (req, res) => {
  const data = buildProgress(req.user.id);
  if (!data) return res.status(404).json({ error: "no_active_season" });
  res.json(data);
});

// POST /season/claim — claim a single tier the player has unlocked.
// Body: { tier: <int>, track: "free" | "premium" }. Idempotent:
// re-claiming returns { already_claimed: true } so the UI can soft-
// handle a double-tap without a popup.
router.post("/claim", requireAuth, (req, res) => {
  const season = currentSeason();
  if (!season) return res.status(404).json({ error: "no_active_season" });
  const t = Number(req.body && req.body.tier);
  const track = String(req.body && req.body.track || "free");
  if (!Number.isInteger(t) || t < 0 || t >= season.tiers.length) {
    return res.status(400).json({ error: "invalid_tier" });
  }
  if (track !== "free" && track !== "premium") {
    return res.status(400).json({ error: "invalid_track" });
  }
  const tierDef = season.tiers[t];
  const reward = track === "free" ? tierDef.free : tierDef.premium;
  if (!reward) return res.status(400).json({ error: "no_reward_at_tier" });

  let response;
  try {
    const tx = db.transaction(() => {
      const row = ensureRow(req.user.id, season);
      const unlockedTier = tierFromXp(season, row.xp);
      if (t > unlockedTier) { response = { status: 400, body: { error: "tier_locked" } }; return; }
      if (track === "premium" && !row.premium) { response = { status: 400, body: { error: "premium_locked" } }; return; }
      // Pack both tracks into one mask: bit (t*2) = free claimed, bit (t*2+1) = premium claimed.
      const bit = track === "free" ? (t * 2) : (t * 2 + 1);
      const mask = row.claimed_mask | 0;
      const already = (mask & (1 << bit)) !== 0;
      if (already) { response = { status: 200, body: { already_claimed: true } }; return; }
      const newMask = mask | (1 << bit);
      db.prepare("UPDATE user_season SET claimed_mask = ?, updated_at = ? WHERE user_id = ? AND season_id = ?")
        .run(newMask, Date.now(), req.user.id, season.id);
      grantReward(req.user.id, reward);
      response = { status: 200, body: { ok: true, reward } };
    });
    tx.immediate();
  } catch (e) {
    console.error("[season/claim] failed", e);
    return res.status(500).json({ error: "claim_failed" });
  }
  if (response.status !== 200) return res.status(response.status).json(response.body);
  // Return the refreshed progress so the client doesn't need a
  // follow-up GET to update the UI.
  res.json({ ...response.body, progress: buildProgress(req.user.id) });
});

// POST /season/buy-premium — unlock premium for the current season.
// Charges `premium_price_coins` from the player's coin balance. No
// real-money path here yet (that's a Stripe SKU for later); coins
// is a perfectly serviceable test currency for the mechanic.
router.post("/buy-premium", requireAuth, (req, res) => {
  const season = currentSeason();
  if (!season) return res.status(404).json({ error: "no_active_season" });
  const cost = season.premium_price_coins | 0;

  let response;
  try {
    const tx = db.transaction(() => {
      const row = ensureRow(req.user.id, season);
      if (row.premium) { response = { status: 200, body: { already_premium: true } }; return; }
      const stats = db.prepare("SELECT coins FROM stats WHERE user_id = ?").get(req.user.id);
      if (!stats) { response = { status: 404, body: { error: "no_stats_row" } }; return; }
      if (stats.coins < cost) { response = { status: 400, body: { error: "insufficient_funds", cost } }; return; }
      const dec = db.prepare("UPDATE stats SET coins = coins - ?, updated_at = ? WHERE user_id = ? AND coins >= ?")
        .run(cost, Date.now(), req.user.id, cost);
      if (dec.changes !== 1) { response = { status: 400, body: { error: "insufficient_funds" } }; return; }
      db.prepare("UPDATE user_season SET premium = 1, updated_at = ? WHERE user_id = ? AND season_id = ?")
        .run(Date.now(), req.user.id, season.id);
      response = { status: 200, body: { ok: true, premium: true, paid: cost } };
    });
    tx.immediate();
  } catch (e) {
    console.error("[season/buy-premium] failed", e);
    return res.status(500).json({ error: "buy_failed" });
  }
  if (response.status !== 200) return res.status(response.status).json(response.body);
  res.json({ ...response.body, progress: buildProgress(req.user.id) });
});

// Internal helper exported for /stats/game (and other XP-earning
// endpoints) to call. Awards season XP using the same earned-XP
// number that goes into the stats row, so the season pass is a
// natural side effect of normal play rather than a separate grind.
function awardSeasonXp(userId, xp) {
  const season = currentSeason();
  if (!season || xp <= 0) return;
  ensureRow(userId, season);
  db.prepare("UPDATE user_season SET xp = xp + ?, updated_at = ? WHERE user_id = ? AND season_id = ?")
    .run(Math.max(0, xp | 0), Date.now(), userId, season.id);
}

module.exports = router;
module.exports.awardSeasonXp = awardSeasonXp;
