import React, { useEffect, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { decode } from "html-entities";
import { rt } from "../realtime/client";
import {
  setConnected, setWaiting, setRoom, setError, setMatchEnd,
  setReveal, setOpponentAnswered, setChatNotice, pushChat, pushReaction, leftRoom,
} from "../store/onlineSlice";
import { setView, setModal, pushToast } from "../store/uiSlice";
import { fetchStats, markAchievement, unlockAchievement } from "../store/statsSlice";
import { confirmDialog } from "../utils/confirm";
import { api } from "../api/client";
import ChatPanel from "./ChatPanel";
import Icon from "./Icon";
import { PlayerFlair } from "./PlayerFlair";
import OtherAvatar from "./OtherAvatar";
import { sfx } from "../utils/sound";
import { safeNavigate } from "../utils/navigate";
import { MiniGameRunner, gameMeta } from "../minigames";

export default function Online() {
  const dispatch = useDispatch();
  const store = useStore();
  const user = useSelector((s) => s.auth.user);
  // Only fields actually rendered here. `lastReaction` is consumed by
  // <ReactionLayer/> via its own selector — pulling it here just causes
  // the whole Online tree to re-render every time a reaction fires.
  const { connected, waiting, room, matchEnd } = useSelector((s) => s.online);

  // Bridge WS events → redux. Track per-message timers so cleanup on
  // unmount cancels any pending reaction-clear / etc. that would
  // otherwise fire into a torn-down store.
  useEffect(() => {
    if (!user) return;
    rt.connect();
    // LATE-SUBSCRIBER SYNC. App.js eagerly calls rt.connect() on boot
    // (so live notifications work from anywhere in the app). By the
    // time the user navigates to /online and this listener attaches,
    // the WS may ALREADY be open — and rt.emit({type:"open"}) already
    // fired into the void. Result: redux `connected` stayed false
    // forever, ConnectionStatus stuck on "still trying to connect…"
    // even though the live debug line shows WS state OPEN (1).
    // Sync from the live readyState now so the listener doesn't have
    // to wait for the next reconnect to learn the truth.
    const live = rt.state();
    if (live.readyState === 1) dispatch(setConnected(true));
    else if (live.readyState === 3) dispatch(setConnected(false));
    let reactionTimer = null;
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
        case "reaction": {
          // Whitelist the fields we actually want — don't spread the
          // whole WS payload into redux. Cancel any in-flight clear so
          // rapid reactions don't blank each other out prematurely.
          // Play a subtle chime so the receiver actually notices the
          // reaction even if they're not looking at the screen corner
          // where it animates in — but skip when it's our own echo.
          dispatch(pushReaction({ emoji: msg.emoji, username: msg.username, at: Date.now() }));
          if (msg.userId !== user.id) sfx.click();
          if (reactionTimer) clearTimeout(reactionTimer);
          reactionTimer = setTimeout(() => dispatch(pushReaction(null)), 1500);
          break;
        }
        case "match_end": {
          sfx.win();
          dispatch(setMatchEnd(msg));
          dispatch(fetchStats());
          // friend_winner achievement: fires the first time you win
          // any online VS match (quick or friendly). Achievement is
          // idempotent server-side so a second win is a no-op.
          if (user && msg.winnerId === user.id) {
            dispatch(markAchievement("friend_winner"));
            dispatch(unlockAchievement("friend_winner"));
          }
          break;
        }
        case "session_ended": {
          // Continue-vote timed out, opponent declined, or room closed.
          // No penalty — just navigate the player home cleanly.
          //
          // We only fire the "Game over" toast if the player was
          // ACTUALLY in a room/match-end state. The realtime client
          // emits a synthetic session_ended with reason="connection_lost"
          // when the WS gives up reconnecting — without the room
          // guard, every transient outage spammed "Connection lost"
          // toasts even when the user was just sitting on Home.
          const hadActiveSession = !!store.getState().online.room
                                || !!store.getState().online.matchEnd
                                || !!store.getState().online.waiting;
          dispatch(leftRoom());
          const reason = msg.reason;
          const declinedBySelf = reason === "declined" && msg.byUserId === user.id;
          if (!declinedBySelf && hadActiveSession) {
            const text = reason === "declined" ? "Opponent decided not to continue."
                       : reason === "continue_timeout" ? "Rematch timer ran out."
                       : reason === "connection_lost" ? "Connection lost — couldn't reach the server."
                       : reason === "opponent_disconnected" ? "Opponent disconnected."
                       : reason === "opponent_left_pregame" ? "Opponent left before the match started."
                       : "Session ended.";
            dispatch(pushToast({ icon: "👋", title: "Game over", text }));
          }
          dispatch(fetchStats());
          break;
        }
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
        case "error": {
          // Surface friend-room join failures as visible toasts. Without
          // these, clicking Join with a bad/expired code did nothing
          // visible — the error was dispatched into redux but no UI
          // consumed it, so the user assumed the button was broken.
          // Connection-level errors (auth_required, forbidden, give_up)
          // already render in ConnectionStatus, so don't toast those —
          // keep them in redux for that component to handle.
          dispatch(setError(msg.error));
          const joinErrorText = msg.error === "room_not_found"
              ? "That code isn't valid — ask your friend to share a fresh code."
              : msg.error === "room_full"
              ? "That room is already full."
              : msg.error === "already_in"
              ? "You're already in this room."
              : msg.error === "not_friends"
              ? "You can only invite accepted friends to a private match."
              : null;
          if (joinErrorText) {
            dispatch(pushToast({ icon: "⚠️", title: "Couldn't join", text: joinErrorText, duration: 4500 }));
          }
          break;
        }
        case "comeback_armed": {
          dispatch(pushToast({
            icon: "💪",
            title: "Comeback Boost armed",
            text: "Next ranked win gets +50% rating. Climb back.",
            duration: 4200,
          }));
          dispatch(fetchStats());
          break;
        }
        case "comeback_consumed": {
          dispatch(pushToast({
            icon: "🚀",
            title: "Comeback boost cashed!",
            text: `+${msg.ratingDelta} rating (1.5× from the boost)`,
            duration: 4500,
          }));
          break;
        }
        case "round_end": {
          // Best-of-3 intra-series round. Server auto-advances to
          // the next round in ~2.5s — we just surface a celebratory
          // banner-toast so the player feels the round result. The
          // series score is in msg.seriesWins; the actual match_end
          // (with continue-vote UI) only fires when the SERIES
          // resolves (one player at 2 wins or 3 rounds played).
          const youWon = msg.roundWinnerId === user.id;
          const tied = !msg.roundWinnerId;
          dispatch(pushToast({
            icon: tied ? "🤝" : youWon ? "🏆" : "💔",
            title: tied ? `Round ${msg.round}: tied` : youWon ? `Round ${msg.round}: WON` : `Round ${msg.round}: LOST`,
            text: "Next round starts in a moment…",
            duration: 2400,
          }));
          if (youWon) sfx.win?.(); else sfx.lose?.();
          break;
        }
        // Power Cards — published events that drive UI feedback.
        // Inventory updates flow through room_state's powerCards
        // field; these case branches are just for the celebratory
        // toasts + sound effects + sniper-reveal storage.
        case "card_used": {
          const who = msg.userId === user.id ? "You" : "Opponent";
          // Arena-pivoted labels. Server IDs unchanged (back-compat).
          const labels = { sniper: "👁️ Spy", cut: "✂️ Sabotage", double: "✖️2 Multiplier" };
          dispatch(pushToast({
            icon: "🃏",
            title: `${who} played ${labels[msg.card] || msg.card}`,
            duration: 2200,
          }));
          if (msg.userId !== user.id) sfx.click?.();
          break;
        }
        case "card_resolved": {
          // Fires when a "double" (Multiplier) actually doubles a
          // submitted score. Celebration on the user side; opponent
          // sees the new score via the round_reveal payload.
          if (msg.userId === user.id) {
            const sc = msg.payload?.score ?? msg.payload?.points ?? 0;
            dispatch(pushToast({ icon: "✖️2", title: `Multiplier hit: ${sc}`, text: "Double score cashed in!" }));
            sfx.coin?.();
          }
          break;
        }
        case "card_rejected": {
          dispatch(pushToast({ icon: "⚠️", title: "Card unavailable", text: "You already used that this match." }));
          break;
        }
        case "sniper_reveal": {
          // We're the Spy — opponent just submitted, we see their
          // score for THIS round. Server now sends { score, game_type }
          // instead of the old { answer, correct }.
          const sc = msg.score ?? msg.answer ?? "?";
          dispatch(pushToast({
            icon: "👁️",
            title: "Spied!",
            text: `Opponent's score this round: ${sc}`,
            duration: 3500,
          }));
          break;
        }
      }
    });
    return () => {
      off();
      if (reactionTimer) clearTimeout(reactionTimer);
    };
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
  // Difficulty for both quick match queueing AND friend room creation.
  // Saved to state so the player can switch and re-click without losing
  // their choice. Defaults to medium (most populated bracket).
  const [difficulty, setDifficulty] = useState("medium");
  const stats = useSelector((s) => s.stats);
  const connected = useSelector((s) => s.online.connected);

  const quickMatch = () => {
    if (!connected) return;
    sfx.click();
    rt.send({ type: "quick_match", difficulty });
    dispatch(setWaiting(true));
  };
  const createRoom = () => {
    if (!connected) return;
    sfx.click();
    setCreatingRoom(true);
    rt.send({ type: "create_room", difficulty });
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
      {/* Silent grace period: don't show the ConnectionStatus card
          AT ALL for the first 2 seconds of mount. Normal-speed
          connects open in well under that window, so the user never
          sees a warning UI for the happy path. ConnectionStatus
          internally still auto-diagnoses if it lingers (4s), so a
          real outage will still surface. */}
      {!connected && <ConnectionStatusGated />}

      {/* Difficulty selector — applies to both Quick Match (queues you
          into the same-difficulty bracket) AND Invite a Friend (host
          picks; can be re-voted between rounds). Multipliers shown so
          players understand higher difficulty = higher rewards. */}
      <div className="tw-card">
        <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontFamily: "Fredoka", fontWeight: 700 }}>Difficulty</div>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Higher difficulty = bigger reward</span>
        </div>
        <div className="tw-row" style={{ gap: 8 }}>
          {[
            { id: "easy",   label: "Easy",   mult: "0.7×", desc: "warm-up" },
            { id: "medium", label: "Medium", mult: "1.0×", desc: "standard" },
            { id: "hard",   label: "Hard",   mult: "1.6×", desc: "elite" },
          ].map((d) => (
            <button key={d.id}
              className={`tw-diff-pill ${difficulty === d.id ? "active" : ""}`}
              onClick={() => { sfx.click(); setDifficulty(d.id); }}>
              <strong>{d.label}</strong>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{d.mult} · {d.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tw-grid-2">
        <div className="tw-card tw-online-card">
          <div style={{ fontSize: 26 }}>⚡</div>
          <div className="tw-online-title">Quick Match</div>
          <div className="tw-online-desc">Pair you with a random player. Wins count for the leaderboard.</div>
          <button className="tw-btn block" onClick={quickMatch} disabled={!connected}
            title={connected ? `Find a ${difficulty} opponent now` : "Connecting first…"}>
            {connected ? `Find a ${difficulty} opponent` : "Connecting…"}
          </button>
        </div>
        <div className="tw-card tw-online-card">
          <div style={{ fontSize: 26 }}>🔗</div>
          <div className="tw-online-title">Invite a Friend</div>
          <div className="tw-online-desc">Friendly match — score kept, but no leaderboard impact. Bail any time.</div>
          <button className="tw-btn block" onClick={createRoom} disabled={!connected || creatingRoom}
            title={!connected ? "Connecting first…" : `Generate a ${difficulty} code`}>
            {creatingRoom ? "Creating…" : `Generate code (${difficulty})`}
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

      {/* Daily VS leaderboard — today's top players by ranked wins.
          Public, social-proof panel that gives a player a reason to
          come back and grind for the daily cosmetic prize. */}
      <DailyVsPanel />

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
  const connected = useSelector((s) => s.online.connected);
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

  const leave = async () => {
    // Pre-game (room exists but match not yet started): plain leave, no penalty.
    if (!room.started || room.finished) {
      if (!(await confirmDialog(dispatch, {
        icon: "🚪",
        title: "Leave room?",
        message: "You'll return to the home screen.",
        confirmText: "Leave",
        cancelText: "Stay",
      }))) return;
      rt.send({ type: "leave_room" });
      return;
    }
    // Mid-match: full forfeit penalty (rating drop + opponent gets the win).
    dispatch(safeNavigate("home"));
  };

  // Arena pivot: submitMiniGameScore is the per-round commit. The
  // mini-game component runs its own timer, computes a numeric score
  // when it finishes, and calls this. The server's `answer` handler
  // (still named that for back-compat) now reads msg.score and
  // clamps via the minigames registry.
  const submitMiniGameScore = ({ score }) => {
    if (picked) return; // already submitted this round
    setPicked({ score });
    sfx.click?.();
    rt.send({ type: "answer", score: Number(score) || 0 });
  };

  // Pre-game lobby / waiting for opponent. The code-sharing UI is gated
  // to first-ever round (rounds === 0) so a rematch transition — when
  // room.started briefly flips false between rounds — doesn't ask the
  // user to re-share the invite they already sent.
  if (!room.started) {
    const isFirstRound = !room.rounds || room.rounds === 0;
    const showInviteCode = room.kind === "private" && isFirstRound;
    return (
      <div className="tw-col">
        <button className="tw-pill" onClick={leave} style={{ alignSelf: "flex-start" }}>← Leave</button>
        <div className="tw-card" style={{ textAlign: "center" }}>
          {showInviteCode && (
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
                    const text = `Join my Spinlore match with code: ${room.code}\nhttps://triviawheel.app`;
                    if (navigator.share) { try { await navigator.share({ title: "Spinlore", text }); } catch (e) {} }
                    else { try { await navigator.clipboard.writeText(text); dispatch(pushToast({ icon: "📋", title: "Invite copied" })); } catch (e) {} }
                  }}>↗️ Share</button>
              </div>
            </>
          )}
          <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700, marginTop: 12 }}>
            {startingSoon ? "Both players in — starting…"
             : !isFirstRound ? "Next round starting…"
             : "Waiting for opponent…"}
          </div>
          <div className="tw-row" style={{ justifyContent: "center", marginTop: 16, gap: 24 }}>
            <PlayerSlot player={room.players[0]} you={meSlot && meSlot.id === room.players[0]?.id} />
            <div style={{ fontFamily: "Fredoka", fontSize: 28 }}>VS</div>
            <PlayerSlot player={room.players[1]} you={meSlot && meSlot.id === room.players[1]?.id} />
          </div>
          {/* Rivalry tracker — if these two players have history, show
              the head-to-head. "You're 5-3 against MrAlex" is one of
              the strongest re-engagement hooks in any 1v1 game. */}
          {opponent && opponent.id && (
            <RivalryStrip opponentId={opponent.id} opponentName={opponent.username} />
          )}
          {/* Comeback Boost indicator — only renders when active.
              Communicates "you've got a 1.5× rating bonus locked and
              loaded" so the player feels the upside before queueing. */}
          <ComebackBoostIndicator />
          {/* Series format chip — telegraphs "this is best of 3"
              before the match starts so the player knows what to
              expect. */}
          {room.kind === "quick" && (
            <div className="tw-pill" style={{ marginTop: 12, alignSelf: "center", display: "inline-block", background: "rgba(124,58,237,0.18)", borderColor: "rgba(124,58,237,0.4)", color: "#fff", fontWeight: 700, fontSize: 12 }}>
              🏆 Best of 3 · first to 2 round wins
            </div>
          )}
        </div>
        <ChatPanel />
      </div>
    );
  }

  const isFriendly = room.kind === "private";
  const skipOpponent = async () => {
    if (isFriendly) return;
    if (!(await confirmDialog(dispatch, {
      icon: "⏭️",
      title: "Skip this opponent?",
      message: "You'll take a rating hit. Free once a day for non-supporters.",
      confirmText: "Skip",
      cancelText: "Stay",
      destructive: true,
    }))) return;
    rt.send({ type: "skip_opponent" });
  };

  return (
    <div className="tw-col">
      {!connected && (
        <div className="tw-card" style={{
          background: "rgba(245,158,11,0.18)",
          border: "1px solid rgba(245,158,11,0.5)",
          padding: "10px 14px",
        }}>
          <div className="tw-row" style={{ gap: 10 }}>
            <div className="tw-spinner" style={{ width: 16, height: 16, margin: 0, borderWidth: 2 }} />
            <strong style={{ fontSize: 13 }}>Reconnecting…</strong>
            <span style={{ flex: 1, color: "var(--text-dim)", fontSize: 12 }}>
              Your answer will sync as soon as we're back online.
            </span>
          </div>
        </div>
      )}
      <div className="tw-row" style={{ justifyContent: "space-between" }}>
        <button className="tw-pill" onClick={leave}>
          ← {isFriendly ? "Leave (no penalty)" : "Forfeit"}
        </button>
        <span className="tw-pill" title="Match difficulty">
          {room.difficulty === "easy" ? "🟢 Easy" : room.difficulty === "hard" ? "🔴 Hard" : "🟡 Medium"}
          {isFriendly && " · Friendly"}
        </span>
        {!isFriendly && (
          <button className="tw-pill" onClick={skipOpponent} title="Skip this opponent — finds you a new one">
            Skip ⏭
          </button>
        )}
      </div>

      {/* Session score chip — only shows from round 2 onward when there's
          actually multi-round context. Compact so it doesn't crowd the
          scoreboard above the question. */}
      {room.rounds > 1 && room.sessionScores && (
        <SessionChip
          sessionScores={room.sessionScores}
          mePlayer={meSlot}
          oppPlayer={opponent}
          roundNumber={room.rounds}
        />
      )}

      <div className="tw-card">
        {/* Series score badge — only renders for best-of-3 formats.
            Tells the player at a glance "we're tied 1-1, this is the
            deciding round" without parsing the underlying state. */}
        {room.series?.format === "bo3" && (
          <SeriesBadge series={room.series} me={meSlot} opponent={opponent} />
        )}
        <div className="tw-online-scoreboard">
          <ScoreCard player={meSlot} highlight answered={!!picked} />
          <div className="tw-online-vs">
            <div style={{ fontFamily: "Fredoka", fontSize: 12, color: "var(--text-dim)" }}>Q {room.index + 1}/{room.total}</div>
            <div style={{ fontFamily: "Fredoka", fontSize: 32, fontWeight: 700 }}>{countdown ?? "–"}</div>
          </div>
          <ScoreCard player={opponent} answered={!!opponentAnswered} />
        </div>

        {/* Live race-bar — visualizes the score gap between players
            as a horizontal bar. Updates the moment a player scores.
            Tension peaks when the marker crosses the midpoint. */}
        <RaceBar me={meSlot} opponent={opponent} />

        {/* Live "whose answer is in" banner. Tells the player exactly
            what to do or wait on without having to interpret icons. */}
        {!reveal && (
          <AnswerStatusBanner
            picked={!!picked}
            opponentAnswered={!!opponentAnswered}
            opponentName={opponent?.username || "Opponent"}
          />
        )}

        {/* Power Cards tray — 3 strategic cards per match. Drives
            re-engagement (every match plays differently) AND creates
            a monetization vector once we add purchasable extra
            charges in a future season. */}
        <PowerCardTray
          inventory={room.powerCards?.[me?.id]}
          oppInventory={room.powerCards?.[opponent?.id]}
          disabled={!!picked || !!reveal}
        />

        {/* Arena pivot: render the current mini-game. room.question is
            now a mini-game descriptor ({type, seed, idx, meta}). The
            runner picks the right component, runs the round's timer,
            and submits a score on completion. Reveal phase shows the
            per-player scores for the just-finished round. */}
        {room.question && !reveal && (
          <>
            <div style={{ fontFamily: "Fredoka", fontSize: 16, fontWeight: 700, margin: "14px 0 6px", textAlign: "center" }}>
              {(room.question.meta?.icon || gameMeta(room.question.type).icon)} {(room.question.meta?.name || gameMeta(room.question.type).name)}
            </div>
            {room.question.meta?.tagline && (
              <div style={{ fontSize: 12, color: "var(--text-dim)", textAlign: "center", marginBottom: 10 }}>
                {room.question.meta.tagline}
              </div>
            )}
            <MiniGameRunner
              key={`${room.code}-${room.index}`}
              game={room.question}
              onComplete={submitMiniGameScore}
            />
            {picked && (
              <div style={{ marginTop: 10, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
                Score locked: <strong style={{ color: "var(--text)" }}>{picked.score}</strong>
                {!opponentAnswered && " · waiting for opponent…"}
              </div>
            )}
          </>
        )}

        {reveal && reveal.results && (
          <div className="tw-card" style={{ textAlign: "center", marginTop: 10, background: "rgba(255,255,255,0.04)" }}>
            <div style={{ fontFamily: "Fredoka", fontWeight: 700, marginBottom: 8 }}>
              Round result — {gameMeta(reveal.game_type).icon} {gameMeta(reveal.game_type).name}
            </div>
            <div className="tw-row" style={{ justifyContent: "space-around", gap: 12 }}>
              {[meSlot, opponent].filter(Boolean).map((p) => {
                const r = reveal.results[p.id];
                const sc = r ? r.score : 0;
                const isMe = meSlot && p.id === meSlot.id;
                return (
                  <div key={p.id} style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700 }}>
                      {isMe ? "YOU" : (p.username || "OPPONENT").toUpperCase()}
                    </div>
                    <div style={{ fontFamily: "Fredoka", fontSize: 28, fontWeight: 800 }}>{sc}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 8 }}>Next round in a moment…</div>
          </div>
        )}
      </div>

      <ReactionLayer />
      <MobileCollapsibleChat />
    </div>
  );
}

// On mobile the chat panel piling under the answer card pushed the
// powerup row + scoreboard well below the fold and chat itself slid
// under the bottom nav. Collapse it to a floating bubble that
// expands into a drawer when tapped — keeps the question + answers
// occupying the visible viewport during a match. Desktop renders the
// chat inline as before.
function MobileCollapsibleChat() {
  const [open, setOpen] = React.useState(false);
  const isMobile = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  if (!isMobile) return <ChatPanel />;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open chat"
        aria-label="Open chat"
        style={{
          position: "fixed",
          right: 14,
          bottom: "calc(100px + env(safe-area-inset-bottom))",
          width: 48, height: 48, borderRadius: 24,
          background: "linear-gradient(135deg, var(--primary, #7c3aed), var(--primary-2, #ec4899))",
          color: "#fff", border: "none", cursor: "pointer",
          fontSize: 22,
          boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
          zIndex: 30,
        }}
      >💬</button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 40,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: 0, right: 0, bottom: 0,
              maxHeight: "70vh",
              background: "#1a1530",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              borderTop: "1px solid rgba(124,58,237,0.45)",
              padding: 12,
              paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
              boxShadow: "0 -12px 36px rgba(0,0,0,0.4)",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontFamily: "Fredoka", fontSize: 15 }}>Chat</strong>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                style={{
                  background: "transparent", border: "none",
                  color: "var(--text-dim)", cursor: "pointer", fontSize: 20, padding: 4,
                }}
              >×</button>
            </div>
            <ChatPanel />
          </div>
        </div>
      )}
    </>
  );
}

