// CATEGORIES — what the wheel picks from.
//
// 2026 content pivot: the school-feeling categories (General/Science/
// Geography/Animals) were dropping engagement in the 14-22 demo. We
// kept the universal ones (Film/TV/Music/Sports) and added six
// pop-culture buckets seeded with hand-written current questions in
// server/data/questions-seed-popculture.json. The wheel now leads
// with what the demo cares about; the older buckets stay available
// but rotate to the back of the wheel.
//
// IDs in the 1000s belong to the pop-culture set and don't collide
// with OpenTriviaDB (which uses <50). Keeping the legacy IDs intact
// preserves per-category stats history for existing players.
export const CATEGORIES = [
  // ── New pop-culture set (front of wheel) ───────────────────
  { id: 1001, option: "Music 2020s",      color: "#f59e0b", premium: false },
  { id: 1002, option: "Streaming TV",     color: "#ec4899", premium: false },
  { id: 1003, option: "Internet & Memes", color: "#22d3ee", premium: false },
  { id: 1004, option: "Sports Culture",   color: "#ef4444", premium: false },
  { id: 1005, option: "Anime & Manga",    color: "#7c3aed", premium: false },
  { id: 1006, option: "Streetwear & Hype",color: "#10b981", premium: false },

  // ── Legacy universals (stay on the wheel) ──────────────────
  { id: 11,   option: "Film",             color: "#a855f7", premium: false },
  { id: 14,   option: "TV",               color: "#06b6d4", premium: false },
  { id: 12,   option: "Music",            color: "#f97316", premium: false },

  // ── Legacy classics (kept for the player base that knows them,
  //    rotated to the back of the wheel so the new content leads) ──
  { id: 9,    option: "General",          color: "#475569", premium: false },
  { id: 17,   option: "Science",          color: "#15803d", premium: false },
  { id: 22,   option: "Geography",        color: "#1d4ed8", premium: false },
  { id: 21,   option: "Classic Sports",   color: "#b91c1c", premium: false },
  { id: 27,   option: "Animals",          color: "#c2410c", premium: false },
  { id: 18,   option: "Computers",        color: "#64748b", premium: true  },
  { id: 20,   option: "Mythology",        color: "#14b8a6", premium: true  },
];

// Special "Mystery" slot — picks a random category and grants a score bonus.
export const MYSTERY = { id: -1, option: "MYSTERY x1.5", color: "#fde047", premium: false, isMystery: true };

// Wheel picks the first 9 categories (the pop-culture set + Film +
// TV + Music) plus mystery in the middle, giving a clean 10-wedge
// wheel. The legacy classics (General/Science/Geography/etc) still
// exist in CATEGORIES so per-category stats history is preserved
// and they remain valid targets for the Shop's category-themed
// items — they just don't appear as wheel destinations anymore.
// Adding 16 wedges to the wheel made the text unreadable at mobile
// sizes; 10 keeps each segment ~36° which still fits a label.
const WHEEL_PICKS = CATEGORIES.slice(0, 9);
export const WHEEL_DATA = [
  ...WHEEL_PICKS.slice(0, 5),
  MYSTERY,
  ...WHEEL_PICKS.slice(5),
].map((c) => ({
  option: c.option,
  style: { backgroundColor: c.color, textColor: c.isMystery ? "#0f0c29" : "#ffffff" },
  id: c.id,
  isMystery: !!c.isMystery,
}));

// Same shape as WHEEL_DATA but with the `option` strings translated via
// the i18n `t` function. Call from a component that has access to
// `useT()` — `translatedCategories(t)` returns a fresh array each
// language change so the wheel relabels live.
export function translatedCategories(t) {
  return WHEEL_DATA.map((c) => {
    if (c.isMystery) return { ...c, option: t("category.mystery") };
    return { ...c, option: t(`category.${c.id}`) || c.option };
  });
}
