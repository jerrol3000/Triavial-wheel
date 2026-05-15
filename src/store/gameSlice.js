import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import { decode } from "html-entities";
import { api } from "../api/client";
import { CATEGORIES } from "../data/categories";

// Last-resort bank if both backend AND opentdb are unreachable.
const FALLBACK = [
  { question: "What is the capital of France?", correct_answer: "Paris", incorrect_answers: ["Lyon", "Marseille", "Nice"], category: "Geography" },
  { question: "Who wrote 'Romeo and Juliet'?", correct_answer: "William Shakespeare", incorrect_answers: ["Charles Dickens", "Mark Twain", "Jane Austen"], category: "Literature" },
  { question: "What is 7 × 8?", correct_answer: "56", incorrect_answers: ["54", "64", "48"], category: "Math" },
  { question: "Which planet is known as the Red Planet?", correct_answer: "Mars", incorrect_answers: ["Venus", "Jupiter", "Saturn"], category: "Science" },
  { question: "What year did World War II end?", correct_answer: "1945", incorrect_answers: ["1944", "1946", "1939"], category: "History" },
];

export const QUESTIONS_PER_ROUND = 10;
export const TIME_PER_QUESTION = 20;
export const BASE_POINTS = 100;

// Prefer our DB-backed question bank; fall back to opentdb live; last resort = bundled FALLBACK.
export const fetchRoundQuestions = createAsyncThunk(
  "game/fetchRoundQuestions",
  async ({ categoryId, mode = "easy", amount = QUESTIONS_PER_ROUND }) => {
    try {
      const params = { difficulty: mode, amount };
      if (categoryId) params.category = categoryId;
      const { data } = await api.get("/questions", { params, timeout: 4000 });
      if (Array.isArray(data?.results) && data.results.length) return data.results;
    } catch (e) {
      // fall through to opentdb
    }
    try {
      const url = `https://opentdb.com/api.php?amount=${amount}&type=multiple${categoryId ? `&category=${categoryId}` : ""}&difficulty=${mode}`;
      const { data } = await axios.get(url, { timeout: 5000 });
      if (data?.response_code === 0 && Array.isArray(data.results) && data.results.length) return data.results;
    } catch (e) {
      // fall through
    }
    return FALLBACK.slice(0, amount).map((q) => ({ ...q, difficulty: mode }));
  }
);

