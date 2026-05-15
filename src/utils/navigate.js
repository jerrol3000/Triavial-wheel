// Centralized "exit a game safely" logic. Called by Banner, BottomNav,
// in-view Quit buttons — anywhere the user can leave a screen with active
// game state. Returns true if the navigation should proceed.
//
// Penalties:
//   Solo play  : -1 life, -5 coins. Confirms first.
//   Daily      : forfeit today's challenge. Confirms first.
//   Online     : send leave_room (server forfeits + rating drop). Confirms first.
//   Multiplayer: confirm + reset (no penalty — purely local).
import { setView, pushToast } from "../store/uiSlice";
import { spendLife, addCoins } from "../store/statsSlice";
import { resetRound } from "../store/gameSlice";
import { rt } from "../realtime/client";

export function safeNavigate(targetView) {
  return (dispatch, getState) => {
    const state = getState();
    const view = state.ui.view;
    const game = state.game;
    const online = state.online;

    if (view === targetView) return;

    const inSoloGame = view === "play"   && game.questions.length > 0 && !game.finished;
    const inDaily    = view === "daily"  && game.questions.length > 0 && !game.finished;
    const inOnline   = view === "online" && online.room && online.room.started && !online.room.finished;
    const inMulti    = view === "multi"  && game.questions.length > 0 && !game.finished;

    if (inSoloGame) {
      if (!confirm("Quit this round? You'll lose 1 life and 5 coins.")) return;
      dispatch(spendLife());
      dispatch(addCoins(-5));
      dispatch(pushToast({ icon: "💔", title: "Round abandoned", text: "−1 life · −5 coins" }));
      dispatch(resetRound());
    } else if (inDaily) {
      if (!confirm("Forfeit today's daily? You won't earn rewards and your streak is at risk.")) return;
      dispatch(resetRound());
      dispatch(pushToast({ icon: "📅", title: "Daily forfeited", text: "No rewards earned." }));
    } else if (inOnline) {
      if (!confirm("Forfeit the match? Your opponent wins and your rating drops.")) return;
      try { rt.send({ type: "leave_room" }); } catch (e) {}
    } else if (inMulti) {
      if (!confirm("Quit the pass-and-play match? Scores will be lost.")) return;
      dispatch(resetRound());
    }
    dispatch(setView(targetView));
  };
}
