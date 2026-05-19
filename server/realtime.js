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
    // Power Cards inventory snapshot. Both players see both
    // inventories so they can read the opponent's threat surface
    // ("they still have a Sniper, watch the next pick").
    powerCards: room.powerCards || {},
    // Best-of-3 series state. Drives the "🏆 1-0" pill in the
    // LiveMatch header and the inter-round transitions.
    series: room.series || null,
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
    // Power Cards — per-player inventory for THIS match. Reset on
    // each rematch so cards don't bank across rounds. 3 cards total,
    // each useable once per match. Tradeoffs add strategic depth
    // and create natural pacing for trash-talk reactions.
    //   🎯 sniper   : peek opponent's pick the moment they lock in
    //   ⏱️  cut      : opponent's next question caps at 8s (vs 15s)
    //   ✖️ double    : next correct answer is worth 2× points
    powerCards: {},                    // userId → { sniper, cut, double }
    // Per-question effects applied by Power Cards. Cleared when the
    // question advances. `cutFor` lists userIds whose timer is
    // shortened; `doubleFor` lists userIds whose next-correct doubles.
    questionEffects: { cutFor: new Set(), doubleFor: new Set() },
    // Best-of-3 series. For quick (ranked) matches, three rounds
    // form a series. First to 2 round wins is the series winner;
    // ties between players in round wins force a third round.
    // Friend rooms default to format:"bo1" — host can change in
    // a future round-options pass. Series persists across rounds
    // until a winner is declared, then resets.
    series: { format: kind === "quick" ? "bo3" : "bo1", roundWins: {}, complete: false, round: 0 },
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
  // Reset Power Cards inventory for this match. Each player gets one
  // of each card. Bank doesn't carry over between rematches —
  // strategic decision: keeps every match feeling fresh + means
  // rematches don't snowball for whoever hoarded.
  room.powerCards = {};
  for (const p of room.players) {
    if (p) room.powerCards[p.id] = { sniper: 1, cut: 1, double: 1 };
  }
  room.questionEffects = { cutFor: new Set(), doubleFor: new Set() };
  // Reset series state ONLY when starting a fresh series (after a
  // continue-vote). Intra-series rounds keep the running tally.
  if (room.series?.complete) {
    room.series = { format: room.kind === "quick" ? "bo3" : "bo1", roundWins: {}, complete: false, round: 0 };
  }
  advanceQuestion(room, /* first */ true);
}

