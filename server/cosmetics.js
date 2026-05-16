const fs = require("fs");
const path = require("path");
const db = require("./db");

// Categories that allow exactly one equipped item at a time (the rest are
// consumables tracked by qty in user_cosmetics).
const EQUIPPABLE = new Set(["frame", "pointer", "celebration", "title"]);

// Idempotent boot-time seed. INSERT OR REPLACE so editing the JSON file +
// redeploying is enough to push new items or tweak existing ones. Newly-
// added rows show up the next time a user opens the store.
function seedCatalog() {
  const file = path.join(__dirname, "data", "cosmetics-catalog.json");
  if (!fs.existsSync(file)) return 0;
  let rows;
  try { rows = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error("[cosmetics] bad catalog json:", e.message); return 0; }
  if (!Array.isArray(rows)) return 0;
  const upsert = db.prepare(
    `INSERT INTO cosmetics(id, category, name, description, price_coins, rarity, icon, data, pro_only, consumable, enabled, sort_order)
     VALUES (@id, @category, @name, @description, @price_coins, @rarity, @icon, @data, @pro_only, @consumable, @enabled, @sort_order)
     ON CONFLICT(id) DO UPDATE SET
       category=excluded.category, name=excluded.name, description=excluded.description,
       price_coins=excluded.price_coins, rarity=excluded.rarity, icon=excluded.icon,
       data=excluded.data, pro_only=excluded.pro_only, consumable=excluded.consumable,
       enabled=excluded.enabled, sort_order=excluded.sort_order`
  );
  const tx = db.transaction((list) => {
    for (const r of list) {
      upsert.run({
        id: r.id,
        category: r.category,
        name: r.name,
        description: r.description || null,
        price_coins: r.price_coins | 0,
        rarity: r.rarity || "common",
        icon: r.icon || null,
        data: r.data ? JSON.stringify(r.data) : null,
        pro_only: r.pro_only ? 1 : 0,
        consumable: r.consumable ? 1 : 0,
        enabled: r.enabled === false ? 0 : 1,
        sort_order: r.sort_order | 0,
      });
    }
  });
  tx(rows);
  return rows.length;
}

function rowToItem(r) {
  return {
    id: r.id,
    category: r.category,
    name: r.name,
    description: r.description,
    price_coins: r.price_coins,
    rarity: r.rarity,
    icon: r.icon,
    data: r.data ? JSON.parse(r.data) : null,
    pro_only: !!r.pro_only,
    consumable: !!r.consumable,
    sort_order: r.sort_order,
  };
}

function listCatalog() {
  const rows = db.prepare(
    `SELECT * FROM cosmetics WHERE enabled = 1 ORDER BY category, sort_order, name`
  ).all();
  return rows.map(rowToItem);
}

function listOwned(userId) {
  const rows = db.prepare(
    `SELECT cosmetic_id, qty, purchased_at FROM user_cosmetics WHERE user_id = ?`
  ).all(userId);
  return rows.map((r) => ({ cosmetic_id: r.cosmetic_id, qty: r.qty, purchased_at: r.purchased_at }));
}

function listEquipped(userId) {
  const rows = db.prepare(
    `SELECT category, cosmetic_id FROM user_equipped WHERE user_id = ?`
  ).all(userId);
  const out = {};
  for (const r of rows) out[r.category] = r.cosmetic_id;
  return out;
}

function getItem(id) {
  const r = db.prepare(`SELECT * FROM cosmetics WHERE id = ? AND enabled = 1`).get(id);
  return r ? rowToItem(r) : null;
}

