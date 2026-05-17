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
  celebration: "celebrations",  // empty until art drops in
  pointer:     "pointers",      // empty until art drops in
  // titles are pure text chips — no folder
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
  // pointers, celebrations, titles — TODO when art generates
]);

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
// where the avatar sits. ~72% matches the rings the AI prompts
// generated (thick rim, generous inner). Per-frame override could go
// in the catalog `data.hole_ratio` if any specific frame needs it.
export const FRAME_HOLE_RATIO = 0.72;
