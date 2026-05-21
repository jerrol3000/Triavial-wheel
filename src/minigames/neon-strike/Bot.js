// Bot — humanoid AI opponent with 3 personalities.
//
// State machine: WANDER → SEEK → FIRE → COVER → DEAD.
//
//   • WANDER: idle/patrol movement around random arena points.
//             Transitions to SEEK when player is within sight + range.
//   • SEEK:   moves toward player at sprint speed. Transitions to
//             FIRE when within personality.engageDistance.
//   • FIRE:   strafes left/right while shooting at the player every
//             personality.fireRateMs ms. Transitions back to SEEK
//             when player escapes engageDistance + buffer.
//   • COVER:  brief retreat behind nearest obstacle (cover block)
//             when health < 35%. Triggered probabilistically based
//             on personality.coverProb.
//   • DEAD:   invisible, no updates. Engine schedules respawn().
//
// Personality params:
//   AGGRO   — short engage range, high fire rate, low cover prob
//   SNIPER  — long engage range, low fire rate, high damage
//   FLANKER — medium engage, sidestep-heavy strafe, high mobility
//
// Visual: a colored capsule with an emissive band. No animations
// (rotation tracks the player). Headshot box is the top 0.5 units.

import * as THREE from "three";

const PERSONALITIES = {
  AGGRO:   { engageDistance: 14, fireRateMs: 600,  burst: 2, damage: 14, moveSpeed: 5.5, sidestepProb: 0.4, coverProb: 0.25 },
  SNIPER:  { engageDistance: 32, fireRateMs: 1400, burst: 1, damage: 32, moveSpeed: 3.5, sidestepProb: 0.15, coverProb: 0.55 },
  FLANKER: { engageDistance: 18, fireRateMs: 800,  burst: 2, damage: 18, moveSpeed: 7.0, sidestepProb: 0.65, coverProb: 0.35 },
};

export class Bot {
  constructor(scene, arena, personality, opts = {}) {
    this.scene = scene;
    this.arena = arena;
    this.name = personality + "_" + Math.floor(Math.random() * 99);
    this.personalityName = personality;
    this.p = PERSONALITIES[personality] || PERSONALITIES.AGGRO;
    this.color = opts.color || 0xf472b6;
    this.maxHealth = 60;
    this.health = this.maxHealth;
    this.position = (opts.pos || new THREE.Vector3(0, 1, -10)).clone();
    this.target = this.position.clone();
    this.state = "WANDER";
    this.lastShot = 0;
    this.dead = false;
    // P1-7: per-match tallies surfaced to the scoreboard. Engine
    // increments killsSinceMatch when this bot kills the player.
    this.killsSinceMatch = 0;
    this.deathsSinceMatch = 0;
    this.lastSidestep = 0;
    this.sidestepDir = 1;
    this._raycaster = new THREE.Raycaster();
    this._buildMesh();
  }

