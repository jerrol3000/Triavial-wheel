const express = require("express");
const { requireAuth, optionalAuth } = require("../auth");
const db = require("../db");
const cosmetics = require("../cosmetics");
const badges = require("../badges");

const router = express.Router();

// ── Effect helpers (inlined so the boost router is self-contained) ───────
function addCoins(userId, amount) {
  db.prepare(`UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?`)
    .run(amount, Date.now(), userId);
}
function grantPowerup(userId, type, count) {
  const row = db.prepare(`SELECT powerups_json FROM stats WHERE user_id = ?`).get(userId);
  if (!row) return;
  let p = {};
  try { p = JSON.parse(row.powerups_json || "{}"); } catch (e) {}
  p[type] = (p[type] || 0) + count;
  db.prepare(`UPDATE stats SET powerups_json = ?, updated_at = ? WHERE user_id = ?`)
    .run(JSON.stringify(p), Date.now(), userId);
}
function refillLives(userId) {
  // Repurposed: now tops the player's free_spins up to 5 (the regen
  // floor). Stacked spins above 5 are untouched. Lives column is dead.
  db.prepare(`UPDATE stats SET free_spins = MAX(free_spins, 5), updated_at = ? WHERE user_id = ?`)
    .run(Date.now(), userId);
}

// Public catalog — anyone can browse, sign-in is only required to buy.
router.get("/catalog", optionalAuth, (req, res) => {
  const catalog = cosmetics.listCatalog();
  let owned = [];
  let equipped = {};
  if (req.user && req.user.id) {
    owned = cosmetics.listOwned(req.user.id);
    equipped = cosmetics.listEquipped(req.user.id);
  }
  res.json({ catalog, owned, equipped });
});

// Authed shortcut for the user's own ownership + equipped state — useful
// for the post-purchase refresh and for boot-time cosmetic application.
router.get("/me", requireAuth, (req, res) => {
  res.json({
    owned: cosmetics.listOwned(req.user.id),
    equipped: cosmetics.listEquipped(req.user.id),
  });
});

router.post("/buy", requireAuth, (req, res) => {
  const id = String(req.body && req.body.id || "");
  if (!id) return res.status(400).json({ error: "missing id" });
  const userRow = db.prepare(`SELECT s.pro_until FROM stats s WHERE s.user_id = ?`).get(req.user.id);
  const isPro = !!(userRow && userRow.pro_until && userRow.pro_until > Date.now());
  const result = cosmetics.buyItem(req.user.id, id, isPro);
  if (result.error) return res.status(400).json(result);

  // Track lifetime spend + ownership count → drives spending/collector
  // badges. Award any newly-eligible badges and bubble them up so the
  // client can fire a celebration toast.
  badges.recordSpend(req.user.id, result.item.price_coins);
  badges.recordOwnership(req.user.id);
  const newBadges = badges.awardEligible(req.user.id);
  // Quest progression for the "buy something today" goal.
  try {
    const stats = require("./stats");
    if (stats.progressAllQuestsFor) stats.progressAllQuestsFor(req.user.id, [{ metric: "purchases_today", amount: 1 }]);
    else if (stats.progressQuestsFor) stats.progressQuestsFor(req.user.id, [{ metric: "purchases_today", amount: 1 }]);
  } catch (e) {}
  res.json({ ...result, new_badges: newBadges });
});

