import { configureStore } from "@reduxjs/toolkit";
import auth from "./authSlice";
import stats from "./statsSlice";
import game from "./gameSlice";
import daily from "./dailySlice";
import multiplayer from "./multiplayerSlice";
import ui from "./uiSlice";

const store = configureStore({
  reducer: { auth, stats, game, daily, multiplayer, ui },
  middleware: (gdm) => gdm({ serializableCheck: false }),
});

export default store;
