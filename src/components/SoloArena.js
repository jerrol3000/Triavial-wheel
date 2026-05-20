// Solo Arena — single-player mini-game practice mode.
//
// The fix for the catastrophic zero-DAU problem: a new player opens
// the app, sees mini-games on TikTok, lands here, and can immediately
// play any of the 12 games against their own personal best — no
// opponent required, no waiting on matchmaking.
//
// Three views:
//   picker → grid of 12 games, each with "🏆 Best N" chip + the
//            global #1 score (later). Tap one to play.
//   play   → loads /solo/play (server returns {game_type, seed, meta}),
//            renders via the existing MiniGameRunner. Identical
//            component as VS / friend-challenge so any future
//            mini-game additions show up here automatically.
//   result → score + coin reward + PB celebration + Play Again
//            (same game) + Pick Another button.
//
// The economy: each game pays floor(score/max_score * 25) coins on
// completion. Perfect run = 25 coins. ~5-10 plays buys a cosmetic.
// No participation reward (0 score = 0 coins) so a bot scripting the
// endpoint with submit=0 forever earns nothing.

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api/client";
import { setView, pushToast } from "../store/uiSlice";
import { fetchStats } from "../store/statsSlice";
import { sfx } from "../utils/sound";
import { MiniGameRunner, GAMES, gameMeta } from "../minigames";
import { celebratePB, celebrateCombo } from "../minigames/_fx";
import { Recorder, shareGameplay, isRecordingSupported } from "../minigames/_recorder";
import { getActivePixiCanvas } from "../minigames/_pixi";

