// Mini-game registry for Spinlore Arena.
//
// This is the content layer that replaced trivia. Each entry describes
// one playable round: a name + icon + duration + sane score upper bound.
//
// Architecturally, mini-games are "rounds" that get sequenced into a
// match (1v1 VS), a challenge (async friend H2H), or a daily set. The
// CLIENT renders the actual game, runs the timer, and submits a final
// score. The SERVER:
//   - Picks the sequence deterministically (so both players in a VS
//     match play the SAME games, in the SAME order, with the SAME
//     content seeds — fair race).
//   - Sanitizes / clamps the submitted score to its registered
//     max_score, so a tampered client can't post 999999 taps.
//   - Resolves rounds by comparing two players' scores given the
//     game's `higher_wins` flag.
//
// Adding a new mini-game = add an entry here + add the matching React
// component in src/minigames/. No other server work required: the
// picker, score clamp, and round resolver are all generic.

const MINI_GAMES = {
  tap_race: {
    id: "tap_race",
    name: "Tap Race",
    icon: "👆",
    tagline: "Tap as fast as you can!",
    // 5-second tap window. Humans cap around 8-10 taps/sec; we cap
    // generously at 15/sec = 75 to leave space for fast-but-real,
    // reject single-fingered macro spam.
    duration_ms: 5000,
    higher_wins: true,
    max_score: 75,
  },
  reaction: {
    id: "reaction",
    name: "Reaction",
    icon: "⚡",
    tagline: "Wait for green, tap fast!",
    // Score = max(0, 1000 - reaction_ms). 1000 is theoretical max,
    // sub-150ms human reaction is essentially impossible (Olympic
    // sprinters average 150ms+). Capping the score at 900 enforces
    // that floor server-side.
    duration_ms: 8000,
    higher_wins: true,
    max_score: 900,
  },
  color_match: {
    id: "color_match",
    name: "Color Match",
    icon: "🎨",
    tagline: "Match the COLOR, not the word!",
    // 12 seconds, ~10 questions possible at 1.2s each. Cap at 12.
    duration_ms: 12000,
    higher_wins: true,
    max_score: 12,
  },
  memory: {
    id: "memory",
    name: "Memory",
    icon: "🧠",
    tagline: "Repeat the sequence!",
    // Level reached. Beating 20 is effectively impossible on a small
    // screen.
    duration_ms: 60000,
    higher_wins: true,
    max_score: 20,
  },
  quick_math: {
    id: "quick_math",
    name: "Quick Math",
    icon: "🔢",
    tagline: "Solve as many as you can!",
    // 15-second window. ~1.5s/question with 4-choice multiple choice
    // is realistic, cap at 15.
    duration_ms: 15000,
    higher_wins: true,
    max_score: 15,
  },
  bubble_pop: {
    id: "bubble_pop",
    name: "Bubble Pop",
    icon: "🫧",
    tagline: "Pop bubbles before they vanish!",
    // 10s window. Bubbles spawn every ~350ms, live ~1200ms. Realistic
    // ceiling is ~25 pops on a phone; cap at 35 for headroom.
    duration_ms: 10000,
    higher_wins: true,
    max_score: 35,
  },
  whack: {
    id: "whack",
    name: "Whack-a-Mole",
    icon: "🔨",
    tagline: "Whack 'em before they hide!",
    // 12s. 3×3 grid, 1-3 moles up at any moment. Cap at 30 — a
    // perfect player on a small screen would top out around 25.
    duration_ms: 12000,
    higher_wins: true,
    max_score: 30,
  },
  odd_one_out: {
    id: "odd_one_out",
    name: "Odd One Out",
    icon: "👀",
    tagline: "Spot the different one!",
    // 12s. Each round shows a 3×3 grid with one cell shaded slightly
    // off — the difficulty ramps as you score (smaller color delta).
    duration_ms: 12000,
    higher_wins: true,
    max_score: 18,
  },
  sequence_tap: {
    id: "sequence_tap",
    name: "Number Rush",
    icon: "1️⃣",
    tagline: "Tap 1, 2, 3… in order!",
    // 15s. Numbers 1-12 scrambled, tap in order; new scramble on
    // completion. Score = total correct taps. Cap 60 (5 full rounds).
    duration_ms: 15000,
    higher_wins: true,
    max_score: 60,
  },
  catch_bug: {
    id: "catch_bug",
    name: "Catch the Bug",
    icon: "🐛",
    tagline: "Tap the bug — it teleports!",
    // 10s. Bug emoji teleports to a new random spot every time it's
    // tapped (and every ~900ms if not). Cap 25.
    duration_ms: 10000,
    higher_wins: true,
    max_score: 25,
  },
  memorize: {
    id: "memorize",
    name: "Memorize",
    icon: "👁️",
    tagline: "Was that emoji in the set?",
    // 15s. Flash 5-7 emoji for ~1.5s, then ask yes/no on a probe
    // emoji. Multiple rounds. Cap 12.
    duration_ms: 15000,
    higher_wins: true,
    max_score: 12,
  },
  hilo_sprint: {
    id: "hilo_sprint",
    name: "Higher / Lower Sprint",
    icon: "📊",
    tagline: "Higher or lower than the last?",
    // 12s. Show a number, then a new one — higher or lower? 2 buttons.
    // Each correct, new number takes the place of the previous.
    // Cap 20.
    duration_ms: 12000,
    higher_wins: true,
    max_score: 20,
  },
};

const GAME_IDS = Object.keys(MINI_GAMES);
const MATCH_LENGTH = 5; // 5 mini-games per match / challenge / daily

// Deterministic shuffle by seed → array of {type, seed, idx}.
// Identical seed string → identical game order + identical per-game
// seeds, so two players in the same VS match (or a friend challenge)
// always play the same content in the same order.
//
// If MATCH_LENGTH > GAME_IDS.length (e.g. once we add more games and
// pick 5 out of 10), it slices the shuffled list. If equal (today's
// state: 5 games, MATCH_LENGTH = 5), it's "every match plays all 5
// in a different order".
function pickGames(seedStr, count = MATCH_LENGTH) {
  let s = 0;
  const str = String(seedStr || `default-${Date.now()}`);
  for (let i = 0; i < str.length; i++) s = (Math.imul(s, 31) + str.charCodeAt(i)) >>> 0;
  // Fisher-Yates deterministic shuffle.
  const order = [...GAME_IDS];
  for (let i = order.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const picks = order.slice(0, Math.min(count, order.length));
  return picks.map((type, idx) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return { type, seed: s, idx };
  });
}

// Clamp a client-submitted score to its game's registered max_score.
// Called before persistence so a tampered client posting 999999 just
// gets max_score recorded. Also normalizes non-numerics to 0.
function clampScore(gameType, raw) {
  const meta = MINI_GAMES[gameType];
  if (!meta) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(meta.max_score, Math.floor(n));
}

// Round-winner resolver: given two player scores on the same game,
// returns 1 / -1 / 0 (player1 wins / player2 wins / tie). The
// `higher_wins` flag inverts the comparison for games where lower
// is better (currently none — reaction folds inversion into its
// score directly — but the registry supports it).
function compareScores(gameType, s1, s2) {
  const meta = MINI_GAMES[gameType];
  if (!meta) return 0;
  if (s1 === s2) return 0;
  if (meta.higher_wins) return s1 > s2 ? 1 : -1;
  return s1 < s2 ? 1 : -1;
}

module.exports = {
  MINI_GAMES,
  GAME_IDS,
  MATCH_LENGTH,
  pickGames,
  clampScore,
  compareScores,
};
