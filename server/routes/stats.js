const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { logEvent } = require("../events");
const { getPerks } = require("../perks");

const router = express.Router();

// Whitelist of fields a client may directly set. Economy stuff (coins,
// xp, level, powerups_json, themes_json) is intentionally OMITTED —
// otherwise any authed user can POST { coins: 999999 } and grant
// themselves infinite currency. Those values are mutated only through
// /stats/game, /watch-ad-reward, /store/buy, /quests/claim, etc.
const ALLOWED_FIELDS = new Set([
  "active_theme",       // pure cosmetic preference, no economic value
  "showcase_public",    // 0/1 — hide or show public profile bling
]);

// Sanity-clamp client-supplied integer fields. Rejects NaN, negatives,
// and values above the cap. Used by /stats/game to prevent leaderboard
// pollution from a tampered or buggy client.
function clampInt(v, min, max) {
  const n = Math.floor(Number(v) || 0);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// Spin regen — server is now the single source of truth. The client used
// to auto-add spins via a 30 s setInterval (`tickLives`) which silently
// minted free spins for users who never opened the app (the timer kept
// ticking against `free_spins_updated_at`, then on next /stats fetch the
// client's hydrated count overwrote the server's). New model: regen ticks
// accrue on the server while the player is OFFLINE, but they only land
// in the player's balance when the player explicitly opens the app and
// CLAIMS them. Capped at SPIN_REGEN_FLOOR so leaving the game open for
// a month doesn't bank 720 free spins.
const SPIN_REGEN_FLOOR = 3;
const SPIN_REGEN_MS = 60 * 60 * 1000;

// Compute claim state without mutating. Returns `{ pending, next_in_ms,
// floor }` — pending is min(elapsed-ticks, capacity-below-floor). Pro
// skips the gate entirely.
function computeClaimState(row) {
  if (!row) return { pending: 0, next_in_ms: 0, floor: SPIN_REGEN_FLOOR };
  const isPro = !!(row.pro_until && row.pro_until > Date.now());
  if (isPro) return { pending: 0, next_in_ms: 0, floor: SPIN_REGEN_FLOOR };
  const now = Date.now();
  const updatedAt = row.free_spins_updated_at || now;
  const elapsed = Math.max(0, now - updatedAt);
  const tickedSinceClaim = Math.floor(elapsed / SPIN_REGEN_MS);
  const capacity = Math.max(0, SPIN_REGEN_FLOOR - (row.free_spins || 0));
  const pending = Math.min(tickedSinceClaim, capacity);
  // Time to next tick — 0 if we're already at/over the floor (nothing
  // more to claim regardless of how long they wait).
  const next_in_ms = capacity === 0
    ? 0
    : SPIN_REGEN_MS - (elapsed % SPIN_REGEN_MS);
  return { pending, next_in_ms, floor: SPIN_REGEN_FLOOR };
}

function loadStats(userId) {
  const row = db.prepare("SELECT * FROM stats WHERE user_id = ?").get(userId);
  if (!row) return null;
  const achievements = db
    .prepare("SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?")
    .all(userId);
  // Strip the legacy `lives` column — the game uses `free_spins` as the
  // sole spin/energy resource now. Sending lives from the server would
  // overwrite the client's regenerating spin counter on every fetch.
  const { lives, lives_updated_at, ...clean } = row;
  const claim = computeClaimState(row);
  return {
    ...clean,
    powerups: clean.powerups_json ? JSON.parse(clean.powerups_json) : {},
    themes: clean.themes_json ? JSON.parse(clean.themes_json) : ["classic"],
    pro: !!(clean.pro_until && clean.pro_until > Date.now()),
    achievements,
    perks: getPerks(userId),
    // New claim fields — drive the Banner's pulsing "Claim N spins" pill
    // and the boot-time toast. Server is authoritative; the client never
    // adds spins on its own anymore.
    pending_spin_claims: claim.pending,
    next_spin_claim_in_ms: claim.next_in_ms,
    spin_regen_floor: claim.floor,
    spin_regen_ms: SPIN_REGEN_MS,
  };
}

router.get("/", requireAuth, (req, res) => {
  res.json(loadStats(req.user.id));
});

// Daily login bonus — call this on app boot for authed users. Idempotent per UTC date.
function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
router.post("/daily-login", requireAuth, (req, res) => {
  // Wrapped in a transaction so two near-simultaneous boots can't both
  // grant the daily login bonus (or both spend the streak_saver flag).
  // Re-checks `last_login_date === today` INSIDE the tx as the lock.
  const today = todayKey();
  let response;
  try {
    const tx = db.transaction(() => {
      const row = db.prepare(
        "SELECT last_login_date, login_streak, powerups_json, streak_saver_active FROM stats WHERE user_id = ?"
      ).get(req.user.id);
      if (!row) { response = { error: "no_stats_row" }; return; }
      if (row.last_login_date === today) {
        response = { alreadyClaimed: true, streak: row.login_streak };
        return;
      }
      const [y, m, d] = today.split("-").map(Number);
      const yesterday = new Date(Date.UTC(y, m - 1, d));
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const ystr = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;
      const continued = row.last_login_date === ystr;
      let streakSaverUsed = false;
      let newStreak;
      if (continued) {
        newStreak = row.login_streak + 1;
      } else if (row.last_login_date && row.login_streak > 0) {
        let powerups = {};
        try { powerups = JSON.parse(row.powerups_json || "{}") || {}; } catch (e) {}
        if (row.streak_saver_active) {
          streakSaverUsed = true;
          newStreak = row.login_streak + 1;
          db.prepare("UPDATE stats SET streak_saver_active = 0 WHERE user_id = ?").run(req.user.id);
        } else if ((powerups.streak_saver || 0) > 0) {
          powerups.streak_saver -= 1;
          streakSaverUsed = true;
          newStreak = row.login_streak + 1;
          db.prepare("UPDATE stats SET powerups_json = ? WHERE user_id = ?").run(JSON.stringify(powerups), req.user.id);
        } else {
          newStreak = 1;
        }
      } else {
        newStreak = 1;
      }
      const tier = Math.min(7, newStreak);
      // Spin reward capped at 1/day so a 30-day login streak no
      // longer grants 90 free spins. Coins reward keeps its
      // streak-scaling — coins are easier to spend back on the
      // store + don't bypass the spin economy. The 7-day login
      // becomes a small coin bonus pile, not a free-play farm.
      const spinsReward = 1;
      const coinsReward = Math.min(100, 25 * tier);
      // The single-row guard against double-credit: only update if
      // last_login_date is still NOT today (race-safe).
      const upd = db.prepare(`
        UPDATE stats SET
          last_login_date = ?, login_streak = ?,
          free_spins = free_spins + ?, coins = coins + ?, updated_at = ?
        WHERE user_id = ? AND (last_login_date IS NULL OR last_login_date != ?)
      `).run(today, newStreak, spinsReward, coinsReward, Date.now(), req.user.id, today);
      if (upd.changes === 0) {
        // Another request just won the race — treat as already claimed.
        response = { alreadyClaimed: true, streak: newStreak };
        return;
      }
      response = {
        alreadyClaimed: false,
        streak: newStreak,
        streak_saver_used: streakSaverUsed,
        spinsReward,
        coinsReward,
      };
    });
    tx();
  } catch (e) {
    console.error("[daily-login] failed", e);
    return res.status(500).json({ error: "daily_login_failed" });
  }
  if (response.error) return res.status(404).json(response);
  res.json({ ...response, stats: loadStats(req.user.id) });
});

// Watch a rewarded ad and claim the reward.
// Throttle: 90-second cooldown between ads, max 10 per UTC day per user.
const AD_COOLDOWN_MS = 90 * 1000;
const AD_DAILY_LIMIT = 10;

router.post("/watch-ad-reward", requireAuth, (req, res) => {
  const reward = String((req.body && req.body.reward) || "free_spin");
  const row = db.prepare("SELECT last_ad_at, ads_today_count, ads_today_date FROM stats WHERE user_id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "no_stats_row" });
  const now = Date.now();
  if (row.last_ad_at && now - row.last_ad_at < AD_COOLDOWN_MS) {
    return res.status(429).json({ error: "cooldown", wait_seconds: Math.ceil((AD_COOLDOWN_MS - (now - row.last_ad_at)) / 1000) });
  }
  const today = todayKey();
  let count = row.ads_today_date === today ? row.ads_today_count : 0;
  if (count >= AD_DAILY_LIMIT) {
    return res.status(429).json({ error: "daily_limit", limit: AD_DAILY_LIMIT });
  }

  // Lives are client-only — server returns a flag and the client does the refill.
  const grant = { granted_free_spins: 0, granted_coins: 0, granted_life_refill: false };
  if (reward === "life_refill") grant.granted_life_refill = true;
  else if (reward === "coins")  grant.granted_coins = 30;
  else                          grant.granted_free_spins = 1;

  db.prepare(`
    UPDATE stats SET
      free_spins = free_spins + ?,
      coins = coins + ?,
      last_ad_at = ?,
      ads_today_count = ?,
      ads_today_date = ?,
      updated_at = ?
    WHERE user_id = ?
  `).run(
    grant.granted_free_spins,
    grant.granted_coins,
    now,
    count + 1,
    today,
    now,
    req.user.id
  );

  logEvent("ad_watch", req.user.id, null, { reward });
  progressAllQuestsFor(req.user.id, [{ metric: "ads_watched_today", amount: 1 }]);
  res.json({ ...grant, ads_today_count: count + 1, daily_limit: AD_DAILY_LIMIT });
});

// Spend one free spin (called when the user spins the wheel if they have any).
// This is now the SOLE path for spin debits — the failure-based debit in
// /stats/game and the quit-penalty spin debit have both been retired
// because they could double-charge or, worse, silently drop in transit
// (the cause of the "balance keeps resetting" bug). One spin, one
// server write, one source of truth.
router.post("/use-free-spin", requireAuth, (req, res) => {
  // Pro users skip the gate entirely — they have unlimited spins.
  // Return full loadStats so the client can mergeStats() without a
  // follow-up /stats round-trip.
  const proRow = db.prepare("SELECT pro_until FROM stats WHERE user_id = ?").get(req.user.id);
  if (proRow && proRow.pro_until && proRow.pro_until > Date.now()) {
    return res.json({ ok: true, pro: true, stats: loadStats(req.user.id) });
  }
  // Atomic decrement guarded by `free_spins > 0` in the WHERE clause.
  // The previous read-then-write let two concurrent requests both
  // pass the check and drop the column to -1.
  // Also stamps `free_spins_updated_at` IFF the decrement crosses the
  // regen floor — that's the moment the regen clock starts ticking
  // for the next claim. Spending while ABOVE the floor doesn't start
  // a claim accrual; only dropping into the floor band does.
  const before = db.prepare("SELECT free_spins, free_spins_updated_at FROM stats WHERE user_id = ?").get(req.user.id);
  if (!before || (before.free_spins || 0) <= 0) return res.status(400).json({ error: "no_free_spins" });
  const willEnterFloor = before.free_spins === SPIN_REGEN_FLOOR;
  const now = Date.now();
  const upd = willEnterFloor
    ? db.prepare(
        "UPDATE stats SET free_spins = free_spins - 1, free_spins_updated_at = ?, updated_at = ? WHERE user_id = ? AND free_spins > 0"
      ).run(now, now, req.user.id)
    : db.prepare(
        "UPDATE stats SET free_spins = free_spins - 1, updated_at = ? WHERE user_id = ? AND free_spins > 0"
      ).run(now, req.user.id);
  if (upd.changes === 0) return res.status(400).json({ error: "no_free_spins" });
  // Return the FULL stats row so the client can mergeStats in one
  // round-trip instead of firing a follow-up /stats fetch. Single
  // source of truth — the client just mirrors whatever the server
  // says, no derivation needed.
  res.json({ ok: true, stats: loadStats(req.user.id) });
});

// Quit-mid-round penalty. Used by safeNavigate when the player leaves
// an in-progress game via Banner-back or BottomNav. The spin was
// already debited up-front on the wheel click (/use-free-spin) so
// this endpoint ONLY handles the abandonment fee — currently just
// the solo round's -5 coins. Daily / multi / online have their own
// dedicated quit paths (streak break, rating drop) handled elsewhere.
//
// Kept as a single endpoint with a context arg so we can extend
// per-context fees later without adding new routes.
router.post("/quit-penalty", requireAuth, (req, res) => {
  const VALID = new Set(["solo", "daily", "online_mid", "multi"]);
  const context = String(req.body && req.body.context || "");
  if (!VALID.has(context)) return res.status(400).json({ error: "invalid_context" });
  const now = Date.now();
  let response;
  try {
    const tx = db.transaction(() => {
      const row = db.prepare(
        "SELECT coins FROM stats WHERE user_id = ?"
      ).get(req.user.id);
      if (!row) { response = { status: 404, body: { error: "no_stats_row" } }; return; }
      const coinDebit = context === "solo" ? 5 : 0;
      if (coinDebit > 0) {
        const newCoins = Math.max(0, (row.coins || 0) - coinDebit);
        db.prepare(`
          UPDATE stats SET coins = ?, updated_at = ? WHERE user_id = ?
        `).run(newCoins, now, req.user.id);
      }
      response = { status: 200, body: { ok: true, coin_debited: coinDebit } };
    });
    tx.immediate();
  } catch (e) {
    console.error("[quit-penalty] failed", e);
    return res.status(500).json({ error: "penalty_failed" });
  }
  if (response.status !== 200) return res.status(response.status).json(response.body);
  res.json({ ...response.body, stats: loadStats(req.user.id) });
});

// Manually claim accrued spin regen. Server is the single source of
// truth for regen now — the old client-side `tickLives` ticker would
// mint spins for users who never opened the app (worst-of-both:
// server saw no engagement, but the user came back to a fat balance).
// This endpoint is the ONLY path that converts wall-clock time into
// free spins, and the player must actively claim them.
//
// Returns the same shape as /stats — the client can drop the response
// straight into the slice without a second /stats round-trip.
router.post("/spin-claim", requireAuth, (req, res) => {
  let result;
  try {
    const tx = db.transaction(() => {
      const row = db.prepare(
        "SELECT free_spins, free_spins_updated_at, pro_until FROM stats WHERE user_id = ?"
      ).get(req.user.id);
      if (!row) { result = { status: 404, body: { error: "no_stats_row" } }; return; }
      const isPro = !!(row.pro_until && row.pro_until > Date.now());
      if (isPro) {
        // Pro doesn't need to claim — they have unlimited spins. Keep
        // the response shape stable so the client can still refresh
        // stats from it.
        result = { status: 400, body: { error: "pro_no_claim_needed" } };
        return;
      }
      const now = Date.now();
      const updatedAt = row.free_spins_updated_at || now;
      const elapsed = Math.max(0, now - updatedAt);
      const pendingTicks = Math.floor(elapsed / SPIN_REGEN_MS);
      if (pendingTicks <= 0) {
        result = {
          status: 400,
          body: { error: "no_claim_ready", next_in_ms: SPIN_REGEN_MS - elapsed },
        };
        return;
      }
      const capacity = Math.max(0, SPIN_REGEN_FLOOR - (row.free_spins || 0));
      if (capacity <= 0) {
        // At/above the floor — the regen clock is paused entirely
        // (nothing to claim until they spend back into the floor band).
        result = { status: 400, body: { error: "at_floor", floor: SPIN_REGEN_FLOOR } };
        return;
      }
      const claimable = Math.min(pendingTicks, capacity);
      // Advance free_spins_updated_at by the claimed ticks, NOT to
      // "now". This preserves the partial tick the player is currently
      // accruing: if they're 47 min into the next hour, claiming now
      // leaves 47 min of credit toward the FOLLOWING claim instead of
      // resetting the clock to zero.
      const newUpdatedAt = updatedAt + claimable * SPIN_REGEN_MS;
      const upd = db.prepare(`
        UPDATE stats SET
          free_spins = free_spins + ?,
          free_spins_updated_at = ?,
          updated_at = ?
        WHERE user_id = ? AND free_spins = ?
      `).run(claimable, newUpdatedAt, now, req.user.id, row.free_spins);
      if (upd.changes === 0) {
        // Lost the race — another /spin-claim or a buy-spins purchase
        // changed free_spins between our read and write. Bail; the
        // client can retry and the next loadStats will reflect truth.
        result = { status: 409, body: { error: "claim_conflict" } };
        return;
      }
      result = { status: 200, body: { ok: true, claimed: claimable } };
    });
    tx.immediate();
  } catch (e) {
    console.error("[spin-claim] failed", e);
    return res.status(500).json({ error: "claim_failed" });
  }
  if (result.status !== 200) return res.status(result.status).json(result.body);
  res.json({ ...result.body, stats: loadStats(req.user.id) });
});

// Daily quests — 3 quests generated per UTC date, deterministic per user
// (so refreshes don't shuffle them) but pulled from a wide pool so the
// same set rarely repeats day-to-day. Server auto-progresses these on
// the events it already sees (game-end, online-win, ad-watch, etc.) so
// no client-side instrumentation is required.
const QUEST_TEMPLATES = [
  // Volume — easy daily floor
  { id: "play_3",        text: "Play 3 rounds",                     target: 3,  metric: "rounds_today",         reward: { coins: 30 } },
  { id: "play_5",        text: "Play 5 rounds",                     target: 5,  metric: "rounds_today",         reward: { coins: 80 } },
  { id: "correct_15",    text: "Get 15 questions right",            target: 15, metric: "correct_today",        reward: { coins: 90 } },
  { id: "correct_30",    text: "Get 30 questions right",            target: 30, metric: "correct_today",        reward: { coins: 160, free_spins: 1 } },
  { id: "earn_coins_200",text: "Earn 200 coins from play",          target: 200,metric: "coins_earned_today",   reward: { coins: 60 } },
  { id: "earn_xp_300",   text: "Earn 300 XP",                       target: 300,metric: "xp_earned_today",      reward: { coins: 70 } },

  // Streak / accuracy — skill plays
  { id: "streak_5",      text: "Hit a 5-correct streak",            target: 5,  metric: "best_streak_today",    reward: { coins: 80 } },
  { id: "streak_10",     text: "Hit a 10-correct streak",           target: 10, metric: "best_streak_today",    reward: { coins: 150, free_spins: 1 } },
  { id: "perfect_round", text: "Get a perfect round (10/10)",       target: 1,  metric: "perfect_rounds_today", reward: { coins: 130, free_spins: 1 } },
  { id: "perfect_round_x2", text: "Get 2 perfect rounds",           target: 2,  metric: "perfect_rounds_today", reward: { coins: 250, free_spins: 1 } },

  // Daily / Online — drives the social + ritual hooks
  { id: "daily_play",    text: "Play today's Daily Challenge",      target: 1,  metric: "daily_played_today",   reward: { coins: 60 } },
  { id: "win_online_1",  text: "Win 1 online match",                target: 1,  metric: "online_wins_today",    reward: { coins: 70 } },
  { id: "win_online_3",  text: "Win 3 online matches",              target: 3,  metric: "online_wins_today",    reward: { coins: 220, free_spins: 1 } },
  { id: "play_online",   text: "Play 2 online matches",             target: 2,  metric: "online_played_today",  reward: { coins: 60 } },

  // Progression — power-up templates removed for now; no server-side
  // tracker increments powerups_used_today, so those would have been
  // unwinnable. Re-add when /stats/powerup-used + a client hook ship.
  { id: "level_up",      text: "Level up once",                     target: 1,  metric: "level_ups_today",      reward: { coins: 100 } },

  // Engagement
  // Ads — keep these spin-rewarding because ad watches ARE the
  // revenue path. Players who watch ads should feel rewarded.
  { id: "watch_ad",      text: "Watch 1 reward ad",                 target: 1,  metric: "ads_watched_today",    reward: { coins: 20 } },
  { id: "watch_ads_3",   text: "Watch 3 reward ads",                target: 3,  metric: "ads_watched_today",    reward: { coins: 80, free_spins: 1 } },
  { id: "spin_wheel_3",  text: "Spin the wheel 3 times",            target: 3,  metric: "spins_today",          reward: { coins: 40 } },
  { id: "spin_wheel_8",  text: "Spin the wheel 8 times",            target: 8,  metric: "spins_today",          reward: { coins: 120 } },

  // Spending — nudges to the store. The buy-anything quest is the
  // only daily that still rewards a spin since it directly engages
  // the store path.
  { id: "buy_anything",  text: "Buy something from the store",      target: 1,  metric: "purchases_today",      reward: { coins: 60, free_spins: 1 } },
  { id: "category_2",    text: "Play 2 different categories",       target: 2,  metric: "categories_today",     reward: { coins: 40 } },
  { id: "category_4",    text: "Play 4 different categories",       target: 4,  metric: "categories_today",     reward: { coins: 110, free_spins: 1 } },
];

function ensureQuests(userId) {
  const today = todayKey();
  const row = db.prepare("SELECT quests_date, quests_json FROM stats WHERE user_id = ?").get(userId);
  if (row && row.quests_date === today) {
    try { return JSON.parse(row.quests_json); }
    catch (e) {
      // Don't silently swallow — surface in logs so a bad migration
      // or hand-edit doesn't disappear without a trace.
      console.warn("[quests] malformed quests_json for user", userId, "regenerating:", e.message);
    }
  }
  // Pick 3 quests deterministically using user id + date as the seed.
  const seedStr = `${userId}|${today}`;
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) { h = (h * 31 + seedStr.charCodeAt(i)) >>> 0; }
  const pool = [...QUEST_TEMPLATES];
  const chosen = [];
  while (chosen.length < 3 && pool.length) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const idx = h % pool.length;
    chosen.push({ ...pool[idx], progress: 0, claimed: false });
    pool.splice(idx, 1);
  }
  // Reset the per-day distinct-categories set in the SAME row update
  // so the daily category quests truly track unique categories,
  // not per-round counts.
  db.prepare("UPDATE stats SET quests_date = ?, quests_json = ?, categories_today_json = '[]', updated_at = ? WHERE user_id = ?")
    .run(today, JSON.stringify(chosen), Date.now(), userId);
  return chosen;
}

