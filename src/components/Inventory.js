import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { equipCosmetic, unequipCategory, useBoost, isOwned, selectOwnedQty } from "../store/cosmeticsSlice";
import { fetchStats } from "../store/statsSlice";
import { pushToast, setView } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import { EmptyInventoryIcon, EmptyState, SpinnerIcon } from "./SvgIcons";

// Player inventory — one place to see every owned cosmetic + every
// consumable in stock, equip / unequip equippables, and burn boosts
// without having to scroll through the store. Mirrors what `Shop.js`
// would show but filtered to what the player actually owns.

const EQUIPPABLE_CATS = [
  { id: "frame",       label: "Avatar Frame" },
  { id: "celebration", label: "Win Celebration" },
  { id: "title",       label: "Username Title" },
];

export default function Inventory() {
  const dispatch = useDispatch();
  const catalog = useSelector((s) => s.cosmetics.catalog);
  const owned = useSelector((s) => s.cosmetics.owned);
  const equipped = useSelector((s) => s.cosmetics.equipped);

  if (!catalog.length) {
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <SpinnerIcon size={32} />
        <div style={{ marginTop: 8, color: "var(--text-dim)" }}>Loading inventory…</div>
      </div>
    );
  }

  const ownedIds = new Set(owned.map((o) => o.cosmetic_id));
  const ownedConsumables = owned
    .map((o) => ({ ...o, item: catalog.find((c) => c.id === o.cosmetic_id) }))
    .filter((o) => o.item && o.item.consumable && o.qty > 0);

  // Player has literally nothing — render a full empty state with a CTA
  // to the Store instead of three "Nothing owned yet" cards stacked.
  const hasAnyOwnedEquippable = EQUIPPABLE_CATS.some((cat) =>
    catalog.filter((c) => c.category === cat.id).some((c) => isOwnedHelper(c, ownedIds))
  );
  if (!hasAnyOwnedEquippable && ownedConsumables.length === 0) {
    return (
      <EmptyState
        icon={<EmptyInventoryIcon size={120} />}
        title="Your inventory is empty"
        hint="Visit the Store to grab frames, celebrations, titles, or a spin pack to get rolling."
        action={
          <button className="tw-btn" onClick={() => dispatch(setView("shop"))}>
            Open Store
          </button>
        }
      />
    );
  }

  return (
    <div className="tw-col">
      <div className="tw-card" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(236,72,153,0.1))", borderColor: "rgba(124,58,237,0.4)" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>🎒 Inventory</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
          Equip your cosmetics or use your consumables — no trip to the store needed.
        </div>
      </div>

      {/* Equipped cosmetics per category — shows what's active + lets
          the player swap to any other owned alternate in one tap. */}
      {EQUIPPABLE_CATS.map((cat) => {
        const equippedId = equipped[cat.id];
        const optionsAll = catalog.filter((c) => c.category === cat.id);
        const optionsOwned = optionsAll.filter((c) => isOwnedHelper(c, ownedIds));
        return (
          <div key={cat.id} className="tw-card">
            <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 15 }}>{cat.label}</div>
              {equippedId && equippedId !== `${cat.id}_default` && (
                <button className="tw-pill" style={{ cursor: "pointer" }}
                        onClick={() => dispatch(unequipCategory(cat.id))}>
                  Unequip
                </button>
              )}
            </div>
            {optionsOwned.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
                Nothing owned yet. Visit the Store to unlock {cat.label.toLowerCase()}s.
              </div>
            ) : (
              <div className="tw-inv-grid">
                {optionsOwned.map((item) => (
                  <InventoryCard
                    key={item.id}
                    item={item}
                    equipped={equippedId === item.id}
                    onEquip={() => {
                      sfx.click();
                      dispatch(equipCosmetic(item.id))
                        .then(() => dispatch(pushToast({ icon: "✓", title: `Equipped ${item.name}` })));
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Consumables — boosts the player has stocked. Each shows the
          qty and a Use button that burns one and applies the effect. */}
      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 15, marginBottom: 8 }}>⚡ Boosts on hand</div>
        {ownedConsumables.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
            No boosts in stock. The Store has XP doublers, lives refills, mystery boxes, and more.
          </div>
        ) : (
          <div className="tw-inv-grid">
            {ownedConsumables.map(({ item, qty }) => (
              <BoostCard key={item.id} item={item} qty={qty} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// "Owned for equip purposes" — free defaults count as owned even if no
// row exists in user_cosmetics. Matches the server's permissive equip
// rule for price_coins === 0 items.
function isOwnedHelper(item, ownedIds) {
  if (item.consumable) return false;
  if (item.price_coins === 0 && !item.pro_only) return true;
  return ownedIds.has(item.id);
}

function InventoryCard({ item, equipped, onEquip }) {
  return (
    <button
      className={`tw-inv-card ${equipped ? "equipped" : ""}`}
      onClick={equipped ? undefined : onEquip}
      disabled={equipped}
      title={item.description}
    >
      {equipped && <span className="tw-inv-card-check" aria-hidden="true">✓</span>}
      <div className="tw-inv-card-icon">{item.icon || "•"}</div>
      <div className="tw-inv-card-name">{item.name}</div>
      <div className={`tw-inv-card-status ${equipped ? "equipped" : ""}`}>
        {equipped ? "Equipped" : "Tap to equip"}
      </div>
    </button>
  );
}

function BoostCard({ item, qty }) {
  const dispatch = useDispatch();
  const onUse = async () => {
    sfx.coin();
    const r = await dispatch(useBoost(item.id));
    if (r.meta.requestStatus === "fulfilled") {
      dispatch(fetchStats());
      const a = r.payload.applied || {};
      if (a.reward) {
        const rw = a.reward;
        const text = rw.kind === "coins" ? `+${rw.amount} coins`
                   : rw.kind === "powerup" ? `+${rw.amount}× ${rw.type}`
                   : rw.kind === "cosmetic" ? `Unlocked ${rw.item.name}!` : "";
        dispatch(pushToast({ icon: "🎁", title: "Mystery Box!", text }));
      } else if (a.lives_refilled) {
        dispatch(pushToast({ icon: "❤️", title: "Lives refilled" }));
      } else if (a.active_until) {
        const mins = Math.round((a.active_until - Date.now()) / 60000);
        dispatch(pushToast({ icon: "⚡", title: `${item.name} active`, text: `${mins} minutes left.` }));
      } else if (a.streak_shield_active) {
        dispatch(pushToast({ icon: "🛡️", title: "Streak shield armed" }));
      } else {
        dispatch(pushToast({ icon: "✓", title: `Used ${item.name}` }));
      }
    } else {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't use", text: r.payload?.error || "" }));
    }
  };
  return (
    <div className="tw-inv-card boost">
      <div className="tw-inv-card-icon">{item.icon || "•"}</div>
      <div className="tw-inv-card-name">{item.name}</div>
      <div className="tw-inv-card-qty">×{qty}</div>
      <button className="tw-btn" style={{ padding: "6px 14px", fontSize: 13, marginTop: 6 }} onClick={onUse}>Use</button>
    </div>
  );
}