// Compact chip showing the session running tally above the live
// scoreboard. Only renders from round 2+ (handled by caller). Format:
// "Session · You 2-1 · Alice 1-2 · 🔥 2"
function SessionChip({ sessionScores, mePlayer, oppPlayer, roundNumber }) {
  if (!sessionScores) return null;
  const me = mePlayer && sessionScores[mePlayer.id];
  const opp = oppPlayer && sessionScores[oppPlayer.id];
  const fmt = (s) => s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}T` : ""}` : "0-0";
  const myStreak = me && me.streak >= 2 ? me.streak : 0;
  const oppStreak = opp && opp.streak >= 2 ? opp.streak : 0;
  return (
    <div className="tw-card" style={{
      padding: "8px 12px",
      background: "rgba(124,58,237,0.10)",
      border: "1px solid rgba(124,58,237,0.30)",
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap",
      fontSize: 13,
    }}>
      <span style={{ fontFamily: "Fredoka", fontWeight: 700, color: "var(--text-dim)" }}>
        Session · Round {roundNumber}
      </span>
      <div style={{ flex: 1 }} />
      <span title="Your wins-losses this session">
        <strong>You</strong> {fmt(me)}{myStreak ? <span style={{ marginLeft: 4, color: "#f97316" }}>🔥 {myStreak}</span> : null}
      </span>
      <span style={{ color: "var(--text-dim)" }}>·</span>
      <span title="Opponent wins-losses this session">
        <strong>{(oppPlayer && oppPlayer.username) || "Opp"}</strong> {fmt(opp)}{oppStreak ? <span style={{ marginLeft: 4, color: "#f97316" }}>🔥 {oppStreak}</span> : null}
      </span>
    </div>
  );
}

