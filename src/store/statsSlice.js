import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../api/client";
import { load, save } from "../utils/storage";
import { levelForXp } from "../utils/level";

const STORAGE_KEY = "stats";
const STORAGE_VERSION = 3;  // bumped after merging lives → free_spins (single resource)
const VERSION_KEY = "stats_version";

const DEFAULT_STATS = {
  xp: 0,
  level: 1,
  coins: 50,
  games_played: 0,
  correct: 0,
  incorrect: 0,
  best_streak: 0,
  longest_daily_streak: 0,
  current_daily_streak: 0,
  last_daily_date: null,
  powerups: { fifty: 1, skip: 1, freeze: 1, double: 1 },
  themes: ["classic"],
  active_theme: "classic",
  pro: false,
  pro_until: null,
  achievements: [], // [{ achievement_id, unlocked_at }]
  // Spin regen state — see tickLives reducer for the regen math.
  free_spins_updated_at: Date.now(),
  // Local-only category-played set
  categories_played: [],
  // Cache of leaderboard
  leaderboard: [],
  // Server-derived fields that drive Badge progress bars. Pre-populate
  // defaults so BadgesPanel doesn't show NaN / "undefined / 50" before
  // the first fetchStats lands.
  win_streak: 0,
  online_wins: 0,
  online_losses: 0,
  online_rating: 1000,
  free_spins: 0,
  coins_spent_total: 0,
  cosmetics_owned_count: 0,
  pro_lifetime_months: 0,
};

// Guarantee no arrays/objects are null/undefined. Older saved-state shapes
// could crash component render with stats.achievements.map / .find on null.
function sanitize(s) {
  if (!s || typeof s !== "object") return { ...DEFAULT_STATS };
  return {
    ...DEFAULT_STATS,
    ...s,
    powerups: (s.powerups && typeof s.powerups === "object") ? s.powerups : DEFAULT_STATS.powerups,
    themes: Array.isArray(s.themes) ? s.themes : DEFAULT_STATS.themes,
    achievements: Array.isArray(s.achievements) ? s.achievements : [],
    categories_played: Array.isArray(s.categories_played) ? s.categories_played : [],
    leaderboard: Array.isArray(s.leaderboard) ? s.leaderboard : [],
  };
}

function mergeStats(local, server) {
  return sanitize({
    ...local,
    ...server,
    powerups: server.powerups || local.powerups,
    themes: server.themes || local.themes,
    achievements: server.achievements || local.achievements,
  });
}

// Wipe stats on version bump — protects against schema-mismatched cached state
// from older builds. Increment STORAGE_VERSION above when the shape changes.
function loadInitial() {
  const version = load(VERSION_KEY, 0);
  if (version !== STORAGE_VERSION) {
    save(VERSION_KEY, STORAGE_VERSION);
    return { ...DEFAULT_STATS };
  }
  return sanitize(load(STORAGE_KEY, DEFAULT_STATS));
}

export const fetchStats = createAsyncThunk("stats/fetch", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/stats");
    return data;
  } catch (e) {
    return rejectWithValue(e?.response?.data?.error || "failed");
  }
});

export const pushStatField = createAsyncThunk("stats/push", async (patch, { rejectWithValue }) => {
  try {
    const { data } = await api.put("/stats", patch);
    return data;
  } catch (e) {
    return rejectWithValue(e?.response?.data?.error || "failed");
  }
});

export const submitGame = createAsyncThunk("stats/submitGame", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/stats/game", payload);
    return data;
  } catch (e) {
    return rejectWithValue(e?.response?.data?.error || "failed");
  }
});

export const unlockAchievement = createAsyncThunk("stats/unlockAchievement", async (achievement_id, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/stats/achievement", { achievement_id });
    return { data, achievement_id };
  } catch (e) {
    return rejectWithValue(e?.response?.data?.error || "failed");
  }
});

export const fetchLeaderboard = createAsyncThunk("stats/leaderboard", async () => {
  const { data } = await api.get("/stats/leaderboard");
  return data;
});

// Single energy resource: SPINS. They regenerate up to a floor of 5
// (one every 30 min). Spins EARNED or BOUGHT stack ABOVE the floor with
// no upper cap — regen only tops you back up to 5 if you're below it.
// Pro players ignore the gate entirely (no decrement, no regen needed).
const SPIN_REGEN_FLOOR = 5;
const SPIN_REGEN_MS = 30 * 60 * 1000;

function persist(state) { save(STORAGE_KEY, state); }

