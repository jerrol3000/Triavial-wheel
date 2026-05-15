const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./db");

// ─── Config ─────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 9,  name: "General Knowledge" },
  { id: 11, name: "Entertainment: Film" },
  { id: 14, name: "Entertainment: Television" },
  { id: 17, name: "Science & Nature" },
  { id: 21, name: "Sports" },
  { id: 22, name: "Geography" },
  { id: 12, name: "Entertainment: Music" },
  { id: 18, name: "Science: Computers" },
  { id: 20, name: "Mythology" },
  { id: 27, name: "Animals" },
];
const DIFFICULTIES = ["easy", "medium", "hard"];
const MIN_PER_BUCKET = 30;                          // top-up target
const MAX_PER_BUCKET = 80;                          // stop fetching past this — saves API calls
const REQUEST_AMOUNT = 20;                          // per-call ask; smaller = more reliable success
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;     // 6h between full sweeps
const OPENTDB_THROTTLE_MS = 5500;                   // opentdb rate-limits at ~1 req / 5s
const EXHAUSTED_BACKOFF_MS = 24 * 60 * 60 * 1000;   // after response_code 1, leave bucket alone for 24h

// ─── Helpers ────────────────────────────────────────────────────────────────
function hashQ(text, categoryId, difficulty) {
  return crypto
    .createHash("sha1")
    .update(`${categoryId}|${difficulty}|${String(text).trim().toLowerCase()}`)
    .digest("hex");
}

function decodeEntities(s) {
  // opentdb returns HTML-encoded strings — light decoder for the most common entities.
  if (s == null) return s;
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&eacute;/g, "é").replace(/&Eacute;/g, "É")
    .replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
    .replace(/&hellip;/g, "…").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—");
}

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO questions
    (category_id, category_name, difficulty, question, correct_answer, incorrect_answers, source, question_hash, created_at)
  VALUES (@category_id, @category_name, @difficulty, @question, @correct_answer, @incorrect_answers, @source, @question_hash, @created_at)
`);

function insertMany(rows, source) {
  const now = Date.now();
  const tx = db.transaction((items) => {
    let added = 0;
    for (const it of items) {
      const q = decodeEntities(it.question);
      const correct = decodeEntities(it.correct_answer);
      const incorrect = (it.incorrect_answers || []).map(decodeEntities);
      const info = insertStmt.run({
        category_id: it.category_id,
        category_name: it.category_name,
        difficulty: it.difficulty,
        question: q,
        correct_answer: correct,
        incorrect_answers: JSON.stringify(incorrect),
        source,
        question_hash: hashQ(q, it.category_id, it.difficulty),
        created_at: now,
      });
      if (info.changes > 0) added += 1;
    }
    return added;
  });
  return tx(rows);
}

function rowToQuestion(r) {
  return {
    id: r.id,
    category: r.category_name,
    category_id: r.category_id,
    difficulty: r.difficulty,
    question: r.question,
    correct_answer: r.correct_answer,
    incorrect_answers: JSON.parse(r.incorrect_answers),
  };
}

// ─── Public lookup ──────────────────────────────────────────────────────────
function getRandomQuestions({ categoryId = null, difficulty = "easy", amount = 10 }) {
  const params = [];
  let where = `difficulty = ?`;
  params.push(difficulty);
  if (categoryId) { where += ` AND category_id = ?`; params.push(categoryId); }
  const rows = db.prepare(
    `SELECT * FROM questions WHERE ${where} ORDER BY RANDOM() LIMIT ?`
  ).all(...params, amount);
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    db.prepare(`UPDATE questions SET served_count = served_count + 1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  }
  return rows.map(rowToQuestion);
}

function getBucketCount(categoryId, difficulty) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM questions WHERE category_id = ? AND difficulty = ?`
  ).get(categoryId, difficulty).n;
}

function getTotalCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM questions`).get().n;
}

// ─── Seeding ────────────────────────────────────────────────────────────────
function seedFromFile() {
  // Load the canonical seed plus any per-category supplements (questions-seed-*.json).
  // Idempotent: INSERT OR IGNORE skips duplicates by question_hash, so calling this on every
  // boot will pick up any new seed files added between deploys.
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) return 0;
  const files = fs.readdirSync(dataDir).filter((f) => /^questions-seed.*\.json$/.test(f)).sort();
  let totalAdded = 0;
  for (const f of files) {
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
      if (!Array.isArray(rows)) continue;
      const added = insertMany(rows, "seed");
      totalAdded += added;
      if (added > 0) console.log(`[questions] seeded ${added} from ${f}`);
    } catch (e) {
      console.error(`[questions] failed to load ${f}:`, e.message);
    }
  }
  return totalAdded;
}

