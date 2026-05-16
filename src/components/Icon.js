import React, { useState } from "react";
import { ICONS } from "../data/icons";

// Renders a named icon. Prefers /icons/<file>; falls back to the emoji
// if the image fails to load. Icons are transparent PNGs — `object-fit:
// contain` preserves aspect, and a soft drop shadow gives depth on dark
// backgrounds without boxing the art in a tile.
export default function Icon({ name, size = 22, className = "", style = {} }) {
  const def = ICONS[name];
  const [failed, setFailed] = useState(false);
  if (!def) return null;
  if (failed || !def.file) {
    return (
      <span
        className={className}
        style={{ fontSize: Math.round(size * 0.95), lineHeight: 1, display: "inline-block", ...style }}
        aria-label={def.label}
      >
        {def.emoji}
      </span>
    );
  }
  return (
    <img
      src={`/icons/${def.file}`}
      alt={def.label || name}
      width={size}
      height={size}
      className={`tw-icon ${className}`}
      style={{ width: size, height: size, ...style }}
      onError={() => setFailed(true)}
      draggable={false}
      loading="lazy"
    />
  );
}
