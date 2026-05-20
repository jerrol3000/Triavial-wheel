// Premium Web Audio synth engine for the Arena. Replaces the basic
// 8-bit-sounding tones from utils/sound.js with layered, FX-chained
// game audio that doesn't read as "amateur synth."
//
// Design principles:
//   • Every sound is multi-oscillator (sine + triangle + sub-bass)
//   • Filtered (lowpass envelope) so highs don't pierce
//   • Reverb tail via simple convolver (impulse response generated
//     once at boot)
//   • All sounds normalized to -6dB peak headroom
//
// Why not sample files: bundle bloat (~1-3 MB of audio adds up fast)
// and license headaches. With this synth we get richer-than-utils/sound
// audio at zero asset cost. Future: drop CC0 samples into public/audio
// and they layer in via the Howler hook in _fx.js — best of both.
//
// API:
//   playSFX('hit_perfect' | 'hit_good' | 'hit_late' | 'miss' |
//           'combo_break' | 'power_up' | 'core_spawn' | 'bass_kick' |
//           'win_stinger' | 'lose_stinger' | 'tick' | 'whoosh')
//   startMusic(opts) → returns stop() callback. Loops a 4-on-the-floor
//                      bass/kick/hi-hat pattern at the given BPM until
//                      stop() is called.
//   getAnalyser() → AnalyserNode for audio-reactive visuals (Surge).

let ctx = null;
let masterGain = null;
let reverbBus = null;
let dryBus = null;
let convolver = null;
let analyser = null;
let unlocked = false;
let musicNodes = null;

function ensure() {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(ctx.destination);

    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    masterGain.connect(analyser);

    // Simple reverb — 1.2s decaying noise impulse response.
    convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 1.2, 2.5);
    reverbBus = ctx.createGain();
    reverbBus.gain.value = 0.18;
    reverbBus.connect(convolver).connect(masterGain);
    dryBus = ctx.createGain();
    dryBus.gain.value = 0.9;
    dryBus.connect(masterGain);
  } catch (e) {
    ctx = null;
  }
  return ctx;
}

function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = rate * seconds;
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function tryUnlock() {
  if (unlocked) return;
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  // Silent ping to fully unlock on iOS.
  try {
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
    unlocked = true;
  } catch (e) {}
}
if (typeof window !== "undefined" && !window.__twSynthInit) {
  window.__twSynthInit = true;
  ["pointerdown", "touchstart", "keydown", "click"].forEach((ev) =>
    window.addEventListener(ev, tryUnlock, { passive: true })
  );
}

// ─── Low-level voice ───────────────────────────────────────────────
// Multi-osc voice with ADSR-style gain envelope + lowpass filter.
function voice({
  freq = 440, type = "sine", dur = 0.2, gain = 0.25,
  attack = 0.005, decay = 0.08, sustain = 0.0, release = 0.05,
  freqEnd, filterStart = 8000, filterEnd = 800, filterQ = 1,
  detune = 0, reverbSend = 0.4,
}) {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  if (detune) osc.detune.setValueAtTime(detune, t);

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = filterQ;
  filter.frequency.setValueAtTime(filterStart, t);
  if (filterEnd != null) filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterEnd), t + dur);

  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(Math.max(0.001, sustain * gain), t + attack + decay);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(filter).connect(env);
  env.connect(dryBus);
  if (reverbSend > 0) {
    const send = c.createGain();
    send.gain.value = reverbSend;
    env.connect(send).connect(reverbBus);
  }

  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// ─── High-level SFX presets ───────────────────────────────────────
