import React, { useState } from "react";
import { getPresetById } from "../data/icons";

// Avatar for SOMEONE ELSE — uses server-supplied cosmetics payload
// (the public_cosmetics object on leaderboard rows / online players).
// Mirrors Avatar's frame rendering logic but doesn't read redux (since
// the frame data isn't in this user's catalog).
export default function OtherAvatar({ value, size = 32, cosmetics, className = "", title }) {
  const [failed, setFailed] = useState(false);
  const frameData = cosmetics?.frame?.data;
  const frameStyle = frameStyleFor(frameData, size);

  const sz = { width: size, height: size };
  const cls = `tw-avatar ${className}`;
  const renderInner = () => {
    if (!value) {
      return <span className={cls} style={sz} title={title}><span className="tw-avatar-emoji">👤</span></span>;
    }
    if (typeof value === "string" && value.startsWith("dicebear:")) {
      const [, style, ...seedParts] = value.split(":");
      const seed = seedParts.join(":") || "anon";
      const url = `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`;
      if (failed) return <span className={cls} style={sz} title={title}><span className="tw-avatar-emoji">👤</span></span>;
      return <img className={cls} style={sz} src={url} alt="" title={title} onError={() => setFailed(true)} draggable={false} />;
    }
    if (typeof value === "string" && value.startsWith("preset:")) {
      const preset = getPresetById(value.slice(7));
      if (!preset) return <span className={cls} style={sz} title={title}><span className="tw-avatar-emoji">👤</span></span>;
      if (failed || !preset.file) {
        return <span className={cls} style={sz} title={title}>
          <span className="tw-avatar-emoji" style={{ fontSize: Math.round(size * 0.7) }}>{preset.emoji}</span>
        </span>;
      }
      return <img className={cls} style={sz} src={`/icons/${preset.file}`} alt="" title={title} onError={() => setFailed(true)} draggable={false} />;
    }
    if (failed) return <span className={cls} style={sz} title={title}><span className="tw-avatar-emoji">👤</span></span>;
    return <img className={cls} style={sz} src={value} alt="" title={title} onError={() => setFailed(true)} draggable={false} />;
  };

  if (!frameStyle) return renderInner();
  return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", ...frameStyle }}>{renderInner()}</span>;
}

function frameStyleFor(d, size) {
  if (!d || d.style === "none") return null;
  const pad = (d.width || 3) + 2;
  const base = { width: size + pad * 2, height: size + pad * 2, borderRadius: "50%", padding: pad, boxSizing: "border-box" };
  if (d.style === "solid")    return { ...base, boxShadow: `inset 0 0 0 ${d.width || 3}px ${d.color}, 0 0 10px ${d.glow || d.color}` };
  if (d.style === "gradient") return { ...base, backgroundImage: `linear-gradient(135deg, ${(d.colors || ["#fff"]).join(",")})`, boxShadow: `0 0 12px ${d.glow || "rgba(255,255,255,0.3)"}` };
  if (d.style === "pulse")    return { ...base, boxShadow: `inset 0 0 0 ${d.width || 3}px ${d.color}, 0 0 14px ${d.glow}`, animation: "tw-frame-pulse 1.6s ease-in-out infinite" };
  if (d.style === "shimmer")  return { ...base, backgroundImage: `linear-gradient(135deg, ${(d.colors || ["#fff"]).join(",")})`, backgroundSize: "200% 200%", animation: "tw-frame-shimmer 3s linear infinite", boxShadow: `0 0 14px ${d.glow || "rgba(255,255,255,0.3)"}` };
  return null;
}
