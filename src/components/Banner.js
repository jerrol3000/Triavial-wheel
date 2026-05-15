import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { setView, toggleSound, setModal } from "../store/uiSlice";
import { progressToNext } from "../utils/level";
import { LIVES_MAX_EXPORT, LIVES_REGEN_MS_EXPORT } from "../store/statsSlice";
import { logout } from "../store/authSlice";

export default function Banner() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);
  const soundOn = useSelector((s) => s.ui.soundOn);
  const view = useSelector((s) => s.ui.view);
  const notHome = view !== "home";

  const { level, xpInLevel, xpForNext, percent } = progressToNext(stats.xp);

  const livesNext = () => {
    if (stats.lives >= LIVES_MAX_EXPORT || stats.pro) return null;
    const since = Date.now() - (stats.lives_updated_at || Date.now());
    const left = Math.max(0, LIVES_REGEN_MS_EXPORT - (since % LIVES_REGEN_MS_EXPORT));
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <header className="tw-banner">
      <button
        className={`tw-logo tw-logo-btn ${notHome ? "back" : ""}`}
        onClick={() => dispatch(setView("home"))}
        title={notHome ? "Back to home" : "Trivia Wheel — home"}
      >
        {notHome && <span className="tw-logo-back-arrow" aria-hidden="true">←</span>}
        <img src="/logo-no-background.png" alt="" />
        <span>Trivia&nbsp;Wheel</span>
      </button>
      <div className="tw-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span className="tw-pill" title="Lives">
          {stats.pro ? "♥ ∞" : `${"♥".repeat(stats.lives)}${"♡".repeat(Math.max(0, LIVES_MAX_EXPORT - stats.lives))}`}
          {livesNext() && <span style={{ marginLeft: 6, color: "var(--text-dim)" }}>{livesNext()}</span>}
        </span>
        {stats.free_spins > 0 && (
          <span className="tw-pill" title="Free spins" style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.4), rgba(236,72,153,0.4))", border: "none", color: "#fff" }}>
            🎡 {stats.free_spins}
          </span>
        )}
        <span className="tw-pill" title="Coins">🪙 {stats.coins}</span>
        <span className="tw-pill" title={`Level ${level} • ${xpInLevel}/${xpForNext} XP`}>
          ⭐ L{level} · {percent}%
        </span>
        {stats.pro && <span className="tw-pill" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "#fff", border: "none" }}>PRO</span>}
        <button className="tw-pill" onClick={() => dispatch(toggleSound())} title="Sound on/off" style={{ cursor: "pointer" }}>
          {soundOn ? "🔊" : "🔇"}
        </button>
        <button className="tw-pill" onClick={() => dispatch(setView("settings"))} title="Settings" style={{ cursor: "pointer" }}>
          ⚙️
        </button>
        {user && user.is_admin && (
          <a className="tw-pill" href="/admin" title="Admin panel" style={{ cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            🛠️ Admin
          </a>
        )}
        {user ? (
          <button className="tw-pill" onClick={() => dispatch(logout())} title="Sign out" style={{ cursor: "pointer" }}>
            👤 {user.username}
          </button>
        ) : (
          <button className="tw-pill" onClick={() => dispatch(setModal("auth"))} style={{ cursor: "pointer" }}>
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
