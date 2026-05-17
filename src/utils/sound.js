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

// Helpers to compose richer multi-tone sequences for the badge unlock
// stingers. Layered notes (chord) give a fuller "stinger" feel;
// arpeggios climb to telegraph escalating reward tiers.
function chord(freqs, opts = {}) {
  freqs.forEach((f) => tone({ ...opts, freq: f }));
}
function arpeggio(freqs, stepMs = 90, opts = {}) {
  freqs.forEach((f, i) => setTimeout(() => tone({ ...opts, freq: f }), i * stepMs));
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

  // Per-tier badge unlock stingers. Each tier escalates in note
  // count, brightness, and pitch range — bronze is a friendly
  // 2-note chime, legendary is a 6-note triumphal fanfare with a
  // root + fifth chord underpinning it. Designed to feel
  // proportionally rewarding so a Legendary unlock sounds clearly
  // bigger than a Bronze.
  badge_bronze: () => arpeggio([659, 988], 90, { dur: 0.20, type: "triangle", gain: 0.18 }),
  badge_silver: () => {
    arpeggio([784, 988, 1318], 75, { dur: 0.18, type: "triangle", gain: 0.18 });
    setTimeout(() => tone({ freq: 1568, dur: 0.30, type: "triangle", gain: 0.16 }), 280);
  },
  badge_gold: () => {
    // Brass-fanfare feel: rising arpeggio + a held high note
    arpeggio([523, 784, 1047, 1318], 90, { dur: 0.20, type: "sawtooth", gain: 0.14 });
    setTimeout(() => tone({ freq: 1568, dur: 0.40, type: "triangle", gain: 0.20 }), 420);
    setTimeout(() => tone({ freq: 2093, dur: 0.50, type: "triangle", gain: 0.16 }), 480);
  },
  badge_legendary: () => {
    // Epic stinger: low root for weight + ascending arpeggio +
    // sustained high chord at the peak. The chord gives a full
    // "orchestral hit" character without sample audio.
    tone({ freq: 196, dur: 0.80, type: "sawtooth", gain: 0.14 });          // low root C3
    tone({ freq: 261, dur: 0.80, type: "triangle", gain: 0.10 });          // C4 support
    arpeggio([523, 659, 784, 1047, 1318, 1568], 80, { dur: 0.18, type: "triangle", gain: 0.16 });
    setTimeout(() => chord([1047, 1318, 1568, 2093], { dur: 0.80, type: "triangle", gain: 0.14 }), 560);
    setTimeout(() => tone({ freq: 2637, dur: 0.50, type: "triangle", gain: 0.12 }), 620);
  },
};

// Map a badge tier string ("bronze" / "silver" / "gold" / "legendary")
// to its stinger. Unknown tiers fall back to the bronze chime so
// no badge unlock is silent.
export function playBadgeUnlock(tier) {
  const fn = sfx[`badge_${tier}`] || sfx.badge_bronze;
  try { fn(); } catch (e) {}
}

export function setSoundEnabled(on) { enabled = !!on; }
export function isSoundEnabled() { return enabled; }
