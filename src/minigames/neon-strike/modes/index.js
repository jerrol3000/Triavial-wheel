import { ArenaMode } from "./ArenaMode.js";
import { AimMode } from "./AimMode.js";
import { WaveMode } from "./WaveMode.js";

export const MODES = {
  arena: { id: "arena", name: "ARENA",   tagline: "90s deathmatch vs AI bots",         class: ArenaMode },
  aim:   { id: "aim",   name: "AIM",     tagline: "60s aim training — static + slider", class: AimMode },
  wave:  { id: "wave",  name: "SURVIVE", tagline: "Escalating waves. Boss every 5th.",  class: WaveMode },
};

export function buildMode(id, engine, opts) {
  const entry = MODES[id] || MODES.arena;
  return new entry.class(engine, opts);
}
