import React from "react";

// Lightweight tooltip — wraps a child with a CSS-driven popup on hover/focus
// (and tap-and-hold on touch). Uses the global .tw-tip classes in style.css.
export default function Tooltip({ label, children, side = "top" }) {
  if (!label) return children;
  return (
    <span className={`tw-tip tw-tip-${side}`} data-tip={label} aria-label={label}>
      {children}
    </span>
  );
}
