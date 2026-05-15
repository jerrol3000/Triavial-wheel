// Tiny Web Audio synth — no audio files, no bundle weight.
//
// Chromium/Safari ship with an autoplay policy: an AudioContext created
// before the user has interacted with the page starts in "suspended" state
// and emits NO sound until ctx.resume() is called inside a user gesture.
// We resume() lazily on every tone — calls inside click handlers succeed.
let ctx = null;
let enabled = true;
let warned = false;

function ensure() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") {
    // Returns a promise; we don't await because the very next tone will
    // play silently anyway and the resume happens fast enough to catch
    // subsequent tones.
    ctx.resume().catch(() => {});
  }
  return ctx;
}

// One-time install: as soon as the user clicks anywhere, try to unlock audio.
// Belt-and-suspenders in case `ensure()` is called before any sfx fires.
if (typeof window !== "undefined" && !window.__twSoundUnlock) {
  window.__twSoundUnlock = true;
  const unlock = () => {
    try { ensure(); } catch (e) {}
    if (ctx && ctx.state !== "suspended") {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    }
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock, { passive: true });
}

function tone({ freq = 440, dur = 0.15, type = "sine", gain = 0.2, slide = 0 } = {}) {
  if (!enabled) return;
  const c = ensure();
  if (!c) {
    if (!warned) { warned = true; console.warn("[sound] Web Audio not supported in this browser"); }
    return;
  }
  if (c.state === "suspended") {
    // Audio still locked — first user gesture will unlock and the next tone will play.
    return;
  }
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
  clack:    () => tone({ freq: 1100, dur: 0.03, type: "square", gain: 0.08 }),
};

export function setSoundEnabled(on) { enabled = !!on; }
export function isSoundEnabled() { return enabled; }