// Full session scoreboard for MatchEnd — bigger, more explicit than
// the inline chip. Shows totals + streaks side by side, and notes the
// streak event for this round ("🔥 2-win streak!" or "💔 Streak
// broken at 3"). Stays hidden on round 1 since there's no history yet.
function SessionScoreboard({ sessionScores, mePlayer, oppPlayer, prevMyStreak, didIWin, roundNumber }) {
  if (!sessionScores || !mePlayer) return null;
  const me = sessionScores[mePlayer.id];
  const opp = oppPlayer && sessionScores[oppPlayer.id];
  if (!me) return null;
  const streakNote =
    didIWin && me.streak >= 2 ? `🔥 ${me.streak}-win streak!`
    : (!didIWin && prevMyStreak >= 2) ? `💔 Streak broken at ${prevMyStreak}`
    : null;
  const cell = (label, s, highlight) => (
    <div style={{
      flex: 1,
      padding: 10,
      borderRadius: 10,
      background: highlight ? "rgba(124,58,237,0.18)" : "rgba(255,255,255,0.04)",
      border: highlight ? "1px solid rgba(124,58,237,0.45)" : "1px solid rgba(255,255,255,0.08)",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 20 }}>
        {s ? `${s.wins}W · ${s.losses}L${s.ties ? ` · ${s.ties}T` : ""}` : "0W · 0L"}
      </div>
      {s && s.streak >= 1 && (
        <div style={{ marginTop: 4, fontSize: 12, color: "#f97316" }}>
          🔥 Current streak: {s.streak}
        </div>
      )}
      {s && s.bestStreak >= 2 && (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          Best: {s.bestStreak}
        </div>
      )}
    </div>
  );
  return (
    <div className="tw-card" style={{ marginTop: 14, background: "rgba(0,0,0,0.20)" }}>
      <div className="tw-row" style={{ marginBottom: 10, gap: 8 }}>
        <span style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 14 }}>Session standings</span>
        <span style={{ color: "var(--text-dim)", fontSize: 12 }}>· {roundNumber} round{roundNumber === 1 ? "" : "s"} played</span>
        <div style={{ flex: 1 }} />
        {streakNote && (
          <span style={{ fontSize: 12, fontWeight: 600, color: didIWin ? "#f97316" : "var(--bad)" }}>
            {streakNote}
          </span>
        )}
      </div>
      <div className="tw-row" style={{ gap: 10 }}>
        {cell("You", me, true)}
        {cell((oppPlayer && oppPlayer.username) || "Opponent", opp, false)}
      </div>
    </div>
  );
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

