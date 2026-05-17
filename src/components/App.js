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
import PublicProfile from "./PublicProfile";
import Toasts from "./Toasts";
import InstallPrompt from "./InstallPrompt";
import { I18nProvider } from "../i18n";
import { tickLives, fetchStats } from "../store/statsSlice";
import { fetchMe } from "../store/authSlice";
import { fetchCatalog } from "../store/cosmeticsSlice";
import { fetchBadges } from "../store/badgesSlice";
import { api, getToken } from "../api/client";
import { fetchDailyMeta } from "../store/dailySlice";
import { setModal, pushToast } from "../store/uiSlice";
import { logout } from "../store/authSlice";
import { rt } from "../realtime/client";

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
    // Always fetch the cosmetics catalog so the Store renders fast on
    // first navigation. Includes owned/equipped state when authed.
    dispatch(fetchCatalog());
    dispatch(fetchBadges());
    if (getToken()) {
      dispatch(fetchMe());
      // Daily login bonus — claim once per UTC day. Backend is idempotent.
      // The response includes the fresh stats so we only fetchStats once
      // (used to fire twice and the second could clobber the first).
      api.post("/stats/daily-login").then((r) => {
        if (r.data && !r.data.alreadyClaimed) {
          dispatch(setModal({ name: "dailyBonus", data: r.data }));
        }
        dispatch(fetchStats());
      }).catch(() => {
        // Even if daily-login fails (e.g., offline), make sure we still
        // load stats so the UI isn't blank.
        dispatch(fetchStats());
      });
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

  // Open the WebSocket whenever we have an authed user, close it on
  // logout. Lives in its own effect (keyed on user) because the boot
  // effect above runs only once at mount — without this, a user who
  // logs in after page load via the AuthModal would never connect to
  // the WS, and live push notifications (gifts, friend requests)
  // would silently never arrive. Idempotent: rt.connect() short-
  // circuits if a socket is already open or connecting.
  useEffect(() => {
    if (!user) {
      try { rt.disconnect(); } catch (e) {}
      return;
    }
    try { rt.connect(); } catch (e) {}
  }, [user && user.id]);

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
        {modal && typeof modal === "object" && modal.name === "publicProfile" && <PublicProfile userId={modal.data?.userId} />}
        <InstallPrompt />
        <Toasts />
      </div>
    </I18nProvider>
  );
}
