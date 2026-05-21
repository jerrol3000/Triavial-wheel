// PlasmaRifle — the starter weapon. Balanced for general-purpose
// combat: medium damage, medium fire rate, tight recoil.
// Alt-fire: 3-round BURST that drains 3 ammo for a single click.
//
// Evolution (Mk-up every 3 kills, capped at 5):
//   Mk 1 — base
//   Mk 2 — fire rate ×1.4, recoil halved
//   Mk 3 — burst becomes 5-round + pierce
//   Mk 4 — homing slug aim-assist (12° cone)
//   Mk 5 — full pierce + 70ms fire rate
import * as THREE from "three";
import { Weapon } from "./Weapon.js";

export class PlasmaRifle extends Weapon {
  constructor(scene, camera, arena, particles, controls) {
    super(scene, camera, arena, particles, controls);
    this.id = "plasma";
    this.name = "PLASMA";
    this.icon = "✦";
    this.maxAmmo = 24;
    this.damage = 25;
    this.fireRateMs = 125;
    this.tracerColor = 0xa78bfa;
    this.altLabel = "3-RD BURST";
    this._burstCount = 3;
    this._homing = false;
    this._pierce = false;
    this._buildViewmodel();
  }

  evolve(level) {
    super.evolve(level);
    if (level === 2) { this.fireRateMs = 90; }
    if (level === 3) { this._pierce = true; this._burstCount = 5; }
    if (level === 4) { this._homing = true; }
    if (level >= 5)  { this._pierce = true; this.fireRateMs = 70; }
    if (this.barrelTip) {
      const c = level <= 1 ? 0xa78bfa : level === 2 ? 0x22d3ee : level === 3 ? 0xfbbf24 : level === 4 ? 0xf472b6 : 0xffffff;
      this.barrelTip.material.color.setHex(c);
    }
  }

  _doShot(player, bots, onResolved, state) {
    let dir = null;
    if (this._homing) {
      // Aim-assist: nudge dir toward nearest bot in a 12° cone.
      const origin = new THREE.Vector3();
      this.camera.getWorldPosition(origin);
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      let best = null, bestDot = Math.cos((12 * Math.PI) / 180);
      for (const b of bots) {
        if (b.dead) continue;
        const toBot = b.position.clone().sub(origin).normalize();
        const d = fwd.dot(toBot);
        if (d > bestDot) { bestDot = d; best = b; }
      }
      if (best) dir = best.position.clone().sub(origin).normalize();
    }
    this._hitscan(player, bots, onResolved, state, { directionOverride: dir, pierce: this._pierce });
  }

  altFire(player, bots, onResolved, state) {
    const now = Date.now();
    if (now - this._lastAltFire < this.altFireRateMs) return;
    if (state.reloading || state.ammo < this._burstCount) return;
    this._lastAltFire = now;
    // Fire N tightly-spaced shots — burst feel.
    for (let i = 0; i < this._burstCount; i++) {
      setTimeout(() => {
        if (state.ammo <= 0) return;
        state.ammo -= 1;
        this._applyRecoil();
        this._hitscan(player, bots, onResolved, state, { pierce: this._pierce });
      }, i * 60);
    }
  }

  _buildViewmodel() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x101a3a }),
    );
    body.position.set(0.3, -0.3, -0.55);
    grp.add(body);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.05, 0.1, 8),
      new THREE.MeshBasicMaterial({ color: 0xa78bfa }),
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.set(0.3, -0.3, -0.92);
    grp.add(tip);
    this._attachViewmodel(grp, tip);
  }
}
