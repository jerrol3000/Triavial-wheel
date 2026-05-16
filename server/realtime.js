const { WebSocketServer } = require("ws");
const db = require("./db");
const { getRandomQuestions } = require("./questions");
const {
  filterMessage, isMuted, getMuteExpiry, checkRate, recordFiltered,
} = require("./moderation");
const { logEvent } = require("./events");
const { applySkipPenalty } = require("./perks");
const { verifySession } = require("./auth");
const QUESTIONS_PER_MATCH = 5;
const QUESTION_TIME_MS = 15 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// ─── State ──────────────────────────────────────────────────────────────────
const connections = new Map();   // userId → ws
const rooms = new Map();          // code → room
// One queue slot per difficulty bracket. Players only match against
// others who selected the same difficulty before queueing.
const quickQueues = { easy: null, medium: null, hard: null };

function makeCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // unambiguous
  let c = "";
  for (let i = 0; i < 6; i++) c += a[Math.floor(Math.random() * a.length)];
  return c;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function findRoomForUser(userId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p && p.id === userId)) return room;
  }
  return null;
}

function broadcastRoom(room, msg) {
  for (const p of room.players) {
    if (!p) continue;
    const ws = connections.get(p.id);
    send(ws, msg);
  }
}

// Resolved at module level — avoids a require() per packet on the hot path.
const cosmeticsLib = require("./cosmetics");
const badgesLib = require("./badges");

function publicPlayer(p) {
  if (!p) return null;
  return {
    id: p.id,
    username: p.username,
    score: p.score,
    correct: p.correct,
    ready: p.ready,
    avatar: p.avatar,
    public_cosmetics: cosmeticsLib.getPublicCosmetics(p.id),
    badges: badgesLib.listEquipped(p.id),
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    kind: room.kind,
    difficulty: room.difficulty,
    hostId: room.hostId,
    players: room.players.map(publicPlayer),
    index: room.index,
    total: room.questions.length,
    question: room.index < room.questions.length ? publicQuestion(room.questions[room.index]) : null,
    questionEndsAt: room.questionEndsAt,
    chat: room.chat.slice(-50),
    started: room.started,
    finished: room.finished,
    startedAt: room.startedAt,
    rounds: room.rounds,
    continueDeadline: room.continueDeadline,
    continueVotes: room.continueVotes,
    pendingDifficulty: room.pendingDifficulty,
    difficultyVotes: room.difficultyVotes,
    sessionScores: room.sessionScores,
  };
}

function publicQuestion(q) {
  if (!q) return null;
  // Pre-shuffle answers per-room so both players see same order.
  return {
    id: q.id,
    category: q.category,
    difficulty: q.difficulty,
    question: q.question,
    answers: q.shuffled || q.answers || [],
  };
}

