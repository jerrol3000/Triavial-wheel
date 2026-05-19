import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setView } from "../store/uiSlice";
import { sfx } from "../utils/sound";

// Streak FOMO banner. Shows ONLY when:
//   - the player has an existing streak (current_daily_streak > 0)
//   - they have NOT played today's daily yet
//   - the LOCAL clock is past the FOMO threshold (default: under ~6h
//     until the streak day rolls over in the player's timezone)
//
// Timezone fix: this was UTC-based originally. For a player on US
// Pacific time, UTC midnight is 5 PM local — the nag fired from
// noon-5 PM, completely missing the prime evening window. Now we
// compute the deadline in the player's LOCAL timezone, so the nag
// reliably fires when they're actually checking their phone after
// work / school.
//
// Server still keys daily streaks by UTC date (single global truth)
// — but the BANNER is local-clock so it lands in the right evening
// for each player. Worst case: a player who plays right before
// LOCAL midnight but after UTC midnight gets credit for "yesterday"
// from the server's POV; they still see the streak go up the next
// day, just on a slightly different counter. Acceptable trade for
// the engagement lift.

const FOMO_WINDOW_MS = 6 * 60 * 60 * 1000; // last 6 hours before local midnight

function msToLocalMidnight() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}

// Server keys daily streaks by UTC date, so the "did I play today"
// check must match the server's view — not local. Mismatch here
// would show the banner to a player who DID play today (just in a
// different UTC day from local).
function utcTodayKey() {
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
  const playedToday = stats.last_daily_date === utcTodayKey();
  if (playedToday) return null;

  const remaining = msToLocalMidnight();
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
