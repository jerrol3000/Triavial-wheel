import React from "react";
import { cosmeticIconUrl } from "../data/cosmeticIcons";

// Reusable username + title-badge + showcase-badges flair. Consumes
// `cosmetics` (public projection from server: { frame, title }) and
// `badges` (array of [{ badge_id, name, icon, tier }]).
// Used by LiveLeaderboard, ScoreCard (online), Profile, etc.
//
// Titles render as the catalog item's TEXT preceded by its EMBLEM
// PNG (when one's been generated). That makes a paid title feel like
// a real achievement — there's a recognizable icon attached, not just
// a colored word. Compact callers (LiveLeaderboard small rows) get
// just the emblem to save horizontal space; full-width callers get
// emblem + text.
export function PlayerFlair({ username, cosmetics, badges, compact = false }) {
  const titleItem = cosmetics && cosmetics.title;
  const titleData = titleItem && titleItem.data;
  const titleEmblem = titleItem ? cosmeticIconUrl(titleItem) : null;
  const showcaseBadges = (badges || []).filter((b) => b.equipped_slot != null);
  const primaryBadge = showcaseBadges[0];

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{username}</span>
      {primaryBadge && (
        <span
          className={`tw-mini-badge tier-${primaryBadge.tier}`}
          title={`${primaryBadge.name}`}
        >{primaryBadge.icon || "🏅"}</span>
      )}
      {titleData && titleData.text && (
        <span
          className={`tw-title-chip ${compact ? "compact" : ""}`}
          title={titleData.text}
          style={{
            // Color drives chip border + glow + text gradient. CSS
            // custom properties so all the visual effects can share
            // a single source of truth.
            "--title-color": titleData.color || "#a855f7",
          }}
        >
          {titleEmblem && (
            <img
              src={titleEmblem}
              alt=""
              className="tw-title-emblem"
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
              draggable={false}
            />
          )}
          {!compact && <span className="tw-title-text">{titleData.text}</span>}
        </span>
      )}
    </span>
  );
}

// Renders only the showcase badges (1-3) — for places where username is
// already shown elsewhere (e.g., big profile header).
export function BadgeCase({ badges, size = "md" }) {
  const showcase = (badges || []).filter((b) => b.equipped_slot != null);
  if (!showcase.length) return null;
  const px = size === "lg" ? 32 : size === "sm" ? 18 : 24;
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {showcase.map((b) => (
        <span key={b.badge_id}
              className={`tw-mini-badge tier-${b.tier}`}
              style={{ width: px, height: px, fontSize: Math.round(px * 0.6) }}
              title={b.name}>
          {b.icon || "🏅"}
        </span>
      ))}
    </span>
  );
}
