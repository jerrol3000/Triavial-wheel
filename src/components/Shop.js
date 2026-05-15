import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { addCoins, grantPowerup, grantTheme, setActiveTheme, setPro, spendCoins, refillLives } from "../store/statsSlice";
import { pushToast, setModal } from "../store/uiSlice";
import { THEME_LIST } from "../data/themes";
import { POWERUP_LIST } from "../data/powerups";
import { sfx } from "../utils/sound";

const COIN_PACKS = [
  { id: "small",  label: "Small bag",   coins: 200,  price: "$0.99" },
  { id: "medium", label: "Stack",       coins: 600,  price: "$2.99" },
  { id: "large",  label: "Vault",       coins: 1500, price: "$5.99" },
];

const POWERUP_PACKS = [
  { id: "starter", label: "Starter Pack", desc: "5 of each power-up", price: "$0.99", grants: { fifty: 5, skip: 5, freeze: 5, double: 5 } },
  { id: "mega",    label: "Mega Pack",    desc: "20 of each power-up", price: "$2.99", grants: { fifty: 20, skip: 20, freeze: 20, double: 20 } },
];

export default function Shop() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);
  const [busy, setBusy] = useState(false);

  const requireAuth = () => {
    if (!user) {
      dispatch(setModal("auth"));
      return false;
    }
    return true;
  };

  const buyPro = async () => {
    if (!requireAuth()) return;
    sfx.click();
    setBusy(true);
    try {
      const { data } = await api.post("/pro/checkout");
      if (data.url) {
        window.location.href = data.url;
      } else if (data.devGranted) {
        dispatch(setPro({ pro: true, pro_until: data.pro_until }));
        dispatch(pushToast({ icon: "🌟", title: "Pro unlocked (dev grant)", text: "5 minutes. Configure Stripe for production." }));
      }
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't start checkout", text: "Try again in a moment." }));
    }
    setBusy(false);
  };

  const buyCoinPack = async (pack) => {
    if (!requireAuth()) return;
    sfx.coin();
    setBusy(true);
    try {
      const { data } = await api.post("/pro/buy-coins", { pack: pack.id });
      dispatch(addCoins(data.granted));
      dispatch(pushToast({ icon: "🪙", title: `+${data.granted} coins`, text: "Dev grant — wire Stripe Checkout for production." }));
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Purchase failed" }));
    }
    setBusy(false);
  };

  const buyPowerupPack = (pack) => {
    sfx.coin();
    const totalCost = Object.values(pack.grants).reduce((sum, n) => sum + n * 10, 0);
    if (stats.coins < totalCost) {
      dispatch(pushToast({ icon: "🪙", title: "Not enough coins", text: `Need ${totalCost - stats.coins} more.` }));
      return;
    }
    dispatch(spendCoins(totalCost));
    Object.entries(pack.grants).forEach(([id, count]) => dispatch(grantPowerup({ id, count })));
    dispatch(pushToast({ icon: "🎁", title: `${pack.label} unlocked!`, text: `Spent ${totalCost} 🪙` }));
  };

  const buyTheme = async (theme) => {
    if (stats.themes.includes(theme.id)) {
      dispatch(setActiveTheme(theme.id));
      dispatch(pushToast({ icon: "🎨", title: `Theme set: ${theme.name}` }));
      return;
    }
    if (theme.proOnly && !stats.pro) {
      dispatch(pushToast({ icon: "🌟", title: "Pro only", text: "Subscribe to Pro to unlock." }));
      return;
    }
    if (stats.coins < theme.cost) {
      dispatch(pushToast({ icon: "🪙", title: "Not enough coins" }));
      return;
    }
    sfx.coin();
    if (user) {
      try {
        await api.post("/pro/buy-theme", { theme_id: theme.id });
      } catch (e) {
        // local fallback
      }
    }
    dispatch(spendCoins(theme.cost));
    dispatch(grantTheme(theme.id));
    dispatch(setActiveTheme(theme.id));
    dispatch(pushToast({ icon: "🎨", title: `Unlocked ${theme.name}` }));
  };

  const buyLives = () => {
    if (stats.coins < 50) {
      dispatch(pushToast({ icon: "🪙", title: "Not enough coins", text: "Refill lives costs 50 coins." }));
      return;
    }
    sfx.coin();
    dispatch(spendCoins(50));
    dispatch(refillLives());
    dispatch(pushToast({ icon: "♥", title: "Lives refilled!" }));
  };

  return (
    <div className="tw-col">
      <h1 style={{ margin: "8px 0" }}>🛒 Shop</h1>

      {/* Pro */}
      <div className="tw-card" style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.25), rgba(239,68,68,0.25))", borderColor: "rgba(245,158,11,0.5)" }}>
        <div className="tw-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700 }}>🌟 Trivia Pro</div>
            <div style={{ color: "var(--text-dim)", fontSize: 14 }}>
              Unlimited lives · No ads · Premium categories & themes
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

      {/* Quick refills */}
      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Quick refills</div>
        <button className="tw-btn ghost block" onClick={buyLives} disabled={stats.lives >= 5 || stats.pro}>
          ♥ Refill lives (50 🪙)
        </button>
      </div>

      {/* Power-up packs */}
      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Power-up packs</div>
        {POWERUP_PACKS.map((p) => {
          const cost = Object.values(p.grants).reduce((s, n) => s + n * 10, 0);
          return (
            <div key={p.id} className="tw-row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{p.label}</div>
                <div style={{ color: "var(--text-dim)", fontSize: 13 }}>{p.desc}</div>
              </div>
              <button className="tw-btn" onClick={() => buyPowerupPack(p)}>{cost} 🪙</button>
            </div>
          );
        })}
        <div className="tw-grid-2" style={{ marginTop: 10 }}>
          {POWERUP_LIST.map((p) => (
            <div key={p.id} className="tw-stat">
              <div style={{ fontSize: 18 }}>{p.icon}</div>
              <div className="tw-stat-label">{p.name}</div>
              <div className="tw-stat-value">x{stats.powerups[p.id] || 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Coin packs (real-money via Stripe checkout in prod; dev grants instantly) */}
      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Coin packs</div>
        {COIN_PACKS.map((p) => (
          <div key={p.id} className="tw-row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.label}</div>
              <div style={{ color: "var(--text-dim)", fontSize: 13 }}>+{p.coins} 🪙</div>
            </div>
            <button className="tw-btn" onClick={() => buyCoinPack(p)} disabled={busy}>{p.price}</button>
          </div>
        ))}
      </div>

      {/* Themes */}
      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Themes</div>
        <div className="tw-grid-2">
          {THEME_LIST.map((t) => {
            const owned = stats.themes.includes(t.id);
            const active = stats.active_theme === t.id;
            return (
              <button key={t.id}
                className="tw-card"
                onClick={() => buyTheme(t)}
                style={{
                  cursor: "pointer", padding: 12, textAlign: "left",
                  border: active ? "2px solid var(--primary-2)" : undefined,
                }}
              >
                <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                  {t.wheelColors.map((c, i) => (
                    <span key={i} style={{ width: 18, height: 18, borderRadius: 4, background: c, border: "1px solid rgba(255,255,255,0.2)" }} />
                  ))}
                </div>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  {owned ? (active ? "✓ Active" : "Tap to use") : t.proOnly ? "🌟 Pro" : `${t.cost} 🪙`}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tip jar */}
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>☕ Buy us a coffee</div>
        <div style={{ color: "var(--text-dim)", fontSize: 14, margin: "6px 0 12px" }}>
          We're a tiny team. Tips keep the lights on.
        </div>
        <a className="tw-btn block" href="https://www.buymeacoffee.com" target="_blank" rel="noopener noreferrer">
          Tip ☕
        </a>
      </div>
    </div>
  );
}