function buildAnswerSet(q) {
  const all = [...q.incorrect_answers, q.correct_answer]
    .map((a) => decode(String(a)));
  // shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

const slice = createSlice({
  name: "game",
  initialState: {
    mode: "easy",
    activeCategoryId: null,
    isMystery: false,
    questions: [],
    index: 0,
    answers: [],
    selectedAnswer: null,
    showResult: false,
    streak: 0,
    bestStreakRun: 0,
    score: 0,
    correct: 0,
    incorrect: 0,
    perQuestion: [], // true / false / null
    eliminated: [],
    doubleArmed: false,
    timeLeft: TIME_PER_QUESTION,
    paused: false,
    finished: false,
    loading: false,
    error: null,
    startedAt: null,
  },
  reducers: {
    startRound: (s, a) => {
      s.activeCategoryId = a.payload?.categoryId ?? null;
      s.isMystery = !!a.payload?.isMystery;
      s.mode = a.payload?.mode ?? "easy";
      s.index = 0;
      s.score = 0;
      s.correct = 0;
      s.incorrect = 0;
      s.streak = 0;
      s.bestStreakRun = 0;
      s.perQuestion = [];
      s.eliminated = [];
      s.doubleArmed = false;
      s.selectedAnswer = null;
      s.showResult = false;
      s.timeLeft = TIME_PER_QUESTION;
      s.paused = false;
      s.finished = false;
      s.startedAt = Date.now();
    },
    setMode: (s, a) => { s.mode = a.payload; },
    tickTimer: (s) => {
      if (s.paused || s.showResult || s.finished || !s.questions.length) return;
      s.timeLeft = Math.max(0, s.timeLeft - 1);
      if (s.timeLeft === 0) {
        // out of time → wrong
        s.showResult = true;
        s.incorrect += 1;
        s.streak = 0;
        s.perQuestion.push(false);
      }
    },
    pauseTimer: (s) => { s.paused = true; },
    resumeTimer: (s) => { s.paused = false; },
    answerSelected: (s, a) => {
      if (s.showResult || s.finished) return;
      const ans = a.payload;
      s.selectedAnswer = ans;
      s.showResult = true;
      const current = s.questions[s.index];
      const correctDecoded = decode(String(current.correct_answer));
      const isRight = ans === correctDecoded;
      if (isRight) {
        const timeBonus = Math.round((s.timeLeft / TIME_PER_QUESTION) * 50);
        const streakMul = 1 + Math.min(s.streak, 9) * 0.1; // up to 1.9x at 9-streak
        const diffMul = s.mode === "easy" ? 1 : s.mode === "medium" ? 1.5 : 2;
        const doubleMul = s.doubleArmed ? 2 : 1;
        const mysteryMul = s.isMystery ? 1.5 : 1;
        const gained = Math.round((BASE_POINTS + timeBonus) * streakMul * diffMul * doubleMul * mysteryMul);
        s.score += gained;
        s.correct += 1;
        s.streak += 1;
        s.bestStreakRun = Math.max(s.bestStreakRun, s.streak);
        s.perQuestion.push(true);
      } else {
        s.incorrect += 1;
        s.streak = 0;
        s.perQuestion.push(false);
      }
      s.doubleArmed = false;
    },
    nextQuestion: (s) => {
      if (s.index + 1 >= s.questions.length) {
        s.finished = true;
        return;
      }
      s.index += 1;
      const next = s.questions[s.index];
      s.answers = buildAnswerSet(next);
      s.selectedAnswer = null;
      s.showResult = false;
      s.eliminated = [];
      s.doubleArmed = false;
      s.timeLeft = TIME_PER_QUESTION;
    },
    skipQuestion: (s) => {
      // counts as neither correct nor incorrect, no streak break
      s.perQuestion.push(null);
      if (s.index + 1 >= s.questions.length) {
        s.finished = true;
      } else {
        s.index += 1;
        const next = s.questions[s.index];
        s.answers = buildAnswerSet(next);
        s.selectedAnswer = null;
        s.showResult = false;
        s.eliminated = [];
        s.doubleArmed = false;
        s.timeLeft = TIME_PER_QUESTION;
      }
    },
    usePowerupFifty: (s) => {
      if (s.showResult || s.eliminated.length) return;
      const current = s.questions[s.index];
      const correct = decode(String(current.correct_answer));
      const wrongs = s.answers.filter((a) => a !== correct);
      // remove two wrongs
      s.eliminated = wrongs.slice(0, 2);
    },
    usePowerupFreeze: (s) => {
      s.timeLeft = Math.min(60, s.timeLeft + 15);
    },
    usePowerupDouble: (s) => {
      if (!s.showResult) s.doubleArmed = true;
    },
    setAnswers: (s, a) => { s.answers = a.payload; },
    setQuestions: (s, a) => {
      s.questions = a.payload;
      s.index = 0;
      s.answers = a.payload[0] ? buildAnswerSet(a.payload[0]) : [];
    },
    endRound: (s) => { s.finished = true; },
    resetRound: (s) => {
      s.questions = [];
      s.answers = [];
      s.index = 0;
      s.finished = false;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchRoundQuestions.pending, (s) => { s.loading = true; s.error = null; })
     .addCase(fetchRoundQuestions.fulfilled, (s, a) => {
       s.loading = false;
       s.questions = a.payload;
       s.index = 0;
       s.answers = a.payload[0] ? buildAnswerSet(a.payload[0]) : [];
       s.timeLeft = TIME_PER_QUESTION;
     })
     .addCase(fetchRoundQuestions.rejected, (s, a) => { s.loading = false; s.error = a.payload || "failed"; });
  },
});

export const {
  startRound, setMode, tickTimer, pauseTimer, resumeTimer,
  answerSelected, nextQuestion, skipQuestion,
  usePowerupFifty, usePowerupFreeze, usePowerupDouble,
  setAnswers, setQuestions, endRound, resetRound,
} = slice.actions;

export default slice.reducer;
export { CATEGORIES };
