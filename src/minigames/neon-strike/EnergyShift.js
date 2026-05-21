// EnergyShift — the dimensional-phase mechanic that defines NSA.
//
// On activation (Q key):
//   • Player becomes IMMUNE to bot bullets (state.shifting = true).
//     The engine's damagePlayer() bails early when shifting.
//   • Phase walls (arena meshes tagged userData.phasable) fade to
//     low opacity AND their colliders go inert — the player can
//     walk through.
//   • All non-phase walls develop a subtle cyan rim shimmer (we
//     can't change them without per-frame uniform writes, so we
//     just tint the scene background slightly instead).
//   • Drain rate: 35 energy/sec while active. Auto-exits when
//     energy hits 0. Costs an upfront 25 to activate.
//   • Cooldown: 1.5 seconds between shifts.
//
// Strategic use: phase to escape a firefight, ghost through walls
// to flank, evade a sniper line-of-sight. The 35/sec drain forces
// commitment — you can't shift permanently.

import * as THREE from "three";

const DRAIN_PER_SEC = 35;
const ACTIVATION_COST = 25;
const COOLDOWN_MS = 1500;

export class EnergyShift {
  constructor(player, arena, scene) {
    this.player = player;
    this.arena = arena;
    this.scene = scene;
    this.active = false;
    this.lastEndedAt = 0;
    this.phaseMeshes = arena.phaseMeshes();
    // P1-8: drive ShaderMaterial uniform uShifted (0 ↔ 1) with a smooth
    // ease. We no longer touch opacity directly — the shader handles
    // both opaque and translucent states.
    this._uShiftedTarget = 0;
    this._uShiftedValue = 0;
    // Override Arena.collidesAt to honor shifting state when called
    // from PlayerController. We patch by binding a property the
    // controller can read — simplest hook.
    this._origCollidesAt = arena.collidesAt.bind(arena);
    arena.collidesAt = (pos, radius, shiftedArg) => {
      // PlayerController passes shifted=false (didn't have access),
      // but we know via this.active.
      return this._origCollidesAt(pos, radius, this.active);
    };
    // Visual: a colored overlay that tints the scene background
    // when shifted. We toggle scene.fog density too.
    this._normalFogDensity = scene.fog ? scene.fog.density : 0.022;
  }

  toggle(state) {
    if (this.active) {
      this._end(state);
      return;
    }
    if (Date.now() - this.lastEndedAt < COOLDOWN_MS) return;
    if (state.energy < ACTIVATION_COST) return;
    state.energy -= ACTIVATION_COST;
    this.active = true;
    state.shifting = true;
    this._uShiftedTarget = 1;
    // Shift the scene fog to a cyan tint.
    if (this.scene.fog) {
      this.scene.fog.color.set(0x06143a);
      this.scene.fog.density = 0.035;
    }
    this.scene.background = new THREE.Color(0x0a1a3a);
  }

  _end(state) {
    this.active = false;
    state.shifting = false;
    this.lastEndedAt = Date.now();
    this._uShiftedTarget = 0;
    if (this.scene.fog) {
      this.scene.fog.color.set(0x05060e);
      this.scene.fog.density = this._normalFogDensity;
    }
    this.scene.background = new THREE.Color(0x05060e);
  }

  update(dt, state) {
    if (this.active) {
      state.energy = Math.max(0, state.energy - DRAIN_PER_SEC * dt);
      if (state.energy <= 0) this._end(state);
    }
    // P1-8: ease the uShifted uniform toward target each frame for
    // a smooth visual transition rather than a hard pop.
    const ease = Math.min(1, 6 * dt);
    this._uShiftedValue += (this._uShiftedTarget - this._uShiftedValue) * ease;
    if (this.arena.phaseMaterials) {
      for (const m of this.arena.phaseMaterials) {
        if (m.uniforms?.uShifted) m.uniforms.uShifted.value = this._uShiftedValue;
      }
    }
  }
}
