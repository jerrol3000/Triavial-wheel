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
import { MODES } from "./modes/index.js";
import { WEAPON_ORDER } from "./weapons/index.js";

export default function NeonStrikeArena({ onComplete, seed }) {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const hudRef = useRef({
    health: 100, maxHealth: 100, ammo: 24, maxAmmo: 24,
    score: 0, kills: 0, streak: 0, weaponLevel: 1, weaponKills: 0,
    energy: 100, shifting: false, time_remaining_ms: 90000, ended: false,
    reloading: false,
    // P3: weapon name + alt-fire label populated by the active weapon.
    weaponId: "plasma", weaponName: "PLASMA", weaponIcon: "✦",
    altLabel: "BURST",
    // P2: wave-mode HUD fields. Ignored by other modes.
    wave: 0, intermission: false,
  });
  const [hud, setHud] = useState(hudRef.current);
  const [feed, setFeed] = useState([]);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  // P2-1 + P2-6: pre-match mode + difficulty selectors.
  const [selectedMode, setSelectedMode] = useState("arena");
  const [selectedDiff, setSelectedDiff] = useState("normal");
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
  // Onboarding tooltip — shown for the first ~5s after match start
  // so the player knows what they're doing.
  const [showOnboarding, setShowOnboarding] = useState(false);

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

  // Mount-only effect: WebGL probe + kill-feed/damage-number GC.
  // Engine construction is DEFERRED to beginMatch() so the player can
  // freely switch mode/difficulty in the pre-match picker without
  // thrashing the WebGL context every change.
  useEffect(() => {
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!gl) throw new Error("WebGL not supported by this browser");
    } catch (probeErr) {
      setEngineError(probeErr.message || "WebGL probe failed");
    }
    const cleanup = setInterval(() => {
      const now = Date.now();
      setFeed((prev) => prev.filter((f) => now - f.at < 4000));
      setDamageNumbers((prev) => prev.filter((d) => now - d.born < 900));
    }, 250);
    return () => {
      clearInterval(cleanup);
      try { engineRef.current?.destroy(); } catch (e) {}
      engineRef.current = null;
    };
  }, []);

  // P1-1: clear the hit-flash after ~140ms.
  useEffect(() => {
    if (!hitFlash) return;
    const t = setTimeout(() => setHitFlash(null), 160);
    return () => clearTimeout(t);
  }, [hitFlash]);

  const beginMatch = () => {
    if (engineRef.current || engineError || !containerRef.current) return;
    let engine;
    try {
      engine = new Engine(containerRef.current, {
        modeId: selectedMode,
        difficulty: selectedDiff,
        durationMs: 90000,
        onHudUpdate: (s) => { hudRef.current = s; },
        onKillFeed: (item) => {
          setFeed((prev) => {
            const next = [...prev, { ...item, at: Date.now() }];
            return next.slice(-6);
          });
        },
        onHitConfirmed: (info) => {
          setHitFlash({ ...info, at: Date.now() });
        },
        onDamageNumber: ({ worldPos, amount, headshot, kill }) => {
          const screen = engine.worldToScreen(worldPos);
          if (!screen) return;
          const id = dmgIdRef.current++;
          setDamageNumbers((prev) => [
            ...prev,
            { id, x: screen.x, y: screen.y, amount, headshot, kill, born: Date.now() },
          ].slice(-12));
        },
        onMatchEnd: (final) => {
          if (submittedRef.current) return;
          submittedRef.current = true;
          // Per-mode final-score computation (mode.computeFinalScore)
          // takes precedence over the legacy arena formula.
          const score = final.finalScore ?? Math.min(200, final.kills * 10 + (final.best_streak || 0) * 5);
          setTimeout(() => onComplete({ score }), 1500);
        },
      });
    } catch (err) {
      console.error("[NSA] engine construction failed:", err);
      setEngineError(String(err?.message || err));
      return;
    }
    engineRef.current = engine;
    try { applySettingsToEngine(engine, loadSettings()); } catch (e) {}
    setStarted(true);
    setShowOnboarding(true);
    setTimeout(() => setShowOnboarding(false), 5500);
    engine.start();
    setTimeout(() => engine.controls?.lock?.(), 50);
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
          background: "rgba(5,6,14,0.92)", padding: 24, overflowY: "auto",
        }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12, letterSpacing: 6, color: "#a78bfa",
            fontWeight: 700, marginBottom: 6,
          }}>◈ NEON STRIKE ARENA</div>
          <div style={{
            fontFamily: '"Inter", sans-serif',
            fontSize: 26, fontWeight: 800,
            background: "linear-gradient(135deg, #a78bfa, #f472b6, #22d3ee)",
            WebkitBackgroundClip: "text", color: "transparent",
            marginBottom: 4, textAlign: "center",
          }}>{MODES[selectedMode]?.name || "ARENA"}</div>
          <div style={{
            color: "rgba(255,255,255,0.6)", fontSize: 12,
            maxWidth: 460, textAlign: "center", marginBottom: 18, lineHeight: 1.55,
          }}>{MODES[selectedMode]?.tagline}</div>

          {/* Mode picker */}
          <div style={{
            display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap",
            justifyContent: "center",
          }}>
            {Object.values(MODES).map((m) => {
              const active = m.id === selectedMode;
              return (
                <button key={m.id} onClick={() => setSelectedMode(m.id)} style={{
                  padding: "8px 18px", borderRadius: 6,
                  background: active
                    ? "linear-gradient(135deg, rgba(167,139,250,0.35), rgba(244,114,182,0.35))"
                    : "rgba(255,255,255,0.04)",
                  border: active ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,0.12)",
                  color: active ? "#fff" : "rgba(255,255,255,0.7)",
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 11, fontWeight: 700, letterSpacing: 3,
                  cursor: "pointer",
                  boxShadow: active ? "0 0 12px rgba(167,139,250,0.45)" : "none",
                }}>{m.name}</button>
              );
            })}
          </div>

          {/* Difficulty selector */}
          <div style={{
            display: "flex", gap: 6, marginBottom: 20, alignItems: "center",
          }}>
            <span style={{
              fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,0.45)",
              fontFamily: '"JetBrains Mono", monospace',
              marginRight: 4,
            }}>DIFFICULTY</span>
            {["easy", "normal", "hard"].map((d) => {
              const active = d === selectedDiff;
              const accent = d === "easy" ? "#34d399" : d === "hard" ? "#fda4af" : "#a78bfa";
              return (
                <button key={d} onClick={() => setSelectedDiff(d)} style={{
                  padding: "5px 12px", borderRadius: 4,
                  background: active ? `${accent}25` : "rgba(255,255,255,0.04)",
                  border: active ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.1)",
                  color: active ? accent : "rgba(255,255,255,0.6)",
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10, fontWeight: 700, letterSpacing: 2,
                  textTransform: "uppercase", cursor: "pointer",
                }}>{d}</button>
              );
            })}
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "auto 1fr",
            gap: "3px 14px",
            fontSize: 10, color: "rgba(255,255,255,0.65)",
            fontFamily: '"JetBrains Mono", monospace',
            marginBottom: 18,
          }}>
            <span style={{ color: "#a78bfa" }}>WASD</span><span>move</span>
            <span style={{ color: "#a78bfa" }}>MOUSE L/R</span><span>fire / alt-fire</span>
            <span style={{ color: "#a78bfa" }}>1-7 · SCROLL</span><span>weapon swap</span>
            <span style={{ color: "#a78bfa" }}>SHIFT · SPACE · E · F</span><span>sprint / jump / dash / slide</span>
            <span style={{ color: "#a78bfa" }}>R · TAB · ESC</span><span>reload / scoreboard / pause</span>
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

          {/* Bottom-center: PROMINENT weapon panel — large icon + name +
              ammo. Guaranteed visible regardless of WebGL/viewmodel
              state. This is the primary "what am I holding" indicator;
              the 3D viewmodel is supplemental. */}
          <WeaponPanel hud={hud} ammoStr={ammoStr} />

          {/* Wave-mode banner — top-left under timer. */}
          {hud.wave > 0 && (
            <div style={{
              position: "absolute", top: 64, left: "50%",
              transform: "translateX(-50%)",
              padding: "5px 14px",
              background: hud.intermission
                ? "linear-gradient(135deg, rgba(52,211,153,0.25), rgba(34,211,238,0.25))"
                : "rgba(10,15,30,0.7)",
              border: hud.intermission
                ? "1px solid rgba(52,211,153,0.5)"
                : "1px solid rgba(244,114,182,0.4)",
              borderRadius: 6,
              fontSize: 11, letterSpacing: 4, fontWeight: 800,
              color: hud.intermission ? "#34d399" : "#f472b6",
            }}>
              {hud.intermission ? "WAVE COMPLETE" : `WAVE ${hud.wave}`}
            </div>
          )}

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

          {/* Directional damage indicator — red arc pointing at the
              source of incoming fire. Without this the player has no
              way to find their attacker. */}
          <DamageDirection angle={hud.damageAngle} at={hud.damageAt} />

          {/* Onboarding tooltip — shown for the first ~5s of the
              match so a brand-new player knows what to do. */}
          {showOnboarding && (
            <div style={{
              position: "absolute", left: "50%", top: "62%",
              transform: "translate(-50%, -50%)",
              maxWidth: 480, padding: "12px 22px",
              background: "rgba(5,6,14,0.78)",
              border: "1px solid rgba(167,139,250,0.45)",
              borderRadius: 8,
              boxShadow: "0 0 24px rgba(167,139,250,0.25)",
              color: "#fff",
              textAlign: "center",
              animation: "nsa-fade-in 0.4s ease-out",
            }}>
              <div style={{
                fontSize: 10, letterSpacing: 4, color: "#a78bfa",
                fontWeight: 700, marginBottom: 6,
              }}>◈ READY</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                Click to lock cursor · LEFT-CLICK to fire
              </div>
              <div style={{
                fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.5,
              }}>
                RIGHT-CLICK = alt-fire · R = reload · Q = phase-shift
                <br />
                Look for colored capsules on the floor — pick up new weapons
              </div>
              <style>{`
                @keyframes nsa-fade-in {
                  from { opacity: 0; transform: translate(-50%, -45%); }
                  to   { opacity: 1; transform: translate(-50%, -50%); }
                }
              `}</style>
            </div>
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

// ── Prominent weapon panel ────────────────────────────────────────
// Bottom-center HUD element showing the player's currently-equipped
// weapon as a big icon + name + ammo bar. This is the GUARANTEED
// visibility path — even if the 3D viewmodel fails to render for any
// reason (FOV clip, GL context loss, browser quirk), the player can
// always look down at this panel and see what they're holding.
const WEAPON_COLOR = {
  plasma:  "#a78bfa", smg:    "#34d399", shotgun: "#f472b6", sniper:  "#c084fc",
  railgun: "#22d3ee", gravity: "#60a5fa", pistol:  "#fbbf24",
};
function WeaponPanel({ hud, ammoStr }) {
  const accent = WEAPON_COLOR[hud.weaponId] || "#a78bfa";
  const ammoPct = hud.maxAmmo > 0 ? Math.max(0, Math.min(100, (hud.ammo / hud.maxAmmo) * 100)) : 100;
  return (
    <div style={{
      position: "absolute",
      left: "50%", bottom: 18,
      transform: "translateX(-50%)",
      display: "flex", alignItems: "center", gap: 14,
      padding: "10px 18px",
      background: "rgba(5,6,14,0.78)",
      border: `1px solid ${accent}`,
      borderRadius: 10,
      boxShadow: `0 0 24px ${accent}40, inset 0 0 20px rgba(0,0,0,0.4)`,
      pointerEvents: "none",
      fontFamily: '"JetBrains Mono", monospace',
    }}>
      {/* Big weapon icon */}
      <div style={{
        width: 52, height: 52,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `radial-gradient(circle, ${accent}40 0%, transparent 70%)`,
        border: `1.5px solid ${accent}`,
        borderRadius: 8,
        fontSize: 28,
        color: accent,
        textShadow: `0 0 12px ${accent}`,
        fontWeight: 800,
      }}>
        {hud.weaponIcon || "✦"}
      </div>
      {/* Name + ammo */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 130 }}>
        <div style={{
          fontSize: 13, fontWeight: 800, color: "#fff",
          letterSpacing: 3,
          textShadow: `0 0 8px ${accent}`,
        }}>
          {hud.weaponName || "PLASMA"} <span style={{
            fontSize: 9, color: accent, letterSpacing: 2,
          }}>MK {hud.weaponLevel}</span>
        </div>
        {/* Ammo bar */}
        <div style={{
          width: "100%", height: 6,
          background: "rgba(255,255,255,0.08)",
          borderRadius: 3, overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.12)",
        }}>
          <div style={{
            width: hud.reloading ? "100%" : `${ammoPct}%`,
            height: "100%",
            background: hud.reloading
              ? "linear-gradient(90deg, #fda4af, #fbbf24)"
              : `linear-gradient(90deg, ${accent}, #fff)`,
            transition: "width 80ms",
            animation: hud.reloading ? "tw-combo-pulse 1s ease-in-out infinite" : "none",
          }} />
        </div>
        <div style={{
          fontSize: 11, fontWeight: 800,
          color: hud.reloading ? "#fda4af" : "#fff",
          letterSpacing: 2,
        }}>
          {ammoStr}
        </div>
      </div>
      {/* Alt-fire hint */}
      {hud.altLabel && hud.altLabel !== "—" && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 2,
          alignItems: "flex-start",
          paddingLeft: 12,
          borderLeft: `1px solid ${accent}50`,
        }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", letterSpacing: 2 }}>R-CLICK</div>
          <div style={{ fontSize: 11, color: accent, fontWeight: 700, letterSpacing: 1.5 }}>{hud.altLabel}</div>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            {hud.weaponKills}/3 EVOLVE
          </div>
        </div>
      )}
    </div>
  );
}