// ─── Daily challenge ────────────────────────────────────────────────────────
function pickDailyQuestions(date, amount = 10) {
  // Deterministic per-date question set. Stored once and reused for all players.
  const cached = db.prepare(`
    SELECT q.* FROM daily_questions d
    JOIN questions q ON q.id = d.question_id
    WHERE d.date = ?
    ORDER BY d.position ASC
  `).all(date);
  if (cached.length >= amount) return cached.map(rowToQuestion);

  // Pick deterministically — same date always yields same set if the underlying pool is unchanged.
  const seed = parseInt(crypto.createHash("md5").update(date).digest("hex").slice(0, 8), 16);
  const candidates = db.prepare(
    `SELECT * FROM questions WHERE difficulty = 'medium' ORDER BY id ASC`
  ).all();
  if (candidates.length < amount) return cached.map(rowToQuestion); // not enough to choose from yet
  const picks = [];
  const used = new Set();
  let s = seed;
  while (picks.length < amount) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const i = s % candidates.length;
    if (!used.has(i)) {
      used.add(i);
      picks.push(candidates[i]);
    }
    if (used.size === candidates.length) break;
  }

  const insert = db.prepare(`INSERT OR REPLACE INTO daily_questions (date, position, question_id) VALUES (?, ?, ?)`);
  const tx = db.transaction(() => {
    picks.forEach((q, idx) => insert.run(date, idx, q.id));
  });
  tx();
  return picks.map(rowToQuestion);
}

// ─── Background refresh from Open Trivia DB ─────────────────────────────────
let refreshing = false;
function bucketKey(catId, diff) { return `${catId}:${diff}`; }

function logFetch(key, outcome) {
  db.prepare(`
    INSERT INTO question_fetch_log (bucket, last_fetched_at, last_outcome) VALUES (?, ?, ?)
    ON CONFLICT(bucket) DO UPDATE SET last_fetched_at = excluded.last_fetched_at, last_outcome = excluded.last_outcome
  `).run(key, Date.now(), outcome);
}

function bucketIsExhausted(key) {
  const row = db.prepare("SELECT last_outcome, last_fetched_at FROM question_fetch_log WHERE bucket = ?").get(key);
  return !!(row && row.last_outcome === "exhausted" && (Date.now() - row.last_fetched_at) < EXHAUSTED_BACKOFF_MS);
}

async function refreshBucket(cat, diff, { force = false } = {}) {
  const key = bucketKey(cat.id, diff);
  const count = getBucketCount(cat.id, diff);
  if (count >= MAX_PER_BUCKET) return { skipped: true, count };
  if (!force && bucketIsExhausted(key)) return { skipped: true, count, reason: "exhausted" };

  const want = Math.min(REQUEST_AMOUNT, MAX_PER_BUCKET - count);
  const url = `https://opentdb.com/api.php?amount=${want}&category=${cat.id}&difficulty=${diff}&type=multiple`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();

    // response_code 1 = "no results" — opentdb's bank has fewer than `want` in this bucket.
    // Mark exhausted and back off; this is normal for small categories at hard difficulty.
    if (data.response_code === 1) {
      logFetch(key, "exhausted");
      return { exhausted: true, count };
    }
    if (data.response_code !== 0 || !Array.isArray(data.results)) {
      return { error: `response_code ${data.response_code}` };
    }

    const rows = data.results.map((r) => ({
      category_id: cat.id,
      category_name: cat.name,
      difficulty: diff,
      question: r.question,
      correct_answer: r.correct_answer,
      incorrect_answers: r.incorrect_answers,
    }));
    const added = insertMany(rows, "opentdb");
    logFetch(key, `added=${added}`);
    return { added };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function refreshAllBuckets({ force = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  let added = 0, exhausted = 0, errors = 0, skipped = 0;
  try {
    for (const cat of CATEGORIES) {
      for (const diff of DIFFICULTIES) {
        const count = getBucketCount(cat.id, diff);
        if (!force && count >= MIN_PER_BUCKET) { skipped += 1; continue; }
        if (!force && bucketIsExhausted(bucketKey(cat.id, diff))) { skipped += 1; continue; }
        const out = await refreshBucket(cat, diff, { force });
        if (out.added) { added += out.added; console.log(`[questions] +${out.added} to ${cat.name}/${diff}`); }
        else if (out.exhausted) { exhausted += 1; }
        else if (out.error) { errors += 1; console.warn(`[questions] ${cat.name}/${diff} →`, out.error); }
        else { skipped += 1; }
        await new Promise((r) => setTimeout(r, OPENTDB_THROTTLE_MS));
      }
    }
    console.log(`[questions] refresh complete: +${added} added · ${exhausted} exhausted (24h backoff) · ${skipped} skipped · ${errors} errors · bank size ${getTotalCount()}`);
  } finally {
    refreshing = false;
  }
}

function startBackgroundRefresh() {
  // Kick off immediately; then on an interval. Don't block boot.
  setTimeout(() => { refreshAllBuckets().catch((e) => console.error("[questions] refresh failed", e)); }, 500);
  setInterval(() => { refreshAllBuckets().catch((e) => console.error("[questions] refresh failed", e)); }, REFRESH_INTERVAL_MS);
}

module.exports = {
  CATEGORIES,
  DIFFICULTIES,
  seedFromFile,
  getRandomQuestions,
  getBucketCount,
  getTotalCount,
  pickDailyQuestions,
  refreshAllBuckets,
  startBackgroundRefresh,
};