function advanceQuestion(room, first = false) {
  if (room.timeoutId) { clearTimeout(room.timeoutId); room.timeoutId = null; }
  if (room.index >= room.questions.length) return endMatch(room);
  // Carry over the "double" effect (applies until the player gets a
  // correct answer); reset the "cut" effect each question since the
  // cut card stipulates "next question" only. cutFor stays around
  // through this advanceQuestion call so the duration can use it,
  // then we clear it after the broadcast.
  const effects = room.questionEffects || { cutFor: new Set(), doubleFor: new Set() };
  // Per-player question duration. Players in cutFor get 8s instead
  // of the standard 15s. Stored as a map so the client knows which
  // side's timer to render shorter without leaking other state.
  const cutDuration = 8000;
  const perPlayerDuration = {};
  let maxDuration = QUESTION_TIME_MS;
  for (const p of room.players) {
    if (!p) continue;
    const dur = effects.cutFor.has(p.id) ? cutDuration : QUESTION_TIME_MS;
    perPlayerDuration[p.id] = dur;
    if (dur > maxDuration) maxDuration = dur;
  }
  room.questionEndsAt = Date.now() + maxDuration;
  room.perPlayerDuration = perPlayerDuration;
  broadcastRoom(room, {
    type: "room_state",
    room: publicRoom(room),
    perPlayerDuration,
    activeEffects: {
      cutFor: Array.from(effects.cutFor || []),
      doubleFor: Array.from(effects.doubleFor || []),
    },
  });
  // Clear cut for next round (single-use, this-question-only effect).
  // Also clear sniper that didn't fire — sniper is question-scoped
  // ("peek THIS question's opponent pick"); persisting it across
  // questions would silently fire on the next round and confuse
  // both players (sniper-armer thinks they wasted the card; sniped
  // user gets revealed without warning). Double stays because it's
  // "next CORRECT answer", not "next question".
  effects.cutFor = new Set();
  effects.sniperFor = new Set();
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
  }, maxDuration + 50);
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
      let points = 100 + speedBonus;
      // Power Card: double — next correct answer is worth 2x.
      // Burns the flag as soon as it lands on a correct answer
      // (correct=false answers don't consume the buff).
      const effects = room.questionEffects || (room.questionEffects = { cutFor: new Set(), doubleFor: new Set() });
      if (effects.doubleFor && effects.doubleFor.has(userId)) {
        points *= 2;
        effects.doubleFor.delete(userId);
        // Tell both players the double actually triggered so the UI
        // can fire a celebration on the user's side + a "burned"
        // marker on the opponent's side.
        broadcastRoom(room, { type: "card_resolved", userId, card: "double", payload: { points } });
      }
      player.score += points;
      player.correct += 1;
    }
  }
  // Power Card: sniper — if the OPPONENT armed sniper this question,
  // they get to peek at this user's pick the moment it's submitted.
  // We DM the sniped reveal to whichever opponent has the sniper
  // flag active, not the broadcaster, so the sniped user doesn't
  // know they were sniped until match-end recap.
  //
  // BUG-FIX (was clearing the entire sniperFor set whenever ANYONE
  // answered, including the sniper-armer themselves): a sniper who
  // armed-then-answered-first would lose their sniper before the
  // opponent's answer ever landed. Now we only delete the snipers
  // that ACTUALLY fired (i.e., where sniperUserId !== userId).
  // Snipers that didn't fire (skipped by the can't-snipe-yourself
  // continue) survive to the next answer in this question — which
  // is the opponent's pick we're trying to capture.
  const effects = room.questionEffects;
  if (effects && effects.sniperFor && effects.sniperFor.size > 0) {
    const consumed = [];
    for (const sniperUserId of effects.sniperFor) {
      if (sniperUserId === userId) continue; // can't snipe yourself
      sendToUser(sniperUserId, { type: "sniper_reveal", userId, answer, correct: isRight });
      consumed.push(sniperUserId);
    }
    for (const id of consumed) effects.sniperFor.delete(id);
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
  const roundWinner = !p1 ? p2 : !p2 ? p1 : (p1.score === p2.score ? null : (p1.score > p2.score ? p1 : p2));

  // Best-of-3 series progression. Increment the round-win counter
  // for the round's winner; ties don't count toward series wins
  // (force a third round to break it). Check completion: 2 wins =
  // series done, OR 3 rounds played caps the series even at 1-1-1.
  const series = room.series || (room.series = { format: room.kind === "quick" ? "bo3" : "bo1", roundWins: {}, complete: false, round: 0 });
  if (series.format === "bo3" && !opts.forfeiterId) {
    if (roundWinner) {
      series.roundWins[roundWinner.id] = (series.roundWins[roundWinner.id] || 0) + 1;
    }
    series.round = (series.round || 0) + 1;
    const maxWins = Math.max(0, ...Object.values(series.roundWins));
    const seriesIsDone = maxWins >= 2 || series.round >= 3;
    if (!seriesIsDone) {
      // INTRA-SERIES round — broadcast round_end (NOT match_end so
      // the client doesn't show the continue-vote screen) and
      // schedule the next round to auto-start in ~2.5s. No DB write
      // for individual rounds; only the series outcome persists.
      broadcastRoom(room, {
        type: "round_end",
        roundWinnerId: roundWinner ? roundWinner.id : null,
        round: series.round,
        seriesWins: { ...series.roundWins },
        players: room.players.map((p) => p ? { id: p.id, username: p.username, score: p.score, correct: p.correct } : null),
      });
      setTimeout(() => {
        if (!room || !rooms.has(room.code)) return;
        if (room.finished) startMatch(room); // startMatch resets finished flag + scores
      }, 2500);
      return;
    }
  }

  // Series complete (or single-match format). Determine the SERIES
  // winner from accumulated round wins; fall back to the single
  // round's winner if series tracking is bo1 / unused. Forfeit
  // shortcircuits — forfeiter loses the series immediately.
  let winner = roundWinner;
  if (series.format === "bo3") {
    const aWins = series.roundWins[p1?.id] || 0;
    const bWins = series.roundWins[p2?.id] || 0;
    if (opts.forfeiterId) {
      winner = p1 && opts.forfeiterId === p1.id ? p2 : p1;
    } else if (aWins !== bWins) {
      winner = aWins > bWins ? p1 : p2;
    } else {
      winner = roundWinner; // tied series, fall back to last-round winner
    }
  }

  if (p1 && p2) {
    db.prepare(`
      INSERT INTO matches (kind, player1_id, player2_id, player1_score, player2_score, winner_id, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(room.kind, p1.id, p2.id, p1.score, p2.score, winner ? winner.id : null, room.startedAt, Date.now());
    applyMatchRewards(p1, p2, winner, opts.forfeiterId, room.kind, room.difficulty, room);
  }
  // Reset series state for the next continue-vote rematch.
  series.complete = true;

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

  // Daily VS tally. One row per (user, UTC date). RANKED matches only
  // (kind=quick) — friendly matches don't count toward the daily
  // leaderboard for the same anti-farming reason as the season XP.
  // Forfeit-shortened matches (isMicroMatch) also skip the tally to
  // stop two-account loops from gaming the prizes.
  if (room.kind === "quick" && p1 && p2 && (room.index >= 3 || !opts.forfeiterId)) {
    const now = Date.now();
    const d = new Date(now);
    const today = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const bumpFor = (uid, key) => {
      db.prepare(`
        INSERT INTO daily_vs(user_id, date, ${key}, updated_at) VALUES (?, ?, 1, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET ${key} = ${key} + 1, updated_at = excluded.updated_at
      `).run(uid, today, now);
    };
    if (!winner) { bumpFor(p1.id, "ties"); bumpFor(p2.id, "ties"); }
    else { bumpFor(winner.id, "wins"); const loser = winner.id === p1.id ? p2 : p1; bumpFor(loser.id, "losses"); }
  }

  // Update the persistent rivalry record between these two players.
  // Ordered tuple (lower id, higher id) keeps the row unique
  // regardless of which side initiated. Skips if either is missing
  // (e.g., one-sided forfeit from a torn-down match).
  if (p1 && p2 && p1.id && p2.id && p1.id !== p2.id) {
    const lo = Math.min(p1.id, p2.id);
    const hi = Math.max(p1.id, p2.id);
    const winnerIsLo = winner && winner.id === lo;
    const winnerIsHi = winner && winner.id === hi;
    const now = Date.now();
    db.prepare(`
      INSERT INTO vs_rivalries (user_a, user_b, a_wins, b_wins, ties, last_played_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_a, user_b) DO UPDATE SET
        a_wins = vs_rivalries.a_wins + excluded.a_wins,
        b_wins = vs_rivalries.b_wins + excluded.b_wins,
        ties   = vs_rivalries.ties   + excluded.ties,
        last_played_at = excluded.last_played_at
    `).run(lo, hi, winnerIsLo ? 1 : 0, winnerIsHi ? 1 : 0, !winner ? 1 : 0, now);
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

      // Comeback Boost: ranked-match-only flag. Consumed by a win
      // (+50% on rating gain), armed by a loss. Net cycle: lose →
      // armed → win → bonus + cleared. Forfeits don't arm to stop
      // a forfeit-farming loop (lose-on-purpose for the boost on
      // your next win against a different opponent).
      if (isWinner && !isForfeiter) {
        const cb = db.prepare("SELECT comeback_boost_active FROM stats WHERE user_id = ?").get(p.id);
        if (cb && cb.comeback_boost_active) {
          ratingDelta = Math.round(ratingDelta * 1.5);
          coinsReward = Math.round(coinsReward * 1.2); // small coin bonus too
          db.prepare("UPDATE stats SET comeback_boost_active = 0 WHERE user_id = ?").run(p.id);
          // Tell the player their boost cashed in.
          sendToUser(p.id, {
            type: "comeback_consumed",
            ratingDelta,
            coinsReward,
          });
        }
      } else if (!isWinner && !isTie && !isForfeiter) {
        // Arm the boost for next win. Idempotent — already-active is fine.
        db.prepare("UPDATE stats SET comeback_boost_active = 1 WHERE user_id = ?").run(p.id);
        sendToUser(p.id, { type: "comeback_armed" });
      }
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

      // Online matches now also progress the generic round / correct
      // / streak metrics so weekly quests like "Play 25 rounds this
      // week" and "Get 150 correct this week" are achievable for
      // players who only do online VS. Without this, online-only
      // players couldn't claim the bulk of weekly quests despite
      // playing constantly. progressAllQuestsFor auto-mirrors each
      // _today metric to its _this_week sibling.
      const correctCount = Math.max(0, Math.min(50, Number(p.correct) || 0));
      const questionsAnswered = room && room.index ? Math.max(0, Math.min(50, room.index)) : 0;
      if (questionsAnswered > 0) {
        events.push({ metric: "rounds_today", amount: 1 });
        if (correctCount > 0) events.push({ metric: "correct_today", amount: correctCount });
        // Perfect round in VS: every answered question correct (rare
        // in 5-question matches but cheap to track).
        if (correctCount === questionsAnswered && questionsAnswered >= 5) {
          events.push({ metric: "perfect_rounds_today", amount: 1 });
        }
      }

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

    case "use_card": {
      // Power Cards mid-match. The card kind drives:
      //   - sniper: arms a one-shot "peek opponent's next pick" for
      //     the rest of this question
      //   - cut:    shortens opponent's NEXT question's timer
      //   - double: doubles THIS user's next correct answer score
      // Server validates the card hasn't been used by this player
      // yet this match (one-per-card-per-match cap). Broadcasts so
      // the opponent sees the burn icon + the user sees their card
      // visibly decrement.
      const room = findRoomForUser(user.id);
      if (!room || !room.started || room.finished) return;
      const card = String(msg.card || "");
      if (!["sniper", "cut", "double"].includes(card)) return;
      const inv = room.powerCards[user.id];
      if (!inv || (inv[card] || 0) <= 0) {
        send(ws, { type: "card_rejected", card, reason: "no_inventory" });
        return;
      }
      // Burn one card from inventory.
      inv[card] -= 1;
      const effects = room.questionEffects || (room.questionEffects = { cutFor: new Set(), doubleFor: new Set(), sniperFor: new Set() });
      effects.sniperFor = effects.sniperFor || new Set();
      const opponent = room.players.find((p) => p && p.id !== user.id);
      if (card === "sniper") {
        // Arm sniper on this user — fires when opponent answers.
        effects.sniperFor.add(user.id);
      } else if (card === "cut" && opponent) {
        // Apply to the opponent's NEXT question.
        effects.cutFor.add(opponent.id);
      } else if (card === "double") {
        // This user's next correct answer doubles.
        effects.doubleFor.add(user.id);
      }
      // Broadcast so the opponent sees the burn animation immediately.
      broadcastRoom(room, {
        type: "card_used",
        userId: user.id,
        card,
        remaining: { ...inv },
      });
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
      // Tiered emote validation:
      //   - FREE set: everyone can send these
      //   - PREMIUM set: requires Pro OR season_premium active
      // Server keeps the source of truth so a client patching the
      // local FREE_REACTIONS array doesn't bypass the gate.
      const FREE_SET    = new Set(["👋","👏","🔥","🎉","💪","🤔"]);
      const PREMIUM_SET = new Set(["😱","💯","🤡","💀","🧊","🐐","🤯","🔫","👑"]);
      const emoji = String(msg.emoji || "");
      const isFree = FREE_SET.has(emoji);
      const isPremium = PREMIUM_SET.has(emoji);
      if (!isFree && !isPremium) return; // unknown emoji → drop
      if (isPremium) {
        // Validate the player can actually use a premium emote. Pro
        // OR an active premium season pass. Single small query —
        // safe to do inline on every reaction since reactions are
        // already rate-limited by mute / chat throttle.
        const row = db.prepare(`
          SELECT s.pro_until, us.premium
          FROM stats s
          LEFT JOIN user_season us ON us.user_id = s.user_id AND us.premium = 1
          WHERE s.user_id = ?
        `).get(user.id);
        const isPro = !!(row && row.pro_until && row.pro_until > Date.now());
        const hasSeasonPremium = !!(row && row.premium);
        if (!isPro && !hasSeasonPremium) {
          send(ws, { type: "emote_locked", emoji });
          return;
        }
      }
      const room = findRoomForUser(user.id);
      if (!room) return;
      if (isMuted(user.id)) return;
      broadcastRoom(room, { type: "reaction", userId: user.id, username: user.username, emoji, at: Date.now(), premium: isPremium });
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

    // Direct play invite from a friend. Creates a private room with
    // the sender as host and pushes a live `notification` to the
    // friend so their bell shows an Accept button. This is the WS
    // path for "Play with friend" — recipients who happen to be
    // offline get the invite on their next /api/notifications poll
    // via the events derivation, though without the live banner.
    case "play_invite": {
      const friendId = Number(msg.friendId);
      if (!friendId || friendId === user.id) {
        send(ws, { type: "error", error: "invalid_friend" });
        return;
      }
      // Friendship check — only accepted friends can invite each other.
      const [a, b] = friendId < user.id ? [friendId, user.id] : [user.id, friendId];
      const friendship = db.prepare(
        `SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'accepted'`
      ).get(a, b);
      if (!friendship) {
        send(ws, { type: "error", error: "not_friends" });
        return;
      }
      // Refuse if either party is already in a room — sender must
      // leave first; recipient gets an error toast they can ignore.
      if (findRoomForUser(user.id)) {
        send(ws, { type: "error", error: "already_in_match" });
        return;
      }
      if (findRoomForUser(friendId)) {
        send(ws, { type: "error", error: "friend_in_match" });
        return;
      }
      const reqDiff = DIFFICULTIES.has(msg.difficulty) ? msg.difficulty : "medium";
      // Recipient row for username in the toast (needed by the room view).
      const friendRow = db.prepare("SELECT username FROM users WHERE id = ?").get(friendId);
      if (!friendRow) {
        send(ws, { type: "error", error: "friend_not_found" });
        return;
      }
      let code;
      do { code = makeCode(); } while (rooms.has(code));
      const room = makeRoom({ kind: "private", code, difficulty: reqDiff, hostId: user.id });
      joinRoom(room, user);
      send(ws, { type: "room_state", room: publicRoom(room) });
      // Live notification with the room code embedded — recipient's
      // bell will render Accept/Dismiss inline buttons.
      sendToUser(friendId, {
        type: "notification",
        notification: {
          id: `play-invite-${user.id}-${Date.now()}`,
          type: "play_invite",
          icon: "🎮",
          title: `${user.username} invited you to play`,
          text: `${reqDiff} difficulty · tap Accept to join`,
          at: Date.now(),
          actor: { id: user.id, username: user.username },
          roomCode: code,
          difficulty: reqDiff,
          actionType: "join_invite",
        },
      });
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

// Push an arbitrary message to a specific user's open WS socket. Used
// by HTTP routes (gifts, friend requests) to broadcast a live
// `notification` event so the recipient's bell updates instantly
// instead of waiting on the 30s poll. Silent no-op if the user isn't
// currently connected — the next /api/notifications poll will catch
// them up once they're back. Logs the deliver/skip decision so a
// "notifications aren't arriving" report can be diagnosed from server
// logs alone (was the recipient connected? was the socket healthy?).
function sendToUser(userId, msg) {
  const ws = connections.get(userId);
  if (!ws) {
    console.log(`[realtime] sendToUser(${userId}, ${msg && msg.type}) → recipient offline, skipped`);
    return false;
  }
  if (ws.readyState !== 1) {
    console.log(`[realtime] sendToUser(${userId}, ${msg && msg.type}) → socket readyState=${ws.readyState}, skipped`);
    return false;
  }
  try {
    ws.send(JSON.stringify(msg));
    console.log(`[realtime] sendToUser(${userId}, ${msg && msg.type}) → delivered`);
    return true;
  } catch (e) {
    console.log(`[realtime] sendToUser(${userId}, ${msg && msg.type}) → send threw ${e.message}`);
    return false;
  }
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

module.exports = { attach, getOnlineUserIds, sendToUser };