// ─── Weekly quests ──────────────────────────────────────────────────────
// Bigger targets, fatter rewards, fresh pool every Monday 00:00 UTC.
// Metric names mirror the daily ones but with a `_this_week` suffix so
// progressWeeklyQuestsFor can sum across the full week independently of
// daily progress (which resets every midnight).
const WEEKLY_QUEST_TEMPLATES = [
  // Volume — multi-day commitments
  // Weekly free_spin rewards halved (and a few zeroed) so a player
  // who hits 3 weekly quests + 7 daily quests doesn't accumulate
  // 40+ free spins per week. Coin rewards stay generous since
  // coins flow back to the store as purchases.
  { id: "w_play_25",       text: "Play 25 rounds this week",         target: 25,  metric: "rounds_this_week",        reward: { coins: 300, free_spins: 2 } },
  { id: "w_play_75",       text: "Play 75 rounds this week",         target: 75,  metric: "rounds_this_week",        reward: { coins: 850, free_spins: 5 } },
  { id: "w_correct_150",   text: "Get 150 questions right this week",target: 150, metric: "correct_this_week",       reward: { coins: 450, free_spins: 2 } },
  { id: "w_correct_500",   text: "Get 500 questions right this week",target: 500, metric: "correct_this_week",       reward: { coins: 1100, free_spins: 6 } },
  { id: "w_earn_coins_2k", text: "Earn 2,000 coins from play",       target: 2000,metric: "coins_earned_this_week",  reward: { coins: 500 } },
  { id: "w_earn_xp_3k",    text: "Earn 3,000 XP this week",          target: 3000,metric: "xp_earned_this_week",     reward: { coins: 600 } },

  // Skill / accuracy
  { id: "w_streak_15",     text: "Hit a 15-correct streak",          target: 15,  metric: "best_streak_this_week",   reward: { coins: 600, free_spins: 2 } },
  { id: "w_streak_25",     text: "Hit a 25-correct streak",          target: 25,  metric: "best_streak_this_week",   reward: { coins: 1200, free_spins: 5 } },
  { id: "w_perfect_5",     text: "Get 5 perfect rounds this week",   target: 5,   metric: "perfect_rounds_this_week",reward: { coins: 900, free_spins: 4 } },

  // Daily ritual
  { id: "w_daily_3",       text: "Play the Daily Challenge 3 times", target: 3,   metric: "daily_played_this_week",  reward: { coins: 350, free_spins: 2 } },
  { id: "w_daily_7",       text: "Complete the Daily every day",     target: 7,   metric: "daily_played_this_week",  reward: { coins: 1700, free_spins: 7 } },

  // Online / social
  { id: "w_online_play_5", text: "Play 5 online matches",            target: 5,   metric: "online_played_this_week", reward: { coins: 400, free_spins: 2 } },
  { id: "w_online_win_5",  text: "Win 5 online matches",             target: 5,   metric: "online_wins_this_week",   reward: { coins: 800, free_spins: 4 } },
  { id: "w_online_win_15", text: "Win 15 online matches",            target: 15,  metric: "online_wins_this_week",   reward: { coins: 2000, free_spins: 7 } },

  // Engagement
  { id: "w_spin_30",       text: "Spin the wheel 30 times",          target: 30,  metric: "spins_this_week",         reward: { coins: 350, free_spins: 2 } },
  { id: "w_watch_ads_10",  text: "Watch 10 reward ads",              target: 10,  metric: "ads_watched_this_week",   reward: { coins: 280, free_spins: 3 } },
  // Power-ups: see daily templates — removed pending a server-side tracker.

  // Exploration / collection
  { id: "w_categories_all",text: "Play all 10 categories this week", target: 10,  metric: "categories_this_week",    reward: { coins: 700, free_spins: 4 } },
  { id: "w_buy_2",         text: "Buy 2 things from the store",      target: 2,   metric: "purchases_this_week",     reward: { coins: 450, free_spins: 2 } },
  { id: "w_level_up_3",    text: "Level up 3 times this week",       target: 3,   metric: "level_ups_this_week",     reward: { coins: 800, free_spins: 4 } },
];

