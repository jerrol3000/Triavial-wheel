import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { rt } from "../realtime/client";
import {
  setConnected, setWaiting, setRoom, setError, setMatchEnd,
  setReveal, setOpponentAnswered, setChatNotice, pushChat, pushReaction, leftRoom,
} from "../store/onlineSlice";
import { setView, setModal, pushToast } from "../store/uiSlice";
import { fetchStats } from "../store/statsSlice";
import ChatPanel from "./ChatPanel";
import Icon from "./Icon";
import { sfx } from "../utils/sound";
import { safeNavigate } from "../utils/navigate";

export default function Online() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const { connected, waiting, room, matchEnd, error, reveal, opponentAnswered, lastReaction } = useSelector((s) => s.online);

  // Bridge WS events → redux.
  useEffect(() => {
    if (!user) return;
    rt.connect();
    const off = rt.on((msg) => {
      switch (msg.type) {
        case "open":          dispatch(setConnected(true));  break;
        case "close":         dispatch(setConnected(false)); break;
        case "welcome":       /* server confirmed auth */    break;
        case "waiting":       dispatch(setWaiting(true));    break;
        case "queue_cancelled": dispatch(setWaiting(false)); break;
        case "match_found":   sfx.win(); dispatch(setRoom(msg.room)); break;
        case "room_state":    dispatch(setRoom(msg.room));   break;
        case "opponent_answered": dispatch(setOpponentAnswered(true)); break;
        case "round_reveal":  dispatch(setReveal(msg)); dispatch(setOpponentAnswered(false)); break;
        case "chat_message":  dispatch(pushChat(msg.message)); break;
        case "chat_filtered": dispatch(setChatNotice({ kind: "filtered", reason: msg.reason, at: Date.now() })); if (msg.autoMuted) dispatch(setChatNotice({ kind: "auto_muted", at: Date.now() })); break;
        case "chat_rate_limited": dispatch(setChatNotice({ kind: "rate", at: Date.now() })); break;
        case "chat_muted":    dispatch(setChatNotice({ kind: "muted", until: msg.until, at: Date.now() })); break;
        case "reaction":      dispatch(pushReaction({ ...msg, at: Date.now() })); setTimeout(() => dispatch(pushReaction(null)), 1500); break;
        case "match_end":     sfx.win(); dispatch(setMatchEnd(msg)); dispatch(fetchStats()); break;
        case "left_room": {
          dispatch(leftRoom());
          if (msg.skip && msg.skip.applied) {
            dispatch(pushToast({
              icon: "⚠️",
              title: "Skip penalty",
              text: `${msg.skip.rating_delta} rating (your daily free skip is used). Supporters get unlimited.`,
              duration: 4000,
            }));
            dispatch(fetchStats());
          }
          break;
        }
        case "kicked":        dispatch(pushToast({ icon: "⚠️", title: "Signed in elsewhere", text: "This tab was disconnected." })); dispatch(leftRoom()); break;
        case "error":         dispatch(setError(msg.error)); break;
      }
    });
    return () => { off(); };
  }, [user, dispatch]);

  if (!user) {
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Online play needs an account</div>
        <div style={{ color: "var(--text-dim)", marginBottom: 14 }}>Sign in to challenge friends and climb the global ranks.</div>
        <button className="tw-btn block" onClick={() => dispatch(setModal("auth"))}>Sign in / Create</button>
      </div>
    );
  }

  if (!room && !waiting) return <Lobby />;
  if (waiting) return <Queueing />;
  if (matchEnd) return <MatchEnd />;
  return <LiveMatch />;
}

