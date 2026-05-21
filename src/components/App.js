import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import Banner from "./Banner";
import BottomNav from "./BottomNav";
import Home from "./Home";
import Play from "./Play";
import Daily from "./Daily";
import HigherLower from "./HigherLower";
import SeasonPass from "./SeasonPass";
import FriendChallenges from "./FriendChallenges";
import WheelView from "./WheelView";
import Multiplayer from "./Multiplayer";
import Shop from "./Shop";
import Profile from "./Profile";
import Online from "./Online";
import SoloArena from "./SoloArena";
import Settings from "./Settings";
import AuthModal from "./AuthModal";
import DailyBonusModal from "./DailyBonusModal";
import AdRewardModal from "./AdRewardModal";
import PublicProfile from "./PublicProfile";
import PublicDaily from "./PublicDaily";
import ConfirmModal from "./ConfirmModal";
import Toasts from "./Toasts";
import BadgeUnlock from "./BadgeUnlock";
import AchievementUnlock from "./AchievementUnlock";
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

const VIEWS = { home: Home, play: Play, daily: Daily, online: Online, multi: Multiplayer, shop: Shop, profile: Profile, settings: Settings, higherlower: HigherLower, season: SeasonPass, challenges: FriendChallenges, wheel: WheelView, solo: SoloArena };

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
    // WAKE THE BACKEND. Fly machines scale-to-zero on idle and the
    // first request after a sleep can take 2-4 seconds while the VM
    // spins back up. Without this, a player who hadn't touched the
    // app in a few hours would click VS and stare at "Connecting to
    // live server…" while Fly cold-started. Now: we ping /api/health
    // in parallel with every other boot fetch so the server is hot
    // by the time the player clicks anything.
    try { api.get("/health").catch(() => {}); } catch (e) {}
    // EAGER WS connect — fires off the token (synchronous), NOT off
    // the user object (async via fetchMe). Saves the ~200-500 ms
    // round-trip between app boot and user resolution. The
    // dedicated user-keyed useEffect below still handles
    // sign-in-after-boot for guests who auth via the AuthModal.
    if (getToken()) { try { rt.connect(); } catch (e) {} }
    if (getToken()) {
      dispatch(fetchMe());
      // Daily login bonus — claim once per UTC day. Backend is idempotent.
      // The response includes the fresh stats so we only fetchStats once
      // (used to fire twice and the second could clobber the first).
      // After stats land, surface a single "your free spins are ready"
      // toast if the player has unclaimed regen waiting. The Banner pill
      // is the primary affordance (animated + tappable); the toast just
      // makes sure first-time players notice the new mechanic.
      const afterStats = (statsPayload) => {
        const pending = (statsPayload && !statsPayload.pro) ? (statsPayload.pending_spin_claims || 0) : 0;
        if (pending > 0) {
          dispatch(pushToast({
            icon: "🎡",
            title: `${pending} free spin${pending === 1 ? "" : "s"} ready!`,
            text: "Tap the glowing pill in the top bar to claim.",
            duration: 5500,
          }));
        }
      };
      api.post("/stats/daily-login").then((r) => {
        if (r.data && !r.data.alreadyClaimed) {
          dispatch(setModal({ name: "dailyBonus", data: r.data }));
        }
        dispatch(fetchStats()).then((res) => {
          if (res && res.meta && res.meta.requestStatus === "fulfilled") afterStats(res.payload);
        });
      }).catch(() => {
        // Even if daily-login fails (e.g., offline), make sure we still
        // load stats so the UI isn't blank.
        dispatch(fetchStats()).then((res) => {
          if (res && res.meta && res.meta.requestStatus === "fulfilled") afterStats(res.payload);
        });
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

  // Public Daily takeover: /d/<YYYY-MM-DD> bypasses the normal app
  // shell entirely. No Banner, no BottomNav, no daily-bonus modal —
  // a guest who clicks the share-link should drop straight into the
  // 5-question challenge with zero chrome between them and the first
  // question. The boot effect above still runs (auth, stats, etc.)
  // because that's a no-op for guests and beneficial for authed
  // users (preserves streak data). When the player exits the daily
  // we replaceState back to "/" so navigation feels normal.
  const isPublicDaily = typeof window !== "undefined" && /^\/d\/\d{4}-\d{2}-\d{2}$/.test(window.location.pathname);
  if (isPublicDaily) {
    return (
      <I18nProvider user={user}>
        <div className="tw-app" style={{ background: "linear-gradient(135deg, #1e1b4b, #312e81)", minHeight: "100vh" }}>
          <main className="tw-content tw-fade-in" style={{ paddingTop: 16, paddingBottom: 24, maxWidth: 560, margin: "0 auto" }}>
            <PublicDaily />
          </main>
          {(modal === "auth" || (modal && modal.name === "auth")) && <AuthModal />}
          {modal && typeof modal === "object" && modal.name === "confirm" && <ConfirmModal data={modal.data} />}
          <Toasts />
        </div>
      </I18nProvider>
    );
  }

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
        {modal && typeof modal === "object" && modal.name === "confirm" && <ConfirmModal data={modal.data} />}
        <InstallPrompt />
        <Toasts />
        {/* Full-screen badge unlock celebration. Mounts at app root
            so it appears regardless of current view. Draws from a
            Redux queue so multiple simultaneous unlocks play in
            sequence (~3.8 s each). */}
        <BadgeUnlock />
        {/* Side-slide achievement unlock toast — lighter touch than
            BadgeUnlock because achievements fire much more often.
            Same queue pattern, FIFO. */}
        <AchievementUnlock />
      </div>
    </I18nProvider>
  );
}