// Silent-grace wrapper. Mounts only after a brief delay so the
// happy-path connect (which usually opens in 200-800 ms) never
// triggers a visible warning UI. If the WS DOES eventually open
// during the grace period, this never even renders because the
// parent gates on `!connected` and the open switch unmounts us.
function ConnectionStatusGated() {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return <ConnectionStatus />;
}

// ─── ConnectionStatus ───────────────────────────────────────────────────────
// Live debug-grade banner shown when the WS isn't connected. Always
// visible introspection (no "click Diagnose to learn what's wrong"):
//   • current WS readyState (CONNECTING / OPEN / CLOSING / CLOSED)
//   • WS URL being tried
//   • token presence
//   • last close code + reason
//   • API health probe result
//   • a "Hard reload" button that unregisters the service worker and
//     does a clean reload — fixes 99% of "I shipped a fix but my
//     browser still serves old code" cases
function ConnectionStatus() {
  const dispatch = useDispatch();
  const error = useSelector((s) => s.online.error);
  const [diag, setDiag] = useState(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rtState, setRtState] = useState(rt.state());

  // Tick once a second so we can re-poll rt.state() and update the
  // displayed readyState. Cheap; only mounted while disconnected.
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
      setRtState(rt.state());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const runDiagnose = async () => {
    setRunning(true);
    setDiag(null);
    const result = await rt.diagnose();
    setDiag(result);
    setRunning(false);
  };

  // Auto-diagnose on mount so the user never has to click a button to
  // understand what's failing. The probe is cheap and gives a deterministic
  // result in <500ms when the backend is healthy.
  useEffect(() => { runDiagnose(); }, []);

  // Nuke the SW + caches + reload. Fixes the "browser holding old bundle"
  // class of issues that the v4 network-first SW was supposed to prevent
  // — but the user has to actually be running the v4+ SW for that to work.
  // This forces a clean start.
  const hardReload = async () => {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {}
    // Cache-bust on reload so the index.html itself comes from network.
    window.location.replace(window.location.pathname + "?_t=" + Date.now());
  };

  // Categorize the failure so we can show targeted copy + actions.
  const isAuth     = error === "auth_required";
  const isForbidden = error === "forbidden" || error === "banned";
  const isGaveUp   = error === "give_up";
  const isFailing  = isAuth || isForbidden || isGaveUp;

  const title = isAuth     ? "Your session expired"
              : isForbidden ? "Account blocked"
              : isGaveUp   ? "Can't reach the live server"
              : elapsed > 8 ? "Still trying to connect…"
              : "Connecting to live server…";

  const body  = isAuth      ? "Sign in again to use live VS matches."
              : isForbidden ? "Live play is disabled for this account. Contact support if this is a mistake."
              : isGaveUp    ? "Tap Hard reload if this keeps happening — your browser may be holding stale code."
              : elapsed > 4 ? "Taking longer than usual. The live status below shows what's happening."
              : null;

  const bg = isFailing ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)";
  const border = isFailing ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.4)";

  return (
    <div className="tw-card" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="tw-row" style={{ gap: 8, alignItems: "center" }}>
        {!isFailing && <div className="tw-spinner" style={{ width: 18, height: 18, margin: 0, borderWidth: 2 }} />}
        {isFailing && <span style={{ fontSize: 18 }} aria-hidden="true">⚠️</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
          {body && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{body}</div>}
        </div>
        {isAuth ? (
          <button className="tw-btn" style={{ padding: "6px 14px" }}
                  onClick={() => { rt.forceReconnect(); dispatch(setModal("auth")); }}>
            Sign in
          </button>
        ) : (
          <button className="tw-pill" style={{ cursor: "pointer" }}
                  onClick={() => { rt.forceReconnect(); dispatch(setError(null)); setElapsed(0); setTimeout(() => setRtState(rt.state()), 100); }}>
            Retry
          </button>
        )}
      </div>

      {/* Live debug — always shown, updates every second. Lets the
          user (and remote support) see exactly what's failing without
          having to click any buttons. */}
      <div style={{ marginTop: 10, fontSize: 11, fontFamily: "ui-monospace, Menlo, Consolas, monospace", background: "rgba(0,0,0,0.25)", padding: 10, borderRadius: 8, lineHeight: 1.6, color: "var(--text-dim)", wordBreak: "break-all" }}>
        <div><strong style={{ color: "var(--text)" }}>WS state:</strong> {rtState.readyStateLabel}</div>
        <div><strong style={{ color: "var(--text)" }}>Token:</strong> {rtState.hasToken ? "✓ present" : "✗ missing"}</div>
        <div><strong style={{ color: "var(--text)" }}>URL:</strong> {rtState.lastUrl ? rtState.lastUrl.replace(/token=[^&]+/, "token=…") : "(not yet attempted)"}</div>
        {diag && (
          <div><strong style={{ color: "var(--text)" }}>API /health:</strong>{" "}
            <span style={{ color: diag.reachable ? "var(--good)" : "var(--bad)" }}>
              {diag.reachable ? "✓ reachable" : `✗ ${diag.network_error || diag.status}`}
            </span>
          </div>
        )}
        {rtState.lastCloseCode != null && (
          <div><strong style={{ color: "var(--text)" }}>Last close:</strong> code {rtState.lastCloseCode}{rtState.lastCloseReason ? ` "${rtState.lastCloseReason}"` : ""}</div>
        )}
        {rtState.terminalError && (
          <div style={{ color: "var(--bad)" }}><strong>Terminal error:</strong> {rtState.terminalError}</div>
        )}
        {rtState.reconnectAttempts > 0 && (
          <div><strong style={{ color: "var(--text)" }}>Reconnect attempts:</strong> {rtState.reconnectAttempts} / 6</div>
        )}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button className="tw-pill" style={{ cursor: "pointer", fontSize: 11 }} onClick={runDiagnose} disabled={running}>
            {running ? "Probing…" : "Re-probe API"}
          </button>{" "}
          <button className="tw-pill" style={{ cursor: "pointer", fontSize: 11, background: "rgba(239,68,68,0.2)" }} onClick={hardReload}>
            Hard reload (clears cache)
          </button>
        </div>
      </div>
    </div>
  );
}

