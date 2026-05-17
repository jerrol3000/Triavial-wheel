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
    `INSERT INTO cosmetics(id, category, name, description, price_coins, rarity, icon, data, pro_only, consumable, enabled, sort_order, available_from, available_until, bundle_contents)
     VALUES (@id, @category, @name, @description, @price_coins, @rarity, @icon, @data, @pro_only, @consumable, @enabled, @sort_order, @available_from, @available_until, @bundle_contents)
     ON CONFLICT(id) DO UPDATE SET
       category=excluded.category, name=excluded.name, description=excluded.description,
       price_coins=excluded.price_coins, rarity=excluded.rarity, icon=excluded.icon,
       data=excluded.data, pro_only=excluded.pro_only, consumable=excluded.consumable,
       enabled=excluded.enabled, sort_order=excluded.sort_order,
       available_from=excluded.available_from, available_until=excluded.available_until,
       bundle_contents=excluded.bundle_contents`
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
        available_from: r.available_from || null,
        available_until: r.available_until || null,
        bundle_contents: r.bundle_contents ? JSON.stringify(r.bundle_contents) : null,
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
    available_from: r.available_from,
    available_until: r.available_until,
    bundle_contents: r.bundle_contents ? JSON.parse(r.bundle_contents) : null,
  };
}