// ─── Lobby ──────────────────────────────────────────────────────────────────
function Lobby() {
  const dispatch = useDispatch();
  const [joinCode, setJoinCode] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const stats = useSelector((s) => s.stats);
  const connected = useSelector((s) => s.online.connected);

  const quickMatch = () => {
    if (!connected) return;
    sfx.click(); rt.send({ type: "quick_match" }); dispatch(setWaiting(true));
  };
  const createRoom = () => {
    if (!connected) return;
    sfx.click();
    setCreatingRoom(true);
    rt.send({ type: "create_room" });
    // Server replies with room_state; once that lands, parent re-renders and we leave Lobby.
    // Safety: if no reply in 5s, reset the spinner so the button is clickable again.
    setTimeout(() => setCreatingRoom(false), 5000);
  };
  const join = (e) => {
    e.preventDefault();
    if (!connected) return;
    const c = joinCode.trim().toUpperCase();
    if (c.length === 6) rt.send({ type: "join_room", code: c });
  };

  return (
    <div className="tw-col">
      <h1 style={{ margin: "8px 0", display: "inline-flex", alignItems: "center", gap: 10 }}>
        <Icon name="vs" size={32} /> Play with Friends
      </h1>
      {!connected && <ConnectionStatus />}
      <div className="tw-grid-2">
        <div className="tw-card tw-online-card">
          <div style={{ fontSize: 26 }}>⚡</div>
          <div className="tw-online-title">Quick Match</div>
          <div className="tw-online-desc">Pair you with a random player around your skill level. Best of 5.</div>
          <button className="tw-btn block" onClick={quickMatch} disabled={!connected}
            title={connected ? "Find an opponent now" : "Connecting first…"}>
            {connected ? "Find an opponent" : "Connecting…"}
          </button>
        </div>
        <div className="tw-card tw-online-card">
          <div style={{ fontSize: 26 }}>🔗</div>
          <div className="tw-online-title">Invite a Friend</div>
          <div className="tw-online-desc">Generate a 6-letter code and share it. They join, you both play.</div>
          <button className="tw-btn block" onClick={createRoom} disabled={!connected || creatingRoom}
            title={!connected ? "Connecting first…" : "Generate a code"}>
            {creatingRoom ? "Creating…" : "Generate code"}
          </button>
        </div>
      </div>

      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, marginBottom: 8 }}>Join with a code</div>
        <form className="tw-row" onSubmit={join}>
          <input className="tw-input" placeholder="ABC123" maxLength={6}
                 value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} style={{ textAlign: "center", letterSpacing: 4 }} />
          <button type="submit" className="tw-btn" disabled={joinCode.length !== 6}>Join</button>
        </form>
      </div>

      <div className="tw-card">
        <div className="tw-row" style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: "Fredoka", fontWeight: 700 }}>Your rank</div>
          <div style={{ flex: 1 }} />
          <span className="tw-pill">⭐ {stats.online_rating || 1000}</span>
          <span className="tw-pill">✓ {stats.online_wins || 0}W</span>
          <span className="tw-pill">✕ {stats.online_losses || 0}L</span>
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
          Win rewards: +20 rating · +2 free spins · +50 coins. Disconnects count as a loss.
        </div>
      </div>

      <div className="tw-card">
        <div className="tw-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "Fredoka", fontWeight: 700 }}>🛋️ Pass & Play</div>
            <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Same device, 2–6 players — no internet needed.</div>
          </div>
          <button className="tw-btn ghost" onClick={() => dispatch(setView("multi"))}>Open</button>
        </div>
      </div>

      <Leaderboard />
    </div>
  );
}

function Leaderboard() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    fetch((process.env.API_BASE_URL || "/api") + "/stats/online-leaderboard")
      .then((r) => r.json())
      .then(setRows)
      .catch(() => {});
  }, []);
  if (!rows.length) return null;
  return (
    <div className="tw-card">
      <div style={{ fontFamily: "Fredoka", fontWeight: 700, marginBottom: 8 }}>🏆 Top Players</div>
      {rows.slice(0, 10).map((r, i) => (
        <div key={r.username} className="tw-row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span>{i + 1}. {r.username} <span style={{ color: "var(--text-dim)" }}>· L{r.level}</span></span>
          <span><strong>{r.online_rating}</strong> · {r.online_wins}W/{r.online_losses}L</span>
        </div>
      ))}
    </div>
  );
}