function PlayerSlot({ player, you }) {
  const dispatch = useDispatch();
  if (!player) return <div className="tw-online-slot empty">Waiting…</div>;
  const openProfile = () => {
    if (you || !player.id) return;
    dispatch(setModal({ name: "publicProfile", data: { userId: player.id } }));
  };
  return (
    <div
      className="tw-online-slot"
      role={you ? undefined : "button"}
      tabIndex={you ? undefined : 0}
      onClick={openProfile}
      onKeyDown={you ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfile(); } }}
      style={{ cursor: you ? "default" : "pointer" }}
      title={you ? undefined : `View ${player.username}'s profile`}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 6 }}>
        <OtherAvatar value={player.avatar} size={36} cosmetics={player.public_cosmetics} />
      </div>
      <div style={{ fontFamily: "Fredoka", fontSize: 15, fontWeight: 700, display: "flex", justifyContent: "center" }}>
        <PlayerFlair username={`${player.username}${you ? " (you)" : ""}`} cosmetics={player.public_cosmetics} badges={player.badges} compact />
      </div>
      {player.ready && <div style={{ fontSize: 11, color: "var(--good)", marginTop: 4 }}>✓ Ready</div>}
    </div>
  );
}

// Daily VS leaderboard panel — surfaces today's top players in the
// Online lobby. Two purposes:
//   1. Social proof / aspiration ("MrAlex has 7 wins today, I want
//      that")
//   2. Yesterday-prize claim banner — if the player ranked top-10
//      yesterday, they get a one-tap claim CTA with the rewards
//      revealed in the toast.
function DailyVsPanel() {
  const dispatch = useDispatch();
  const me = useSelector((s) => s.auth.user);
  const [rows, setRows] = useState([]);
  const [yesterday, setYesterday] = useState(null);
  const [claiming, setClaiming] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Today's leaderboard (public).
    api.get("/vs/daily/today").then((r) => {
      if (!cancelled) setRows(r.data?.leaderboard || []);
    }).catch(() => {});
    // Yesterday's leaderboard — for the claim CTA. Computed
    // client-side from UTC.
    const d = new Date(Date.now() - 86400000);
    const ystr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    api.get(`/vs/daily/today?date=${ystr}`).then((r) => {
      if (cancelled || !me) return;
      const lb = r.data?.leaderboard || [];
      const idx = lb.findIndex((row) => row.user_id === me.id);
      if (idx >= 0 && idx < 10) setYesterday({ date: ystr, rank: idx + 1 });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [me?.id]);

  const claim = async () => {
    if (!yesterday || claiming) return;
    setClaiming(true);
    try {
      const r = await api.post("/vs/daily/claim", { date: yesterday.date });
      if (r.data.ok) {
        const bits = [];
        if (r.data.coins) bits.push(`+${r.data.coins} coins`);
        if (r.data.spins) bits.push(`+${r.data.spins} spin${r.data.spins === 1 ? "" : "s"}`);
        if (r.data.cosmetic) bits.push(`cosmetic: ${r.data.cosmetic}`);
        dispatch(pushToast({ icon: "🏆", title: `Yesterday's rank #${r.data.rank} claimed`, text: bits.join(" · "), duration: 5000 }));
        dispatch(fetchStats());
        setYesterday(null);
      }
    } catch (e) {
      const err = e?.response?.data?.error;
      if (err === "already_claimed") setYesterday(null);
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't claim", text: err || "Try again." }));
    }
    setClaiming(false);
  };

  return (
    <div className="tw-card">
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontFamily: "Fredoka", fontWeight: 700 }}>🏆 Daily VS · Top players today</div>
        <span className="tw-pill" style={{ fontSize: 11 }}>Top 3: cosmetic + 200 coins · Top 10: 100 coins</span>
      </div>

      {yesterday && (
        <button className="tw-btn block" onClick={claim} disabled={claiming}
          style={{ marginBottom: 8, background: "linear-gradient(135deg, #f59e0b, #ef4444)", fontWeight: 700 }}>
          {claiming ? "Claiming…" : `🏆 Claim yesterday's rank #${yesterday.rank} prize`}
        </button>
      )}

      {rows.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 8 }}>
          No ranked wins recorded yet today. Be the first.
        </div>
      ) : (
        rows.slice(0, 8).map((r, i) => {
          const isMe = me && r.user_id === me.id;
          return (
            <div key={r.user_id} className="tw-row" style={{
              justifyContent: "space-between", padding: "6px 4px",
              borderBottom: i < Math.min(rows.length, 8) - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
              background: isMe ? "rgba(124,58,237,0.18)" : "transparent",
              borderRadius: isMe ? 6 : 0,
              fontWeight: isMe ? 700 : 500,
            }}>
              <span style={{ minWidth: 28, color: i < 3 ? "#fbbf24" : "var(--text-dim)", fontWeight: 700 }}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
              </span>
              <span style={{ flex: 1 }}>{r.username}{isMe ? " (you)" : ""}</span>
              <span style={{ fontFamily: "Fredoka", fontWeight: 700 }}>{r.wins}W</span>
            </div>
          );
        })
      )}
    </div>
  );
}

