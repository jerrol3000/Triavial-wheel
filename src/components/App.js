import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import Banner from "./Banner";
import BottomNav from "./BottomNav";
import Home from "./Home";
import Play from "./Play";
import Daily from "./Daily";
import Multiplayer from "./Multiplayer";
import Shop from "./Shop";
import Profile from "./Profile";
import AuthModal from "./AuthModal";
import Toasts from "./Toasts";
import { tickLives, fetchStats } from "../store/statsSlice";
import { fetchMe } from "../store/authSlice";
import { getToken } from "../api/client";
import { fetchDailyMeta } from "../store/dailySlice";

const VIEWS = { home: Home, play: Play, daily: Daily, multi: Multiplayer, shop: Shop, profile: Profile };

export default function App() {
  const dispatch = useDispatch();
  const view = useSelector((s) => s.ui.view);
  const modal = useSelector((s) => s.ui.modal);

  useEffect(() => {
    dispatch(tickLives());
    dispatch(fetchDailyMeta());
    if (getToken()) {
      dispatch(fetchStats());
      dispatch(fetchMe());
    }
    const id = setInterval(() => dispatch(tickLives()), 30 * 1000);
    return () => clearInterval(id);
  }, [dispatch]);

  const ViewComp = VIEWS[view] || Home;
  return (
    <div className="tw-app">
      <Banner />
      <main className="tw-content tw-fade-in" key={view}>
        <ViewComp />
      </main>
      <BottomNav />
      {modal === "auth" && <AuthModal />}
      <Toasts />
    </div>
  );
}
