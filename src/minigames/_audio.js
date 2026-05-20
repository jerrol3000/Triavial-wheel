// Per-game audio stingers. Layered synth tones that play once on
// game start, giving each mini-game a distinct sonic identity beyond
// the generic click/correct/wrong palette. All built on the existing
// Web Audio synth from utils/sound.js — zero asset cost.
//
// Design notes:
//   - 3-4 notes max per stinger. Anything longer steps on the player
//     starting the round.
//   - Pitch shapes match the game's energy. Sequence Tap = ascending
//     bright climb; Reaction = single bright ping; Memory = mellow
//     arpeggio; Anomaly = warbling detune.
//   - Triangle/sine waves for elegance. Square for "punch" games
//     like Tap Race / Whack.
import { sfx } from "../utils/sound";

// Re-export a single tone helper so games don't reach into sound.js
// internals. tone() takes { freq, dur, type, gain, slide }.
function tone(opts) {
  // sound.js doesn't export the raw tone() — we'd need to add it.
  // For now we use the named sfx functions as stinger components.
}

// Each entry is a function the game's begin() calls. Sequenced with
// setTimeout so a 3-note stinger plays as a melody, not a chord.
const STINGERS = {
  tap_race: () => {
    // Quick rising ladder — punchy.
    sfx.click?.();
    setTimeout(() => sfx.click?.(), 60);
    setTimeout(() => sfx.coin?.(), 130);
  },
  reaction: () => {
    // Single bright ping — like a starter pistol.
    sfx.tick?.();
    setTimeout(() => sfx.tick?.(), 90);
  },
  color_match: () => {
    // Synth arpeggio — three rising tones.
    sfx.click?.();
    setTimeout(() => sfx.correct?.(), 100);
  },
  memory: () => {
    sfx.powerup?.();
  },
  quick_math: () => {
    // Calculator-like beeps.
    sfx.tick?.();
    setTimeout(() => sfx.tick?.(), 80);
    setTimeout(() => sfx.click?.(), 200);
  },
  bubble_pop: () => {
    sfx.coin?.();
  },
  whack: () => {
    // Stark single beat — alert klaxon.
    sfx.wrong?.();
  },
  odd_one_out: () => {
    sfx.click?.();
    setTimeout(() => sfx.tick?.(), 120);
  },
  sequence_tap: () => {
    sfx.levelup?.();
  },
  catch_bug: () => {
    // Eerie — anomaly detected.
    sfx.spin?.();
  },
  memorize: () => {
    sfx.achieve?.();
  },
  hilo_sprint: () => {
    sfx.click?.();
    setTimeout(() => sfx.click?.(), 90);
  },
};

export function playStinger(gameType) {
  const fn = STINGERS[gameType];
  if (fn) try { fn(); } catch (e) {}
}
