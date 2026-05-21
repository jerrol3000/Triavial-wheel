// PlayerController — kinematic capsule with combo movement.
//
// Movement model:
//   • Horizontal velocity is computed each frame from WASD input,
//     accelerated toward the target with a friction term. Cap at
//     a base run speed; sprint adds a multiplier.
//   • Vertical velocity has gravity applied each frame; jump sets
//     it to a fixed upward impulse. Air control reduced (0.4×).
//   • Slide: when crouching while running, applies a 1-second
//     boost in the current facing direction. Reduces hit-box height
//     (lowers camera) so player presents a smaller target.
//   • Air dash: instant velocity set in look direction. Costs 25
//     energy. Two dashes per ground touch.
//   • Wall run: when adjacent to a vertical surface AND in air AND
//     moving along it, gravity is canceled and a small upward
//     velocity is added. Lasts max 1.2s per wall.
//
// Collision: sweep-and-slide against arena.colliders. If a candidate
// move would collide, axis-separately try x-only then z-only, and
// take whichever doesn't collide. This is the standard FPS collide
// pattern — feels good, no physics engine needed.

import * as THREE from "three";

const GRAVITY = 22;
const JUMP_SPEED = 8.5;
const RUN_SPEED = 7.5;
const SPRINT_MUL = 1.4;
const AIR_CONTROL = 0.4;
const FRICTION = 12;
const SLIDE_BOOST = 14;
const SLIDE_DUR_MS = 900;
const DASH_SPEED = 18;
const DASH_DUR_MS = 220;
const DASH_COST = 25;
const WALLRUN_DUR_MS = 1200;
const WALLRUN_GRAVITY_FACTOR = 0.15;

export class PlayerController {
  constructor(camera, controls, arena) {
    this.camera = camera;
    this.controls = controls;
    this.arena = arena;

    this.velocity = new THREE.Vector3();
    this.position = new THREE.Vector3(0, 1.7, 8);
    this.camera.position.copy(this.position);

    this.onGround = false;
    this.dashesLeft = 2;
    this.dashUntil = 0;
    this.dashDir = new THREE.Vector3();
    this.slideUntil = 0;
    this.wallRunUntil = 0;
    this.wallNormal = new THREE.Vector3();
    this.jumpPending = false;
    this.cameraHeight = 1.7;
    this.targetCameraHeight = 1.7;
    this.bobT = 0;
  }

  requestJump() {
    this.jumpPending = true;
  }

  requestDash(state) {
    if (Date.now() < this.dashUntil) return;
    if (this.dashesLeft <= 0 && this.onGround === false) return;
    if (state.energy < DASH_COST) return;
    state.energy -= DASH_COST;
    if (!this.onGround) this.dashesLeft -= 1;
    this.dashUntil = Date.now() + DASH_DUR_MS;
    // Dash in the LOOK direction projected onto the horizontal plane.
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    this.dashDir.copy(dir);
  }

  requestSlide(keys) {
    if (!this.onGround) return;
    if (Date.now() < this.slideUntil) return;
    this.slideUntil = Date.now() + SLIDE_DUR_MS;
    // Boost in the current movement direction.
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    this.velocity.x += dir.x * SLIDE_BOOST;
    this.velocity.z += dir.z * SLIDE_BOOST;
  }

