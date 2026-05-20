// Central registry of mini-game components by type. Adding a new
// game = drop a file in this folder + register it here. The runner
// below + the rest of the app stay generic. Keys MUST match the IDs
// in server/minigames.js — that's the contract the server uses to
// describe a round to the client.
import TapRace from "./TapRace";
import Reaction from "./Reaction";
import ColorMatch from "./ColorMatch";
import Memory from "./Memory";
import QuickMath from "./QuickMath";
import BubblePop from "./BubblePop";
import Whack from "./Whack";
import OddOneOut from "./OddOneOut";
import NumberRush from "./NumberRush";
import CatchBug from "./CatchBug";
import Memorize from "./Memorize";
import HiLoSprint from "./HiLoSprint";

export const GAMES = {
  tap_race:     { component: TapRace,    name: "Tap Race",       icon: "👆" },
  reaction:     { component: Reaction,   name: "Reaction",       icon: "⚡" },
  color_match:  { component: ColorMatch, name: "Color Match",    icon: "🎨" },
  memory:       { component: Memory,     name: "Memory",         icon: "🧠" },
  quick_math:   { component: QuickMath,  name: "Quick Math",     icon: "🔢" },
  bubble_pop:   { component: BubblePop,  name: "Bubble Pop",     icon: "🫧" },
  whack:        { component: Whack,      name: "Whack-a-Mole",   icon: "🔨" },
  odd_one_out:  { component: OddOneOut,  name: "Odd One Out",    icon: "👀" },
  sequence_tap: { component: NumberRush, name: "Number Rush",    icon: "1️⃣" },
  catch_bug:    { component: CatchBug,   name: "Catch the Bug",  icon: "🐛" },
  memorize:     { component: Memorize,   name: "Memorize",       icon: "👁️" },
  hilo_sprint:  { component: HiLoSprint, name: "Higher / Lower", icon: "📊" },
};

// Pretty name/icon lookup helpers for share cards + result rows.
export function gameMeta(type) {
  return GAMES[type] || { name: type, icon: "🎲" };
}

// Unified runner — given a {type, seed} descriptor, renders the right
// component. Defensively renders a fallback if the type is unknown
// (means the client is on a stale bundle that doesn't have this
// game yet — happens during incremental rollouts).
import React from "react";
export function MiniGameRunner({ game, onComplete }) {
  if (!game || !game.type) return null;
  const entry = GAMES[game.type];
  if (!entry) {
    // Forward-compat: server picked a game type this bundle doesn't
    // know yet. Auto-submit a 0 score so the match doesn't deadlock,
    // surface a friendly note.
    React.useEffect(() => {
      const t = setTimeout(() => onComplete({ score: 0 }), 50);
      return () => clearTimeout(t);
    }, [onComplete]);
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, marginBottom: 6 }}>🎲 {game.type}</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
          New mini-game — reload to play it next round.
        </div>
      </div>
    );
  }
  const Component = entry.component;
  return <Component seed={game.seed} onComplete={onComplete} />;
}