// ISO week key — same week for all timezones because we always use UTC.
function weekKey(d = new Date()) {
  // ISO 8601: week starts Monday; week containing the first Thursday of
  // the year is week 1.
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function ensureWeeklyQuests(userId) {
  const wk = weekKey();
  const row = db.prepare("SELECT weekly_quests_week, weekly_quests_json FROM stats WHERE user_id = ?").get(userId);
  if (row && row.weekly_quests_week === wk) {
    try { const parsed = JSON.parse(row.weekly_quests_json); if (Array.isArray(parsed)) return parsed; }
    catch (e) { console.warn("[weekly-quests] malformed json for user", userId, "regenerating:", e.message); }
  }
  // Deterministic shuffle from a different hash space than dailies so
  // a player's weekly + daily quests rarely overlap on the same metric.
  const seedStr = `weekly|${userId}|${wk}`;
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) { h = (h * 31 + seedStr.charCodeAt(i)) >>> 0; }
  const pool = [...WEEKLY_QUEST_TEMPLATES];
  const chosen = [];
  while (chosen.length < 3 && pool.length) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const idx = h % pool.length;
    chosen.push({ ...pool[idx], progress: 0, claimed: false });
    pool.splice(idx, 1);
  }
  db.prepare("UPDATE stats SET weekly_quests_week = ?, weekly_quests_json = ?, updated_at = ? WHERE user_id = ?")
    .run(wk, JSON.stringify(chosen), Date.now(), userId);
  return chosen;
}

