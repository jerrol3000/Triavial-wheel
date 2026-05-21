// BossBot — encounter at the end of Wave 5 (and every 5 waves after).
// Larger, tougher than a standard Bot, with:
//   • 6× regular health (360 HP vs 60)
//   • Phase-cycling SHIELD that absorbs 50% damage while up
//   • AOE pulse attack every 4s — explodes radially from its
//     position, dealing damage to the player if they're within 5m
//   • Slow but inexorable movement toward the player; does not
//     retreat into cover
//   • Visual: 2× scale, red core that shifts to white when shield
//     is up, expanding shockwave ring on AOE attack
//
// Bot extends the standard Bot class (same hit/raycast contract) so
// the weapon system and existing AI bot helpers work without
// modification.

import * as THREE from "three";
import { Bot } from "./Bot.js";

const SHIELD_CYCLE_MS = 6000;
const SHIELD_UP_MS = 2000;
const AOE_INTERVAL_MS = 4000;
const AOE_RADIUS = 5;
const AOE_DAMAGE = 28;
const AOE_TELEGRAPH_MS = 700;

export class BossBot extends Bot {
  constructor(scene, arena, opts = {}) {
    super(scene, arena, "AGGRO", { ...opts, color: 0xef4444 });
    this.name = "OVERLORD";
    this.personalityName = "BOSS";
    this.maxHealth = 360;
    this.health = this.maxHealth;
    // Make the boss bigger.
    this.mesh.scale.set(2, 2, 2);
    // Boss never retreats — override personality params.
    this.p = { ...this.p, engageDistance: 28, fireRateMs: 900, burst: 3, damage: 22, moveSpeed: 3.2, sidestepProb: 0.1, coverProb: 0 };
    this._shieldUp = false;
    this._shieldStateAt = Date.now();
    this._lastAoeAt = 0;
    this._aoeWarningStarted = 0;
    this._buildShieldVisual();
  }

  _buildShieldVisual() {
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee, transparent: true, opacity: 0.0, side: THREE.DoubleSide,
        wireframe: true,
      }),
    );
    shield.position.y = 1.0;
    this.mesh.add(shield);
    this._shieldMesh = shield;
    // AOE ring (radial telegraph + impact).
    const aoeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.6, 36),
      new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0 }),
    );
    aoeRing.rotation.x = -Math.PI / 2;
    aoeRing.position.y = 0.04;
    this.mesh.add(aoeRing);
    this._aoeRing = aoeRing;
  }

  applyDamage(dmg) {
    // Halved damage while shield is up.
    super.applyDamage(this._shieldUp ? dmg * 0.5 : dmg);
  }

  update(dt, playerPos, damagePlayer, playerState, particles) {
    super.update(dt, playerPos, damagePlayer, playerState, particles);
    if (this.dead) return;
    const now = Date.now();

    // Shield cycle: ~4s down, 2s up, repeat.
    if (now - this._shieldStateAt > (this._shieldUp ? SHIELD_UP_MS : SHIELD_CYCLE_MS - SHIELD_UP_MS)) {
      this._shieldUp = !this._shieldUp;
      this._shieldStateAt = now;
    }
    this._shieldMesh.material.opacity = this._shieldUp
      ? 0.4 + Math.sin(now * 0.01) * 0.15
      : Math.max(0, this._shieldMesh.material.opacity - dt * 2);

    // AOE attack on cadence.
    const sinceAoe = now - this._lastAoeAt;
    if (sinceAoe > AOE_INTERVAL_MS && this._aoeWarningStarted === 0) {
      this._aoeWarningStarted = now;
    }
    if (this._aoeWarningStarted > 0) {
      const t = (now - this._aoeWarningStarted) / AOE_TELEGRAPH_MS;
      this._aoeRing.material.opacity = Math.min(0.85, t * 0.85);
      this._aoeRing.scale.set(1 + t * 4, 1 + t * 4, 1);
      if (t >= 1) {
        // Detonate.
        this._lastAoeAt = now;
        this._aoeWarningStarted = 0;
        // Reset ring for next time.
        this._aoeRing.material.opacity = 0;
        this._aoeRing.scale.set(1, 1, 1);
        // Damage check: distance from boss to player.
        const dist = this.position.distanceTo(playerPos);
        if (dist <= AOE_RADIUS) damagePlayer(AOE_DAMAGE);
        // Particle shockwave at boss position.
        if (particles) {
          particles.burst(this.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xef4444, 30);
        }
      }
    }
  }

  destroy() {
    // Standard Bot doesn't destroy explicitly; the scene cleanup
    // handles it.
  }
}
