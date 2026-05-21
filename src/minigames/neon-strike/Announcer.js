// Announcer — contextual AI commentator using the Web Speech API.
//
// Web Speech is built into every modern browser, so we get TTS for
// free with zero asset cost. We pick a robotic-ish voice when
// available (en-* with name "Google" or "Microsoft" matching synth-
// like profiles); fallback to default.
//
// Hype events:
//   • "FIRST BLOOD" — first kill of the match
//   • "DOUBLE KILL", "TRIPLE KILL", "RAMPAGE" at streaks of 2/3/5
//   • "GODLIKE" at streak 8+
//   • "WEAPON EVOLVED" on Mk-up
//   • "ENERGY SHIFT" on phase activation
//   • "RESPAWNING" on death
//   • "MATCH COMPLETE" at end
//
// Each event throttles itself — won't fire the same line twice
// within 1.2s.

const STREAK_LINES = {
  2: "DOUBLE KILL",
  3: "TRIPLE KILL",
  4: "QUAD KILL",
  5: "RAMPAGE",
  6: "DOMINATING",
  8: "UNSTOPPABLE",
  10: "GODLIKE",
};

export class Announcer {
  constructor() {
    this.firstKillFired = false;
    this.lastLine = "";
    this.lastAt = 0;
    // P1-5: settings-controlled mute + volume. Settings panel writes
    // these via applySettingsToEngine().
    this.muted = false;
    this.volume = 0.8;
    this._pickVoice();
  }

  _pickVoice() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const fill = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      // Prefer a voice that sounds slightly robotic — typically Google
      // US English (Female), Microsoft Zira / Mark, etc. Fallback to
      // the first English voice.
      const prefer = ["Google UK English Female", "Microsoft Zira", "Google US English", "Samantha", "Alex"];
      for (const name of prefer) {
        const v = voices.find((v) => v.name.includes(name));
        if (v) { this.voice = v; return; }
      }
      this.voice = voices.find((v) => v.lang?.startsWith("en")) || voices[0];
    };
    fill();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = fill;
    }
  }

  say(line, opts = {}) {
    if (this.muted) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const now = Date.now();
    if (line === this.lastLine && now - this.lastAt < 1200) return;
    this.lastLine = line;
    this.lastAt = now;
    try {
      // Cancel any in-flight utterance so combo callouts feel snappy.
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(line);
      if (this.voice) u.voice = this.voice;
      u.rate = opts.rate ?? 1.1;
      u.pitch = opts.pitch ?? 0.9;
      u.volume = (opts.volume ?? 0.8) * this.volume;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  streak(n) {
    if (n === 1) {
      if (!this.firstKillFired) {
        this.firstKillFired = true;
        this.say("FIRST BLOOD", { pitch: 0.8, rate: 0.95 });
      }
      return;
    }
    const line = STREAK_LINES[n] || (n > 10 ? "BEYOND GODLIKE" : null);
    if (line) this.say(line, { pitch: 0.85 + Math.min(0.5, n * 0.04) });
  }

  destroy() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  }
}
