import { createSlice } from "@reduxjs/toolkit";
import { load, save } from "../utils/storage";
import { setSoundEnabled } from "../utils/sound";

const initial = { ...load("ui", { soundOn: true, view: "home", modal: null, toasts: [] }), profileTab: null };
setSoundEnabled(initial.soundOn);

let toastId = 1;

const slice = createSlice({
  name: "ui",
  initialState: initial,
  reducers: {
    setView: (s, a) => {
      s.view = a.payload;
      // Clearing any pinned profileTab on navigation away keeps Profile's
      // default landing tab behavior intact for normal nav.
      if (a.payload !== "profile") s.profileTab = null;
      save("ui", { soundOn: s.soundOn, view: s.view, modal: null, toasts: [] });
    },
    // Lets other views deep-link to a specific tab when opening Profile
    // (e.g., the Store's "Inventory" pill opens Profile → inventory tab).
    setProfileTab: (s, a) => { s.profileTab = a.payload; },
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

export const { setView, setProfileTab, setModal, closeModal, toggleSound, pushToast, dismissToast } = slice.actions;
export default slice.reducer;
