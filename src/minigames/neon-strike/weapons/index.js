// Weapon registry. Adding a new weapon = drop a class file in this
// folder + register here. Engine reads from WEAPONS and instantiates
// by id; Loadout swap = destroy current + new(...).
import { PlasmaRifle } from "./PlasmaRifle.js";
import { Railgun } from "./Railgun.js";
import { EnergyShotgun } from "./EnergyShotgun.js";
import { SmartPistol } from "./SmartPistol.js";
import { GravityLauncher } from "./GravityLauncher.js";
import { PulseSMG } from "./PulseSMG.js";
import { QuantumSniper } from "./QuantumSniper.js";

export const WEAPONS = {
  plasma:   { id: "plasma",   class: PlasmaRifle,     name: "PLASMA",    icon: "✦", slot: 1 },
  smg:      { id: "smg",      class: PulseSMG,        name: "PULSE-SMG", icon: "≡", slot: 2 },
  shotgun:  { id: "shotgun",  class: EnergyShotgun,   name: "PULSE-12",  icon: "⌒", slot: 3 },
  sniper:   { id: "sniper",   class: QuantumSniper,   name: "Q-SNIPER",  icon: "◊", slot: 4 },
  railgun:  { id: "railgun",  class: Railgun,         name: "RAILGUN",   icon: "⌁", slot: 5 },
  gravity:  { id: "gravity",  class: GravityLauncher, name: "G-LAUNCH",  icon: "◯", slot: 6 },
  pistol:   { id: "pistol",   class: SmartPistol,     name: "SIDEKICK",  icon: "▾", slot: 7 },
};

// Stable order keyed by slot — used by the HUD's loadout row + the
// number-key binding (1 = first entry, etc.).
export const WEAPON_ORDER = Object.values(WEAPONS).sort((a, b) => a.slot - b.slot);

export function buildWeapon(id, scene, camera, arena, particles, controls) {
  const entry = WEAPONS[id] || WEAPONS.plasma;
  return new entry.class(scene, camera, arena, particles, controls);
}
