// Shared design language for Spinlore Arena mini-games.
//
// Before: each game shipped its own bright gradient + emoji-heavy
// presentation, which read as "children's app." This module unifies
// every game on a premium-casual aesthetic — dark slate base, single
// accent per game, monospace tabular numbers, restrained motion,
// subtle particles. Reference visual language: Threes!, Reigns,
// Mini Metro. Premium but not corporate.
//
// All games import:
//   ARENA_BG, GAME_SURFACE  — dark base + translucent surface
//   ACCENTS                 — per-game color, indexed by game id
//   ArenaShell              — outer card with proper padding
//   HUDBar                  — top header with timer + score + combo
//   BigDisplay              — large prominent score / state element
//   StartButton             — the "tap to start" affordance
//   ParticleBurst           — emit on success — no asset cost
//   ComboBadge              — multiplier pip with pulse
//   formatScore             — tabular-num formatting helper
import React from "react";

// ── Tokens ─────────────────────────────────────────────────────────
export const ARENA_BG = "linear-gradient(160deg, #0b1120 0%, #060912 100%)";
export const GAME_SURFACE = "rgba(255,255,255,0.025)";
export const SURFACE_BORDER = "1px solid rgba(255,255,255,0.06)";
export const TEXT = "rgba(255,255,255,0.95)";
export const TEXT_DIM = "rgba(255,255,255,0.45)";
export const TEXT_FAINT = "rgba(255,255,255,0.25)";

// Per-game accent. One color each — restraint forces visual identity.
// All tuned to read well against the dark slate background.
export const ACCENTS = {
  tap_race:     { hue: "#fb923c", glow: "rgba(251,146,60,0.45)" },   // amber blaze
  reaction:     { hue: "#22d3ee", glow: "rgba(34,211,238,0.45)" },   // electric cyan
  color_match:  { hue: "#a78bfa", glow: "rgba(167,139,250,0.45)" },  // violet
  memory:       { hue: "#34d399", glow: "rgba(52,211,153,0.45)" },   // mint
  quick_math:   { hue: "#f472b6", glow: "rgba(244,114,182,0.45)" },  // hot pink
  bubble_pop:   { hue: "#60a5fa", glow: "rgba(96,165,250,0.45)" },   // sky
  whack:        { hue: "#f43f5e", glow: "rgba(244,63,94,0.55)" },    // signal red
  odd_one_out:  { hue: "#fbbf24", glow: "rgba(251,191,36,0.45)" },   // gold
  sequence_tap: { hue: "#67e8f9", glow: "rgba(103,232,249,0.45)" },  // pale cyan
  catch_bug:    { hue: "#c084fc", glow: "rgba(192,132,252,0.55)" },  // anomaly purple
  memorize:     { hue: "#fcd34d", glow: "rgba(252,211,77,0.45)" },   // cipher gold
  hilo_sprint:  { hue: "#4ade80", glow: "rgba(74,222,128,0.45)" },   // tide green
};
export function accentFor(id) { return ACCENTS[id] || { hue: "#ffffff", glow: "rgba(255,255,255,0.4)" }; }

// ── Components ─────────────────────────────────────────────────────

