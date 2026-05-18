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
import { loseLife, addCoins, fetchStats } from "../store/statsSlice";
import { resetRound } from "../store/gameSlice";
import { rt } from "../realtime/client";
import { api, getToken } from "../api/client";

// Apply the server-side quit penalty AND keep the local UI snappy.
// We dispatch the local decrement first (so the banner reflects the
// loss instantly), then fire the server call which is the source of
// truth — its loadStats response (merged via fetchStats) corrects any
// drift between client + server values.
//
// Without the server call the local mutation would survive only until
// the next fetchStats, then snap back to the server's stale numbers
// — that's the "coins/spins reset on refresh" bug.
function applyQuitPenalty(dispatch, context, opts = {}) {
  const { isPro, localSpin = true, localCoinPenalty = 0 } = opts;
  if (localSpin && !isPro) dispatch(loseLife());
  if (localCoinPenalty) dispatch(addCoins(-localCoinPenalty));
  if (!getToken()) return; // Guests have no server state to sync.
  api.post("/stats/quit-penalty", { context })
    .then(() => { dispatch(fetchStats()); })
    .catch(() => { /* best-effort; local decrements stand until next sync */ });
}

export function safeNavigate(targetView) {
  return (dispatch, getState) => {
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

    const isPro = !!state.stats.pro;
    const isSupporter = !!perks.is_supporter;
    const lifeLost = isPro ? "" : " −1 life";

    if (inSoloGame) {
      if (!confirm(`Quit this round?${lifeLost ? " You'll lose" + lifeLost + " and 5 coins." : " You'll lose 5 coins."}`)) return;
      applyQuitPenalty(dispatch, "solo", { isPro, localCoinPenalty: 5 });
      dispatch(pushToast({ icon: "💔", title: "Round abandoned", text: isPro ? "−5 coins" : "−1 life · −5 coins" }));
      dispatch(resetRound());
    } else if (inDaily) {
      if (!confirm(`Forfeit today's daily?${lifeLost ? " You'll lose" + lifeLost + " and no rewards." : " No rewards earned."}`)) return;
      applyQuitPenalty(dispatch, "daily", { isPro });
      dispatch(pushToast({ icon: "📅", title: "Daily forfeited", text: isPro ? "No rewards" : "−1 life · no rewards" }));
      dispatch(resetRound());
    } else if (inOnlineMidMatch) {
      if (!confirm(`Forfeit the match?${lifeLost ? " You'll lose" + lifeLost + " and rating drops sharply." : " Rating drops sharply."}`)) return;
      applyQuitPenalty(dispatch, "online_mid", { isPro });
      dispatch(pushToast({ icon: "💔", title: "Match forfeit", text: isPro ? "−30 rating" : "−1 life · −30 rating" }));
      try { rt.send({ type: "leave_room" }); } catch (e) {}
    } else if (inOnlinePreGame) {
      // Skip before match started. Supporters: free. Others: 1/day free, then −5 rating.
      const freeRem = isSupporter ? "unlimited" : Math.max(0, (perks.free_skips_per_day || 1) - (perks.skips_today || 0));
      const willPenalize = !isSupporter && (perks.skips_today || 0) >= (perks.free_skips_per_day || 1);
      const msg = isSupporter
        ? "Leave the matchmaking room?"
        : willPenalize
          ? `Leave the matchmaking room? Costs ${perks.skip_rating_penalty || 5} rating (you've used your free skip today). Supporters get unlimited skips — see Shop.`
          : `Leave the matchmaking room? Your first skip today is free (${freeRem} remaining).`;
      if (!confirm(msg)) return;
      // Server will apply rating penalty if applicable and reply via "left_room".
      try { rt.send({ type: "leave_room" }); } catch (e) {}
      // The Online view will surface the actual penalty via toast on left_room.
    } else if (inMulti) {
      if (!confirm(`Quit the pass-and-play match?${lifeLost ? " You'll lose" + lifeLost + " and scores are lost." : " Scores are lost."}`)) return;
      applyQuitPenalty(dispatch, "multi", { isPro });
      dispatch(pushToast({ icon: "💔", title: "Match abandoned", text: isPro ? "Scores lost" : "−1 life · scores lost" }));
      dispatch(resetRound());
    }
    dispatch(setView(targetView));
  };
}