  update(dt, keys, mobile) {
    const now = Date.now();
    // ── Compute desired horizontal direction from keys + virtual stick
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3();
    right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

    let mx = 0, mz = 0;
    if (keys.w) mz += 1;
    if (keys.s) mz -= 1;
    if (keys.d) mx += 1;
    if (keys.a) mx -= 1;
    // Mobile virtual joystick.
    if (mobile.moveY) mz += mobile.moveY;
    if (mobile.moveX) mx += mobile.moveX;
    const inputLen = Math.hypot(mx, mz);
    if (inputLen > 1) { mx /= inputLen; mz /= inputLen; }

    const wishDir = new THREE.Vector3()
      .addScaledVector(fwd, mz)
      .addScaledVector(right, mx);
    if (wishDir.lengthSq() > 0) wishDir.normalize();

    const sprint = keys.shift ? SPRINT_MUL : 1.0;
    const targetSpeed = RUN_SPEED * sprint;

    // ── Slide / dash override — temporary high-speed direction lock
    if (now < this.dashUntil) {
      // While dashing, lock velocity to dashDir at DASH_SPEED.
      this.velocity.x = this.dashDir.x * DASH_SPEED;
      this.velocity.z = this.dashDir.z * DASH_SPEED;
    } else {
      // Standard accelerate-toward-wish-vel with friction.
      const wantVx = wishDir.x * targetSpeed;
      const wantVz = wishDir.z * targetSpeed;
      const control = this.onGround ? 1.0 : AIR_CONTROL;
      this.velocity.x += (wantVx - this.velocity.x) * Math.min(1, FRICTION * dt) * control;
      this.velocity.z += (wantVz - this.velocity.z) * Math.min(1, FRICTION * dt) * control;
    }

    // ── Slide camera lowering ──────────────────────────────────
    if (now < this.slideUntil) this.targetCameraHeight = 1.1;
    else this.targetCameraHeight = 1.7;
    this.cameraHeight += (this.targetCameraHeight - this.cameraHeight) * Math.min(1, 8 * dt);

    // ── Gravity ────────────────────────────────────────────────
    // Wall-running reduces gravity heavily.
    const wallRunning = now < this.wallRunUntil;
    const grav = wallRunning ? GRAVITY * WALLRUN_GRAVITY_FACTOR : GRAVITY;
    this.velocity.y -= grav * dt;
    if (wallRunning) this.velocity.y = Math.max(this.velocity.y, 0.5);

    // ── Jump ───────────────────────────────────────────────────
    if (this.jumpPending) {
      this.jumpPending = false;
      if (this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      } else if (wallRunning) {
        // Wall-jump: leap off perpendicular to the wall.
        this.velocity.y = JUMP_SPEED * 0.9;
        this.velocity.add(this.wallNormal.clone().multiplyScalar(8));
        this.wallRunUntil = 0;
      }
    }

    // ── Integrate position ─────────────────────────────────────
    const next = this.position.clone();
    next.x += this.velocity.x * dt;
    next.y += this.velocity.y * dt;
    next.z += this.velocity.z * dt;

    const shifted = false; // Engine flips this via energyShift; we read state from arena indirectly
    // Note: we don't have a direct ref to state.shifting here. The
    // collidesAt call below uses the most permissive interpretation;
    // EnergyShift will modulate by toggling individual mesh layers
    // via Arena.phaseMeshes(). For now we just pass shifted=false and
    // EnergyShift can intercept at the collision layer if needed.

    // Axis-separated collision resolution: try the full move,
    // and if it collides, fall back to per-axis tries.
    const radius = 0.45;
    if (!this.arena.collidesAt(next, radius, shifted)) {
      this.position.copy(next);
    } else {
      // Try x-only
      const tx = this.position.clone(); tx.x = next.x; tx.y = next.y;
      if (!this.arena.collidesAt(tx, radius, shifted)) {
        this.position.x = tx.x;
        this.position.y = tx.y;
        this.velocity.z = 0;
        this._tryWallRun(new THREE.Vector3(0, 0, this.velocity.z));
      } else {
        // Try z-only
        const tz = this.position.clone(); tz.z = next.z; tz.y = next.y;
        if (!this.arena.collidesAt(tz, radius, shifted)) {
          this.position.z = tz.z;
          this.position.y = tz.y;
          this.velocity.x = 0;
          this._tryWallRun(new THREE.Vector3(this.velocity.x, 0, 0));
        } else {
          // Y only (e.g. falling on ground)
          const ty = this.position.clone(); ty.y = next.y;
          if (!this.arena.collidesAt(ty, radius, shifted)) {
            this.position.y = ty.y;
          } else {
            this.velocity.set(0, 0, 0);
          }
        }
      }
    }

    // ── Floor clamp + ground state ─────────────────────────────
    if (this.position.y < 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
      this.dashesLeft = 2;
    } else if (this.velocity.y === 0 && this.position.y < 0.05) {
      this.onGround = true;
    } else if (this.position.y > 0.05) {
      this.onGround = false;
    }

    // ── Camera bob + apply position ────────────────────────────
    const speedHoriz = Math.hypot(this.velocity.x, this.velocity.z);
    this.bobT += dt * speedHoriz * 0.6;
    const bob = this.onGround && now > this.slideUntil ? Math.sin(this.bobT) * 0.04 : 0;
    this.camera.position.set(
      this.position.x,
      this.cameraHeight + bob,
      this.position.z,
    );
  }

  _tryWallRun(velOnWallAxis) {
    // If player is in air + moving along a wall, engage wall-run.
    if (this.onGround) return;
    if (Math.hypot(velOnWallAxis.x, velOnWallAxis.z) < 4) return;
    this.wallRunUntil = Date.now() + WALLRUN_DUR_MS;
    this.wallNormal.set(-velOnWallAxis.x, 0, -velOnWallAxis.z).normalize();
  }
}
