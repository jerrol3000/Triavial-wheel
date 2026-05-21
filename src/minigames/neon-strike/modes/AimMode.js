// AimMode — stationary + slowly-strafing targets in a training
// arena. Pure aim-skill grinder. 60-second timer. Score = total
// hits (scored by accuracy proxy: closer-to-center = more points,
// headshot = bonus).
//
// Targets:
//   • Static head dummies at fixed posts (worth +1 per hit)
//   • Pop-up targets that appear for 1.2s then despawn (worth +3)
//   • Sliding targets that drift left-right on a rail (worth +5)
//
// Each target = a Bot configured to "stand still and absorb hits"
// — we reuse the Bot class so the existing weapon hit-scan logic
// works without changes.
import * as THREE from "three";
import { Mode } from "./ModeBase.js";
import { Bot } from "../Bot.js";

const DURATION_MS = 60000;
const STATIC_POSTS = [
  new THREE.Vector3(-14, 1, -8),
  new THREE.Vector3(14, 1, -8),
  new THREE.Vector3(-14, 1, 4),
  new THREE.Vector3(14, 1, 4),
  new THREE.Vector3(-6, 1, 16),
  new THREE.Vector3(6, 1, 16),
];

export class AimMode extends Mode {
  constructor(engine, opts = {}) {
    super(engine);
    this.id = "aim";
    this.duration = DURATION_MS;
    this.popUntil = 0;
    this.popTargets = [];
    this.slideTargets = [];
  }

  start() {
    this.engine.state.time_remaining_ms = this.duration;
    // Build static dummies — they stand still and respawn 0.8s after
    // each kill so the player has a constant stream of easy hits.
    for (const post of STATIC_POSTS) {
      this._spawnStatic(post.clone());
    }
    // Build 2 sliding rail targets.
    this._spawnSlider(new THREE.Vector3(-12, 1, -22), new THREE.Vector3(12, 1, -22), 4);
    this._spawnSlider(new THREE.Vector3(12, 1, 22), new THREE.Vector3(-12, 1, 22), 3);
    this.engine.announcer.say("AIM TRAINING");
  }

  _spawnStatic(pos) {
    const bot = new Bot(this.engine.scene, this.engine.arena, "AGGRO", { pos, color: 0x60a5fa });
    bot.name = "DUMMY";
    bot.maxHealth = 1; // 1 HP — any hit kills
    bot.health = 1;
    // Override update — stationary.
    bot.update = () => {};
    this.engine.bots.push(bot);
    // Auto-respawn 800ms after kill.
    const origDie = bot._die.bind(bot);
    bot._die = () => {
      origDie();
      setTimeout(() => bot.respawn(pos), 800);
    };
  }

  _spawnSlider(from, to, speed) {
    const bot = new Bot(this.engine.scene, this.engine.arena, "AGGRO", { pos: from.clone(), color: 0xfbbf24 });
    bot.name = "SLIDER";
    bot.maxHealth = 1; bot.health = 1;
    const origUpdate = bot.update.bind(bot);
    bot._t = 0; bot._from = from.clone(); bot._to = to.clone(); bot._speed = speed;
    bot.update = (dt) => {
      if (bot.dead) return;
      bot._t += dt * bot._speed * 0.3;
      const k = (Math.sin(bot._t) + 1) / 2;
      bot.position.lerpVectors(bot._from, bot._to, k);
      bot.mesh.position.copy(bot.position);
      bot._faceTarget(this.engine.camera.position);
    };
    const origDie = bot._die.bind(bot);
    bot._die = () => {
      origDie();
      setTimeout(() => bot.respawn(from), 600);
    };
    this.engine.bots.push(bot);
  }
}