function listCatalog() {
  const now = Date.now();
  // Limited-edition items have a [available_from, available_until] window.
  // Anything outside its window is filtered out of public listings (still
  // queryable by id for ownership purposes — handled in getItem below).
  const rows = db.prepare(
    `SELECT * FROM cosmetics
     WHERE enabled = 1
       AND (available_from IS NULL OR available_from <= ?)
       AND (available_until IS NULL OR available_until >= ?)
     ORDER BY category, sort_order, name`
  ).all(now, now);
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

// Returns the catalog item if it's currently purchasable — enforces the
// limited-edition window so a client who knows an expired SKU's id can't
// /store/buy it after listCatalog stops showing it.
function getItem(id) {
  const now = Date.now();
  const r = db.prepare(
    `SELECT * FROM cosmetics
     WHERE id = ? AND enabled = 1
       AND (available_from IS NULL OR available_from <= ?)
       AND (available_until IS NULL OR available_until >= ?)`
  ).get(id, now, now);
  return r ? rowToItem(r) : null;
}

// Same lookup as getItem but ignores the time-window — used by
// listOwned-style flows where we want to render items the player
// already owns even if they've since expired from the store.
function getItemAnyTime(id) {
  const r = db.prepare(`SELECT * FROM cosmetics WHERE id = ? AND enabled = 1`).get(id);
  return r ? rowToItem(r) : null;
}

// Atomic buy: validates funds + pro requirement, deducts coins, grants
// ownership (+1 qty for consumables, +1 row for equippables). For
// "bundle" items, grants every cosmetic referenced in bundle_contents
// in addition to the bundle marker itself — all in a single transaction,
// so a failure on any nested item rolls back the whole purchase.
function buyItem(userId, cosmeticId, isPro) {
  const item = getItem(cosmeticId);
  if (!item) return { error: "not_found" };
  if (item.pro_only && !isPro) return { error: "pro_only" };

  const already = db.prepare(
    `SELECT qty FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?`
  ).get(userId, cosmeticId);
  // Spins + bundles are always re-buyable; equippable cosmetics one-shot.
  if (already && !item.consumable && item.category !== "bundle" && item.category !== "spins") return { error: "already_owned" };

  const cost = item.price_coins;
  const grantedItems = [];

  const tx = db.transaction(() => {
    const userStats = db.prepare(`SELECT coins FROM stats WHERE user_id = ?`).get(userId);
    if (!userStats) throw new Error("no_stats");
    if (userStats.coins < cost) throw new Error("insufficient_funds");

    db.prepare(`UPDATE stats SET coins = coins - ?, updated_at = ? WHERE user_id = ?`).run(cost, Date.now(), userId);

    const grantOne = (it) => {
      const existing = db.prepare(`SELECT qty FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?`).get(userId, it.id);
      if (existing && it.consumable) {
        db.prepare(`UPDATE user_cosmetics SET qty = qty + 1, purchased_at = ? WHERE user_id = ? AND cosmetic_id = ?`)
          .run(Date.now(), userId, it.id);
      } else if (!existing) {
        db.prepare(`INSERT INTO user_cosmetics(user_id, cosmetic_id, qty, purchased_at) VALUES (?, ?, 1, ?)`)
          .run(userId, it.id, Date.now());
      }
      if (!it.consumable && EQUIPPABLE.has(it.category)) {
        const cur = db.prepare(`SELECT cosmetic_id FROM user_equipped WHERE user_id = ? AND category = ?`).get(userId, it.category);
        if (!cur || !cur.cosmetic_id) {
          db.prepare(
            `INSERT INTO user_equipped(user_id, category, cosmetic_id) VALUES (?, ?, ?)
             ON CONFLICT(user_id, category) DO UPDATE SET cosmetic_id = excluded.cosmetic_id`
          ).run(userId, it.category, it.id);
        }
      }
      grantedItems.push(it);
    };

    if (item.category === "bundle" && Array.isArray(item.bundle_contents)) {
      // Grant the bundle marker (so we know they own it / can't re-buy)
      // and then every referenced cosmetic. Skips items they already own.
      db.prepare(`INSERT OR IGNORE INTO user_cosmetics(user_id, cosmetic_id, qty, purchased_at) VALUES (?, ?, 1, ?)`)
        .run(userId, item.id, Date.now());
      for (const childId of item.bundle_contents) {
        const childItem = getItem(childId);
        if (!childItem) continue;
        const childOwned = db.prepare(`SELECT 1 FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?`).get(userId, childId);
        if (childOwned && !childItem.consumable) continue;
        grantOne(childItem);
      }
      // Bundles can also include a bonus pile of free spins as part of
      // the value pitch — granted in the same transaction.
      const spinsBonus = item.data && Number(item.data.spins_bonus) | 0;
      if (spinsBonus > 0) {
        db.prepare(`UPDATE stats SET free_spins = free_spins + ?, updated_at = ? WHERE user_id = ?`)
          .run(spinsBonus, Date.now(), userId);
      }
    } else if (item.category === "spins") {
      // Direct spin packs grant their `data.spins` count immediately —
      // there's nothing to "use later" since spins ARE the consumable.
      const n = (item.data && Number(item.data.spins)) | 0;
      if (n > 0) {
        db.prepare(`UPDATE stats SET free_spins = free_spins + ?, updated_at = ? WHERE user_id = ?`)
          .run(n, Date.now(), userId);
      }
      // Record the purchase so spending badges + ownership badges fire.
      db.prepare(`INSERT OR IGNORE INTO user_cosmetics(user_id, cosmetic_id, qty, purchased_at) VALUES (?, ?, 1, ?)`)
        .run(userId, item.id, Date.now());
      grantedItems.push(item);
    } else {
      grantOne(item);
    }
  });

  try { tx(); }
  catch (e) {
    // Only user-facing error codes leak through; everything else gets a
    // generic "buy_failed" + a server log so we can diagnose without
    // exposing internal table names / SQL errors to the client.
    const known = new Set(["insufficient_funds", "no_stats"]);
    if (e && known.has(e.message)) return { error: e.message };
    console.error("[cosmetics] buy_failed", e);
    return { error: "buy_failed" };
  }
  const after = db.prepare(`SELECT coins FROM stats WHERE user_id = ?`).get(userId);
  return { ok: true, item, coins_after: after ? after.coins : 0, granted: grantedItems };
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

// Public projection for other players — the equipped frame + title that
// SHOULD show next to their username in leaderboards / matches. Returns
// the full item objects (with their `data` payloads) so renderers don't
// have to round-trip the catalog. Excludes consumables and category-only
// fields that don't affect the visible UI.
function getPublicCosmetics(userId) {
  const row = db.prepare(
    `SELECT category, cosmetic_id FROM user_equipped
     WHERE user_id = ? AND category IN ('frame', 'title')`
  ).all(userId);
  const out = {};
  for (const r of row) {
    if (!r.cosmetic_id) continue;
    const item = getItem(r.cosmetic_id);
    if (item) out[r.category] = item;
  }
  return out;
}

// Batched version of getPublicCosmetics — one JOIN to pull frame +
// title cosmetic rows for ALL requested users at once, instead of the
// per-user round-trip that getPublicCosmetics(userId) does in a loop.
// Returns { [userId]: { frame, title } }. Used by the leaderboard
// endpoint to drop a 50-row request from 100+ SELECTs to 1.
// Selects every cosmetics column so rowToItem doesn't get NULL
// readbacks for fields like rarity / pro_only / sort_order.
function getPublicCosmeticsForUsers(userIds) {
  const ids = (userIds || []).filter((n) => Number.isInteger(n));
  if (!ids.length) return {};
  const placeholders = ids.map(() => "?").join(",");
  const now = Date.now();
  const rows = db.prepare(`
    SELECT ue.user_id, ue.category AS slot,
           c.id, c.category, c.name, c.description, c.price_coins,
           c.rarity, c.icon, c.data, c.pro_only, c.consumable,
           c.sort_order, c.available_from, c.available_until,
           c.bundle_contents
    FROM user_equipped ue
    JOIN cosmetics c ON c.id = ue.cosmetic_id
    WHERE ue.user_id IN (${placeholders})
      AND ue.category IN ('frame', 'title')
      AND c.enabled = 1
      AND (c.available_from IS NULL OR c.available_from <= ?)
      AND (c.available_until IS NULL OR c.available_until >= ?)
  `).all(...ids, now, now);
  const out = {};
  for (const r of rows) {
    if (!out[r.user_id]) out[r.user_id] = {};
    // Key by the user_equipped slot name (which matches c.category
    // for frame/title — explicit alias just to be defensive against
    // any future divergence).
    out[r.user_id][r.slot] = rowToItem(r);
  }
  return out;
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
  getPublicCosmetics,
  getPublicCosmeticsForUsers,
};