// ─── Queueing ───────────────────────────────────────────────────────────────
function Queueing() {
  const dispatch = useDispatch();
  const cancel = () => { sfx.click(); rt.send({ type: "cancel_quick_match" }); dispatch(setWaiting(false)); };
  return (
    <div className="tw-card" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 48 }}>🔍</div>
      <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700 }}>Finding an opponent…</div>
      <div style={{ color: "var(--text-dim)", margin: "8px 0 14px" }}>This usually takes a few seconds.</div>
      <div className="tw-spinner" />
      <button className="tw-btn ghost block" onClick={cancel} style={{ marginTop: 14 }}>Cancel</button>
    </div>
  );
}

// ─── Live Match ─────────────────────────────────────────────────────────────
function LiveMatch() {
  const dispatch = useDispatch();
  const room = useSelector((s) => s.online.room);
  const reveal = useSelector((s) => s.online.reveal);
  const opponentAnswered = useSelector((s) => s.online.opponentAnswered);
  const me = useSelector((s) => s.auth.user);
  const [picked, setPicked] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { setPicked(null); }, [room?.index]);

  if (!room) return null;
  const meSlot = room.players.find((p) => p && me && p.id === me.id);
  const opponent = room.players.find((p) => p && (!me || p.id !== me.id));
  const startingSoon = !room.started && room.players.filter(Boolean).length === 2;
  const countdown = room.questionEndsAt ? Math.max(0, Math.ceil((room.questionEndsAt - Date.now()) / 1000)) : null;

  const leave = () => {
    // Pre-game (room exists but match not yet started): plain leave, no penalty.
    if (!room.started || room.finished) {
      if (!confirm("Leave room?")) return;
      rt.send({ type: "leave_room" });
      return;
    }
    // Mid-match: full forfeit penalty (−1 life + server-side rating drop).
    dispatch(safeNavigate("home"));
  };

  const answer = (a) => {
    if (picked) return;
    setPicked(a);
    sfx.click();
    rt.send({ type: "answer", answer: a });
  };

  // Pre-game lobby / waiting for opponent
  if (!room.started) {
    return (
      <div className="tw-col">
        <button className="tw-pill" onClick={leave} style={{ alignSelf: "flex-start" }}>← Leave</button>
        <div className="tw-card" style={{ textAlign: "center" }}>
          {room.kind === "private" && (
            <>
              <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Share this code with a friend</div>
              <div className="tw-room-code">{room.code}</div>
              <div className="tw-row" style={{ justifyContent: "center", marginTop: 10, gap: 8 }}>
                <button className="tw-btn ghost" title="Copy the code to your clipboard"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(room.code); dispatch(pushToast({ icon: "📋", title: "Code copied" })); }
                    catch (e) { dispatch(pushToast({ icon: "⚠️", title: "Copy failed — long-press to copy" })); }
                  }}>📋 Copy code</button>
                <button className="tw-btn ghost" title="Share via your device's share sheet"
                  onClick={async () => {
                    const text = `Join my Trivia Wheel match with code: ${room.code}\nhttps://triviawheel.app`;
                    if (navigator.share) { try { await navigator.share({ title: "Trivia Wheel", text }); } catch (e) {} }
                    else { try { await navigator.clipboard.writeText(text); dispatch(pushToast({ icon: "📋", title: "Invite copied" })); } catch (e) {} }
                  }}>↗️ Share</button>
              </div>
            </>
          )}
          <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700, marginTop: 12 }}>
            {startingSoon ? "Both players in — starting…" : "Waiting for opponent…"}
          </div>
          <div className="tw-row" style={{ justifyContent: "center", marginTop: 16, gap: 24 }}>
            <PlayerSlot player={room.players[0]} you={meSlot && meSlot.id === room.players[0]?.id} />
            <div style={{ fontFamily: "Fredoka", fontSize: 28 }}>VS</div>
            <PlayerSlot player={room.players[1]} you={meSlot && meSlot.id === room.players[1]?.id} />
          </div>
        </div>
        <ChatPanel />
      </div>
    );
  }

  return (
    <div className="tw-col">
      <button className="tw-pill" onClick={leave} style={{ alignSelf: "flex-start" }}>← Forfeit</button>

      <div className="tw-card">
        <div className="tw-online-scoreboard">
          <ScoreCard player={meSlot} highlight />
          <div className="tw-online-vs">
            <div style={{ fontFamily: "Fredoka", fontSize: 12, color: "var(--text-dim)" }}>Q {room.index + 1}/{room.total}</div>
            <div style={{ fontFamily: "Fredoka", fontSize: 32, fontWeight: 700 }}>{countdown ?? "–"}</div>
          </div>
          <ScoreCard player={opponent} typing={opponentAnswered} />
        </div>

        {room.question && (
          <>
            <div style={{ fontFamily: "Fredoka", fontSize: 20, fontWeight: 600, margin: "14px 0" }}>
              {room.question.question}
            </div>
            {room.question.answers.map((a) => {
              let cls = "tw-answer";
              if (reveal && reveal.results) {
                if (a === reveal.correct) cls += " correct";
                else if (picked === a) cls += " wrong";
              } else if (picked === a) {
                cls += " correct";
              }
              return (
                <button key={a} className={cls} disabled={!!picked || !!reveal} onClick={() => answer(a)}>{a}</button>
              );
            })}
          </>
        )}

        {reveal && (
          <div style={{ textAlign: "center", color: "var(--text-dim)", marginTop: 10 }}>
            Answer was <strong style={{ color: "var(--good)" }}>{reveal.correct}</strong>. Next question in a moment…
          </div>
        )}
      </div>

      {lastReactionView()}
      <ChatPanel />
    </div>
  );
}

