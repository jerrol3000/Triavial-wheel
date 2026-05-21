// Neon Strike Arena — main engine module.
//
// Architecture overview:
//   • Engine owns the THREE.WebGLRenderer + Scene + PerspectiveCamera +
//     PointerLockControls. It runs the main loop on requestAnimationFrame.
//   • Subsystems are plain classes; Engine wires them together and
//     forwards per-frame ticks. No global state — every subsystem
//     receives its dependencies via constructor.
//   • Player controller is a kinematic capsule with sweep-based collision
//     against a static collider mesh assembled from the arena. No
//     physics engine — for an arena FPS the kinematic approach is
//     ~10× lighter and more responsive than Rapier.
//   • Bots use the same controller. Their AI lives in Bot.js with a
//     simple 3-state machine (wander / seek / fire) and personality
//     parameters (aggro / sniper / flanker).
//   • Combat is hit-scan via THREE.Raycaster — simple, deterministic,
//     anti-cheat friendly.
//   • EnergyShift handles the dimension-phase toggle: when shifted,
//     the player passes through "phase" colliders (walls flagged as
//     phasable in the arena) and renders translucent.
//
// Performance notes:
//   • Uses InstancedMesh for the arena's repeating pillars / panels
//     to keep draw calls minimal.
//   • Bots reuse a single skinned-mesh-like template (just one
//     primitive — no IK/animation) drawn at their position. Zero
//     skeleton overhead.
//   • Particle bursts use a pre-allocated pool of 200 sprites.

import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

import { Arena } from "./Arena.js";
import { PlayerController } from "./PlayerController.js";
import { Weapon } from "./Weapon.js";
import { Bot } from "./Bot.js";
import { EnergyShift } from "./EnergyShift.js";
import { Announcer } from "./Announcer.js";
import { ParticlePool } from "./ParticlePool.js";

