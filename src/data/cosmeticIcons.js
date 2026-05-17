// Resolves a cosmetic catalog ID (e.g. "frame_gold", "boost_xp_2x") to
// the URL of its illustrated thumbnail under /icons/cosmetics/. Returns
// null when no asset has been dropped in for that ID yet, letting the
// Store fall back to its emoji / CSS preview.
//
// Why a hand-rolled map vs. /icons/cosmetics/${category}/${id}.png:
// - category names in the catalog don't all match folder names
//   1:1 ("frame" → "frames", "boost" → "boosts", "spins" → "spin_packs")
// - some items don't have art yet (pointers, celebrations, titles) and
//   we want to know that without firing 404s
// - new asset drops just need an entry added here — no rename pass on
//   thousands of generated PNGs

// Category → folder under /icons/cosmetics/. Lowercase + plural.
const CATEGORY_FOLDER = {
  frame:       "frames",
  boost:       "boosts",
  bundle:      "bundles",
  spins:       "spin_packs",
  title:       "titles",        // decorative emblems shown in the store
  badge:       "badges",        // achievement badges (not a store category;
                                // surfaced in profile + the unlock celebration)
  celebration: "celebrations",  // empty until art drops in
  pointer:     "pointers",      // empty until art drops in
};

// IDs that have art today. Add new IDs here when their PNG ships.
// Keep alphabetised within each block for review-at-a-glance.
const HAS_ART = new Set([
  // frames (11/11 — full set)
  "frame_default", "frame_bronze", "frame_silver", "frame_gold",
  "frame_neon", "frame_inferno", "frame_galaxy", "frame_emerald",
  "frame_diamond", "frame_pro", "frame_launch",
  // boosts (5/5 — full set)
  "boost_xp_2x", "boost_coins_2x", "boost_streak_shield",
  "boost_refill_lives", "boost_mystery_box",
  // bundles (3/3 — full set)
  "bundle_starter", "bundle_collector", "bundle_elite",
  // spin packs (3/3 — full set)
  "spins_5", "spins_15", "spins_50",
  // titles (8/8 — emblem art for the store grid; in-game still
  // renders the title text chip via CSS unchanged)
  "title_newbie", "title_thinker", "title_genius", "title_master",
  "title_lord", "title_oracle", "title_goat", "title_pro",
  // badges (35/35 — achievement art surfaced in the unlock
  // celebration + profile badge case)
  "milestone_first_game", "milestone_games_10", "milestone_games_50",
  "milestone_games_250", "milestone_games_1000",
  "skill_first_correct", "skill_correct_100", "skill_correct_1000",
  "skill_streak_5", "skill_streak_10", "skill_streak_25", "skill_streak_50",
  "skill_level_5", "skill_level_20", "skill_level_50", "skill_level_100",
  "social_online_first", "social_online_10", "social_online_50",
  "social_online_200", "social_win_streak_5",
  "streak_daily_3", "streak_daily_7", "streak_daily_30", "streak_daily_100",
  "spending_first_purchase", "spending_1k", "spending_10k", "spending_50k",
  "spending_200k", "spending_pro_1m", "spending_pro_12m",
  "collector_5", "collector_15", "collector_all",
  // pointers, celebrations — TODO when art generates
]);

// Badge art lookup — `badge_id` doesn't carry a category in the
// award payload (badges live in their own table, not user_cosmetics),
// so we synthesize one. Returns null if the badge has no art yet.
export function badgePngUrl(badgeId) {
  if (!badgeId || !HAS_ART.has(badgeId)) return null;
  return `/icons/cosmetics/badges/${badgeId}.png`;
}

// Single shared celebration burst overlay (radial rays + sparkles)
// used behind every badge during the unlock animation.
export const BADGE_UNLOCK_BURST = "/icons/cosmetics/badges/_unlock_burst.png";

export function cosmeticIconUrl(item) {
  if (!item || !item.id) return null;
  if (!HAS_ART.has(item.id)) return null;
  const folder = CATEGORY_FOLDER[item.category];
  if (!folder) return null;
  return `/icons/cosmetics/${folder}/${item.id}.png`;
}

export function hasCosmeticArt(item) {
  return !!cosmeticIconUrl(item);
}

// Specifically resolves a frame item's PNG so the Avatar / OtherAvatar
// renderers can wrap the avatar inside the ring image instead of
// faking the ring with box-shadow. Accepts either a full catalog item
// or just a cosmetic id string. Returns null for the "default / none"
// frame so unframed avatars stay bare.
export function framePngUrl(itemOrId) {
  if (!itemOrId) return null;
  const id = typeof itemOrId === "string" ? itemOrId : itemOrId.id;
  if (!id || id === "frame_default") return null;
  if (!HAS_ART.has(id)) return null;
  return `/icons/cosmetics/frames/${id}.png`;
}

// How much of the PNG frame's diameter is the transparent center hole
// where the avatar sits. The AI-generated frames have THICK rims
// (~22% of radius each side), leaving a center hole that's roughly
// 55% of the total PNG width. Wrapper renders at size / HOLE_RATIO
// so the avatar fits cleanly inside the hole with the ring visible
// around it. Per-frame override hook in `data.hole_ratio` if any
// specific frame needs adjustment.
export const FRAME_HOLE_RATIO = 0.55;
