// Solo Arena — single-player mini-game mode. The fix for the
// catastrophic zero-DAU problem where a new user opens VS Arena,
// queues, and stares at "Finding an opponent…" forever because
// nobody's online to match. Solo lets them practice ANY of the 12
// mini-games for personal-best chasing + coin rewards. No opponent
// needed, no waiting, no friend system — just a player and a game.
//
// Flow:
//   1. Client picks a game type → POST /solo/play → server returns
//      { game_type, seed }. Same seed shape as VS/challenges so the
//      client renders the EXACT same component with EXACT same
//      content generation. Zero new client code needed beyond the
//      picker UI.
//   2. Client runs the mini-game locally, captures final score.
//   3. POST /solo/submit { game_type, score } → server clamps via
//      registry, records PB via mini_game_bests, awards coins
//      proportional to score / max_score, increments quest progress.
//
// Coin reward math: floor(score / max_score * 25) — so a perfect
// run on any game pays ~25 coins. New player can grind ~5-10 games
// to afford a cosmetic. Caps prevent farm-bots from running away
// with the economy (a tampered max-score every 10 seconds = 150
// coins/min, still far below what a real VS win pays per minute).
//
// Quest hook: same `online_game_played` style metric so daily quests
// progress on solo games too — keeps players engaged even when
// they're playing alone.

const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { MINI_GAMES, GAME_IDS, clampScore, recordPlay } = require("../minigames");

const router = express.Router();

// POST /solo/play — start a solo round. Body: { game_type? }. If
// omitted, picks one at random. Returns the descriptor the client
// renders via the existing MiniGameRunner.
router.post("/play", requireAuth, (req, res) => {
  const rawType = String(req.body?.game_type || "").trim();
  const gameType = MINI_GAMES[rawType] ? rawType : GAME_IDS[Math.floor(Math.random() * GAME_IDS.length)];
  // Seed is just an integer — same shape pickGames returns.
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  res.json({
    game_type: gameType,
    seed,
    meta: {
      name: MINI_GAMES[gameType].name,
      icon: MINI_GAMES[gameType].icon,
      tagline: MINI_GAMES[gameType].tagline,
      duration_ms: MINI_GAMES[gameType].duration_ms,
      max_score: MINI_GAMES[gameType].max_score,
    },
  });
});

// POST /solo/submit — record a solo result. Body: { game_type, score }.
// Returns { coins_awarded, is_new_best, prev_best, new_best, plays }.
router.post("/submit", requireAuth, (req, res) => {
  const gameType = String(req.body?.game_type || "").trim();
  if (!MINI_GAMES[gameType]) return res.status(400).json({ error: "unknown_game" });
  const rawScore = Number(req.body?.score);
  if (!Number.isFinite(rawScore) || rawScore < 0) return res.status(400).json({ error: "invalid_score" });

  const score = clampScore(gameType, rawScore);
  const maxScore = MINI_GAMES[gameType].max_score;
  // Reward: up to 25 coins for a perfect run, scales linearly with
  // performance. score=0 still pays 0 — no participation reward to
  // avoid bots farming the endpoint with zero engagement.
  const coinsAwarded = Math.floor((score / maxScore) * 25);

  let pb;
  try { pb = recordPlay(req.user.id, gameType, score); }
  catch (e) {
    console.error("[solo/submit] PB record failed", e);
    return res.status(500).json({ error: "submit_failed" });
  }

  if (coinsAwarded > 0) {
    db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?")
      .run(coinsAwarded, Date.now(), req.user.id);
  }

  // Quest hook — bump any "play N solo games" / "play N mini-games
  // today" metrics. Defensive try/catch so quest-system errors
  // don't break the solo flow.
  try {
    const stats = require("./stats");
    if (stats.progressAllQuestsFor) {
      stats.progressAllQuestsFor(req.user.id, [
        { metric: "solo_games_played", amount: 1 },
        { metric: "mini_games_today", amount: 1 },
      ]);
    }
  } catch (e) {}

  res.json({
    ok: true,
    coins_awarded: coinsAwarded,
    score,
    is_new_best: pb.isNewBest,
    prev_best: pb.prevBest,
    new_best: pb.newBest,
    plays: pb.plays,
  });
});

// GET /solo/leaderboard/:game_type — global top-10 for a game.
// Public-ish (auth required so we can show "you" highlighting later)
// — drives the "compete for the global top" hook from Solo Arena.
router.get("/leaderboard/:game_type", requireAuth, (req, res) => {
  const gameType = String(req.params.game_type || "").trim();
  if (!MINI_GAMES[gameType]) return res.status(400).json({ error: "unknown_game" });
  const rows = db.prepare(`
    SELECT u.username, u.avatar, b.best_score, b.updated_at
    FROM mini_game_bests b
    JOIN users u ON u.id = b.user_id
    WHERE b.game_type = ? AND u.banned_at IS NULL
    ORDER BY b.best_score DESC, b.updated_at ASC
    LIMIT 25
  `).all(gameType);
  res.json({ game_type: gameType, leaderboard: rows });
});

module.exports = router;
