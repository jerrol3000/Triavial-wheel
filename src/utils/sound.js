// Tiny Web Audio synth — no audio files, no bundle weight.
let ctx = null;
let enabled = true;

function ensure() {
  if (!ctx && typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return ctx;
}

function tone({ freq = 440, dur = 0.15, type = "sine", gain = 0.2, slide = 0 } = {}) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
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
};

export function setSoundEnabled(on) { enabled = !!on; }
export function isSoundEnabled() { return enabled; }
