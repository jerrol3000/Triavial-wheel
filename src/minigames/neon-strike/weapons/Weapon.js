// Weapon — abstract base class for all NSA weapons.
//
// Concrete weapons (PlasmaRifle, Railgun, EnergyShotgun, etc.) extend
// this and override:
//   - this.id, this.name, this.icon (static metadata)
//   - this.maxAmmo, this.damage, this.fireRateMs, this.recoilPattern
//   - _doShot()        — primary fire ray/projectile logic
//   - altFire()        — right-click secondary mode (or no-op)
//   - _buildViewmodel()— color/shape of the held weapon
//   - canFireWhileReloading (false by default)
//
// Shared logic lives in this base:
//   - Recoil pattern application + settle ticker
//   - Reload timer
//   - Tracer line spawn helper
//   - Viewmodel sway in update()
//   - Evolution stat tweaks (per-weapon overrides recommended)
//
// Engine instantiates the player's current weapon via the registry
// (see weapons/index.js). Loadout swap = destroy old + construct
// new (cheap, ~5ms — single mesh group + raycaster).

import * as THREE from "three";

export class Weapon {
  constructor(scene, camera, arena, particles, controls) {
    this.scene = scene;
    this.camera = camera;
    this.arena = arena;
    this.particles = particles;
    this.controls = controls;
    this._raycaster = new THREE.Raycaster();
    this._lastFire = 0;
    this._lastAltFire = 0;
    this._recoilIdx = 0;
    this._recoilCooldownAt = 0;
    this._appliedPitch = 0;
    this._appliedYaw = 0;
    // Concrete weapons override these in their constructor.
    this.id = "base";
    this.name = "Base";
    this.icon = "◧";
    this.level = 1;
    this.maxAmmo = 24;
    this.damage = 25;
    this.fireRateMs = 125;
    this.altFireRateMs = 500;
    this.reloadMs = 900;
    this.headshotMul = 2.4;
    // Default recoil — vertical climb with light zigzag.
    this.recoilPattern = [
      { pitch: 0.035, yaw: 0.000 },
      { pitch: 0.030, yaw: 0.008 },
      { pitch: 0.028, yaw: -0.006 },
      { pitch: 0.026, yaw: 0.012 },
      { pitch: 0.024, yaw: -0.010 },
      { pitch: 0.022, yaw: 0.005 },
    ];
    // Tracer color — usually accent-matched per weapon for visual
    // identification at a distance.
    this.tracerColor = 0xa78bfa;
    // Alt-fire descriptor — used by HUD to show "ALT: SCOPE" etc.
    // Concrete weapons override.
    this.altLabel = "—";
  }

  // ── Lifecycle ─────────────────────────────────────────────────
  update(dt) {
    // Recoil settle: ease the applied rotation back to zero when not
    // firing. 80ms cooldown so consecutive shots stack the recoil.
    const now = performance.now();
    if (now > this._recoilCooldownAt) {
      const settle = Math.min(1, 9 * dt);
      const dp = this._appliedPitch * settle;
      const dy = this._appliedYaw * settle;
      this.camera.rotation.x -= dp;
      try {
        const obj = this.controls && this.controls.getObject && this.controls.getObject();
        if (obj) obj.rotation.y -= dy;
      } catch (e) {}
      this._appliedPitch -= dp;
      this._appliedYaw -= dy;
      if (Math.abs(this._appliedPitch) < 0.0005 && Math.abs(this._appliedYaw) < 0.0005) {
        this._appliedPitch = 0;
        this._appliedYaw = 0;
        this._recoilIdx = 0;
      }
    }
    // Viewmodel sway.
    if (this.viewmodel) {
      this.viewmodel.position.y = (this._baseYmodelY ?? -0.3) + Math.sin(now * 0.003) * 0.005;
    }
  }

  reload(state) {
    if (state.reloading) return;
    state.reloading = true;
    setTimeout(() => {
      state.ammo = state.maxAmmo;
      state.reloading = false;
    }, this.reloadMs);
  }

  // Subclasses override evolve() to apply Mk-specific tweaks.
  evolve(level) {
    this.level = level;
  }

  // ── Primary fire ──────────────────────────────────────────────
  // Called by Engine. Throttles by fireRateMs and writes to state.ammo.
  fire(player, bots, onResolved, state) {
    const now = Date.now();
    if (now - this._lastFire < this.fireRateMs) return;
    if (state && state.reloading) return;
    if (state && state.ammo <= 0) return;
    this._lastFire = now;
    if (state) state.ammo -= 1;
    this._applyRecoil();
    this._doShot(player, bots, onResolved, state);
  }

