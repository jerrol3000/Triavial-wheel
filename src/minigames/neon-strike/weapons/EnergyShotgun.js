// EnergyShotgun — close-range cone of 7 pellets per shot. Devastating
// in CQC, useless past 12 meters. Slow fire rate.
// Alt-fire: tight slug (all pellets converge into one high-damage line).
import * as THREE from "three";
import { Weapon } from "./Weapon.js";

const PELLET_COUNT = 7;
const SPREAD_DEG = 7;
const FALLOFF_START = 8;
const FALLOFF_END = 18;

export class EnergyShotgun extends Weapon {
  constructor(scene, camera, arena, particles, controls) {
    super(scene, camera, arena, particles, controls);
    this.id = "shotgun";
    this.name = "PULSE-12";
    this.icon = "⌒";
    this.maxAmmo = 8;
    this.damage = 14; // per pellet — 7 pellets = 98 max at point blank
    this.fireRateMs = 720;
    this.reloadMs = 1400;
    this.tracerColor = 0xf472b6;
    this.altFireRateMs = 900;
    this.altLabel = "SLUG";
    this.recoilPattern = [
      { pitch: 0.075, yaw: 0.020 },
      { pitch: 0.065, yaw: -0.022 },
    ];
    this._buildViewmodel();
  }

  _doShot(player, bots, onResolved, state) {
    // Spawn N pellets in a small cone. Each pellet does damage with
    // distance falloff: full damage within 8m, linear to 0 by 18m.
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const localUp = new THREE.Vector3().crossVectors(right, fwd).normalize();

    for (let i = 0; i < PELLET_COUNT; i++) {
      // Pseudorandom direction within the cone.
      const angle = (Math.random() * 2 - 1) * (SPREAD_DEG * Math.PI / 180);
      const dist = Math.random() * (SPREAD_DEG * Math.PI / 180);
      const dir = fwd.clone()
        .addScaledVector(right, Math.sin(angle) * dist)
        .addScaledVector(localUp, Math.cos(angle) * dist)
        .normalize();
      this._raycaster.set(origin, dir);
      this._raycaster.far = 30;
      // Closest bot first.
      let closestBotDist = Infinity, closestBotHit = null;
      for (const b of bots) {
        if (b.dead) continue;
        const h = b.raycastHit(this._raycaster);
        if (h && h.distance < closestBotDist) { closestBotDist = h.distance; closestBotHit = { ...h, bot: b }; }
      }
      const wallHits = this._raycaster.intersectObjects(this.arena.raycastTargets(), false);
      const wallDist = wallHits[0] ? wallHits[0].distance : Infinity;
      const tracerEnd = origin.clone().add(dir.clone().multiplyScalar(Math.min(30, Math.min(closestBotDist, wallDist))));
      this._spawnTracer(origin, tracerEnd, this.tracerColor);
      if (closestBotHit && closestBotDist <= wallDist) {
        // Damage falloff.
        const t = closestBotDist <= FALLOFF_START ? 1
                : closestBotDist >= FALLOFF_END ? 0
                : 1 - (closestBotDist - FALLOFF_START) / (FALLOFF_END - FALLOFF_START);
        onResolved({
          hit: true,
          target: { type: "bot", bot: closestBotHit.bot },
          headshot: closestBotHit.headshot,
          point: closestBotHit.point,
          damageOverride: this.damage * t,
          headshotMul: 1.6, // tighter headshot mul on shotgun
        });
      } else if (wallHits[0]) {
        this.particles.burst(wallHits[0].point, this.tracerColor, 2);
      }
    }
  }

  altFire(player, bots, onResolved, state) {
    const now = Date.now();
    if (now - this._lastAltFire < this.altFireRateMs) return;
    if (state.reloading || state.ammo <= 0) return;
    this._lastAltFire = now;
    state.ammo -= 1;
    this._applyRecoil();
    // Slug = one high-damage hit-scan.
    this._hitscan(player, bots, onResolved, state, { damageMul: 4.5 });
  }

  _buildViewmodel() {
    const grp = buildViewmodel({
      bodySize: [0.28, 0.24, 0.68],
      bodyColor: 0x6a1a4a,
      accentColor: 0xf472b6,
      tipColor: 0xf472b6,
      anchor: [0.16, -0.22, -0.48],
    });
    this._attachViewmodel(grp.group, grp.tip);
  }
}

import { buildViewmodel } from "./PlasmaRifle.js";