// ─── Match flow ─────────────────────────────────────────────────────────────
function shuffleAnswers(q) {
  const arr = [...q.incorrect_answers, q.correct_answer];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
// Difficulty multipliers — rewards scale so hard matches pay out more.
// Applied to both the win-coins and the rating delta.
const DIFFICULTY_MULT = { easy: 0.7, medium: 1.0, hard: 1.6 };
// Continue-vote timeout: after a match ends both players have this long
// to opt into a rematch. If either bails or doesn't decide, the room is
// torn down cleanly (no penalty).
const CONTINUE_VOTE_MS = 20 * 1000;

function loadQuestions(amount, players, difficulty) {
  // For multiplayer matches: exclude questions either player has already
  // seen. The same set is served to both — if pool is too small, the
  // picker falls back to repeats and cycles their seen history.
  const userIds = (players || []).filter((p) => p && p.id).map((p) => p.id);
  const diff = DIFFICULTIES.has(difficulty) ? difficulty : "medium";
  const rows = getRandomQuestions({ difficulty: diff, amount, userIds });
  // Add a stable shuffled order so both players see same.
  return rows.map((r) => ({ ...r, shuffled: shuffleAnswers(r) }));
}

function makeRoom({ kind, code, difficulty = "medium", hostId = null }) {
  const room = {
    code,
    kind,                              // "quick" | "private"
    difficulty: DIFFICULTIES.has(difficulty) ? difficulty : "medium",
    hostId,                            // initiator for private rooms — picks initial difficulty
    players: [],
    questions: [],
    index: 0,
    questionEndsAt: 0,
    answers: {},                       // questionIdx → { userId: { answer, time, correct } }
    chat: [],
    started: false,
    finished: false,
    startedAt: 0,
    timeoutId: null,
    emptyAt: 0,
    // Continue-rematch state: both players must vote "yes" within the
    // window to start round 2. Pending difficulty-change requests live
    // alongside so the next round can pick the new value.
    continueVotes: {},                 // userId → bool
    continueDeadline: 0,
    continueTimeoutId: null,
    rounds: 0,
    pendingDifficulty: null,           // initiator-proposed change between rounds
    difficultyVotes: {},               // userId → bool
    // Session-level standings across all rematches in this room. Wins
    // increment the win streak; losses reset it to 0; ties hold it
    // (neutral, neither extends nor breaks). Lives in the room object
    // so it dies with the room — switching opponents starts fresh.
    // Shape: { [userId]: { wins, losses, ties, streak, bestStreak } }
    sessionScores: {},
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(room, user) {
  if (room.started) return { error: "room_full" };
  if (room.players.find((p) => p && p.id === user.id)) return { error: "already_in" };
  const slot = room.players.findIndex((p) => !p);
  const player = { id: user.id, username: user.username, score: 0, correct: 0, ready: false };
  if (slot >= 0) room.players[slot] = player;
  else if (room.players.length < 2) room.players.push(player);
  else return { error: "room_full" };
  return { ok: true };
}

function startMatch(room) {
  // Guard against the deferred-start race: a player can disconnect
  // during the 3s "match found" countdown, or the room can be torn
  // down by a continue-vote rejection between scheduling and firing.
  if (!room || !rooms.has(room.code)) return;
  if (room.started) return;
  if (room.players.filter(Boolean).length < 2) {
    // Tear the room down cleanly so the remaining player isn't stuck.
    endRoom(room, "opponent_left_pregame");
    return;
  }
  // Reject if either player's socket is gone — otherwise we burn a
  // round of questions on a ghost match.
  const allConnected = room.players.every((p) => {
    if (!p) return false;
    const ws = connections.get(p.id);
    return ws && ws.readyState === 1;
  });
  if (!allConnected) {
    endRoom(room, "opponent_disconnected");
    return;
  }
  room.started = true;
  room.finished = false;
  room.startedAt = Date.now();
  room.questions = loadQuestions(QUESTIONS_PER_MATCH, room.players, room.difficulty);
  room.index = 0;
  room.answers = {};
  // Reset per-player + per-round counters so a rematch starts fresh.
  for (const p of room.players) {
    if (p) { p.score = 0; p.correct = 0; }
  }
  room.continueVotes = {};
  room.continueDeadline = 0;
  room.rounds += 1;
  advanceQuestion(room, /* first */ true);
}

function advanceQuestion(room, first = false) {
  if (room.timeoutId) { clearTimeout(room.timeoutId); room.timeoutId = null; }
  if (room.index >= room.questions.length) return endMatch(room);
  room.questionEndsAt = Date.now() + QUESTION_TIME_MS;
  broadcastRoom(room, { type: "room_state", room: publicRoom(room) });
  room.timeoutId = setTimeout(() => {
    // Anyone who didn't answer gets recorded as wrong.
    const idxAns = room.answers[room.index] || {};
    for (const p of room.players) {
      if (p && !idxAns[p.id]) {
        idxAns[p.id] = { answer: null, time: QUESTION_TIME_MS, correct: false };
      }
    }
    room.answers[room.index] = idxAns;
    revealAndAdvance(room);
  }, QUESTION_TIME_MS + 50);
}

function revealAndAdvance(room) {
  // Reveal the right answer to both clients, then move to next question after a short pause.
  const q = room.questions[room.index];
  broadcastRoom(room, {
    type: "round_reveal",
    correct: q.correct_answer,
    results: room.answers[room.index] || {},
    scores: room.players.map((p) => p ? { id: p.id, username: p.username, score: p.score, correct: p.correct } : null),
  });
  room.index += 1;
  setTimeout(() => {
    if (room.index >= room.questions.length) endMatch(room);
    else advanceQuestion(room);
  }, 2200);
}

function recordAnswer(room, userId, answer) {
  if (!room.started || room.finished) return;
  if (room.index >= room.questions.length) return;
  const q = room.questions[room.index];
  const ansMap = room.answers[room.index] || {};
  if (ansMap[userId]) return; // already answered
  // Validate the answer is one of the shuffled options for THIS question.
  // Prevents a client from sending arbitrary strings (e.g. an attempt to
  // submit the correct_answer text directly from a scraped questions
  // endpoint) instead of one of the four they were shown.
  const validOptions = q.shuffled || q.answers || [];
  if (!validOptions.includes(answer)) return;
  const isRight = answer === q.correct_answer;
  const timeUsed = QUESTION_TIME_MS - Math.max(0, room.questionEndsAt - Date.now());
  ansMap[userId] = { answer, time: timeUsed, correct: isRight };
  room.answers[room.index] = ansMap;
  if (isRight) {
    const player = room.players.find((p) => p && p.id === userId);
    if (player) {
      const speedBonus = Math.max(0, Math.round(((QUESTION_TIME_MS - timeUsed) / QUESTION_TIME_MS) * 50));
      player.score += 100 + speedBonus;
      player.correct += 1;
    }
  }
  // If both players answered, advance early.
  const playerIds = room.players.filter(Boolean).map((p) => p.id);
  if (playerIds.every((id) => ansMap[id])) {
    if (room.timeoutId) { clearTimeout(room.timeoutId); room.timeoutId = null; }
    // small pause so both players can see the other answered
    setTimeout(() => revealAndAdvance(room), 400);
  } else {
    broadcastRoom(room, { type: "opponent_answered", userId });
  }
}

function endMatch(room, opts = {}) {
  if (room.finished) return;
  room.finished = true;
  room.started = false;
  if (room.timeoutId) { clearTimeout(room.timeoutId); room.timeoutId = null; }
  const [p1, p2] = room.players;
  const winner = !p1 ? p2 : !p2 ? p1 : (p1.score === p2.score ? null : (p1.score > p2.score ? p1 : p2));
  if (p1 && p2) {
    db.prepare(`
      INSERT INTO matches (kind, player1_id, player2_id, player1_score, player2_score, winner_id, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(room.kind, p1.id, p2.id, p1.score, p2.score, winner ? winner.id : null, room.startedAt, Date.now());
    applyMatchRewards(p1, p2, winner, opts.forfeiterId, room.kind, room.difficulty, room);
  }

  // Update session-level standings: W/L/T tally + per-player current
  // win streak. A win extends the streak (and bumps bestStreak); a
  // loss resets it to 0; a tie is neutral (no change). Applied for
  // every player in the room so a one-sided forfeit still counts
  // correctly on both sides. We snapshot the PRE-update state so the
  // client can show "🔥 N-streak!" on extension or "💔 broken at N"
  // on a reset without having to reverse-engineer from the new state.
  const prevSessionScores = {};
  for (const p of [p1, p2]) {
    if (!p) continue;
    const prev = room.sessionScores[p.id] || { wins: 0, losses: 0, ties: 0, streak: 0, bestStreak: 0 };
    prevSessionScores[p.id] = { ...prev };
    let { wins, losses, ties, streak, bestStreak } = prev;
    if (!winner) {
      ties += 1;
    } else if (winner.id === p.id) {
      wins += 1;
      streak += 1;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      losses += 1;
      streak = 0;
    }
    room.sessionScores[p.id] = { wins, losses, ties, streak, bestStreak };
  }

  // Reset continue-vote state for the rematch decision window.
  room.continueVotes = {};
  room.continueDeadline = Date.now() + CONTINUE_VOTE_MS;
  if (room.continueTimeoutId) clearTimeout(room.continueTimeoutId);
  room.continueTimeoutId = setTimeout(() => endRoom(room, "continue_timeout"), CONTINUE_VOTE_MS + 200);

  broadcastRoom(room, {
    type: "match_end",
    winnerId: winner ? winner.id : null,
    forfeiterId: opts.forfeiterId || null,
    kind: room.kind,
    difficulty: room.difficulty,
    continueDeadline: room.continueDeadline,
    players: room.players.map((p) => p ? { id: p.id, username: p.username, score: p.score, correct: p.correct } : null),
    sessionScores: room.sessionScores,
    prevSessionScores,
    roundNumber: room.rounds,
  });
}

// Final teardown after the continue window closes (timeout, decline,
// disconnect, etc.). Removes the room and notifies players so the
// client can navigate them home. `byUserId` identifies who triggered
// the end (decline, leave) so the client can suppress the misleading
// "opponent declined" toast for the player who actually clicked decline.
function endRoom(room, reason, opts = {}) {
  if (!rooms.has(room.code)) return;
  if (room.continueTimeoutId) { clearTimeout(room.continueTimeoutId); room.continueTimeoutId = null; }
  broadcastRoom(room, {
    type: "session_ended",
    reason: reason || "ended",
    byUserId: opts.byUserId || null,
  });
  rooms.delete(room.code);
}

function applyMatchRewards(p1, p2, winner, forfeiterId, kind, difficulty, room) {
  // FRIENDLY matches (kind=private): no leaderboard rating change, no
  // win/loss stats, no forfeit penalty. Just a small participation
  // reward so it still feels worthwhile. Quest progression for the
  // "play N online matches" metric is INTENTIONALLY skipped for
  // friendly matches — otherwise two colluding accounts could spin up
  // private rooms back-to-back to farm the weekly play-N quest.
  const isFriendly = kind === "private";
  const mult = DIFFICULTY_MULT[difficulty] || 1;
  // Anti-farming: forfeits early in a match (fewer than 3 of 5 questions
  // answered) award reduced rewards. Stops two accounts from queueing
  // together → A immediately disconnects → B claims a "win" + rating.
  const questionsCompleted = room ? room.index : 0;
  const isMicroMatch = questionsCompleted < 3;

  const updateStats = db.prepare(`
    UPDATE stats SET
      online_wins = online_wins + ?,
      online_losses = online_losses + ?,
      win_streak = CASE WHEN ? = 1 THEN win_streak + 1 ELSE 0 END,
      free_spins = free_spins + ?,
      coins = coins + ?,
      online_rating = MAX(0, online_rating + ?),
      updated_at = ?
    WHERE user_id = ?
  `);
  for (const p of [p1, p2]) {
    const isWinner = winner && winner.id === p.id;
    const isTie = !winner;
    const isForfeiter = forfeiterId && p.id === forfeiterId;

    let wonInc = 0, lostInc = 0, ratingDelta = 0, spinsReward = 0, coinsReward = 0;

    if (isFriendly) {
      // Friendly: a single free spin for showing up; winner gets a few
      // bonus coins but nothing the leaderboard tracks.
      spinsReward = 1;
      coinsReward = isWinner ? 20 : (isTie ? 10 : 5);
    } else if (isMicroMatch && isWinner && !isForfeiter) {
      // Anti-collusion: opponent forfeited before 3 questions answered.
      // Bare-minimum reward — no rating jump, no spins, tiny coin bonus.
      spinsReward = 0;
      coinsReward = 10;
      ratingDelta = 0;
      wonInc = 0; // also don't count toward the leaderboard
    } else {
      // Competitive (quick match) — full rewards with difficulty multiplier.
      // The "significantly more than solo, not crazy" cap: hard win = 80
      // coins (vs solo round ~10-30); easy win = 35.
      wonInc = isWinner ? 1 : 0;
      lostInc = (!isWinner && !isTie) ? 1 : 0;
      const baseSpins = isWinner ? 2 : (isTie ? 1 : 0);
      const baseCoins = isWinner ? 50 : (isTie ? 15 : (isForfeiter ? 0 : 5));
      const baseRating = isWinner ? 20 : (isTie ? 0 : (isForfeiter ? -30 : -10));
      spinsReward = baseSpins;
      coinsReward = Math.round(baseCoins * mult);
      ratingDelta = Math.round(baseRating * mult);
    }

    updateStats.run(wonInc, lostInc, isWinner ? 1 : 0, spinsReward, coinsReward, ratingDelta, Date.now(), p.id);

    // Push the match score onto the GLOBAL high-score leaderboard so
    // online players can compete on the same Home "Top Players" board
    // as solo players. Skipped for:
    //  - friendly (private) matches — those aren't ranked
    //  - micro-matches — same anti-collusion stance as the rewards
    //    above; a 1- or 2-question forfeit shouldn't seed the
    //    leaderboard with anomalous scores
    // The leaderboard table tracks each user's BEST score ever, so an
    // INSERT-or-update-on-higher keeps low-scoring rounds from
    // demoting a player.
    if (!isFriendly && !isMicroMatch && p.score > 0) {
      try {
        db.prepare(`
          INSERT INTO leaderboard (user_id, high_score, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            high_score = MAX(leaderboard.high_score, excluded.high_score),
            updated_at = excluded.updated_at
        `).run(p.id, Math.floor(p.score), Date.now());
      } catch (e) { /* leaderboard push is best-effort */ }
    }

    // Quests: online matches share the SAME metrics as solo for any
    // counter the player legitimately bumped (coins/xp earned today).
    // Without this, "Earn 200 coins from play" is unwinnable for
    // online-only players.
    try {
      const stats = require("./routes/stats");
      const events = [];
      // Friendly matches DON'T progress the "play N online matches"
      // quests — otherwise two colluding accounts could spin private
      // rooms back-to-back to farm them. Only competitive quick
      // matches count toward those quests + leaderboard.
      if (!isFriendly) {
        events.push({ metric: "online_played_today", amount: 1 });
        if (isWinner) events.push({ metric: "online_wins_today", amount: 1 });
      }
      if (coinsReward > 0) events.push({ metric: "coins_earned_today", amount: coinsReward });
      if (events.length && stats.progressAllQuestsFor) stats.progressAllQuestsFor(p.id, events);
      else if (events.length && stats.progressQuestsFor) stats.progressQuestsFor(p.id, events);
    } catch (e) {}

    // Badges: online wins drive social/win-streak badges; solo
    // /stats/game was the only awarder until now, so an online-only
    // player never got their "10 online wins" badge until they
    // happened to play a solo round.
    try {
      const badges = require("./badges");
      if (badges && badges.awardEligible) badges.awardEligible(p.id);
    } catch (e) {}
  }
}

// ─── Connection handler ────────────────────────────────────────────────────
// Reuses the HTTP auth's session-aware verify so a stale token from
// another device gets rejected at WebSocket connect time too.
function verifyToken(token) {
  const result = verifySession(token);
  return result.error ? null : result.decoded;
}

function setupConnection(ws, user) {
  ws.userId = user.id;
  ws.username = user.username;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  // Boot any existing socket for this user (single tab).
  const existing = connections.get(user.id);
  if (existing && existing !== ws) {
    send(existing, { type: "kicked", reason: "another_connection" });
    try { existing.close(); } catch (e) {}
  }
  connections.set(user.id, ws);

  send(ws, { type: "welcome", user: { id: user.id, username: user.username } });

  // Rejoin existing room if reconnect.
  const existingRoom = findRoomForUser(user.id);
  if (existingRoom) send(ws, { type: "room_state", room: publicRoom(existingRoom) });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== "string") return;
    try { handleMessage(ws, user, msg); }
    catch (e) { console.error("[realtime] handler error", e); }
  });

  ws.on("close", () => {
    if (connections.get(user.id) === ws) connections.delete(user.id);
    for (const d of Object.keys(quickQueues)) {
      if (quickQueues[d] === user.id) quickQueues[d] = null;
    }
    const room = findRoomForUser(user.id);
    if (room && !room.finished) {
      // Pin to the SPECIFIC room.code we saw at disconnect time. If the
      // user reconnects within the grace window AND ends up in a new
      // room (e.g. requeues for quick match), findRoomForUser(user.id)
      // would otherwise return that new room and corrupt it with the
      // disconnect-bonus boost from the OLD match.
      const disconnectRoomCode = room.code;
      setTimeout(() => {
        const stillThere = connections.get(user.id);
        if (stillThere && stillThere.readyState === 1) return; // reconnected in time
        const room2 = rooms.get(disconnectRoomCode);
        if (!room2 || room2.finished) return;
        // Confirm the player is still in THAT room (might have left to a
        // different one during the grace).
        const stillInOriginal = room2.players.some((p) => p && p.id === user.id);
        if (!stillInOriginal) return;
        const opponent = room2.players.find((p) => p && p.id !== user.id);
        if (opponent) {
          opponent.score += 100; // disconnect bonus
          endMatch(room2, { forfeiterId: user.id });
        } else {
          rooms.delete(room2.code);
        }
      }, 15 * 1000);
    }
  });
}

function handleMessage(ws, user, msg) {
  switch (msg.type) {
    case "ping":
      send(ws, { type: "pong" });
      return;

    case "quick_match": {
      const existingRoom = findRoomForUser(user.id);
      if (existingRoom) {
        send(ws, { type: "room_state", room: publicRoom(existingRoom) });
        return;
      }
      const reqDiff = DIFFICULTIES.has(msg.difficulty) ? msg.difficulty : "medium";
      // Per-difficulty queue: only matches players who picked the same
      // difficulty so the harder bracket can't ambush easy players.
      const queue = quickQueues[reqDiff] || (quickQueues[reqDiff] = null);
      if (queue && queue !== user.id) {
        const otherId = queue;
        const otherWs = connections.get(otherId);
        quickQueues[reqDiff] = null;
        if (otherWs && otherWs.readyState === 1) {
          const code = makeCode();
          const room = makeRoom({ kind: "quick", code, difficulty: reqDiff });
          joinRoom(room, { id: otherId, username: otherWs.username, avatar: otherWs.avatar });
          joinRoom(room, { id: user.id, username: user.username, avatar: user.avatar });
          broadcastRoom(room, { type: "match_found", room: publicRoom(room) });
          setTimeout(() => startMatch(room), 3000);
          return;
        }
      }
      quickQueues[reqDiff] = user.id;
      send(ws, { type: "waiting", difficulty: reqDiff });
      return;
    }

    case "cancel_quick_match": {
      for (const d of Object.keys(quickQueues)) {
        if (quickQueues[d] === user.id) quickQueues[d] = null;
      }
      send(ws, { type: "queue_cancelled" });
      return;
    }

    case "create_room": {
      let code;
      do { code = makeCode(); } while (rooms.has(code));
      const reqDiff = DIFFICULTIES.has(msg.difficulty) ? msg.difficulty : "medium";
      // Friend room initiator sets the difficulty AND becomes hostId so
      // the change-difficulty vote knows who can propose changes later.
      const room = makeRoom({ kind: "private", code, difficulty: reqDiff, hostId: user.id });
      joinRoom(room, user);
      send(ws, { type: "room_state", room: publicRoom(room) });
      return;
    }

    // Initiator (or anyone in a friend room) proposes a new difficulty
    // for the next round. Counts as a YES from the proposer.
    case "change_difficulty": {
      const room = findRoomForUser(user.id);
      if (!room || room.kind !== "private") { send(ws, { type: "error", error: "not_a_friend_room" }); return; }
      if (!room.finished) { send(ws, { type: "error", error: "round_in_progress" }); return; }
      const next = DIFFICULTIES.has(msg.difficulty) ? msg.difficulty : null;
      if (!next || next === room.difficulty) return;
      room.pendingDifficulty = next;
      room.difficultyVotes = { [user.id]: true };
      broadcastRoom(room, { type: "room_state", room: publicRoom(room) });
      return;
    }

    // Other player accepts (or declines) the proposed difficulty change.
    case "vote_difficulty": {
      const room = findRoomForUser(user.id);
      if (!room || !room.pendingDifficulty) return;
      room.difficultyVotes[user.id] = !!msg.accept;
      const players = room.players.filter(Boolean);
      const allVoted = players.every((p) => p.id in room.difficultyVotes);
      const allYes = players.every((p) => room.difficultyVotes[p.id] === true);
      if (allVoted && allYes) {
        room.difficulty = room.pendingDifficulty;
        room.pendingDifficulty = null;
        room.difficultyVotes = {};
      } else if (allVoted) {
        // Someone declined — drop the proposal, keep current difficulty.
        room.pendingDifficulty = null;
        room.difficultyVotes = {};
      }
      broadcastRoom(room, { type: "room_state", room: publicRoom(room) });
      return;
    }

    // Rematch vote — both players must say yes within continueDeadline
    // or the room shuts down (no penalty, just navigates home). A
    // player can change their YES → NO (cancel) but not NO → YES (a
    // decline already tore the room down, so this branch never fires
    // after a decline).
    case "continue_vote": {
      const room = findRoomForUser(user.id);
      if (!room || !room.finished) return;
      const accept = !!msg.accept;
      // Idempotency: repeat YES votes are no-ops. Without this guard a
      // double-click on Rematch flickers a redundant room_state to both
      // clients.
      if (room.continueVotes[user.id] === true && accept) return;
      room.continueVotes[user.id] = accept;
      const players = room.players.filter(Boolean);
      if (!accept) {
        // One decline is enough to tear the room down — saves the other
        // player from waiting out the full timeout. Tag with byUserId
        // so the decliner doesn't get the "opponent declined" toast.
        endRoom(room, "declined", { byUserId: user.id });
        return;
      }
      const allYes = players.length === 2 && players.every((p) => room.continueVotes[p.id] === true);
      if (allYes) {
        // Both yes — clear the timeout and start a fresh round in the
        // (possibly updated) difficulty.
        if (room.continueTimeoutId) { clearTimeout(room.continueTimeoutId); room.continueTimeoutId = null; }
        startMatch(room);
      } else {
        broadcastRoom(room, { type: "room_state", room: publicRoom(room) });
      }
      return;
    }

    case "join_room": {
      const code = String(msg.code || "").toUpperCase().slice(0, 6);
      const room = rooms.get(code);
      if (!room) { send(ws, { type: "error", error: "room_not_found" }); return; }
      const res = joinRoom(room, user);
      if (res.error) { send(ws, { type: "error", error: res.error }); return; }
      broadcastRoom(room, { type: "room_state", room: publicRoom(room) });
      // Auto-start when 2 players present (private rooms).
      if (room.players.filter(Boolean).length === 2 && !room.started) {
        setTimeout(() => startMatch(room), 2000);
      }
      return;
    }

    case "leave_room": {
      const room = findRoomForUser(user.id);
      if (!room) return;
      if (!room.started) {
        // Pre-game leave — count as a "skip" for quick-match rooms. Private
        // rooms (invited friends) get a pass: no penalty since you're leaving
        // your own invite.
        let skipResult = null;
        if (room.kind === "quick") {
          logEvent("online_skip", user.id, null, { code: room.code });
          skipResult = applySkipPenalty(user.id);
        }
        room.players = room.players.map((p) => (p && p.id === user.id) ? null : p);
        if (room.players.filter(Boolean).length === 0) rooms.delete(room.code);
        else broadcastRoom(room, { type: "room_state", room: publicRoom(room) });
        send(ws, { type: "left_room", skip: skipResult });
        return;
      }
      if (!room.finished) {
        // Mid-game leave behaviour depends on the match kind:
        //  - QUICK (competitive): forfeit penalty + opponent score boost
        //    so it counts as a legitimate competitive loss.
        //  - PRIVATE (friend): no penalty, no rating change, no opponent
        //    boost — friendly matches let you bail without fallout, the
        //    "appropriate" penalty for friends is just losing the round.
        const opponent = room.players.find((p) => p && p.id !== user.id);
        if (room.kind === "quick") {
          if (opponent) opponent.score += 100;
          logEvent("online_forfeit", user.id, null, { code: room.code });
          endMatch(room, { forfeiterId: user.id });
        } else {
          logEvent("friend_leave", user.id, null, { code: room.code });
          endMatch(room, {});                  // ends as a normal match — opponent just wins on score
        }
      }
      send(ws, { type: "left_room" });
      return;
    }

    // Mid-match "skip this opponent" for quick-match — penalty is applied
    // via the same applySkipPenalty path leave_room uses, but framed as
    // a skip (the player wants a new opponent, not to quit playing).
    case "skip_opponent": {
      const room = findRoomForUser(user.id);
      if (!room || room.kind !== "quick" || !room.started || room.finished) return;
      const opponent = room.players.find((p) => p && p.id !== user.id);
      if (opponent) opponent.score += 100;
      logEvent("online_skip_midmatch", user.id, null, { code: room.code });
      const skip = applySkipPenalty(user.id);
      endMatch(room, { forfeiterId: user.id });
      send(ws, { type: "left_room", skip });
      return;
    }

    case "answer": {
      const room = findRoomForUser(user.id);
      if (!room || !room.started || room.finished) return;
      recordAnswer(room, user.id, String(msg.answer || ""));
      return;
    }

    case "chat": {
      const room = findRoomForUser(user.id);
      if (!room) return;
      if (isMuted(user.id)) {
        send(ws, { type: "chat_muted", until: getMuteExpiry(user.id) });
        return;
      }
      if (!checkRate(user.id)) {
        send(ws, { type: "chat_rate_limited" });
        return;
      }
      const result = filterMessage(msg.text);
      if (!result.ok) {
        const autoMuted = recordFiltered(user.id);
        // Store filtered messages for admin audit.
        db.prepare(`
          INSERT INTO chat_messages (user_id, username, room_code, text, filtered, created_at)
          VALUES (?, ?, ?, ?, 1, ?)
        `).run(user.id, user.username, room.code, String(msg.text || "").slice(0, 200), Date.now());
        send(ws, { type: "chat_filtered", reason: result.reason, autoMuted });
        return;
      }
      const stored = db.prepare(`
        INSERT INTO chat_messages (user_id, username, room_code, text, filtered, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
      `).run(user.id, user.username, room.code, result.text, Date.now());
      const entry = {
        id: stored.lastInsertRowid,
        userId: user.id,
        username: user.username,
        text: result.text,
        at: Date.now(),
      };
      room.chat.push(entry);
      if (room.chat.length > 100) room.chat.shift();
      broadcastRoom(room, { type: "chat_message", message: entry });
      return;
    }

    case "reaction": {
      // Pre-defined safe set only.
      const ALLOWED = new Set(["👋","👏","🔥","😢","🎉","💪","🤔","😱","💯"]);
      if (!ALLOWED.has(msg.emoji)) return;
      const room = findRoomForUser(user.id);
      if (!room) return;
      if (isMuted(user.id)) return;
      broadcastRoom(room, { type: "reaction", userId: user.id, username: user.username, emoji: msg.emoji, at: Date.now() });
      return;
    }

    case "report_message": {
      const messageId = Number(msg.messageId);
      if (!Number.isFinite(messageId)) return;
      try {
        db.prepare(`
          INSERT INTO chat_reports (message_id, reporter_id, reason, created_at)
          VALUES (?, ?, ?, ?)
        `).run(messageId, user.id, String(msg.reason || "").slice(0, 200), Date.now());
        send(ws, { type: "report_received" });
      } catch (e) {
        // FK violation if message_id doesn't exist
      }
      return;
    }

    case "ready": {
      const room = findRoomForUser(user.id);
      if (!room || room.started) return;
      const player = room.players.find((p) => p && p.id === user.id);
      if (player) player.ready = true;
      broadcastRoom(room, { type: "room_state", room: publicRoom(room) });
      if (room.players.filter(Boolean).every((p) => p.ready) && room.players.filter(Boolean).length === 2) {
        setTimeout(() => startMatch(room), 1000);
      }
      return;
    }
  }
}

// Exposed for the friends route — list of currently-connected user IDs so
// the friends list can show online dots without an extra DB hit.
function getOnlineUserIds() {
  return new Set(connections.keys());
}

function attach(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) {
      send(ws, { type: "error", error: "auth_required" });
      ws.close();
      return;
    }
    const row = db.prepare("SELECT id, username, avatar, banned_at FROM users WHERE id = ?").get(decoded.id);
    if (!row || row.banned_at) {
      send(ws, { type: "error", error: "forbidden" });
      ws.close();
      return;
    }
    setupConnection(ws, row);
  });

  // Heartbeat — kill dead sockets.
  const hb = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch (e) {}
    });
  }, HEARTBEAT_INTERVAL_MS);
  wss.on("close", () => clearInterval(hb));

  console.log("[realtime] WebSocket server attached at /ws");
}

module.exports = { attach, getOnlineUserIds };
