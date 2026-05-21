// Railgun — slow-charging high-impact rifle. 1-shot body kill, low
// ammo, full pierce. Has to charge for 600ms before each shot.
// Alt-fire: instant-snap shot at 60% damage (no charge needed),
// 1s cooldown — emergency self-defense.
import * as THREE from "three";
import { Weapon } from "./Weapon.js";

const CHARGE_MS = 600;

export class Railgun extends Weapon {
  constructor(scene, camera, arena, particles, controls) {
    super(scene, camera, arena, particles, controls);
    this.id = "railgun";
    this.name = "RAILGUN";
    this.icon = "⌁";
    this.maxAmmo = 6;
    this.damage = 110;
    this.fireRateMs = 1100;
    this.tracerColor = 0x22d3ee;
    this.altFireRateMs = 1000;
    this.altLabel = "SNAP SHOT";
    this.recoilPattern = [
      { pitch: 0.090, yaw: 0.000 },
      { pitch: 0.085, yaw: -0.005 },
    ];
    this._chargeStart = 0;
    this._charging = false;
    this._buildViewmodel();
  }

  // Override fire() to require holding the trigger long enough.
  fire(player, bots, onResolved, state) {
    const now = Date.now();
    if (state.reloading || state.ammo <= 0) return;
    if (!this._charging) {
      // Start charging.
      this._charging = true;
      this._chargeStart = now;
      this.barrelTip.material.color.setHex(0xffffff);
      return;
    }
    // Already charging — check if we've held long enough.
    if (now - this._chargeStart < CHARGE_MS) return;
    if (now - this._lastFire < this.fireRateMs) return;
    this._charging = false;
    this._lastFire = now;
    state.ammo -= 1;
    this._applyRecoil();
    this._hitscan(player, bots, onResolved, state, { pierce: true });
    this.barrelTip.material.color.setHex(0x22d3ee);
  }

  altFire(player, bots, onResolved, state) {
    const now = Date.now();
    if (now - this._lastAltFire < this.altFireRateMs) return;
    if (state.reloading || state.ammo <= 0) return;
    this._lastAltFire = now;
    state.ammo -= 1;
    this._charging = false;
    this._applyRecoil();
    this._hitscan(player, bots, onResolved, state, { damageMul: 0.6 });
  }

  update(dt) {
    super.update(dt);
    // Visual feedback during charge — barrel brightens as charge climbs.
    if (this._charging && this.barrelTip) {
      const t = Math.min(1, (Date.now() - this._chargeStart) / CHARGE_MS);
      const intensity = 0.3 + t * 0.7;
      this.barrelTip.scale.set(1, 1, 1 + t * 0.4);
      this.barrelTip.material.opacity = intensity;
    } else if (this.barrelTip) {
      this.barrelTip.scale.set(1, 1, 1);
    }
  }

  _buildViewmodel() {
    const grp = buildViewmodel({
      bodySize: [0.28, 0.22, 0.90],
      bodyColor: 0x114a6a,
      accentColor: 0x22d3ee,
      tipColor: 0x22d3ee,
      anchor: [0.0, -0.20, -0.62],
    });
    this._attachViewmodel(grp.group, grp.tip);
  }
}

import { buildViewmodel } from "./PlasmaRifle.js";
