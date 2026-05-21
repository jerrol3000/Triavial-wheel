// ArenaMode — the original 90-second deathmatch vs N AI bots.
// Score = kills × 10 + best_streak × 5, capped at 200.
import * as THREE from "three";
import { Mode } from "./ModeBase.js";
import { Bot } from "../Bot.js";

const PERSONALITIES = [
  { name: "AGGRO",   pos: new THREE.Vector3(-14, 1, -10), color: 0xf472b6 },
  { name: "SNIPER",  pos: new THREE.Vector3(14, 1, -12),  color: 0x22d3ee },
  { name: "FLANKER", pos: new THREE.Vector3(0, 1, -18),   color: 0xfbbf24 },
];

export class ArenaMode extends Mode {
  constructor(engine, opts = {}) {
    super(engine);
    this.id = "arena";
    this.difficulty = opts.difficulty || "normal";
    this.duration = 90000;
  }

  start() {
    this.engine.state.time_remaining_ms = this.duration;
    // Difficulty modulates bot count + per-bot accuracy/damage.
    const count = this.difficulty === "easy" ? 2 : this.difficulty === "hard" ? 4 : 3;
    const accMul = this.difficulty === "easy" ? 0.75 : this.difficulty === "hard" ? 1.3 : 1.0;
    const dmgMul = this.difficulty === "easy" ? 0.7  : this.difficulty === "hard" ? 1.3 : 1.0;
    for (let i = 0; i < count; i++) {
      const p = PERSONALITIES[i % PERSONALITIES.length];
      const bot = new Bot(this.engine.scene, this.engine.arena, p.name, { pos: p.pos.clone(), color: p.color });
      bot.p.damage = Math.round(bot.p.damage * dmgMul);
      bot._accMul = accMul;
      this.engine.bots.push(bot);
    }
    this.engine.announcer.say("ARENA ONLINE");
  }

  update(_dt) {
    // Standard 90-sec arena needs no per-frame logic — Engine's
    // bot.update() ticks them, bots respawn 2.5s after death.
  }
}
