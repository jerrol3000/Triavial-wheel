import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

export const fetchQuestion = createAsyncThunk(
  "question/fetchQuestion",
  async ({ id, mode }) => {
    try {
      const { data } = await axios.get(
        `https://opentdb.com/api.php?amount=15&category=${id}&difficulty=${mode}`
      );
      return data;
    } catch (error) {
      console.log(error);
    }
  }
);

const initialState = {
  questions: [],
  countdown: 30,
  countdownOptions: [10, 15, 30, 45, 60],
  revealAnswer: false,
  disableTimer: false,
  timerRunning: true,
};

const questionSlice = createSlice({
  name: "question",
  initialState,
  reducers: {
    startCountdown: (state) => {
      state.countdown -= 1;
      state.revealAnswer = false;
    },
    resetCountdown: (state) => {
      state.countdown;
    },
    revealAnswer: (state) => {
      state.revealAnswer = true;
    },
    hideAnswer: (state) => {
      state.revealAnswer = false;
    },
    disableTimer: (state) => {
      state.disableTimer = true;
    },
    setCountdown: (state, action) => {
      state.countdown = action.payload;
    },
    stopTimer: (state) => {
      state.timerRunning = false;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchQuestion.fulfilled, (state, action) => {
      state.questions = action.payload;
    });
  },
});

export const {
  startCountdown,
  resetCountdown,
  revealAnswer,
  hideAnswer,
  disableTimer,
  setCountdown,
  stopTimer,
} = questionSlice.actions;
export default questionSlice.reducer;
