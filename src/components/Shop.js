import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { refillLives, setPro, fetchStats, syncCoins } from "../store/statsSlice";
import { pushToast, setModal, setView, setProfileTab } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import {
  fetchCatalog, buyCosmetic, equipCosmetic, useBoost, isOwned, selectOwnedQty,
} from "../store/cosmeticsSlice";
import { awardLocal } from "../store/badgesSlice";
import PayPalButton from "./PayPalButton";
import StripeCheckoutButton from "./StripeCheckoutButton";
import Icon from "./Icon";
import { SpinnerIcon, EmptyStoreIcon, EmptyState } from "./SvgIcons";
import { cosmeticIconUrl } from "../data/cosmeticIcons";
import OtherAvatar from "./OtherAvatar";

// Tab icons. Strings render as emoji; objects with `iconName` render
// through <Icon name=...> so the same wheel.png art used everywhere
// else also appears in the Spins tab pill (and coins in Currency).
const TAB_DEFS = [
  { id: "featured",    label: "Featured",      icon: "✨", description: "Today's picks — rotating selection of hot items." },
  { id: "spins",       label: "Spins",         iconName: "free_spin", description: "Spin packs to keep the wheel turning. Coins → spins, no real money required." },
  { id: "bundle",      label: "Bundles",       iconName: "gift", description: "Save by buying multiple items together. Most include bonus spins." },
  { id: "frame",       label: "Frames",        icon: "🖼️", description: "Decorate your avatar with rings and glows." },
  { id: "celebration", label: "Celebrations",  icon: "🎉", description: "Effects that play when you win a round." },
  { id: "title",       label: "Titles",        icon: "🏷️", description: "Badges shown next to your username." },
  { id: "boost",       label: "Boosts",        icon: "⚡", description: "Limited-time multipliers and one-shot perks." },
  { id: "currency",    label: "Coins & Pro",   iconName: "coins", description: "Top up coins with real money or upgrade to Pro." },
];

// Categories hidden from the store tabs but still present in the catalog
// (so already-owned items keep working). Featured rotation also skips them.
const HIDDEN_CATEGORIES = new Set(["pointer"]);

