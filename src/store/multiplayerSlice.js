import { createSlice } from "@reduxjs/toolkit";

const slice = createSlice({
  name: "multiplayer",
  initialState: {
    active: false,
    players: [],         // { name, score, correctCount }
    currentPlayer: 0,
    questionsPerPlayer: 5,
    questionIndex: 0,    // total across all players
    finished: false,
  },
  reducers: {
    startMatch: (s, a) => {
      s.active = true;
      s.players = (a.payload.players || []).map((name) => ({ name, score: 0, correctCount: 0 }));
      s.currentPlayer = 0;
      s.questionsPerPlayer = a.payload.questionsPerPlayer ?? 5;
      s.questionIndex = 0;
      s.finished = false;
    },
    recordPlayerResult: (s, a) => {
      const { score = 0, correct = false } = a.payload || {};
      const p = s.players[s.currentPlayer];
      if (p) {
        p.score += score;
        if (correct) p.correctCount += 1;
      }
    },
    nextPlayerTurn: (s) => {
      s.questionIndex += 1;
      const total = s.players.length * s.questionsPerPlayer;
      if (s.questionIndex >= total) {
        s.finished = true;
        return;
      }
      s.currentPlayer = (s.currentPlayer + 1) % s.players.length;
    },
    endMatch: (s) => { s.active = false; s.finished = true; },
    resetMatch: () => ({
      active: false, players: [], currentPlayer: 0,
      questionsPerPlayer: 5, questionIndex: 0, finished: false,
    }),
  },
});

export const { startMatch, recordPlayerResult, nextPlayerTurn, endMatch, resetMatch } = slice.actions;
export default slice.reducer;