// Same shape as progressQuestsFor but matches *_this_week metrics. All
// quest progression is server-driven from the same event sources that
// fire daily progression — see the call sites in /stats/game,
// /watch-ad-reward, realtime.endMatch, /store/buy, /daily/submit.
function progressWeeklyQuestsFor(userId, events) {
  const quests = ensureWeeklyQuests(userId);
  let changed = false;
  for (const ev of events) {
    const metric = String(ev.metric || "");
    const amount = Math.max(0, Math.floor(ev.amount || 0));
    for (const q of quests) {
      if (q.metric === metric && !q.claimed) {
        const prev = q.progress || 0;
        const next = ev.setMode === "max"
          ? Math.min(q.target, Math.max(prev, amount))
          : Math.min(q.target, prev + amount);
        if (next !== prev) { q.progress = next; changed = true; }
      }
    }
  }
  if (changed) {
    db.prepare("UPDATE stats SET weekly_quests_json = ?, updated_at = ? WHERE user_id = ?")
      .run(JSON.stringify(quests), Date.now(), userId);
  }
  return quests;
}

// One-stop helper for callers — bumps BOTH daily and weekly progress
// from a single event list. Each `metric` should be the daily form
// (e.g. "rounds_today") and this helper automatically also fires the
// weekly variant ("rounds_this_week"). Saves having to call two
// functions everywhere and risk forgetting one.
function progressAllQuestsFor(userId, events) {
  const dailyEvents = events;
  const weeklyEvents = events.map((ev) => ({
    ...ev,
    metric: String(ev.metric || "").replace(/_today$/, "_this_week"),
  })).filter((ev) => ev.metric.endsWith("_this_week"));
  const daily = progressQuestsFor(userId, dailyEvents);
  const weekly = progressWeeklyQuestsFor(userId, weeklyEvents);
  return { daily, weekly };
}