  // Default alt-fire: no-op. Subclasses override.
  altFire(player, bots, onResolved, state) {
    // override
  }

  // Subclasses override.
  _doShot(player, bots, onResolved, state) {
    this._hitscan(player, bots, onResolved, state, {});
  }

  // ── Shared hit-scan helper ────────────────────────────────────
  // opts:
  //   directionOverride? : Vector3 — if set, bullet flies this way
  //                                  instead of camera forward.
  //   damageMul?         : number  — multiplies this.damage
  //   pierce?            : boolean — bullet continues past first hit
  //   tracerColor?       : hex     — override tracer color
  _hitscan(player, bots, onResolved, state, opts = {}) {
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    let dir;
    if (opts.directionOverride) {
      dir = opts.directionOverride.clone().normalize();
    } else {
      dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
    }
    this._raycaster.set(origin, dir);
    this._raycaster.far = 120;

    // Bots first.
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
    // Then walls.
    const wallHits = this._raycaster.intersectObjects(this.arena.raycastTargets(), false);
    const wallDist = wallHits[0] ? wallHits[0].distance : Infinity;

    const reachEnd = Math.min(120, Math.min(closestBotDist, wallDist));
    const tracerEnd = origin.clone().add(dir.clone().multiplyScalar(reachEnd));
    this._spawnTracer(origin, tracerEnd, opts.tracerColor ?? this.tracerColor);

    const dmgMul = opts.damageMul ?? 1;

    if (closestBotHit && closestBotDist <= wallDist) {
      onResolved({
        hit: true,
        target: { type: "bot", bot: closestBotHit.bot },
        headshot: closestBotHit.headshot,
        point: closestBotHit.point,
        damageOverride: this.damage * dmgMul,
        headshotMul: this.headshotMul,
      });
      if (opts.pierce) {
        // After piercing the first bot, continue to test for additional
        // bots or walls. We re-test by setting raycaster.near just
        // past the hit.
        this._raycaster.near = closestBotDist + 0.001;
        for (const bot of bots) {
          if (bot.dead || bot === closestBotHit.bot) continue;
          const h2 = bot.raycastHit(this._raycaster);
          if (h2 && h2.distance < wallDist) {
            onResolved({
              hit: true,
              target: { type: "bot", bot },
              headshot: h2.headshot,
              point: h2.point,
              damageOverride: this.damage * dmgMul * 0.7, // pierce decay
              headshotMul: this.headshotMul,
            });
          }
        }
        this._raycaster.near = 0;
      }
      return;
    }
    if (wallHits[0]) {
      this.particles.burst(wallHits[0].point, opts.tracerColor ?? this.tracerColor, 4);
      onResolved({ hit: false, point: wallHits[0].point });
    } else {
      onResolved({ hit: false, point: tracerEnd });
    }
  }

  // ── Recoil application ────────────────────────────────────────
  _applyRecoil() {
    const recoilMul = this.level === 1 ? 1.0
                    : this.level === 2 ? 0.55
                    : this.level === 3 ? 0.7
                    : this.level === 4 ? 0.45
                                       : 0.35;
    const kick = this.recoilPattern[this._recoilIdx % this.recoilPattern.length];
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
    this._recoilCooldownAt = performance.now() + 80;
  }

  // ── Tracer line (visible from-to streak) ──────────────────────
  _spawnTracer(from, to, colorHex) {
    const geom = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    const start = performance.now();
    const life = 95;
    const tick = () => {
      const t = (performance.now() - start) / life;
      if (t >= 1) {
        this.scene.remove(line);
        try { geom.dispose(); mat.dispose(); } catch (e) {}
        return;
      }
      mat.opacity = 0.9 * (1 - t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── Viewmodel (held weapon mesh) ──────────────────────────────
  _attachViewmodel(grp, barrelTip) {
    this.viewmodel = grp;
    this.barrelTip = barrelTip;
    this._baseYmodelY = grp.position.y;
    this.camera.add(grp);
    this.scene.add(this.camera);
  }

  destroy() {
    if (this.viewmodel && this.camera) {
      try { this.camera.remove(this.viewmodel); } catch (e) {}
      this.viewmodel.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    }
  }
}