// Comeback Boost indicator — renders only when the player has the
// boost flag armed in their stats. Pulls from `s.stats` directly so
// it updates the moment fetchStats lands the armed=1 response after
// a loss. Self-gating, safe to mount unconditionally.
function ComebackBoostIndicator() {
  const armed = useSelector((s) => !!s.stats.comeback_boost_active);
  if (!armed) return null;
  return (
    <div className="tw-row" style={{
      marginTop: 12, padding: "10px 14px", borderRadius: 12,
      background: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(239,68,68,0.18))",
      border: "1px solid rgba(245,158,11,0.5)",
      gap: 10, alignItems: "center",
    }}>
      <div style={{ fontSize: 24 }} aria-hidden="true">💪</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 13 }}>Comeback Boost armed</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
          Next ranked win gets +50% rating (cashes in automatically).
        </div>
      </div>
    </div>
  );
}

// Series badge — renders "🏆 1 - 0" for best-of-3 matches showing
// the current round-wins tally. Highlights the user's side so they
// instantly know if they're up, down, or tied in the series.
function SeriesBadge({ series, me, opponent }) {
  if (!series || series.format !== "bo3") return null;
  const myWins  = (me && series.roundWins?.[me.id]) || 0;
  const oppWins = (opponent && series.roundWins?.[opponent.id]) || 0;
  const round   = (series.round || 0) + 1; // current round (1-indexed)
  return (
    <div className="tw-row" style={{ justifyContent: "center", gap: 10, marginBottom: 10 }}>
      <span className="tw-pill" style={{ fontSize: 11, color: "var(--text-dim)" }}>Best of 3 · Round {round}</span>
      <span className="tw-pill" style={{
        fontFamily: "Fredoka", fontWeight: 700,
        background: "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(236,72,153,0.3))",
        border: "1px solid rgba(236,72,153,0.5)", color: "#fff",
      }}>
        🏆 {myWins} – {oppWins}
      </span>
    </div>
  );
}

