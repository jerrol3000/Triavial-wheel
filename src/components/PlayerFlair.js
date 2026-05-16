import React from "react";

// Reusable username + title-badge + showcase-badges flair. Consumes
// `cosmetics` (public projection from server: { frame, title }) and
// `badges` (array of [{ badge_id, name, icon, tier }]).
// Used by LiveLeaderboard, ScoreCard (online), Profile, etc.
export function PlayerFlair({ username, cosmetics, badges, compact = false }) {
  const title = cosmetics?.title?.data;
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
      {title && title.text && !compact && (
        <span
          className="tw-title-chip"
          style={{ color: title.color || "var(--text-dim)", borderColor: title.color || "var(--card-border)" }}
        >{title.text}</span>
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
