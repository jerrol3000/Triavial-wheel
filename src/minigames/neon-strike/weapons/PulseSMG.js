// PulseSMG — full-auto bullet-hose. Fastest fire rate in the game,
// lowest damage per shot, large magazine. Bullet spread INCREASES
// as you hold the trigger (visible viewmodel wobble + recoil pattern
// that spirals out).
// Alt-fire: ACCURACY MODE — half the fire rate but ZERO spread for
// long-range bursts.
import * as THREE from "three";
import { Weapon } from "./Weapon.js";

export class PulseSMG extends Weapon {
  constructor(scene, camera, arena, particles, controls) {
    super(scene, camera, arena, particles, controls);
    this.id = "smg";
    this.name = "PULSE-SMG";
    this.icon = "≡";
    this.maxAmmo = 45;
    this.damage = 9;
    this.fireRateMs = 60; // ~16 RPS
    this.reloadMs = 1200;
    this.tracerColor = 0x34d399;
    this.altLabel = "FOCUS";
    this.altFireRateMs = 120;
    // Spiraling recoil — visible "spray pattern" feel.
    this.recoilPattern = [
      { pitch: 0.020, yaw: 0.000 },
      { pitch: 0.022, yaw: 0.008 },
      { pitch: 0.020, yaw: 0.012 },
      { pitch: 0.018, yaw: 0.008 },
      { pitch: 0.018, yaw: -0.004 },
      { pitch: 0.020, yaw: -0.014 },
      { pitch: 0.020, yaw: -0.018 },
      { pitch: 0.022, yaw: -0.010 },
      { pitch: 0.020, yaw: 0.006 },
    ];
    this._spread = 0; // builds with consecutive shots
    this._focusMode = false;
    this._buildViewmodel();
  }

  _doShot(player, bots, onResolved, state) {
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);

    // Spread grows up to 4° with sustained fire — encourages
    // controlled bursts.
    const spreadRad = this._focusMode ? 0 : Math.min(4 * Math.PI / 180, this._spread);
    this._spread += this._focusMode ? -0.002 : 0.0015;
    this._spread = Math.max(0, this._spread);

    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * spreadRad;
    const dir = fwd.clone()
      .addScaledVector(right, Math.sin(angle) * r)
      .addScaledVector(up, Math.cos(angle) * r)
      .normalize();

    this._hitscan(player, bots, onResolved, state, { directionOverride: dir });
  }

  altFire(player, bots, onResolved, state) {
    // Toggle focus mode — slower fire rate, but ZERO spread.
    this._focusMode = !this._focusMode;
    if (this.barrelTip) this.barrelTip.material.color.setHex(this._focusMode ? 0xffffff : 0x34d399);
  }

  fire(player, bots, onResolved, state) {
    const now = Date.now();
    const rate = this._focusMode ? this.altFireRateMs : this.fireRateMs;
    if (now - this._lastFire < rate) return;
    if (state.reloading || state.ammo <= 0) return;
    this._lastFire = now;
    state.ammo -= 1;
    this._applyRecoil();
    this._doShot(player, bots, onResolved, state);
  }

  update(dt) {
    super.update(dt);
    // Spread decays when not firing.
    if (Date.now() - this._lastFire > 200) {
      this._spread = Math.max(0, this._spread - dt * 0.6);
    }
  }

  _buildViewmodel() {
    const grp = buildViewmodel({
      bodySize: [0.14, 0.12, 0.36],
      bodyColor: 0x115a3a,
      accentColor: 0x34d399,
      tipColor: 0x34d399,
      anchor: [0.0, -0.28, -0.85],
    });
    // Compact magazine bulge below — SMG silhouette.
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.13, 0.10),
      new THREE.MeshBasicMaterial({ color: 0x0c3a26 }),
    );
    mag.position.set(0.0, -0.40, -0.83);
    grp.group.add(mag);
    this._attachViewmodel(grp.group, grp.tip);
  }
}

import { buildViewmodel } from "./PlasmaRifle.js";
