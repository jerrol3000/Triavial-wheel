// Weapon — hit-scan plasma rifle with recoil + evolution tiers.
//
// Hit-scan model: each fire raycasts from the camera position in
// the look direction. We test against bots first (closest hit wins),
// then arena walls. Returns a structured result to the engine
// callback so the engine can apply damage / play particles / etc.
//
// Recoil: short pitch nudge applied to camera on each shot, decays
// over ~120ms. Patterns get tighter at higher weapon levels.
//
// Weapon Evolution: each Mk level changes a stat:
//   Mk 1 — base plasma rifle: 24 ammo, 8 RPS, 25 dmg, single shot
//   Mk 2 — fire rate ×1.4, +6 ammo, recoil halved
//   Mk 3 — burst-fire mode (3 round burst per click), penetration
//   Mk 4 — homing slug (raycast finds nearest visible bot in 12°
//          cone), guaranteed body hits
//   Mk 5+ — railgun mode: pierces all targets in line, +20 dmg
//
// Mk levels persist for the duration of one match. On match end,
// the player keeps no progression to the next run (this is a
// single-match power-curve, not a meta-game).

import * as THREE from "three";

const BASE_DAMAGE = 25;
const HEADSHOT_MUL = 2.4;

export class Weapon {
  constructor(scene, camera, arena, particles, controls) {
    this.scene = scene;
    this.camera = camera;
    this.arena = arena;
    this.particles = particles;
    // P1-2: stored so the recoil ticker can apply yaw via the
    // PointerLockControls' parent object (the camera's pitch lives
    // on the camera itself; yaw lives on the parent).
    this.controls = controls;
    this.level = 1;
    this.fireRateMs = 125; // 8 RPS base
    this.recoil = 0.03;
    this.burst = 1;
    this.homing = false;
    this.pierce = false;
    this._raycaster = new THREE.Raycaster();
    this._lastFire = 0;
    this._tempVec = new THREE.Vector3();
    this._tempDir = new THREE.Vector3();
    // P1-2: per-weapon recoil pattern.
    // Recoil patterns are arrays of {pitch, yaw} deltas (in radians)
    // applied in sequence per shot, cycling back to the start.
    // Plasma rifle has a classic "rise + slight zigzag" pattern.
    // When new weapons land in P3 each gets its own pattern.
    this._recoilPattern = [
      { pitch: 0.035, yaw: 0.000 },
      { pitch: 0.030, yaw: 0.008 },
      { pitch: 0.028, yaw: -0.006 },
      { pitch: 0.026, yaw: 0.012 },
      { pitch: 0.024, yaw: -0.010 },
      { pitch: 0.022, yaw: 0.005 },
    ];
    this._recoilIdx = 0;
    this._recoilCooldownAt = 0;
    this._appliedPitch = 0;
    this._appliedYaw = 0;
    this._buildViewmodel();
  }

