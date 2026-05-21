// Arena game registry — slimmed to 3 after the Neon Strike pivot.
//
//   ✦ Anomaly       — Pixi/WebGL energy-field containment + plasma shader
//   ◇ Cascade       — Matter.js physics orb catcher + MEGA + chain orbs
//   ◈ Neon Strike   — full 3D first-person shooter (90-sec vs AI bots)
//
// The 9 retired mini-games (Surge / Trigger / Spectrum / Recall /
// Vector / Intercept / Outlier / Sequence / Cipher / Tide) have been
// removed from the registry. Their source files remain in this
// folder for future reactivation but are no longer reachable.

import BubblePop from "./BubblePop";
import CatchBug from "./CatchBug";
import NeonStrikeArena from "./neon-strike/NeonStrikeArena";

export const GAMES = {
  catch_bug:   { component: CatchBug,         name: "Anomaly",     icon: "✦" },
  bubble_pop:  { component: BubblePop,        name: "Cascade",     icon: "◇" },
  neon_strike: { component: NeonStrikeArena,  name: "Neon Strike", icon: "◈" },
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
    // know yet. Auto-submit a 0 score so the match doesn't deadlock.
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
