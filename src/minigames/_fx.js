// Shared visual effects + audio helpers built on top of canvas-confetti
// and Howler.js. Used by mini-games + the result screens. Tree-shakable
// so games that don't need confetti don't pay for it.

import confetti from "canvas-confetti";

// ─── Confetti presets ──────────────────────────────────────────────
// Tuned for premium feel — not the default rainbow stadium-blast.

// Standard celebration: short burst, brand-aligned palette.
export function celebrate(opts = {}) {
  const colors = opts.colors || ["#fbbf24", "#f472b6", "#a78bfa", "#34d399", "#60a5fa"];
  confetti({
    particleCount: 80,
    spread: 70,
    startVelocity: 35,
    decay: 0.92,
    scalar: 0.9,
    origin: opts.origin || { x: 0.5, y: 0.5 },
    colors,
    disableForReducedMotion: true,
  });
}

// PB hit — bigger, gold-forward, two staggered bursts for that
// "trophy reveal" feeling.
export function celebratePB(opts = {}) {
  confetti({
    particleCount: 120,
    spread: 100,
    startVelocity: 45,
    decay: 0.93,
    scalar: 1.1,
    origin: { x: 0.5, y: 0.55 },
    colors: ["#fbbf24", "#fcd34d", "#fde68a", "#ffffff"],
    disableForReducedMotion: true,
    ...opts,
  });
  // Trailing micro-burst 200ms later for the "and another!" effect.
  setTimeout(() => {
    confetti({
      particleCount: 50, spread: 60, startVelocity: 30,
      decay: 0.94, scalar: 0.7,
      origin: { x: 0.5, y: 0.45 },
      colors: ["#fbbf24", "#fff"],
      disableForReducedMotion: true,
    });
  }, 200);
}

// Combo ×4+ ignition — fast directional sparks, brand-color forward.
export function celebrateCombo(comboValue, opts = {}) {
  const intensity = Math.min(2.0, 0.6 + comboValue * 0.15);
  confetti({
    particleCount: Math.floor(30 * intensity),
    spread: 50,
    startVelocity: 28,
    decay: 0.95,
    scalar: 0.6,
    origin: opts.origin || { x: 0.5, y: 0.6 },
    colors: opts.colors || ["#fb923c", "#ef4444", "#fbbf24"],
    disableForReducedMotion: true,
  });
}

// Match-end victory — big sustained shower.
export function celebrateWin(opts = {}) {
  const duration = 1800;
  const end = Date.now() + duration;
  const colors = opts.colors || ["#fbbf24", "#f472b6", "#a78bfa", "#34d399", "#60a5fa", "#fb923c"];
  (function frame() {
    confetti({
      particleCount: 6,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 6,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors,
      disableForReducedMotion: true,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

// Loss / miss — soft slate-gray dust, not punishing.
export function commiserate() {
  confetti({
    particleCount: 20,
    spread: 40,
    startVelocity: 20,
    decay: 0.94,
    scalar: 0.5,
    origin: { x: 0.5, y: 0.5 },
    colors: ["#64748b", "#475569"],
    disableForReducedMotion: true,
  });
}

// ─── Howler audio loader ──────────────────────────────────────────
// Howler v2 is the de facto game-audio library. It handles autoplay
// unlock, sprite sheets, fade, loop, stereo panning — all the things
// Web Audio API requires you to write yourself.
//
// For now we ship NO bundled audio files (would inflate the bundle).
// Instead, we expose loadSound(url) which lazy-loads samples from a
// CDN or freesound.org URL when first played. Each game registers
// the URLs it needs via registerSounds(). Failed loads fall back to
// the synth-based sfx in utils/sound.js — guaranteed audio.
//
// To upgrade quality: drop CC0 samples into public/audio/ and update
// the URLs in the registry. No code changes needed.

import { Howl, Howler } from "howler";
import { sfx } from "../utils/sound";

// One-time autoplay unlock — Howler's docs recommend this on a user
// gesture. Already covered by sound.js's pointerdown listener, but
// double-prime it for safety.
let unlocked = false;
function unlock() {
  if (unlocked || typeof window === "undefined") return;
  Howler.ctx?.resume?.();
  unlocked = true;
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("touchstart", unlock, { once: true, passive: true });
}

const SOUNDS = new Map(); // key → Howl instance (lazy)
const FALLBACKS = {
  click:   () => sfx.click?.(),
  correct: () => sfx.correct?.(),
  wrong:   () => sfx.wrong?.(),
  win:     () => sfx.win?.(),
  coin:    () => sfx.coin?.(),
  tick:    () => sfx.tick?.(),
  pb:      () => { sfx.levelup?.(); },
};

// Register a sound URL under a key. Lazy — actual Howl construction
// happens at first play. URL can be a CDN, freesound.org direct link,
// or relative public/audio path.
export function registerSound(key, url, opts = {}) {
  // Only register if not already there to avoid GC churn.
  if (SOUNDS.has(key)) return;
  SOUNDS.set(key, {
    howl: null,
    create: () => new Howl({
      src: [url],
      volume: opts.volume ?? 0.5,
      loop: !!opts.loop,
      preload: false,
      ...opts,
    }),
    fallbackKey: opts.fallback || key,
  });
}

export function playSound(key) {
  const entry = SOUNDS.get(key);
  if (!entry) {
    const fb = FALLBACKS[key];
    if (fb) try { fb(); } catch (e) {}
    return null;
  }
  try {
    if (!entry.howl) entry.howl = entry.create();
    entry.howl.play();
    return entry.howl;
  } catch (e) {
    const fb = FALLBACKS[entry.fallbackKey];
    if (fb) try { fb(); } catch (er) {}
    return null;
  }
}

export function stopSound(key) {
  const entry = SOUNDS.get(key);
  if (entry?.howl) try { entry.howl.stop(); } catch (e) {}
}

// Get the underlying Howl for advanced control (volume fade,
// audio-reactive analyser, etc.). Returns null if not registered or
// not loaded yet.
export function getHowl(key) {
  const entry = SOUNDS.get(key);
  if (!entry) return null;
  if (!entry.howl) try { entry.howl = entry.create(); } catch (e) { return null; }
  return entry.howl;
}

// Convenience: load multiple sounds at once.
export function registerSoundPack(pack) {
  for (const [key, { url, ...opts }] of Object.entries(pack)) {
    registerSound(key, url, opts);
  }
}