  _buildViewmodel() {
    // A simple "weapon" sticking up in the lower-right of the FOV.
    // Pure mesh — no animation rigs.
    const grp = new THREE.Group();
    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x101a3a }),
    );
    body.position.set(0.3, -0.3, -0.55);
    grp.add(body);
    // Emissive barrel tip
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.05, 0.1, 8),
      new THREE.MeshBasicMaterial({ color: 0xa78bfa }),
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.set(0.3, -0.3, -0.92);
    grp.add(tip);
    this.viewmodel = grp;
    this.barrelTip = tip;
    this.camera.add(grp);
    this.scene.add(this.camera);
  }

  update(dt) {
    // P1-2: recoil settle. Each shot pushes the camera up + sideways
    // via the pattern; we settle the APPLIED rotation back to zero
    // over ~250ms when not firing. This gives the kick-and-recover
    // feel real shooters have, without a separate "spray pattern"
    // overlay we'd need for proper bullet-by-bullet trajectories.
    const now = performance.now();
    if (now > this._recoilCooldownAt) {
      const settle = Math.min(1, 9 * dt);
      const dp = this._appliedPitch * settle;
      const dy = this._appliedYaw * settle;
      this.camera.rotation.x -= dp;
      // PointerLockControls handles yaw via parent object; tweak
      // camera.parent if needed. For PointerLockControls v0.160 the
      // controls object IS the camera holder.
      try {
        const obj = this.controls && this.controls.getObject && this.controls.getObject();
        if (obj) obj.rotation.y -= dy;
      } catch (e) {}
      this._appliedPitch -= dp;
      this._appliedYaw -= dy;
      if (Math.abs(this._appliedPitch) < 0.0005 && Math.abs(this._appliedYaw) < 0.0005) {
        this._appliedPitch = 0;
        this._appliedYaw = 0;
        // Reset pattern index when fully settled — back to first kick.
        this._recoilIdx = 0;
      }
    }
    // Subtle viewmodel sway.
    this.viewmodel.position.y = Math.sin(performance.now() * 0.003) * 0.005;
  }

  evolve(level) {
    this.level = level;
    if (level === 2) { this.fireRateMs = 90; this.recoil *= 0.5; }
    if (level === 3) { this.burst = 3; this.pierce = true; }
    if (level === 4) { this.homing = true; }
    if (level >= 5)  { this.pierce = true; this.fireRateMs = 70; }
    // Color the barrel tip differently per Mk for visual feedback.
    const tipColor = level <= 1 ? 0xa78bfa : level === 2 ? 0x22d3ee : level === 3 ? 0xfbbf24 : level === 4 ? 0xf472b6 : 0xffffff;
    this.barrelTip.material.color.setHex(tipColor);
  }

  reload(state) {
    if (state.reloading) return;
    state.reloading = true;
    setTimeout(() => {
      state.ammo = state.maxAmmo;
      state.reloading = false;
    }, 900);
  }

  fire(player, bots, onResolved) {
    const now = Date.now();
    if (now - this._lastFire < this.fireRateMs) return;
    this._lastFire = now;

    // We can't fire if no ammo in the engine's state — engine
    // tracks ammo and calls fire() only when valid. Here we apply
    // recoil + run the raycast.

    // Burst fire fires N shots in quick succession.
    const burstCount = this.burst;
    for (let b = 0; b < burstCount; b++) {
      setTimeout(() => this._doShot(player, bots, onResolved), b * 60);
    }
  }

  _doShot(player, bots, onResolved) {
    // P1-2: apply the next entry in the recoil pattern. Pattern
    // cycles back to the start when exhausted. Higher weapon Mk
    // reduces recoil scalar (recoilMul).
    const recoilMul = this.level === 1 ? 1.0
                    : this.level === 2 ? 0.55
                    : this.level === 3 ? 0.7  // burst spreads it out
                    : this.level === 4 ? 0.45
                                       : 0.35;
    const kick = this._recoilPattern[this._recoilIdx % this._recoilPattern.length];
    this._recoilIdx += 1;
    const pitchDelta = kick.pitch * recoilMul;
    const yawDelta = kick.yaw * recoilMul;
    this.camera.rotation.x += pitchDelta;
    try {
      const obj = this.controls && this.controls.getObject && this.controls.getObject();
      if (obj) obj.rotation.y += yawDelta;
    } catch (e) {}
    this._appliedPitch += pitchDelta;
    this._appliedYaw += yawDelta;
    // Hold off settle for 80ms so consecutive shots stack.
    this._recoilCooldownAt = performance.now() + 80;

    // Build raycaster from camera with optional homing aim assist.
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    if (this.homing) {
      // Aim assist: if a bot is within a 12° cone, nudge dir toward
      // their chest. Caps "homing" so it's still hit-scan but very
      // forgiving — a satisfying upgrade feel.
      let best = null;
      let bestDot = Math.cos(THREE.MathUtils.degToRad(12));
      for (const bot of bots) {
        if (bot.dead) continue;
        const toBot = bot.position.clone().sub(origin).normalize();
        const d = dir.dot(toBot);
        if (d > bestDot) { bestDot = d; best = bot; }
      }
      if (best) dir.copy(best.position.clone().sub(origin).normalize());
    }

    this._raycaster.set(origin, dir);
    this._raycaster.far = 80;

    // Test bots first (closest hit wins, supports pierce).
    let closestBotDist = Infinity;
    let closestBotHit = null;
    for (const bot of bots) {
      if (bot.dead) continue;
      const hit = bot.raycastHit(this._raycaster);
      if (hit && hit.distance < closestBotDist) {
        closestBotDist = hit.distance;
        closestBotHit = { ...hit, bot };
      }
    }

    // Test arena walls.
    const wallHit = this._raycaster.intersectObjects(this.arena.raycastTargets(), false);
    const wallDist = wallHit[0] ? wallHit[0].distance : Infinity;

    // Tracer line (brief visible streak from barrel to impact).
    const tracerEnd = origin.clone().add(dir.clone().multiplyScalar(Math.min(80, Math.min(closestBotDist, wallDist))));
    this._spawnTracer(origin, tracerEnd);

    if (closestBotHit && closestBotDist <= wallDist) {
      // Hit a bot. If pierce, continue to test more bots/walls beyond.
      onResolved({ hit: true, target: { type: "bot", bot: closestBotHit.bot }, headshot: closestBotHit.headshot, point: closestBotHit.point });
      if (!this.pierce) return;
    } else if (wallHit[0]) {
      // Hit a wall — small spark burst.
      this.particles.burst(wallHit[0].point, 0xa78bfa, 4);
      onResolved({ hit: false, point: wallHit[0].point });
    } else {
      onResolved({ hit: false, point: tracerEnd });
    }
  }

  _spawnTracer(from, to) {
    const geom = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    const start = performance.now();
    const life = 90;
    const tick = () => {
      const t = (performance.now() - start) / life;
      if (t >= 1) {
        this.scene.remove(line);
        try { geom.dispose(); mat.dispose(); } catch (e) {}
        return;
      }
      line.material.opacity = 0.85 * (1 - t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
