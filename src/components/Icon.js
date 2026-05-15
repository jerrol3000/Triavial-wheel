import React, { useState } from "react";
import { ICONS } from "../data/icons";

// Renders a named icon. Prefers /icons/<file>.png; falls back to the emoji
// if the image fails to load (file missing, network error). This lets you
// drop in custom illustrations later without touching component code.
export default function Icon({ name, size = 22, className = "", style = {} }) {
  const def = ICONS[name];
  const [failed, setFailed] = useState(false);
  if (!def) return null;
  if (failed || !def.file) {
    return (
      <span
        className={className}
        style={{ fontSize: size, lineHeight: 1, display: "inline-block", ...style }}
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
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", ...style }}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
