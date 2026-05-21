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
import { EnergyShift } from "./EnergyShift.js";
import { Announcer } from "./Announcer.js";
import { ParticlePool } from "./ParticlePool.js";
import { PickupManager } from "./Pickup.js";
import { buildWeapon, WEAPONS, WEAPON_ORDER } from "./weapons/index.js";
import { buildMode } from "./modes/index.js";

export class Engine {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.onHudUpdate = opts.onHudUpdate || (() => {});
    this.onKillFeed = opts.onKillFeed || (() => {});
    this.onMatchEnd = opts.onMatchEnd || (() => {});
    // P1-1: HUD callback for hit confirmations + floating damage numbers.
    // The HUD owns rendering both — these are pure events from the engine.
    this.onHitConfirmed = opts.onHitConfirmed || (() => {}); // { headshot, kill }
    this.onDamageNumber = opts.onDamageNumber || (() => {}); // { worldPos, amount, headshot, kill }
    this.duration = opts.durationMs || 90000;
    // P2-1 + P2-6: difficulty + mode are configurable per-match.
    this.difficulty = opts.difficulty || "normal";
    this.modeId = opts.modeId || "arena";

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
    // P3-1: Loadout system. Player starts with PlasmaRifle equipped
    // and a Map of "owned" weapons. Pickups add to the inventory;
    // 1-7 keys + scroll wheel swap between owned weapons.
    this.weaponInventory = new Map(); // id → Weapon instance
    this._equipWeapon("plasma");
    this.energyShift = new EnergyShift(this.player, this.arena, this.scene);
    this.announcer = new Announcer();

    // ── Mode + bots ──────────────────────────────────────────────
    // Bots are populated by the active mode in mode.start().
    this.bots = [];
    this.mode = buildMode(this.modeId, this, { difficulty: this.difficulty });

    // ── Pickups (P3-10) ──────────────────────────────────────────
    // Only spawn in arena mode + wave mode; aim mode doesn't need them.
    this.pickups = (this.modeId === "arena" || this.modeId === "wave")
      ? new PickupManager(this.scene, this.arena)
      : null;

    // ── Player state ─────────────────────────────────────────────
    this.state = {
      health: 100,
      maxHealth: 100,
      ammo: this.weapon ? this.weapon.maxAmmo : 24,
      maxAmmo: this.weapon ? this.weapon.maxAmmo : 24,
      reloading: false,
      score: 0,
      kills: 0,
      deaths: 0,
      streak: 0,
      best_streak: 0,
      weaponLevel: 1, // for Weapon Evolution
      weaponKills: 0,
      // P3-1: current weapon descriptor mirrored to HUD.
      weaponId: this.weapon ? this.weapon.id : "plasma",
      weaponName: this.weapon ? this.weapon.name : "PLASMA",
      weaponIcon: this.weapon ? this.weapon.icon : "✦",
      altLabel: this.weapon ? this.weapon.altLabel : "—",
      energy: 100, // 0-100, used by Energy Shift + Dash
      shifting: false,
      time_remaining_ms: this.duration,
      ended: false,
      // P2-x: mode-aware HUD state
      modeId: this.modeId,
      wave: 0,
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

  // P3-1 + P3-8: equip a weapon by id. If already owned, just swap
  // the current pointer. If new, instantiate + add to inventory.
  // Used by initial setup, weapon pickups, and the 1-7 / wheel
  // switching keys.
  _equipWeapon(id) {
    if (!WEAPONS[id]) id = "plasma";
    // Hide the currently-equipped viewmodel.
    if (this.weapon && this.weapon.viewmodel) {
      this.weapon.viewmodel.visible = false;
    }
    let w = this.weaponInventory.get(id);
    if (!w) {
      w = buildWeapon(id, this.scene, this.camera, this.arena, this.particles, this.controls);
      this.weaponInventory.set(id, w);
      // Gravity launcher needs the bots ref for AOE — set it whenever
      // it's instantiated (the engine's bots array updates by ref
      // from the mode).
      if (w.setBots) w.setBots(this.bots);
    }
    if (w.viewmodel) w.viewmodel.visible = true;
    this.weapon = w;
    // Sync state.maxAmmo + reset state.ammo to the new weapon's mag
    // (each weapon has its own ammo pool — simpler than tracking
    // per-weapon ammo state, and matches the casual feel).
    if (this.state) {
      this.state.maxAmmo = w.maxAmmo;
      this.state.ammo = w.maxAmmo;
      this.state.reloading = false;
      this.state.weaponId = w.id;
      this.state.weaponName = w.name;
      this.state.weaponIcon = w.icon;
      this.state.altLabel = w.altLabel;
      // Evolution is per-weapon — reset the engine's mirror to the
      // weapon's own level when swapping, so picking up a fresh
      // weapon mid-match doesn't insta-evolve it to whatever Mk
      // the previous weapon had reached.
      this.state.weaponLevel = w.level || 1;
      this.state.weaponKills = 0;
    }
  }

  // P3-8: swap to weapon by slot number (1-7).
  _equipBySlot(slot) {
    const entry = WEAPON_ORDER[slot - 1];
    if (!entry) return;
    this._equipWeapon(entry.id);
  }

  // P3-8: scroll-wheel cycle through OWNED weapons.
  _cycleWeapon(direction) {
    const owned = [...this.weaponInventory.keys()];
    if (owned.length <= 1) return;
    // Sort by slot order for predictable cycling.
    owned.sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);
    const curIdx = owned.indexOf(this.weapon.id);
    const next = (curIdx + direction + owned.length) % owned.length;
    this._equipWeapon(owned[next]);
  }

