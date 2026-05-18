import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../api/client";
import { load, save } from "../utils/storage";
import { levelForXp } from "../utils/level";

const STORAGE_KEY = "stats";
const STORAGE_VERSION = 4;  // bumped: starting spins 0 → 5 for new guests
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
  free_spins: 5,
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
  // UNION achievements (not replace). Players who earned a few
  // achievements as a guest had them wiped the moment server stats
  // arrived (e.g., on login or first /stats fetch) because the old
  // logic was `server.achievements || local.achievements` — server
  // returns [] for a newly-authed user with no server-side
  // achievements yet, blowing away the locally-earned ones.
  const localAch  = Array.isArray(local.achievements)  ? local.achievements  : [];
  const serverAch = Array.isArray(server.achievements) ? server.achievements : [];
  const byId = new Map();
  for (const a of [...localAch, ...serverAch]) {
    if (!a || !a.achievement_id) continue;
    // Prefer the earlier unlocked_at when both sides have the row.
    const existing = byId.get(a.achievement_id);
    if (!existing || (a.unlocked_at || 0) < (existing.unlocked_at || 0)) {
      byId.set(a.achievement_id, a);
    }
  }
  return sanitize({
    ...local,
    ...server,
    powerups: server.powerups || local.powerups,
    themes: server.themes || local.themes,
    achievements: Array.from(byId.values()),
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

// Manually claim accrued spin regen. The server is the single source of
// truth — it computes how many "regen ticks" the player has earned since
// their last spend below the floor, caps at the floor, and returns the
// refreshed stats row. The client just dispatches and lets fetchStats's
// extraReducer merge the response.
export const claimSpins = createAsyncThunk("stats/claimSpins", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/stats/spin-claim");
    return data;
  } catch (e) {
    const err = e?.response?.data?.error || "failed";
    return rejectWithValue({ error: err, next_in_ms: e?.response?.data?.next_in_ms });
  }
});

// Atomic server-side spin debit. Fired by Home.onSpin the moment the
// player clicks the wheel. Server returns the full updated stats row;
// extraReducer below merges it so the client's free_spins matches the
// DB without any local-only mutation that could be rolled back on
// refresh. THIS IS THE ONLY PATH that decrements free_spins for play
// — the old failure-debit in submitGame and the quit-penalty spin
// debit were both removed to avoid double-charging.
export const useFreeSpin = createAsyncThunk("stats/useFreeSpin", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/stats/use-free-spin");
    return data;
  } catch (e) {
    return rejectWithValue(e?.response?.data?.error || "failed");
  }
});

// Single energy resource: SPINS. They regenerate up to a floor of 5
// (one every 30 min). Spins EARNED or BOUGHT stack ABOVE the floor with
// no upper cap — regen only tops you back up to 5 if you're below it.
// Pro players ignore the gate entirely (no decrement, no regen needed).
// Spin regeneration economy — tuned to make the Store + ad-watch
// the primary spin sources for active players. Was floor=5 / 30min,
// which gave 240 free spins per day at the regen ceiling — enough
// that nobody needed the store. Now floor=3 / 60min = 72 free
// spins/day max. Still doable for casual play, but heavy players
// or quest hunters now have real incentive to top up via the store
// or watch an ad. Pro skips the gate entirely (regen + cap don't
// apply), so the upgrade still feels like the unlimited tier.
const SPIN_REGEN_FLOOR = 3;
const SPIN_REGEN_MS = 60 * 60 * 1000;

function persist(state) {
  // achievementUnlockQueue is transient — celebrations should ONLY
  // play in response to a live unlock during the current session.
  // Persisting and replaying on reload would surface stale toasts
  // (e.g., user unlocks something, closes the tab mid-animation,
  // reopens hours later → toast slides in for no reason). Strip it
  // before write.
  const { achievementUnlockQueue, ...rest } = state;
  save(STORAGE_KEY, rest);
}