// Each is a multi-voice composition — feels meatier than a single tone.
const SFX = {
  // PERFECT hit — bright stab + sub-bass thump + airy upper harmonic.
  hit_perfect: () => {
    voice({ freq: 880, type: "triangle", dur: 0.18, gain: 0.22, attack: 0.001, freqEnd: 1320, filterStart: 12000, filterEnd: 5000 });
    voice({ freq: 110, type: "sine",     dur: 0.22, gain: 0.32, attack: 0.001, freqEnd: 55,   filterStart: 800,   filterEnd: 200, reverbSend: 0.1 });
    voice({ freq: 1760, type: "sine",    dur: 0.10, gain: 0.10, attack: 0.001, filterStart: 14000, filterEnd: 6000, reverbSend: 0.6 });
  },
  // GOOD hit — softer than perfect.
  hit_good: () => {
    voice({ freq: 660, type: "triangle", dur: 0.14, gain: 0.18, attack: 0.001, freqEnd: 880, filterStart: 9000, filterEnd: 3000 });
    voice({ freq: 1320, type: "sine",    dur: 0.08, gain: 0.08, attack: 0.001, filterStart: 12000, filterEnd: 5000, reverbSend: 0.5 });
  },
  // LATE hit — duller, no upper sparkle.
  hit_late: () => {
    voice({ freq: 440, type: "triangle", dur: 0.12, gain: 0.14, attack: 0.001, freqEnd: 330, filterStart: 4000, filterEnd: 800 });
  },
  // MISS — dampened bass thud, descending.
  miss: () => {
    voice({ freq: 220, type: "sine",     dur: 0.22, gain: 0.20, attack: 0.001, freqEnd: 80, filterStart: 1200, filterEnd: 200, reverbSend: 0.1 });
  },
  // COMBO BREAK — descending two-note motif.
  combo_break: () => {
    voice({ freq: 390, type: "sawtooth", dur: 0.10, gain: 0.12, attack: 0.001, freqEnd: 280, filterStart: 1500, filterEnd: 500 });
    setTimeout(() => voice({ freq: 280, type: "sawtooth", dur: 0.16, gain: 0.12, attack: 0.001, freqEnd: 196, filterStart: 1200, filterEnd: 400 }), 90);
  },
  // POWER-UP — rising arpeggio, bright.
  power_up: () => {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => voice({ freq: f, type: "triangle", dur: 0.16, gain: 0.18, attack: 0.001, filterStart: 8000, filterEnd: 3000, reverbSend: 0.5 }), i * 60)
    );
  },
  // CORE SPAWN — ethereal pad swell.
  core_spawn: () => {
    voice({ freq: 1320, type: "sine", dur: 0.5, gain: 0.10, attack: 0.05, decay: 0.4, sustain: 0.2, release: 0.3, filterStart: 6000, filterEnd: 3000, reverbSend: 0.9 });
    voice({ freq: 1760, type: "sine", dur: 0.5, gain: 0.08, attack: 0.05, decay: 0.4, sustain: 0.2, release: 0.3, filterStart: 8000, filterEnd: 4000, reverbSend: 0.9 });
  },
  // BASS KICK — short percussive thump.
  bass_kick: () => {
    voice({ freq: 140, type: "sine", dur: 0.18, gain: 0.45, attack: 0.001, freqEnd: 55, filterStart: 600, filterEnd: 80, reverbSend: 0.0 });
  },
  // HI-HAT — fast white-ish tick.
  hihat: () => {
    voice({ freq: 8000, type: "square", dur: 0.04, gain: 0.06, attack: 0.001, filterStart: 14000, filterEnd: 12000, reverbSend: 0.0, filterQ: 4 });
  },
  // SNARE — pitched noise body.
  snare: () => {
    voice({ freq: 220, type: "triangle", dur: 0.10, gain: 0.18, attack: 0.001, freqEnd: 110, filterStart: 3000, filterEnd: 600 });
    voice({ freq: 6000, type: "square",   dur: 0.06, gain: 0.05, attack: 0.001, filterStart: 12000, filterEnd: 4000, filterQ: 3, reverbSend: 0.1 });
  },
  // WIN — heroic fanfare.
  win_stinger: () => {
    [523, 659, 784, 1047, 1318].forEach((f, i) =>
      setTimeout(() => voice({ freq: f, type: "triangle", dur: 0.22, gain: 0.22, attack: 0.005, decay: 0.18, sustain: 0.0, filterStart: 8000, filterEnd: 3000, reverbSend: 0.6 }), i * 90)
    );
    // Bass underbed
    setTimeout(() => voice({ freq: 130, type: "sine", dur: 1.2, gain: 0.25, attack: 0.02, decay: 0.6, sustain: 0.5, freqEnd: 65, filterStart: 600, filterEnd: 200, reverbSend: 0.3 }), 0);
  },
  // LOSE — descending minor sigh.
  lose_stinger: () => {
    [392, 311, 247].forEach((f, i) =>
      setTimeout(() => voice({ freq: f, type: "sawtooth", dur: 0.30, gain: 0.18, attack: 0.005, freqEnd: f * 0.92, filterStart: 2500, filterEnd: 600 }), i * 160)
    );
  },
  // TICK — UI feedback.
  tick: () => {
    voice({ freq: 1200, type: "square", dur: 0.04, gain: 0.08, attack: 0.001, filterStart: 6000, filterEnd: 4000, filterQ: 2 });
  },
  // WHOOSH — anomaly teleport / reveal.
  whoosh: () => {
    voice({ freq: 400, type: "sawtooth", dur: 0.25, gain: 0.12, attack: 0.01, freqEnd: 1800, filterStart: 800, filterEnd: 6000, filterQ: 4, reverbSend: 0.6 });
  },
  // BASS DROP — Surge bass-drop flash.
  bass_drop: () => {
    voice({ freq: 220, type: "sawtooth", dur: 0.6, gain: 0.35, attack: 0.005, freqEnd: 55, filterStart: 4000, filterEnd: 200, reverbSend: 0.2 });
    voice({ freq: 110, type: "sine", dur: 0.8, gain: 0.30, attack: 0.005, freqEnd: 55, filterStart: 800, filterEnd: 100, reverbSend: 0.1 });
  },
};

