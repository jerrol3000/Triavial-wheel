import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { setView, toggleSound, setModal, pushToast } from "../store/uiSlice";
import { progressToNext } from "../utils/level";
import { LIVES_MAX_EXPORT, claimSpins } from "../store/statsSlice";
import { safeNavigate } from "../utils/navigate";
import { sfx } from "../utils/sound";
import { useT } from "../i18n";
import Icon from "./Icon";
import NotificationBell from "./NotificationBell";

export default function Banner() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);
  const soundOn = useSelector((s) => s.ui.soundOn);
  const view = useSelector((s) => s.ui.view);
  const notHome = view !== "home";
  const { t } = useT();

  const onHomeClick = () => dispatch(safeNavigate("home"));

  const { level, xpInLevel, xpForNext, percent } = progressToNext(stats.xp);

  // Pending spins ready to claim — drives the pulsing CTA pill. Pro
  // players never see it (their pill stays as the unlimited "∞").
  const pendingClaims = !stats.pro ? (stats.pending_spin_claims || 0) : 0;
  const onClaim = async () => {
    if (pendingClaims <= 0) return;
    sfx.coin();
    const r = await dispatch(claimSpins());
    if (r.meta.requestStatus === "fulfilled") {
      const claimed = r.payload?.claimed || pendingClaims;
      dispatch(pushToast({
        icon: "🎡",
        title: `+${claimed} free spin${claimed === 1 ? "" : "s"} claimed!`,
        text: "Have a good spin — more regen in an hour.",
        duration: 3500,
      }));
    } else {
      const err = r.payload?.error;
      const text = err === "at_floor"
        ? "Your free spins are already topped up."
        : err === "no_claim_ready"
        ? "Not ready yet — check back soon."
        : "Try again in a moment.";
      dispatch(pushToast({ icon: "⏳", title: "No spins to claim", text }));
    }
  };

  return (
    <header className="tw-banner">
      <button
        className={`tw-logo tw-logo-btn ${notHome ? "back" : ""}`}
        onClick={onHomeClick}
        title={notHome ? "Back to home" : "Spinlore — home"}
        aria-label="Spinlore home"
      >
        {notHome && <span className="tw-logo-back-arrow" aria-hidden="true">←</span>}
        {/* The new SPINLORE logo PNG has the wordmark baked in, so the
            separate text span next to it would double up. Logo art
            carries the brand on its own. */}
        <img src="/logo-no-background.png" alt="Spinlore" />
      </button>
      <div className="tw-row tw-banner-stats">
        {/* Spins pill morphs into a pulsing CTA when there are unclaimed
            regen spins. One tap = claim + grant. Hides the badge for Pro
            players (they have unlimited spins, so claiming is meaningless). */}
        {pendingClaims > 0 ? (
          <button
            type="button"
            className="tw-pill tw-claim-pill"
            onClick={onClaim}
            title={`${pendingClaims} free spin${pendingClaims === 1 ? "" : "s"} ready to claim`}
            aria-label={`Claim ${pendingClaims} free spins`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, paddingLeft: 6,
              cursor: "pointer", border: "none",
              background: "linear-gradient(135deg, #f59e0b, #ec4899)",
              color: "#fff", fontWeight: 700,
              boxShadow: "0 0 0 0 rgba(245, 158, 11, 0.6)",
              animation: "twClaimPulse 1.4s ease-in-out infinite",
            }}
          >
            <Icon name="free_spin" size={20} />
            <strong>+{pendingClaims}</strong>
            <span style={{ fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase" }}>Claim</span>
          </button>
        ) : (
          <span className="tw-pill"
                title={stats.pro ? "Pro — unlimited spins" : `${stats.free_spins || 0} spins · regen up to ${LIVES_MAX_EXPORT}`}
                aria-label={stats.pro ? "Pro: unlimited spins" : `${stats.free_spins || 0} spins`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingLeft: 6 }}>
            <Icon name="free_spin" size={20} />
            <strong>{stats.pro ? "∞" : (stats.free_spins || 0)}</strong>
          </span>
        )}
        <span className="tw-pill" title="Coins" style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingLeft: 6 }}>
          <Icon name="coins" size={20} /> {stats.coins}
        </span>
        <span className="tw-pill" title={`Level ${level} • ${xpInLevel}/${xpForNext} XP`}>
          ⭐ L{level}<span className="tw-banner-hide-sm"> · {percent}%</span>
        </span>
        {stats.pro && <span className="tw-pill" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "#fff", border: "none" }}>PRO</span>}
        <button className="tw-pill tw-banner-hide-sm" onClick={() => dispatch(toggleSound())} title="Sound on/off" style={{ cursor: "pointer", padding: "4px 8px" }}>
          {soundOn ? <Icon name="sound" size={20} /> : <span style={{ fontSize: 18 }}>🔇</span>}
        </button>
        {/* Settings stays visible on mobile — was hidden via tw-banner-
            hide-sm and there's no Settings tab in the BottomNav, so phone
            users had NO way to reach the settings page. */}
        <button className="tw-pill" onClick={() => dispatch(setView("settings"))} title="Settings" style={{ cursor: "pointer", padding: "4px 8px" }}>
          <Icon name="settings" size={20} />
        </button>
        {user && <NotificationBell />}
        {user && user.is_admin && (
          <a className="tw-pill tw-banner-hide-sm" href="/admin" title="Admin panel" style={{ cursor: "pointer", textDecoration: "none", color: "inherit", display: "inline-flex", alignItems: "center", gap: 6, paddingLeft: 6 }}>
            <Icon name="admin" size={20} /> Admin
          </a>
        )}
        {!user && (
          <button className="tw-pill" onClick={() => dispatch(setModal("auth"))} style={{ cursor: "pointer" }}>
            {t("common.signin")}
          </button>
        )}
      </div>
    </header>
  );
}