router.post("/equip", requireAuth, (req, res) => {
  const id = String(req.body && req.body.id || "");
  if (!id) return res.status(400).json({ error: "missing id" });
  const result = cosmetics.equipItem(req.user.id, id);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.post("/unequip", requireAuth, (req, res) => {
  const category = String(req.body && req.body.category || "");
  if (!category) return res.status(400).json({ error: "missing category" });
  res.json(cosmetics.unequipCategory(req.user.id, category));
});

// Consume a boost. Decrements qty + applies the side-effect server-side
// (refill lives, grant powerups for the mystery box, etc.) so the
// effect is durable even if the client mishandles the response.
router.post("/use", requireAuth, (req, res) => {
  const id = String(req.body && req.body.id || "");
  if (!id) return res.status(400).json({ error: "missing id" });
  const result = cosmetics.consumeBoost(req.user.id, id);
  if (result.error) return res.status(400).json(result);

  const item = result.item;
  const effect = item.data && item.data.effect;
  const applied = { effect };

  if (effect === "lives_refill") {
    refillLives(req.user.id);
    applied.lives_refilled = true;
  } else if (effect === "streak_shield") {
    // Mark a flag on stats — game logic will consume it on the next
    // missed-day daily streak check.
    db.prepare(`UPDATE stats SET streak_saver_active = 1, updated_at = ? WHERE user_id = ?`).run(Date.now(), req.user.id);
    applied.streak_shield_active = true;
  } else if (effect === "mystery_box") {
    // Lightweight pull: 70% coins (random 100-500), 25% powerups
    // (random 3-7 of one type), 5% a free random cosmetic frame.
    const roll = Math.random();
    if (roll < 0.7) {
      const coins = 100 + Math.floor(Math.random() * 401);
      addCoins(req.user.id, coins);
      applied.reward = { kind: "coins", amount: coins };
    } else if (roll < 0.95) {
      const types = ["fifty", "skip", "freeze", "double"];
      const t = types[Math.floor(Math.random() * types.length)];
      const n = 3 + Math.floor(Math.random() * 5);
      grantPowerup(req.user.id, t, n);
      applied.reward = { kind: "powerup", type: t, amount: n };
    } else {
      // Cosmetic pull — pick a random unowned non-Pro item the user
      // doesn't already have. Widened from frame-only to any
      // equippable category so players who collected every frame
      // can still pull pointers / celebrations / titles. Falls back
      // tiered (powerups → coins) so the "loser" reward isn't
      // always a flat coin pile.
      const ownedIds = new Set(cosmetics.listOwned(req.user.id).map((o) => o.cosmetic_id));
      const candidates = cosmetics.listCatalog().filter(
        (c) => ["frame", "pointer", "celebration", "title"].includes(c.category)
            && !c.pro_only && c.price_coins > 0 && !ownedIds.has(c.id)
      );
      if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        db.prepare(`INSERT INTO user_cosmetics(user_id, cosmetic_id, qty, purchased_at) VALUES (?, ?, 1, ?)`)
          .run(req.user.id, pick.id, Date.now());
        // Mirror the same auto-equip logic as buyItem so a cosmetic
        // pull from a Mystery Box equips immediately if the slot is
        // empty — otherwise the user "won" something they can't see.
        if (cosmetics.EQUIPPABLE && cosmetics.EQUIPPABLE.has(pick.category)) {
          const cur = db.prepare(`SELECT cosmetic_id FROM user_equipped WHERE user_id = ? AND category = ?`).get(req.user.id, pick.category);
          if (!cur || !cur.cosmetic_id) {
            db.prepare(
              `INSERT INTO user_equipped(user_id, category, cosmetic_id) VALUES (?, ?, ?)
               ON CONFLICT(user_id, category) DO UPDATE SET cosmetic_id = excluded.cosmetic_id`
            ).run(req.user.id, pick.category, pick.id);
          }
        }
        applied.reward = { kind: "cosmetic", item: pick };
      } else {
        // Tiered fallback — try powerups before defaulting to coins,
        // so completionist players don't always get the same "won
        // 1000 coins" reward.
        if (Math.random() < 0.6) {
          const types = ["fifty", "skip", "freeze", "double"];
          const t = types[Math.floor(Math.random() * types.length)];
          const n = 5 + Math.floor(Math.random() * 6);
          grantPowerup(req.user.id, t, n);
          applied.reward = { kind: "powerup", type: t, amount: n };
        } else {
          addCoins(req.user.id, 1000);
          applied.reward = { kind: "coins", amount: 1000 };
        }
      }
    }
  } else if (effect === "xp_2x" || effect === "coins_2x") {
    // Time-windowed multipliers stored on stats so any payout calc
    // can check them. Stored as expiry timestamps.
    // EXTEND instead of clobber: stacking the same boost while one's
    // still active adds the new duration on top of the remaining
    // time. Without this, buying a second potion mid-run would
    // SHORTEN your boost from "20 min left" to a fresh 30 min — bad
    // value either way; this way duplicates feel like more.
    const col = effect === "xp_2x" ? "xp_2x_until" : "coins_2x_until";
    const now = Date.now();
    const dur = item.data.duration_ms || 1800000;
    const cur = db.prepare(`SELECT ${col} AS until FROM stats WHERE user_id = ?`).get(req.user.id);
    const base = cur && cur.until > now ? cur.until : now;
    const until = base + dur;
    db.prepare(`UPDATE stats SET ${col} = ?, updated_at = ? WHERE user_id = ?`).run(until, now, req.user.id);
    applied.active_until = until;
    // Tell the client how much time is left in ms so they don't
    // need to trust their local clock (closes the clock-skew bug).
    applied.remaining_ms = until - now;
  }

  // Return the refreshed stats so the client can update its view in one
  // round-trip without re-fetching /stats separately.
  const fresh = db.prepare(`SELECT * FROM stats WHERE user_id = ?`).get(req.user.id);
  res.json({ ok: true, applied, stats: fresh });
});

module.exports = router;
