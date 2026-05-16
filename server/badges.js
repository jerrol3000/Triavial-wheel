const fs = require("fs");
const path = require("path");
const db = require("./db");

// Catalog seed — idempotent INSERT OR REPLACE so editing the JSON +
// redeploying is enough to update / add badges.
function seedCatalog() {
  const file = path.join(__dirname, "data", "badges-catalog.json");
  if (!fs.existsSync(file)) return 0;
  let rows;
  try { rows = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error("[badges] bad catalog json:", e.message); return 0; }
  if (!Array.isArray(rows)) return 0;
  const upsert = db.prepare(
    `INSERT INTO badges(id, name, description, category, tier, icon, criteria_type, criteria_value, enabled, sort_order)
     VALUES (@id, @name, @description, @category, @tier, @icon, @criteria_type, @criteria_value, @enabled, @sort_order)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, description=excluded.description, category=excluded.category,
       tier=excluded.tier, icon=excluded.icon, criteria_type=excluded.criteria_type,
       criteria_value=excluded.criteria_value, enabled=excluded.enabled, sort_order=excluded.sort_order`
  );
  const tx = db.transaction((list) => {
    for (const r of list) {
      upsert.run({
        id: r.id, name: r.name, description: r.description || null,
        category: r.category, tier: r.tier || "bronze",
        icon: r.icon || null, criteria_type: r.criteria_type,
        criteria_value: r.criteria_value | 0,
        enabled: r.enabled === false ? 0 : 1, sort_order: r.sort_order | 0,
      });
    }
  });
  tx(rows);
  return rows.length;
}

function listCatalog() {
  return db.prepare(`SELECT * FROM badges WHERE enabled = 1 ORDER BY category, sort_order, name`).all();
}

function listEarned(userId) {
  return db.prepare(
    `SELECT badge_id, earned_at, equipped_slot FROM user_badges WHERE user_id = ?`
  ).all(userId);
}

// Returns the up to 3 badges the player has chosen to showcase, in slot
// order. Used to render the "badge case" next to usernames in public UIs.
function listEquipped(userId) {
  return db.prepare(
    `SELECT ub.badge_id, ub.equipped_slot, b.name, b.icon, b.tier, b.category
     FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
     WHERE ub.user_id = ? AND ub.equipped_slot IS NOT NULL
     ORDER BY ub.equipped_slot ASC LIMIT 3`
  ).all(userId);
}

function equipBadge(userId, badgeId, slot) {
  if (![1, 2, 3].includes(slot)) return { error: "invalid_slot" };
  const owned = db.prepare(`SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?`).get(userId, badgeId);
  if (!owned) return { error: "not_owned" };
  const tx = db.transaction(() => {
    // Clear whoever currently holds this slot AND clear this badge's
    // existing slot (if any) so we can't end up with two badges in the
    // same slot or one badge in two slots.
    db.prepare(`UPDATE user_badges SET equipped_slot = NULL WHERE user_id = ? AND (equipped_slot = ? OR badge_id = ?)`)
      .run(userId, slot, badgeId);
    db.prepare(`UPDATE user_badges SET equipped_slot = ? WHERE user_id = ? AND badge_id = ?`)
      .run(slot, userId, badgeId);
  });
  tx();
  return { ok: true };
}

function unequipBadge(userId, badgeId) {
  db.prepare(`UPDATE user_badges SET equipped_slot = NULL WHERE user_id = ? AND badge_id = ?`)
    .run(userId, badgeId);
  return { ok: true };
}

// Inspect the user's stats once and award any newly-qualifying badges.
// Called after game end, coin spend, daily streak update, etc. — wherever
// a criteria_type value could have changed. Returns the list of NEWLY
// earned badges so the caller can ship a celebration toast.
function awardEligible(userId) {
  const stats = db.prepare(`SELECT * FROM stats WHERE user_id = ?`).get(userId);
  if (!stats) return [];
  const owned = new Set(db.prepare(`SELECT badge_id FROM user_badges WHERE user_id = ?`).all(userId).map((r) => r.badge_id));
  const catalog = listCatalog();

  const newlyEarned = [];
  const insert = db.prepare(`INSERT OR IGNORE INTO user_badges(user_id, badge_id, earned_at) VALUES (?, ?, ?)`);
  const now = Date.now();
  for (const b of catalog) {
    if (owned.has(b.id)) continue;
    const v = readCriteria(stats, b.criteria_type);
    if (v == null) continue;
    if (v >= b.criteria_value) {
      const r = insert.run(userId, b.id, now);
      if (r.changes) newlyEarned.push(b);
    }
  }
  return newlyEarned;
}

// Map criteria_type → stats column. Centralized so JSON criteria stay
// stable even if column names drift.
function readCriteria(stats, type) {
  switch (type) {
    case "games_played":         return stats.games_played;
    case "correct":              return stats.correct;
    case "best_streak":          return stats.best_streak;
    case "level":                return stats.level;
    case "online_wins":          return stats.online_wins;
    case "win_streak":           return stats.win_streak;
    case "longest_daily_streak": return stats.longest_daily_streak;
    case "coins_spent_total":    return stats.coins_spent_total;
    case "cosmetics_owned_count":return stats.cosmetics_owned_count;
    case "pro_lifetime_months":  return stats.pro_lifetime_months;
    default: return null;
  }
}

// Convenience increment used by the store buy flow + the boost-use flow
// so we have an auditable lifetime-spend total to award badges against.
function recordSpend(userId, amount) {
  if (!amount || amount <= 0) return;
  db.prepare(`UPDATE stats SET coins_spent_total = coins_spent_total + ?, updated_at = ? WHERE user_id = ?`)
    .run(amount, Date.now(), userId);
}

// Bump cosmetics_owned_count after the buyer actually owns a new item.
// Excludes consumables (boosts, spin packs) — those are inventory you
// burn through, not collection items, so they shouldn't count toward
// the Collector / Completionist badges.
function recordOwnership(userId) {
  const n = db.prepare(`
    SELECT COUNT(DISTINCT uc.cosmetic_id) AS n
    FROM user_cosmetics uc
    JOIN cosmetics c ON c.id = uc.cosmetic_id
    WHERE uc.user_id = ? AND c.consumable = 0
  `).get(userId).n;
  db.prepare(`UPDATE stats SET cosmetics_owned_count = ?, updated_at = ? WHERE user_id = ?`)
    .run(n, Date.now(), userId);
}

module.exports = {
  seedCatalog,
  listCatalog,
  listEarned,
  listEquipped,
  equipBadge,
  unequipBadge,
  awardEligible,
  recordSpend,
  recordOwnership,
};
