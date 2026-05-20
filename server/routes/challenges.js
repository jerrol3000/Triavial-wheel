const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { pickDailyQuestions } = require("../questions");

const router = express.Router();

const CHALLENGE_QUESTION_COUNT = 5;
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_WAGER = 0;
const MAX_WAGER = 500;

// Pick 5 questions for a new challenge. Deterministic per (sender,
// timestamp) so both players see the exact same questions in the
// exact same order — comparable scores require comparable inputs.
// We reuse the daily picker's seed mechanism by passing a synthetic
// date string built from sender + epoch ms; pickDailyQuestions
// hashes the string for entropy so any unique seed gives a unique
// 5-question pull from the pool.
function pickQuestionsForChallenge(senderId) {
  const seed = `chal|${senderId}|${Date.now()}|${Math.random().toString(36).slice(2)}`;
  // pickDailyQuestions caches in daily_questions by `date` string —
  // we don't want to pollute that table. Sample directly from the
  // questions pool instead.
  const candidates = db.prepare(
    `SELECT * FROM questions WHERE difficulty IN ('easy','medium') ORDER BY id ASC`
  ).all();
  if (candidates.length < CHALLENGE_QUESTION_COUNT) return [];
  // Same xorshift hash + LCG mix as the daily picker.
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (Math.imul(s, 31) + seed.charCodeAt(i)) >>> 0;
  const picks = [];
  const used = new Set();
  while (picks.length < CHALLENGE_QUESTION_COUNT) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const i = s % candidates.length;
    if (!used.has(i)) { used.add(i); picks.push(candidates[i]); }
    if (used.size === candidates.length) break;
  }
  return picks.map((r) => {
    let incorrect = [];
    try { incorrect = JSON.parse(r.incorrect_answers || "[]"); } catch (e) {}
    return {
      id: r.id,
      category: r.category,
      difficulty: r.difficulty,
      question: r.question,
      correct_answer: r.correct_answer,
      incorrect_answers: incorrect,
    };
  });
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
      const questions = pickQuestionsForChallenge(req.user.id);
      if (questions.length < CHALLENGE_QUESTION_COUNT) {
        // Rollback the wager debit by re-adding (we're inside the tx).
        if (wager > 0) {
          db.prepare("UPDATE stats SET coins = coins + ? WHERE user_id = ?").run(wager, req.user.id);
        }
        response = { status: 500, body: { error: "question_pool_too_small" } };
        return;
      }
      const now = Date.now();
      const ins = db.prepare(`
        INSERT INTO friend_challenges
          (sender_id, receiver_id, questions_json, wager, created_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(req.user.id, friendId, JSON.stringify(questions), wager, now, now + CHALLENGE_TTL_MS);
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
router.get("/", requireAuth, (req, res) => {
  sweepExpired(req.user.id);
  const rows = db.prepare(`
    SELECT c.*,
           us.username AS sender_username,
           ur.username AS receiver_username
    FROM friend_challenges c
    JOIN users us ON us.id = c.sender_id
    JOIN users ur ON ur.id = c.receiver_id
    WHERE c.sender_id = ? OR c.receiver_id = ?
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
  let questions = [];
  try { questions = JSON.parse(row.questions_json); } catch (e) {}
  res.json({
    id: row.id,
    sender_id: row.sender_id,
    receiver_id: row.receiver_id,
    wager: row.wager,
    questions,
  });
});

// POST /challenges/:id/submit — submit this player's result. Body:
// { correct: int, time_ms: int }. Triggers resolution if both sides
// have played.
router.post("/:id/submit", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const correct = Math.max(0, Math.min(CHALLENGE_QUESTION_COUNT, Number(body.correct) | 0));
  const timeMs = Math.max(1000, Math.min(15 * 60 * 1000, Number(body.time_ms) | 0));

  const row = db.prepare("SELECT * FROM friend_challenges WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "not_found" });
  const isSender = row.sender_id === req.user.id;
  const isReceiver = row.receiver_id === req.user.id;
  if (!isSender && !isReceiver) return res.status(403).json({ error: "not_yours" });
  if (row.status !== "pending") return res.status(400).json({ error: "already_resolved" });

  // BUG-FIX: previously this endpoint didn't check whether the player
  // had already submitted their side of the challenge. That let a
  // player submit MULTIPLE times — they could submit a low score
  // first, peek at the response, then re-submit a higher score to
  // overwrite. Worse, an unguarded re-submit would also re-trigger
  // the receiver's wager debit below, double-charging coins.
  // /play already had the same guard; bring /submit into parity.
  if (isSender && row.sender_correct !== null) return res.status(400).json({ error: "already_played" });
  if (isReceiver && row.receiver_correct !== null) return res.status(400).json({ error: "already_played" });

  // If receiver is submitting, lock their wager from coins now (we
  // didn't lock at challenge-creation because they hadn't accepted yet).
  if (isReceiver && row.wager > 0) {
    const dec = db.prepare(
      "UPDATE stats SET coins = coins - ?, updated_at = ? WHERE user_id = ? AND coins >= ?"
    ).run(row.wager, Date.now(), req.user.id, row.wager);
    if (dec.changes !== 1) return res.status(400).json({ error: "insufficient_funds" });
  }

  // Persist this side's result. Server is the source of truth — the
  // /play endpoint returned the correct_answer field, but the client
  // could lie about how many they got right. We accept the client's
  // count for now (matches the rest of the app's trust model);
  // tighten later by replaying the answers server-side if abuse
  // becomes a problem.
  if (isSender) {
    db.prepare("UPDATE friend_challenges SET sender_correct = ?, sender_time_ms = ? WHERE id = ?")
      .run(correct, timeMs, id);
  } else {
    db.prepare("UPDATE friend_challenges SET receiver_correct = ?, receiver_time_ms = ? WHERE id = ?")
      .run(correct, timeMs, id);
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
  res.json({ ok: true, result });
});

module.exports = router;
