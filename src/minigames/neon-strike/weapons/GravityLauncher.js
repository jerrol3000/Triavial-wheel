// GravityLauncher — projectile that pulls all bots within 6m of its
// impact toward the impact point. Low direct damage, but creates a
// CC moment for the player to follow up with another weapon.
// Alt-fire: REPULSE — pushes bots AWAY from the impact instead.
//
// Projectile model: a slow-moving sphere mesh that travels in a
// straight line (no gravity drop for simplicity), collides on AABB
// test each frame against bots + arena. On impact: explosion
// particles + AOE pull/push + small splash damage.
import * as THREE from "three";
import { Weapon } from "./Weapon.js";
import { buildViewmodel } from "./PlasmaRifle.js";

const PROJECTILE_SPEED = 28;
const PROJECTILE_LIFE = 1.4; // seconds
const AOE_RADIUS = 6;
const AOE_PULL_STRENGTH = 22;
const AOE_PUSH_STRENGTH = 28;
const SPLASH_DAMAGE = 18;

export class GravityLauncher extends Weapon {
  constructor(scene, camera, arena, particles, controls) {
    super(scene, camera, arena, particles, controls);
    this.id = "gravity";
    this.name = "G-LAUNCH";
    this.icon = "◯";
    this.maxAmmo = 5;
    this.damage = SPLASH_DAMAGE;
    this.fireRateMs = 850;
    this.reloadMs = 1300;
    this.tracerColor = 0x60a5fa;
    this.altLabel = "REPULSE";
    this.altFireRateMs = 850;
    this.recoilPattern = [
      { pitch: 0.060, yaw: 0.000 },
      { pitch: 0.055, yaw: 0.005 },
    ];
    this._projectiles = []; // [{mesh, dir, born, pull}]
    this._buildViewmodel();
  }

  _doShot(player, bots, onResolved, state) { this._launch(player, bots, onResolved, "pull"); }
  altFire(player, bots, onResolved, state) {
    const now = Date.now();
    if (now - this._lastAltFire < this.altFireRateMs) return;
    if (state.reloading || state.ammo <= 0) return;
    this._lastAltFire = now;
    state.ammo -= 1;
    this._applyRecoil();
    this._launch(player, bots, onResolved, "push");
  }

  _launch(player, bots, onResolved, mode) {
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    // Spawn projectile mesh.
    const geom = new THREE.SphereGeometry(0.22, 12, 12);
    const color = mode === "pull" ? 0x60a5fa : 0xf472b6;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(origin);
    // Add glow ring around it.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.42, 16),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }),
    );
    mesh.add(ring);
    this.scene.add(mesh);
    this._projectiles.push({
      mesh, dir: dir.clone(), born: performance.now(), mode, ring,
    });
  }

  // Engine calls this every frame via update(). We override to also
  // advance projectiles.
  update(dt) {
    super.update(dt);
    const now = performance.now();
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const p = this._projectiles[i];
      const age = (now - p.born) / 1000;
      // Move
      p.mesh.position.addScaledVector(p.dir, PROJECTILE_SPEED * dt);
      p.ring.rotation.y += dt * 3;
      // Check collision with arena (simple AABB containment test).
      const hitWall = this.arena.collidesAt(p.mesh.position, 0.25, false);
      if (hitWall || age > PROJECTILE_LIFE) {
        this._detonate(p);
        this.scene.remove(p.mesh);
        try { p.mesh.geometry.dispose(); p.mesh.material.dispose(); } catch (e) {}
        this._projectiles.splice(i, 1);
      }
    }
  }

  _detonate(p) {
    const center = p.mesh.position.clone();
    const color = p.mode === "pull" ? 0x60a5fa : 0xf472b6;
    this.particles.burst(center, color, 24);
    // AOE: scan engine's bot list — we can't access bots from here
    // unless we cache them, so we'll dispatch via a custom event the
    // Engine listens to.
    if (this._engineBots) {
      for (const bot of this._engineBots) {
        if (bot.dead) continue;
        const d = bot.position.distanceTo(center);
        if (d <= AOE_RADIUS) {
          const dir = bot.position.clone().sub(center); dir.y = 0;
          if (dir.lengthSq() < 0.001) dir.set(1, 0, 0);
          dir.normalize();
          const strength = p.mode === "pull" ? -AOE_PULL_STRENGTH : AOE_PUSH_STRENGTH;
          // Apply teleport-style displacement scaled by 1-d/radius.
          const factor = (1 - d / AOE_RADIUS) * 0.04 * strength;
          const next = bot.position.clone().addScaledVector(dir, factor);
          if (!this.arena.collidesAt(next, 0.5, false)) {
            bot.position.copy(next);
            bot.mesh.position.copy(next);
          }
          // Splash damage.
          bot.applyDamage(SPLASH_DAMAGE * (1 - d / AOE_RADIUS) * 0.7);
        }
      }
    }
  }

  setBots(bots) { this._engineBots = bots; }

  _buildViewmodel() {
    const grp = buildViewmodel({
      bodySize: [0.32, 0.26, 0.60],
      bodyColor: 0x123a78,
      accentColor: 0x60a5fa,
      tipColor: 0x60a5fa,
      anchor: [0.0, -0.20, -0.58],
    });
    this._attachViewmodel(grp.group, grp.tip);
  }

  destroy() {
    super.destroy();
    for (const p of this._projectiles) {
      try { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); } catch (e) {}
    }
    this._projectiles = [];
  }
}
