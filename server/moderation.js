const db = require("./db");

// Light-but-real profanity filter. Intentionally conservative — game chat is PG.
// The list covers common slurs, harsh profanity, sexual content, and bullying targets.
// We also normalize leetspeak ("a$$" → "ass", "n1gg3r" → "nigger") and strip
// repeated/punctuation chars so "f.u.c.k" → "fuck".
//
// We do NOT publish the full list in code reviews; if you spot a miss, add it here.
const BLOCKED = [
  // sexual / explicit
  "fuck","fucker","fucking","motherfucker","cunt","pussy","cock","dick","prick",
  "bitch","whore","slut","skank","tits","boobs","penis","vagina","handjob",
  "blowjob","bondage","masturbate","jerkoff","cum","semen","orgy","porn","xxx",
  "sex","sexual","horny","kinky","nude","naked","strip","stripper","escort",
  "anal","oral","fingerbang","fingering","fellatio","cunnilingus",
  // hate / slurs (any of these = instant block)
  "nigger","nigga","faggot","fag","retard","retarded","tranny","spic","kike",
  "chink","gook","wetback","raghead","beaner","cracker","nazi","hitler",
  // violence / harassment
  "kys","killyourself","killurself","killyourself","suicide","rape","raping","rapist","molest","pedophile","pedo",
  // bullying flavor
  "loser","trash","garbage","idiot","stupid","dumbass","jackass","asshole","ass",
  // drugs (kid-friendly app, easier to be strict)
  "cocaine","heroin","meth","weed","marijuana","crack","molly","ecstasy","drugs",
  // misc obvious
  "shit","bullshit","crap","damn","goddamn","piss","pissed",
];

// Build a regex pattern that matches each blocked term with leetspeak permissiveness.
const LEET = {
  a: "[a4@äà]",
  b: "[b8]",
  c: "[c\\(<¢]",
  d: "[d]",
  e: "[e3€ëé]",
  f: "[f]",
  g: "[g96]",
  h: "[h#]",
  i: "[i1!|íï]",
  j: "[j]",
  k: "[k]",
  l: "[l1!|]",
  m: "[m]",
  n: "[nñ]",
  o: "[o0öø]",
  p: "[p]",
  q: "[q]",
  r: "[r]",
  s: "[s5$z]",
  t: "[t7+]",
  u: "[u\\*ü]",
  v: "[v\\\\/]",
  w: "[w]",
  x: "[x\\*]",
  y: "[y]",
  z: "[z2]",
};

function buildPattern(word) {
  const chars = word.split("").map((c) => LEET[c.toLowerCase()] || c);
  // Allow any non-letter/digit characters between letters: "f u c k", "f.u.c.k", "f-u-c-k".
  return chars.join("[^a-z0-9]{0,3}");
}

const COMPILED = new RegExp(`(?:^|[^a-z0-9])(${BLOCKED.map(buildPattern).join("|")})(?:$|[^a-z0-9])`, "i");

function looksBad(text) {
  if (!text || typeof text !== "string") return false;
  // Strip repeated chars to defeat "fuuuuck", "shiiiiit".
  const collapsed = text.toLowerCase().replace(/(.)\1{2,}/g, "$1");
  return COMPILED.test(" " + collapsed + " ");
}

function filterMessage(text) {
  if (!text || typeof text !== "string") return { ok: false, reason: "empty" };
  const trimmed = String(text).trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 200) return { ok: false, reason: "too_long" };

  // Block URLs entirely — game chat shouldn't be a phishing vector.
  if (/(https?:|www\.|\.com|\.net|\.io|\.gg|discord\.gg|t\.me|bit\.ly)/i.test(trimmed)) {
    return { ok: false, reason: "no_links" };
  }
  // Block phone numbers (basic patterns).
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(trimmed)) {
    return { ok: false, reason: "no_phone" };
  }
  // Block ALL-CAPS spam.
  const letters = trimmed.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 6 && letters === letters.toUpperCase()) {
    return { ok: true, text: trimmed.toLowerCase().replace(/^./, (c) => c.toUpperCase()), softened: true };
  }
  if (looksBad(trimmed)) return { ok: false, reason: "profanity" };
  return { ok: true, text: trimmed };
}

// ─── Mutes ──────────────────────────────────────────────────────────────────
function isMuted(userId) {
  const row = db.prepare("SELECT muted_until FROM chat_mutes WHERE user_id = ?").get(userId);
  return !!(row && row.muted_until > Date.now());
}

function getMuteExpiry(userId) {
  const row = db.prepare("SELECT muted_until FROM chat_mutes WHERE user_id = ?").get(userId);
  return row ? row.muted_until : 0;
}

function muteUser(userId, durationMs, reason = "", mutedBy = null) {
  const until = Date.now() + durationMs;
  db.prepare(`
    INSERT INTO chat_mutes (user_id, muted_until, reason, muted_by, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET muted_until = excluded.muted_until, reason = excluded.reason, muted_by = excluded.muted_by
  `).run(userId, until, reason, mutedBy, Date.now());
  return until;
}

function unmuteUser(userId) {
  db.prepare("DELETE FROM chat_mutes WHERE user_id = ?").run(userId);
}

// ─── Rate limit (in-memory per process) ─────────────────────────────────────
const lastMessageAt = new Map();
const RATE_LIMIT_MS = 1500; // min 1.5s between messages

function checkRate(userId) {
  const now = Date.now();
  const last = lastMessageAt.get(userId) || 0;
  if (now - last < RATE_LIMIT_MS) return false;
  lastMessageAt.set(userId, now);
  return true;
}

// Auto-mute on N filtered messages in M minutes.
const filteredCount = new Map(); // userId -> { count, windowStart }
const AUTO_MUTE_THRESHOLD = 3;
const AUTO_MUTE_WINDOW_MS = 5 * 60 * 1000;
const AUTO_MUTE_DURATION_MS = 60 * 60 * 1000; // 1h

function recordFiltered(userId) {
  const now = Date.now();
  const entry = filteredCount.get(userId);
  if (!entry || now - entry.windowStart > AUTO_MUTE_WINDOW_MS) {
    filteredCount.set(userId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  if (entry.count >= AUTO_MUTE_THRESHOLD) {
    muteUser(userId, AUTO_MUTE_DURATION_MS, "auto: repeated filtered messages");
    filteredCount.delete(userId);
    return true;
  }
  return false;
}

module.exports = {
  filterMessage,
  isMuted,
  getMuteExpiry,
  muteUser,
  unmuteUser,
  checkRate,
  recordFiltered,
};
