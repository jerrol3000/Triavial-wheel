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
import Online from "./Online";
import AuthModal from "./AuthModal";
import DailyBonusModal from "./DailyBonusModal";
import AdRewardModal from "./AdRewardModal";
import Toasts from "./Toasts";
import { tickLives, fetchStats } from "../store/statsSlice";
import { fetchMe } from "../store/authSlice";
import { api, getToken } from "../api/client";
import { fetchDailyMeta } from "../store/dailySlice";
import { setModal } from "../store/uiSlice";

const VIEWS = { home: Home, play: Play, daily: Daily, online: Online, multi: Multiplayer, shop: Shop, profile: Profile };

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
      // Daily login bonus — claim once per UTC day. Backend is idempotent.
      api.post("/stats/daily-login").then((r) => {
        if (r.data && !r.data.alreadyClaimed) {
          dispatch(setModal({ name: "dailyBonus", data: r.data }));
        }
        dispatch(fetchStats());
      }).catch(() => {});
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
      {(modal === "auth" || (modal && modal.name === "auth")) && <AuthModal />}
      {modal && typeof modal === "object" && modal.name === "dailyBonus" && <DailyBonusModal data={modal.data} />}
      {modal && typeof modal === "object" && modal.name === "adReward" && <AdRewardModal reward={modal.data?.reward} />}
      <Toasts />
    </div>
  );
}
