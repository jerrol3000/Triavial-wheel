import React, { useEffect, useRef, useState, useLayoutEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import Wheel3D from "./Wheel3D";
import { WHEEL_DATA, CATEGORIES, translatedCategories } from "../data/categories";
import { THEMES } from "../data/themes";
import { startRound, fetchRoundQuestions, setMode } from "../store/gameSlice";
import { setView, pushToast, setModal } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import {
  markCategoryPlayed, markAchievement, unlockAchievement,
  useFreeSpin, consumeFreeSpin,
} from "../store/statsSlice";
import Icon from "./Icon";
import { useT } from "../i18n";
import { guestStatus, incrementGuestPlays, GUEST_HARD_LIMIT, GUEST_SOFT_LIMIT } from "../utils/guestLimit";

// WheelView — the trivia-wheel mode, extracted from Home.
//
// Previously the wheel WAS the home screen. That mental model worked
// when the wheel was the only game in town, but Spinlore now has 6+
// distinct modes (Daily, Higher/Lower, Friend Challenges, VS, Season
// Pass, Wheel). Treating one of them as "home" demotes the others to
// secondary citizens. Now Home is a pure mode-grid and the wheel is
// reached via the "🎡 Spin the Wheel" tile, which navigates here.
//
// All the wheel logic moved over intact — onSpin, onWheelStop,
// startWithCategory, the OutOfSpinsCard / GuestLimitCard fallbacks,
// the responsive measure observer, the per-spin state. Nothing about
// the spin flow itself changed; the only change is that this UI now
// lives in its own view.

export default function WheelView() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const mode = useSelector((s) => s.game.mode);
  const user = useSelector((s) => s.auth.user);
  const { t } = useT();
  // Re-render when the local guest-plays counter changes (writes happen
  // inside startWithCategory). Cheap state bump; the actual count is
  // read from localStorage via guestStatus() at render time.
  const [, setGuestTick] = useState(0);
  const bumpGuest = useCallback(() => setGuestTick((n) => n + 1), []);
  const guest = !user ? guestStatus() : null;
  // Wheel labels translate live with language switches.
  const wheelData = React.useMemo(() => translatedCategories(t), [t]);

  const [spinning, setSpinning] = useState(false);
  const [flash, setFlash] = useState(false);
  const wheelRef = useRef(null);
  // Responsive wheel sizing — Wheel3D draws to a fixed-size canvas, so
  // we measure the wrapping div on mount + resize and feed it the
  // actual available width (capped at 460 for desktop).
  const wheelWrapRef = useRef(null);
  const [wheelSize, setWheelSize] = useState(460);
  useLayoutEffect(() => {
    if (!wheelWrapRef.current) return;
    const el = wheelWrapRef.current;
    const measure = () => {
      const w = Math.max(220, Math.min(460, el.clientWidth));
      setWheelSize(w);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    else window.addEventListener("resize", measure);
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", measure);
    };
  }, []);
  // Track the two setTimeouts fired in onWheelStop so we can cancel them
  // if the component unmounts (navigation away) before they fire.
  const flashTimerRef = useRef(null);
  const navTimerRef = useRef(null);
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
    };
  }, []);

  const theme = THEMES[stats.active_theme] || THEMES.classic;

  const startWithCategory = (idx) => {
    const slot = WHEEL_DATA[idx];
    let cat;
    let isMystery = false;
    if (slot.isMystery) {
      isMystery = true;
      // Premium-only categories are gated by Pro status.
      const pool = CATEGORIES.filter((c) => !c.premium || stats.pro);
      cat = pool[Math.floor(Math.random() * pool.length)];
      dispatch(pushToast({ icon: "🎁", title: "MYSTERY!", text: `${cat.option} · 1.5× points`, duration: 2500 }));
    } else {
      cat = CATEGORIES.find((c) => c.id === slot.id) || CATEGORIES[0];
    }
    if (!user) {
      const n = incrementGuestPlays();
      bumpGuest();
      if (n === GUEST_SOFT_LIMIT) {
        dispatch(pushToast({
          icon: "👋",
          title: "Enjoying it?",
          text: `Sign up to keep playing past ${GUEST_HARD_LIMIT} rounds — saves your XP, coins & badges.`,
          duration: 5500,
        }));
      }
    }
    dispatch(markCategoryPlayed(cat.id));
    // all_categories achievement: fires when the player has played every
    // category in the CATEGORIES catalog. Computed against the
    // post-mark set since markCategoryPlayed dedupes internally.
    const playedSet = new Set([...(stats.categories_played || []), cat.id]);
    if (playedSet.size >= CATEGORIES.length) {
      dispatch(markAchievement("all_categories"));
      dispatch(unlockAchievement("all_categories"));
    }
    dispatch(startRound({ categoryId: cat.id, mode, isMystery }));
    dispatch(fetchRoundQuestions({ categoryId: cat.id, mode }));
    dispatch(setView("play"));
  };

  const onSpin = () => {
    if (spinning) return;
    if (!user && guestStatus().blocked) {
      sfx.click();
      dispatch(setModal({ name: "auth", data: { tab: "register", reason: "guest_limit" } }));
      return;
    }
    if (!stats.pro && (stats.free_spins || 0) <= 0) {
      dispatch(setView("shop"));
      return;
    }
    setSpinning(true);
    // Optimistic local decrement so the banner reflects the spend
    // immediately; the server call below is authoritative.
    if (user && !stats.pro) dispatch(consumeFreeSpin());
    if (wheelRef.current) wheelRef.current.spin();
    try { window.dispatchEvent(new Event("triviaspin")); } catch (e) {}
    if (user) dispatch(useFreeSpin());
  };

  const onWheelStop = (winningIdx) => {
    setSpinning(false);
    setFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(false), 280);
    navTimerRef.current = setTimeout(() => startWithCategory(winningIdx), 380);
  };

  return (
    <div className="tw-col">
      <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }} onClick={() => dispatch(setView("home"))}>
        ← Back
      </button>

      <div className="tw-home-hero">
        <h1 style={{ textAlign: "center", margin: "0", fontSize: 28 }}>🎡 The Wheel</h1>
        <p style={{ color: "var(--text-dim)", margin: "4px 0 0", textAlign: "center", fontSize: 13 }}>
          Spin. Land on a category. Answer 10 questions. Get roasted along the way.
        </p>

        <div className="tw-row" style={{ gap: 6, justifyContent: "center" }}>
          {["easy", "medium", "hard"].map((m) => (
            <button
              key={m}
              className="tw-pill"
              onClick={() => { sfx.click(); dispatch(setMode(m)); }}
              title={t(`home.difficulty.${m}`)}
              style={{
                cursor: "pointer",
                background: mode === m ? "linear-gradient(135deg, var(--primary), var(--primary-2))" : undefined,
                border: mode === m ? "none" : undefined,
                color: "#fff",
                textTransform: "capitalize",
              }}
            >{t(`home.difficulty.${m}`)}</button>
          ))}
        </div>

        <div ref={wheelWrapRef} className="tw-wheel-wrap" style={{ position: "relative", maxWidth: 480, width: "100%", margin: "0 auto" }}>
          {flash && <div className="tw-wheel-flash" />}
          <Wheel3D
            ref={wheelRef}
            data={wheelData}
            theme={theme}
            onStop={onWheelStop}
            size={wheelSize}
            fontSize={Math.max(11, Math.round(wheelSize * 0.030))}
          />
        </div>

        {/* Spin gate — same priority order as before:
              1) Guest hit the round cap → register card
              2) Out of spins (non-Pro) → buy/ad card
              3) Otherwise → SPIN button */}
        {(() => {
          if (!user && guest && guest.blocked) return <GuestLimitCard />;
          const spins = stats.free_spins || 0;
          if (!stats.pro && spins <= 0) return <OutOfSpinsCard />;
          return (
            <>
              <button
                className="tw-btn tw-btn-spin block"
                disabled={spinning}
                onClick={onSpin}
                title={spinning ? "Wheel is spinning" : "Spin is free — you only lose a spin on a failed round"}
              >
                {spinning ? "Spinning..." : stats.pro ? "SPIN" : `SPIN · ${spins}`}
              </button>
              {!user && guest && guest.nearLimit && (
                <div className="tw-guest-nudge" style={{
                  marginTop: 8, padding: "8px 12px",
                  background: "rgba(255,180,80,0.12)",
                  border: "1px solid rgba(255,180,80,0.35)",
                  borderRadius: 10, fontSize: 12, color: "var(--text-dim)",
                  textAlign: "center",
                }}>
                  👋 {guest.remaining} round{guest.remaining === 1 ? "" : "s"} left as guest.{" "}
                  <button className="tw-link"
                    onClick={() => dispatch(setModal({ name: "auth", data: { tab: "register", reason: "guest_limit" } }))}>
                    Sign up free
                  </button> to keep playing.
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ── Local helpers (moved over from Home; tightly coupled to the
//    wheel's spin gate and not needed anywhere else).

function GuestLimitCard() {
  const dispatch = useDispatch();
  return (
    <div className="tw-out-of-spins">
      <div className="tw-out-of-spins-title">🎟️ Guest limit reached</div>
      <div className="tw-out-of-spins-sub">
        Create a free account to keep playing — your XP, coins, streaks
        and badges save across devices.
      </div>
      <div className="tw-out-of-spins-actions">
        <button className="tw-btn"
          onClick={() => dispatch(setModal({ name: "auth", data: { tab: "register", reason: "guest_limit" } }))}>
          ✨ Sign up free
        </button>
        <button className="tw-btn ghost"
          onClick={() => dispatch(setModal({ name: "auth", data: { tab: "login", reason: "guest_limit" } }))}>
          🔑 Log in
        </button>
      </div>
    </div>
  );
}

function OutOfSpinsCard() {
  const dispatch = useDispatch();
  return (
    <div className="tw-out-of-spins">
      <div className="tw-out-of-spins-title" style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
        <Icon name="free_spin" size={22} /> Out of spins
      </div>
      <div className="tw-out-of-spins-sub">Pick how you want to keep playing:</div>
      <div className="tw-out-of-spins-actions">
        <button className="tw-btn" onClick={() => dispatch(setModal({ name: "adReward", data: { reward: "free_spin" } }))}>
          📺 Watch ad → +1 spin
        </button>
        <button className="tw-btn" onClick={() => dispatch(setView("shop"))}>
          🛍️ Shop spin packs
        </button>
      </div>
    </div>
  );
}
