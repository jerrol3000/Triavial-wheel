import React, { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import Wheel3D from "./Wheel3D";
import { WHEEL_DATA, CATEGORIES } from "../data/categories";
import { THEMES } from "../data/themes";
import { startRound, fetchRoundQuestions, setMode } from "../store/gameSlice";
import { setView, pushToast, setModal } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import { fetchDailyMeta } from "../store/dailySlice";
import { markCategoryPlayed, markAchievement, unlockAchievement, useFreeSpin } from "../store/statsSlice";
import QuestsHub from "./QuestsHub";
import GuestWelcome from "./GuestWelcome";
import LiveLeaderboard from "./LiveLeaderboard";
import Icon from "./Icon";
import { useT } from "../i18n";
import { translatedCategories } from "../data/categories";
import { guestStatus, incrementGuestPlays, GUEST_HARD_LIMIT, GUEST_SOFT_LIMIT } from "../utils/guestLimit";

// The wheel's actual duration is set by `spinDuration` below (a multiplier on
// react-custom-roulette's internal default). The tick schedule is self-pacing,
// so it stays in sync regardless of what spinDuration evaluates to.

export default function Home() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const daily = useSelector((s) => s.daily);
  const mode = useSelector((s) => s.game.mode);
  const user = useSelector((s) => s.auth.user);
  const { t } = useT();
  // Re-render when the local guest-plays counter changes (storage write
  // happens inside startWithCategory). Cheap state bump; the actual count
  // is read from localStorage via guestStatus() at render time.
  const [, setGuestTick] = React.useState(0);
  const bumpGuest = React.useCallback(() => setGuestTick((n) => n + 1), []);
  const guest = !user ? guestStatus() : null;
  // Wheel labels translate live with language switches.
  const wheelData = React.useMemo(() => translatedCategories(t), [t]);

  const [spinning, setSpinning] = React.useState(false);
  const [flash, setFlash] = React.useState(false);
  const wheelRef = useRef(null);
  // Responsive wheel sizing — Wheel3D draws to a fixed-size canvas, so
  // we measure the wrapping div on mount + resize and feed it the
  // actual available width (capped at 460 for desktop). Before this,
  // the canvas was forced to 460px on a 360px phone → label-rotation
  // pushed text past the viewport and the tilt clipped.
  const wheelWrapRef = useRef(null);
  const [wheelSize, setWheelSize] = React.useState(460);
  React.useLayoutEffect(() => {
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
  // if the component unmounts (navigation away) before they fire. Without
  // this, the wheel stop will force a view change after the user has
  // already left the page.
  const flashTimerRef = useRef(null);
  const navTimerRef = useRef(null);

  useEffect(() => { dispatch(fetchDailyMeta()); }, [dispatch]);

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
      // Premium-only categories are gated by Pro status. Previously
      // also unlocked when stats.themes.length > 1 — but buying any
      // theme bumps that, which let non-Pro users bypass the gate. Now
      // strictly Pro-only.
      const pool = CATEGORIES.filter((c) => !c.premium || stats.pro);
      cat = pool[Math.floor(Math.random() * pool.length)];
      dispatch(pushToast({ icon: "🎁", title: "MYSTERY!", text: `${cat.option} · 1.5× points`, duration: 2500 }));
    } else {
      cat = CATEGORIES.find((c) => c.id === slot.id) || CATEGORIES[0];
    }
    // Count guest rounds the moment the round actually starts (after the
    // wheel stops). Soft prompt nags at the threshold, hard wall is
    // enforced in onSpin before the wheel even spins.
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
    // all_categories achievement: fires when the player has now
    // played every category in the CATEGORIES catalog. Compute
    // against the post-mark set since markCategoryPlayed dedupes
    // internally — count the union of the existing list + the cat
    // we just appended to avoid waiting on the next render.
    const playedSet = new Set([...(stats.categories_played || []), cat.id]);
    if (playedSet.size >= CATEGORIES.length) {
      dispatch(markAchievement("all_categories"));
      dispatch(unlockAchievement("all_categories"));
    }
    dispatch(startRound({ categoryId: cat.id, mode, isMystery }));
    dispatch(fetchRoundQuestions({ categoryId: cat.id, mode }));
    dispatch(setView("play"));
  };

  const onSpin = async () => {
    if (spinning) return;
    // Hard wall for guests at GUEST_HARD_LIMIT rounds. Opens the auth
    // modal directly so the upgrade path is one click away.
    if (!user && guestStatus().blocked) {
      sfx.click();
      dispatch(setModal({ name: "auth", data: { tab: "register", reason: "guest_limit" } }));
      return;
    }
    // Pro skips the gate (unlimited spins). Everyone else needs at
    // least one spin in the bank — out of spins routes through the
    // Shop. Each spin debits one server-side, atomically.
    if (!stats.pro && (stats.free_spins || 0) <= 0) {
      dispatch(setView("shop"));
      return;
    }
    setSpinning(true);
    // PESSIMISTIC: await the server's atomic debit BEFORE starting the
    // wheel. Earlier "optimistic local + background sync" model had a
    // race where a fast page refresh during the in-flight POST could
    // restore the spin (server hadn't written yet, fetchStats on boot
    // returned the pre-debit count). Awaiting eliminates the race
    // completely — the server is the only source of truth, and the
    // wheel can't even begin until the DB row is updated. The thunk's
    // .fulfilled reducer merges the server's post-debit stats so the
    // banner reflects the new count BEFORE the wheel starts.
    if (user) {
      const r = await dispatch(useFreeSpin());
      if (r.meta.requestStatus !== "fulfilled") {
        setSpinning(false);
        const err = r.payload;
        dispatch(pushToast({
          icon: "⚠️",
          title: err === "no_free_spins" ? "Out of spins" : "Couldn't spin",
          text: err === "no_free_spins" ? "Visit the Store to top up." : "Try again in a moment.",
        }));
        return;
      }
    }
    if (wheelRef.current) wheelRef.current.spin();
    try { window.dispatchEvent(new Event("triviaspin")); } catch (e) {}
  };

  const onWheelStop = (winningIdx) => {
    setSpinning(false);
    setFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
    // Tightened: flash 320 → 200 ms, nav delay 420 → 250 ms. The
    // flash still registers visually (one heartbeat at 60 fps is
    // ~17 ms; 200 ms is ~12 frames) and the navigation pause is now
    // just long enough to feel like "the wheel landed and I'm
    // going to the question" instead of "the wheel landed and I'm
    // waiting for something to happen". Total click-to-question
    // shortened by ~300 ms.
    flashTimerRef.current = setTimeout(() => setFlash(false), 200);
    navTimerRef.current = setTimeout(() => startWithCategory(winningIdx), 250);
  };

  return (
    <div className="tw-home">
      {/* LEFT — rewards + quests. Hides into the right column on tablet. */}
      <aside className="tw-home-left">
        <EarnMoreStrip />
        <QuestsHub />
      </aside>

      {/* CENTER — the focal point: title, mode pills, wheel, SPIN.
          Guests see an interactive welcome carousel above the hero so
          the registration value-prop is visible on every screen size
          (the left aside collapses below the wheel on mobile). */}
      <section className="tw-home-center">
        {!user && <GuestWelcome />}
        <div className="tw-home-hero">
          <h1 style={{ textAlign: "center", margin: "0", fontSize: 28 }}>{t("home.title")}</h1>
          <p style={{ color: "var(--text-dim)", margin: "4px 0 0", textAlign: "center", fontSize: 13 }}>
            {t("home.subtitle")}
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

          {/* Spin gate. Three states, in priority order:
                1) Guest hit the round cap → register/login card.
                2) Out of spins (non-Pro) → buy/ad card.
                3) Otherwise → SPIN button (free; cost is paid on loss).
              Pro skips both gates entirely. */}
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
                  {/* Wheel icon removed — the button IS the spin
                      action, so the wheel image was redundant. Just
                      shows SPIN with the remaining count for non-Pro
                      players. */}
                  {spinning
                    ? "Spinning..."
                    : stats.pro
                      ? "SPIN"
                      : `SPIN · ${spins}`}
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
      </section>

      {/* RIGHT — live leaderboard with score-position animations. */}
      <aside className="tw-home-right">
        <LiveLeaderboard limit={8} />
      </aside>
    </div>
  );
}

