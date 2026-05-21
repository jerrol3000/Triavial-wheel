// WaveMode — escalating bot waves. The player survives as long as
// possible. Each wave spawns N bots; clearing them all triggers a
// 4-second intermission with a "WAVE COMPLETE" callout, then the
// next wave starts with +1 bot and slightly better stats.
//
// Wave 5: BOSS encounter (single OVERLORD with shield + AOE).
// Wave 10, 15, 20: more bosses.
//
// Mode ends when:
//   • Player dies (out of respawns — 3 lives)
//   • Player completes 10 waves (max)
//
// Score = clearedWaves × 25 + kills × 5. Capped at 200.

import * as THREE from "three";
import { Mode } from "./ModeBase.js";
import { Bot } from "../Bot.js";
import { BossBot } from "../BossBot.js";

const INTERMISSION_MS = 4000;
const MAX_WAVES = 10;

export class WaveMode extends Mode {
  constructor(engine, opts = {}) {
    super(engine);
    this.id = "wave";
    this.difficulty = opts.difficulty || "normal";
    this.currentWave = 0;
    this.wavesCleared = 0;
    this.inIntermission = false;
    this.intermissionEnds = 0;
    this.lives = 3;
    this.ended = false;
    this.duration = 600000; // 10-min cap
  }

  start() {
    this.engine.state.time_remaining_ms = this.duration;
    this.engine.announcer.say("SURVIVAL");
    setTimeout(() => this._startWave(1), 800);
  }

  _startWave(num) {
    this.currentWave = num;
    this.inIntermission = false;
    if (num === MAX_WAVES + 1) {
      // Completed all waves.
      this.ended = true;
      this.engine.announcer.say("ALL WAVES CLEARED");
      return;
    }
    const isBossWave = num % 5 === 0;
    if (isBossWave) {
      const boss = new BossBot(this.engine.scene, this.engine.arena, {
        pos: new THREE.Vector3(0, 1, -18),
      });
      this.engine.bots.push(boss);
      this.engine.announcer.say("OVERLORD INCOMING");
      return;
    }
    // Regular wave: spawn N bots with stats scaled by wave + difficulty.
    const count = Math.min(6, 1 + Math.floor(num * 0.7));
    const dmgMul = this.difficulty === "easy" ? 0.7 : this.difficulty === "hard" ? 1.3 : 1.0;
    const personalities = ["AGGRO", "SNIPER", "FLANKER"];
    const colors = { AGGRO: 0xf472b6, SNIPER: 0x22d3ee, FLANKER: 0xfbbf24 };
    const spots = [
      new THREE.Vector3(-18, 1, -18),
      new THREE.Vector3(18, 1, -18),
      new THREE.Vector3(0, 1, -28),
      new THREE.Vector3(-22, 1, 4),
      new THREE.Vector3(22, 1, 4),
      new THREE.Vector3(0, 1, 22),
    ];
    for (let i = 0; i < count; i++) {
      const pName = personalities[i % 3];
      const bot = new Bot(this.engine.scene, this.engine.arena, pName, {
        pos: spots[i % spots.length].clone(),
        color: colors[pName],
      });
      bot.p.damage = Math.round(bot.p.damage * dmgMul * (1 + num * 0.05));
      bot.maxHealth = Math.round(bot.maxHealth * (1 + num * 0.05));
      bot.health = bot.maxHealth;
      // Bots DON'T respawn in wave mode — once they're dead they stay dead.
      // We override respawn() to no-op.
      bot.respawn = () => {};
      this.engine.bots.push(bot);
    }
    this.engine.announcer.say(`WAVE ${num}`);
  }

  _onWaveCleared() {
    this.wavesCleared = this.currentWave;
    this.inIntermission = true;
    this.intermissionEnds = Date.now() + INTERMISSION_MS;
    this.engine.announcer.say("WAVE COMPLETE");
    // Heal the player partially as a reward.
    this.engine.state.health = Math.min(this.engine.state.maxHealth, this.engine.state.health + 35);
    // Reload ammo.
    if (this.engine.state.ammo < this.engine.state.maxAmmo) {
      this.engine.state.ammo = this.engine.state.maxAmmo;
    }
  }

  update(dt) {
    if (this.ended) return;
    const now = Date.now();
    // Detect when current wave is cleared.
    if (!this.inIntermission && this.currentWave > 0) {
      const alive = this.engine.bots.filter((b) => !b.dead);
      if (alive.length === 0) {
        this._onWaveCleared();
        return;
      }
    }
    // After intermission, start next wave.
    if (this.inIntermission && now >= this.intermissionEnds) {
      // Clean up dead bots first.
      for (const b of this.engine.bots) {
        try { this.engine.scene.remove(b.mesh); } catch (e) {}
      }
      this.engine.bots = [];
      this._startWave(this.currentWave + 1);
    }
  }

  isOver() {
    if (this.ended) return true;
    if (this.engine.state.deaths >= this.lives) return true;
    return false;
  }

  computeFinalScore(state) {
    return Math.min(200, this.wavesCleared * 25 + state.kills * 5);
  }
}
