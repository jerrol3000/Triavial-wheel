import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { setView, pushToast } from "../store/uiSlice";
import { fetchStats } from "../store/statsSlice";
import { sfx } from "../utils/sound";
import { confirmDialog } from "../utils/confirm";

// Season Pass UI.
//
// Layout:
//   Header card: season name, current XP / next tier XP, premium status.
//   For each tier:
//     ┌────────────────────────────────────────────────────────────┐
//     │ Tier N      FREE: <reward>     [Claim]                     │
//     │             PREM: <reward>     [Claim / Locked / Buy]      │
//     └────────────────────────────────────────────────────────────┘
//   A "Buy premium for 500 coins" CTA card at the top if not premium.
//
// Claim buttons reflect 4 states:
//   - LOCKED (gray): tier > unlocked → "Locked"
//   - AVAILABLE: tier <= unlocked AND not claimed → "Claim"
//   - CLAIMED: bit set in claimed_mask → "✓ Claimed"
//   - PREMIUM_LOCKED: premium reward at an unlocked tier without premium → "🔒 Premium"
//
// The whole pass loads in one /season/current request and refreshes
// after every claim so the UI stays consistent without polling.

function rewardLine(reward, label) {
  if (!reward) return null;
  if (label) return label;
  // Fallback labels in case the server doesn't ship a friendly string.
  if (reward.type === "coins") return `+${reward.amount} coins`;
  if (reward.type === "spins") return `+${reward.amount} free spins`;
  if (reward.type === "powerup") return `+${reward.amount}× ${reward.id}`;
  if (reward.type === "cosmetic") return `Unlock ${reward.id}`;
  return JSON.stringify(reward);
}

function rewardIcon(reward) {
  if (!reward) return "·";
  if (reward.type === "coins") return "🪙";
  if (reward.type === "spins") return "🎡";
  if (reward.type === "powerup") return "⚡";
  if (reward.type === "cosmetic") {
    if (String(reward.id).startsWith("frame")) return "🖼️";
    if (String(reward.id).startsWith("pointer")) return "🎯";
    if (String(reward.id).startsWith("celebration")) return "🎉";
    if (String(reward.id).startsWith("title")) return "🏷️";
    return "🎁";
  }
  return "🎁";
}

