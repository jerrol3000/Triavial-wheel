import { createSlice } from "@reduxjs/toolkit";
import { load, save } from "../utils/storage";
import { setSoundEnabled } from "../utils/sound";

const initial = load("ui", { soundOn: true, view: "home", modal: null, toasts: [] });
setSoundEnabled(initial.soundOn);

let toastId = 1;

const slice = createSlice({
  name: "ui",
  initialState: initial,
  reducers: {
    setView: (s, a) => {
      s.view = a.payload;
      save("ui", { soundOn: s.soundOn, view: s.view, modal: null, toasts: [] });
    },
    setModal: (s, a) => { s.modal = a.payload; },
    closeModal: (s) => { s.modal = null; },
    toggleSound: (s) => {
      s.soundOn = !s.soundOn;
      setSoundEnabled(s.soundOn);
      save("ui", { soundOn: s.soundOn, view: s.view, modal: null, toasts: [] });
    },
    pushToast: (s, a) => {
      s.toasts = [...s.toasts, { id: toastId++, ...a.payload }];
    },
    dismissToast: (s, a) => {
      s.toasts = s.toasts.filter((t) => t.id !== a.payload);
    },
  },
});

export const { setView, setModal, closeModal, toggleSound, pushToast, dismissToast } = slice.actions;
export default slice.reducer;
