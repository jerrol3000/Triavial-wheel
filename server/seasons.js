// Season Pass definitions. Hardcoded (not DB-driven) because tier
// rewards rarely change at runtime and embedding them as JS keeps the
// migration story simple — to introduce a new season, push a new
// entry to SEASONS, set its start/end timestamps, and redeploy.
//
// Currently shipping a single 30-day "Launch Season" tied to whenever
// it goes live. The CURRENT_SEASON_ID resolves to whichever season is
// active right now; expired seasons are kept here for archival
// reference but won't be returned by /api/season/current.
//
// Tier design:
//   - 20 tiers, requiring 50 XP each (1000 XP total to complete)
//   - Free track gets a reward every OTHER tier (10 rewards total)
//   - Premium track gets a reward at every tier (20 rewards total)
//   - Premium unlock = 500 coins or $4.99 (controlled in store)

const SEASONS = [
  {
    id: "season_launch_01",
    name: "Launch Season",
    starts_at: 0,                                    // since-epoch — always active
    ends_at:   Number.MAX_SAFE_INTEGER,              // never expires (debug-friendly default)
    xp_per_tier: 50,
    tiers: [
      // tier 0 = unlocked at 0 XP, etc. Each entry describes what the
      // FREE track gives vs what the PREMIUM track gives at that tier.
      // null reward means "track has nothing for this tier".
      { free: { type: "coins",  amount: 50 },                free_label: "+50 coins",         premium: { type: "coins",  amount: 100 },                premium_label: "+100 coins" },
      { free: null,                                          free_label: null,                premium: { type: "powerup", id: "fifty",  amount: 1 },   premium_label: "+1 Fifty/50 power-up" },
      { free: { type: "spins",  amount: 2 },                 free_label: "+2 free spins",     premium: { type: "spins",  amount: 5 },                  premium_label: "+5 free spins" },
      { free: null,                                          free_label: null,                premium: { type: "cosmetic", id: "frame_bronze" },       premium_label: "Bronze Frame" },
      { free: { type: "coins",  amount: 100 },               free_label: "+100 coins",        premium: { type: "coins",  amount: 200 },                premium_label: "+200 coins" },
      { free: null,                                          free_label: null,                premium: { type: "powerup", id: "freeze", amount: 1 },   premium_label: "+1 Freeze power-up" },
      { free: { type: "spins",  amount: 3 },                 free_label: "+3 free spins",     premium: { type: "spins",  amount: 8 },                  premium_label: "+8 free spins" },
      { free: null,                                          free_label: null,                premium: { type: "cosmetic", id: "pointer_star" },       premium_label: "Falling Star Pointer" },
      { free: { type: "coins",  amount: 150 },               free_label: "+150 coins",        premium: { type: "coins",  amount: 300 },                premium_label: "+300 coins" },
      { free: null,                                          free_label: null,                premium: { type: "cosmetic", id: "title_thinker" },      premium_label: "Thinker Title" },
      { free: { type: "spins",  amount: 5 },                 free_label: "+5 free spins",     premium: { type: "spins",  amount: 12 },                 premium_label: "+12 free spins" },
      { free: null,                                          free_label: null,                premium: { type: "powerup", id: "double", amount: 2 },   premium_label: "+2 Double power-ups" },
      { free: { type: "coins",  amount: 200 },               free_label: "+200 coins",        premium: { type: "cosmetic", id: "frame_silver" },       premium_label: "Silver Frame" },
      { free: null,                                          free_label: null,                premium: { type: "spins",  amount: 15 },                 premium_label: "+15 free spins" },
      { free: { type: "powerup", id: "skip", amount: 1 },    free_label: "+1 Skip power-up",  premium: { type: "cosmetic", id: "celebration_fireworks" }, premium_label: "Fireworks Celebration" },
      { free: null,                                          free_label: null,                premium: { type: "coins",  amount: 500 },                premium_label: "+500 coins" },
      { free: { type: "spins",  amount: 8 },                 free_label: "+8 free spins",     premium: { type: "cosmetic", id: "pointer_lightning" },  premium_label: "Lightning Pointer" },
      { free: null,                                          free_label: null,                premium: { type: "spins",  amount: 25 },                 premium_label: "+25 free spins" },
      { free: { type: "coins",  amount: 300 },               free_label: "+300 coins",        premium: { type: "cosmetic", id: "title_genius" },       premium_label: "Genius Title" },
      { free: { type: "cosmetic", id: "frame_gold" },        free_label: "Gold Frame",        premium: { type: "cosmetic", id: "frame_inferno" },      premium_label: "Inferno Frame" },
    ],
    premium_price_coins: 500,
  },
];

function currentSeason(now = Date.now()) {
  return SEASONS.find((s) => s.starts_at <= now && now < s.ends_at) || null;
}

function getSeason(id) {
  return SEASONS.find((s) => s.id === id) || null;
}

// XP required to reach tier index `t` (e.g. tier 0 starts at 0 XP).
function xpForTier(season, t) {
  return Math.max(0, t) * season.xp_per_tier;
}

// Highest tier the player has UNLOCKED based on their current XP.
function tierFromXp(season, xp) {
  const tiers = season.tiers.length;
  return Math.min(tiers, Math.floor((xp || 0) / season.xp_per_tier));
}

module.exports = {
  SEASONS,
  currentSeason,
  getSeason,
  xpForTier,
  tierFromXp,
};
