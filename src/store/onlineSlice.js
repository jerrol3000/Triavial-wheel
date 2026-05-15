import { createSlice } from "@reduxjs/toolkit";

const slice = createSlice({
  name: "online",
  initialState: {
    connected: false,
    waiting: false,           // in quick-match queue
    room: null,               // public room state from server
    matchEnd: null,           // final result
    error: null,
    chatNotice: null,         // last filtered / rate / muted notice
    lastReaction: null,       // for transient flying emoji animation
    opponentAnswered: false,  // shows "Opponent answered!" UI hint
    reveal: null,             // last round_reveal payload
  },
  reducers: {
    setConnected: (s, a) => { s.connected = a.payload; },
    setWaiting: (s, a) => { s.waiting = a.payload; },
    setRoom: (s, a) => {
      s.room = a.payload;
      s.waiting = false;
      s.matchEnd = null;
      s.error = null;
    },
    setError: (s, a) => { s.error = a.payload; },
    setMatchEnd: (s, a) => { s.matchEnd = a.payload; },
    setReveal: (s, a) => { s.reveal = a.payload; },
    setOpponentAnswered: (s, a) => { s.opponentAnswered = !!a.payload; },
    setChatNotice: (s, a) => { s.chatNotice = a.payload; },
    pushChat: (s, a) => {
      if (!s.room) return;
      s.room.chat = [...(s.room.chat || []), a.payload].slice(-50);
    },
    pushReaction: (s, a) => { s.lastReaction = a.payload; },
    leftRoom: (s) => {
      s.room = null;
      s.matchEnd = null;
      s.waiting = false;
      s.reveal = null;
      s.chatNotice = null;
    },
  },
});

export const {
  setConnected, setWaiting, setRoom, setError, setMatchEnd,
  setReveal, setOpponentAnswered, setChatNotice, pushChat, pushReaction, leftRoom,
} = slice.actions;

export default slice.reducer;
