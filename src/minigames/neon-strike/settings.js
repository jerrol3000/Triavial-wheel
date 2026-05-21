// settings — persistence + live application of Neon Strike settings.
//
// Storage: localStorage "nsa:settings". JSON-serialized.
// Applied to:
//   • Mouse sensitivity → PointerLockControls (custom factor passed
//     into pointermove handler via a global since the lib doesn't
//     expose a sensitivity setter; we monkey-patch onMouseMove)
//   • FOV → camera.fov + updateProjectionMatrix()
//   • Volume → window.speechSynthesis utterance volume + Web Audio
//     master gain (we don't have a master gain on the synth, so
//     for now just announcer volume)
//   • Performance → renderer.setPixelRatio + (future) bloom quality
//   • Announcer → toggles speech entirely

const KEY = "nsa:settings";
const DEFAULTS = {
  sensitivity: 1.0,
  fov: 78,
  volume: 80,
  announcer: "on",
  performance: "high",
};

export function loadSettings() {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
}

export function applySettingsToEngine(engine, s) {
  if (!engine) return;
  // FOV
  if (engine.camera) {
    engine.camera.fov = s.fov;
    engine.camera.updateProjectionMatrix();
  }
  // Performance preset → pixel ratio cap.
  if (engine.renderer) {
    const ratio = s.performance === "low" ? 1.0 : s.performance === "medium" ? 1.25 : Math.min(2, window.devicePixelRatio || 1);
    engine.renderer.setPixelRatio(ratio);
  }
  // Mouse sensitivity — patches PointerLockControls' default sensitivity
  // factor by overriding mousemove. PointerLockControls applies a
  // built-in scale; we can't intercept that cleanly without rewriting
  // it, so we expose engine.mouseSensitivityScale and apply per-frame
  // in the player controller's pitch settlement.
  engine.mouseSensitivityScale = s.sensitivity;
  // Announcer toggle.
  if (engine.announcer) engine.announcer.muted = s.announcer === "off";
  // Volume — applies to the announcer's utterance volume default.
  if (engine.announcer) engine.announcer.volume = s.volume / 100;
}