router.get("/quests", requireAuth, (req, res) => {
  const quests = ensureQuests(req.user.id);
  res.json({ date: todayKey(), quests });
});

// Apply quest progress for a list of events. Used by both the public
// endpoint AND server-internal flows (game-end, ad-watch, online match,
// store purchase) so quests advance without any client cooperation.
// `setMode: 'max'` lets best_streak_today take the larger of two
// reported values instead of summing — same pattern other one-shot
// metrics like categories_today could use later.
function progressQuestsFor(userId, events) {
  const quests = ensureQuests(userId);
  let changed = false;
  for (const ev of events) {
    const metric = String(ev.metric || "");
    const amount = Math.max(0, Math.floor(ev.amount || 0));
    for (const q of quests) {
      if (q.metric === metric && !q.claimed) {
        const prev = q.progress || 0;
        const next = ev.setMode === "max"
          ? Math.min(q.target, Math.max(prev, amount))
          : Math.min(q.target, prev + amount);
        if (next !== prev) { q.progress = next; changed = true; }
      }
    }
  }
  if (changed) {
    db.prepare("UPDATE stats SET quests_json = ?, updated_at = ? WHERE user_id = ?")
      .run(JSON.stringify(quests), Date.now(), userId);
  }
  return quests;
}

// Public endpoint REMOVED — was a giant exploit surface. The server
// now drives all quest progression from authoritative event sources
// (/stats/game, /watch-ad-reward, /daily/submit, online endMatch,
// /store/buy). A client posting `events: [{metric:"perfect_rounds_
// today", amount: 999}]` could complete every daily quest instantly
// for free. Read-only progress is exposed via GET /stats/quests.
router.post("/quests/progress", requireAuth, (req, res) => {
  res.status(410).json({
    error: "endpoint_removed",
    hint: "Quest progression is server-driven now.",
  });
});

