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
// Showtime breakdown (total ~5.6s):
//   0.00s  Backdrop fades in; tier stinger + haptic fire
//   0.05s  Badge enters with spring overshoot
//   0.20s  Burst overlay starts a slow, feathered spread across the
//          screen (continues for the whole show — rotating + scaling
//          + softening at the edges via radial mask gradient)
//   0.30s  Badge starts spinning on its Y axis (coin-flip style)
//          — same PNG on both faces via backface mirroring, so
//          there's no "back is blank" frame
//   0.60s  "Achievement Unlocked" header settles
//   1.00s  Badge name + description fade in
//   4.80s  Auto-dismiss fade-out
//   5.55s  Component pops next badge from queue (or unmounts)
//
// User can tap anywhere to dismiss early. Esc also dismisses.

const HOLD_MS = 4800;
const FADE_MS = 750;

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
          background: radial-gradient(ellipse at center, rgba(0,0,0,0.72), rgba(0,0,0,0.94));
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: tw-bu-back-in ${FADE_MS}ms ease both;
          cursor: pointer;
          overflow: hidden;
        }
        .tw-badge-unlock.leaving { animation: tw-bu-back-out ${FADE_MS}ms ease both; }
        @keyframes tw-bu-back-in  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tw-bu-back-out { from { opacity: 1; } to { opacity: 0; } }

        /* Burst overlay — full-viewport scrim that bursts open from
           the badge and slowly spreads outward while rotating.
           Feathered via a radial mask so the rays fade to
           transparency at the edges instead of hard-cropping into
           a square. Stays under the badge (.tw-bu-stage z-index
           higher). */
        .tw-bu-burst {
          position: absolute;
          left: 50%; top: 50%;
          width: min(120vmin, 1100px);
          height: min(120vmin, 1100px);
          margin-left: calc(-1 * min(60vmin, 550px));
          margin-top:  calc(-1 * min(60vmin, 550px));
          background: url("${BADGE_UNLOCK_BURST}") center/contain no-repeat;
          /* Soft radial feather — opaque core, fades to transparent
             over the outer 50% of the radius so the rays bleed into
             the backdrop instead of hard-edging. */
          -webkit-mask-image: radial-gradient(circle at center,
            rgba(0,0,0,1) 0%,
            rgba(0,0,0,0.92) 28%,
            rgba(0,0,0,0.55) 55%,
            rgba(0,0,0,0.15) 78%,
            rgba(0,0,0,0) 92%);
                  mask-image: radial-gradient(circle at center,
            rgba(0,0,0,1) 0%,
            rgba(0,0,0,0.92) 28%,
            rgba(0,0,0,0.55) 55%,
            rgba(0,0,0,0.15) 78%,
            rgba(0,0,0,0) 92%);
          opacity: 0;
          transform: translate(0,0) scale(0.3) rotate(0deg);
          animation:
            tw-bu-burst-in  1500ms cubic-bezier(0.18, 0.9, 0.32, 1.05) 150ms both,
            tw-bu-burst-spin 22s linear 150ms infinite,
            tw-bu-burst-breathe 4s ease-in-out 1700ms infinite;
          pointer-events: none;
          z-index: 1;
        }
        @keyframes tw-bu-burst-in {
          0%   { opacity: 0;    transform: scale(0.30) rotate(-10deg); }
          22%  { opacity: 0.95; transform: scale(0.85) rotate(2deg); }
          60%  { opacity: 0.85; transform: scale(1.05) rotate(8deg); }
          100% { opacity: 0.80; transform: scale(1.00) rotate(0deg); }
        }
        @keyframes tw-bu-burst-spin { to { transform: rotate(360deg); } }
        /* Subtle breathing scale layered on top of the spin so the
           burst feels alive. Modifies the same transform via
           animation composition — kept tiny so the spin reads first. */
        @keyframes tw-bu-burst-breathe {
          0%, 100% { filter: brightness(1)   saturate(1); }
          50%      { filter: brightness(1.2) saturate(1.15); }
        }

        /* Stage sits on top of the burst — z-index 2 so the badge
           reads cleanly against the rays. */
        .tw-bu-stage {
          position: relative;
          z-index: 2;
          display: flex; flex-direction: column; align-items: center;
          gap: 22px;
          text-align: center;
          max-width: 540px;
          width: 100%;
        }
        .tw-bu-header {
          font-family: "Fredoka", system-ui, sans-serif;
          font-weight: 800;
          font-size: clamp(16px, 4vw, 24px);
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #fff;
          opacity: 0;
          animation: tw-bu-fade 700ms ease 600ms forwards;
          text-shadow: 0 2px 14px rgba(0,0,0,0.5);
        }
        .tw-bu-header-bar {
          display: inline-block;
          padding: 7px 22px;
          border-radius: 999px;
          background: ${gradient};
          box-shadow: 0 0 36px ${glow};
        }

        /* Badge stage — bigger, with 3D perspective so the coin flip
           reads as actual rotation. */
        .tw-bu-badge-wrap {
          position: relative;
          width: clamp(220px, 60vmin, 380px);
          height: clamp(220px, 60vmin, 380px);
          display: flex; align-items: center; justify-content: center;
          perspective: 1200px;
          filter: drop-shadow(0 0 48px ${glow});
        }
        /* The "coin" — uses preserve-3d so the two faces sit in
           opposite halves of the 3D space. Continuous Y-axis
           rotation gives the medal-spinning-on-its-edge effect.
           Same PNG on front + back so there's no blank frame and
           the badge looks identical from every angle. */
        .tw-bu-coin {
          position: relative;
          width: 100%; height: 100%;
          transform-style: preserve-3d;
          transform: scale(0.3) rotateY(-90deg);
          opacity: 0;
          animation:
            tw-bu-coin-in   1100ms cubic-bezier(0.34, 1.56, 0.64, 1) 250ms both,
            tw-bu-coin-spin 4.5s linear 1200ms infinite;
        }
        @keyframes tw-bu-coin-in {
          0%   { transform: scale(0.30) rotateY(-180deg); opacity: 0; }
          45%  { transform: scale(1.15) rotateY(20deg);   opacity: 1; }
          78%  { transform: scale(0.95) rotateY(-6deg); }
          100% { transform: scale(1)    rotateY(0deg);    opacity: 1; }
        }
        @keyframes tw-bu-coin-spin {
          0%   { transform: scale(1) rotateY(0deg); }
          100% { transform: scale(1) rotateY(360deg); }
        }
        /* Both coin faces: same image stacked at the same depth, the
           back rotated 180° so it's visible from the reverse side.
           backface-visibility:hidden ensures each face is only drawn
           when its normal points at the camera — no double image. */
        .tw-bu-face {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .tw-bu-face.back { transform: rotateY(180deg); }
        .tw-bu-face img,
        .tw-bu-face .tw-bu-badge-fallback {
          width: 88%; height: 88%;
          object-fit: contain;
          filter: drop-shadow(0 10px 22px rgba(0,0,0,0.55));
        }
        .tw-bu-badge-fallback {
          font-size: clamp(120px, 30vw, 200px);
          display: flex; align-items: center; justify-content: center;
        }

        .tw-bu-tier {
          font-size: 12px;
          letter-spacing: 3px;
          text-transform: uppercase;
          font-weight: 800;
          padding: 5px 16px;
          border-radius: 6px;
          color: #1a0d00;
          background: ${gradient};
          box-shadow: 0 0 14px ${glow};
          opacity: 0;
          animation: tw-bu-fade 700ms ease 1000ms forwards;
        }
        .tw-bu-name {
          font-family: "Fredoka", system-ui, sans-serif;
          font-weight: 700;
          font-size: clamp(24px, 6.5vw, 38px);
          color: #fff;
          margin: 0;
          opacity: 0;
          animation: tw-bu-fade 700ms ease 1100ms forwards;
          text-shadow: 0 2px 16px rgba(0,0,0,0.6);
        }
        .tw-bu-desc {
          font-size: clamp(13px, 3.5vw, 16px);
          color: rgba(255,255,255,0.85);
          margin: 0;
          opacity: 0;
          animation: tw-bu-fade 700ms ease 1250ms forwards;
          max-width: 420px;
          line-height: 1.4;
        }
        .tw-bu-hint {
          margin-top: 8px;
          font-size: 11px;
          color: rgba(255,255,255,0.45);
          letter-spacing: 1.5px;
          text-transform: uppercase;
          opacity: 0;
          animation: tw-bu-fade 700ms ease 2200ms forwards;
        }
        @keyframes tw-bu-fade { to { opacity: 1; } }

        /* Decorative sparkle particles falling around the badge.
           Eight dots now (was six), spread wider, with bigger glow
           halos so they read against the bigger backdrop. */
        .tw-bu-spark {
          position: absolute;
          width: 10px; height: 10px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 0 16px #fff, 0 0 32px ${glow};
          pointer-events: none;
          opacity: 0;
          animation: tw-bu-spark 2200ms ease-out infinite;
        }
        @keyframes tw-bu-spark {
          0%   { opacity: 0; transform: translate(0, -10%) scale(0.5); }
          20%  { opacity: 1; }
          100% { opacity: 0; transform: translate(var(--dx), 160%) scale(1.2); }
        }

        @media (prefers-reduced-motion: reduce) {
          .tw-bu-burst { animation: tw-bu-burst-in 700ms ease 100ms both; }
          .tw-bu-coin  { animation: tw-bu-fade 500ms ease both; transform: none; }
          .tw-bu-spark { display: none; }
        }
      `}</style>

      {/* Burst sits BEHIND the stage at full viewport scale */}
      <span className="tw-bu-burst" aria-hidden="true" />

      <div className="tw-bu-stage" onClick={(e) => e.stopPropagation()}>
        <div className="tw-bu-header">
          <span className="tw-bu-header-bar">{header}</span>
        </div>

        <div className="tw-bu-badge-wrap">
          {/* 3D coin — preserve-3d wrapper rotates on Y axis, two
              faces with the same PNG so it looks identical from
              every angle (no "blank back" frame). */}
          <div className="tw-bu-coin">
            {[false, true].map((isBack) => (
              <div key={isBack ? "back" : "front"} className={`tw-bu-face ${isBack ? "back" : ""}`}>
                {png ? (
                  <img
                    src={png}
                    alt={isBack ? "" : current.name}
                    draggable={false}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                ) : (
                  <span className="tw-bu-badge-fallback">{current.icon || "🏅"}</span>
                )}
              </div>
            ))}
          </div>
          {/* Eight staggered sparkles spread wider around the badge */}
          {[
            { left: "5%",  "--dx": "30px" },
            { left: "92%", "--dx": "-40px" },
            { left: "18%", "--dx": "-20px" },
            { left: "78%", "--dx": "35px" },
            { left: "42%", "--dx": "-10px" },
            { left: "58%", "--dx": "15px" },
            { left: "30%", "--dx": "45px" },
            { left: "70%", "--dx": "-25px" },
          ].map((s, i) => (
            <span key={i} className="tw-bu-spark" style={{ ...s, animationDelay: `${i * 240}ms`, top: 0 }} aria-hidden="true" />
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
