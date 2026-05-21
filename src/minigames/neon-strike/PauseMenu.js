// PauseMenu — ESC overlay with resume / settings / quit.
//
// Pause semantics:
//   • Engine.running flips to false → main loop returns immediately,
//     no scene updates, no time accrual.
//   • Pointer lock releases automatically (browser does this).
//   • Match timer is FROZEN: we adjust startedAt by the pause
//     duration on resume so time_remaining_ms reads the same value
//     it was at when the pause began.
//   • Web Speech announcer pauses too (we call window.speechSynthesis
//     .pause() and resume()).
//
// Settings persist via localStorage under "nsa:settings".
// SettingsPanel applies them live to the engine + saves on change.

import React, { useEffect, useState } from "react";
import { loadSettings, saveSettings, applySettingsToEngine } from "./settings.js";

export default function PauseMenu({ engine, open, onClose, onQuit }) {
  const [view, setView] = useState("root"); // root | settings
  const [settings, setSettings] = useState(() => loadSettings());

  // ESC handler — opens/closes the pause overlay.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "Escape") return;
      if (!engine?.running && !open) return; // ignore if game hasn't started
      if (open) {
        onClose();
      } else {
        // Manually pause + open
        engine._pausedAt = Date.now();
        engine.running = false;
        try { window.speechSynthesis.pause(); } catch (e2) {}
        onClose("open");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, open, onClose]);

  // When opening / closing, manage the engine running state.
  useEffect(() => {
    if (!engine) return;
    if (open && engine.running) {
      engine._pausedAt = Date.now();
      engine.running = false;
      try { window.speechSynthesis.pause(); } catch (e) {}
    } else if (!open && engine._pausedAt && !engine.state.ended) {
      // Resume — shift startedAt by the pause duration so the timer
      // doesn't lose time.
      const pausedMs = Date.now() - engine._pausedAt;
      engine.startedAt += pausedMs;
      engine._pausedAt = 0;
      engine.running = true;
      try { window.speechSynthesis.resume(); } catch (e) {}
      // Reset the clock so dt isn't huge on the next tick.
      try { engine.clock.getDelta(); } catch (e) {}
      engine._tick();
      // Re-lock pointer.
      try { engine.controls.lock(); } catch (e) {}
    }
  }, [open, engine]);

  if (!open) return null;

  const apply = (next) => {
    setSettings(next);
    saveSettings(next);
    applySettingsToEngine(engine, next);
  };

  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(5,6,14,0.92)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 16, padding: 24, zIndex: 50,
    }}>
      {view === "root" && (
        <>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12, letterSpacing: 6, color: "#a78bfa",
            fontWeight: 700,
          }}>
            ◈ PAUSED
          </div>
          <div style={{
            fontFamily: '"Inter", sans-serif',
            fontSize: 26, fontWeight: 800, color: "#fff",
            marginBottom: 14,
          }}>
            Arena suspended
          </div>
          <PauseButton onClick={onClose}>Resume</PauseButton>
          <PauseButton onClick={() => setView("settings")} ghost>Settings</PauseButton>
          <PauseButton onClick={onQuit} danger>Quit match</PauseButton>
          <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 2 }}>
            ESC TO RESUME
          </div>
        </>
      )}
      {view === "settings" && (
        <SettingsPanel
          settings={settings}
          onChange={apply}
          onBack={() => setView("root")}
        />
      )}
    </div>
  );
}

function PauseButton({ children, onClick, ghost, danger }) {
  return (
    <button onClick={onClick} style={{
      width: 260, padding: "14px 0",
      borderRadius: 6,
      background: danger ? "linear-gradient(135deg, rgba(244,63,94,0.25), rgba(220,38,38,0.25))"
                : ghost ? "transparent"
                        : "linear-gradient(135deg, #a78bfa, #f472b6)",
      border: danger ? "1px solid rgba(244,63,94,0.6)"
            : ghost  ? "1px solid rgba(255,255,255,0.18)"
                     : "none",
      color: "#fff",
      fontFamily: '"Inter", sans-serif',
      fontSize: 13, fontWeight: 800, letterSpacing: 4,
      textTransform: "uppercase", cursor: "pointer",
    }}>
      {children}
    </button>
  );
}

// ── P1-5: SettingsPanel ────────────────────────────────────────────
function SettingsPanel({ settings, onChange, onBack }) {
  const row = (label, child) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, width: 380 }}>
      <span style={{
        fontSize: 11, letterSpacing: 2, color: "rgba(255,255,255,0.65)",
        fontFamily: '"JetBrains Mono", monospace',
        textTransform: "uppercase", fontWeight: 700,
      }}>{label}</span>
      <div style={{ flex: 1, maxWidth: 240 }}>{child}</div>
    </div>
  );
  const slider = (key, min, max, step, suffix = "") => (
    <div>
      <input
        type="range" min={min} max={max} step={step}
        value={settings[key]}
        onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })}
        style={{ width: "100%", accentColor: "#a78bfa" }}
      />
      <div style={{ fontSize: 11, color: "#fff", fontFamily: '"JetBrains Mono", monospace', textAlign: "right" }}>
        {settings[key]}{suffix}
      </div>
    </div>
  );
  const segmented = (key, options) => (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((o) => (
        <button key={o.value}
          onClick={() => onChange({ ...settings, [key]: o.value })}
          style={{
            flex: 1, padding: "8px 4px",
            background: settings[key] === o.value ? "linear-gradient(135deg, #a78bfa, #f472b6)" : "transparent",
            border: settings[key] === o.value ? "none" : "1px solid rgba(255,255,255,0.15)",
            color: "#fff", borderRadius: 4,
            fontSize: 10, fontWeight: 800, letterSpacing: 1, cursor: "pointer",
          }}
        >{o.label}</button>
      ))}
    </div>
  );

  return (
    <>
      <div style={{ fontSize: 12, letterSpacing: 6, color: "#a78bfa", fontWeight: 700 }}>◈ SETTINGS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 8 }}>
        {row("MOUSE SENS", slider("sensitivity", 0.4, 2.0, 0.05, "×"))}
        {row("FIELD OF VIEW", slider("fov", 60, 110, 1, "°"))}
        {row("MASTER VOLUME", slider("volume", 0, 100, 5, "%"))}
        {row("ANNOUNCER", segmented("announcer", [
          { value: "off", label: "OFF" }, { value: "on", label: "ON" },
        ]))}
        {row("PERFORMANCE", segmented("performance", [
          { value: "low",    label: "LOW" },
          { value: "medium", label: "MED" },
          { value: "high",   label: "HIGH" },
        ]))}
      </div>
      <PauseButton onClick={onBack} ghost>Back</PauseButton>
    </>
  );
}