// Outer shell every game renders inside. Replaces .tw-card for
// mini-games to enforce the new aesthetic without touching the
// global stylesheet. Title + tagline live in the header bar.
export function ArenaShell({ title, tagline, accent, children, footer }) {
  return (
    <div style={{
      background: ARENA_BG,
      borderRadius: 16,
      padding: 16,
      border: SURFACE_BORDER,
      color: TEXT,
      userSelect: "none",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Faint radial glow in the corner — adds depth without busyness */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(circle at 0% 0%, ${accent?.glow || "transparent"}, transparent 50%)`,
        opacity: 0.35, pointerEvents: "none",
      }} />
      <div style={{ position: "relative" }}>
        {(title || tagline) && (
          <div style={{ marginBottom: 14 }}>
            {title && (
              <div style={{
                fontFamily: '"Inter", system-ui, sans-serif',
                fontWeight: 800, fontSize: 13, letterSpacing: 2,
                textTransform: "uppercase", color: TEXT,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 2,
                  background: accent?.hue || "#fff",
                  boxShadow: `0 0 12px ${accent?.glow || "rgba(255,255,255,0.4)"}`,
                }} />
                {title}
              </div>
            )}
            {tagline && (
              <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 4 }}>{tagline}</div>
            )}
          </div>
        )}
        {children}
        {footer}
      </div>
    </div>
  );
}

// HUD bar — top-right cluster showing timer, score, optional combo.
// Tabular numbers so the digits don't jiggle as they change.
export function HUDBar({ remainingMs, score, combo, accent, extras }) {
  const sec = remainingMs == null ? null : (remainingMs / 1000).toFixed(1);
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end",
      fontVariantNumeric: "tabular-nums",
      fontFamily: '"JetBrains Mono", "SF Mono", monospace',
      fontSize: 12, marginBottom: 10, color: TEXT_DIM, letterSpacing: 1,
    }}>
      {sec != null && (
        <span style={{ color: parseFloat(sec) < 3 ? "#fda4af" : TEXT_DIM }}>
          {sec.padStart(4, " ")}s
        </span>
      )}
      {score != null && (
        <span style={{ color: TEXT, fontWeight: 700 }}>
          {String(score).padStart(2, "0")}
        </span>
      )}
      {combo > 1 && <ComboBadge value={combo} accent={accent} />}
      {extras}
    </div>
  );
}

// Combo multiplier badge with pulsing glow at higher tiers.
export function ComboBadge({ value, accent }) {
  if (!value || value < 2) return null;
  const intensity = Math.min(1, (value - 1) / 5);
  return (
    <span style={{
      fontFamily: '"Inter", sans-serif', fontWeight: 800, fontSize: 11,
      letterSpacing: 1, padding: "3px 8px", borderRadius: 999,
      background: `linear-gradient(90deg, ${accent?.hue || "#fff"}30, ${accent?.hue || "#fff"}10)`,
      border: `1px solid ${accent?.hue || "#fff"}80`,
      color: accent?.hue || "#fff",
      boxShadow: `0 0 ${12 + intensity * 20}px ${accent?.glow || "rgba(255,255,255,0.4)"}`,
      animation: "tw-combo-pulse 0.9s ease-in-out infinite",
    }}>
      ×{value}
    </span>
  );
}

// "TAP TO START" — uniform across every game, accent-tinted.
export function StartButton({ accent, label = "BEGIN", onStart, sublabel }) {
  return (
    <button
      onClick={onStart}
      style={{
        width: "100%", padding: "28px 16px",
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${accent?.hue || "#fff"}40`,
        borderRadius: 14,
        color: TEXT, cursor: "pointer",
        fontFamily: '"Inter", sans-serif',
        fontWeight: 800, fontSize: 16, letterSpacing: 4,
        textTransform: "uppercase",
        transition: "border-color 0.2s, transform 0.08s, background 0.2s",
      }}
      onPointerDown={(e) => { e.currentTarget.style.transform = "scale(0.985)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      onPointerUp={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
      onPointerLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
    >
      <div>{label}</div>
      {sublabel && (
        <div style={{
          marginTop: 6, fontSize: 11, letterSpacing: 1,
          color: TEXT_DIM, fontWeight: 600, textTransform: "none",
        }}>{sublabel}</div>
      )}
    </button>
  );
}

// Big visible numeric display — the "thing you're chasing" in most games.
export function BigDisplay({ value, label, accent, subtext, glow }) {
  return (
    <div style={{ textAlign: "center", padding: "14px 0" }}>
      {label && (
        <div style={{
          fontSize: 10, letterSpacing: 2, color: TEXT_DIM,
          textTransform: "uppercase", fontWeight: 700, marginBottom: 4,
        }}>{label}</div>
      )}
      <div style={{
        fontFamily: '"JetBrains Mono", "SF Mono", monospace',
        fontWeight: 800, fontSize: 56, lineHeight: 1,
        color: accent?.hue || TEXT,
        textShadow: glow ? `0 0 24px ${accent?.glow || "rgba(255,255,255,0.4)"}` : "none",
        fontVariantNumeric: "tabular-nums",
        transition: "color 0.15s, text-shadow 0.15s",
      }}>{value}</div>
      {subtext && (
        <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 6 }}>{subtext}</div>
      )}
    </div>
  );
}

