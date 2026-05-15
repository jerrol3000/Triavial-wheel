// Tiny Web Audio synth — no audio files, no bundle weight.
//
// Browsers (Chromium/Safari) ship with an autoplay policy: an AudioContext
// created before the user has interacted with the page starts in "suspended"
// state and produces NO sound. We unlock it with the canonical "silent buffer
// trick" on the very first user gesture, and also call resume() on every tone.
let ctx = null;
let enabled = true;
let unlocked = false;
let warnedOnce = false;

function ensureContext() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try { ctx = new AC(); } catch (e) { return null; }
  }
  return ctx;
}

function tryResume() {
  const c = ensureContext();
  if (c && c.state === "suspended") {
    c.resume().catch(() => {});
  }
}

// Definitive autoplay-unlock: create a tiny silent buffer and play it. This
// satisfies every browser's "user activated audio" requirement once and for all.
function unlockAudio() {
  if (unlocked) return;
  const c = ensureContext();
  if (!c) return;
  tryResume();
  try {
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
    unlocked = true;
  } catch (e) {
    // older browsers / some Safari versions
  }
}

// Listen for any user gesture and unlock. Keep listening (passive) until the
// context is actually running, then quietly stop attaching new listeners.
if (typeof window !== "undefined" && !window.__twSoundInit) {
  window.__twSoundInit = true;
  const events = ["pointerdown", "touchstart", "keydown", "click"];
  const handler = () => { unlockAudio(); };
  events.forEach((ev) => window.addEventListener(ev, handler, { passive: true }));

  // Expose a manual test hook for diagnostics: open DevTools console and run
  //   __twSoundTest()    — should play a coin chime
  //   __twSoundState()   — returns { state, enabled, unlocked } so you can see why
  window.__twSoundTest = () => { try { tone({ freq: 988, dur: 0.18, type: "square", gain: 0.2 }); } catch (e) {} };
  window.__twSoundState = () => ({
    enabled,
    unlocked,
    state: ctx ? ctx.state : "no-context",
    hasContext: !!ctx,
  });
}

function tone({ freq = 440, dur = 0.15, type = "sine", gain = 0.2, slide = 0 } = {}) {
  if (!enabled) return;
  const c = ensureContext();
  if (!c) {
    if (!warnedOnce) { warnedOnce = true; console.warn("[sound] Web Audio API not supported in this browser"); }
    return;
  }
  // Try resuming every call. resume() is idempotent on running contexts.
  if (c.state === "suspended") c.resume().catch(() => {});

  try {
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur);
  } catch (e) {
    if (!warnedOnce) { warnedOnce = true; console.warn("[sound] tone failed:", e.message); }
  }
}

export const sfx = {
  click:    () => tone({ freq: 600, dur: 0.05, type: "square", gain: 0.1 }),
  correct:  () => { tone({ freq: 660, dur: 0.1, type: "triangle" }); setTimeout(() => tone({ freq: 990, dur: 0.18, type: "triangle" }), 80); },
  wrong:    () => tone({ freq: 220, dur: 0.25, type: "sawtooth", gain: 0.18, slide: -120 }),
  tick:     () => tone({ freq: 800, dur: 0.04, type: "square", gain: 0.06 }),
  spin:     () => tone({ freq: 440, dur: 0.6, type: "triangle", gain: 0.12, slide: 200 }),
  win:      () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.16, type: "triangle" }), i * 110)); },
  lose:     () => { [392, 311, 261].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.22, type: "sawtooth", gain: 0.16 }), i * 160)); },
  levelup:  () => { [523, 659, 784, 1047, 1318].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.12, type: "triangle" }), i * 90)); },
  achieve:  () => { tone({ freq: 880, dur: 0.14, type: "triangle" }); setTimeout(() => tone({ freq: 1320, dur: 0.22, type: "triangle" }), 120); },
  coin:     () => { tone({ freq: 988, dur: 0.06, type: "square", gain: 0.14 }); setTimeout(() => tone({ freq: 1319, dur: 0.12, type: "square", gain: 0.12 }), 60); },
  powerup:  () => tone({ freq: 660, dur: 0.18, type: "triangle", slide: 600 }),
  clack:    () => tone({ freq: 1100, dur: 0.03, type: "square", gain: 0.09 }),
};

export function setSoundEnabled(on) { enabled = !!on; }
export function isSoundEnabled() { return enabled; }