// Rivalry strip — persistent head-to-head record between THIS user
// and the given opponent. Renders nothing if they've never played
// before (no need to show "0 - 0" — looks broken). Lazy-loads on
// mount; the lookup is cheap (single indexed row).
function RivalryStrip({ opponentId, opponentName }) {
  const [rivalry, setRivalry] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/vs/rivalry/${opponentId}`).then((r) => {
      if (!cancelled) setRivalry(r.data || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [opponentId]);
  if (!rivalry || rivalry.total === 0) return null;
  const { my_wins, opp_wins, ties, total } = rivalry;
  const heat = my_wins > opp_wins ? "winning" : opp_wins > my_wins ? "losing" : "tied";
  const emoji = heat === "winning" ? "🔥" : heat === "losing" ? "💢" : "🤝";
  const color = heat === "winning" ? "var(--good)" : heat === "losing" ? "var(--bad)" : "var(--text-dim)";
  return (
    <div className="tw-row" style={{
      marginTop: 16, padding: "10px 14px", borderRadius: 12,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.1)",
      justifyContent: "space-between", alignItems: "center",
    }}>
      <div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.6 }}>
          {emoji} Rivalry
        </div>
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 14, marginTop: 2 }}>
          You vs {opponentName} · {total} match{total === 1 ? "" : "es"}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 800, color }}>
          {my_wins}<span style={{ color: "var(--text-dim)", fontSize: 14, fontWeight: 600 }}> – </span>{opp_wins}
        </div>
        {ties > 0 && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{ties} tie{ties === 1 ? "" : "s"}</div>}
      </div>
    </div>
  );
}

// Live race-bar — horizontal score visualization. Marker position
// shifts toward whichever side is winning by score, with a marker
// at exact midpoint when tied. Pure CSS animation handles the
// smooth transition between updates. Renders nothing if either
// player slot is missing (shouldn't happen mid-match).
function RaceBar({ me, opponent }) {
  if (!me || !opponent) return null;
  const myScore = me.score || 0;
  const oppScore = opponent.score || 0;
  const total = myScore + oppScore;
  // 50% when tied; slides toward the leader proportionally.
  const myPct = total > 0 ? (myScore / total) * 100 : 50;
  return (
    <div className="tw-row" style={{ alignItems: "center", gap: 8, marginTop: 10, padding: "8px 4px" }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", minWidth: 40, textAlign: "right" }}>
        {myScore}
      </span>
      <div style={{
        flex: 1, height: 12, borderRadius: 999, position: "relative",
        background: "linear-gradient(90deg, rgba(34,211,238,0.15), rgba(124,58,237,0.15), rgba(236,72,153,0.15))",
        border: "1px solid rgba(255,255,255,0.08)",
        overflow: "hidden",
      }}>
        {/* Filled portion = my share of total score. Transitions
            smoothly so the bar visibly "slides" on each score update. */}
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${myPct}%`,
          background: "linear-gradient(90deg, #22d3ee, #7c3aed)",
          transition: "width 0.6s cubic-bezier(0.25, 1, 0.5, 1)",
        }} />
        {/* Center divider — visual reference for "tied". */}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.2)" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", minWidth: 40 }}>
        {oppScore}
      </span>
    </div>
  );
}