const slice = createSlice({
  name: "stats",
  initialState: loadInitial(),
  reducers: {
    // Periodic ticker (App.js fires every 30s). Only adds spins if the
    // user is below the regen floor and the clock has advanced enough
    // since the last bump. Pro skips entirely.
    tickLives: (s) => {
      if (s.pro) return;
      if ((s.free_spins || 0) >= SPIN_REGEN_FLOOR) {
        s.free_spins_updated_at = Date.now();
        return;
      }
      const now = Date.now();
      const elapsed = now - (s.free_spins_updated_at || now);
      const regen = Math.floor(elapsed / SPIN_REGEN_MS);
      if (regen > 0) {
        s.free_spins = Math.min(SPIN_REGEN_FLOOR, (s.free_spins || 0) + regen);
        s.free_spins_updated_at = (s.free_spins_updated_at || now) + regen * SPIN_REGEN_MS;
        persist(s);
      }
    },
    // Single decrement helper: every spin costs one. No more lives-vs-
    // free-spins fork — there's only one resource now. Pro doesn't pay.
    spendLife: (s) => {
      if (s.pro) return;
      if ((s.free_spins || 0) <= 0) return;
      // Start the regen clock the moment we drop BELOW the floor.
      if (s.free_spins === SPIN_REGEN_FLOOR) s.free_spins_updated_at = Date.now();
      s.free_spins = Math.max(0, s.free_spins - 1);
      persist(s);
    },
    consumeFreeSpin: (s) => {
      if (s.pro) return;
      if ((s.free_spins || 0) <= 0) return;
      if (s.free_spins === SPIN_REGEN_FLOOR) s.free_spins_updated_at = Date.now();
      s.free_spins = Math.max(0, s.free_spins - 1);
      persist(s);
    },
    grantFreeSpins: (s, a) => {
      s.free_spins = (s.free_spins || 0) + Math.max(0, Math.floor(a.payload || 0));
      persist(s);
    },
    // Backwards-named: refills the regen floor (5 spins). Doesn't reset
    // the stacked total — if you had 12 spins already, this is a no-op.
    refillLives: (s) => {
      s.free_spins = Math.max(s.free_spins || 0, SPIN_REGEN_FLOOR);
      s.free_spins_updated_at = Date.now();
      persist(s);
    },
    // Quit-penalty: cost 1 spin. Was `loseLife` in the old two-pool
    // model; same effect in the new single-pool model.
    loseLife: (s) => {
      if (s.pro) return;
      if ((s.free_spins || 0) <= 0) return;
      if (s.free_spins === SPIN_REGEN_FLOOR) s.free_spins_updated_at = Date.now();
      s.free_spins = Math.max(0, s.free_spins - 1);
      persist(s);
    },
    addCoins: (s, a) => {
      s.coins += Math.floor(a.payload || 0);
      persist(s);
    },
    spendCoins: (s, a) => {
      s.coins = Math.max(0, s.coins - Math.floor(a.payload || 0));
      persist(s);
    },
    grantPowerup: (s, a) => {
      const { id, count = 1 } = a.payload;
      s.powerups = { ...s.powerups, [id]: (s.powerups[id] || 0) + count };
      persist(s);
    },
    usePowerup: (s, a) => {
      const id = a.payload;
      if ((s.powerups[id] || 0) > 0) {
        s.powerups = { ...s.powerups, [id]: s.powerups[id] - 1 };
        persist(s);
      }
    },
    addXp: (s, a) => {
      s.xp += Math.max(0, Math.floor(a.payload || 0));
      s.level = levelForXp(s.xp);
      persist(s);
    },
    recordGame: (s, a) => {
      const { correct = 0, incorrect = 0, best_streak_run = 0 } = a.payload || {};
      s.games_played += 1;
      s.correct += correct;
      s.incorrect += incorrect;
      s.best_streak = Math.max(s.best_streak, best_streak_run);
      persist(s);
    },
    setActiveTheme: (s, a) => {
      if (s.themes.includes(a.payload)) {
        s.active_theme = a.payload;
        persist(s);
      }
    },
    grantTheme: (s, a) => {
      if (!s.themes.includes(a.payload)) {
        s.themes = [...s.themes, a.payload];
        persist(s);
      }
    },
    markCategoryPlayed: (s, a) => {
      if (!s.categories_played.includes(a.payload)) {
        s.categories_played = [...s.categories_played, a.payload];
        persist(s);
      }
    },
    markAchievement: (s, a) => {
      const id = a.payload;
      if (!s.achievements.find((x) => x.achievement_id === id)) {
        s.achievements = [...s.achievements, { achievement_id: id, unlocked_at: Date.now() }];
        persist(s);
      }
    },
    setPro: (s, a) => {
      s.pro = !!a.payload.pro;
      s.pro_until = a.payload.pro_until || null;
      persist(s);
    },
    resetLocal: () => ({ ...DEFAULT_STATS }),
  },
  extraReducers: (b) => {
    b.addCase(fetchStats.fulfilled, (s, a) => {
      const merged = mergeStats(s, a.payload);
      persist(merged);
      return merged;
    })
     .addCase(pushStatField.fulfilled, (s, a) => {
       const merged = mergeStats(s, a.payload);
       persist(merged);
       return merged;
     })
     .addCase(submitGame.fulfilled, (s, a) => {
       const merged = mergeStats(s, a.payload);
       persist(merged);
       return merged;
     })
     .addCase(unlockAchievement.fulfilled, (s, a) => {
       const merged = mergeStats(s, a.payload.data);
       persist(merged);
       return merged;
     })
     .addCase(fetchLeaderboard.fulfilled, (s, a) => {
       s.leaderboard = a.payload;
       persist(s);
     });
  },
});

export const {
  tickLives, spendLife, refillLives, loseLife, addCoins, spendCoins, consumeFreeSpin, grantFreeSpins,
  grantPowerup, usePowerup, addXp, recordGame, setActiveTheme,
  grantTheme, markCategoryPlayed, markAchievement, setPro, resetLocal,
} = slice.actions;

export default slice.reducer;
// Re-exported under the old names so the existing UI imports keep
// working — single source of truth now: SPIN_REGEN_FLOOR / SPIN_REGEN_MS.
export const LIVES_MAX_EXPORT = SPIN_REGEN_FLOOR;
export const LIVES_REGEN_MS_EXPORT = SPIN_REGEN_MS;