function lastReactionView() {
  // Hook into store via React.memo wrapper.
  return <ReactionLayer />;
}

function ReactionLayer() {
  const reaction = useSelector((s) => s.online.lastReaction);
  if (!reaction) return null;
  return (
    <div className="tw-reaction-fly" key={reaction.at}>
      <span style={{ fontSize: 48 }}>{reaction.emoji}</span>
      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{reaction.username}</div>
    </div>
  );
}

// ─── ConnectionStatus ───────────────────────────────────────────────────────
function ConnectionStatus() {
  const dispatch = useDispatch();
  const [diag, setDiag] = useState(null);
  const [running, setRunning] = useState(false);

  const runDiagnose = async () => {
    setRunning(true);
    setDiag(null);
    const result = await rt.diagnose();
    setDiag(result);
    setRunning(false);
  };

  return (
    <div className="tw-card" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)" }}>
      <div className="tw-row" style={{ gap: 8 }}>
        <div className="tw-spinner" style={{ width: 18, height: 18, margin: 0, borderWidth: 2 }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Connecting to live server…</span>
        <div style={{ flex: 1 }} />
        <button className="tw-pill" style={{ cursor: "pointer" }} onClick={() => rt.forceReconnect()}>Retry</button>
        <button className="tw-pill" style={{ cursor: "pointer" }} onClick={runDiagnose} disabled={running}>
          {running ? "..." : "Diagnose"}
        </button>
      </div>
      {diag && (
        <div style={{ marginTop: 10, fontSize: 12, fontFamily: "monospace", background: "rgba(0,0,0,0.25)", padding: 10, borderRadius: 8 }}>
          <div>API health: <strong style={{ color: diag.reachable ? "var(--good)" : "var(--bad)" }}>{diag.reachable ? "✓ reachable" : "✗ unreachable"}</strong></div>
          {!diag.reachable && diag.network_error && <div style={{ color: "var(--bad)" }}>Network: {diag.network_error}</div>}
          <div>Auth token: <strong>{diag.token ? "✓ present" : "✗ missing — sign in"}</strong></div>
          <div>WS URL: <span style={{ color: "var(--text-dim)" }}>{diag.wsUrl}</span></div>
          {diag.error && <div style={{ color: "var(--bad)" }}>Last error: {diag.error}</div>}
          {!diag.reachable && (
            <div style={{ marginTop: 8, padding: 8, background: "rgba(239,68,68,0.15)", borderRadius: 6, color: "var(--text)" }}>
              💡 Backend not running. In a terminal: <code>cd server && npm start</code>
            </div>
          )}
          {diag.reachable && !diag.token && (
            <div style={{ marginTop: 8, padding: 8, background: "rgba(245,158,11,0.15)", borderRadius: 6 }}>
              💡 Sign in first — online play needs an account.
            </div>
          )}
          {diag.reachable && diag.token && diag.error && (
            <div style={{ marginTop: 8, padding: 8, background: "rgba(245,158,11,0.15)", borderRadius: 6 }}>
              💡 Backend is up but the /ws endpoint rejected the connection. The most common cause: backend was started before realtime support was added. Restart with <code>cd server && npm start</code>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerSlot({ player, you }) {
  if (!player) return <div className="tw-online-slot empty">Waiting…</div>;
  return (
    <div className="tw-online-slot">
      <div style={{ fontFamily: "Fredoka", fontSize: 16, fontWeight: 700 }}>{player.username}{you && " (you)"}</div>
      {player.ready && <div style={{ fontSize: 11, color: "var(--good)" }}>✓ Ready</div>}
    </div>
  );
}

function ScoreCard({ player, highlight, typing }) {
  if (!player) return <div className="tw-online-score" />;
  return (
    <div className={`tw-online-score ${highlight ? "you" : ""}`}>
      <div className="tw-online-score-name">{player.username}{highlight && " ★"}</div>
      <div className="tw-online-score-value">{player.score}</div>
      <div className="tw-online-score-sub">{player.correct} right</div>
      {typing && <div className="tw-online-typing">answered ✓</div>}
    </div>
  );
}

// ─── Match End ──────────────────────────────────────────────────────────────
function MatchEnd() {
  const dispatch = useDispatch();
  const matchEnd = useSelector((s) => s.online.matchEnd);
  const me = useSelector((s) => s.auth.user);
  if (!matchEnd) return null;
  const won = me && matchEnd.winnerId === me.id;
  const tie = !matchEnd.winnerId;
  const mine = matchEnd.players.find((p) => p && me && p.id === me.id);
  const opp = matchEnd.players.find((p) => p && (!me || p.id !== me.id));

  return (
    <div className="tw-col">
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 32, fontWeight: 700 }}>
          {tie ? "🤝 Tie!" : won ? "🏆 You Win!" : "Good game"}
        </div>
        {won && <div style={{ color: "var(--good)", margin: "8px 0" }}>+2 free spins · +50 coins · +20 rating</div>}
        {tie && <div style={{ color: "var(--warn)", margin: "8px 0" }}>+1 free spin · +15 coins</div>}
        {!won && !tie && <div style={{ color: "var(--text-dim)", margin: "8px 0" }}>+5 coins for trying</div>}

        <div className="tw-row" style={{ justifyContent: "center", marginTop: 14, gap: 24 }}>
          <div>
            <div style={{ fontFamily: "Fredoka", fontWeight: 700 }}>{mine?.username || "You"}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{mine?.score ?? 0}</div>
          </div>
          <div style={{ fontFamily: "Fredoka", fontSize: 22, alignSelf: "center" }}>vs</div>
          <div>
            <div style={{ fontFamily: "Fredoka", fontWeight: 700 }}>{opp?.username || "Opponent"}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{opp?.score ?? 0}</div>
          </div>
        </div>

        <div className="tw-row" style={{ justifyContent: "center", marginTop: 18 }}>
          <button className="tw-btn" onClick={() => { dispatch(leftRoom()); rt.send({ type: "quick_match" }); dispatch(setWaiting(true)); }}>Play again</button>
          <button className="tw-btn ghost" onClick={() => { dispatch(leftRoom()); dispatch(setView("home")); }}>Home</button>
        </div>
      </div>
    </div>
  );
}
