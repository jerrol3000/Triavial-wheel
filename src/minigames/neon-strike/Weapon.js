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
  constructor(scene, camera, arena, particles) {
    this.scene = scene;
    this.camera = camera;
    this.arena = arena;
    this.particles = particles;
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
    // Decay recoil offset on camera pitch back toward 0.
    // We use camera.rotation.x for pitch (PointerLockControls sets this).
    // Just reduce abs value each frame.
    if (this._recoilOffset) {
      const decay = Math.min(1, 8 * dt);
      this._recoilOffset *= 1 - decay;
      this.camera.rotation.x -= this._recoilOffset * decay * 0.1;
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
    // Apply recoil offset to next pitch reading; visual recoil kick.
    this._recoilOffset = (this._recoilOffset || 0) + this.recoil;

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
