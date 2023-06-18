import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

export const fetchQuestion = createAsyncThunk(
  "question/fetchQuestion",
  async ({ id, mode }) => {
    try {
      const { data } = await axios.get(
        `https://opentdb.com/api.php?amount=50&category=${id}&difficulty=${mode}`
      );
      return data;
    } catch (error) {
      console.log(error);
    }
  }
);

const initialState = [];

const questionSlice = createSlice({
  name: "question",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(fetchQuestion.fulfilled, (state, action) => {
      return action.payload;
    });
  },
});

export default questionSlice.reducer;
