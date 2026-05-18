import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { dequeueAchievementUnlock } from "../store/statsSlice";
import { achievementIconUrl } from "../data/cosmeticIcons";
import { ACHIEVEMENT_MAP } from "../data/achievements";
import { sfx } from "../utils/sound";
import { haptic } from "../utils/haptics";

// Lightweight side-slide celebration for achievement unlocks.
// Intentionally smaller and less ceremonial than BadgeUnlock —
// achievements fire more often (per-event) so a full-screen takeover
// would interrupt gameplay flow. This lives in the top-right corner,
// slides in with a spring overshoot, plays a brisk 2-note chime,
// holds for ~3.2s, then slides out.
//
// Multiple unlocks queue (e.g. first_correct + streak_5 on the
// same answer) and play in sequence so each gets its moment.
// Drains from stats.achievementUnlockQueue (FIFO).

const HOLD_MS = 3200;
const SLIDE_MS = 450;

export default function AchievementUnlock() {
  const dispatch = useDispatch();
  const queue = useSelector((s) => s.stats.achievementUnlockQueue || []);
  const currentId = queue[0];
  const current = currentId ? ACHIEVEMENT_MAP[currentId] : null;
  const [dismissing, setDismissing] = useState(false);
  const playedForRef = useRef(null);

  // Play stinger + haptic on first mount per achievement id. Re-
  // renders won't replay.
  useEffect(() => {
    if (!current) { setDismissing(false); playedForRef.current = null; return; }
    if (playedForRef.current === currentId) return;
    playedForRef.current = currentId;
    try { sfx.achieve(); } catch (e) {}
    setTimeout(() => { try { haptic.light(); } catch (e) {} }, 80);
  }, [current, currentId]);

  // Auto-dismiss after hold; user can tap to dismiss early.
  useEffect(() => {
    if (!current || dismissing) return;
    const t = setTimeout(() => setDismissing(true), HOLD_MS);
    return () => clearTimeout(t);
  }, [current, dismissing]);

  // After the slide-out, pop the queue. Next achievement (if any)
  // becomes current and the cycle restarts.
  useEffect(() => {
    if (!dismissing) return;
    const t = setTimeout(() => {
      dispatch(dequeueAchievementUnlock());
      setDismissing(false);
    }, SLIDE_MS);
    return () => clearTimeout(t);
  }, [dismissing, dispatch]);

  if (!current) return null;
  const png = achievementIconUrl(currentId);

  return (
    <div
      className={`tw-au-toast ${dismissing ? "leaving" : ""}`}
      onClick={() => setDismissing(true)}
      role="status"
      aria-live="polite"
      aria-label={`Achievement unlocked: ${current.title}`}
    >
      <style>{`
        .tw-au-toast {
          position: fixed;
          top: calc(64px + env(safe-area-inset-top));
          right: 16px;
          z-index: 150;
          display: flex; align-items: center; gap: 12px;
          padding: 12px 18px 12px 12px;
          max-width: calc(100vw - 32px);
          width: 320px;
          background: linear-gradient(135deg, rgba(124,58,237,0.18), rgba(236,72,153,0.10));
          border: 1px solid rgba(124,58,237,0.55);
          border-radius: 16px;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: 0 14px 40px rgba(0,0,0,0.45), 0 0 32px rgba(124,58,237,0.35);
          cursor: pointer;
          transform: translateX(120%);
          opacity: 0;
          animation: tw-au-slide-in ${SLIDE_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        .tw-au-toast.leaving {
          animation: tw-au-slide-out ${SLIDE_MS}ms cubic-bezier(0.55, 0, 0.65, 0) both;
        }
        @keyframes tw-au-slide-in {
          0%   { transform: translateX(120%); opacity: 0; }
          70%  { transform: translateX(-6%);  opacity: 1; }
          100% { transform: translateX(0);    opacity: 1; }
        }
        @keyframes tw-au-slide-out {
          0%   { transform: translateX(0);    opacity: 1; }
          100% { transform: translateX(120%); opacity: 0; }
        }

        /* Art column — isolation breaks the parent backdrop-filter
           so the PNG alpha renders cleanly (same iOS Safari guard
           we used for badges). */
        .tw-au-art {
          position: relative;
          width: 56px; height: 56px;
          flex-shrink: 0;
          isolation: isolate;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .tw-au-art img {
          width: 100%; height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));
          animation: tw-au-art-in 700ms cubic-bezier(0.34, 1.56, 0.64, 1) 80ms both;
        }
        .tw-au-art-emoji {
          font-size: 38px;
          animation: tw-au-art-in 700ms cubic-bezier(0.34, 1.56, 0.64, 1) 80ms both;
        }
        @keyframes tw-au-art-in {
          0%   { transform: scale(0.4) rotate(-12deg); opacity: 0; }
          60%  { transform: scale(1.18) rotate(6deg);  opacity: 1; }
          100% { transform: scale(1)    rotate(0);     opacity: 1; }
        }

        /* Pulsing radial halo behind the art so the eye knows
           something just happened. Lives in ::before so it
           doesn't take up layout space. */
        .tw-au-art::before {
          content: "";
          position: absolute; inset: -30%;
          background: radial-gradient(circle at center,
            rgba(255,255,255,0.30) 0%,
            rgba(124,58,237,0.20) 35%,
            transparent 70%);
          opacity: 0;
          animation: tw-au-halo 1400ms ease-out 100ms forwards;
          pointer-events: none;
          z-index: -1;
        }
        @keyframes tw-au-halo {
          0%   { opacity: 0;    transform: scale(0.6); }
          40%  { opacity: 1;    transform: scale(1.1); }
          100% { opacity: 0;    transform: scale(1.6); }
        }

        .tw-au-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .tw-au-eyebrow {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: rgba(236, 72, 153, 1);
          text-shadow: 0 0 8px rgba(236, 72, 153, 0.4);
        }
        .tw-au-title {
          font-family: "Fredoka", system-ui, sans-serif;
          font-weight: 700;
          font-size: 17px;
          color: #fff;
          line-height: 1.15;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tw-au-desc {
          font-size: 12px;
          color: rgba(255,255,255,0.78);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        @media (prefers-reduced-motion: reduce) {
          .tw-au-toast {
            animation: tw-au-fade-in 200ms ease both;
          }
          .tw-au-toast.leaving {
            animation: tw-au-fade-out 200ms ease both;
          }
          .tw-au-art img, .tw-au-art-emoji { animation: none; }
          .tw-au-art::before { animation: none; opacity: 0.4; }
        }
        @keyframes tw-au-fade-in  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tw-au-fade-out { from { opacity: 1; } to { opacity: 0; } }

        /* Mobile: hug the right edge, tighten the toast width so
           it doesn't get cropped by safe-area. */
        @media (max-width: 480px) {
          .tw-au-toast {
            right: 10px;
            top: calc(60px + env(safe-area-inset-top));
            width: calc(100vw - 20px);
            max-width: 360px;
            padding: 10px 14px 10px 10px;
          }
          .tw-au-art { width: 50px; height: 50px; }
          .tw-au-title { font-size: 15px; }
          .tw-au-desc { font-size: 11px; }
        }
      `}</style>

      <div className="tw-au-art">
        {png ? (
          <img
            src={png}
            alt={current.title}
            draggable={false}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <span className="tw-au-art-emoji">{current.icon || "🏅"}</span>
        )}
      </div>

      <div className="tw-au-text">
        <span className="tw-au-eyebrow">Achievement Unlocked</span>
        <span className="tw-au-title">{current.title}</span>
        {current.desc && <span className="tw-au-desc">{current.desc}</span>}
      </div>
    </div>
  );
}
