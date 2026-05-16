import React from "react";

// In-app SVG icon library — used where consistency matters more than
// emoji's cross-platform feel (empty states, spinners, action chips
// that need to match the brand purple/pink gradient).
//
// All icons:
//  - Render at any size via the `size` prop (default 24px)
//  - Inherit color from `currentColor` so they can be tinted with CSS
//  - Use a `linearGradient` ramp that matches the brand when you
//    pass `gradient` prop — id is namespaced so multiple icons on
//    one page don't fight over the same `<defs>` id.

const BRAND_START = "#7c3aed";   // primary purple
const BRAND_END   = "#ec4899";   // primary pink

function gradId(name, instance) { return `tw-grad-${name}-${instance}`; }

// ─── Spinner ─────────────────────────────────────────────────────────
// Indeterminate loading. CSS spins via `tw-spin` animation defined in
// style.css. Use everywhere we previously rendered "Loading…" text.
export function SpinnerIcon({ size = 28, className = "" }) {
  return (
    <svg viewBox="0 0 50 50" width={size} height={size} className={`tw-spin ${className}`} aria-label="Loading">
      <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="5" />
      <circle
        cx="25" cy="25" r="20" fill="none"
        stroke="url(#tw-spinner-grad)" strokeWidth="5" strokeLinecap="round"
        strokeDasharray="80 200" transform="rotate(-90 25 25)"
      />
      <defs>
        <linearGradient id="tw-spinner-grad" x1="0" y1="0" x2="50" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={BRAND_START} />
          <stop offset="100%" stopColor={BRAND_END} />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Empty Inventory — friendly backpack ────────────────────────────
export function EmptyInventoryIcon({ size = 96 }) {
  const id = "inv";
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={gradId(id, "fill")} x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={BRAND_START} stopOpacity="0.35" />
          <stop offset="100%" stopColor={BRAND_END} stopOpacity="0.25" />
        </linearGradient>
      </defs>
      {/* strap */}
      <path d="M30 22 Q30 8, 48 8 Q66 8, 66 22" fill="none" stroke={BRAND_START} strokeWidth="3" strokeLinecap="round" />
      {/* bag body */}
      <rect x="16" y="22" width="64" height="60" rx="14" fill={`url(#${gradId(id, "fill")})`} stroke={BRAND_END} strokeWidth="2.5" />
      {/* pocket */}
      <rect x="28" y="44" width="40" height="22" rx="6" fill="rgba(255,255,255,0.08)" stroke={BRAND_START} strokeWidth="2" />
      {/* zip pull */}
      <circle cx="48" cy="55" r="2.5" fill={BRAND_END} />
      <path d="M48 57 L48 62" stroke={BRAND_END} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ─── Empty Friends — two friendly figures ────────────────────────────
export function EmptyFriendsIcon({ size = 96 }) {
  const id = "fri";
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={gradId(id, "fill")} x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={BRAND_START} stopOpacity="0.4" />
          <stop offset="100%" stopColor={BRAND_END} stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* back figure */}
      <circle cx="34" cy="34" r="12" fill={`url(#${gradId(id, "fill")})`} stroke={BRAND_START} strokeWidth="2.5" />
      <path d="M16 78 Q16 52, 34 52 Q52 52, 52 78" fill={`url(#${gradId(id, "fill")})`} stroke={BRAND_START} strokeWidth="2.5" />
      {/* front figure */}
      <circle cx="62" cy="38" r="14" fill={`url(#${gradId(id, "fill")})`} stroke={BRAND_END} strokeWidth="2.5" />
      <path d="M42 86 Q42 58, 62 58 Q82 58, 82 86" fill={`url(#${gradId(id, "fill")})`} stroke={BRAND_END} strokeWidth="2.5" />
    </svg>
  );
}

// ─── Empty Store / nothing here — gift box ───────────────────────────
export function EmptyStoreIcon({ size = 96 }) {
  const id = "sto";
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={gradId(id, "fill")} x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={BRAND_START} stopOpacity="0.3" />
          <stop offset="100%" stopColor={BRAND_END} stopOpacity="0.25" />
        </linearGradient>
      </defs>
      {/* box body */}
      <rect x="16" y="36" width="64" height="48" rx="6" fill={`url(#${gradId(id, "fill")})`} stroke={BRAND_END} strokeWidth="2.5" />
      {/* box lid */}
      <rect x="12" y="28" width="72" height="14" rx="4" fill={`url(#${gradId(id, "fill")})`} stroke={BRAND_START} strokeWidth="2.5" />
      {/* vertical ribbon */}
      <rect x="44" y="28" width="8" height="56" fill={BRAND_END} opacity="0.85" />
      {/* bow */}
      <circle cx="40" cy="22" r="6" fill="none" stroke={BRAND_END} strokeWidth="2.5" />
      <circle cx="56" cy="22" r="6" fill="none" stroke={BRAND_END} strokeWidth="2.5" />
    </svg>
  );
}

