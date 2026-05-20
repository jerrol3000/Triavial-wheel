const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { pickGames, clampScore, MATCH_LENGTH, recordPlay } = require("../minigames");

const router = express.Router();

const CHALLENGE_QUESTION_COUNT = MATCH_LENGTH; // legacy name; now = mini-game count
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_WAGER = 0;
const MAX_WAGER = 500;

// Pick 5 mini-games for a new challenge. Deterministic per (sender,
// timestamp + random) so both players in the challenge see the EXACT
// same sequence of mini-games — comparable scores require comparable
// inputs. The legacy `questions_json` column stores the [{type, seed, idx}]
// array (we keep the column name to avoid a destructive migration;
// the content is now games, not questions).
function pickGamesForChallenge(senderId) {
  const seed = `chal|${senderId}|${Date.now()}|${Math.random().toString(36).slice(2)}`;
  return pickGames(seed, CHALLENGE_QUESTION_COUNT);
}

// Resolve a challenge once both players have played (or the receiver
// hit the 24h expiry without playing). Wager handling:
//   - winner: take both sides' wagers
//   - tie: each side gets their own wager back
//   - timeout (receiver didn't play): sender gets the wager back (we
//     don't charge no-show penalties since the sender chose to
//     initiate; punishing them for slow opponents would discourage
//     sending challenges).
function resolveChallenge(cid) {
  const row = db.prepare("SELECT * FROM friend_challenges WHERE id = ?").get(cid);
  if (!row || row.status !== "pending") return null;
  const now = Date.now();

  // Helper: refund a player's wager.
  const refund = (userId, amount) => {
    if (amount <= 0) return;
    db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?")
      .run(amount, now, userId);
  };

  let winnerId = null;
  let status = "resolved";
  if (row.receiver_correct === null && row.expires_at <= now) {
    // Receiver didn't play in time. Sender gets their wager back.
    refund(row.sender_id, row.wager);
    status = "expired";
  } else if (row.sender_correct !== null && row.receiver_correct !== null) {
    if (row.sender_correct > row.receiver_correct) winnerId = row.sender_id;
    else if (row.receiver_correct > row.sender_correct) winnerId = row.receiver_id;
    else if ((row.sender_time_ms || 0) < (row.receiver_time_ms || 0)) winnerId = row.sender_id;
    else if ((row.receiver_time_ms || 0) < (row.sender_time_ms || 0)) winnerId = row.receiver_id;
    // If still tied (equal score + equal time, the dream tie),
    // refund both.
    if (winnerId) {
      refund(winnerId, row.wager * 2);
    } else {
      refund(row.sender_id, row.wager);
      refund(row.receiver_id, row.wager);
    }
  } else {
    // Not ready to resolve yet (one side hasn't played, no timeout).
    return null;
  }

  db.prepare("UPDATE friend_challenges SET status = ?, winner_id = ?, resolved_at = ? WHERE id = ?")
    .run(status, winnerId, now, cid);

  // Realtime push to both players so they see the result instantly.
  try {
    const realtime = require("../realtime");
    if (realtime.sendToUser) {
      const note = {
        type: "notification",
        notification: {
          id: `challenge-${cid}-${now}`,
          type: "challenge_resolved",
          icon: status === "expired" ? "⏰" : (winnerId ? "🏆" : "🤝"),
          title: status === "expired" ? "Challenge expired" : (winnerId ? "Challenge result in" : "Tie!"),
          text: status === "expired" ? "Your opponent didn't play in time. Wager refunded."
                : winnerId === row.sender_id ? `You won a challenge${row.wager > 0 ? ` · +${row.wager * 2} coins` : ""}`
                : winnerId === row.receiver_id ? `Your opponent won the challenge${row.wager > 0 ? ` · −${row.wager} coins` : ""}`
                : "Tie — both wagers refunded.",
          at: now,
          actor: null,
          challenge_id: cid,
        },
      };
      realtime.sendToUser(row.sender_id, note);
      realtime.sendToUser(row.receiver_id, note);
      // Also send the lightweight `challenge_update` so any open
      // FriendChallenges screen re-fetches and animates the new
      // resolved card into view. Decoupled from the bell payload so
      // the screen can react instantly even if the user's bell is
      // already open (which suppresses the live shake handler).
      const update = { type: "challenge_update", subtype: "resolved", challenge_id: cid };
      realtime.sendToUser(row.sender_id, update);
      realtime.sendToUser(row.receiver_id, update);
    }
  } catch (e) {}

  return { status, winner_id: winnerId };
}