router.post("/quests/claim", requireAuth, (req, res) => {
  const id = String(req.body?.id || "");
  // Wrap the whole claim flow in a transaction with a re-check inside.
  // Two concurrent claim calls for the same quest used to both pass the
  // pre-tx `claimed:false` check and both UPDATE — second clobbered
  // first's JSON but both applied the coin/spin grant.
  let result;
  try {
    const tx = db.transaction(() => {
      const row = db.prepare("SELECT quests_json FROM stats WHERE user_id = ?").get(req.user.id);
      if (!row) { result = { status: 404, body: { error: "no_stats_row" } }; return; }
      let quests = [];
      try { quests = JSON.parse(row.quests_json || "[]"); } catch (e) { quests = []; }
      const q = quests.find((x) => x.id === id);
      if (!q) { result = { status: 404, body: { error: "no_such_quest" } }; return; }
      if (q.claimed) { result = { status: 400, body: { error: "already_claimed" } }; return; }
      if ((q.progress || 0) < q.target) { result = { status: 400, body: { error: "not_complete" } }; return; }
      q.claimed = true;
      const reward = q.reward || {};
      db.prepare(`
        UPDATE stats SET
          quests_json = ?, coins = coins + ?, free_spins = free_spins + ?, updated_at = ?
        WHERE user_id = ?
      `).run(JSON.stringify(quests), reward.coins || 0, reward.free_spins || 0, Date.now(), req.user.id);
      result = { status: 200, body: { ok: true, reward } };
    });
    tx();
  } catch (e) {
    console.error("[quests/claim] failed", e);
    return res.status(500).json({ error: "claim_failed" });
  }
  if (result.status !== 200) return res.status(result.status).json(result.body);
  res.json({ ...result.body, stats: loadStats(req.user.id) });
});

// ─── Weekly quest endpoints (mirror of /quests) ────────────────────────
router.get("/weekly-quests", requireAuth, (req, res) => {
  const quests = ensureWeeklyQuests(req.user.id);
  res.json({ week: weekKey(), quests });
});

router.post("/weekly-quests/claim", requireAuth, (req, res) => {
  const id = String(req.body?.id || "");
  // Same transactional pattern as /quests/claim — weekly rewards
  // (up to 1800 coins + 15 spins) make the double-claim race even
  // more attractive, so it MUST be race-safe.
  let result;
  try {
    const tx = db.transaction(() => {
      const row = db.prepare("SELECT weekly_quests_json FROM stats WHERE user_id = ?").get(req.user.id);
      if (!row) { result = { status: 404, body: { error: "no_stats_row" } }; return; }
      let quests = [];
      try { quests = JSON.parse(row.weekly_quests_json || "[]"); } catch (e) { quests = []; }
      const q = quests.find((x) => x.id === id);
      if (!q) { result = { status: 404, body: { error: "no_such_quest" } }; return; }
      if (q.claimed) { result = { status: 400, body: { error: "already_claimed" } }; return; }
      if ((q.progress || 0) < q.target) { result = { status: 400, body: { error: "not_complete" } }; return; }
      q.claimed = true;
      const reward = q.reward || {};
      db.prepare(`
        UPDATE stats SET
          weekly_quests_json = ?, coins = coins + ?, free_spins = free_spins + ?, updated_at = ?
        WHERE user_id = ?
      `).run(JSON.stringify(quests), reward.coins || 0, reward.free_spins || 0, Date.now(), req.user.id);
      result = { status: 200, body: { ok: true, reward } };
    });
    tx();
  } catch (e) {
    console.error("[weekly-quests/claim] failed", e);
    return res.status(500).json({ error: "claim_failed" });
  }
  if (result.status !== 200) return res.status(result.status).json(result.body);
  res.json({ ...result.body, stats: loadStats(req.user.id) });
});

// Where am I on the global leaderboard?
router.get("/my-rank", requireAuth, (req, res) => {
  const me = db.prepare("SELECT high_score FROM leaderboard WHERE user_id = ?").get(req.user.id);
  if (!me) return res.json({ rank: null, total: 0, high_score: 0 });
  const rank = db.prepare("SELECT COUNT(*) AS n FROM leaderboard WHERE high_score > ?").get(me.high_score).n + 1;
  const total = db.prepare("SELECT COUNT(*) AS n FROM leaderboard WHERE high_score > 0").get().n;
  // Online rank from rating.
  const myRating = db.prepare("SELECT online_rating, online_wins, online_losses FROM stats WHERE user_id = ?").get(req.user.id);
  let onlineRank = null;
  let onlineTotal = 0;
  if (myRating && (myRating.online_wins + myRating.online_losses) > 0) {
    onlineRank = db.prepare("SELECT COUNT(*) AS n FROM stats WHERE online_rating > ? AND (online_wins + online_losses) > 0").get(myRating.online_rating).n + 1;
    onlineTotal = db.prepare("SELECT COUNT(*) AS n FROM stats WHERE (online_wins + online_losses) > 0").get().n;
  }
  // Include the user's own level so the pinned "you" row on the live
  // leaderboard can show the correct value instead of the leader's level.
  const myLevel = db.prepare("SELECT level FROM stats WHERE user_id = ?").get(req.user.id);
  res.json({
    rank, total, high_score: me.high_score,
    level: myLevel ? myLevel.level : 1,
    online_rank: onlineRank, online_total: onlineTotal,
  });
});

// Recent match history (online matches the user participated in).
router.get("/match-history", requireAuth, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const me = req.user.id;
  const rows = db.prepare(`
    SELECT
      m.id, m.kind, m.player1_id, m.player2_id,
      m.player1_score, m.player2_score, m.winner_id,
      m.started_at, m.finished_at,
      u1.username AS player1_username,
      u2.username AS player2_username
    FROM matches m
    LEFT JOIN users u1 ON u1.id = m.player1_id
    LEFT JOIN users u2 ON u2.id = m.player2_id
    WHERE m.player1_id = ? OR m.player2_id = ?
    ORDER BY m.finished_at DESC
    LIMIT ?
  `).all(me, me, limit);
  res.json(rows.map((r) => {
    const youArePlayer1 = r.player1_id === me;
    const yourScore = youArePlayer1 ? r.player1_score : r.player2_score;
    const oppScore = youArePlayer1 ? r.player2_score : r.player1_score;
    const opp = youArePlayer1 ? r.player2_username : r.player1_username;
    const outcome = !r.winner_id ? "tie" : (r.winner_id === me ? "win" : "loss");
    return {
      id: r.id, kind: r.kind, outcome,
      your_score: yourScore, opponent_score: oppScore,
      opponent: opp || "unknown",
      duration_ms: r.finished_at - r.started_at,
      finished_at: r.finished_at,
    };
  }));
});