// Atomic buy: validates funds + pro requirement, deducts coins, grants
// ownership (+1 qty for consumables, +1 row for equippables). Returns
// { ok, item, coins_after } or throws on failure.
function buyItem(userId, cosmeticId, isPro) {
  const item = getItem(cosmeticId);
  if (!item) return { error: "not_found" };
  if (item.pro_only && !isPro) return { error: "pro_only" };

  // Equippable items only need to be purchased once (qty stays 1).
  const already = db.prepare(
    `SELECT qty FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?`
  ).get(userId, cosmeticId);
  if (already && !item.consumable) return { error: "already_owned" };

  const cost = item.price_coins;
  const tx = db.transaction(() => {
    const userStats = db.prepare(`SELECT coins FROM stats WHERE user_id = ?`).get(userId);
    if (!userStats) throw new Error("no_stats");
    if (userStats.coins < cost) throw new Error("insufficient_funds");

    db.prepare(`UPDATE stats SET coins = coins - ?, updated_at = ? WHERE user_id = ?`).run(cost, Date.now(), userId);

    if (already && item.consumable) {
      db.prepare(`UPDATE user_cosmetics SET qty = qty + 1, purchased_at = ? WHERE user_id = ? AND cosmetic_id = ?`)
        .run(Date.now(), userId, cosmeticId);
    } else {
      db.prepare(`INSERT INTO user_cosmetics(user_id, cosmetic_id, qty, purchased_at) VALUES (?, ?, 1, ?)`)
        .run(userId, cosmeticId, Date.now());
    }
    // Auto-equip the first one in its category for equippable items —
    // saves the user a tap. Skipped for consumables.
    if (!item.consumable && EQUIPPABLE.has(item.category)) {
      const currentlyEquipped = db.prepare(
        `SELECT cosmetic_id FROM user_equipped WHERE user_id = ? AND category = ?`
      ).get(userId, item.category);
      if (!currentlyEquipped || !currentlyEquipped.cosmetic_id) {
        db.prepare(
          `INSERT INTO user_equipped(user_id, category, cosmetic_id) VALUES (?, ?, ?)
           ON CONFLICT(user_id, category) DO UPDATE SET cosmetic_id = excluded.cosmetic_id`
        ).run(userId, item.category, cosmeticId);
      }
    }
  });

  try {
    tx();
  } catch (e) {
    return { error: e.message || "buy_failed" };
  }
  const after = db.prepare(`SELECT coins FROM stats WHERE user_id = ?`).get(userId);
  return { ok: true, item, coins_after: after ? after.coins : 0 };
}

// Equip / unequip an owned cosmetic. Free items (price 0) can be equipped
// without prior purchase since everyone "owns" them by default.
function equipItem(userId, cosmeticId) {
  const item = getItem(cosmeticId);
  if (!item) return { error: "not_found" };
  if (item.consumable) return { error: "not_equippable" };
  if (!EQUIPPABLE.has(item.category)) return { error: "not_equippable" };
  if (item.price_coins > 0) {
    const owned = db.prepare(
      `SELECT 1 FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?`
    ).get(userId, cosmeticId);
    if (!owned) return { error: "not_owned" };
  }
  db.prepare(
    `INSERT INTO user_equipped(user_id, category, cosmetic_id) VALUES (?, ?, ?)
     ON CONFLICT(user_id, category) DO UPDATE SET cosmetic_id = excluded.cosmetic_id`
  ).run(userId, item.category, cosmeticId);
  return { ok: true, category: item.category, cosmetic_id: cosmeticId };
}

function unequipCategory(userId, category) {
  db.prepare(`DELETE FROM user_equipped WHERE user_id = ? AND category = ?`).run(userId, category);
  return { ok: true, category };
}

// Use a consumable boost. Decrements qty (deletes row if zero) and
// returns the item so the caller can apply its effect (e.g., refill
// lives, mystery box pull). Effects themselves are applied in the
// route handler against statsSlice equivalents.
function consumeBoost(userId, cosmeticId) {
  const item = getItem(cosmeticId);
  if (!item) return { error: "not_found" };
  if (!item.consumable) return { error: "not_consumable" };
  const row = db.prepare(
    `SELECT qty FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?`
  ).get(userId, cosmeticId);
  if (!row || row.qty < 1) return { error: "none_owned" };
  if (row.qty <= 1) {
    db.prepare(`DELETE FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?`).run(userId, cosmeticId);
  } else {
    db.prepare(`UPDATE user_cosmetics SET qty = qty - 1 WHERE user_id = ? AND cosmetic_id = ?`).run(userId, cosmeticId);
  }
  return { ok: true, item };
}

module.exports = {
  EQUIPPABLE,
  seedCatalog,
  listCatalog,
  listOwned,
  listEquipped,
  getItem,
  buyItem,
  equipItem,
  unequipCategory,
  consumeBoost,
};