const slice = createSlice({
  name: "stats",
  initialState: loadInitial(),
  reducers: {
    // Periodic ticker (App.js fires every 30 s). Used to auto-add spins
    // locally — but that secretly minted free spins for users who never
    // opened the app (the elapsed timer accrued whether or not the
    // server saw any activity). Now: ticker just refreshes the "pending
    // claims" counter from the LAST known server stats so the Banner's
    // claim pill updates without a /stats round-trip on every tick.
    // Actual claiming happens through dispatch(claimSpins) — server
    // is the single source of truth.
    tickLives: (s) => {
      if (s.pro) return;
      const updatedAt = s.free_spins_updated_at || 0;
      if (!updatedAt) return;
      const floor = SPIN_REGEN_FLOOR;
      const capacity = Math.max(0, floor - (s.free_spins || 0));
      if (capacity === 0) {
        s.pending_spin_claims = 0;
        s.next_spin_claim_in_ms = 0;
        return;
      }
      const elapsed = Math.max(0, Date.now() - updatedAt);
      const ticks = Math.floor(elapsed / SPIN_REGEN_MS);
      s.pending_spin_claims = Math.min(ticks, capacity);
      s.next_spin_claim_in_ms = SPIN_REGEN_MS - (elapsed % SPIN_REGEN_MS);
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
    // Replace coins with an authoritative value from the server.
    // Used after purchases so the displayed total updates immediately
    // without waiting on the next /stats poll. Negative payloads
    // ignored.
    syncCoins: (s, a) => {
      const n = Number(a.payload);
      if (!Number.isFinite(n) || n < 0) return;
      s.coins = Math.floor(n);
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
        // Push onto a transient queue the AchievementUnlock component
        // drains to play the side-slide celebration. Lives on stats
        // (not persisted across reload) so a queued-but-not-shown
        // celebration doesn't fire after a refresh.
        if (!s.achievementUnlockQueue) s.achievementUnlockQueue = [];
        if (!s.achievementUnlockQueue.find((q) => q === id)) {
          s.achievementUnlockQueue = [...s.achievementUnlockQueue, id];
        }
        persist(s);
      }
    },
    dequeueAchievementUnlock: (s) => {
      if (!s.achievementUnlockQueue) return;
      s.achievementUnlockQueue = s.achievementUnlockQueue.slice(1);
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
     .addCase(claimSpins.fulfilled, (s, a) => {
       // Server returns the freshly-claimed stats row. Mirrors the
       // merge logic used by /stats so partial server fields don't
       // wipe local-only ones (categories_played etc).
       const merged = mergeStats(s, a.payload.stats || {});
       persist(merged);
       return merged;
     })
     .addCase(useFreeSpin.fulfilled, (s, a) => {
       // Authoritative post-debit stats. Mirrors claimSpins: merge the
       // server's full row so free_spins (and any side-effect fields
       // like free_spins_updated_at, pending_spin_claims) all land
       // together. No local consume/grant needed beyond what the merge
       // does — single source of truth.
       const merged = mergeStats(s, a.payload.stats || {});
       persist(merged);
       return merged;
     })
     .addCase(useFreeSpin.rejected, (s) => {
       // Server rejected (network blip, 401 during a deploy, etc.).
       // The wheel already spun and the local consumeFreeSpin already
       // decremented — don't roll back here. The next fetchStats will
       // reconcile if needed (the server's value is the source of
       // truth). Rolling back here would cause the user to see "I
       // spun the wheel but my count went back up" — far worse UX
       // than the rare "I got a free spin once because of a network
       // hiccup."
       // Intentional no-op.
       void s;
     })
     .addCase(fetchLeaderboard.fulfilled, (s, a) => {
       s.leaderboard = a.payload;
       persist(s);
     });
  },
});

export const {
  tickLives, spendLife, refillLives, loseLife, addCoins, spendCoins, syncCoins, consumeFreeSpin, grantFreeSpins,
  grantPowerup, usePowerup, addXp, recordGame, setActiveTheme,
  grantTheme, markCategoryPlayed, markAchievement, dequeueAchievementUnlock, setPro, resetLocal,
} = slice.actions;

// re-export so Home.onSpin can drive the spin debit through the thunk
// (and Redux extraReducer merges the server response in one shot).
export { /* useFreeSpin already exported above */ };

// Re-export the regen constants the client uses for the countdown UI
// (Banner pill, claim modal). Server is authoritative; these are only
// for "next claim in 14 min" cosmetic display.
export const SPIN_REGEN_FLOOR_EXPORT = SPIN_REGEN_FLOOR;
export const SPIN_REGEN_MS_EXPORT = SPIN_REGEN_MS;

export default slice.reducer;
// Re-exported under the old names so the existing UI imports keep
// working — single source of truth now: SPIN_REGEN_FLOOR / SPIN_REGEN_MS.
export const LIVES_MAX_EXPORT = SPIN_REGEN_FLOOR;
export const LIVES_REGEN_MS_EXPORT = SPIN_REGEN_MS;
