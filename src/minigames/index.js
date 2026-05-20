// Central registry of mini-game components by type. Adding a new
// game = drop a file in this folder + register it here. The runner
// below + the rest of the app stay generic.
import TapRace from "./TapRace";
import Reaction from "./Reaction";
import ColorMatch from "./ColorMatch";
import Memory from "./Memory";
import QuickMath from "./QuickMath";

export const GAMES = {
  tap_race:    { component: TapRace,    name: "Tap Race",    icon: "👆" },
  reaction:    { component: Reaction,   name: "Reaction",    icon: "⚡" },
  color_match: { component: ColorMatch, name: "Color Match", icon: "🎨" },
  memory:      { component: Memory,     name: "Memory",      icon: "🧠" },
  quick_math:  { component: QuickMath,  name: "Quick Math",  icon: "🔢" },
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
