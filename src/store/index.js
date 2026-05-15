import { configureStore } from "@reduxjs/toolkit";
import auth from "./authSlice";
import stats from "./statsSlice";
import game from "./gameSlice";
import daily from "./dailySlice";
import multiplayer from "./multiplayerSlice";
import online from "./onlineSlice";
import ui from "./uiSlice";

const store = configureStore({
  reducer: { auth, stats, game, daily, multiplayer, online, ui },
  middleware: (gdm) => gdm({ serializableCheck: false }),
});

export default store;