export default function SoloArena() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [mode, setMode] = useState("picker"); // picker | play | result
  const [bests, setBests] = useState({}); // { game_type: { best, plays } }
  const [currentGame, setCurrentGame] = useState(null); // { game_type, seed, meta }
  const [lastResult, setLastResult] = useState(null);
  const [busy, setBusy] = useState(false);
  // Recorder state: when a Pixi-rendered game starts, we begin
  // capturing its canvas at 30fps with a 10-sec sliding buffer. On
  // game end the buffer becomes a downloadable / shareable clip.
  // Falls back gracefully on browsers without MediaRecorder support
  // (older iOS, etc.) — no Share button shown in that case.
  const [clip, setClip] = useState(null); // Blob | null
  const recorderRef = useRef(null);

  const loadBests = useCallback(async () => {
    try {
      const r = await api.get("/stats/bests");
      setBests(r.data?.bests || {});
    } catch (e) {}
  }, []);
  useEffect(() => { if (user) loadBests(); }, [user, loadBests]);

  if (!user) {
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Solo Arena</div>
        <div style={{ color: "var(--text-dim)", marginBottom: 12 }}>Sign in to chase personal bests on every mini-game.</div>
        <button className="tw-btn block" onClick={() => dispatch(setView("home"))}>Back home</button>
      </div>
    );
  }

  const pickGame = async (gameType) => {
    if (busy) return;
    setBusy(true);
    sfx.click?.();
    setClip(null); // wipe any previous clip
    try {
      const r = await api.post("/solo/play", { game_type: gameType });
      setCurrentGame(r.data);
      setMode("play");
      // Start the recorder after a short delay so the Pixi canvas has
      // had time to mount and register itself via getActivePixiCanvas().
      // Only Pixi-backed games (Anomaly, Cascade, Surge) will have an
      // active canvas — others render via DOM and skip recording.
      if (isRecordingSupported()) {
        setTimeout(() => {
          const canvas = getActivePixiCanvas();
          if (!canvas) return;
          recorderRef.current = new Recorder();
          recorderRef.current.start(canvas);
        }, 500);
      }
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't start", text: "Try again." }));
    }
    setBusy(false);
  };

  const onGameComplete = async ({ score }) => {
    if (!currentGame) return;
    // Finalize the recorder before the canvas tears down — captures
    // the last ~10 seconds of gameplay as a Blob for sharing.
    if (recorderRef.current) {
      try {
        const blob = await recorderRef.current.stop();
        if (blob) setClip(blob);
      } catch (e) {}
      recorderRef.current = null;
    }
    try {
      const r = await api.post("/solo/submit", {
        game_type: currentGame.game_type,
        score: Number(score) || 0,
      });
      setLastResult({ ...r.data, game_type: currentGame.game_type, my_score: score });
      setMode("result");
      // Refresh stats so the coin pill updates instantly.
      dispatch(fetchStats());
      // Refresh bests for next picker render.
      loadBests();
      // Celebration toast + confetti shower on new PB. The
      // canvas-confetti burst is what makes PB beats feel like an
      // actual achievement instead of just a UI toast.
      if (r.data?.is_new_best) {
        sfx.win?.();
        celebratePB();
        dispatch(pushToast({
          icon: "🏆",
          title: "New personal best!",
          text: `${gameMeta(currentGame.game_type).name}: ${r.data.new_best}${r.data.prev_best > 0 ? ` (was ${r.data.prev_best})` : ""}`,
          duration: 4500,
        }));
      } else if (r.data?.coins_awarded >= 20) {
        // Big-but-not-PB run still gets a smaller celebration.
        celebrateCombo(3);
      }
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't submit", text: "Score may not have saved." }));
      setMode("result");
      setLastResult({ my_score: score, game_type: currentGame.game_type, coins_awarded: 0 });
    }
  };

  if (mode === "play" && currentGame) {
    const meta = gameMeta(currentGame.game_type);
    const myBest = bests[currentGame.game_type]?.best;
    return (
      <div className="tw-col">
        <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }}
                onClick={() => { setMode("picker"); setCurrentGame(null); }}>← Back</button>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>
            🎯 Solo · {meta.icon} {meta.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
            {myBest > 0 ? `🏆 Your best: ${myBest} — try to beat it!` : "First play — set a personal best."}
          </div>
        </div>
        <MiniGameRunner
          key={`${currentGame.game_type}-${currentGame.seed}`}
          game={{ type: currentGame.game_type, seed: currentGame.seed }}
          onComplete={onGameComplete}
        />
      </div>
    );
  }

  if (mode === "result" && lastResult) {
    const meta = gameMeta(lastResult.game_type);
    const isPB = lastResult.is_new_best;
    return (
      <div className="tw-col">
        <div className="tw-card" style={{ textAlign: "center", position: "relative", overflow: "hidden" }}>
          {isPB && (
            <div style={{
              position: "absolute", inset: -40,
              background: "radial-gradient(circle at top, rgba(245,158,11,0.45), transparent 60%)",
              pointerEvents: "none",
            }} />
          )}
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 56, lineHeight: 1, animation: "tw-bounce-in 0.6s ease-out" }}>
              {isPB ? "🏆" : "🎯"}
            </div>
            <div style={{ fontFamily: "Fredoka", fontSize: 24, fontWeight: 700, marginTop: 8 }}>
              {isPB ? "New personal best!" : "Nice run!"}
            </div>
            <div style={{ fontFamily: "Fredoka", fontSize: 16, fontWeight: 600, color: "var(--text-dim)", marginTop: 4 }}>
              {meta.icon} {meta.name}
            </div>

            <div className="tw-row" style={{ justifyContent: "space-around", marginTop: 18, gap: 14, alignItems: "stretch" }}>
              <div style={{ flex: 1, padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, letterSpacing: 1 }}>YOUR SCORE</div>
                <div style={{ fontFamily: "Fredoka", fontSize: 36, fontWeight: 800, color: "#fff" }}>{lastResult.score ?? lastResult.my_score ?? 0}</div>
              </div>
              <div style={{ flex: 1, padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, letterSpacing: 1 }}>BEST</div>
                <div style={{ fontFamily: "Fredoka", fontSize: 36, fontWeight: 800, color: isPB ? "#fbbf24" : "#fff" }}>{lastResult.new_best ?? lastResult.score ?? 0}</div>
              </div>
            </div>

            {lastResult.coins_awarded > 0 && (
              <div style={{
                marginTop: 14, padding: "10px 14px", borderRadius: 12,
                background: "linear-gradient(135deg, rgba(251,191,36,0.18), rgba(245,158,11,0.18))",
                border: "1px solid rgba(251,191,36,0.4)",
                fontFamily: "Fredoka", fontWeight: 700,
              }}>
                🪙 +{lastResult.coins_awarded} coins
              </div>
            )}

            <div className="tw-row" style={{ justifyContent: "center", marginTop: 14, gap: 8, flexWrap: "wrap" }}>
              <button className="tw-btn" onClick={() => pickGame(lastResult.game_type)}>🔁 Play again</button>
              {clip && (
                <button
                  className="tw-btn"
                  style={{ background: "linear-gradient(135deg, #f472b6, #a78bfa)", color: "#fff", border: "none", fontWeight: 700 }}
                  onClick={async () => {
                    const meta = gameMeta(lastResult.game_type);
                    const caption = `${meta.icon} ${meta.name} · ${lastResult.score ?? 0} pts on Spinlore Arena\nhttps://triviawheel.app`;
                    const r = await shareGameplay(clip, caption);
                    if (r.method === "download") {
                      dispatch(pushToast({ icon: "📥", title: "Clip downloaded", text: "Caption copied — paste it with the video." }));
                    } else if (r.method === "web_share") {
                      dispatch(pushToast({ icon: "📤", title: "Shared!" }));
                    }
                  }}
                >📹 Share clip</button>
              )}
              <button className="tw-btn ghost" onClick={() => { setMode("picker"); setCurrentGame(null); setLastResult(null); }}>Pick another</button>
              <button className="tw-btn ghost" onClick={() => dispatch(setView("home"))}>Home</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Picker
  const games = Object.keys(GAMES);
  return (
    <div className="tw-col">
      <style>{`
        @keyframes tw-bounce-in {
          0%   { transform: scale(0.3); opacity: 0; }
          60%  { transform: scale(1.18); opacity: 1; }
          80%  { transform: scale(0.94); }
          100% { transform: scale(1); }
        }
      `}</style>
      <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }}
              onClick={() => dispatch(setView("home"))}>← Back</button>

      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700 }}>🎯 Solo Arena</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
          Pick a mini-game. Beat your personal best. Earn coins per run.
        </div>
      </div>

      <div className="tw-card">
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 10,
        }}>
          {games.map((id) => {
            const m = GAMES[id];
            const pb = bests[id]?.best || 0;
            const plays = bests[id]?.plays || 0;
            return (
              <button key={id} onClick={() => pickGame(id)} disabled={busy}
                style={{
                  padding: 14, borderRadius: 14, cursor: "pointer",
                  background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
                  border: "1px solid rgba(255,255,255,0.1)",
                  textAlign: "center", color: "var(--text)",
                  fontFamily: "Fredoka", fontWeight: 600,
                  position: "relative", minHeight: 100,
                  transition: "transform 0.08s, background 0.15s, border-color 0.15s",
                }}
                onPointerDown={(e) => { e.currentTarget.style.transform = "scale(0.97)"; }}
                onPointerUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                onPointerLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
              >
                <div style={{ fontSize: 32 }}>{m.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{m.name}</div>
                {pb > 0 ? (
                  <div style={{
                    fontSize: 11, marginTop: 6, color: "#fbbf24", fontWeight: 700,
                  }}>🏆 {pb}</div>
                ) : (
                  <div style={{ fontSize: 11, marginTop: 6, color: "var(--text-dim)" }}>tap to play</div>
                )}
                {plays > 0 && (
                  <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
                    {plays} {plays === 1 ? "play" : "plays"}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="tw-card" style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
        Earn up to <strong style={{ color: "#fbbf24" }}>🪙 25 coins</strong> per run, scaled by your score.
        New personal bests trigger a celebration.
      </div>
    </div>
  );
}
