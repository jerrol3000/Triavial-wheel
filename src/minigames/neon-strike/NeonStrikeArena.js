// NeonStrikeArena — React wrapper + HUD.
//
// Owns:
//   • The DOM container for the WebGL canvas
//   • The HUD overlay (crosshair / health / ammo / score / timer /
//     kill feed)
//   • Hit markers + floating damage numbers (P1-1)
//   • Mobile touch controls (P1-3, hidden on desktop)
//   • Pause menu + settings (P1-4 + P1-5)
//   • Minimap (P1-6)
//   • Scoreboard (P1-7, TAB-toggle)
//
// HUD throttle: state samples engine.hudRef every 50ms instead of
// re-rendering on every Engine tick — avoids React reconciliation
// overhead.

import React, { useEffect, useRef, useState } from "react";
import { Engine } from "./Engine.js";
import MobileControls from "./MobileControls.js";
import PauseMenu from "./PauseMenu.js";
import Minimap from "./Minimap.js";
import { loadSettings, applySettingsToEngine } from "./settings.js";

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
  const [feed, setFeed] = useState([]);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  // Surface engine-construction errors instead of silently failing —
  // a blank canvas with no message is the worst possible UX. If
  // WebGL is unsupported or the engine throws, the user gets a
  // diagnostic + a "Skip" button that submits a 0 score.
  const [engineError, setEngineError] = useState(null);
  // P1-1: hit marker flash + active damage numbers.
  const [hitFlash, setHitFlash] = useState(null); // { at, headshot, kill }
  const [damageNumbers, setDamageNumbers] = useState([]); // [{id, x, y, amount, headshot, kill, born}]
  const dmgIdRef = useRef(1);
  const submittedRef = useRef(false);

  // HUD rerender throttle
  useEffect(() => {
    const id = setInterval(() => setHud({ ...hudRef.current }), 50);
    return () => clearInterval(id);
  }, []);

  // P1-7: TAB-hold scoreboard.
  useEffect(() => {
    const down = (e) => { if (e.code === "Tab") { e.preventDefault(); setScoreboardOpen(true); } };
    const up = (e) => { if (e.code === "Tab") setScoreboardOpen(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Mount Engine. Wrapped in try/catch so we always surface errors
  // to the player — better than a blank screen.
  useEffect(() => {
    if (!containerRef.current) return;
    // Quick WebGL2 / WebGL feature check so an unsupported browser
    // shows a clear message instead of a silent black canvas.
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!gl) throw new Error("WebGL not supported by this browser");
    } catch (probeErr) {
      setEngineError(probeErr.message || "WebGL probe failed");
      return;
    }
    let engine;
    try {
      engine = new Engine(containerRef.current, {
      durationMs: 90000,
      onHudUpdate: (s) => { hudRef.current = s; },
      onKillFeed: (item) => {
        setFeed((prev) => {
          const next = [...prev, { ...item, at: Date.now() }];
          return next.slice(-6);
        });
      },
      onHitConfirmed: (info) => {
        // P1-1: brief center-screen X reticle flash.
        setHitFlash({ ...info, at: Date.now() });
      },
      onDamageNumber: ({ worldPos, amount, headshot, kill }) => {
        // Project to screen coords and queue a floating-text entry.
        const screen = engine.worldToScreen(worldPos);
        if (!screen) return;
        const id = dmgIdRef.current++;
        setDamageNumbers((prev) => [
          ...prev,
          { id, x: screen.x, y: screen.y, amount, headshot, kill, born: Date.now() },
        ].slice(-12)); // cap at 12 simultaneous
      },
      onMatchEnd: (final) => {
        if (submittedRef.current) return;
        submittedRef.current = true;
        const score = Math.min(200, final.kills * 10 + final.best_streak * 5);
        setTimeout(() => onComplete({ score }), 1500);
      },
    });
    } catch (err) {
      console.error("[NSA] engine construction failed:", err);
      setEngineError(String(err?.message || err));
      return;
    }
    engineRef.current = engine;
    // Apply persisted settings on mount.
    try { applySettingsToEngine(engine, loadSettings()); } catch (e) {}

    // Cleanup of stale kill-feed + damage-number entries.
    const cleanup = setInterval(() => {
      const now = Date.now();
      setFeed((prev) => prev.filter((f) => now - f.at < 4000));
      setDamageNumbers((prev) => prev.filter((d) => now - d.born < 900));
    }, 250);
    return () => {
      clearInterval(cleanup);
      try { engine.destroy(); } catch (e) {}
    };
  }, [onComplete]);

  // P1-1: clear the hit-flash after ~140ms.
  useEffect(() => {
    if (!hitFlash) return;
    const t = setTimeout(() => setHitFlash(null), 160);
    return () => clearTimeout(t);
  }, [hitFlash]);

  const beginMatch = () => {
    if (!engineRef.current) return;
    setStarted(true);
    engineRef.current.start();
    setTimeout(() => engineRef.current.controls.lock(), 50);
  };

  const handleQuit = () => {
    setPaused(false);
    if (engineRef.current && !submittedRef.current) {
      submittedRef.current = true;
      const s = engineRef.current.state;
      const score = Math.min(200, s.kills * 10 + s.best_streak * 5);
      onComplete({ score });
    }
  };

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
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Engine-construction error overlay — visible diagnostic so a
          blank arena doesn't strand the player. */}
      {engineError && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: "rgba(5,6,14,0.95)", padding: 24, gap: 12,
          fontFamily: '"JetBrains Mono", monospace',
          textAlign: "center", color: "#fda4af",
        }}>
          <div style={{ fontSize: 38, lineHeight: 1 }}>⚠️</div>
          <div style={{ fontSize: 14, letterSpacing: 4, fontWeight: 700 }}>
            ENGINE FAILED TO LOAD
          </div>
          <div style={{ fontSize: 12, maxWidth: 420, color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
            {engineError}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>
            Try a different browser, disable browser extensions, or
            reload the page. If you're on Safari, ensure WebGL2 is
            enabled (Settings → Develop → Experimental Features).
          </div>
          <button
            onClick={() => {
              if (submittedRef.current) return;
              submittedRef.current = true;
              onComplete({ score: 0 });
            }}
            style={{
              marginTop: 14, padding: "10px 28px", borderRadius: 6,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff", cursor: "pointer",
              fontFamily: '"Inter", sans-serif',
              fontSize: 12, fontWeight: 800, letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >Skip game</button>
        </div>
      )}

      {/* Pre-match start panel */}
      {!started && !engineError && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: "rgba(5,6,14,0.92)", padding: 24,
        }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12, letterSpacing: 6, color: "#a78bfa",
            fontWeight: 700, marginBottom: 6,
          }}>◈ NEON STRIKE ARENA</div>
          <div style={{
            fontFamily: '"Inter", sans-serif',
            fontSize: 28, fontWeight: 800,
            background: "linear-gradient(135deg, #a78bfa, #f472b6, #22d3ee)",
            WebkitBackgroundClip: "text", color: "transparent",
            marginBottom: 14, textAlign: "center",
          }}>90-Second Cyber Arena</div>
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
            <span style={{ color: "#a78bfa" }}>MOUSE</span><span>look + click fire</span>
            <span style={{ color: "#a78bfa" }}>SHIFT</span><span>sprint</span>
            <span style={{ color: "#a78bfa" }}>SPACE</span><span>jump (×2)</span>
            <span style={{ color: "#a78bfa" }}>E</span><span>air dash</span>
            <span style={{ color: "#a78bfa" }}>F</span><span>slide</span>
            <span style={{ color: "#a78bfa" }}>R</span><span>reload</span>
            <span style={{ color: "#a78bfa" }}>TAB</span><span>scoreboard (hold)</span>
            <span style={{ color: "#a78bfa" }}>ESC</span><span>pause + settings</span>
            <span style={{ color: "#f472b6" }}>Q</span>
            <span style={{ color: "#f472b6" }}>ENERGY SHIFT — phase through walls</span>
          </div>
          <button onClick={beginMatch} style={{
            padding: "14px 40px", borderRadius: 8,
            background: "linear-gradient(135deg, #a78bfa, #f472b6)",
            border: "none", color: "#fff",
            fontFamily: '"Inter", sans-serif',
            fontSize: 14, fontWeight: 800, letterSpacing: 4,
            textTransform: "uppercase", cursor: "pointer",
            boxShadow: "0 0 28px rgba(167,139,250,0.5)",
          }}>ENTER ARENA</button>
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
          {/* Crosshair + hit marker (P1-1) */}
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
          {hitFlash && (
            <HitMarker headshot={hitFlash.headshot} kill={hitFlash.kill} />
          )}

          {/* Damage numbers (P1-1) */}
          {damageNumbers.map((d) => (
            <DamageNumber key={d.id} d={d} />
          ))}

          {/* Top HUD: timer + score + streak */}
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
            }}>{hud.score}</div>
            {hud.streak > 1 && (
              <div style={{
                padding: "6px 14px",
                background: "linear-gradient(135deg, rgba(244,114,182,0.25), rgba(167,139,250,0.25))",
                border: "1px solid rgba(244,114,182,0.5)",
                borderRadius: 6,
                fontSize: 14, fontWeight: 800,
                animation: "tw-combo-pulse 0.9s ease-in-out infinite",
              }}>×{hud.streak} STREAK</div>
            )}
          </div>

          {/* Bottom-left: health + energy */}
          <div style={{
            position: "absolute", left: 16, bottom: 16,
            display: "flex", flexDirection: "column", gap: 6, width: 200,
          }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.6)" }}>
                HEALTH · {hud.health}
              </div>
              <div style={{
                width: "100%", height: 8, background: "rgba(255,255,255,0.06)",
                borderRadius: 4, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)",
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
                width: "100%", height: 8, background: "rgba(255,255,255,0.06)",
                borderRadius: 4, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)",
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
          <div style={{ position: "absolute", right: 16, bottom: 16, textAlign: "right" }}>
            <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.6)" }}>
              PLASMA · MK {hud.weaponLevel}
            </div>
            <div style={{
              fontSize: 32, fontWeight: 800,
              color: hud.reloading ? "#fda4af" : "#fff",
              textShadow: "0 0 14px rgba(167,139,250,0.5)",
            }}>{ammoStr}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
              {hud.weaponKills}/3 to evolve
            </div>
          </div>

          {/* Top-right: kill feed */}
          <div style={{
            position: "absolute", right: 16, top: 16,
            display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", maxWidth: 280,
          }}>
            {feed.map((f, i) => (
              <div key={f.at + "-" + i} style={{
                padding: "4px 10px",
                background: "rgba(10,15,30,0.7)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
                fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.9)",
                display: "flex", gap: 6, alignItems: "center",
              }}>
                <span style={{ color: f.killer === "you" ? "#a78bfa" : "#fda4af" }}>{f.killer}</span>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>{f.headshot ? "[HEADSHOT]" : "→"}</span>
                <span style={{ color: f.victim === "you" ? "#fda4af" : "#fff" }}>{f.victim}</span>
              </div>
            ))}
          </div>

          {/* Damage vignette overlay */}
          {hud.health < 30 && (
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(circle, transparent 50%, rgba(239,68,68,0.45) 100%)",
              pointerEvents: "none",
              animation: "tw-shake 0.5s ease-in-out infinite",
            }} />
          )}

          {/* Minimap (P1-6) */}
          <Minimap engine={engineRef.current} />

          {/* Mobile touch controls (P1-3) */}
          <MobileControls engine={engineRef.current} visible={started && !paused} />

          {/* Scoreboard (P1-7) */}
          {scoreboardOpen && (
            <Scoreboard hud={hud} engine={engineRef.current} />
          )}
        </div>
      )}

      {/* Pause menu (P1-4 + P1-5) */}
      {started && (
        <PauseMenu
          engine={engineRef.current}
          open={paused}
          onClose={(arg) => setPaused(arg === "open" ? true : false)}
          onQuit={handleQuit}
        />
      )}
    </div>
  );
}