// ── Directional damage indicator ──────────────────────────────────
// Renders a red arc on the screen edge at the angle of the most
// recent attacker, relative to the camera forward. Fades over 1200ms.
function DamageDirection({ angle, at }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60);
    return () => clearInterval(id);
  }, []);
  if (!at) return null;
  const age = (Date.now() - at) / 1200;
  if (age >= 1) return null;
  const opacity = 1 - age;
  // Rotate so 0 = top of screen (attacker dead-ahead). Angle is in
  // radians where positive = attacker to your right. We rotate the
  // wrapper so the arc sits at that compass bearing.
  const deg = (angle * 180) / Math.PI;
  return (
    <div style={{
      position: "absolute", left: "50%", top: "50%",
      width: 1, height: 1,
      transform: `translate(-50%, -50%) rotate(${deg}deg)`,
      pointerEvents: "none",
    }}>
      <div style={{
        position: "absolute",
        left: "50%", top: -160,
        transform: "translateX(-50%)",
        width: 140, height: 40,
        background: "radial-gradient(ellipse at center, rgba(239,68,68,0.85) 0%, rgba(239,68,68,0.25) 60%, transparent 100%)",
        filter: "blur(2px)",
        opacity,
        borderRadius: "50%",
      }} />
      <div style={{
        position: "absolute",
        left: "50%", top: -115,
        transform: "translateX(-50%)",
        width: 0, height: 0,
        borderLeft: "10px solid transparent",
        borderRight: "10px solid transparent",
        borderBottom: "16px solid #ef4444",
        opacity,
        filter: "drop-shadow(0 0 6px rgba(239,68,68,0.9))",
      }} />
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
