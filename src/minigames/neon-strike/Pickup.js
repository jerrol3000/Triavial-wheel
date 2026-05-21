// Pickup — floating weapon pickup orb spawned on the arena floor.
//
// Each pickup is a visible mesh (capsule + glow ring) hovering at
// 1.2m above the floor, bobbing gently. The player walks over it
// (1.8m radius) to swap their current weapon.
//
// Spawn flow:
//   • PickupManager spawns N pickups at random arena spawn points
//     on match start.
//   • When a pickup is collected, it respawns after 15s at a
//     different random spawn point.
//   • Each pickup is one weapon (random from the WEAPONS registry
//     excluding the starter PlasmaRifle, which the player always
//     starts with).
//
// Visual: a colored bobbing capsule with a slow Y-rotation, plus a
// glowing pillar of light beneath that pulses.

import * as THREE from "three";
import { WEAPONS, WEAPON_ORDER } from "./weapons/index.js";

const PICKUP_HEIGHT = 1.3;
const PICKUP_RADIUS = 1.8;
const RESPAWN_MS = 15000;
const PICKUP_COUNT = 5;
// Weapons that can spawn as pickups (excludes the starter).
const PICKUP_POOL = ["smg", "shotgun", "sniper", "railgun", "gravity", "pistol"];

export class PickupManager {
  constructor(scene, arena) {
    this.scene = scene;
    this.arena = arena;
    this.pickups = []; // {weaponId, mesh, ring, position, collected, respawnAt}
    this._spawn();
  }

  _spawn() {
    const points = [...this.arena.spawnPoints];
    // Add a few additional scattered points for variety.
    const extra = [
      new THREE.Vector3(-10, 0, 8),
      new THREE.Vector3(10, 0, -4),
      new THREE.Vector3(0, 0, 22),
      new THREE.Vector3(-22, 0, -8),
      new THREE.Vector3(22, 0, -8),
    ];
    points.push(...extra);
    // Shuffle.
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [points[i], points[j]] = [points[j], points[i]];
    }
    for (let i = 0; i < Math.min(PICKUP_COUNT, points.length); i++) {
      const weaponId = PICKUP_POOL[Math.floor(Math.random() * PICKUP_POOL.length)];
      this._make(weaponId, points[i].clone());
    }
  }

  _make(weaponId, position) {
    const entry = WEAPONS[weaponId];
    if (!entry) return null;
    const color = this._colorFor(weaponId);
    const grp = new THREE.Group();

    // Bobbing capsule body
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.25, 0.4, 4, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }),
    );
    body.position.y = PICKUP_HEIGHT;
    grp.add(body);

    // Outline / wireframe overlay
    const wire = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.45, 3, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.3 }),
    );
    wire.position.y = PICKUP_HEIGHT;
    grp.add(wire);

    // Glow pillar — vertical thin cylinder from floor to body
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, PICKUP_HEIGHT, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 }),
    );
    pillar.position.y = PICKUP_HEIGHT / 2;
    grp.add(pillar);

    // Floor ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.8, 24),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    grp.add(ring);

    grp.position.copy(position);
    this.scene.add(grp);

    const record = {
      weaponId, mesh: grp, ring, body, position: position.clone(),
      collected: false, respawnAt: 0, born: performance.now(),
    };
    this.pickups.push(record);
    return record;
  }

  _colorFor(id) {
    switch (id) {
      case "smg":     return 0x34d399;
      case "shotgun": return 0xf472b6;
      case "sniper":  return 0xc084fc;
      case "railgun": return 0x22d3ee;
      case "gravity": return 0x60a5fa;
      case "pistol":  return 0xfbbf24;
      default:        return 0xa78bfa;
    }
  }

  // Engine calls this every frame. playerPos is the player's THREE.Vector3.
  // Returns the weaponId picked up this frame, or null.
  update(dt, playerPos) {
    const now = performance.now();
    let picked = null;
    for (const p of this.pickups) {
      if (p.collected) {
        // Tick respawn.
        if (now >= p.respawnAt) {
          // Respawn at a fresh random arena point.
          const all = [...this.arena.spawnPoints, ...this._extraPoints()];
          const sp = all[Math.floor(Math.random() * all.length)];
          p.position.copy(sp);
          p.mesh.position.copy(sp);
          p.mesh.visible = true;
          p.collected = false;
          p.born = now;
          // Re-roll the weapon for variety.
          const newId = PICKUP_POOL[Math.floor(Math.random() * PICKUP_POOL.length)];
          if (newId !== p.weaponId) {
            // Recolor the visuals — body + pillar + ring.
            const c = this._colorFor(newId);
            for (const child of p.mesh.children) {
              if (child.material && child.material.color) {
                if (child === p.body || child !== p.body && child.material !== undefined) {
                  // Heuristic — only recolor non-wireframe.
                  if (!child.material.wireframe) child.material.color.setHex(c);
                }
              }
            }
            p.weaponId = newId;
          }
        }
        continue;
      }
      // Bob + spin.
      const t = (now - p.born) / 1000;
      p.mesh.children[0].position.y = PICKUP_HEIGHT + Math.sin(t * 2) * 0.08;
      p.mesh.children[1].position.y = PICKUP_HEIGHT + Math.sin(t * 2) * 0.08;
      p.mesh.rotation.y += dt * 1.0;
      // Pickup check.
      if (!picked && playerPos.distanceTo(p.position) < PICKUP_RADIUS) {
        p.collected = true;
        p.mesh.visible = false;
        p.respawnAt = now + RESPAWN_MS;
        picked = p.weaponId;
      }
    }
    return picked;
  }

  _extraPoints() {
    return [
      new THREE.Vector3(-10, 0, 8),
      new THREE.Vector3(10, 0, -4),
      new THREE.Vector3(0, 0, 22),
      new THREE.Vector3(-22, 0, -8),
      new THREE.Vector3(22, 0, -8),
    ];
  }

  destroy() {
    for (const p of this.pickups) {
      try {
        this.scene.remove(p.mesh);
        p.mesh.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose?.();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
            else obj.material.dispose?.();
          }
        });
      } catch (e) {}
    }
    this.pickups = [];
  }
}