export class Engine {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.onHudUpdate = opts.onHudUpdate || (() => {});
    this.onKillFeed = opts.onKillFeed || (() => {});
    this.onMatchEnd = opts.onMatchEnd || (() => {});
    this.duration = opts.durationMs || 90000;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060e);
    this.scene.fog = new THREE.FogExp2(0x05060e, 0.022);

    this.camera = new THREE.PerspectiveCamera(78, 1, 0.1, 200);
    this.camera.position.set(0, 1.7, 8);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      // preserveDrawingBuffer lets recorder code grab frames if needed.
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = false; // intentional — baked-feel via emissive
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.container.appendChild(this.renderer.domElement);

    // ── Lighting ─────────────────────────────────────────────────
    // Single ambient + low-key directional. Most of the arena's
    // illumination comes from emissive materials (neon panels +
    // pillars + spawn ring), which is cheap and gives the cyber look.
    this.scene.add(new THREE.AmbientLight(0x1a2540, 1.4));
    const dir = new THREE.DirectionalLight(0xa78bfa, 0.4);
    dir.position.set(8, 18, 6);
    this.scene.add(dir);

    // ── Subsystems ───────────────────────────────────────────────
    this.arena = new Arena(this.scene);
    this.particles = new ParticlePool(this.scene, 200);
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.player = new PlayerController(this.camera, this.controls, this.arena);
    this.weapon = new Weapon(this.scene, this.camera, this.arena, this.particles);
    this.energyShift = new EnergyShift(this.player, this.arena, this.scene);
    this.announcer = new Announcer();

    // ── Bots ─────────────────────────────────────────────────────
    // Three bots with distinct personalities.
    this.bots = [
      new Bot(this.scene, this.arena, "AGGRO",   { pos: new THREE.Vector3(-14, 1, -10), color: 0xf472b6 }),
      new Bot(this.scene, this.arena, "SNIPER",  { pos: new THREE.Vector3(14, 1, -12),  color: 0x22d3ee }),
      new Bot(this.scene, this.arena, "FLANKER", { pos: new THREE.Vector3(0, 1, -18),   color: 0xfbbf24 }),
    ];

    // ── Player state ─────────────────────────────────────────────
    this.state = {
      health: 100,
      maxHealth: 100,
      ammo: 24,
      maxAmmo: 24,
      reloading: false,
      score: 0,
      kills: 0,
      deaths: 0,
      streak: 0,
      best_streak: 0,
      weaponLevel: 1, // for Weapon Evolution
      weaponKills: 0,
      energy: 100, // 0-100, used by Energy Shift + Dash
      shifting: false,
      time_remaining_ms: this.duration,
      ended: false,
      // First-person camera bob state.
      bobT: 0,
    };

    // ── Input wiring ─────────────────────────────────────────────
    this._bindInput();
    this._onResize();
    window.addEventListener("resize", this._onResize);

    // ── Loop ─────────────────────────────────────────────────────
    this.clock = new THREE.Clock();
    this.startedAt = 0;
    this.running = false;
  }

  _onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  _bindInput() {
    // Pointer-lock UX: click the canvas to lock cursor. We expose
    // requestPointerLock() so the React HUD's start button can call it.
    this.renderer.domElement.addEventListener("click", () => {
      if (!this.running) return;
      if (!this.controls.isLocked) this.controls.lock();
      else this.weapon.fire(this.player, this.bots, this._onShotResolved);
    });
    // KEYBOARD
    this._keys = { w: false, a: false, s: false, d: false, shift: false, space: false, ctrl: false };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    // Touch-style: mobile users see a virtual joystick + buttons in
    // the React HUD. The HUD pokes engine.input.<flag>.
    this.input = { fire: false, jump: false, dash: false, shift: false, slide: false,
                   moveX: 0, moveY: 0, lookX: 0, lookY: 0 };
  }

  _onKeyDown = (e) => {
    if (e.code === "KeyW") this._keys.w = true;
    if (e.code === "KeyA") this._keys.a = true;
    if (e.code === "KeyS") this._keys.s = true;
    if (e.code === "KeyD") this._keys.d = true;
    if (e.code === "ShiftLeft") this._keys.shift = true;
    if (e.code === "ControlLeft") this._keys.ctrl = true;
    if (e.code === "Space") { this._keys.space = true; this.player.requestJump(); }
    if (e.code === "KeyR") this.weapon.reload(this.state);
    if (e.code === "KeyQ") this.energyShift.toggle(this.state);
    if (e.code === "KeyE") this.player.requestDash(this.state);
    if (e.code === "KeyF") this.player.requestSlide(this._keys);
  };
  _onKeyUp = (e) => {
    if (e.code === "KeyW") this._keys.w = false;
    if (e.code === "KeyA") this._keys.a = false;
    if (e.code === "KeyS") this._keys.s = false;
    if (e.code === "KeyD") this._keys.d = false;
    if (e.code === "ShiftLeft") this._keys.shift = false;
    if (e.code === "ControlLeft") this._keys.ctrl = false;
    if (e.code === "Space") this._keys.space = false;
  };

  // Fired when the player's bullet resolves on a bot or wall.
  _onShotResolved = (result) => {
    if (result.hit && result.target?.type === "bot") {
      const bot = result.target.bot;
      const dmg = result.headshot ? 60 : 25;
      bot.applyDamage(dmg);
      this.particles.burst(result.point, 0xf472b6, 12);
      if (bot.dead) {
        this.state.kills += 1;
        this.state.streak += 1;
        this.state.best_streak = Math.max(this.state.best_streak, this.state.streak);
        this.state.score += result.headshot ? 15 : 10;
        this.state.weaponKills += 1;
        // Weapon Evolution: every 3 kills the weapon levels up.
        if (this.state.weaponKills >= 3) {
          this.state.weaponLevel += 1;
          this.state.weaponKills = 0;
          this.weapon.evolve(this.state.weaponLevel);
          this.announcer.say(`WEAPON EVOLVED · MK ${this.state.weaponLevel}`);
        }
        this.announcer.streak(this.state.streak);
        this.onKillFeed({ killer: "you", victim: bot.name, headshot: result.headshot });
        // Respawn the bot after 2.5s elsewhere.
        setTimeout(() => bot.respawn(this.arena.randomSpawnPoint()), 2500);
      }
    }
  };

  // Called by bots when they hit the player. Damage scales with bot
  // personality (sniper = 35, aggro = 18, flanker = 22).
  damagePlayer(amount, by) {
    if (this.state.ended) return;
    if (this.state.shifting) return; // phased — bullets pass through
    this.state.health = Math.max(0, this.state.health - amount);
    this.state.streak = 0;
    this.particles.burst(this.camera.position.clone().add(new THREE.Vector3(0, -0.3, -0.8)), 0xef4444, 4);
    if (this.state.health <= 0) {
      // Death — respawn after 2s with full health.
      this.state.deaths += 1;
      this.announcer.say("RESPAWNING");
      this.onKillFeed({ killer: by?.name || "BOT", victim: "you", headshot: false });
      setTimeout(() => {
        if (this.state.ended) return;
        this.state.health = this.state.maxHealth;
        const sp = this.arena.randomSpawnPoint();
        this.camera.position.set(sp.x, 1.7, sp.z);
      }, 2000);
    }
  }

  start() {
    this.running = true;
    this.startedAt = Date.now();
    this.state.time_remaining_ms = this.duration;
    this.announcer.say("ARENA ONLINE");
    this._tick();
  }

  _tick = () => {
    if (!this.running) return;
    const dt = Math.min(0.05, this.clock.getDelta()); // cap dt to avoid huge jumps
    const now = Date.now();
    this.state.time_remaining_ms = Math.max(0, this.duration - (now - this.startedAt));

    // ── Update subsystems ────────────────────────────────────────
    if (this.controls.isLocked || this.input.lookX || this.input.lookY) {
      this.player.update(dt, this._keys, this.input);
      this.weapon.update(dt);
      this.energyShift.update(dt, this.state);
      for (const bot of this.bots) {
        bot.update(dt, this.camera.position, (dmg) => this.damagePlayer(dmg, bot), this.state, this.particles);
      }
      this.particles.update(dt);
    }

    // Energy regen.
    if (!this.state.shifting && this.state.energy < 100) {
      this.state.energy = Math.min(100, this.state.energy + 12 * dt);
    }

    // Fire input via touch HUD.
    if (this.input.fire && !this._lastFireT || (this.input.fire && now - (this._lastFireT || 0) > this.weapon.fireRateMs)) {
      this._lastFireT = now;
      this.weapon.fire(this.player, this.bots, this._onShotResolved);
    }

    // ── HUD callback ─────────────────────────────────────────────
    this.onHudUpdate({ ...this.state });

    // ── Render ───────────────────────────────────────────────────
    this.renderer.render(this.scene, this.camera);

    // ── Match end ────────────────────────────────────────────────
    if (this.state.time_remaining_ms <= 0 && !this.state.ended) {
      this.state.ended = true;
      this.running = false;
      this.announcer.say("MATCH COMPLETE");
      this.onMatchEnd({ ...this.state });
      return;
    }
    requestAnimationFrame(this._tick);
  };

  destroy() {
    this.running = false;
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    try { this.controls.unlock(); } catch (e) {}
    try { this.controls.dispose(); } catch (e) {}
    try { this.renderer.dispose(); } catch (e) {}
    try { this.renderer.domElement.remove(); } catch (e) {}
    // Dispose scene materials/geometries.
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
        else obj.material.dispose?.();
      }
    });
    this.announcer.destroy();
  }
}
