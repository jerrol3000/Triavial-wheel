import React, { useState } from "react";
import { useSelector } from "react-redux";
import { getPresetById } from "../data/icons";
import { framePngUrl, FRAME_HOLE_RATIO } from "../data/cosmeticIcons";

// Renders a user's avatar. `value` can be:
//   - null / undefined / "" → generic person silhouette
//   - "preset:<id>"          → a preset emoji avatar
//   - "data:image/..."       → user-uploaded image (also works for animated GIFs)
//   - "/path/to/file.png"    → an absolute or root-relative URL
// When `me` is true, the currently-logged-in user's equipped frame
// cosmetic is rendered around the avatar (border + glow).
export default function Avatar({ value, size = 32, ring = false, className = "", title, me = false }) {
  const [failed, setFailed] = useState(false);
  const equippedFrameId = useSelector((s) => me ? s.cosmetics.equipped.frame : null);
  const frameItem = useSelector((s) => equippedFrameId ? s.cosmetics.catalog.find((c) => c.id === equippedFrameId) : null);
  const framePng = framePngUrl(frameItem);
  const frameStyle = (!framePng && frameItem) ? frameStyleFor(frameItem.data, size) : null;

  const sz = { width: size, height: size };
  const cls = `tw-avatar ${ring ? "ring" : ""} ${className}`;
  const wrapStyle = frameStyle || {};

  const renderInner = () => {
    if (!value) {
      return <span className={cls} style={sz} title={title} aria-label="avatar"><span className="tw-avatar-emoji">👤</span></span>;
    }
    // DiceBear avatar — format: "dicebear:<style>:<seed>". Renders the
    // SVG straight from their free API. No signup needed, no per-request
    // cost. Each (style, seed) combo is deterministic so the same value
    // always produces the same picture.
    if (typeof value === "string" && value.startsWith("dicebear:")) {
      const [, style, ...seedParts] = value.split(":");
      const seed = seedParts.join(":") || "anon";
      const url = `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`;
      if (failed) {
        return <span className={cls} style={sz} title={title}><span className="tw-avatar-emoji">👤</span></span>;
      }
      return (
        <img className={cls} style={sz} src={url} alt="" title={title}
             onError={() => setFailed(true)} draggable={false} />
      );
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
        <img className={cls} style={sz} src={`/icons/${preset.file}`} alt="" title={title}
             onError={() => setFailed(true)} draggable={false} />
      );
    }
    if (failed) {
      return <span className={cls} style={sz} title={title}><span className="tw-avatar-emoji">👤</span></span>;
    }
    return (
      <img className={cls} style={sz} src={value} alt="" title={title}
           onError={() => setFailed(true)} draggable={false} />
    );
  };

  // PNG frame wraps the avatar: wrapper renders at size / HOLE_RATIO
  // so the PNG's transparent center exactly matches the avatar
  // diameter. Identical to OtherAvatar — own + other rendering are
  // pixel-identical.
  if (framePng) {
    const frameSize = Math.round(size / FRAME_HOLE_RATIO);
    return (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: frameSize,
        height: frameSize,
        backgroundImage: `url("${framePng}")`,
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      }}>
        {renderInner()}
      </span>
    );
  }
  if (!frameStyle) return renderInner();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", ...wrapStyle }}>
      {renderInner()}
    </span>
  );
}

// Derives a CSS style object from a frame item's data — same logic as
// the Store preview so the in-game look matches the catalog card.
function frameStyleFor(d, size) {
  if (!d || d.style === "none") return null;
  const pad = (d.width || 3) + 2;
  const base = {
    width: size + pad * 2,
    height: size + pad * 2,
    borderRadius: "50%",
    padding: pad,
    boxSizing: "border-box",
  };
  if (d.style === "solid") {
    return { ...base, boxShadow: `inset 0 0 0 ${d.width || 3}px ${d.color}, 0 0 10px ${d.glow || d.color}` };
  }
  if (d.style === "gradient") {
    return {
      ...base,
      backgroundImage: `linear-gradient(135deg, ${(d.colors || ["#fff"]).join(",")})`,
      boxShadow: `0 0 12px ${d.glow || "rgba(255,255,255,0.3)"}`,
    };
  }
  if (d.style === "pulse") {
    return { ...base, boxShadow: `inset 0 0 0 ${d.width || 3}px ${d.color}, 0 0 14px ${d.glow}`, animation: "tw-frame-pulse 1.6s ease-in-out infinite" };
  }
  if (d.style === "shimmer") {
    return {
      ...base,
      backgroundImage: `linear-gradient(135deg, ${(d.colors || ["#fff"]).join(",")})`,
      backgroundSize: "200% 200%",
      animation: "tw-frame-shimmer 3s linear infinite",
      boxShadow: `0 0 14px ${d.glow || "rgba(255,255,255,0.3)"}`,
    };
  }
  return null;
}
