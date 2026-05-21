// NeonStrikeArena — React wrapper that mounts the Engine into a DOM
// container, owns the HUD overlay, and adapts the engine's lifecycle
// to the rest of the app's MiniGameRunner contract (calls
// onComplete({score}) on match end).
//
// HUD architecture:
//   • The Engine emits onHudUpdate(state) every frame. We mirror
//     that state into a React useState ref via requestAnimationFrame
//     batching so we don't re-render React on every frame — only on
//     every ~50ms tick. (Setting React state at 60Hz would tank
//     perf via reconciliation overhead.)
//   • Crosshair, health bar, ammo, score, weapon Mk, energy bar,
//     timer, kill feed all live as DOM/CSS overlays on top of the
//     WebGL canvas. Pointer events on the HUD pass through to the
//     canvas via pointer-events: none on the wrapper.

import React, { useEffect, useRef, useState } from "react";
import { Engine } from "./Engine.js";

export default function NeonStrikeArena({ onComplete, seed }) {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const hudRef = useRef({
    health: 100, maxHealth: 100, ammo: 24, maxAmmo: 24,
    score: 0, kills: 0, streak: 0, weaponLevel: 1, weaponKills: 0,
    energy: 100, shifting: false, time_remaining_ms: 90000, ended: false,
    reloading: false,
  });
  const [hud, setHud] = useState(hudRef.current);
  const [feed, setFeed] = useState([]); // [{killer,victim,headshot,at}]
  const [started, setStarted] = useState(false);
  const [pointerHelpVisible, setPointerHelpVisible] = useState(true);
  const submittedRef = useRef(false);

  // Throttle HUD rerenders to ~20Hz. Engine writes to hudRef every
  // frame; we sample it on an interval. Drastically reduces React
  // reconciliation cost compared to a per-frame setHud().
  useEffect(() => {
    const id = setInterval(() => {
      // Snapshot — shallow clone so React sees a new reference.
      setHud({ ...hudRef.current });
    }, 50);
    return () => clearInterval(id);
  }, []);

  // Mount Engine.
  useEffect(() => {
    if (!containerRef.current) return;
    const engine = new Engine(containerRef.current, {
      durationMs: 90000,
      onHudUpdate: (s) => { hudRef.current = s; },
      onKillFeed: (item) => {
        setFeed((prev) => {
          const next = [...prev, { ...item, at: Date.now() }];
          // Keep only the last 6 entries.
          return next.slice(-6);
        });
      },
      onMatchEnd: (final) => {
        if (submittedRef.current) return;
        submittedRef.current = true;
        // Score formula for the Spinlore Arena economy: kills × 10 +
        // best streak × 5, capped at the registry's max_score (200).
        const score = Math.min(200, final.kills * 10 + final.best_streak * 5);
        // Defer slightly so the announcer "MATCH COMPLETE" plays.
        setTimeout(() => onComplete({ score }), 1500);
      },
    });
    engineRef.current = engine;
    // Auto-clean kill feed entries after 4s.
    const cleanup = setInterval(() => {
      const now = Date.now();
      setFeed((prev) => prev.filter((f) => now - f.at < 4000));
    }, 600);
    return () => {
      clearInterval(cleanup);
      try { engine.destroy(); } catch (e) {}
    };
  }, [onComplete]);

  const beginMatch = () => {
    if (!engineRef.current) return;
    setStarted(true);
    setPointerHelpVisible(false);
    engineRef.current.start();
    // Request pointer lock on the canvas immediately so player can move + look.
    setTimeout(() => engineRef.current.controls.lock(), 50);
  };

  // ── HUD bits ─────────────────────────────────────────────────
  const timeSec = Math.ceil(hud.time_remaining_ms / 1000);
  const healthPct = (hud.health / hud.maxHealth) * 100;
  const energyPct = hud.energy;
  const ammoStr = hud.reloading ? "RELOADING" : `${hud.ammo}/${hud.maxAmmo}`;

  return (
    <div style={{
      position: "relative",
      width: "100%",
      height: "min(70vh, 540px)",
      background: "#05060e",
      borderRadius: 12,
      overflow: "hidden",
      border: "1px solid rgba(167,139,250,0.4)",
    }}>
      {/* WebGL canvas mount */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Pre-match start panel */}
      {!started && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: "rgba(5,6,14,0.92)",
          padding: 24,
        }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12, letterSpacing: 6, color: "#a78bfa",
            fontWeight: 700, marginBottom: 6,
          }}>
            ◈ NEON STRIKE ARENA
          </div>
          <div style={{
            fontFamily: '"Inter", sans-serif',
            fontSize: 28, fontWeight: 800,
            background: "linear-gradient(135deg, #a78bfa, #f472b6, #22d3ee)",
            WebkitBackgroundClip: "text", color: "transparent",
            marginBottom: 14, textAlign: "center",
          }}>
            90-Second Cyber Arena
          </div>
          <div style={{
            color: "rgba(255,255,255,0.6)", fontSize: 13,
            maxWidth: 460, textAlign: "center", marginBottom: 18, lineHeight: 1.6,
          }}>
            Three AI opponents. One arena. Phase between dimensions, dash
            through walls, and evolve your weapon by stacking kills.
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "auto 1fr",
            gap: "4px 14px",
            fontSize: 11, color: "rgba(255,255,255,0.7)",
            fontFamily: '"JetBrains Mono", monospace',
            marginBottom: 22,
          }}>
            <span style={{ color: "#a78bfa" }}>WASD</span><span>move</span>
            <span style={{ color: "#a78bfa" }}>MOUSE</span><span>look + click to fire</span>
            <span style={{ color: "#a78bfa" }}>SHIFT</span><span>sprint</span>
            <span style={{ color: "#a78bfa" }}>SPACE</span><span>jump (×2)</span>
            <span style={{ color: "#a78bfa" }}>E</span><span>air dash</span>
            <span style={{ color: "#a78bfa" }}>F</span><span>slide</span>
            <span style={{ color: "#a78bfa" }}>R</span><span>reload</span>
            <span style={{ color: "#f472b6", textShadow: "0 0 6px #f472b6" }}>Q</span>
            <span style={{ color: "#f472b6" }}>ENERGY SHIFT — phase through walls</span>
          </div>
          <button
            onClick={beginMatch}
            style={{
              padding: "14px 40px", borderRadius: 8,
              background: "linear-gradient(135deg, #a78bfa, #f472b6)",
              border: "none", color: "#fff",
              fontFamily: '"Inter", sans-serif',
              fontSize: 14, fontWeight: 800, letterSpacing: 4,
              textTransform: "uppercase", cursor: "pointer",
              boxShadow: "0 0 28px rgba(167,139,250,0.5)",
            }}
          >
            ENTER ARENA
          </button>
        </div>
      )}

      {/* Live HUD overlay */}
      {started && (
        <div style={{
          position: "absolute", inset: 0,
          pointerEvents: "none",
          color: "#fff",
          fontFamily: '"JetBrains Mono", monospace',
        }}>
          {/* Crosshair */}
          <div style={{
            position: "absolute", left: "50%", top: "50%",
            transform: "translate(-50%, -50%)",
            width: 18, height: 18,
            border: "1.5px solid rgba(255,255,255,0.7)",
            borderRadius: "50%",
          }}>
            <div style={{
              position: "absolute", left: "50%", top: "50%",
              transform: "translate(-50%, -50%)",
              width: 2, height: 2,
              background: "#a78bfa",
            }} />
          </div>

          {/* Top HUD: timer + score + kills */}
          <div style={{
            position: "absolute", top: 16, left: "50%",
            transform: "translateX(-50%)",
            display: "flex", gap: 18, alignItems: "center",
          }}>
            <div style={{
              padding: "6px 14px",
              background: "rgba(10,15,30,0.7)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              fontSize: 18, fontWeight: 800,
              color: timeSec < 10 ? "#fda4af" : "#fff",
            }}>
              {String(Math.floor(timeSec / 60))}:{String(timeSec % 60).padStart(2, "0")}
            </div>
            <div style={{
              padding: "6px 14px",
              background: "rgba(10,15,30,0.7)",
              border: "1px solid rgba(167,139,250,0.3)",
              borderRadius: 6,
              fontSize: 18, fontWeight: 800, color: "#a78bfa",
            }}>
              {hud.score}
            </div>
            {hud.streak > 1 && (
              <div style={{
                padding: "6px 14px",
                background: "linear-gradient(135deg, rgba(244,114,182,0.25), rgba(167,139,250,0.25))",
                border: "1px solid rgba(244,114,182,0.5)",
                borderRadius: 6,
                fontSize: 14, fontWeight: 800,
                animation: "tw-combo-pulse 0.9s ease-in-out infinite",
              }}>
                ×{hud.streak} STREAK
              </div>
            )}
          </div>

          {/* Bottom-left: health + energy bars */}
          <div style={{
            position: "absolute", left: 16, bottom: 16,
            display: "flex", flexDirection: "column", gap: 6,
            width: 200,
          }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.6)" }}>HEALTH · {hud.health}</div>
              <div style={{
                width: "100%", height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>
                <div style={{
                  width: `${healthPct}%`, height: "100%",
                  background: healthPct < 25 ? "linear-gradient(90deg, #ef4444, #f87171)"
                            : healthPct < 60 ? "linear-gradient(90deg, #fbbf24, #f59e0b)"
                                             : "linear-gradient(90deg, #34d399, #10b981)",
                  transition: "width 0.15s",
                }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.6)" }}>
                ENERGY · {Math.round(hud.energy)}{hud.shifting ? " · ⫷ SHIFTED" : ""}
              </div>
              <div style={{
                width: "100%", height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>
                <div style={{
                  width: `${energyPct}%`, height: "100%",
                  background: hud.shifting
                    ? "linear-gradient(90deg, #22d3ee, #a78bfa)"
                    : "linear-gradient(90deg, #a78bfa, #c084fc)",
                  transition: "width 0.1s",
                }} />
              </div>
            </div>
          </div>

          {/* Bottom-right: ammo + weapon Mk */}
          <div style={{
            position: "absolute", right: 16, bottom: 16,
            textAlign: "right",
          }}>
            <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.6)" }}>
              PLASMA · MK {hud.weaponLevel}
            </div>
            <div style={{
              fontSize: 32, fontWeight: 800,
              color: hud.reloading ? "#fda4af" : "#fff",
              textShadow: "0 0 14px rgba(167,139,250,0.5)",
            }}>
              {ammoStr}
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
              {hud.weaponKills}/3 to evolve
            </div>
          </div>

          {/* Top-right: kill feed */}
          <div style={{
            position: "absolute", right: 16, top: 16,
            display: "flex", flexDirection: "column", gap: 4,
            alignItems: "flex-end", maxWidth: 280,
          }}>
            {feed.map((f, i) => (
              <div key={f.at + "-" + i} style={{
                padding: "4px 10px",
                background: "rgba(10,15,30,0.7)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
                fontSize: 11, fontWeight: 700,
                color: "rgba(255,255,255,0.9)",
                display: "flex", gap: 6, alignItems: "center",
              }}>
                <span style={{ color: f.killer === "you" ? "#a78bfa" : "#fda4af" }}>{f.killer}</span>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>{f.headshot ? "[HEADSHOT]" : "→"}</span>
                <span style={{ color: f.victim === "you" ? "#fda4af" : "#fff" }}>{f.victim}</span>
              </div>
            ))}
          </div>

          {/* Damage vignette overlay — flashes red on low health */}
          {hud.health < 30 && (
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(circle, transparent 50%, rgba(239,68,68,0.45) 100%)",
              pointerEvents: "none",
              animation: "tw-shake 0.5s ease-in-out infinite",
            }} />
          )}
        </div>
      )}
    </div>
  );
}
