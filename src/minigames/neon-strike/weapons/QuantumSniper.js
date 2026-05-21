// QuantumSniper — long-range single-shot with FOV-zoom scope (alt-fire).
// Charged shot bypasses Energy-Shifted bots — the only weapon that
// can hit a phased target. Hipfire = standard hit-scan.
// Alt-fire: TOGGLE SCOPE (zooms camera FOV to 28° → 78° normal).
//   While scoped, primary fire CHARGES (0.7s) for a dimension-pierce
//   slug that hits through walls AND through phase-shifted targets.
import * as THREE from "three";
import { Weapon } from "./Weapon.js";

const SCOPE_FOV = 28;
const CHARGE_MS = 700;
const PIERCE_RANGE = 200;

export class QuantumSniper extends Weapon {
  constructor(scene, camera, arena, particles, controls) {
    super(scene, camera, arena, particles, controls);
    this.id = "sniper";
    this.name = "Q-SNIPER";
    this.icon = "◊";
    this.maxAmmo = 4;
    this.damage = 75;
    this.fireRateMs = 1300;
    this.reloadMs = 1500;
    this.tracerColor = 0xc084fc;
    this.altLabel = "SCOPE";
    this.altFireRateMs = 250; // toggle cooldown
    this.recoilPattern = [
      { pitch: 0.110, yaw: 0.000 },
    ];
    this._scoped = false;
    this._normalFov = 78;
    this._charging = false;
    this._chargeStart = 0;
    this._buildViewmodel();
  }

  fire(player, bots, onResolved, state) {
    const now = Date.now();
    if (state.reloading || state.ammo <= 0) return;

    if (this._scoped) {
      // Scoped mode: must charge.
      if (!this._charging) {
        this._charging = true;
        this._chargeStart = now;
        return;
      }
      if (now - this._chargeStart < CHARGE_MS) return;
      if (now - this._lastFire < this.fireRateMs) return;
      this._charging = false;
      this._lastFire = now;
      state.ammo -= 1;
      this._applyRecoil();
      // Dimension-pierce: hit through walls AND ignore bot shifting.
      // Implemented as a long-range raycast that skips arena raycast
      // and applies damage to ALL bots whose body axis is within a
      // very tight 1° cone.
      this._dimensionPierce(bots, onResolved);
      return;
    }

    // Hipfire: standard single shot.
    if (now - this._lastFire < this.fireRateMs) return;
    this._lastFire = now;
    state.ammo -= 1;
    this._applyRecoil();
    this._hitscan(player, bots, onResolved, state, {});
  }

  altFire(player, bots, onResolved, state) {
    const now = Date.now();
    if (now - this._lastAltFire < this.altFireRateMs) return;
    this._lastAltFire = now;
    this._scoped = !this._scoped;
    if (this._scoped) {
      this._normalFov = this.camera.fov;
      this.camera.fov = SCOPE_FOV;
    } else {
      this.camera.fov = this._normalFov;
      this._charging = false;
    }
    this.camera.updateProjectionMatrix();
  }

  _dimensionPierce(bots, onResolved) {
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const conethreshold = Math.cos((1 * Math.PI) / 180);
    const end = origin.clone().add(dir.clone().multiplyScalar(PIERCE_RANGE));
    this._spawnTracer(origin, end, 0xffffff);
    for (const b of bots) {
      if (b.dead) continue;
      const toBot = b.position.clone().sub(origin);
      const dist = toBot.length();
      if (dist > PIERCE_RANGE) continue;
      const dot = dir.dot(toBot.normalize());
      if (dot > conethreshold) {
        // Body-shot only on dimension pierce (no headshot multiplier).
        onResolved({
          hit: true,
          target: { type: "bot", bot: b },
          headshot: false,
          point: b.position.clone(),
          damageOverride: this.damage * 1.6,
          headshotMul: 1.0,
        });
      }
    }
  }

  update(dt) {
    super.update(dt);
    // Scope-charge visual: bright pulse on the scope as charge climbs.
    if (this._scoped && this._charging && this.barrelTip) {
      const t = Math.min(1, (Date.now() - this._chargeStart) / CHARGE_MS);
      this.barrelTip.material.color.setHex(t > 0.95 ? 0xffffff : 0xc084fc);
      this.barrelTip.scale.set(1 + t * 0.4, 1 + t * 0.4, 1);
    }
  }

  _buildViewmodel() {
    const grp = buildViewmodel({
      bodySize: [0.16, 0.18, 1.05],
      bodyColor: 0x2a0e4a,
      accentColor: 0xc084fc,
      tipColor: 0xc084fc,
      anchor: [0.34, -0.32, -0.80],
    });
    // Add a scope on top — distinguishing silhouette.
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.26, 12),
      new THREE.MeshBasicMaterial({ color: 0x14081f }),
    );
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0.34, -0.17, -0.68);
    grp.group.add(scope);
    const scopeRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.07, 0.012, 6, 14),
      new THREE.MeshBasicMaterial({ color: 0xc084fc }),
    );
    scopeRing.position.set(0.34, -0.17, -0.55);
    grp.group.add(scopeRing);
    this._attachViewmodel(grp.group, grp.tip);
  }
}

import { buildViewmodel } from "./PlasmaRifle.js";
