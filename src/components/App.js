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
import Settings from "./Settings";
import AuthModal from "./AuthModal";
import DailyBonusModal from "./DailyBonusModal";
import AdRewardModal from "./AdRewardModal";
import Toasts from "./Toasts";
import InstallPrompt from "./InstallPrompt";
import { I18nProvider } from "../i18n";
import { tickLives, fetchStats } from "../store/statsSlice";
import { fetchMe } from "../store/authSlice";
import { api, getToken } from "../api/client";
import { fetchDailyMeta } from "../store/dailySlice";
import { setModal, pushToast } from "../store/uiSlice";
import { logout } from "../store/authSlice";

const VIEWS = { home: Home, play: Play, daily: Daily, online: Online, multi: Multiplayer, shop: Shop, profile: Profile, settings: Settings };

export default function App() {
  const dispatch = useDispatch();
  const view = useSelector((s) => s.ui.view);
  const modal = useSelector((s) => s.ui.modal);
  const user = useSelector((s) => s.auth.user);

  useEffect(() => {
    // Handle Stripe success-redirect: if the URL has ?paid=1&session=..., verify on the server.
    try {
      const params = new URLSearchParams(window.location.search);
      const session = params.get("session");
      if (params.get("paid") === "1" && session && getToken()) {
        api.post("/pay/stripe/verify", { session_id: session })
          .then((r) => {
            if (r.data?.ok) dispatch(fetchStats());
          })
          .catch(() => {})
          .finally(() => {
            // Clean the URL.
            window.history.replaceState({}, document.title, window.location.pathname);
          });
      }
    } catch (e) {}

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

    // When any authed request hits 401, the API client clears the token and
    // dispatches this event — surface a clear "your session expired" notice
    // and open the auth modal so the user can sign back in. Most common
    // trigger: server was restarted with a new JWT_SECRET.
    const onExpired = (e) => {
      const reason = e && e.detail && e.detail.error;
      dispatch(logout());
      dispatch(pushToast({
        icon: "🔒",
        title: reason === "session_superseded" ? "Signed out" : "Session expired",
        text: reason === "session_superseded"
          ? "Your account just signed in on another device."
          : "Please sign in again.",
        duration: 6000,
      }));
      dispatch(setModal("auth"));
    };
    window.addEventListener("trivia_auth_expired", onExpired);

    return () => {
      clearInterval(id);
      window.removeEventListener("trivia_auth_expired", onExpired);
    };
  }, [dispatch]);

  const ViewComp = VIEWS[view] || Home;
  return (
    <I18nProvider user={user}>
      <div className="tw-app">
        <Banner />
        <main className={`tw-content tw-fade-in ${view === "home" ? "wide" : ""}`} key={view}>
          <ViewComp />
        </main>
        <BottomNav />
        {(modal === "auth" || (modal && modal.name === "auth")) && <AuthModal />}
        {modal && typeof modal === "object" && modal.name === "dailyBonus" && <DailyBonusModal data={modal.data} />}
        {modal && typeof modal === "object" && modal.name === "adReward" && <AdRewardModal reward={modal.data?.reward} />}
        <InstallPrompt />
        <Toasts />
      </div>
    </I18nProvider>
  );
}
