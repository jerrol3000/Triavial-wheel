// SmartPistol — fast-fire sidearm with built-in soft aim-assist
// (4° cone). Lower damage, but the snap-to means missed shots are
// rare. Always present in the loadout — your fallback when other
// weapons reload.
// Alt-fire: locked tracking burst — fires 3 rapid rounds at the
// SAME target if a bot is locked.
import * as THREE from "three";
import { Weapon } from "./Weapon.js";
import { buildViewmodel } from "./viewmodelBuilder.js";

const LOCK_CONE_DEG = 4;

export class SmartPistol extends Weapon {
  constructor(scene, camera, arena, particles, controls) {
    super(scene, camera, arena, particles, controls);
    this.id = "pistol";
    this.name = "SIDEKICK";
    this.icon = "▾";
    this.maxAmmo = 16;
    this.damage = 14;
    this.fireRateMs = 145;
    this.tracerColor = 0xfbbf24;
    this.altLabel = "LOCK BURST";
    this.altFireRateMs = 700;
    this.recoilPattern = [
      { pitch: 0.022, yaw: 0.004 },
      { pitch: 0.018, yaw: -0.005 },
      { pitch: 0.016, yaw: 0.006 },
      { pitch: 0.014, yaw: -0.003 },
    ];
    this._buildViewmodel();
  }

  _doShot(player, bots, onResolved, state) {
    // Aim-assist: nudge dir toward nearest bot within LOCK_CONE_DEG.
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    let best = null, bestDot = Math.cos((LOCK_CONE_DEG * Math.PI) / 180);
    for (const b of bots) {
      if (b.dead) continue;
      const toBot = b.position.clone().sub(origin).normalize();
      const d = fwd.dot(toBot);
      if (d > bestDot) { bestDot = d; best = b; }
    }
    const dir = best ? best.position.clone().sub(origin).normalize() : null;
    this._hitscan(player, bots, onResolved, state, { directionOverride: dir });
  }

  altFire(player, bots, onResolved, state) {
    const now = Date.now();
    if (now - this._lastAltFire < this.altFireRateMs) return;
    if (state.reloading || state.ammo < 3) return;
    this._lastAltFire = now;
    // Find a lock target.
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    let best = null, bestDot = Math.cos((LOCK_CONE_DEG * 2 * Math.PI) / 180);
    for (const b of bots) {
      if (b.dead) continue;
      const toBot = b.position.clone().sub(origin).normalize();
      const d = fwd.dot(toBot);
      if (d > bestDot) { bestDot = d; best = b; }
    }
    // Fire 3 shots at the locked target.
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (state.ammo <= 0) return;
        state.ammo -= 1;
        this._applyRecoil();
        const dir = best && !best.dead ? best.position.clone().sub(origin).normalize() : null;
        this._hitscan(player, bots, onResolved, state, { directionOverride: dir });
      }, i * 90);
    }
  }

  _buildViewmodel() {
    const grp = buildViewmodel({
      bodySize: [0.12, 0.13, 0.28],
      bodyColor: 0x5a3a0a,
      accentColor: 0xfbbf24,
      tipColor: 0xfbbf24,
      anchor: [0.0, -0.28, -0.80],
    });
    this._attachViewmodel(grp.group, grp.tip);
  }
}

