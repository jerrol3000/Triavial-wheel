import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { addCoins, refillLives, setPro, fetchStats } from "../store/statsSlice";
import { pushToast, setModal } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import {
  fetchCatalog, buyCosmetic, equipCosmetic, useBoost, isOwned, selectOwnedQty,
} from "../store/cosmeticsSlice";
import { awardLocal } from "../store/badgesSlice";
import PayPalButton from "./PayPalButton";
import StripeCheckoutButton from "./StripeCheckoutButton";
import Icon from "./Icon";

const TAB_DEFS = [
  { id: "featured",    label: "Featured",      icon: "✨", description: "Today's picks — rotating selection of hot items." },
  { id: "bundle",      label: "Bundles",       icon: "🎁", description: "Save by buying multiple items together." },
  { id: "frame",       label: "Frames",        icon: "🖼️", description: "Decorate your avatar with rings and glows." },
  { id: "pointer",     label: "Pointers",      icon: "🎯", description: "Customize the wheel pointer." },
  { id: "celebration", label: "Celebrations",  icon: "🎉", description: "Effects that play when you win a round." },
  { id: "title",       label: "Titles",        icon: "🏷️", description: "Badges shown next to your username." },
  { id: "boost",       label: "Boosts",        icon: "⚡", description: "Limited-time multipliers and one-shot perks." },
  { id: "currency",    label: "Coins & Pro",   icon: "🪙", description: "Top up coins with real money or upgrade to Pro." },
];