// Power Cards tray — three cards, each useable once per match.
// Player taps a card to play it; server validates inventory and
// applies the effect. Cards bank zero — use it or lose the match.
//
// Why 3 cards (not 5 or 10): keeps each decision meaningful. Too
// many cards = analysis paralysis + dilutes the strategy. Three
// useable-once cards force the player to GUESS which questions
// matter most — and that's the dopamine.
function PowerCardTray({ inventory, oppInventory, disabled }) {
  if (!inventory) return null;
  // Arena-pivoted labels. The server-side IDs stay as sniper/cut/double
  // (back-compat with deployed players + the use_card switch in
  // realtime.js), but the UI copy describes the mini-game behavior:
  //   sniper = see opponent's submitted SCORE the moment they finish
  //   cut    = opponent's next mini-game has 30% less time on the clock
  //   double = your next mini-game score is doubled
  const cards = [
    { id: "sniper", icon: "👁️",   label: "Spy",        desc: "See your opponent's score the instant they submit." },
    { id: "cut",    icon: "✂️",    label: "Sabotage",   desc: "Cut 30% off your opponent's next mini-game timer." },
    { id: "double", icon: "✖️2",   label: "Multiplier", desc: "Double your next mini-game's score." },
  ];
  const play = (card) => {
    if (disabled) return;
    if ((inventory[card] || 0) <= 0) return;
    sfx.click?.();
    rt.send({ type: "use_card", card });
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: 0.6, textTransform: "uppercase" }}>
          🃏 Your Power Cards
        </span>
        {oppInventory && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Opp: {Object.values(oppInventory).reduce((a, b) => a + b, 0)} left
          </span>
        )}
      </div>
      <div className="tw-row" style={{ gap: 6 }}>
        {cards.map((c) => {
          const remaining = inventory[c.id] || 0;
          const used = remaining <= 0;
          return (
            <button
              key={c.id}
              disabled={used || disabled}
              onClick={() => play(c.id)}
              title={used ? "Already used this match" : c.desc}
              style={{
                flex: 1,
                padding: "10px 6px",
                borderRadius: 12,
                border: `1px solid ${used ? "rgba(255,255,255,0.05)" : "rgba(124,58,237,0.4)"}`,
                background: used ? "rgba(255,255,255,0.02)"
                              : "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(236,72,153,0.18))",
                color: used ? "var(--text-dim)" : "var(--text)",
                cursor: used || disabled ? "not-allowed" : "pointer",
                opacity: used ? 0.5 : 1,
                fontFamily: "Fredoka",
                fontWeight: 700,
                fontSize: 12,
                lineHeight: 1.2,
                transition: "transform 0.12s ease",
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 2 }}>{c.icon}</div>
              <div>{c.label}</div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2, fontWeight: 600 }}>
                {used ? "USED" : "ready"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScoreCard({ player, highlight, answered }) {
  const dispatch = useDispatch();
  if (!player) return <div className="tw-online-score" />;
  const openProfile = () => {
    if (highlight || !player.id) return;
    dispatch(setModal({ name: "publicProfile", data: { userId: player.id } }));
  };
  return (
    <div
      className={`tw-online-score ${highlight ? "you" : ""} ${answered ? "answered" : "pending"}`}
      role={highlight ? undefined : "button"}
      tabIndex={highlight ? undefined : 0}
      onClick={openProfile}
      onKeyDown={highlight ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfile(); } }}
      style={{ cursor: highlight ? "default" : "pointer" }}
      title={highlight ? undefined : `View ${player.username}'s profile`}
    >
      <div className="tw-online-score-name" style={{ display: "inline-flex", justifyContent: highlight ? "flex-start" : "flex-end", gap: 6, width: "100%" }}>
        <PlayerFlair username={`${player.username}${highlight ? " ★" : ""}`} cosmetics={player.public_cosmetics} badges={player.badges} compact />
      </div>
      <div className="tw-online-score-value">{player.score}</div>
      <div className="tw-online-score-sub">{player.correct} right</div>
      <div className={`tw-online-status ${answered ? "in" : "out"}`}>
        {answered ? "✓ Locked in" : "Thinking…"}
      </div>
    </div>
  );
}

// Banner spanning above the question to make the live answer state
// unambiguous — what does the player do RIGHT NOW.
function AnswerStatusBanner({ picked, opponentAnswered, opponentName }) {
  let label, sub, tone;
  if (picked && opponentAnswered) {
    label = "Both answered — revealing…";
    sub = "Hold tight, results in a moment.";
    tone = "ok";
  } else if (picked && !opponentAnswered) {
    label = "Waiting on " + opponentName;
    sub = "You locked in your answer. They're still thinking.";
    tone = "waiting";
  } else if (!picked && opponentAnswered) {
    label = "Your move — lock in your answer!";
    sub = opponentName + " already answered. Don't let them win this one.";
    tone = "urgent";
  } else {
    label = "Both still answering";
    sub = "First to lock in gets the speed bonus.";
    tone = "race";
  }
  return <div className={`tw-online-status-banner ${tone}`}>
    <div className="tw-online-status-banner-title">{label}</div>
    <div className="tw-online-status-banner-sub">{sub}</div>
  </div>;
}

// ─── Match End ──────────────────────────────────────────────────────────────
// Doubles as the rematch-vote screen. Both players have a short window
// (room.continueDeadline) to opt into another round. If either declines
// or the timer runs out, the server tears the room down and we go home.
function MatchEnd() {
  const dispatch = useDispatch();
  const matchEnd = useSelector((s) => s.online.matchEnd);
  const room = useSelector((s) => s.online.room);
  const me = useSelector((s) => s.auth.user);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  if (!matchEnd) return null;
  const won = me && matchEnd.winnerId === me.id;
  const tie = !matchEnd.winnerId;
  const mine = matchEnd.players.find((p) => p && me && p.id === me.id);
  const opp = matchEnd.players.find((p) => p && (!me || p.id !== me.id));
  const isFriendly = matchEnd.kind === "private" || room?.kind === "private";
  const sessionScores = matchEnd.sessionScores || room?.sessionScores;
  const roundNumber = matchEnd.roundNumber || room?.rounds || 1;
  // Server snapshots the per-player session state BEFORE applying this
  // match's outcome — use that to compute the streak delta precisely.
  const prevMyStreak = (matchEnd.prevSessionScores
    && me
    && matchEnd.prevSessionScores[me.id]
    && matchEnd.prevSessionScores[me.id].streak) || 0;

  const deadline = room?.continueDeadline || matchEnd.continueDeadline;
  const remaining = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
  const myVote = room?.continueVotes?.[me?.id];
  const oppVote = opp && room?.continueVotes?.[opp.id];
  const oppWaiting = myVote === true && oppVote == null;
  const oppDeclined = oppVote === false;

  const vote = (accept) => {
    sfx.click();
    rt.send({ type: "continue_vote", accept });
  };
  const findNew = () => {
    sfx.click();
    rt.send({ type: "continue_vote", accept: false });
    dispatch(leftRoom());
    rt.send({ type: "quick_match", difficulty: matchEnd.difficulty || room?.difficulty || "medium" });
    dispatch(setWaiting(true));
  };
  const goHome = () => {
    rt.send({ type: "continue_vote", accept: false });
    dispatch(leftRoom());
    dispatch(setView("home"));
  };

  return (
    <div className="tw-col">
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 32, fontWeight: 700 }}>
          {tie ? "🤝 Tie!" : won ? "🏆 You Win!" : "Good game"}
        </div>
        <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 12 }}>
          {isFriendly ? "Friendly match — score kept, leaderboard unaffected" : `Quick Match · ${matchEnd.difficulty || "medium"} bracket`}
        </div>

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

        {/* Per-round breakdown. The shareable receipt: which mini-games
            were played, who scored what, who won each round. Drives
            "look how badly I lost at Memory" screenshots, which are
            the natural marketing artifact for a mini-game arena. */}
        {Array.isArray(matchEnd.rounds) && matchEnd.rounds.length > 0 && (
          <div style={{
            marginTop: 16, padding: "10px 8px", borderRadius: 12,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{
              fontSize: 11, color: "var(--text-dim)", fontWeight: 700,
              letterSpacing: 1, marginBottom: 8, textAlign: "center",
            }}>ROUND BY ROUND</div>
            {matchEnd.rounds.map((r) => {
              const myS = me && r.scores[me.id] !== undefined ? r.scores[me.id] : 0;
              const oppS = opp && r.scores[opp.id] !== undefined ? r.scores[opp.id] : 0;
              const wonRound = myS > oppS;
              const tieRound = myS === oppS;
              const meta = gameMeta(r.game_type);
              return (
                <div key={r.idx} className="tw-row" style={{
                  justifyContent: "space-between", padding: "6px 10px",
                  borderRadius: 8, marginBottom: 4,
                  background: wonRound ? "rgba(16,185,129,0.10)"
                            : tieRound ? "rgba(245,158,11,0.08)"
                                       : "rgba(239,68,68,0.08)",
                  fontSize: 13,
                }}>
                  <span style={{ flex: 1, textAlign: "left" }}>
                    {meta.icon} {meta.name}
                  </span>
                  <span style={{ fontFamily: "Fredoka", fontWeight: 700, minWidth: 80, textAlign: "right" }}>
                    <span style={{ color: wonRound ? "var(--good)" : "var(--text)" }}>{myS}</span>
                    <span style={{ color: "var(--text-dim)", margin: "0 4px" }}>vs</span>
                    <span style={{ color: !wonRound && !tieRound ? "var(--bad)" : "var(--text)" }}>{oppS}</span>
                  </span>
                  <span style={{ minWidth: 22, textAlign: "center", fontSize: 14 }}>
                    {wonRound ? "✓" : tieRound ? "—" : "✗"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Session-level scoreboard — running W/L tally across rematches
            in this room. Hidden on round 1 (no history yet). */}
        {roundNumber >= 1 && sessionScores && (
          <SessionScoreboard
            sessionScores={sessionScores}
            mePlayer={mine}
            oppPlayer={opp}
            prevMyStreak={prevMyStreak}
            didIWin={!!won}
            roundNumber={roundNumber}
          />
        )}

        {/* Continue vote area — only renders while the window is open. */}
        {remaining > 0 && (
          <div className="tw-card" style={{ marginTop: 18, background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.4)" }}>
            <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16 }}>
              Play another round?
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
              Both players must agree within <strong>{remaining}s</strong>. No penalty either way.
            </div>
            {myVote === true && oppVote == null && (
              <div style={{ marginTop: 8, color: "var(--warn)", fontSize: 12 }}>
                ✓ You're in — waiting on {opp?.username || "opponent"}…
              </div>
            )}
            {myVote === true && oppVote === true && (
              <div style={{ marginTop: 8, color: "var(--good)", fontSize: 12 }}>
                ✓ Both ready — starting next round!
              </div>
            )}
            {oppDeclined && (
              <div style={{ marginTop: 8, color: "var(--bad)", fontSize: 12 }}>
                {opp?.username || "Opponent"} declined.
              </div>
            )}

            <div className="tw-row" style={{ justifyContent: "center", marginTop: 12, flexWrap: "wrap", gap: 6 }}>
              {myVote == null && (
                <>
                  <button className="tw-btn" onClick={() => vote(true)} title="Play another round with the same opponent">
                    🔁 Rematch
                  </button>
                  <button className="tw-btn ghost" onClick={() => vote(false)} title="End the session">
                    ✕ Decline
                  </button>
                </>
              )}
              {myVote === true && (
                <button className="tw-btn ghost" onClick={() => vote(false)} title="Cancel your rematch vote and end the session">
                  Cancel my vote
                </button>
              )}
              {!isFriendly && myVote !== true && (
                <button className="tw-btn ghost" onClick={findNew} title="Decline and queue for a new opponent">
                  🔀 New opponent
                </button>
              )}
              <button className="tw-btn ghost" onClick={goHome}>🏠 Home</button>
            </div>
          </div>
        )}

        {/* Fallback exit row — always rendered when there's NO deadline
            (e.g., server-side bug, friendly match without continue vote)
            or when the deadline has elapsed. Guarantees the player can
            always close the match-end screen. */}
        {(remaining == null || remaining === 0) && (
          <div className="tw-row" style={{ justifyContent: "center", marginTop: 18 }}>
            <button className="tw-btn ghost" onClick={goHome}>Home</button>
          </div>
        )}
      </div>
    </div>
  );
}