// Per-category mastery. Returns rows for every category the user has played.
router.get("/category-stats", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT category_id, games_played, correct, incorrect, best_score, updated_at
    FROM category_stats WHERE user_id = ?
    ORDER BY games_played DESC
  `).all(req.user.id);
  res.json(rows.map((r) => ({
    category_id: r.category_id,
    games_played: r.games_played,
    correct: r.correct,
    incorrect: r.incorrect,
    best_score: r.best_score,
    accuracy_pct: (r.correct + r.incorrect) > 0
      ? Math.round((r.correct / (r.correct + r.incorrect)) * 100)
      : 0,
  })));
});

// Online vs leaderboard.
router.get("/online-leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, u.avatar, s.online_rating, s.online_wins, s.online_losses, s.level
    FROM stats s JOIN users u ON u.id = s.user_id
    WHERE s.online_wins + s.online_losses > 0
    ORDER BY s.online_rating DESC, s.online_wins DESC
    LIMIT 50
  `).all();
  res.json(rows);
});

router.put("/", requireAuth, (req, res) => {
  const body = req.body || {};
  const updates = [];
  const values = [];
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(k)) {
      updates.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (!updates.length) return res.json(loadStats(req.user.id));
  updates.push("updated_at = ?");
  values.push(Date.now());
  values.push(req.user.id);
  db.prepare(`UPDATE stats SET ${updates.join(", ")} WHERE user_id = ?`).run(...values);
  res.json(loadStats(req.user.id));
});

router.post("/game", requireAuth, (req, res) => {
  const body = req.body || {};
  // Clamp every numeric input so a malicious client can't write huge
  // values into the leaderboard. Hard caps cover the largest plausible
  // single-round outcome (10 questions × hard difficulty × multipliers
  // × all bonus streams: base + per-question + achievements + level-up).
  const score        = clampInt(body.score,           0, 20000);
  const correct      = clampInt(body.correct,         0, 50);
  const incorrect    = clampInt(body.incorrect,       0, 50);
  const xp_gained    = clampInt(body.xp_gained,       0, 5000);
  // Cap bumped 5000 → 10000 so the FULL coin total (base + every
  // local-only bonus the client was previously dropping on the floor)
  // fits without silent truncation. Max realistic round = 10 correct
  // × 13 (8 base + 5 per-Q) + 25 streak + 3 achievements × 20 +
  // level-up 50·25 ≈ 1500 — well under 10k even pathologically.
  const coins_gained = clampInt(body.coins_gained,    0, 10000);
  // NOTE: free_spins_spent retired here. Every spin is now debited
  // upfront via /stats/use-free-spin when the player clicks the
  // wheel — debiting AGAIN here would double-charge on a failed
  // round. The body param is accepted (for backward-compat with
  // old clients still sending it) but intentionally ignored.
  const best_streak_run = clampInt(body.best_streak_run, 0, 50);
  const category_id  = body.category_id != null ? Number(body.category_id) : null;
  const now = Date.now();

  const stats = db.prepare("SELECT * FROM stats WHERE user_id = ?").get(req.user.id);
  if (!stats) return res.status(404).json({ error: "no_stats_row" });
  const newXp = stats.xp + xp_gained;
  const newLevel = 1 + Math.floor(Math.sqrt(newXp / 100));
  const newBest = Math.max(stats.best_streak, best_streak_run);
  const leveledUp = newLevel > stats.level;

  // Grant a streak_saver power-up on every level-up. Defends against
  // a NULL/malformed powerups_json (e.g. row inserted before migration)
  // by treating it as the default object.
  let powerupsUpdate = stats.powerups_json;
  if (leveledUp) {
    let p = {};
    try { p = JSON.parse(stats.powerups_json || "{}") || {}; } catch (e) { p = {}; }
    p.streak_saver = (p.streak_saver || 0) + 1;
    powerupsUpdate = JSON.stringify(p);
  }

  // free_spins is intentionally NOT touched here. The /use-free-spin
  // endpoint owns every spin debit; this UPDATE only writes the
  // round-result columns. Keeping that separation means a failed
  // round can't accidentally double-charge a spin that was already
  // paid when the wheel was spun.
  db.prepare(`
    UPDATE stats SET
      xp = ?, level = ?,
      coins = coins + ?,
      games_played = games_played + 1,
      correct = correct + ?,
      incorrect = incorrect + ?,
      best_streak = ?,
      powerups_json = ?,
      updated_at = ?
    WHERE user_id = ?
  `).run(
    newXp, newLevel,
    Math.max(0, Math.floor(coins_gained)),
    Math.max(0, correct), Math.max(0, incorrect),
    newBest, powerupsUpdate,
    now, req.user.id
  );

  // Per-category mastery.
  if (category_id) {
    db.prepare(`
      INSERT INTO category_stats (user_id, category_id, games_played, correct, incorrect, best_score, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(user_id, category_id) DO UPDATE SET
        games_played = games_played + 1,
        correct = correct + excluded.correct,
        incorrect = incorrect + excluded.incorrect,
        best_score = MAX(best_score, excluded.best_score),
        updated_at = excluded.updated_at
    `).run(req.user.id, Number(category_id), Math.max(0, correct), Math.max(0, incorrect), Math.max(0, Math.floor(score)), now);
  }

  const lbRow = db.prepare("SELECT high_score FROM leaderboard WHERE user_id = ?").get(req.user.id);
  if (!lbRow || score > lbRow.high_score) {
    db.prepare("INSERT INTO leaderboard (user_id, high_score, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET high_score = excluded.high_score, updated_at = excluded.updated_at").run(req.user.id, score, now);
  }

  // Auto-progress today's quests from the game event. Sum metrics get
  // incremented; best_streak uses 'max' so two rounds with a 4-streak
  // and a 6-streak record 6 (not 10) for the day.
  const isPerfect = correct >= 10 && incorrect === 0;
  const questEvents = [
    { metric: "rounds_today",         amount: 1 },
    { metric: "spins_today",          amount: 1 },
    { metric: "correct_today",        amount: Math.max(0, correct) },
    { metric: "best_streak_today",    amount: Math.floor(best_streak_run), setMode: "max" },
    { metric: "coins_earned_today",   amount: Math.max(0, Math.floor(coins_gained)) },
    { metric: "xp_earned_today",      amount: Math.max(0, Math.floor(xp_gained)) },
  ];
  if (isPerfect) questEvents.push({ metric: "perfect_rounds_today", amount: 1 });
  if (leveledUp) questEvents.push({ metric: "level_ups_today", amount: 1 });

  // Distinct-category tracker — categories_today templates ask for
  // "Play N DIFFERENT categories", so we maintain a per-day set in
  // stats.categories_today_json and progress with the SET SIZE via
  // setMode:"max" (instead of incrementing per round, which let two
  // rounds of the same category count as 2). Set resets in
  // ensureQuests when the day rolls.
  if (category_id) {
    ensureQuests(req.user.id); // make sure the day's row is fresh first
    const catRow = db.prepare("SELECT categories_today_json FROM stats WHERE user_id = ?").get(req.user.id);
    let cats = [];
    try { cats = JSON.parse(catRow?.categories_today_json || "[]") || []; } catch (e) {}
    if (!cats.includes(category_id)) {
      cats.push(category_id);
      db.prepare("UPDATE stats SET categories_today_json = ?, updated_at = ? WHERE user_id = ?")
        .run(JSON.stringify(cats), Date.now(), req.user.id);
    }
    questEvents.push({ metric: "categories_today", amount: cats.length, setMode: "max" });
  }
  progressAllQuestsFor(req.user.id, questEvents);

  // Season Pass: accrue XP using the same `xp_gained` the round
  // generated, so the pass progresses naturally from playing without
  // its own grind loop. Silent if no active season.
  try {
    const season = require("./season");
    if (season.awardSeasonXp) season.awardSeasonXp(req.user.id, xp_gained);
  } catch (e) { /* best-effort */ }

  // Award any newly-eligible badges from this game. New ones come back in
  // the response so the client can fire a celebration toast.
  let newBadges = [];
  try {
    const badges = require("../badges");
    newBadges = badges.awardEligible(req.user.id);
  } catch (e) {}

  res.json({ ...loadStats(req.user.id), leveled_up: leveledUp, new_badges: newBadges });
});

