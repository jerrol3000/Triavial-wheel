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
  // Anomaly — the WebGL Pixi flagship with custom plasma shader +
  // multi-anomaly scaling + containment cinematic at score cap.
  catch_bug: {
    id: "catch_bug",
    name: "Anomaly",
    icon: "✦",
    tagline: "Contain the field. Core stacks for ×N.",
    duration_ms: 10000,
    higher_wins: true,
    max_score: 25,
  },
  // Cascade — matter.js physics + 4 orb types + perfect tier + MEGA
  // ORB once per round.
  bubble_pop: {
    id: "bubble_pop",
    name: "Cascade",
    icon: "◇",
    tagline: "Hit at the peak. Mega orb spawns at 18.",
    duration_ms: 10000,
    higher_wins: true,
    max_score: 50, // raised — mega + chain reactions push the ceiling
  },
  // Neon Strike Arena — DISABLED. Full 3D FPS implementation needs
  // proper 3D assets (in-progress via Meshy.ai) + multiplayer netcode
  // before it's player-facing again. Re-enable by uncommenting the
  // entry below.
  //
  // neon_strike: {
  //   id: "neon_strike",
  //   name: "Neon Strike",
  //   icon: "◈",
  //   tagline: "Phase. Dash. Strike. 90-second cyber arena.",
  //   duration_ms: 90000,
  //   higher_wins: true,
  //   max_score: 200,
  // },
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

// Personal-best upsert. Called on every score-submitting code path
// (VS recordAnswer, friend challenge /submit, /solo/submit). Returns
// { isNewBest, prevBest, newBest, plays }. isNewBest=true → caller
// should fire a PB celebration push or include it in their response
// for the client to toast.
//
// Schema: mini_game_bests (user_id, game_type, best_score, plays_count,
// updated_at). Created in db.js. The MAX/+1 happen in one SQL upsert
// so a concurrent submit can't race itself into a wrong total. We
// always clamp the incoming score first so a tampered client can't
// inflate the PB beyond the game's registered max.
const db = require("./db");
function recordPlay(userId, gameType, rawScore) {
  if (!MINI_GAMES[gameType]) return { isNewBest: false, prevBest: 0, newBest: 0, plays: 0 };
  const score = clampScore(gameType, rawScore);
  const now = Date.now();
  const existing = db.prepare(
    "SELECT best_score, plays_count FROM mini_game_bests WHERE user_id = ? AND game_type = ?"
  ).get(userId, gameType);
  const prevBest = existing ? existing.best_score : 0;
  const newBest = Math.max(prevBest, score);
  const plays = (existing ? existing.plays_count : 0) + 1;
  db.prepare(`
    INSERT INTO mini_game_bests (user_id, game_type, best_score, plays_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, game_type) DO UPDATE SET
      best_score = MAX(mini_game_bests.best_score, excluded.best_score),
      plays_count = mini_game_bests.plays_count + 1,
      updated_at = CASE
        WHEN mini_game_bests.best_score < excluded.best_score THEN excluded.updated_at
        ELSE mini_game_bests.updated_at
      END
  `).run(userId, gameType, score, plays, now);
  return { isNewBest: score > prevBest && score > 0, prevBest, newBest, plays, score };
}

function getBests(userId) {
  const rows = db.prepare(
    "SELECT game_type, best_score, plays_count, updated_at FROM mini_game_bests WHERE user_id = ?"
  ).all(userId);
  const out = {};
  for (const r of rows) out[r.game_type] = { best: r.best_score, plays: r.plays_count, at: r.updated_at };
  return out;
}

module.exports = {
  MINI_GAMES,
  GAME_IDS,
  MATCH_LENGTH,
  pickGames,
  clampScore,
  compareScores,
  recordPlay,
  getBests,
};
