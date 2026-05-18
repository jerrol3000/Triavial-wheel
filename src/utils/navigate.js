// Centralized "exit a game" logic. Confirms + applies the right penalty for
// every way the user can leave an in-progress game. Used by Banner back,
// BottomNav, and in-view Quit buttons so the penalty is consistent.
//
// Penalty matrix:
//   Solo Play mid-round  : −1 life, −5 coins
//   Daily mid-round      : −1 life, no rewards
//   Online MID-MATCH     : −1 life client; server applies −30 rating + opponent +100
//   Online PRE-GAME      : non-supporters get −5 rating after their daily free skip;
//                          supporters (Pro OR $5+ in 30d) skip free forever
//   Multiplayer (local)  : −1 life, scores lost
//
// Pro users (unlimited lives) are exempt from the −1 life part — but Daily
// streak loss / rating drop / coins-loss still apply.
import { setView, pushToast } from "../store/uiSlice";
import { addCoins, fetchStats } from "../store/statsSlice";
import { resetRound } from "../store/gameSlice";
import { rt } from "../realtime/client";
import { api, getToken } from "../api/client";
import { confirmDialog } from "./confirm";

// Apply the server-side quit penalty AND keep the local UI snappy.
// The spin was already debited up-front in Home.onSpin via
// /use-free-spin — quitting only triggers the abandonment FEE (currently
// just -5 coins for solo). We dispatch the local coin debit first so
// the banner reflects the loss instantly, then fire the server call
// for the authoritative write. The fetchStats on response self-heals
// any drift.
function applyQuitPenalty(dispatch, context, opts = {}) {
  const { localCoinPenalty = 0 } = opts;
  if (localCoinPenalty) dispatch(addCoins(-localCoinPenalty));
  if (!getToken()) return; // Guests have no server state to sync.
  api.post("/stats/quit-penalty", { context })
    .then(() => { dispatch(fetchStats()); })
    .catch(() => { /* best-effort; local debit stands until next sync */ });
}

export function safeNavigate(targetView) {
  return async (dispatch, getState) => {
    const state = getState();
    const view = state.ui.view;
    const game = state.game;
    const online = state.online;
    const perks = (state.stats && state.stats.perks) || {};

    if (view === targetView) return;

    const inSoloGame = view === "play"   && game.questions.length > 0 && !game.finished;
    const inDaily    = view === "daily"  && game.questions.length > 0 && !game.finished;
    const inOnlineMidMatch = view === "online" && online.room && online.room.started && !online.room.finished;
    const inOnlinePreGame  = view === "online" && online.room && !online.room.started && !online.room.finished;
    const inMulti    = view === "multi"  && game.questions.length > 0 && !game.finished;

    const isSupporter = !!perks.is_supporter;

    if (inSoloGame) {
      if (!(await confirmDialog(dispatch, {
        icon: "💔",
        title: "Quit this round?",
        message: "You'll lose 5 coins as an abandonment fee. Your spin is already spent.",
        confirmText: "Quit round",
        cancelText: "Keep playing",
        destructive: true,
      }))) return;
      applyQuitPenalty(dispatch, "solo", { localCoinPenalty: 5 });
      dispatch(pushToast({ icon: "💔", title: "Round abandoned", text: "−5 coins" }));
      dispatch(resetRound());
    } else if (inDaily) {
      if (!(await confirmDialog(dispatch, {
        icon: "📅",
        title: "Forfeit today's daily?",
        message: "No rewards earned for today's challenge, and your daily streak will break.",
        confirmText: "Forfeit",
        cancelText: "Keep playing",
        destructive: true,
      }))) return;
      dispatch(pushToast({ icon: "📅", title: "Daily forfeited", text: "No rewards" }));
      dispatch(resetRound());
    } else if (inOnlineMidMatch) {
      if (!(await confirmDialog(dispatch, {
        icon: "💔",
        title: "Forfeit the match?",
        message: "Rating drops sharply (−30) and the win is awarded to your opponent.",
        confirmText: "Forfeit",
        cancelText: "Stay in match",
        destructive: true,
      }))) return;
      dispatch(pushToast({ icon: "💔", title: "Match forfeit", text: "−30 rating" }));
      try { rt.send({ type: "leave_room" }); } catch (e) {}
    } else if (inOnlinePreGame) {
      // Skip before match started. Supporters: free. Others: 1/day free, then −5 rating.
      const freeRem = isSupporter ? "unlimited" : Math.max(0, (perks.free_skips_per_day || 1) - (perks.skips_today || 0));
      const willPenalize = !isSupporter && (perks.skips_today || 0) >= (perks.free_skips_per_day || 1);
      const msg = isSupporter
        ? "Leave the matchmaking room? Supporters get unlimited free skips."
        : willPenalize
          ? `Costs ${perks.skip_rating_penalty || 5} rating — you've used your free skip today. Supporters get unlimited skips (see Shop).`
          : `Your first skip today is free (${freeRem} remaining).`;
      if (!(await confirmDialog(dispatch, {
        icon: "🚪",
        title: "Leave matchmaking?",
        message: msg,
        confirmText: "Leave",
        cancelText: "Stay",
        destructive: willPenalize,
      }))) return;
      // Server will apply rating penalty if applicable and reply via "left_room".
      try { rt.send({ type: "leave_room" }); } catch (e) {}
      // The Online view will surface the actual penalty via toast on left_room.
    } else if (inMulti) {
      if (!(await confirmDialog(dispatch, {
        icon: "💔",
        title: "Quit pass-and-play?",
        message: "Both players' scores will be lost.",
        confirmText: "Quit match",
        cancelText: "Keep playing",
        destructive: true,
      }))) return;
      dispatch(pushToast({ icon: "💔", title: "Match abandoned", text: "Scores lost" }));
      dispatch(resetRound());
    }
    dispatch(setView(targetView));
  };
}