// Particle burst — tiny CSS-only confetti at a point. Used on key
// success moments. No assets, no canvas, no library — 8 absolutely
// positioned divs that animate out and fade.
export function ParticleBurst({ at, accent, n = 8 }) {
  if (!at) return null;
  const parts = Array.from({ length: n }, (_, i) => {
    const angle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.3;
    const dist = 32 + Math.random() * 24;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    return { dx, dy, i };
  });
  return (
    <div style={{ position: "absolute", left: at.x, top: at.y, pointerEvents: "none", zIndex: 5 }}>
      {parts.map(({ dx, dy, i }) => (
        <span key={`${at.t}-${i}`} style={{
          position: "absolute", width: 6, height: 6, borderRadius: "50%",
          background: accent?.hue || "#fff",
          boxShadow: `0 0 8px ${accent?.glow || "rgba(255,255,255,0.4)"}`,
          animation: "tw-particle 0.55s ease-out forwards",
          ["--dx"]: `${dx}px`, ["--dy"]: `${dy}px`,
        }} />
      ))}
    </div>
  );
}

// Inject the shared keyframes once. Caller renders this <Keyframes/>
// somewhere inside their tree — it's a no-op DOM-wise but ensures the
// animations are available. Idempotent thanks to React's component
// deduping.
export function MinigameKeyframes() {
  return (
    <style>{`
      @keyframes tw-combo-pulse {
        0%, 100% { transform: scale(1); filter: brightness(1); }
        50%      { transform: scale(1.06); filter: brightness(1.2); }
      }
      @keyframes tw-particle {
        0%   { transform: translate(0, 0) scale(1); opacity: 1; }
        100% { transform: translate(var(--dx, 0), var(--dy, 0)) scale(0.2); opacity: 0; }
      }
      @keyframes tw-fade-in    { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes tw-pop        { 0% { transform: scale(0.6); opacity: 0; } 70% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); } }
      @keyframes tw-shake      { 0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)} }
      @keyframes tw-scan-line  { 0%{transform:translateY(-100%)}100%{transform:translateY(100%)} }
    `}</style>
  );
}

export function formatScore(n) {
  return String(Math.floor(n || 0)).padStart(2, "0");
}

// Combo helper — manage a combo count + window timer. Caller calls
// .hit() on success, .miss() on failure or timeout. Returns the
// current combo + a tick to drive UI.
export function useCombo(windowMs = 1400) {
  const [combo, setCombo] = React.useState(0);
  const lastHitRef = React.useRef(0);
  const decayRef = React.useRef(null);
  const hit = React.useCallback(() => {
    const now = Date.now();
    setCombo((c) => (now - lastHitRef.current < windowMs ? c + 1 : 1));
    lastHitRef.current = now;
    if (decayRef.current) clearTimeout(decayRef.current);
    decayRef.current = setTimeout(() => setCombo(0), windowMs);
  }, [windowMs]);
  const miss = React.useCallback(() => {
    setCombo(0);
    if (decayRef.current) clearTimeout(decayRef.current);
  }, []);
  React.useEffect(() => () => { if (decayRef.current) clearTimeout(decayRef.current); }, []);
  return { combo, hit, miss };
}