  _buildMesh() {
    // Body capsule
    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.45, 1.2, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0x101a3a }),
    );
    body.position.y = 0.9;
    grp.add(body);
    // Glowing band — telegraphs personality color.
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.06, 6, 18),
      new THREE.MeshBasicMaterial({ color: this.color }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.5;
    grp.add(band);
    // Eye dot (a small bright point on front of head). Useful for
    // direction reading at a distance.
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    eye.position.set(0, 1.65, -0.4);
    grp.add(eye);
    grp.position.copy(this.position);
    this.mesh = grp;
    this.bodyMesh = body;
    this.bandMesh = band;
    this.scene.add(grp);
  }

  applyDamage(dmg) {
    this.health -= dmg;
    if (this.health <= 0) this._die();
    else {
      // Flash band white briefly to acknowledge a hit.
      this.bandMesh.material.color.setHex(0xffffff);
      setTimeout(() => this.bandMesh.material.color.setHex(this.color), 80);
    }
  }

  _die() {
    this.dead = true;
    this.deathsSinceMatch += 1;
    this.mesh.visible = false;
  }

  respawn(pos) {
    this.position.copy(pos).setY(1);
    this.mesh.position.copy(this.position);
    this.health = this.maxHealth;
    this.dead = false;
    this.mesh.visible = true;
    this.state = "WANDER";
  }

  // Returns { distance, point, headshot } or null. Caller is a raycaster.
  raycastHit(raycaster) {
    if (this.dead) return null;
    // Use the body mesh + a head box for headshot detection.
    const hits = raycaster.intersectObjects([this.bodyMesh], true);
    if (hits.length === 0) return null;
    const h = hits[0];
    // World position of the body. Headshot if hit Y > 1.5 (roughly the head).
    const headshot = h.point.y > this.mesh.position.y + 1.5;
    return { distance: h.distance, point: h.point, headshot };
  }

  update(dt, playerPos, damagePlayer, playerState, particles) {
    if (this.dead) return;
    const distToPlayer = this.position.distanceTo(playerPos);
    const canSee = this._lineOfSight(playerPos);
    const now = Date.now();

    // ── State transitions ───────────────────────────────────────
    if (this.state === "WANDER") {
      if (canSee && distToPlayer < this.p.engageDistance + 6) this.state = "SEEK";
    } else if (this.state === "SEEK") {
      if (!canSee && distToPlayer > this.p.engageDistance + 10) this.state = "WANDER";
      else if (distToPlayer < this.p.engageDistance && canSee) this.state = "FIRE";
    } else if (this.state === "FIRE") {
      if (!canSee) this.state = "SEEK";
      else if (distToPlayer > this.p.engageDistance + 6) this.state = "SEEK";
      // Health-based cover retreat.
      if (this.health < this.maxHealth * 0.35 && Math.random() < this.p.coverProb * dt) {
        this.state = "COVER";
        this._pickCoverTarget(playerPos);
      }
    } else if (this.state === "COVER") {
      if (this.position.distanceTo(this.target) < 1) this.state = canSee ? "FIRE" : "SEEK";
    }

    // ── State behaviors ─────────────────────────────────────────
    if (this.state === "WANDER") {
      if (this.position.distanceTo(this.target) < 1.2) {
        // Pick a new patrol point within ±20 units.
        this.target.set(
          (Math.random() - 0.5) * 60,
          0,
          (Math.random() - 0.5) * 60,
        );
      }
      this._moveToward(this.target, this.p.moveSpeed * 0.5, dt);
      // Face direction of movement
      this._faceTarget(this.target);
    } else if (this.state === "SEEK") {
      this._moveToward(playerPos, this.p.moveSpeed, dt);
      this._faceTarget(playerPos);
    } else if (this.state === "FIRE") {
      // Strafe in a sidestep pattern while aiming at the player.
      if (now - this.lastSidestep > 700) {
        this.lastSidestep = now;
        this.sidestepDir *= Math.random() < this.p.sidestepProb ? -1 : 1;
      }
      const toPlayer = playerPos.clone().sub(this.position); toPlayer.y = 0;
      const right = new THREE.Vector3().crossVectors(toPlayer, new THREE.Vector3(0, 1, 0)).normalize();
      const sidestepTarget = this.position.clone().addScaledVector(right, this.sidestepDir * 2);
      this._moveToward(sidestepTarget, this.p.moveSpeed * 0.6, dt);
      this._faceTarget(playerPos);

      // Fire on cadence.
      if (now - this.lastShot > this.p.fireRateMs) {
        this.lastShot = now;
        for (let b = 0; b < this.p.burst; b++) {
          setTimeout(() => this._fireAt(playerPos, damagePlayer, playerState, particles), b * 100);
        }
      }
    } else if (this.state === "COVER") {
      this._moveToward(this.target, this.p.moveSpeed * 0.9, dt);
      this._faceTarget(this.target);
    }
  }

  _pickCoverTarget(playerPos) {
    // Find a spawn point or arena corner that's far from the player.
    let best = null, bestDist = -1;
    for (const sp of this.arena.spawnPoints) {
      const d = sp.distanceTo(playerPos);
      if (d > bestDist) { bestDist = d; best = sp; }
    }
    if (best) this.target.copy(best).setY(0);
  }

  _moveToward(target, speed, dt) {
    const dir = target.clone().sub(this.position); dir.y = 0;
    if (dir.lengthSq() < 0.04) return;
    dir.normalize();
    const next = this.position.clone().addScaledVector(dir, speed * dt);
    next.y = this.position.y;
    if (!this.arena.collidesAt(next, 0.5, false)) {
      this.position.copy(next);
    } else {
      // Try sliding along x-only / z-only — simple wall-follow.
      const tx = this.position.clone(); tx.x = next.x;
      const tz = this.position.clone(); tz.z = next.z;
      if (!this.arena.collidesAt(tx, 0.5, false)) this.position.x = tx.x;
      else if (!this.arena.collidesAt(tz, 0.5, false)) this.position.z = tz.z;
    }
    this.mesh.position.copy(this.position);
  }

  _faceTarget(target) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  _lineOfSight(playerPos) {
    const origin = this.position.clone().setY(1.6);
    const dir = playerPos.clone().setY(1.6).sub(origin).normalize();
    this._raycaster.set(origin, dir);
    const playerDist = this.position.distanceTo(playerPos);
    this._raycaster.far = playerDist + 0.1;
    const hits = this._raycaster.intersectObjects(this.arena.raycastTargets(), false);
    // If any wall hit is closer than the player, no LOS.
    for (const h of hits) {
      if (h.distance < playerDist - 0.5) return false;
    }
    return true;
  }

  _fireAt(playerPos, damagePlayer, playerState, particles) {
    if (this.dead) return;
    // Bots have inherent miss chance based on personality.
    const accuracy = this.personalityName === "SNIPER" ? 0.7
                    : this.personalityName === "AGGRO" ? 0.45
                                                       : 0.55;
    // Movement accuracy penalty: if player was moving fast last frame
    // we'd ideally know that, but we use a constant for simplicity.
    if (Math.random() > accuracy) {
      // Miss — spawn small spark on a wall behind the player.
      const dir = playerPos.clone().sub(this.position).normalize();
      const stray = playerPos.clone().add(dir.multiplyScalar(2)).add(new THREE.Vector3(
        (Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3,
      ));
      particles.burst(stray, this.color, 3);
      return;
    }
    // Hit.
    damagePlayer(this.p.damage);
    particles.burst(playerPos.clone().add(new THREE.Vector3(0, -0.4, 0)), this.color, 5);
  }
}