// Lazy expiry sweep — called at the top of each list endpoint so we
// don't need a dedicated cron job for the 24h timeout. Cheap (one
// SELECT, one UPDATE per stale row) and bounded by how many
// challenges the user has.
function sweepExpired(userId) {
  const now = Date.now();
  const stale = db.prepare(
    `SELECT id FROM friend_challenges
     WHERE (sender_id = ? OR receiver_id = ?)
       AND status = 'pending'
       AND expires_at <= ?
       AND receiver_correct IS NULL`
  ).all(userId, userId, now);
  for (const s of stale) resolveChallenge(s.id);
}

// POST /challenges/send — create a new challenge. Body: { friend_id,
// wager? }. Wager is locked from the sender's coins immediately
// (so they can't pre-empt the resolve by spending it).
router.post("/send", requireAuth, (req, res) => {
  const friendId = Number(req.body && req.body.friend_id);
  const wager = Math.max(MIN_WAGER, Math.min(MAX_WAGER, Number(req.body && req.body.wager) | 0));
  if (!Number.isInteger(friendId) || friendId <= 0) return res.status(400).json({ error: "invalid_friend" });
  if (friendId === req.user.id) return res.status(400).json({ error: "cannot_challenge_self" });

  // Confirm they're actually friends. The friends router stores
  // accepted friendships in `friendships` with status='accepted';
  // either direction counts.
  const friendship = db.prepare(
    `SELECT 1 FROM friendships WHERE status = 'accepted' AND
       ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))`
  ).get(req.user.id, friendId, friendId, req.user.id);
  if (!friendship) return res.status(403).json({ error: "not_friends" });

  // Cap to one OPEN challenge per (sender, receiver) at a time — stops
  // spam-griefing your friend with 10 simultaneous challenges.
  const existing = db.prepare(
    `SELECT id FROM friend_challenges
     WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'`
  ).get(req.user.id, friendId);
  if (existing) return res.status(409).json({ error: "challenge_already_open", challenge_id: existing.id });

  let response;
  try {
    const tx = db.transaction(() => {
      // Lock the wager from the sender's coins.
      if (wager > 0) {
        const dec = db.prepare(
          "UPDATE stats SET coins = coins - ?, updated_at = ? WHERE user_id = ? AND coins >= ?"
        ).run(wager, Date.now(), req.user.id, wager);
        if (dec.changes !== 1) { response = { status: 400, body: { error: "insufficient_funds" } }; return; }
      }
      const games = pickGamesForChallenge(req.user.id);
      if (games.length < CHALLENGE_QUESTION_COUNT) {
        // Rollback the wager debit by re-adding (we're inside the tx).
        if (wager > 0) {
          db.prepare("UPDATE stats SET coins = coins + ? WHERE user_id = ?").run(wager, req.user.id);
        }
        response = { status: 500, body: { error: "game_pool_too_small" } };
        return;
      }
      const now = Date.now();
      const ins = db.prepare(`
        INSERT INTO friend_challenges
          (sender_id, receiver_id, questions_json, wager, created_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(req.user.id, friendId, JSON.stringify(games), wager, now, now + CHALLENGE_TTL_MS);
      response = { status: 200, body: { ok: true, challenge_id: ins.lastInsertRowid } };
    });
    tx.immediate();
  } catch (e) {
    console.error("[challenges/send] failed", e);
    return res.status(500).json({ error: "send_failed" });
  }
  if (response.status !== 200) return res.status(response.status).json(response.body);

  // Realtime push to receiver so they see the challenge land.
  try {
    const realtime = require("../realtime");
    if (realtime.sendToUser) {
      const sender = db.prepare("SELECT username FROM users WHERE id = ?").get(req.user.id);
      realtime.sendToUser(friendId, {
        type: "notification",
        notification: {
          id: `challenge-incoming-${response.body.challenge_id}`,
          type: "challenge_received",
          icon: "⚔️",
          title: "Challenge received!",
          text: `${sender?.username || "A friend"} sent you a 5-question challenge${wager > 0 ? ` · ${wager} coin wager` : ""}.`,
          at: Date.now(),
          actor: null,
          challenge_id: response.body.challenge_id,
        },
      });
    }
  } catch (e) {}

  res.json(response.body);
});

// GET /challenges — list all challenges involving this user. Used by
// the FriendChallenges screen to render incoming / outgoing / past.
// Lazily sweeps stale challenges first so the list never shows a
// "still pending" row that's actually 25h old.
//
// Returns a BARE ARRAY of challenge rows. (We had briefly returned
// { challenges, h2h } here, but any browser still running the cached
// old client crashed on .filter() of the object — back-compat is
// cheap to preserve and the H2H data lives at /challenges/h2h.)
//
// Hidden-row filter: each user can independently dismiss a past
// (non-pending) challenge from their own list view via /:id/dismiss
// or /clear-history. We exclude those server-side here so the client
// doesn't have to know about per-user visibility flags.
router.get("/", requireAuth, (req, res) => {
  sweepExpired(req.user.id);
  const rows = db.prepare(`
    SELECT c.*,
           us.username AS sender_username,
           ur.username AS receiver_username
    FROM friend_challenges c
    JOIN users us ON us.id = c.sender_id
    JOIN users ur ON ur.id = c.receiver_id
    WHERE
      (c.sender_id = ? AND c.hidden_by_sender = 0)
      OR (c.receiver_id = ? AND c.hidden_by_receiver = 0)
    ORDER BY c.created_at DESC
    LIMIT 50
  `).all(req.user.id, req.user.id);
  // Hide questions_json from the response (we only send the questions
  // when the receiver actually plays via /play).
  res.json(rows.map((r) => {
    const { questions_json, ...rest } = r;
    return rest;
  }));
});

// GET /challenges/h2h — head-to-head records vs every opponent the
// user has played: { [opponentId]: { wins, losses, ties } }. Drives
// the "you're 3-1 against Alex" rivalry chip — one of the strongest
// 1v1 re-engagement hooks in any game. Kept as a separate endpoint
// (rather than inlined into /challenges/) so a cached older client
// that only knows the bare-array list response can keep working
// during a rolling deploy.
router.get("/h2h", requireAuth, (req, res) => {
  const me = req.user.id;
  const h2hRows = db.prepare(`
    SELECT
      CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS opp_id,
      SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN winner_id IS NOT NULL AND winner_id != ? AND status = 'resolved' THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN winner_id IS NULL AND status = 'resolved' THEN 1 ELSE 0 END) AS ties
    FROM friend_challenges
    WHERE (sender_id = ? OR receiver_id = ?) AND status IN ('resolved','expired')
    GROUP BY opp_id
  `).all(me, me, me, me, me);
  const h2h = {};
  for (const r of h2hRows) {
    h2h[r.opp_id] = { wins: r.wins | 0, losses: r.losses | 0, ties: r.ties | 0 };
  }
  res.json({ h2h });
});

// GET /challenges/:id — fetch the challenge + its questions (only if
// the user is involved AND hasn't already played their side AND it's
// still pending).
router.get("/:id/play", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM friend_challenges WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "not_found" });
  const isSender = row.sender_id === req.user.id;
  const isReceiver = row.receiver_id === req.user.id;
  if (!isSender && !isReceiver) return res.status(403).json({ error: "not_yours" });
  if (row.status !== "pending") return res.status(400).json({ error: "already_resolved" });
  if (Date.now() > row.expires_at) return res.status(400).json({ error: "expired" });
  if (isSender && row.sender_correct !== null) return res.status(400).json({ error: "already_played" });
  if (isReceiver && row.receiver_correct !== null) return res.status(400).json({ error: "already_played" });
  let games = [];
  try { games = JSON.parse(row.questions_json); } catch (e) {}
  // Receiver sees the sender's per-round scores (if the sender has
  // already played) so the client can compute round-by-round
  // round_wins on submit. Sender doesn't get receiver's scores
  // because the sender plays first by construction — and even if
  // the order ever flipped, leaking the receiver's scores to the
  // still-unplayed sender would let them pace themselves.
  let senderScores = null;
  if (isReceiver && row.sender_scores_json) {
    try { senderScores = JSON.parse(row.sender_scores_json); } catch (e) {}
  }
  res.json({
    id: row.id,
    sender_id: row.sender_id,
    receiver_id: row.receiver_id,
    wager: row.wager,
    // Keep both keys so an old client that reads `questions` doesn't
    // hard-crash before the new bundle deploys.
    games,
    questions: games,
    match_length: games.length,
    sender_scores: senderScores,
  });
});

// POST /challenges/:id/submit — submit this player's mini-game result.
// Body shape for the Arena (mini-games):
//   { round_wins: int (0..5), scores: [int, int, int, int, int], time_ms: int }
// Back-compat: the original trivia client posted { correct, time_ms }
// where `correct` was the count of correct trivia answers; we still
// accept that as a `round_wins` proxy so an old bundle in flight
// doesn't 400.
//
// `round_wins` is the number of mini-game rounds this player WON
// against the opposing player's score for that game (computed by the
// CLIENT after both sides finish, since the receiver plays AFTER the
// sender and has the sender's scores visible). For the first player
// to submit, round_wins is 0 (they haven't compared yet) and the
// scores array is what actually drives the comparison later.
//
// The stored column `sender_correct` / `receiver_correct` now means
// "round_wins" rather than "trivia correct count". Schema didn't
// change — the semantics did. resolveChallenge() already compares
// the two values numerically with the higher one winning, which is
// the right behavior for round_wins too.
router.post("/:id/submit", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const rawRoundWins = body.round_wins !== undefined ? body.round_wins : body.correct;
  const roundWins = Math.max(0, Math.min(CHALLENGE_QUESTION_COUNT, Number(rawRoundWins) | 0));
  const timeMs = Math.max(1000, Math.min(15 * 60 * 1000, Number(body.time_ms) | 0));
  // Persist per-round scores too (separately from round_wins) so the
  // receiver can compare round-by-round against the sender's scores
  // when they play. Stored in the legacy time_ms is just the cumulative
  // time; the per-round scores live in a new JSON column added below.
  const rawScores = Array.isArray(body.scores) ? body.scores : null;

  const row = db.prepare("SELECT * FROM friend_challenges WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "not_found" });
  const isSender = row.sender_id === req.user.id;
  const isReceiver = row.receiver_id === req.user.id;
  if (!isSender && !isReceiver) return res.status(403).json({ error: "not_yours" });
  if (row.status !== "pending") return res.status(400).json({ error: "already_resolved" });

  // Already-submitted guard (covered separately in this file's
  // SECURITY: Friend Challenge /submit allowed score manipulation
  // commit). Stays unchanged.
  if (isSender && row.sender_correct !== null) return res.status(400).json({ error: "already_played" });
  if (isReceiver && row.receiver_correct !== null) return res.status(400).json({ error: "already_played" });

  // If receiver is submitting, lock their wager from coins now.
  if (isReceiver && row.wager > 0) {
    const dec = db.prepare(
      "UPDATE stats SET coins = coins - ?, updated_at = ? WHERE user_id = ? AND coins >= ?"
    ).run(row.wager, Date.now(), req.user.id, row.wager);
    if (dec.changes !== 1) return res.status(400).json({ error: "insufficient_funds" });
  }

  // Clamp the per-round scores to each game's registered max_score
  // BEFORE storing — defense against a tampered client posting
  // 99999 for a tap_race. The minigames module owns the cap table.
  // Also run each cleaned score through recordPlay() to update the
  // submitter's PB. Collect any PB hits so we can echo them back in
  // the HTTP response, which the client then turns into a toast.
  let cleanedScores = null;
  const pbHits = [];
  if (rawScores) {
    let games = [];
    try { games = JSON.parse(row.questions_json || "[]"); } catch (e) {}
    cleanedScores = rawScores.slice(0, games.length).map((s, i) => clampScore(games[i]?.type, s));
    for (let i = 0; i < cleanedScores.length; i++) {
      const gType = games[i]?.type;
      if (!gType) continue;
      try {
        const pb = recordPlay(req.user.id, gType, cleanedScores[i]);
        if (pb.isNewBest) pbHits.push({ game_type: gType, score: pb.score, prevBest: pb.prevBest });
      } catch (e) {}
    }
  }
  const scoresJson = cleanedScores ? JSON.stringify(cleanedScores) : null;

  if (isSender) {
    db.prepare("UPDATE friend_challenges SET sender_correct = ?, sender_time_ms = ?, sender_scores_json = ? WHERE id = ?")
      .run(roundWins, timeMs, scoresJson, id);
  } else {
    db.prepare("UPDATE friend_challenges SET receiver_correct = ?, receiver_time_ms = ?, receiver_scores_json = ? WHERE id = ?")
      .run(roundWins, timeMs, scoresJson, id);
  }

  const after = db.prepare("SELECT * FROM friend_challenges WHERE id = ?").get(id);
  let result = null;
  if (after.sender_correct !== null && after.receiver_correct !== null) {
    result = resolveChallenge(id);
  } else {
    // Only ONE side has played so far — push a "challenge_played" event
    // to the WAITING side so their UI doesn't sit on "pending" until
    // they manually refresh. This was the root cause of the dead-feeling
    // friend-challenge flow: A sent, B played, A's screen stayed
    // "pending" because no event was sent until full resolution.
    // The waiting side also learns the opponent's score immediately so
    // anticipation builds ("they got 4/5 — can I beat that?").
    try {
      const realtime = require("../realtime");
      if (realtime.sendToUser) {
        const playerName = db.prepare("SELECT username FROM users WHERE id = ?").get(req.user.id);
        const waitingFor = isSender ? after.receiver_id : after.sender_id;
        const playerScore = isSender ? after.sender_correct : after.receiver_correct;
        // Two-track delivery:
        //   1. `challenge_update`: a lightweight "something changed,
        //      refresh your list" signal for any open FriendChallenges
        //      screen. Cheap to consume — the client just refetches.
        //   2. `notification`: the canonical bell-shake event so the
        //      waiting player sees a badge even if they're on a
        //      different screen. Persists into the bell list.
        realtime.sendToUser(waitingFor, {
          type: "challenge_update",
          subtype: "played",
          challenge_id: id,
          played_by: req.user.id,
          their_correct: playerScore,
        });
        realtime.sendToUser(waitingFor, {
          type: "notification",
          notification: {
            id: `challenge-played-${id}-${Date.now()}`,
            type: "challenge_played",
            icon: isSender ? "📬" : "🎯",
            title: isSender
              ? `${playerName?.username || "Your friend"} is playing your challenge…`
              : `${playerName?.username || "Your friend"} answered`,
            text: isSender
              ? `They just locked in their score — full result lands when you play.`
              : `They scored ${playerScore}/${CHALLENGE_QUESTION_COUNT} — your turn to beat it.`,
            at: Date.now(),
            actor: null,
            challenge_id: id,
            actionType: "view_friends",
          },
        });
      }
    } catch (e) { /* notification is best-effort */ }
  }
  res.json({ ok: true, result, pb_hits: pbHits });
});

// POST /challenges/:id/cancel — sender-initiated teardown of a still-
// pending challenge. Refunds the wager and removes the challenge from
// the receiver's incoming list. Only allowed while the receiver hasn't
// played yet — once they've locked in their answer, letting the sender
// bail would be an escape hatch from a likely loss + a wager-grief
// vector ("send 10 challenges, watch which one they answer first,
// cancel the rest after seeing their score").
router.post("/:id/cancel", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_id" });
  const row = db.prepare("SELECT * FROM friend_challenges WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.sender_id !== req.user.id) return res.status(403).json({ error: "not_sender" });
  if (row.status !== "pending") return res.status(400).json({ error: "not_cancellable" });
  if (row.receiver_correct !== null) return res.status(400).json({ error: "receiver_already_played" });

  const now = Date.now();
  let alreadyCancelled = false;
  try {
    const tx = db.transaction(() => {
      // Mark cancelled + auto-hide for the sender. The WHERE clause
      // gates on status='pending' so a duplicate-in-flight call can't
      // flip the row twice. We THEN check changes to also gate the
      // refund — without this, a future deployment where the SELECT
      // / handler isn't serialized by Node's single thread (cluster
      // mode, multi-process, async refactor) could double-credit
      // coins. Today better-sqlite3 sync + single-process makes the
      // race impossible, but the cost of the changes-check is one
      // SQLite return-value read.
      const upd = db.prepare(`
        UPDATE friend_challenges
        SET status = 'cancelled', resolved_at = ?, hidden_by_sender = 1
        WHERE id = ? AND status = 'pending'
      `).run(now, id);
      if (upd.changes === 0) { alreadyCancelled = true; return; }
      // Refund the wager. The sender locked it at /send time; nothing
      // else has touched it since (receiver hasn't played).
      if (row.wager > 0) {
        db.prepare("UPDATE stats SET coins = coins + ?, updated_at = ? WHERE user_id = ?")
          .run(row.wager, now, req.user.id);
      }
    });
    tx.immediate();
  } catch (e) {
    console.error("[challenges/cancel] failed", e);
    return res.status(500).json({ error: "cancel_failed" });
  }
  // Lost the race with a concurrent cancel (or the row flipped between
  // the SELECT and the UPDATE). Surface the same error code as the
  // pre-tx status check would have, so the client sees a consistent
  // "not_cancellable" rather than a misleading 200 + refunded=0.
  if (alreadyCancelled) return res.status(400).json({ error: "not_cancellable" });

  // Realtime: refresh the receiver's list (the row should drop out of
  // their incoming) + a soft notification so they know what happened.
  try {
    const realtime = require("../realtime");
    if (realtime.sendToUser) {
      realtime.sendToUser(row.receiver_id, { type: "challenge_update", subtype: "cancelled", challenge_id: id });
      // Bell notification only fires for the RECEIVER — the sender
      // initiated it, they don't need to be reminded.
      const senderName = db.prepare("SELECT username FROM users WHERE id = ?").get(req.user.id);
      realtime.sendToUser(row.receiver_id, {
        type: "notification",
        notification: {
          id: `challenge-cancelled-${id}-${now}`,
          type: "challenge_cancelled",
          icon: "🚫",
          title: "Challenge withdrawn",
          text: `${senderName?.username || "Your friend"} cancelled their challenge.`,
          at: now,
          actor: null,
          challenge_id: id,
        },
      });
    }
  } catch (e) {}

  res.json({ ok: true, refunded: row.wager });
});

// POST /challenges/:id/dismiss — hide a SINGLE past (non-pending) row
// from the caller's list. Doesn't affect the opponent's view or any
// H2H/stats counters; this is purely UI clutter management.
router.post("/:id/dismiss", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_id" });
  const row = db.prepare("SELECT sender_id, receiver_id, status FROM friend_challenges WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "not_found" });
  const isSender = row.sender_id === req.user.id;
  const isReceiver = row.receiver_id === req.user.id;
  if (!isSender && !isReceiver) return res.status(403).json({ error: "not_yours" });
  // Refuse to hide a still-pending row — that would let the user
  // hide a challenge they sent without resolving it (and the wager
  // would stay locked forever). They have to /cancel to clear it out.
  if (row.status === "pending") return res.status(400).json({ error: "still_pending", hint: "Use /cancel instead." });
  const col = isSender ? "hidden_by_sender" : "hidden_by_receiver";
  db.prepare(`UPDATE friend_challenges SET ${col} = 1 WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// POST /challenges/clear-history — bulk-hide every non-pending
// challenge from the caller's view in one tap. Useful when the past-
// results list has gotten long; pending challenges are deliberately
// excluded (they need to be cancelled or resolved, not dismissed).
//
// The WHERE clause specifically targets rows that are NOT YET hidden
// for the caller's role — so `cleared` reports the count of rows that
// JUST disappeared from their view, not the count of all matching
// rows. Without the role-aware AND clause, a second call returned a
// misleading non-zero count (because /:id/cancel auto-hides for the
// sender, those rows would be re-flagged on every call). Now the
// endpoint is properly idempotent: second call → cleared=0.
router.post("/clear-history", requireAuth, (req, res) => {
  const me = req.user.id;
  const result = db.prepare(`
    UPDATE friend_challenges
    SET hidden_by_sender = CASE WHEN sender_id = ? THEN 1 ELSE hidden_by_sender END,
        hidden_by_receiver = CASE WHEN receiver_id = ? THEN 1 ELSE hidden_by_receiver END
    WHERE status != 'pending'
      AND ((sender_id = ? AND hidden_by_sender = 0) OR (receiver_id = ? AND hidden_by_receiver = 0))
  `).run(me, me, me, me);
  res.json({ ok: true, cleared: result.changes });
});

module.exports = router;