  _onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  _bindInput() {
    // Pointer-lock UX: click the canvas to lock cursor.
    this.renderer.domElement.addEventListener("click", () => {
      if (!this.running) return;
      if (!this.controls.isLocked) this.controls.lock();
      else this.weapon.fire(this.player, this.bots, this._onShotResolved, this.state);
    });
    // P3-9: right-click = alt fire. Browser context menu suppressed
    // on the canvas so the right-click doesn't pop a menu.
    this.renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    this.renderer.domElement.addEventListener("mousedown", (e) => {
      if (!this.running || !this.controls.isLocked) return;
      if (e.button === 2) {
        this.weapon.altFire(this.player, this.bots, this._onShotResolved, this.state);
      }
    });
    // P3-8: scroll wheel cycles owned weapons.
    this.renderer.domElement.addEventListener("wheel", (e) => {
      if (!this.running) return;
      e.preventDefault();
      this._cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
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
    // P3-8: 1-7 number keys equip by slot.
    if (e.code === "Digit1") this._equipBySlot(1);
    if (e.code === "Digit2") this._equipBySlot(2);
    if (e.code === "Digit3") this._equipBySlot(3);
    if (e.code === "Digit4") this._equipBySlot(4);
    if (e.code === "Digit5") this._equipBySlot(5);
    if (e.code === "Digit6") this._equipBySlot(6);
    if (e.code === "Digit7") this._equipBySlot(7);
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
      // P3-1: weapons supply their own damage values + headshot mul.
      const baseDmg = result.damageOverride ?? this.weapon?.damage ?? 25;
      const hsMul = result.headshotMul ?? this.weapon?.headshotMul ?? 2.4;
      const dmg = result.headshot ? baseDmg * hsMul : baseDmg;
      bot.applyDamage(dmg);
      this.particles.burst(result.point, 0xf472b6, 12);
      // P1-1: HUD signals — center-screen hit marker + floating
      // damage number at the world-space impact point. We pre-project
      // the world point to screen space in the HUD layer.
      this.onHitConfirmed({ headshot: result.headshot, kill: bot.dead });
      this.onDamageNumber({
        worldPos: result.point.clone(),
        amount: dmg,
        headshot: result.headshot,
        kill: bot.dead,
      });
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
      // P1-7: credit the killing bot for the scoreboard tally.
      if (by) by.killsSinceMatch = (by.killsSinceMatch || 0) + 1;
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
    // Mode owns bot spawn + duration setup.
    if (this.mode && !this._modeStarted) {
      this.mode.start();
      this._modeStarted = true;
      // Refresh weapon's bot reference (GravityLauncher uses it).
      for (const w of this.weaponInventory.values()) {
        if (w.setBots) w.setBots(this.bots);
      }
    }
    this._tick();
  }

  // P1-1: project a world-space THREE.Vector3 to screen-space pixel
  // coordinates, given the current canvas size. Returns null when the
  // point is behind the camera (so the HUD can drop the label).
  worldToScreen(worldPos) {
    const v = worldPos.clone().project(this.camera);
    if (v.z > 1) return null; // behind camera or outside frustum
    const canvas = this.renderer.domElement;
    return {
      x: (v.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (1 - (v.y * 0.5 + 0.5)) * canvas.clientHeight,
    };
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
      // P1-8: drive the phase-wall shader animation.
      this.arena.tickShaders(dt);
      // P2-x: let the mode tick (handles wave transitions, etc).
      if (this.mode) this.mode.update(dt);
      // P3-10: check pickups for collection.
      if (this.pickups) {
        const picked = this.pickups.update(dt, this.player.position);
        if (picked) {
          this._equipWeapon(picked);
          this.announcer.say(`${WEAPONS[picked].name} EQUIPPED`);
        }
      }
    }

    // Energy regen.
    if (!this.state.shifting && this.state.energy < 100) {
      this.state.energy = Math.min(100, this.state.energy + 12 * dt);
    }

    // Fire input via touch HUD or held mouse — full-auto weapons
    // (SMG, plasma) call fire() per frame; weapon throttles by
    // fireRateMs internally.
    if (this.input.fire) {
      this.weapon.fire(this.player, this.bots, this._onShotResolved, this.state);
    }

    // Mirror mode-specific state to HUD.
    if (this.mode && this.mode.id === "wave") {
      this.state.wave = this.mode.currentWave;
      this.state.intermission = this.mode.inIntermission;
    }
    // ── HUD callback ─────────────────────────────────────────────
    this.onHudUpdate({ ...this.state });

    // ── Render ───────────────────────────────────────────────────
    this.renderer.render(this.scene, this.camera);

    // ── Match end — defer to mode for the win condition ─────────
    const over = this.mode ? this.mode.isOver() : (this.state.time_remaining_ms <= 0);
    if (over && !this.state.ended) {
      this.state.ended = true;
      this.running = false;
      this.announcer.say("MATCH COMPLETE");
      const finalScore = this.mode ? this.mode.computeFinalScore(this.state) : this.state.score;
      this.onMatchEnd({ ...this.state, finalScore });
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
    try { if (this.pickups) this.pickups.destroy(); } catch (e) {}
    try { if (this.mode && this.mode.destroy) this.mode.destroy(); } catch (e) {}
    for (const w of this.weaponInventory.values()) {
      try { w.destroy(); } catch (e) {}
    }
    this.weaponInventory.clear();
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
