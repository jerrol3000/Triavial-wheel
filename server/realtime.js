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
let waitingForMatch = null;        // userId of the player in quick-match queue

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
    players: room.players.map(publicPlayer),
    index: room.index,
    total: room.questions.length,
    question: room.index < room.questions.length ? publicQuestion(room.questions[room.index]) : null,
    questionEndsAt: room.questionEndsAt,
    chat: room.chat.slice(-50),
    started: room.started,
    finished: room.finished,
    startedAt: room.startedAt,
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

function loadQuestions(amount, players) {
  // For multiplayer matches: exclude questions either player has already
  // seen. The same set is served to both — if pool is too small, the
  // picker falls back to repeats and cycles their seen history.
  const userIds = (players || []).filter((p) => p && p.id).map((p) => p.id);
  const rows = getRandomQuestions({ difficulty: "medium", amount, userIds });
  // Add a stable shuffled order so both players see same.
  return rows.map((r) => ({ ...r, shuffled: shuffleAnswers(r) }));
}

function makeRoom({ kind, code }) {
  const room = {
    code,
    kind,
    players: [],
    questions: [],
    index: 0,
    questionEndsAt: 0,
    answers: {},          // questionIdx → { userId: { answer, time, correct } }
    chat: [],
    started: false,
    finished: false,
    startedAt: 0,
    timeoutId: null,
    emptyAt: 0,
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
  if (room.started) return;
  if (room.players.filter(Boolean).length < 2) return;
  room.started = true;
  room.startedAt = Date.now();
  room.questions = loadQuestions(QUESTIONS_PER_MATCH, room.players);
  room.index = 0;
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
  if (room.timeoutId) { clearTimeout(room.timeoutId); room.timeoutId = null; }
  const [p1, p2] = room.players;
  const winner = !p1 ? p2 : !p2 ? p1 : (p1.score === p2.score ? null : (p1.score > p2.score ? p1 : p2));
  if (p1 && p2) {
    db.prepare(`
      INSERT INTO matches (kind, player1_id, player2_id, player1_score, player2_score, winner_id, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(room.kind, p1.id, p2.id, p1.score, p2.score, winner ? winner.id : null, room.startedAt, Date.now());
    applyMatchRewards(p1, p2, winner, opts.forfeiterId);
  }
  broadcastRoom(room, {
    type: "match_end",
    winnerId: winner ? winner.id : null,
    forfeiterId: opts.forfeiterId || null,
    players: room.players.map((p) => p ? { id: p.id, username: p.username, score: p.score, correct: p.correct } : null),
  });
  setTimeout(() => rooms.delete(room.code), 30 * 1000);
}

function applyMatchRewards(p1, p2, winner, forfeiterId) {
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
    const wonInc = isWinner ? 1 : 0;
    const lostInc = (!isWinner && !isTie) ? 1 : 0;
    // Forfeiter eats a harsher penalty: no coins, -30 rating (vs -10 for a normal loss).
    const spinsReward = isWinner ? 2 : (isTie ? 1 : 0);
    const coinsReward = isWinner ? 50 : (isTie ? 15 : (isForfeiter ? 0 : 5));
    const ratingDelta = isWinner ? 20 : (isTie ? 0 : (isForfeiter ? -30 : -10));
    updateStats.run(wonInc, lostInc, isWinner ? 1 : 0, spinsReward, coinsReward, ratingDelta, Date.now(), p.id);
    // Quest progression — every online match counts as 1 play, wins
    // additionally bump the wins-today metric for the relevant quests.
    try {
      const stats = require("./routes/stats");
      const events = [{ metric: "online_played_today", amount: 1 }];
      if (isWinner) events.push({ metric: "online_wins_today", amount: 1 });
      if (stats.progressQuestsFor) stats.progressQuestsFor(p.id, events);
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
    if (waitingForMatch === user.id) waitingForMatch = null;
    const room = findRoomForUser(user.id);
    if (room && !room.finished) {
      // If match in progress and the other player is still here, give them the win after a grace period.
      setTimeout(() => {
        const stillThere = connections.get(user.id);
        if (stillThere && stillThere.readyState === 1) return; // reconnected in time
        const room2 = findRoomForUser(user.id);
        if (!room2 || room2.finished) return;
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
      if (waitingForMatch && waitingForMatch !== user.id) {
        const otherId = waitingForMatch;
        const otherWs = connections.get(otherId);
        waitingForMatch = null;
        if (otherWs && otherWs.readyState === 1) {
          const code = makeCode();
          const room = makeRoom({ kind: "quick", code });
          joinRoom(room, { id: otherId, username: otherWs.username });
          joinRoom(room, { id: user.id, username: user.username });
          broadcastRoom(room, { type: "match_found", room: publicRoom(room) });
          // Auto-start after a 3s "get ready" countdown.
          setTimeout(() => startMatch(room), 3000);
          return;
        }
      }
      waitingForMatch = user.id;
      send(ws, { type: "waiting" });
      return;
    }

    case "cancel_quick_match": {
      if (waitingForMatch === user.id) waitingForMatch = null;
      send(ws, { type: "queue_cancelled" });
      return;
    }

    case "create_room": {
      let code;
      do { code = makeCode(); } while (rooms.has(code));
      const room = makeRoom({ kind: "private", code });
      joinRoom(room, user);
      send(ws, { type: "room_state", room: publicRoom(room) });
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
        // Mid-game forfeit: opponent gets a boost, leaver eats a harsher rating drop.
        const opponent = room.players.find((p) => p && p.id !== user.id);
        if (opponent) opponent.score += 100;
        logEvent("online_forfeit", user.id, null, { code: room.code });
        endMatch(room, { forfeiterId: user.id });
      }
      send(ws, { type: "left_room" });
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