// Deterministic daily rotation — picks 4 items keyed off today's date so
// every player sees the same featured set today but tomorrow it changes.
function pickFeatured(catalog) {
  if (!catalog.length) return [];
  const day = Math.floor(Date.now() / 86_400_000);
  const ranked = catalog
    .filter((c) => c.category !== "boost" && c.category !== "bundle" && c.price_coins > 0 && !c.pro_only)
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
      <div className="tw-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: "8px 0", display: "inline-flex", alignItems: "center", gap: 10 }}>
          <Icon name="shop" size={32} /> Store
        </h1>
        <span className="tw-pill" title="Your coins" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px 6px 6px" }}>
          <Icon name="coins" size={22} />
          <strong>{stats.coins.toLocaleString()}</strong>
        </span>
      </div>

      <div className="tw-store-tabs">
        {TAB_DEFS.map((t) => (
          <button
            key={t.id}
            className={`tw-store-tab ${activeTab === t.id ? "active" : ""}`}
            onClick={() => { sfx.click(); setActiveTab(t.id); }}
            title={t.description}
          >
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="tw-store-blurb">{TAB_DEFS.find((t) => t.id === activeTab)?.description}</div>

      {activeTab === "currency"
        ? <CurrencyPane />
        : !loaded
          ? <div className="tw-card" style={{ textAlign: "center", color: "var(--text-dim)" }}>Loading store…</div>
          : (
            <div className="tw-store-grid">
              {itemsForTab.map((item) => (
                <StoreItemCard key={item.id} item={item} />
              ))}
              {itemsForTab.length === 0 && (
                <div className="tw-card" style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-dim)" }}>
                  Nothing here yet — check back soon.
                </div>
              )}
            </div>
          )
      }
    </div>
  );
}

function StoreItemCard({ item }) {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const coins = useSelector((s) => s.stats.coins);
  const pro = useSelector((s) => s.stats.pro);
  const equippedId = useSelector((s) => s.cosmetics.equipped[item.category]);
  const owned = useSelector((s) => isOwned(s, item.id));
  const qty = useSelector((s) => selectOwnedQty(s, item.id));
  const isEquipped = equippedId === item.id;
  const rar = RARITY_COLORS[item.rarity] || RARITY_COLORS.common;

  const requireAuth = () => {
    if (!user) { dispatch(setModal("auth")); return false; }
    return true;
  };

  const onBuy = async () => {
    if (!requireAuth()) return;
    if (item.pro_only && !pro) {
      dispatch(pushToast({ icon: "🌟", title: "Pro members only", text: "Upgrade to Pro to unlock." }));
      return;
    }
    if (coins < item.price_coins) {
      dispatch(pushToast({ icon: "🪙", title: "Not enough coins", text: `Need ${item.price_coins - coins} more.` }));
      return;
    }
    sfx.coin();
    const r = await dispatch(buyCosmetic(item.id));
    if (r.meta.requestStatus === "fulfilled") {
      dispatch(fetchStats());
      dispatch(pushToast({ icon: "✨", title: `Unlocked ${item.name}!`, text: item.consumable ? `Tap to use from your inventory.` : "Now equipped." }));
      const newBadges = r.payload?.new_badges || [];
      if (newBadges.length) {
        dispatch(awardLocal(newBadges));
        for (const b of newBadges) {
          dispatch(pushToast({ icon: b.icon || "🏅", title: `Badge unlocked: ${b.name}`, text: b.description || "", duration: 6000 }));
        }
      }
    } else {
      dispatch(pushToast({ icon: "⚠️", title: "Purchase failed", text: r.payload?.error || "Try again." }));
    }
  };

  const onEquip = async () => {
    if (!requireAuth()) return;
    sfx.click();
    const r = await dispatch(equipCosmetic(item.id));
    if (r.meta.requestStatus === "fulfilled") {
      dispatch(pushToast({ icon: "✓", title: `Equipped ${item.name}` }));
    }
  };

  const onUse = async () => {
    if (!requireAuth()) return;
    sfx.coin();
    const r = await dispatch(useBoost(item.id));
    if (r.meta.requestStatus === "fulfilled") {
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
        const mins = Math.round((a.active_until - Date.now()) / 60000);
        dispatch(pushToast({ icon: "⚡", title: `${item.name} active`, text: `${mins} minutes left.` }));
      } else if (a.streak_shield_active) {
        dispatch(pushToast({ icon: "🛡️", title: "Streak shield armed" }));
      }
    } else {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't use", text: r.payload?.error || "Try again." }));
    }
  };

  const canEquip = (item.price_coins === 0 || owned) && !item.consumable && !item.pro_only;
  const canEquipPro = item.pro_only && pro;

  return (
    <div className="tw-store-card" style={{ border: `2px solid ${isEquipped ? "var(--primary-2)" : rar.border}`, boxShadow: isEquipped ? `0 0 24px ${rar.glow}` : `0 0 12px ${rar.glow}`, position: "relative" }}>
      {item.available_until && (
        <span className="tw-store-limited">⏰ LIMITED</span>
      )}
      <div className="tw-store-card-icon" style={{ background: rar.glow }}>
        {item.category === "frame" ? <FramePreview item={item} /> : <span>{item.icon || "•"}</span>}
      </div>
      <div className="tw-store-card-body">
        <div className="tw-row" style={{ gap: 6 }}>
          <strong>{item.name}</strong>
          <span style={{ fontSize: 10, textTransform: "uppercase", color: rar.text, letterSpacing: 0.5 }}>{item.rarity}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", margin: "4px 0 8px", minHeight: 30 }}>{item.description}</div>
        {item.category === "bundle" && Array.isArray(item.bundle_contents) && (
          <div className="tw-store-bundle-list">
            <strong style={{ fontSize: 11, color: "var(--text-dim)" }}>Includes:</strong>
            <ul style={{ margin: "4px 0 8px", padding: "0 0 0 14px", fontSize: 11, color: "var(--text-dim)" }}>
              {item.bundle_contents.map((id) => <li key={id}>{id.replace(/_/g, " ")}</li>)}
            </ul>
          </div>
        )}
        {item.consumable && qty > 0 && (
          <div style={{ fontSize: 11, color: "var(--good)", marginBottom: 6 }}>You own {qty}</div>
        )}
        <div className="tw-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 6 }}>
          {item.consumable ? (
            <>
              <button className="tw-btn ghost" style={{ flex: 1, padding: "6px 10px" }} onClick={onBuy} disabled={item.pro_only && !pro}>
                {item.price_coins === 0 ? "Free" : `${item.price_coins} 🪙`}
              </button>
              {qty > 0 && (
                <button className="tw-btn" style={{ flex: 1, padding: "6px 10px" }} onClick={onUse}>Use</button>
              )}
            </>
          ) : isEquipped ? (
            <button className="tw-btn" style={{ flex: 1, padding: "6px 10px" }} disabled>✓ Equipped</button>
          ) : canEquip || canEquipPro ? (
            <button className="tw-btn" style={{ flex: 1, padding: "6px 10px" }} onClick={onEquip}>Equip</button>
          ) : item.pro_only && !pro ? (
            <button className="tw-btn ghost" style={{ flex: 1, padding: "6px 10px" }} disabled>🌟 Pro only</button>
          ) : (
            <button className="tw-btn" style={{ flex: 1, padding: "6px 10px" }} onClick={onBuy}>
              {item.price_coins === 0 ? "Get" : `${item.price_coins} 🪙`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Inline frame preview so the user can see what they're buying. Uses
// the same style data as the actual Avatar component renders.
function FramePreview({ item }) {
  const d = item.data || {};
  const size = 56;
  let style = { width: size, height: size, borderRadius: "50%", background: "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(236,72,153,0.3))", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#fff" };
  if (d.style === "solid") {
    style = { ...style, boxShadow: `0 0 0 ${d.width || 3}px ${d.color}, 0 0 12px ${d.glow || d.color}` };
  } else if (d.style === "gradient") {
    style = { ...style, boxShadow: `0 0 0 ${d.width || 3}px transparent, 0 0 14px ${d.glow}`, backgroundImage: `linear-gradient(rgba(15,12,41,1), rgba(15,12,41,1)), linear-gradient(135deg, ${(d.colors || ["#fff"]).join(",")})`, backgroundOrigin: "border-box", backgroundClip: "content-box, border-box", border: `${d.width || 3}px solid transparent` };
  } else if (d.style === "pulse") {
    style = { ...style, boxShadow: `0 0 0 ${d.width || 3}px ${d.color}, 0 0 18px ${d.glow}`, animation: "tw-frame-pulse 1.6s ease-in-out infinite" };
  } else if (d.style === "shimmer") {
    style = { ...style, boxShadow: `0 0 18px ${d.glow}`, backgroundImage: `linear-gradient(rgba(15,12,41,1), rgba(15,12,41,1)), linear-gradient(135deg, ${(d.colors || ["#fff"]).join(",")})`, backgroundOrigin: "border-box", backgroundClip: "content-box, border-box", border: `${d.width || 4}px solid transparent`, animation: "tw-frame-shimmer 3s linear infinite" };
  }
  return <div style={style}>👤</div>;
}

// ─── Currency / Pro pane ─────────────────────────────────────────────────
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
      if (data.url) window.location.href = data.url;
      else if (data.devGranted) {
        dispatch(setPro({ pro: true, pro_until: data.pro_until }));
        dispatch(pushToast({ icon: "🌟", title: "Pro unlocked (dev grant)", text: "5 minutes." }));
      }
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't start checkout" }));
    }
    setBusy(false);
  };

  const buyCoinPack = async (pack) => {
    if (!user) { dispatch(setModal("auth")); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/pro/buy-coins", { pack: pack.id });
      dispatch(addCoins(data.granted));
      dispatch(pushToast({ icon: "🪙", title: `+${data.granted} coins` }));
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Purchase failed" }));
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

  const COIN_PACKS = [
    { id: "small",  label: "Small bag",   coins: 200,  price: "$0.99" },
    { id: "medium", label: "Stack",       coins: 600,  price: "$2.99" },
    { id: "large",  label: "Coin vault",  coins: 1500, price: "$5.99" },
  ];

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
        <button className="tw-btn ghost block" onClick={buyLives} disabled={stats.lives >= 5 || stats.pro}>
          ♥ Refill lives (50 🪙)
        </button>
      </div>

      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>💳 Buy coins with real money</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 10 }}>
          Use coins to unlock cosmetics, boosts, and power-ups.
        </div>
        {COIN_PACKS.map((p) => (
          <div key={p.id} className="tw-row" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.label} · +{p.coins.toLocaleString()} 🪙</div>
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{p.price}</div>
            </div>
            <button className="tw-btn" onClick={() => buyCoinPack(p)} disabled={busy}>{p.price}</button>
          </div>
        ))}
        {payCfg && (payCfg.paypal_enabled || payCfg.stripe_enabled) && user && (
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-dim)" }}>
            Real-money payments processed by {[payCfg.paypal_enabled && "PayPal", payCfg.stripe_enabled && "Stripe"].filter(Boolean).join(" / ")}.
          </div>
        )}
      </div>
    </>
  );
}
