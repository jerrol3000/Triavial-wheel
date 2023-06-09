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
  countdown: 10,
  revealAnswer: false,
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
      state.countdown = 10;
    },
    revealAnswer: (state) => {
      state.revealAnswer = true;
    },
    hideAnswer: (state) => {
      state.revealAnswer = false;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchQuestion.fulfilled, (state, action) => {
      state.questions = action.payload;
    });
  },
});

export const { startCountdown, resetCountdown, revealAnswer, hideAnswer } =
  questionSlice.actions;
export default questionSlice.reducer;
