import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { setView, toggleSound, setModal } from "../store/uiSlice";
import { progressToNext } from "../utils/level";
import { LIVES_MAX_EXPORT, LIVES_REGEN_MS_EXPORT } from "../store/statsSlice";
import { safeNavigate } from "../utils/navigate";
import { useT } from "../i18n";
import Icon from "./Icon";

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

  // Mini timer that shows when the next spin regenerates. Hidden when
  // the player is already above the regen floor (5) or has Pro.
  const livesNext = () => {
    const spins = stats.free_spins || 0;
    if (spins >= LIVES_MAX_EXPORT || stats.pro) return null;
    const since = Date.now() - (stats.free_spins_updated_at || Date.now());
    const left = Math.max(0, LIVES_REGEN_MS_EXPORT - (since % LIVES_REGEN_MS_EXPORT));
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <header className="tw-banner">
      <button
        className={`tw-logo tw-logo-btn ${notHome ? "back" : ""}`}
        onClick={onHomeClick}
        title={notHome ? "Back to home" : "Trivia Wheel — home"}
      >
        {notHome && <span className="tw-logo-back-arrow" aria-hidden="true">←</span>}
        <img src="/logo-no-background.png" alt="" />
        <span>Trivia&nbsp;Wheel</span>
      </button>
      <div className="tw-row tw-banner-stats">
        {/* Single spins pill — no more lives/free-spins dual display. */}
        <span className="tw-pill"
              title={stats.pro ? "Pro — unlimited spins" : `${stats.free_spins || 0} spins · regen up to ${LIVES_MAX_EXPORT}`}
              aria-label={stats.pro ? "Pro: unlimited spins" : `${stats.free_spins || 0} spins`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingLeft: 6 }}>
          <Icon name="free_spin" size={20} />
          <strong>{stats.pro ? "∞" : (stats.free_spins || 0)}</strong>
          {livesNext() && <span className="tw-banner-hide-sm" style={{ marginLeft: 4, color: "var(--text-dim)", fontWeight: 400 }}>{livesNext()}</span>}
        </span>
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
        <button className="tw-pill tw-banner-hide-sm" onClick={() => dispatch(setView("settings"))} title="Settings" style={{ cursor: "pointer", padding: "4px 8px" }}>
          <Icon name="settings" size={20} />
        </button>
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
