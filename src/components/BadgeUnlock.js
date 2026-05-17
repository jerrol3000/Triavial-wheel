import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { dequeueBadgeUnlock } from "../store/badgesSlice";
import { badgePngUrl, BADGE_UNLOCK_BURST } from "../data/cosmeticIcons";
import { playBadgeUnlock } from "../utils/sound";
import { haptic } from "../utils/haptics";

// Full-screen celebration for a newly-earned badge. One badge at a
// time; if multiple were awarded in the same response (e.g. you hit
// streak_5 AND skill_correct_100 on the same answer) the next one
// plays after the current finishes, drained from a Redux queue in
// FIFO order.
//
// Showtime breakdown (total ~3.8s):
//   0.00s  Backdrop fades in, badge enters with spring overshoot
//   0.00s  Tier stinger plays (per playBadgeUnlock(tier))
//   0.10s  Haptic pulse (mobile only)
//   0.20s  Burst overlay blooms behind the badge + sparkle particles
//   0.60s  "Achievement Unlocked" header settles
//   1.00s  Badge name + description fade in
//   3.20s  Auto-dismiss fade-out
//   3.80s  Component pops next badge from queue (or unmounts)
//
// User can tap anywhere to dismiss early. Esc also dismisses.

const HOLD_MS = 3200;
const FADE_MS = 600;

const TIER_GRADIENTS = {
  bronze:    "linear-gradient(135deg, #b8722a, #cd7f32 50%, #8b5a1a)",
  silver:    "linear-gradient(135deg, #a1a1a1, #e2e2e2 50%, #757575)",
  gold:      "linear-gradient(135deg, #d97706, #fbbf24 50%, #b45309)",
  legendary: "linear-gradient(135deg, #f59e0b, #ec4899 33%, #7c3aed 66%, #06b6d4)",
};
const TIER_GLOW = {
  bronze:    "rgba(205, 127, 50, 0.65)",
  silver:    "rgba(220, 220, 220, 0.55)",
  gold:      "rgba(245, 158, 11, 0.70)",
  legendary: "rgba(236, 72, 153, 0.75)",
};
const TIER_HEADER = {
  bronze:    "Achievement Unlocked",
  silver:    "Achievement Unlocked",
  gold:      "Major Achievement!",
  legendary: "LEGENDARY UNLOCK!",
};