// ─── Contextual rewards strip ────────────────────────────────────────────────
// Only renders pills that are actually claimable right now — no clutter.
function EarnMoreStrip() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);
  if (stats.pro) return null; // Pro users don't need this row.

  const items = [];
  items.push({
    key: "spin",
    icon: <Icon name="free_spin" size={26} />,
    text: "Free spin",
    sub: "Watch ad",
    onClick: () => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "free_spin" } } }),
    tooltip: "Watch a short ad to earn one free spin",
  });
  // Lives are gone — refill is just another way to get spins. The free-
  // spin pill above already covers this entry path, so the duplicate
  // refill pill is removed.
  items.push({
    key: "coins",
    icon: <Icon name="coins" size={26} />,
    text: "+30 coins",
    sub: "Watch ad",
    onClick: () => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "coins" } } }),
    tooltip: "Watch a short ad to earn 30 coins",
  });
  // Shop intentionally omitted here — the bottom nav has a persistent Shop
  // tab, and duplicating it on the home rail clutters the rewards row.

  return (
    <div className="tw-earn-strip">
      <div className="tw-earn-strip-label">Earn rewards</div>
      <div className="tw-earn-strip-row">
        {items.map((it) => (
          <button key={it.key}
            className={`tw-earn-pill ${it.accent ? "accent" : ""}`}
            onClick={it.onClick}
            title={it.tooltip}>
            <span className="tw-earn-icon">{it.icon}</span>
            <span className="tw-earn-text">
              <strong>{it.text}</strong>
              <span>{it.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Hard-wall card shown to guests once they hit GUEST_HARD_LIMIT rounds.
// The free way forward is registering — we keep the ask simple and
// front-load the value (XP, badges, leaderboard, cross-device sync).
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
        <button
          className="tw-btn"
          onClick={() => dispatch(setModal({ name: "auth", data: { tab: "register", reason: "guest_limit" } }))}
          title="Free, takes 10 seconds">
          ✨ Sign up free
        </button>
        <button
          className="tw-btn ghost"
          onClick={() => dispatch(setModal({ name: "auth", data: { tab: "login", reason: "guest_limit" } }))}
          title="Already have an account?">
          🔑 Log in
        </button>
      </div>
    </div>
  );
}

// When the player has used every spin (free_spins + lives both 0 and
// not Pro) the SPIN button is replaced with this card — three clear
// paths back into play: watch an ad, hop to the spin packs in the
// Store, or upgrade to Pro for unlimited. Also shows a live-ticking
// "next spin in m:ss" so users know when free regen will give them
// one back without refreshing.
function OutOfSpinsCard() {
  const dispatch = useDispatch();
  return (
    <div className="tw-out-of-spins">
      <div className="tw-out-of-spins-title" style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
        <Icon name="free_spin" size={22} /> Out of spins
      </div>
      <div className="tw-out-of-spins-sub">Pick how you want to keep playing:</div>
      {/* The "next free spin in m:ss" countdown was removed — it
          telegraphed exactly how long until the player could spin
          for free, undercutting the Store + ad-watch paths. Now the
          out-of-spins card surfaces the spending paths instead. */}
      <div className="tw-out-of-spins-actions">
        {/* Free path is the PRIMARY CTA — no reason to push spending. */}
        <button
          className="tw-btn"
          onClick={() => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "free_spin" } } })}
          title="Watch a short ad for a free spin">
          <Icon name="free_spin" size={22} /> Watch ad — 1 spin
        </button>
        <button
          className="tw-btn ghost"
          onClick={() => dispatch(setView("shop"))}
          title="Buy a spin pack with your coins">
          🛒 Buy spin pack
        </button>
      </div>
      <div className="tw-out-of-spins-pro">
        Or <button className="tw-link" onClick={() => dispatch(setView("shop"))}>upgrade to Pro</button> for unlimited.
      </div>
    </div>
  );
}

// NextSpinTicker removed — see OutOfSpinsCard. Revealing the exact
// regen countdown nudged players to wait instead of spending or
// watching an ad; gone in favor of the Store + ad-reward CTAs.