// ── P1-1: Hit marker — animated X reticle around the crosshair ────
function HitMarker({ headshot, kill }) {
  const color = kill ? "#fbbf24" : headshot ? "#f472b6" : "#ffffff";
  return (
    <div style={{
      position: "absolute", left: "50%", top: "50%",
      transform: "translate(-50%, -50%)",
      width: 40, height: 40,
      pointerEvents: "none",
      animation: "nsa-hit-marker 160ms ease-out forwards",
    }}>
      {[0, 90, 180, 270].map((rot) => (
        <div key={rot} style={{
          position: "absolute", left: "50%", top: "50%",
          width: 2, height: 10,
          background: color,
          boxShadow: `0 0 6px ${color}`,
          transformOrigin: "50% 18px",
          transform: `translate(-50%, -50%) rotate(${rot + 45}deg) translateY(-12px)`,
        }} />
      ))}
      <style>{`
        @keyframes nsa-hit-marker {
          0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 1; }
          50%  { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1.0); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── P1-1: floating damage number that drifts up + fades ───────────
function DamageNumber({ d }) {
  const age = Math.max(0, (Date.now() - d.born) / 900);
  const y = d.y - age * 60;
  const opacity = 1 - age;
  const scale = d.kill ? 1.4 : d.headshot ? 1.25 : 1.0;
  const color = d.kill ? "#fbbf24" : d.headshot ? "#f472b6" : "#fff";
  return (
    <div style={{
      position: "absolute",
      left: d.x, top: y,
      transform: `translate(-50%, -50%) scale(${scale})`,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 16, fontWeight: 800,
      color, textShadow: `0 0 8px ${color}, 0 2px 4px rgba(0,0,0,0.6)`,
      opacity, pointerEvents: "none",
      transition: "top 50ms linear, opacity 50ms linear",
    }}>
      {d.headshot ? "‼" : ""}{d.amount}
    </div>
  );
}

// ── P1-7: Scoreboard ──────────────────────────────────────────────
function Scoreboard({ hud, engine }) {
  if (!engine) return null;
  const bots = engine.bots || [];
  const rows = [
    { name: "YOU",
      kills: hud.kills, deaths: hud.deaths, score: hud.score,
      best_streak: hud.best_streak,
      isMe: true,
    },
    ...bots.map((b) => ({
      name: b.name,
      kills: b.killsSinceMatch || 0,
      deaths: b.deathsSinceMatch || 0,
      score: 0,
      best_streak: 0,
      personality: b.personalityName,
    })),
  ];
  rows.sort((a, b) => b.score - a.score || b.kills - a.kills);
  return (
    <div style={{
      position: "absolute", left: "50%", top: "50%",
      transform: "translate(-50%, -50%)",
      minWidth: 360,
      background: "rgba(5,6,14,0.92)",
      border: "1px solid rgba(167,139,250,0.5)",
      borderRadius: 8,
      padding: 16,
      fontFamily: '"JetBrains Mono", monospace',
      color: "#fff",
    }}>
      <div style={{
        fontSize: 11, letterSpacing: 4, color: "#a78bfa",
        marginBottom: 12, fontWeight: 700, textAlign: "center",
      }}>◈ SCOREBOARD</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, letterSpacing: 2 }}>
            <th style={{ textAlign: "left", padding: "4px 8px" }}>PLAYER</th>
            <th style={{ textAlign: "right", padding: "4px 8px" }}>K</th>
            <th style={{ textAlign: "right", padding: "4px 8px" }}>D</th>
            <th style={{ textAlign: "right", padding: "4px 8px" }}>SCORE</th>
            <th style={{ textAlign: "right", padding: "4px 8px" }}>BEST</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name + i} style={{
              background: r.isMe ? "rgba(167,139,250,0.12)" : "transparent",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}>
              <td style={{
                padding: "6px 8px",
                color: r.isMe ? "#a78bfa" :
                       r.personality === "AGGRO"  ? "#f472b6" :
                       r.personality === "SNIPER" ? "#22d3ee" :
                       r.personality === "FLANKER"? "#fbbf24" : "#fff",
                fontWeight: 700,
              }}>{r.name}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.kills}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: "rgba(255,255,255,0.6)" }}>{r.deaths}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{r.score}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: "rgba(255,255,255,0.7)" }}>×{r.best_streak}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{
        marginTop: 10, fontSize: 9, color: "rgba(255,255,255,0.35)",
        letterSpacing: 2, textAlign: "center",
      }}>HOLD TAB</div>
    </div>
  );
}