export default function SeasonPass() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const coins = useSelector((s) => s.stats.coins);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/season/current");
      setData(r.data);
    } catch (e) {
      setData(null);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const onClaim = async (tier, track) => {
    if (busy) return;
    setBusy(true);
    sfx.coin();
    try {
      const r = await api.post("/season/claim", { tier, track });
      if (r.data.already_claimed) {
        dispatch(pushToast({ icon: "✓", title: "Already claimed" }));
      } else if (r.data.reward) {
        const label = r.data.reward.type === "cosmetic" ? "Cosmetic unlocked" : "Reward claimed!";
        dispatch(pushToast({ icon: "🎁", title: label, text: rewardLine(r.data.reward, null) }));
        dispatch(fetchStats()); // coins/spins/powerups may have changed
      }
      if (r.data.progress) setData(r.data.progress);
    } catch (e) {
      const err = e?.response?.data?.error;
      dispatch(pushToast({
        icon: "⚠️",
        title: "Couldn't claim",
        text: err === "tier_locked" ? "Tier not unlocked yet — keep playing." :
              err === "premium_locked" ? "Unlock premium first." :
              err === "no_reward_at_tier" ? "Nothing here on this track." :
              "Try again.",
      }));
    }
    setBusy(false);
  };

  const onBuyPremium = async () => {
    if (busy || !data) return;
    const cost = data.season.premium_price_coins;
    if (!(await confirmDialog(dispatch, {
      icon: "⭐",
      title: `Unlock Premium for ${cost} coins?`,
      message: "Unlocks every reward on the premium track for this season + retroactively unlocks rewards on tiers you've already passed.",
      confirmText: "Unlock",
      cancelText: "Not now",
    }))) return;
    setBusy(true);
    sfx.coin();
    try {
      const r = await api.post("/season/buy-premium");
      if (r.data.already_premium) {
        dispatch(pushToast({ icon: "✓", title: "Already premium" }));
      } else if (r.data.ok) {
        dispatch(pushToast({ icon: "⭐", title: "Premium unlocked!", text: `−${r.data.paid} coins` }));
        dispatch(fetchStats());
      }
      if (r.data.progress) setData(r.data.progress);
    } catch (e) {
      const err = e?.response?.data?.error;
      dispatch(pushToast({
        icon: "⚠️",
        title: "Couldn't unlock",
        text: err === "insufficient_funds" ? `Need ${cost} coins — earn or buy more.` : "Try again.",
      }));
    }
    setBusy(false);
  };

  if (!user) {
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "Fredoka", marginBottom: 8 }}>Season Pass</div>
        <div style={{ color: "var(--text-dim)", marginBottom: 12 }}>Sign in to track your season progress and claim rewards.</div>
        <button className="tw-btn block" onClick={() => dispatch({ type: "ui/setModal", payload: "auth" })}>Sign in</button>
      </div>
    );
  }
  if (loading) {
    return <div className="tw-card" style={{ textAlign: "center", padding: 30 }}><div className="tw-spinner" style={{ margin: "0 auto" }} /></div>;
  }
  if (!data) {
    return <div className="tw-card" style={{ textAlign: "center" }}>No active season right now. Check back soon.</div>;
  }

  const { season, user: prog } = data;
  const xpInTier = prog.xp - prog.tier * season.xp_per_tier;
  const pct = Math.min(100, (prog.xp / (season.tiers.length * season.xp_per_tier)) * 100);

  return (
    <div className="tw-col">
      <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }} onClick={() => dispatch(setView("home"))}>← Back</button>

      <div className="tw-card" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(236,72,153,0.18))", border: "1px solid rgba(236,72,153,0.4)" }}>
        <div className="tw-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700 }}>⭐ {season.name}</div>
            <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
              Tier {prog.tier} / {season.tiers.length} · {prog.xp} XP total
            </div>
          </div>
          {prog.premium ? (
            <span className="tw-pill" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "#fff", border: "none", fontWeight: 700 }}>⭐ PREMIUM</span>
          ) : null}
        </div>
        {/* Progress bar to the next tier. */}
        <div style={{ marginTop: 12, height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #22d3ee, #ec4899)", transition: "width 0.4s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6, textAlign: "right" }}>
          {prog.tier < season.tiers.length
            ? `${xpInTier}/${season.xp_per_tier} XP to tier ${prog.tier + 1}`
            : "🏆 Season complete!"}
        </div>
      </div>

      {!prog.premium && (
        <button className="tw-card" onClick={onBuyPremium} disabled={busy}
                style={{ cursor: "pointer", textAlign: "left", background: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(239,68,68,0.18))", border: "1px solid rgba(245,158,11,0.45)" }}>
          <div className="tw-row" style={{ gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 28 }}>⭐</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 15 }}>Unlock Premium Track</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                {season.tiers.filter((t) => t.premium).length} extra rewards · retroactive for tiers you've passed
              </div>
            </div>
            <div className="tw-pill" style={{ fontWeight: 700, background: "rgba(255,255,255,0.18)", border: "none", color: "#fff" }}>
              🪙 {season.premium_price_coins}
            </div>
          </div>
        </button>
      )}

      {/* Tier ladder. Each row is one tier with both tracks side-by-side
          on desktop, stacked on mobile. */}
      {season.tiers.map((t, i) => {
        const unlocked = i <= prog.tier;
        const freeBit  = 1 << (i * 2);
        const premBit  = 1 << (i * 2 + 1);
        const freeClaimed = (prog.claimed_mask & freeBit) !== 0;
        const premClaimed = (prog.claimed_mask & premBit) !== 0;
        return (
          <div key={i} className="tw-card" style={{
            border: unlocked ? "1px solid rgba(34,211,238,0.4)" : "1px solid rgba(255,255,255,0.06)",
            opacity: unlocked ? 1 : 0.65,
            padding: 12,
          }}>
            <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <strong style={{ fontFamily: "Fredoka", fontSize: 14 }}>Tier {i}</strong>
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {i * season.xp_per_tier} XP
              </span>
            </div>

            {/* Free track row */}
            <div className="tw-row" style={{ gap: 10, alignItems: "center", marginBottom: t.premium ? 8 : 0 }}>
              <span style={{ fontSize: 11, color: "var(--text-dim)", minWidth: 56 }}>FREE</span>
              <span style={{ fontSize: 18 }}>{rewardIcon(t.free)}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{rewardLine(t.free, t.free_label) || <span style={{ color: "var(--text-dim)" }}>—</span>}</span>
              {t.free && (
                freeClaimed ? <span className="tw-pill" style={{ background: "rgba(16,185,129,0.2)", border: "none", color: "var(--good)", fontSize: 11 }}>✓ Claimed</span>
                : unlocked ? <button className="tw-pill" style={{ cursor: "pointer", fontWeight: 700 }} onClick={() => onClaim(i, "free")} disabled={busy}>Claim</button>
                : <span className="tw-pill" style={{ fontSize: 11, color: "var(--text-dim)" }}>🔒</span>
              )}
            </div>

            {/* Premium track row */}
            {t.premium && (
              <div className="tw-row" style={{ gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#f59e0b", minWidth: 56, fontWeight: 700 }}>⭐ PREM</span>
                <span style={{ fontSize: 18 }}>{rewardIcon(t.premium)}</span>
                <span style={{ flex: 1, fontSize: 13 }}>{rewardLine(t.premium, t.premium_label)}</span>
                {premClaimed ? <span className="tw-pill" style={{ background: "rgba(16,185,129,0.2)", border: "none", color: "var(--good)", fontSize: 11 }}>✓ Claimed</span>
                : !prog.premium ? <span className="tw-pill" style={{ fontSize: 11, color: "var(--text-dim)" }}>🔒 Premium</span>
                : unlocked ? <button className="tw-pill" style={{ cursor: "pointer", fontWeight: 700, background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "#fff", border: "none" }} onClick={() => onClaim(i, "premium")} disabled={busy}>Claim</button>
                : <span className="tw-pill" style={{ fontSize: 11, color: "var(--text-dim)" }}>🔒</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
