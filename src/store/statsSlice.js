import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../api/client";
import { load, save } from "../utils/storage";
import { levelForXp } from "../utils/level";

const STORAGE_KEY = "stats";

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
  // Lives (local-only; not on server)
  lives: 5,
  lives_updated_at: Date.now(),
  // Local-only category-played set
  categories_played: [],
  // Cache of leaderboard
  leaderboard: [],
};

function mergeStats(local, server) {
  // Server is source of truth for everything except `lives` and `categories_played` (local-only).
  return {
    ...local,
    ...server,
    powerups: server.powerups || local.powerups,
    themes: server.themes || local.themes,
    achievements: server.achievements || local.achievements,
  };
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

const LIVES_MAX = 5;
const LIVES_REGEN_MS = 30 * 60 * 1000; // 30 minutes per life

function persist(state) { save(STORAGE_KEY, state); }

const slice = createSlice({
  name: "stats",
  initialState: load(STORAGE_KEY, DEFAULT_STATS),
  reducers: {
    tickLives: (s) => {
      if (s.pro) { s.lives = LIVES_MAX; return; }
      if (s.lives >= LIVES_MAX) { s.lives_updated_at = Date.now(); return; }
      const now = Date.now();
      const elapsed = now - (s.lives_updated_at || now);
      const regen = Math.floor(elapsed / LIVES_REGEN_MS);
      if (regen > 0) {
        s.lives = Math.min(LIVES_MAX, s.lives + regen);
        s.lives_updated_at = (s.lives_updated_at || now) + regen * LIVES_REGEN_MS;
      }
      persist(s);
    },
    spendLife: (s) => {
      if (s.pro) return;
      if (s.lives === LIVES_MAX) s.lives_updated_at = Date.now();
      s.lives = Math.max(0, s.lives - 1);
      persist(s);
    },
    refillLives: (s) => {
      s.lives = LIVES_MAX;
      s.lives_updated_at = Date.now();
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
  tickLives, spendLife, refillLives, addCoins, spendCoins,
  grantPowerup, usePowerup, addXp, recordGame, setActiveTheme,
  grantTheme, markCategoryPlayed, markAchievement, setPro, resetLocal,
} = slice.actions;

export default slice.reducer;
export const LIVES_MAX_EXPORT = LIVES_MAX;
export const LIVES_REGEN_MS_EXPORT = LIVES_REGEN_MS;