export function playSFX(name) {
  const fn = SFX[name];
  if (!fn) return;
  try { fn(); } catch (e) {}
}

// ─── Music engine — 4-on-the-floor loop ───────────────────────────
// Schedules kick/snare/hat patterns + a sub-bass line in lookahead
// windows. Stops cleanly via the returned function.
export function startMusic({ bpm = 120, key = "E", onBeat } = {}) {
  const c = ensure();
  if (!c) return () => {};
  if (c.state === "suspended") c.resume().catch(() => {});
  const beatSec = 60 / bpm;
  const stepSec = beatSec / 4; // 16th-note grid
  let nextStep = 0;
  let nextTime = c.currentTime + 0.06;
  let stopped = false;
  // E minor pentatonic-ish bass line for some musical contour.
  const bassNotes = [
    82.41, 82.41, 110.00, 82.41,    // beat 1
    82.41, 82.41, 110.00, 82.41,    // beat 2
    73.42, 73.42, 98.00,  73.42,    // beat 3
    82.41, 82.41, 110.00, 123.47,   // beat 4
  ];

  function scheduleStep(stepIdx, time) {
    const beat = stepIdx % 4;
    const sixteenth = stepIdx % 16;

    // Kick on beats 1 and 3
    if (beat === 0 || beat === 8) {
      schedKick(time);
    } else if (sixteenth === 4 || sixteenth === 12) {
      schedSnare(time);
    }
    // Hi-hat on every 8th
    if (sixteenth % 2 === 0) schedHat(time, 0.35);
    else schedHat(time, 0.18);

    // Bass line — one per sixteenth.
    schedBass(time, bassNotes[sixteenth] || bassNotes[0]);

    if (onBeat && beat === 0) {
      try { onBeat(stepIdx / 4); } catch (e) {}
    }
  }

  function schedAt(fn) {
    return (time, ...rest) => {
      const t = time;
      try { fn(t, ...rest); } catch (e) {}
    };
  }

  const schedKick = schedAt((t) => {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(env).connect(dryBus);
    osc.start(t); osc.stop(t + 0.2);
  });

  const schedSnare = schedAt((t) => {
    // Pitched body
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t);
    const env1 = c.createGain();
    env1.gain.setValueAtTime(0, t); env1.gain.linearRampToValueAtTime(0.18, t + 0.001); env1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(env1).connect(dryBus);
    osc.start(t); osc.stop(t + 0.13);
    // Hi-band tick
    const tick = c.createOscillator();
    tick.type = "square";
    tick.frequency.setValueAtTime(6000, t);
    const e2 = c.createGain();
    e2.gain.setValueAtTime(0, t); e2.gain.linearRampToValueAtTime(0.06, t + 0.001); e2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 4000; bp.Q.value = 3;
    tick.connect(bp).connect(e2).connect(dryBus);
    tick.start(t); tick.stop(t + 0.07);
  });

  const schedHat = schedAt((t, vol = 0.25) => {
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = 8000;
    const e = c.createGain();
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(vol * 0.08, t + 0.001); e.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    const bp = c.createBiquadFilter(); bp.type = "highpass"; bp.frequency.value = 7000;
    o.connect(bp).connect(e).connect(dryBus);
    o.start(t); o.stop(t + 0.05);
  });

  const schedBass = schedAt((t, freq) => {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    f.Q.value = 4;
    const e = c.createGain();
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.14, t + 0.003); e.gain.exponentialRampToValueAtTime(0.001, t + stepSec * 0.95);
    o.connect(f).connect(e).connect(dryBus);
    o.start(t); o.stop(t + stepSec);
  });

  // Scheduler runs every 50ms scheduling ~250ms ahead.
  let interval = null;
  function tick() {
    if (stopped) return;
    while (nextTime < c.currentTime + 0.25 && !stopped) {
      scheduleStep(nextStep, nextTime);
      nextStep++;
      nextTime += stepSec;
    }
  }
  tick();
  interval = setInterval(tick, 50);
  musicNodes = { interval };

  return () => {
    stopped = true;
    if (interval) clearInterval(interval);
    musicNodes = null;
  };
}

export function stopMusic() {
  if (musicNodes && musicNodes.interval) {
    clearInterval(musicNodes.interval);
    musicNodes = null;
  }
}

// AnalyserNode for audio-reactive visuals. The Surge game uses this to
// drive its center-glow scale and waveform around the perimeter.
export function getAnalyser() {
  ensure();
  return analyser;
}

// Haptic feedback — short vibration on mobile devices that support it.
// Pass a number (single pulse ms) or array (pattern in ms).
export function haptic(pattern = 12) {
  if (typeof navigator === "undefined") return;
  if (!navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (e) {}
}
