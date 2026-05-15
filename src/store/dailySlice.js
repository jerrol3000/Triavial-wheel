import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import { api } from "../api/client";
import { hashString, mulberry32, shuffleWith } from "../utils/seed";
import { CATEGORIES } from "../data/categories";

export const fetchDailyMeta = createAsyncThunk("daily/meta", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/daily/today");
    return data;
  } catch (e) {
    // anonymous fallback
    const d = new Date();
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    return { date, seed: date, alreadyPlayed: false };
  }
});

// Daily question set: the server stores a deterministic-per-date set and returns the same
// list to every player. We still derive a "category teaser" client-side from the seed.
export const fetchDailyQuestions = createAsyncThunk(
  "daily/questions",
  async ({ seed, amount = 10 }) => {
    const rng = mulberry32(hashString(seed));
    const ordered = shuffleWith(rng, CATEGORIES.filter((c) => !c.premium));
    const cat = ordered[0];
    try {
      const { data } = await api.get("/daily/questions", { timeout: 4000 });
      if (Array.isArray(data?.questions) && data.questions.length) {
        return { category: cat, results: data.questions.slice(0, amount) };
      }
    } catch (e) {
      // fall through to opentdb
    }
    try {
      const { data } = await axios.get(
        `https://opentdb.com/api.php?amount=${amount}&category=${cat.id}&type=multiple&difficulty=medium`,
        { timeout: 5000 }
      );
      if (data?.response_code === 0 && Array.isArray(data.results) && data.results.length) {
        return { category: cat, results: shuffleWith(rng, data.results).slice(0, amount) };
      }
    } catch (e) {
      // fall through
    }
    return { category: cat, results: [] };
  }
);

export const submitDaily = createAsyncThunk("daily/submit", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/daily/submit", payload);
    return data;
  } catch (e) {
    return rejectWithValue(e?.response?.data?.error || "failed");
  }
});

export const fetchDailyLeaderboard = createAsyncThunk("daily/leaderboard", async (date) => {
  const { data } = await api.get("/daily/leaderboard" + (date ? `?date=${date}` : ""));
  return data;
});

const slice = createSlice({
  name: "daily",
  initialState: {
    date: null,
    seed: null,
    alreadyPlayed: false,
    category: null,
    questions: [],
    loading: false,
    error: null,
    submitted: false,
    leaderboard: [],
    leaderboardDate: null,
    lastResult: null, // { score, correct, total, time_ms, perQuestion }
  },
  reducers: {
    setLastResult: (s, a) => { s.lastResult = a.payload; },
    resetDaily: (s) => {
      s.questions = [];
      s.category = null;
      s.lastResult = null;
      s.submitted = false;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchDailyMeta.fulfilled, (s, a) => {
      s.date = a.payload.date;
      s.seed = a.payload.seed;
      s.alreadyPlayed = a.payload.alreadyPlayed;
    })
     .addCase(fetchDailyQuestions.pending, (s) => { s.loading = true; })
     .addCase(fetchDailyQuestions.fulfilled, (s, a) => {
       s.loading = false;
       s.category = a.payload.category;
       s.questions = a.payload.results;
     })
     .addCase(fetchDailyQuestions.rejected, (s, a) => { s.loading = false; s.error = a.payload; })
     .addCase(submitDaily.fulfilled, (s) => { s.submitted = true; s.alreadyPlayed = true; })
     .addCase(fetchDailyLeaderboard.fulfilled, (s, a) => {
       s.leaderboard = a.payload.leaderboard || [];
       s.leaderboardDate = a.payload.date;
     });
  },
});

export const { setLastResult, resetDaily } = slice.actions;
export default slice.reducer;