export default function BadgeUnlock() {
  const dispatch = useDispatch();
  // The queue is a FIFO of {badge_id, name, description, icon, tier}
  // objects pushed by the badges slice when new_badges arrives.
  const current = useSelector((s) => s.badges.unlockQueue && s.badges.unlockQueue[0]);
  const [dismissing, setDismissing] = useState(false);
  const playedForRef = useRef(null);

  // Play stinger + haptic on mount. Tracked per badge_id so a re-
  // render (e.g. parent React re-mount) doesn't replay the audio.
  useEffect(() => {
    if (!current) { setDismissing(false); playedForRef.current = null; return; }
    if (playedForRef.current === current.badge_id) return;
    playedForRef.current = current.badge_id;
    playBadgeUnlock(current.tier);
    setTimeout(() => { try { haptic.medium(); } catch (e) {} }, 100);
  }, [current]);

  // Auto-dismiss timer. Cleared if the user taps to dismiss early.
  useEffect(() => {
    if (!current || dismissing) return;
    const hold = setTimeout(() => setDismissing(true), HOLD_MS);
    return () => clearTimeout(hold);
  }, [current, dismissing]);

  // After the fade-out animation, pop this badge off the queue. The
  // next one (if any) becomes `current` and the cycle starts over.
  useEffect(() => {
    if (!dismissing) return;
    const drain = setTimeout(() => {
      dispatch(dequeueBadgeUnlock());
      setDismissing(false);
    }, FADE_MS);
    return () => clearTimeout(drain);
  }, [dismissing, dispatch]);

  // Esc / click anywhere dismisses early.
  useEffect(() => {
    if (!current) return;
    const onKey = (e) => { if (e.key === "Escape") setDismissing(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  if (!current) return null;
  const tier = current.tier || "bronze";
  const png = badgePngUrl(current.badge_id);
  const glow = TIER_GLOW[tier] || TIER_GLOW.bronze;
  const gradient = TIER_GRADIENTS[tier] || TIER_GRADIENTS.bronze;
  const header = TIER_HEADER[tier] || TIER_HEADER.bronze;

  return (
    <div
      onClick={() => setDismissing(true)}
      className={`tw-badge-unlock ${dismissing ? "leaving" : ""}`}
      role="dialog"
      aria-live="polite"
      aria-label={`${header}: ${current.name}`}
    >
      <style>{`
        .tw-badge-unlock {
          position: fixed; inset: 0; z-index: 200;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          background: radial-gradient(ellipse at center, rgba(0,0,0,0.72), rgba(0,0,0,0.92));
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: tw-bu-back-in ${FADE_MS}ms ease both;
          cursor: pointer;
        }
        .tw-badge-unlock.leaving { animation: tw-bu-back-out ${FADE_MS}ms ease both; }
        @keyframes tw-bu-back-in  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tw-bu-back-out { from { opacity: 1; } to { opacity: 0; } }

        .tw-bu-stage {
          position: relative;
          display: flex; flex-direction: column; align-items: center;
          gap: 18px;
          text-align: center;
          max-width: 480px;
          width: 100%;
        }
        .tw-bu-header {
          font-family: "Fredoka", system-ui, sans-serif;
          font-weight: 800;
          font-size: clamp(16px, 4vw, 22px);
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #fff;
          opacity: 0;
          animation: tw-bu-fade 700ms ease 600ms forwards;
          text-shadow: 0 2px 14px rgba(0,0,0,0.5);
        }
        .tw-bu-header-bar {
          display: inline-block;
          padding: 6px 18px;
          border-radius: 999px;
          background: ${gradient};
          box-shadow: 0 0 32px ${glow};
        }
        .tw-bu-badge-wrap {
          position: relative;
          width: clamp(180px, 50vw, 280px);
          height: clamp(180px, 50vw, 280px);
          display: flex; align-items: center; justify-content: center;
          filter: drop-shadow(0 0 36px ${glow});
        }
        .tw-bu-burst {
          position: absolute;
          inset: -22%;
          background: url("${BADGE_UNLOCK_BURST}") center/contain no-repeat;
          opacity: 0;
          transform: scale(0.4) rotate(0deg);
          animation:
            tw-bu-burst-in 1100ms cubic-bezier(0.22, 1, 0.36, 1) 200ms both,
            tw-bu-spin 18s linear 200ms infinite;
          pointer-events: none;
        }
        @keyframes tw-bu-burst-in {
          0%   { opacity: 0; transform: scale(0.4) rotate(0deg); }
          50%  { opacity: 0.95; transform: scale(1.05) rotate(8deg); }
          100% { opacity: 0.75; transform: scale(1) rotate(0deg); }
        }
        @keyframes tw-bu-spin { to { transform: rotate(360deg); } }
        .tw-bu-badge {
          width: 80%;
          height: 80%;
          object-fit: contain;
          z-index: 2;
          transform: scale(0.3) rotate(-22deg);
          opacity: 0;
          animation: tw-bu-pop 900ms cubic-bezier(0.34, 1.56, 0.64, 1) 50ms both;
          filter: drop-shadow(0 8px 20px rgba(0,0,0,0.45));
        }
        @keyframes tw-bu-pop {
          0%   { transform: scale(0.3) rotate(-22deg); opacity: 0; }
          55%  { transform: scale(1.18) rotate(8deg);  opacity: 1; }
          78%  { transform: scale(0.96) rotate(-3deg); }
          100% { transform: scale(1)    rotate(0);     opacity: 1; }
        }
        .tw-bu-tier {
          font-size: 12px;
          letter-spacing: 3px;
          text-transform: uppercase;
          font-weight: 800;
          padding: 4px 14px;
          border-radius: 6px;
          color: #1a0d00;
          background: ${gradient};
          box-shadow: 0 0 14px ${glow};
          opacity: 0;
          animation: tw-bu-fade 700ms ease 900ms forwards;
        }
        .tw-bu-name {
          font-family: "Fredoka", system-ui, sans-serif;
          font-weight: 700;
          font-size: clamp(22px, 6vw, 34px);
          color: #fff;
          margin: 0;
          opacity: 0;
          animation: tw-bu-fade 700ms ease 1000ms forwards;
          text-shadow: 0 2px 16px rgba(0,0,0,0.6);
        }
        .tw-bu-desc {
          font-size: clamp(13px, 3.5vw, 15px);
          color: rgba(255,255,255,0.82);
          margin: 0;
          opacity: 0;
          animation: tw-bu-fade 700ms ease 1150ms forwards;
          max-width: 380px;
        }
        .tw-bu-hint {
          margin-top: 6px;
          font-size: 11px;
          color: rgba(255,255,255,0.5);
          letter-spacing: 1px;
          text-transform: uppercase;
          opacity: 0;
          animation: tw-bu-fade 700ms ease 1800ms forwards;
        }
        @keyframes tw-bu-fade { to { opacity: 1; } }

        /* Decorative sparkle particles falling around the badge.
           Pure CSS — six small dots animating with staggered delays.
           Pointer-events:none so they don't intercept the dismiss tap. */
        .tw-bu-spark {
          position: absolute;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 0 14px #fff, 0 0 28px ${glow};
          pointer-events: none;
          opacity: 0;
          animation: tw-bu-spark 1800ms ease-out infinite;
        }
        @keyframes tw-bu-spark {
          0%   { opacity: 0; transform: translate(0, -20%) scale(0.5); }
          20%  { opacity: 1; }
          100% { opacity: 0; transform: translate(var(--dx), 140%) scale(1.1); }
        }

        @media (prefers-reduced-motion: reduce) {
          .tw-bu-burst { animation: tw-bu-burst-in 700ms ease 100ms both; }
          .tw-bu-badge { animation: tw-bu-fade 500ms ease both; transform: none; }
          .tw-bu-spark { display: none; }
        }
      `}</style>

      <div className="tw-bu-stage" onClick={(e) => e.stopPropagation()}>
        <div className="tw-bu-header">
          <span className="tw-bu-header-bar">{header}</span>
        </div>

        <div className="tw-bu-badge-wrap">
          <span className="tw-bu-burst" aria-hidden="true" />
          {png ? (
            <img
              className="tw-bu-badge"
              src={png}
              alt={current.name}
              draggable={false}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : (
            <div className="tw-bu-badge" style={{ fontSize: "clamp(100px, 26vw, 180px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {current.icon || "🏅"}
            </div>
          )}
          {/* Six staggered sparkles */}
          {[
            { left: "10%", "--dx": "20px" },
            { left: "85%", "--dx": "-30px" },
            { left: "25%", "--dx": "-15px" },
            { left: "70%", "--dx": "25px" },
            { left: "50%", "--dx": "0px" },
            { left: "92%", "--dx": "10px" },
          ].map((s, i) => (
            <span key={i} className="tw-bu-spark" style={{ ...s, animationDelay: `${i * 220}ms`, top: 0 }} aria-hidden="true" />
          ))}
        </div>

        <span className="tw-bu-tier">{tier}</span>
        <h2 className="tw-bu-name">{current.name}</h2>
        {current.description && (
          <p className="tw-bu-desc">{current.description}</p>
        )}
        <div className="tw-bu-hint">Tap anywhere to dismiss</div>
      </div>
    </div>
  );
}
