// Higher/Lower datasets — pop-culture comparisons for the mini-mode.
//
// Each dataset is a list of { label, image?, value, unit } where `value`
// is the numeric quantity being compared. Game logic picks two items
// from the SAME dataset, shows them side-by-side, asks "which has more
// <metric>?". On correct, the picked item becomes the left side and a
// new random item appears on the right. Streak counter goes up.
//
// Why hardcoded vs API: live data (Spotify streams, IMDB ratings,
// Instagram followers) would be ideal but requires API contracts +
// keys + caching. For MVP launch, hardcoded snapshots dated to early
// 2026 give us a playable, screenshot-able product TODAY, and the
// values are stable enough that "year-old data" won't bite us until
// well after we know if the mechanic resonates.
//
// IMPORTANT: values should be FACTUALLY plausible at the time of
// shipping. If a player notices a value is wildly off, the game loses
// credibility instantly. Numbers below are conservative + verifiable.

export const HL_DATASETS = {
  // Approximate global Spotify streams in millions, as of early 2026.
  // Source: rough Spotify-for-Artists / Chartmasters snapshots.
  songs: {
    label: "Spotify Streams",
    unit: "streams",
    formatValue: (v) => `${(v / 1e9).toFixed(2)}B streams`,
    blurb: "Which song has more Spotify streams?",
    items: [
      { label: "Blinding Lights — The Weeknd",        value: 4_400_000_000 },
      { label: "Shape of You — Ed Sheeran",           value: 4_000_000_000 },
      { label: "As It Was — Harry Styles",            value: 3_400_000_000 },
      { label: "Flowers — Miley Cyrus",               value: 2_900_000_000 },
      { label: "Anti-Hero — Taylor Swift",            value: 2_100_000_000 },
      { label: "Espresso — Sabrina Carpenter",        value: 2_400_000_000 },
      { label: "Cruel Summer — Taylor Swift",         value: 2_700_000_000 },
      { label: "Stay — The Kid LAROI & Bieber",       value: 2_900_000_000 },
      { label: "Cupid — FIFTY FIFTY",                 value: 1_800_000_000 },
      { label: "Vampire — Olivia Rodrigo",            value: 1_700_000_000 },
      { label: "Greedy — Tate McRae",                 value: 1_900_000_000 },
      { label: "Levitating — Dua Lipa",               value: 2_600_000_000 },
      { label: "drivers license — Olivia Rodrigo",    value: 2_400_000_000 },
      { label: "Heat Waves — Glass Animals",          value: 3_100_000_000 },
      { label: "good 4 u — Olivia Rodrigo",           value: 2_300_000_000 },
      { label: "Stitches — Shawn Mendes",             value: 1_900_000_000 },
      { label: "Lose Yourself — Eminem",              value: 1_900_000_000 },
      { label: "Rolling in the Deep — Adele",         value: 2_200_000_000 },
      { label: "Despacito — Luis Fonsi",              value: 2_400_000_000 },
      { label: "Bad Habit — Steve Lacy",              value: 1_600_000_000 },
      { label: "Sunflower — Post Malone & Swae Lee",  value: 4_200_000_000 },
      { label: "Watermelon Sugar — Harry Styles",     value: 2_300_000_000 },
      { label: "Levitating (No DaBaby) — Dua Lipa",   value: 1_300_000_000 },
      { label: "Boyfriend — Selena Gomez",            value:   800_000_000 },
      { label: "Paint The Town Red — Doja Cat",       value: 1_500_000_000 },
    ],
  },

  // Movie worldwide box-office gross, USD millions. Snapshot 2025.
  // Source: Box Office Mojo aggregated.
  movies: {
    label: "Worldwide Box Office",
    unit: "USD",
    formatValue: (v) => `$${(v / 1e6).toFixed(0)}M`,
    blurb: "Which movie made more at the box office?",
    items: [
      { label: "Avatar",                          value: 2_923_000_000 },
      { label: "Avengers: Endgame",               value: 2_799_000_000 },
      { label: "Avatar: The Way of Water",        value: 2_320_000_000 },
      { label: "Titanic",                         value: 2_257_000_000 },
      { label: "Star Wars: The Force Awakens",    value: 2_071_000_000 },
      { label: "Avengers: Infinity War",          value: 2_048_000_000 },
      { label: "Spider-Man: No Way Home",         value: 1_922_000_000 },
      { label: "Inside Out 2",                    value: 1_698_000_000 },
      { label: "Jurassic World",                  value: 1_672_000_000 },
      { label: "Deadpool & Wolverine",            value: 1_338_000_000 },
      { label: "Barbie",                          value: 1_446_000_000 },
      { label: "The Lion King (2019)",            value: 1_657_000_000 },
      { label: "Frozen II",                       value: 1_453_000_000 },
      { label: "Top Gun: Maverick",               value: 1_495_000_000 },
      { label: "The Super Mario Bros. Movie",     value: 1_362_000_000 },
      { label: "Black Panther",                   value: 1_347_000_000 },
      { label: "Harry Potter & Deathly Hallows 2",value: 1_342_000_000 },
      { label: "Oppenheimer",                     value:   974_000_000 },
      { label: "Joker",                           value: 1_078_000_000 },
      { label: "Wonka",                           value:   634_000_000 },
      { label: "Dune: Part Two",                  value:   711_000_000 },
      { label: "Wicked",                          value:   754_000_000 },
      { label: "Inception",                       value:   837_000_000 },
      { label: "Interstellar",                    value:   730_000_000 },
      { label: "The Dark Knight",                 value: 1_006_000_000 },
    ],
  },

  // Instagram followers in millions, snapshot early 2026.
  // Source: Socialblade aggregated rankings.
  instagram: {
    label: "Instagram Followers",
    unit: "followers",
    formatValue: (v) => `${(v / 1e6).toFixed(0)}M followers`,
    blurb: "Who has more Instagram followers?",
    items: [
      { label: "Cristiano Ronaldo",   value: 645_000_000 },
      { label: "Lionel Messi",        value: 510_000_000 },
      { label: "Selena Gomez",        value: 425_000_000 },
      { label: "Kylie Jenner",        value: 400_000_000 },
      { label: "Dwayne Johnson",      value: 395_000_000 },
      { label: "Ariana Grande",       value: 378_000_000 },
      { label: "Kim Kardashian",      value: 365_000_000 },
      { label: "Beyoncé",             value: 320_000_000 },
      { label: "Khloé Kardashian",    value: 305_000_000 },
      { label: "Justin Bieber",       value: 297_000_000 },
      { label: "Kendall Jenner",      value: 295_000_000 },
      { label: "Taylor Swift",        value: 286_000_000 },
      { label: "Neymar Jr",           value: 230_000_000 },
      { label: "Jennifer Lopez",      value: 250_000_000 },
      { label: "Nicki Minaj",         value: 230_000_000 },
      { label: "Miley Cyrus",         value: 220_000_000 },
      { label: "Katy Perry",          value: 210_000_000 },
      { label: "Kourtney Kardashian", value: 222_000_000 },
      { label: "Kevin Hart",          value: 180_000_000 },
      { label: "Cardi B",             value: 175_000_000 },
      { label: "Rihanna",             value: 154_000_000 },
      { label: "Drake",               value: 142_000_000 },
      { label: "Bad Bunny",           value:  46_000_000 },
      { label: "Billie Eilish",       value: 122_000_000 },
      { label: "Zendaya",             value: 195_000_000 },
    ],
  },

  // YouTube channel subscribers in millions, snapshot 2026.
  // Source: Socialblade YouTube rankings.
  youtube: {
    label: "YouTube Subscribers",
    unit: "subscribers",
    formatValue: (v) => `${(v / 1e6).toFixed(0)}M subs`,
    blurb: "Which channel has more subscribers?",
    items: [
      { label: "MrBeast",         value: 360_000_000 },
      { label: "T-Series",        value: 295_000_000 },
      { label: "Cocomelon",       value: 195_000_000 },
      { label: "Like Nastya",     value: 130_000_000 },
      { label: "Vlad and Niki",   value: 130_000_000 },
      { label: "Kids Diana Show", value: 130_000_000 },
      { label: "PewDiePie",       value: 111_000_000 },
      { label: "WWE",             value: 105_000_000 },
      { label: "Zee Music",       value: 110_000_000 },
      { label: "5-Minute Crafts", value:  80_000_000 },
      { label: "Justin Bieber",   value:  74_000_000 },
      { label: "Taylor Swift",    value:  61_000_000 },
      { label: "BLACKPINK",       value:  95_000_000 },
      { label: "BTS (HYBE)",      value:  79_000_000 },
      { label: "Marshmello",      value:  58_000_000 },
      { label: "Eminem",          value:  62_000_000 },
      { label: "Ed Sheeran",      value:  55_000_000 },
      { label: "Rihanna",         value:  44_000_000 },
      { label: "Ariana Grande",   value:  55_000_000 },
      { label: "Bruno Mars",      value:  45_000_000 },
      { label: "Shakira",         value:  43_000_000 },
      { label: "MrBeast Gaming",  value:  47_000_000 },
      { label: "Dude Perfect",    value:  61_000_000 },
      { label: "Markiplier",      value:  37_000_000 },
      { label: "Logan Paul",      value:  24_000_000 },
    ],
  },
};

// Pick two distinct items from a dataset. Returns [left, right] with
// left being the "current" item and right being the new one. Used by
// the game loop — on correct, right slides into left's slot and a
// fresh right is picked.
export function pickPair(datasetKey, exclude = new Set()) {
  const ds = HL_DATASETS[datasetKey];
  if (!ds) return null;
  const available = ds.items.filter((_, i) => !exclude.has(i));
  if (available.length < 2) return null;
  // Sample two distinct items.
  const i1 = Math.floor(Math.random() * available.length);
  let i2 = Math.floor(Math.random() * (available.length - 1));
  if (i2 >= i1) i2 += 1;
  return [available[i1], available[i2]];
}

// Pick a single new item (for the "next round" slide-in), excluding
// the current item and any in `exclude` (so we don't repeat).
export function pickNext(datasetKey, currentIndex, exclude = new Set()) {
  const ds = HL_DATASETS[datasetKey];
  if (!ds) return null;
  const pool = ds.items.map((item, i) => ({ item, i }))
    .filter((p) => p.i !== currentIndex && !exclude.has(p.i));
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return pick.item;
}
