const db = require("./db");

// "Supporter" tier — anyone who has either:
//   (a) an active Pro subscription, OR
//   (b) spent at least $5 cumulatively over the past 30 days.
// Supporters get unlimited free pre-game match leaves (skips).
const PAID_SUPPORTER_THRESHOLD = 5;       // USD
const SUPPORTER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Skip policy for non-supporters:
//   1st skip in a UTC day: free.
//   2nd–5th skip: −5 rating each.
//   6th+ skip: server returns a soft "cooldown" notice — client should show a
//   timer; we still let them leave (don't trap them), the rating drop continues.
const FREE_SKIPS_PER_DAY = 1;
const SKIP_RATING_PENALTY = 5;
const SKIP_HARD_LIMIT = 6;

function startOfUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function getPerks(userId) {
  if (!userId) {
    return {
      is_pro: false, is_supporter: false, supporter_until: null,
      paid_30d_total: 0, skips_today: 0,
      free_skips_per_day: FREE_SKIPS_PER_DAY,
      skip_rating_penalty: SKIP_RATING_PENALTY,
      skip_hard_limit: SKIP_HARD_LIMIT,
      free_skips_remaining: FREE_SKIPS_PER_DAY,
    };
  }
  const now = Date.now();
  const statsRow = db.prepare("SELECT pro_until FROM stats WHERE user_id = ?").get(userId);
  const isPro = !!(statsRow && statsRow.pro_until && statsRow.pro_until > now);

  const paidRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total, MAX(created_at) AS last_at
    FROM events WHERE user_id = ? AND kind = 'payment' AND created_at > ?
  `).get(userId, now - SUPPORTER_WINDOW_MS);
  const paid30dTotal = Number(paidRow.total || 0);
  const isPaidSupporter = paid30dTotal >= PAID_SUPPORTER_THRESHOLD;
  const isSupporter = isPro || isPaidSupporter;
  const supporterUntil = isPro
    ? statsRow.pro_until
    : (isPaidSupporter && paidRow.last_at ? paidRow.last_at + SUPPORTER_WINDOW_MS : null);

  const skipsToday = db.prepare(`
    SELECT COUNT(*) AS n FROM events
    WHERE user_id = ? AND kind = 'online_skip' AND created_at > ?
  `).get(userId, startOfUtcDay()).n;

  return {
    is_pro: isPro,
    is_supporter: isSupporter,
    supporter_until: supporterUntil,
    paid_30d_total: paid30dTotal,
    paid_threshold: PAID_SUPPORTER_THRESHOLD,
    skips_today: skipsToday,
    free_skips_per_day: FREE_SKIPS_PER_DAY,
    skip_rating_penalty: SKIP_RATING_PENALTY,
    skip_hard_limit: SKIP_HARD_LIMIT,
    free_skips_remaining: isSupporter ? Infinity : Math.max(0, FREE_SKIPS_PER_DAY - skipsToday),
  };
}

// Apply the skip penalty (if any) to a non-supporter and return what was applied.
function applySkipPenalty(userId) {
  const perks = getPerks(userId);
  if (perks.is_supporter) return { applied: false, reason: "supporter", perks };
  if (perks.skips_today < perks.free_skips_per_day) {
    return { applied: false, reason: "free_skip_used", perks: getPerks(userId) };
  }
  // 2nd+ skip — ratchet rating down.
  db.prepare("UPDATE stats SET online_rating = MAX(0, online_rating - ?), updated_at = ? WHERE user_id = ?")
    .run(perks.skip_rating_penalty, Date.now(), userId);
  return {
    applied: true,
    rating_delta: -perks.skip_rating_penalty,
    reason: perks.skips_today + 1 >= perks.skip_hard_limit ? "hard_limit" : "soft_penalty",
    perks: getPerks(userId),
  };
}

module.exports = { getPerks, applySkipPenalty, PAID_SUPPORTER_THRESHOLD };
