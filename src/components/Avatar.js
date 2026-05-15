import React, { useState } from "react";
import { getPresetById } from "../data/icons";

// Renders a user's avatar. `value` can be:
//   - null / undefined / "" → generic person silhouette
//   - "preset:<id>"          → a preset emoji avatar
//   - "data:image/..."       → user-uploaded image (also works for animated GIFs)
//   - "/path/to/file.png"    → an absolute or root-relative URL
export default function Avatar({ value, size = 32, ring = false, className = "", title }) {
  const [failed, setFailed] = useState(false);
  const sz = { width: size, height: size };
  const cls = `tw-avatar ${ring ? "ring" : ""} ${className}`;

  if (!value) {
    return <span className={cls} style={sz} title={title} aria-label="avatar"><span className="tw-avatar-emoji">👤</span></span>;
  }

  if (typeof value === "string" && value.startsWith("preset:")) {
    const id = value.slice(7);
    const preset = getPresetById(id);
    if (!preset) return <span className={cls} style={sz} title={title}><span className="tw-avatar-emoji">👤</span></span>;
    if (failed || !preset.file) {
      return (
        <span className={cls} style={sz} title={title}>
          <span className="tw-avatar-emoji" style={{ fontSize: Math.round(size * 0.7) }}>{preset.emoji}</span>
        </span>
      );
    }
    return (
      <img
        className={cls}
        style={sz}
        src={`/icons/${preset.file}`}
        alt=""
        title={title}
        onError={() => setFailed(true)}
        draggable={false}
      />
    );
  }

  // Data URL or path. Show an emoji silhouette if it errors out.
  if (failed) {
    return <span className={cls} style={sz} title={title}><span className="tw-avatar-emoji">👤</span></span>;
  }
  return (
    <img
      className={cls}
      style={sz}
      src={value}
      alt=""
      title={title}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
