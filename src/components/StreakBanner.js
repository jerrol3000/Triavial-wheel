import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setView } from "../store/uiSlice";
import { sfx } from "../utils/sound";

// Streak FOMO banner. Shows ONLY when:
//   - the player has an existing streak (current_daily_streak > 0)
//   - they have NOT played today's daily yet
//   - the local clock is past the FOMO threshold (default: when their
//     streak has under ~6 hours to live before UTC rolls over)
//
// Without these gates the banner becomes noise. The whole point is
// that it appears LATE in the day when the player is most likely to
// be looking at their phone, knows they "owe" the daily, and the
// clock is ticking. That's the Duolingo loop.
//
// The math: a "streak day" runs midnight-to-midnight UTC. We compute
// the ms until UTC midnight; show the banner when that's under
// FOMO_WINDOW_MS (default 6h). Updates every 30s so the countdown
// stays roughly accurate without burning CPU.

const FOMO_WINDOW_MS = 6 * 60 * 60 * 1000; // last 6 hours before UTC midnight

function msToUtcMidnight() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.getTime() - now.getTime();
}

function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtCountdown(ms) {
  if (ms <= 0) return "0:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function StreakBanner() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);
  const [tick, setTick] = useState(0);

  // Re-render every second so the countdown ticks down smoothly when
  // visible. Cheap — only this small component re-renders.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Guest, no streak, or already played today → don't show.
  if (!user) return null;
  const streak = stats.current_daily_streak || 0;
  if (streak <= 0) return null;
  const playedToday = stats.last_daily_date === todayKey();
  if (playedToday) return null;

  const remaining = msToUtcMidnight();
  if (remaining > FOMO_WINDOW_MS) return null; // too early to nag

  const onPlay = () => {
    sfx.click();
    dispatch(setView("daily"));
  };

  // Severity escalates as the deadline approaches. Last hour gets the
  // alarm-red treatment; >3h is warmer orange.
  const urgent = remaining < 60 * 60 * 1000;
  const bg = urgent
    ? "linear-gradient(135deg, rgba(239,68,68,0.35), rgba(220,38,38,0.35))"
    : "linear-gradient(135deg, rgba(245,158,11,0.35), rgba(234,88,12,0.35))";
  const border = urgent ? "rgba(239,68,68,0.55)" : "rgba(245,158,11,0.55)";

  return (
    <button
      className="tw-card tw-streak-banner"
      onClick={onPlay}
      style={{
        cursor: "pointer",
        background: bg,
        border: `1px solid ${border}`,
        textAlign: "left",
        animation: urgent ? "warnPulse 1.4s ease-in-out infinite" : undefined,
        padding: "10px 14px",
      }}
    >
      <div className="tw-row" style={{ gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 28 }} aria-hidden="true">{urgent ? "🚨" : "🔥"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700 }}>
            Your {streak}-day streak ends in {fmtCountdown(remaining)}
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>
            Play today's daily before the clock rolls over. 90 seconds.
          </div>
        </div>
        <div className="tw-pill" style={{ background: "rgba(255,255,255,0.18)", border: "none", fontWeight: 700, color: "#fff" }}>
          Play →
        </div>
      </div>
    </button>
  );
}