// Whitelist of valid achievement ids. MUST mirror exactly
// src/data/achievements.js — drift here causes /stats/achievement to
// 400 with `unknown_achievement` and silently break cross-device
// sync for any mismatched id. Earlier this set was a phantom list
// of IDs that NEVER matched what the client dispatches, so 8 of the
// 15 real achievements never persisted server-side.
const VALID_ACHIEVEMENTS = new Set([
  "first_correct", "streak_5", "streak_10", "perfect_round",
  "daily_3", "daily_7", "daily_30",
  "level_5", "level_10", "level_25",
  "fifty_used", "all_categories", "speed_demon",
  "high_score_1000", "friend_winner",
]);

router.post("/achievement", requireAuth, (req, res) => {
  const { achievement_id } = req.body || {};
  const id = String(achievement_id || "");
  if (!id) return res.status(400).json({ error: "missing achievement_id" });
  if (!VALID_ACHIEVEMENTS.has(id)) return res.status(400).json({ error: "unknown_achievement" });
  db.prepare(
    "INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)"
  ).run(req.user.id, id, Date.now());
  res.json(loadStats(req.user.id));
});

// Public-profile preview. Returns ONLY the "bling" surface:
//   - username, level, avatar, equipped frame/title, equipped showcase
//     badges, achievements unlocked count, lifetime totals, online
//     rating, PRO flag
// NEVER returns: email, country, language, friends list, settings,
//   notifications, payment status, raw timestamps. The privacy
//   contract is "show what they earned/bought, not who they are."
// Honors the user's own showcase_public toggle — when off, returns a
// stripped {username, level, pro, showcase_hidden:true}.
router.get("/profile/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_id" });
  const row = db.prepare(`
    SELECT u.id, u.username, u.avatar,
           s.level, s.xp, s.games_played, s.correct, s.incorrect,
           s.best_streak, s.online_wins, s.online_losses, s.online_rating,
           s.pro_until, s.showcase_public
    FROM users u JOIN stats s ON s.user_id = u.id
    WHERE u.id = ? AND u.banned_at IS NULL
  `).get(id);
  if (!row) return res.status(404).json({ error: "not_found" });
  const isPro = !!(row.pro_until && row.pro_until > Date.now());
  if (row.showcase_public === 0) {
    return res.json({
      id: row.id,
      username: row.username,
      level: row.level,
      pro: isPro,
      showcase_hidden: true,
    });
  }
  const cosmetics = require("../cosmetics");
  const badges = require("../badges");
  const achievementsRow = db.prepare(
    "SELECT COUNT(*) AS n FROM achievements WHERE user_id = ?"
  ).get(id);
  res.json({
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    level: row.level,
    xp: row.xp,
    pro: isPro,
    public_cosmetics: cosmetics.getPublicCosmetics(id),
    badges: badges.listEquipped(id),
    achievements_count: achievementsRow ? achievementsRow.n : 0,
    stats: {
      games_played: row.games_played,
      correct: row.correct,
      incorrect: row.incorrect,
      best_streak: row.best_streak,
      online_wins: row.online_wins,
      online_losses: row.online_losses,
      online_rating: row.online_rating,
    },
  });
});

router.get("/leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT u.id AS user_id, u.username, u.avatar, l.high_score, s.level,
           s.pro_until, s.showcase_public
    FROM leaderboard l
    JOIN users u ON u.id = l.user_id
    JOIN stats s ON s.user_id = l.user_id
    ORDER BY l.high_score DESC
    LIMIT 50
  `).all();
  // Decorate with the visible cosmetic (frame + title) + showcase
  // badge so the leaderboard can render each player's flair next to
  // their name. Batched query — previously this was a per-row
  // round-trip that ran 100+ SELECTs for a 50-row leaderboard every
  // 7 s per active client, eating both server CPU and roundtrip
  // latency on the client side. Now: one batched SELECT for the
  // cosmetics across all rows, one for the badges.
  const cosmetics = require("../cosmetics");
  const badges = require("../badges");
  const now = Date.now();
  const publicUserIds = rows
    .filter((r) => r.showcase_public !== 0)
    .map((r) => r.user_id);
  const cosmeticsByUser = cosmetics.getPublicCosmeticsForUsers(publicUserIds);
  const badgesByUser = badges.listEquippedForUsers(publicUserIds);
  for (const r of rows) {
    const isPro = !!(r.pro_until && r.pro_until > now);
    if (r.showcase_public !== 0) {
      r.public_cosmetics = cosmeticsByUser[r.user_id] || {};
      r.badges = badgesByUser[r.user_id] || [];
    } else {
      r.public_cosmetics = {};
      r.badges = [];
    }
    r.pro = isPro;
    delete r.pro_until;
    delete r.showcase_public;
  }
  res.json(rows);
});

module.exports = router;
module.exports.loadStats = loadStats;
module.exports.progressQuestsFor = progressQuestsFor;
module.exports.progressAllQuestsFor = progressAllQuestsFor;
module.exports.ensureWeeklyQuests = ensureWeeklyQuests;
module.exports.weekKey = weekKey;
