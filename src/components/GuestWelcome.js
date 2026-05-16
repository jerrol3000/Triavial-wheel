import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { setModal } from "../store/uiSlice";
import { load, save } from "../utils/storage";

const DISMISS_KEY = "welcome_dismissed_v1";
const ROTATE_MS = 4500;

// Each slide is a single bite-sized benefit — short headline, one-line
// blurb, a big emoji that doubles as the visual hook. Tone is friendly
// and concrete, not marketing-speak. Lead with the social hook (1v1
// vs friends) — strongest activation reason.
const SLIDES = [
  {
    icon: "🎮",
    title: "Play 1v1 with friends",
    text: "Challenge friends head-to-head or jump into ranked matches against players online.",
  },
  {
    icon: "🏆",
    title: "Climb the leaderboard",
    text: "Your scores rank against players worldwide — see your name rise live.",
  },
  {
    icon: "💎",
    title: "Keep your progress",
    text: "XP, coins, streaks and badges save to your account — never lose them.",
  },
  {
    icon: "🎯",
    title: "Daily & Weekly quests",
    text: "Unlock bonus rewards just for playing the way you already play.",
  },
  {
    icon: "🎟️",
    title: "Unlimited rounds",
    text: "Guests get 10 free rounds — members keep spinning as long as they win.",
  },
];

// Friendly, dismissible interactive onboarding card for guests on Home.
// Auto-rotates through key benefits of registering, with manual dots
// and a clear single-tap path into the auth modal. Hidden once the
// visitor either dismisses it OR creates an account.
export default function GuestWelcome() {
  const dispatch = useDispatch();
  const [dismissed, setDismissed] = useState(() => !!load(DISMISS_KEY, false));
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (dismissed || paused) return;
    const id = setInterval(() => setIdx((n) => (n + 1) % SLIDES.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [dismissed, paused]);

  if (dismissed) return null;

  const dismiss = () => {
    save(DISMISS_KEY, true);
    setDismissed(true);
  };

  const openSignup = () => {
    dispatch(setModal({ name: "auth", data: { tab: "register", reason: "guest_welcome" } }));
  };

  // Manual nav pauses auto-rotation so the user can read at their own
  // pace without the slide flipping out from under them mid-sentence.
  const goPrev = () => { setIdx((n) => (n - 1 + SLIDES.length) % SLIDES.length); setPaused(true); };
  const goNext = () => { setIdx((n) => (n + 1) % SLIDES.length); setPaused(true); };

  const slide = SLIDES[idx];
  const arrowBtn = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "var(--text)",
    width: 28, height: 28, borderRadius: 8,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", fontSize: 14, lineHeight: 1, flexShrink: 0,
    padding: 0,
  };

  return (
    <div
      className="tw-card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{
        position: "relative",
        background: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(56,189,248,0.12))",
        border: "1px solid rgba(124,58,237,0.45)",
        padding: 14,
      }}
      aria-label="Welcome — benefits of creating an account"
    >
      {/* Dismiss × — small, top right, doesn't compete with the CTA */}
      <button
        type="button"
        onClick={dismiss}
        title="Dismiss"
        aria-label="Dismiss welcome"
        style={{
          position: "absolute", top: 6, right: 8,
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--text-dim)", fontSize: 18, lineHeight: 1, padding: 4,
        }}
      >×</button>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>👋</span>
        <strong style={{ fontFamily: "Fredoka", fontSize: 15 }}>Welcome!</strong>
        <span style={{ color: "var(--text-dim)", fontSize: 12 }}>Quick tour</span>
      </div>

      {/* Slide row: prev arrow · content · next arrow. Arrows make
          manual nav obvious (the dots alone read as decoration). Fixed
          minHeight prevents card jumping as slides change length. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 92 }}>
        <button
          type="button"
          onClick={goPrev}
          style={arrowBtn}
          aria-label="Previous benefit"
          title="Previous"
        >‹</button>
        <div
          key={idx}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 12,
            animation: "fadeIn 360ms ease",
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 36, lineHeight: 1, flexShrink: 0 }}>{slide.icon}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{slide.title}</div>
            <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.4 }}>{slide.text}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={goNext}
          style={arrowBtn}
          aria-label="Next benefit"
          title="Next"
        >›</button>
      </div>

      {/* Manual dots — clickable, current one is filled. */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, margin: "6px 0 10px" }}>
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { setIdx(i); setPaused(true); }}
            aria-label={`Show slide ${i + 1}`}
            aria-current={i === idx}
            style={{
              width: i === idx ? 18 : 7,
              height: 7,
              borderRadius: 4,
              background: i === idx ? "var(--primary, #7c3aed)" : "rgba(255,255,255,0.25)",
              border: "none",
              cursor: "pointer",
              transition: "width 200ms ease, background 200ms ease",
              padding: 0,
            }}
          />
        ))}
      </div>

      <button
        type="button"
        className="tw-btn block"
        onClick={openSignup}
        style={{ fontWeight: 700 }}
        title="Free — takes about 10 seconds"
      >
        ✨ Sign up free — 10s
      </button>
      <div style={{ textAlign: "center", marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
        No email verification needed
      </div>
    </div>
  );
}