// Deterministic daily rotation — picks 4 items keyed off today's date so
// every player sees the same featured set today but tomorrow it changes.
function pickFeatured(catalog) {
  if (!catalog.length) return [];
  const day = Math.floor(Date.now() / 86_400_000);
  const ranked = catalog
    .filter((c) => c.category !== "boost" && c.category !== "bundle" && c.price_coins > 0 && !c.pro_only && !HIDDEN_CATEGORIES.has(c.category))
    .map((c) => ({ c, score: hash(c.id + ":" + day) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((x) => x.c);
  return ranked;
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h;
}

const RARITY_COLORS = {
  common:    { border: "rgba(148,163,184,0.4)", text: "#94a3b8", glow: "rgba(148,163,184,0.15)" },
  rare:      { border: "rgba(34,211,238,0.55)", text: "#22d3ee", glow: "rgba(34,211,238,0.18)" },
  epic:      { border: "rgba(168,85,247,0.6)",  text: "#c084fc", glow: "rgba(168,85,247,0.25)" },
  legendary: { border: "rgba(245,158,11,0.7)",  text: "#fbbf24", glow: "rgba(245,158,11,0.3)" },
};

export default function Shop() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const stats = useSelector((s) => s.stats);
  const catalog = useSelector((s) => s.cosmetics.catalog);
  const loaded = useSelector((s) => s.cosmetics.loaded);
  const [activeTab, setActiveTab] = useState("featured");

  useEffect(() => { dispatch(fetchCatalog()); }, [dispatch]);

  const itemsForTab = useMemo(() => {
    if (activeTab === "currency") return null;
    if (activeTab === "featured") return pickFeatured(catalog);
    return catalog.filter((c) => c.category === activeTab)
      .sort((a, b) => (a.sort_order - b.sort_order) || a.price_coins - b.price_coins);
  }, [catalog, activeTab]);

  return (
    <div className="tw-col">
      <div className="tw-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: "8px 0", display: "inline-flex", alignItems: "center", gap: 10 }}>
          <Icon name="shop" size={32} /> Store
        </h1>
        <div className="tw-row" style={{ gap: 6 }}>
          {user && (
            <button className="tw-pill"
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                    onClick={() => { dispatch(setProfileTab("inventory")); dispatch(setView("profile")); }}
                    title="View your owned cosmetics + boosts">
              🎒 Inventory
            </button>
          )}
          <span className="tw-pill" title="Your coins" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px 6px 6px" }}>
            <Icon name="coins" size={22} />
            <strong>{stats.coins.toLocaleString()}</strong>
          </span>
        </div>
      </div>

      <div className="tw-store-tabs">
        {TAB_DEFS.map((t) => (
          <button
            key={t.id}
            className={`tw-store-tab ${activeTab === t.id ? "active" : ""}`}
            onClick={() => { sfx.click(); setActiveTab(t.id); }}
            title={t.description}
          >
            <span style={{ fontSize: 18, display: "inline-flex", alignItems: "center" }}>
              {t.iconName ? <Icon name={t.iconName} size={20} /> : t.icon}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="tw-store-blurb">{TAB_DEFS.find((t) => t.id === activeTab)?.description}</div>

      {activeTab === "currency"
        ? <CurrencyPane />
        : !loaded
          ? <div className="tw-card" style={{ textAlign: "center", padding: 32 }}>
              <SpinnerIcon size={36} />
              <div style={{ marginTop: 10, color: "var(--text-dim)" }}>Loading store…</div>
            </div>
          : itemsForTab.length === 0
            ? <EmptyState
                icon={<EmptyStoreIcon size={120} />}
                title="Nothing here yet"
                hint="Featured items rotate daily — check back tomorrow for fresh picks."
              />
            : (
              <div className="tw-store-grid">
                {itemsForTab.map((item) => (
                  <StoreItemCard key={item.id} item={item} onNeedCoins={() => setActiveTab("currency")} />
                ))}
              </div>
            )
      }
    </div>
  );
}

// Categories that actually have an `equipped` slot — used to gate
// the isEquipped check so non-equippable items (boost/bundle/spins)
// can't accidentally match a future stray entry in equipped state.
const EQUIPPABLE_CATEGORIES = new Set(["frame", "pointer", "celebration", "title"]);

function StoreItemCard({ item, onNeedCoins }) {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const coins = useSelector((s) => s.stats.coins);
  const pro = useSelector((s) => s.stats.pro);
  const equippedId = useSelector((s) =>
    EQUIPPABLE_CATEGORIES.has(item.category) ? s.cosmetics.equipped[item.category] : null
  );
  const owned = useSelector((s) => isOwned(s, item.id));
  const qty = useSelector((s) => selectOwnedQty(s, item.id));
  const isEquipped = EQUIPPABLE_CATEGORIES.has(item.category) && equippedId === item.id;
  const rar = RARITY_COLORS[item.rarity] || RARITY_COLORS.common;
  // Debounce protects against double-tap on Buy / Equip / Use —
  // server already idempotent for equip, but two rapid Buy clicks
  // double-charge under load. Cleared in finally so a slow network
  // doesn't permanently freeze the card.
  const [busy, setBusy] = useState(false);

  const requireAuth = () => {
    if (!user) { dispatch(setModal("auth")); return false; }
    return true;
  };

  const onBuy = async () => {
    if (busy) return;
    if (!requireAuth()) return;
    if (item.pro_only && !pro) {
      dispatch(pushToast({ icon: "🌟", title: "Pro members only", text: "Upgrade to Pro to unlock." }));
      return;
    }
    if (coins < item.price_coins) {
      // Single nudge — toast tells you why, and (after a beat) the
      // tab jumps so you can act on it without losing context. Was
      // doing both at the same time which felt jarring.
      dispatch(pushToast({ icon: "🪙", title: "Need more coins", text: `Short by ${(item.price_coins - coins).toLocaleString()}. Grab a pack below.` }));
      if (onNeedCoins) setTimeout(() => onNeedCoins(), 350);
      return;
    }
    setBusy(true);
    // Click sound matches the cost — coin chime only when coin was
    // spent; click for the free defaults / promos.
    if (item.price_coins > 0) sfx.coin(); else sfx.click();
    try {
      const r = await dispatch(buyCosmetic(item.id));
      if (r.meta.requestStatus !== "fulfilled") {
        const err = r.payload?.error;
        const text = err === "insufficient_funds" ? "Not enough coins — try again."
                   : err === "pro_only"           ? "This needs Pro to unlock."
                   : err === "already_owned"      ? "You already own this."
                   : (err || "Try again.");
        dispatch(pushToast({ icon: "⚠️", title: "Purchase failed", text }));
        return;
      }
      // Server returns the authoritative post-purchase coin balance —
      // sync it into redux NOW so the displayed total updates
      // immediately, rather than briefly showing stale coins while
      // we wait on fetchStats.
      const coinsAfter = r.payload?.coins_after;
      if (typeof coinsAfter === "number") dispatch(syncCoins(coinsAfter));
      // Bundles + spin packs are not "unlocked", they're delivered.
      // Per-category wording so the toast feels right.
      const isSpins = item.category === "spins";
      const isBundle = item.category === "bundle";
      const title = isSpins ? `+${item.data?.spins || 0} spins`
                  : isBundle ? `${item.name} unlocked!`
                  : `Unlocked ${item.name}!`;
      const text = isSpins ? "Added to your spin bank — happy spinning!"
                 : item.consumable ? "Tap Use from your inventory."
                 : isBundle ? "Everything in the pack is yours — check your inventory."
                 : "Now equipped.";
      dispatch(pushToast({ icon: "✨", title, text }));
      // Bundles + spin packs change the broader stats picture (spins
      // count + multiple new owns) so a fresh /stats pull is worth
      // the round-trip. Single equippables skip it since we already
      // applied the local delta.
      if (isSpins || isBundle) dispatch(fetchStats());
      const newBadges = r.payload?.new_badges || [];
      if (newBadges.length) dispatch(awardLocal(newBadges));
    } finally {
      setBusy(false);
    }
  };

  const onEquip = async () => {
    if (busy) return;
    if (!requireAuth()) return;
    setBusy(true);
    sfx.click();
    try {
      const r = await dispatch(equipCosmetic(item.id));
      if (r.meta.requestStatus === "fulfilled") {
        dispatch(pushToast({ icon: "✓", title: `Equipped ${item.name}` }));
      } else {
        dispatch(pushToast({ icon: "⚠️", title: "Couldn't equip", text: r.payload?.error || "Try again." }));
      }
    } finally {
      setBusy(false);
    }
  };

  const onUse = async () => {
    if (busy) return;
    if (!requireAuth()) return;
    setBusy(true);
    sfx.powerup();
    try {
      const r = await dispatch(useBoost(item.id));
      if (r.meta.requestStatus !== "fulfilled") {
        dispatch(pushToast({ icon: "⚠️", title: "Couldn't use", text: r.payload?.error || "Try again." }));
        return;
      }
      const a = r.payload.applied || {};
      dispatch(fetchStats());
      if (a.reward) {
        const reward = a.reward;
        const text = reward.kind === "coins" ? `+${reward.amount} coins`
                   : reward.kind === "powerup" ? `+${reward.amount}× ${reward.type} power-up`
                   : reward.kind === "cosmetic" ? `New cosmetic: ${reward.item.name}!`
                   : "";
        dispatch(pushToast({ icon: "🎁", title: "Mystery Box!", text }));
      } else if (a.lives_refilled) {
        dispatch(pushToast({ icon: "❤️", title: "Lives refilled" }));
      } else if (a.active_until) {
        // Prefer server-supplied remaining_ms over computing from
        // active_until + local clock — avoids client/server drift.
        const remMs = typeof a.remaining_ms === "number" ? a.remaining_ms : (a.active_until - Date.now());
        const mins = Math.max(1, Math.round(remMs / 60000));
        dispatch(pushToast({ icon: "⚡", title: `${item.name} active`, text: `${mins} minutes left.` }));
      } else if (a.streak_shield_active) {
        dispatch(pushToast({ icon: "🛡️", title: "Streak shield armed" }));
      }
    } finally {
      setBusy(false);
    }
  };

  const canEquip = (item.price_coins === 0 || owned) && !item.consumable && !item.pro_only;
  const canEquipPro = item.pro_only && pro;

  // Frames are CSS-driven effects, not static art — always use the
  // live preview so what you see in the store is exactly the ring
  // you'll wear. PNG thumbnails of frames are decorative only.
  const artUrl = item.category === "frame" ? null : cosmeticIconUrl(item);
  const isLegendary = item.rarity === "legendary";
  return (
    <div
      className={`tw-store-card rarity-${item.rarity || "common"} ${isEquipped ? "equipped" : ""} ${isLegendary ? "legendary-shine" : ""}`}
      style={{ borderColor: isEquipped ? "var(--primary-2)" : rar.border }}
    >
      {/* Corner ribbons — only the most relevant single status shows.
          Priority: LIMITED > EQUIPPED > OWNED. Keeps the corner from
          getting crowded. */}
      {item.available_until ? (
        <span className="tw-store-ribbon limited">⏰ LIMITED</span>
      ) : isEquipped ? (
        <span className="tw-store-ribbon equipped">✓ EQUIPPED</span>
      ) : owned && !item.consumable ? (
        <span className="tw-store-ribbon owned">OWNED</span>
      ) : null}

      <div className="tw-store-card-icon">
        {artUrl ? (
          // Generated PNG art — primary path for items that have a
          // ready thumbnail. <img> over background-image so we get
          // native alt-text + a real 404 fallback to the CSS preview.
          <img
            src={artUrl}
            alt={item.name}
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            draggable={false}
            className="tw-store-card-art"
          />
        ) : item.category === "frame" ? (
          <FramePreview item={item} />
        ) : (
          <span style={{ fontSize: 44 }}>{item.icon || "•"}</span>
        )}
      </div>
      <div className="tw-store-card-body">
        <div className="tw-row" style={{ gap: 6 }}>
          <strong>{item.name}</strong>
          <span style={{ fontSize: 10, textTransform: "uppercase", color: rar.text, letterSpacing: 0.5 }}>{item.rarity}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", margin: "4px 0 8px", minHeight: 30 }}>{item.description}</div>
        {item.category === "bundle" && Array.isArray(item.bundle_contents) && (
          <BundleContents ids={item.bundle_contents} spinsBonus={item.data && item.data.spins_bonus} />
        )}
        {item.consumable && qty > 0 && (
          <div style={{ fontSize: 11, color: "var(--good)", marginBottom: 6 }}>You own {qty}</div>
        )}
        <div className="tw-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 6 }}>
          {item.consumable ? (
            <>
              <button className="tw-btn ghost" style={{ flex: 1, padding: "6px 10px" }} onClick={onBuy} disabled={busy || (item.pro_only && !pro)}>
                {busy ? "…" : item.price_coins === 0 ? "Free" : `${item.price_coins} 🪙`}
              </button>
              {qty > 0 && (
                <button className="tw-btn" style={{ flex: 1, padding: "6px 10px" }} onClick={onUse} disabled={busy}>
                  {busy ? "…" : "Use"}
                </button>
              )}
            </>
          ) : isEquipped ? (
            <button className="tw-btn" style={{ flex: 1, padding: "6px 10px" }} disabled>✓ Equipped</button>
          ) : canEquip || canEquipPro ? (
            <button className="tw-btn" style={{ flex: 1, padding: "6px 10px" }} onClick={onEquip} disabled={busy}>
              {busy ? "…" : "Equip"}
            </button>
          ) : item.pro_only && !pro ? (
            <button className="tw-btn ghost" style={{ flex: 1, padding: "6px 10px" }} disabled>🌟 Pro only</button>
          ) : (
            <button className="tw-btn" style={{ flex: 1, padding: "6px 10px" }} onClick={onBuy} disabled={busy}>
              {busy ? "…" : item.price_coins === 0 ? "Get" : `${item.price_coins} 🪙`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Live frame preview — renders the user's OWN avatar wrapped in the
// frame they're previewing, using the exact same OtherAvatar +
// frameStyleFor logic that paints the ring in-game. What you see in
// the store is precisely what you'll wear. Falls back to a friendly
// DiceBear avatar for signed-out browsers so the preview still looks
// like a real avatar (instead of a generic 👤 silhouette).
//
// "default" frame (style:none) renders the avatar bare so the player
// knows what unframed looks like vs. the ring options.
function FramePreview({ item }) {
  const userAvatar = useSelector((s) => s.auth.user && s.auth.user.avatar);
  const previewAvatar = userAvatar || "dicebear:adventurer:storefront";
  // Cosmetic shape OtherAvatar expects: { frame: { id, data, ... } }.
  // Crucially the `id` field is required — that's what framePngUrl()
  // uses to find the PNG. Without it the renderer was falling
  // through to the CSS shadow fallback and the store kept showing
  // the old box-shadow ring instead of the new PNG art.
  const cosmetics = item.data && item.data.style !== "none"
    ? { frame: { id: item.id, data: item.data } }
    : undefined;
  // Avatar inner size. PNG frame wraps it at size / HOLE_RATIO
  // (≈ size × 1.82). So a 52 px avatar paints inside a ~95 px PNG
  // frame — fits the 110 px desktop icon plate with breathing room
  // and the 100 px mobile plate cleanly.
  const SIZE = 52;
  return (
    <div
      className="tw-store-frame-preview"
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      <OtherAvatar value={previewAvatar} cosmetics={cosmetics} size={SIZE} />
    </div>
  );
}

// ─── Currency / Pro pane ─────────────────────────────────────────────────
// Coin packs ALWAYS route through real payment providers (PayPal /
// Stripe Checkout) — there is no "click to grant" path. Players see one
// row per pack with a payment provider button; no charge, no coins.
function CurrencyPane() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const stats = useSelector((s) => s.stats);
  const [payCfg, setPayCfg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/pay/config").then((r) => setPayCfg(r.data)).catch(() => setPayCfg({}));
  }, []);

  const buyPro = async () => {
    if (!user) { dispatch(setModal("auth")); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/pro/checkout");
      if (data.url) {
        window.location.href = data.url;
      } else if (data.devGranted) {
        dispatch(setPro({ pro: true, pro_until: data.pro_until }));
        dispatch(pushToast({ icon: "🌟", title: "Pro unlocked (dev grant)", text: "Test-only — 5 minutes." }));
        // Schedule a stats re-fetch when the dev-grant expires so the
        // UI flips back to non-Pro at the exact moment the server
        // does. Without this, the user stays in a "ghost Pro" state
        // until they navigate or fetchStats fires on its own.
        const inMs = Math.max(1000, (data.pro_until || (Date.now() + 5 * 60_000)) - Date.now());
        setTimeout(() => dispatch(fetchStats()), inMs + 1500);
      }
    } catch (e) {
      const err = e?.response?.data?.error;
      if (err === "payments_not_configured") {
        dispatch(pushToast({ icon: "⚠️", title: "Pro is unavailable", text: "Admin needs to finish payment setup." }));
      } else {
        dispatch(pushToast({ icon: "⚠️", title: "Couldn't start checkout" }));
      }
    }
    setBusy(false);
  };

  const buyLives = () => {
    if (stats.coins < 50) {
      dispatch(pushToast({ icon: "🪙", title: "Not enough coins", text: "Refill lives costs 50." }));
      return;
    }
    sfx.coin();
    dispatch(refillLives());
    dispatch(pushToast({ icon: "♥", title: "Lives refilled!" }));
  };

  // Coin packs MUST route through real payment providers. Each pack
  // shows whichever providers are enabled (PayPal, Stripe, or both).
  // `productId` matches keys in server's payments CATALOG.
  const COIN_PACKS = [
    { id: "coins_small",  label: "Small bag",   coins: 200,  price: "$0.99" },
    { id: "coins_medium", label: "Stack",       coins: 600,  price: "$2.99" },
    { id: "coins_large",  label: "Coin vault",  coins: 1500, price: "$5.99" },
  ];

  const paymentsLive = payCfg && (payCfg.paypal_enabled || payCfg.stripe_enabled);

  return (
    <>
      <div className="tw-card" style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.25), rgba(239,68,68,0.25))", borderColor: "rgba(245,158,11,0.5)" }}>
        <div className="tw-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700 }}>🌟 Trivia Pro</div>
            <div style={{ color: "var(--text-dim)", fontSize: 14 }}>
              Unlimited lives · No ads · Exclusive cosmetics · 2× coin pickups
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "Fredoka" }}>$2.99</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>/month</div>
          </div>
        </div>
        <button className="tw-btn block" style={{ marginTop: 12, background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}
                onClick={buyPro} disabled={busy || stats.pro}>
          {stats.pro ? "Active — thank you!" : busy ? "..." : "Upgrade to Pro"}
        </button>
      </div>

      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Quick refills</div>
        <button className="tw-btn ghost block" onClick={buyLives} disabled={(stats.free_spins || 0) >= 5 || stats.pro}>
          ♥ Refill lives (50 🪙)
        </button>
      </div>

      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>💳 Buy coins</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 10 }}>
          Coins unlock cosmetics, boosts, and power-ups. Real-money checkout via{" "}
          {paymentsLive
            ? [payCfg.paypal_enabled && "PayPal", payCfg.stripe_enabled && "Stripe"].filter(Boolean).join(" or ")
            : "your configured provider"}.
        </div>

        {!user && (
          <button className="tw-btn block" onClick={() => dispatch(setModal("auth"))}>
            Sign in to buy
          </button>
        )}

        {user && !paymentsLive && (
          <div className="tw-card" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Payments not configured yet</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
              The admin needs to add a PayPal or Stripe account in the Admin panel before coin packs can be purchased.
            </div>
          </div>
        )}

        {user && paymentsLive && COIN_PACKS.map((p) => (
          <div key={p.id} style={{ padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{p.label}</div>
                <div style={{ color: "var(--text-dim)", fontSize: 12 }}>+{p.coins.toLocaleString()} 🪙 · {p.price}</div>
              </div>
            </div>
            <div className="tw-grid-2" style={{ gap: 8 }}>
              {payCfg.paypal_enabled && (
                <PayPalButton productId={p.id} clientId={payCfg.paypal_client_id} />
              )}
              {payCfg.stripe_enabled && (
                <StripeCheckoutButton productId={p.id} />
              )}
            </div>
          </div>
        ))}

        {paymentsLive && (
          <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
            Coins are granted only after the payment provider confirms the charge. No card details touch our servers.
          </div>
        )}
      </div>
    </>
  );
}

// Resolves bundle child ids to human-readable item names with their
// icons. Replaces the previous raw `"frame_bronze"` → "frame bronze"
// placeholder display.
function BundleContents({ ids, spinsBonus }) {
  const catalog = useSelector((s) => s.cosmetics.catalog);
  const items = ids
    .map((id) => catalog.find((c) => c.id === id))
    .filter(Boolean);
  return (
    <div className="tw-store-bundle-list">
      <strong style={{ fontSize: 11, color: "var(--text-dim)" }}>Includes:</strong>
      <ul style={{ margin: "4px 0 8px", padding: "0 0 0 4px", fontSize: 11, color: "var(--text-dim)", listStyle: "none" }}>
        {items.map((it) => {
          // Prefer the PNG thumbnail for visual parity with the rest
          // of the store — emoji is a fallback when the bundle child
          // is a category we haven't generated art for yet (pointer,
          // celebration). Resolver returns null in that case.
          const childArt = cosmeticIconUrl(it);
          return (
            <li key={it.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
              <span style={{ width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {childArt
                  ? <img src={childArt} alt="" width={18} height={18}
                         style={{ objectFit: "contain", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))" }}
                         loading="lazy" draggable={false}
                         onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  : <span>{it.icon || "•"}</span>}
              </span>
              <span>{it.name}</span>
            </li>
          );
        })}
        {spinsBonus > 0 && (
          <li style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0", color: "var(--warn)", fontWeight: 700 }}>
            <span style={{ width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="free_spin" size={16} />
            </span>
            <span>+{spinsBonus} free spins</span>
          </li>
        )}
      </ul>
    </div>
  );
}