// ─── Empty Badges — trophy outline ───────────────────────────────────
export function EmptyBadgesIcon({ size = 96 }) {
  const id = "bdg";
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={gradId(id, "fill")} x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* cup */}
      <path d="M28 16 H68 V40 Q68 56, 48 56 Q28 56, 28 40 Z" fill={`url(#${gradId(id, "fill")})`} stroke="#f59e0b" strokeWidth="2.5" />
      {/* handles */}
      <path d="M28 22 Q16 22, 16 32 Q16 42, 28 42" fill="none" stroke="#f59e0b" strokeWidth="2.5" />
      <path d="M68 22 Q80 22, 80 32 Q80 42, 68 42" fill="none" stroke="#f59e0b" strokeWidth="2.5" />
      {/* stem */}
      <rect x="42" y="56" width="12" height="14" fill={`url(#${gradId(id, "fill")})`} stroke="#f59e0b" strokeWidth="2.5" />
      {/* base */}
      <rect x="28" y="68" width="40" height="10" rx="2" fill={`url(#${gradId(id, "fill")})`} stroke="#f59e0b" strokeWidth="2.5" />
    </svg>
  );
}

// ─── Action: send-gift (replaces the lone 🎁 emoji button) ──────────
export function GiftIcon({ size = 22, className = "" }) {
  const id = "gft";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId(id, "fill")} x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={BRAND_START} />
          <stop offset="100%" stopColor={BRAND_END} />
        </linearGradient>
      </defs>
      <rect x="3" y="9" width="18" height="13" rx="2" fill={`url(#${gradId(id, "fill")})`} />
      <rect x="2" y="6" width="20" height="5" rx="1.5" fill={`url(#${gradId(id, "fill")})`} />
      <rect x="10.5" y="6" width="3" height="16" fill="rgba(255,255,255,0.4)" />
      <path d="M8 6 Q8 2, 12 4 Q16 2, 16 6" fill="none" stroke={BRAND_END} strokeWidth="1.5" />
    </svg>
  );
}

// ─── Action: skip / next-opponent ────────────────────────────────────
export function SkipIcon({ size = 22, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" fill="currentColor">
      <path d="M4 5 L13 12 L4 19 Z" />
      <rect x="15" y="5" width="4" height="14" rx="0.5" />
    </svg>
  );
}

// ─── Action: refresh / retry ─────────────────────────────────────────
export function RefreshIcon({ size = 22, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M3 12 A9 9 0 0 1 19 6" />
      <path d="M19 3 L19 7 L15 7" />
      <path d="M21 12 A9 9 0 0 1 5 18" />
      <path d="M5 21 L5 17 L9 17" />
    </svg>
  );
}

// ─── Empty-state composite ───────────────────────────────────────────
// Used by Inventory / Friends / Store category to render a clean,
// branded empty state instead of bare grey text.
export function EmptyState({ icon, title, hint, action }) {
  return (
    <div className="tw-empty-state">
      <div className="tw-empty-state-icon">{icon}</div>
      <div className="tw-empty-state-title">{title}</div>
      {hint && <div className="tw-empty-state-hint">{hint}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
