import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { decode } from "html-entities";
import { api } from "../api/client";
import { setView, pushToast } from "../store/uiSlice";
import { fetchStats } from "../store/statsSlice";
import { sfx } from "../utils/sound";
import { snarkForAnswer, snarkForRound } from "../utils/snark";

// FriendChallenges — list + play UI for the head-to-head challenge feature.
//
// Two screens:
//   1. List: incoming (someone challenged you, your move), outgoing
//      (waiting for them), past (resolved).
//   2. Play: when you tap "Play" on an incoming challenge or "Replay
//      against me" on an outgoing one, you land here — same 5 questions
//      both players see, locked-in 15s per question, snark after each.
//
// Result is submitted server-side; resolution fires whenever both
// sides have played (or the receiver timed out). Live notification
// arrives via the realtime channel.

// ── Per-question card (shared with public daily — light copy here to
//    keep this file self-contained; not worth a generic abstraction yet).
function Question({ q, index, total, onAnswer }) {
  const [picked, setPicked] = useState(null);
  const [snark, setSnark] = useState(null);
  const startMs = React.useRef(Date.now());
  const correct = q.correct_answer;
  const [remaining, setRemaining] = useState(15);

  useEffect(() => {
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (remaining === 0 && picked === null) handlePick(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const handlePick = (choice, timedOut) => {
    if (picked !== null) return;
    sfx.click();
    const ms = Date.now() - startMs.current;
    const isCorrect = !timedOut && choice === correct;
    if (isCorrect) sfx.correct?.(); else sfx.wrong?.();
    setPicked(timedOut ? "__timeout__" : choice);
    setSnark(snarkForAnswer({ correct: isCorrect, timedOut, ms }));
    setTimeout(() => onAnswer({ correct: isCorrect, timedOut: !!timedOut, ms }), timedOut ? 2000 : 1500);
  };

  const choices = React.useMemo(() => {
    const all = [...(q.incorrect_answers || []), correct];
    // Deterministic shuffle by question id so both players see the
    // same order — comparable results.
    let s = (q.id || 0) >>> 0;
    const shuffled = all.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [q.id]);

  return (
    <div className="tw-card">
      <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span className="tw-pill" style={{ fontSize: 12 }}>Q{index + 1} / {total}</span>
        <span className="tw-pill" style={{ fontSize: 12, color: remaining <= 5 ? "var(--bad)" : "var(--text-dim)" }}>⏱ {remaining}s</span>
      </div>
      <div style={{ fontFamily: "Fredoka", fontSize: 20, fontWeight: 600, margin: "8px 0 14px", minHeight: 80 }}>
        {decode(q.question || "")}
      </div>
      <div className="tw-col" style={{ gap: 8 }}>
        {choices.map((c, i) => {
          const isPickedRight = picked !== null && c === correct;
          const isPickedWrong = picked === c && c !== correct;
          return (
            <button key={i} style={{
              textAlign: "left", padding: "12px 14px", borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: isPickedRight ? "rgba(16,185,129,0.25)"
                        : isPickedWrong ? "rgba(239,68,68,0.25)"
                        : (picked !== null && c === correct) ? "rgba(16,185,129,0.18)"
                        : "rgba(255,255,255,0.04)",
              color: picked === c || (picked !== null && c === correct) ? "#fff" : "var(--text)",
              cursor: picked === null ? "pointer" : "default", fontSize: 15, fontWeight: 600,
            }} onClick={() => handlePick(c, false)} disabled={picked !== null}>
              {decode(c)}
            </button>
          );
        })}
      </div>
      {snark && (
        <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 12, background: "rgba(124,58,237,0.16)", border: "1px solid rgba(124,58,237,0.4)", fontFamily: "Fredoka", fontWeight: 600, textAlign: "center" }}>
          {snark}
        </div>
      )}
    </div>
  );
}

// ── Per-screen logic ─────────────────────────────────────────────

function ListView({ challenges, me, onOpen, onSend, friends }) {
  const dispatch = useDispatch();

  const incoming = challenges.filter((c) => c.receiver_id === me.id && c.status === "pending" && c.receiver_correct === null);
  const outgoing = challenges.filter((c) => c.sender_id === me.id && c.status === "pending");
  const past     = challenges.filter((c) => c.status !== "pending");

  return (
    <div className="tw-col">
      <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }} onClick={() => dispatch(setView("home"))}>← Back</button>

      <div className="tw-card">
        <div className="tw-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700 }}>⚔️ Friend Challenges</div>
            <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
              Send a 5-question challenge. They have 24h to beat your score.
            </div>
          </div>
        </div>
      </div>

      <button className="tw-btn block" onClick={onSend}>+ New challenge</button>

      {incoming.length > 0 && (
        <div className="tw-card">
          <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Your move ({incoming.length})</div>
          {incoming.map((c) => {
            const hoursLeft = Math.max(0, Math.floor((c.expires_at - Date.now()) / (60 * 60 * 1000)));
            return (
              <button key={c.id} className="tw-row" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", width: "100%", background: "transparent", border: "none", cursor: "pointer", color: "var(--text)" }} onClick={() => onOpen(c.id)}>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 700 }}>{c.sender_username}</div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{hoursLeft}h left · wager {c.wager}</div>
                </div>
                <span className="tw-pill" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "#fff", border: "none", fontWeight: 700 }}>Play →</span>
              </button>
            );
          })}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="tw-card">
          <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Waiting on them</div>
          {outgoing.map((c) => (
            <div key={c.id} className="tw-row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{c.receiver_username}</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  You: {c.sender_correct ?? "—"}/5 · wager {c.wager}
                </div>
              </div>
              <span className="tw-pill" style={{ fontSize: 11 }}>⏳ pending</span>
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div className="tw-card">
          <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Past results</div>
          {past.slice(0, 10).map((c) => {
            const youSent = c.sender_id === me.id;
            const oppName = youSent ? c.receiver_username : c.sender_username;
            const yourScore = youSent ? c.sender_correct : c.receiver_correct;
            const oppScore  = youSent ? c.receiver_correct : c.sender_correct;
            const outcome = c.status === "expired" ? "expired"
                          : c.winner_id === me.id ? "won"
                          : c.winner_id ? "lost"
                          : "tied";
            const color = outcome === "won" ? "var(--good)"
                        : outcome === "lost" ? "var(--bad)"
                        : "var(--text-dim)";
            const icon = outcome === "won" ? "🏆"
                       : outcome === "lost" ? "💔"
                       : outcome === "tied" ? "🤝"
                       : "⏰";
            return (
              <div key={c.id} className="tw-row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{icon} vs {oppName}</div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {yourScore ?? "—"} – {oppScore ?? "—"}
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color }}>
                  {outcome.toUpperCase()}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {challenges.length === 0 && (
        <div className="tw-card" style={{ textAlign: "center", color: "var(--text-dim)" }}>
          No challenges yet. Tap "+ New challenge" to send one.
        </div>
      )}
    </div>
  );
}

function SendView({ friends, onSent, onCancel }) {
  const dispatch = useDispatch();
  const [friendId, setFriendId] = useState(null);
  const [wager, setWager] = useState(50);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!friendId || busy) return;
    setBusy(true);
    sfx.click();
    try {
      const r = await api.post("/challenges/send", { friend_id: friendId, wager });
      if (r.data.ok) {
        dispatch(pushToast({ icon: "⚔️", title: "Challenge sent", text: "They have 24h to play." }));
        dispatch(fetchStats());
        onSent();
      }
    } catch (e) {
      const err = e?.response?.data?.error;
      dispatch(pushToast({
        icon: "⚠️",
        title: "Couldn't send",
        text: err === "insufficient_funds" ? `You need ${wager} coins for the wager.`
            : err === "not_friends" ? "You need to be friends first."
            : err === "challenge_already_open" ? "You already have a pending challenge with them."
            : "Try again.",
      }));
    }
    setBusy(false);
  };

  return (
    <div className="tw-col">
      <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }} onClick={onCancel}>← Cancel</button>

      <div className="tw-card">
        <div style={{ fontFamily: "Fredoka", fontSize: 20, fontWeight: 700, marginBottom: 4 }}>New challenge</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>Pick a friend. Both play the same 5 questions. Higher score wins the pot.</div>

        {friends.length === 0 ? (
          <div className="tw-card" style={{ textAlign: "center", color: "var(--text-dim)", background: "rgba(255,255,255,0.02)" }}>
            No friends yet. Add some from your Profile → Friends tab.
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Pick a friend</div>
            <div className="tw-col" style={{ gap: 6, maxHeight: 240, overflowY: "auto", marginBottom: 14 }}>
              {friends.map((f) => (
                <button key={f.id} style={{
                  padding: "10px 12px", borderRadius: 10,
                  border: friendId === f.id ? "1px solid rgba(236,72,153,0.6)" : "1px solid rgba(255,255,255,0.1)",
                  background: friendId === f.id ? "rgba(236,72,153,0.18)" : "rgba(255,255,255,0.04)",
                  color: "var(--text)", textAlign: "left", cursor: "pointer", fontWeight: 600,
                }} onClick={() => setFriendId(f.id)}>
                  {f.username}
                </button>
              ))}
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Wager (coins)</div>
            <div className="tw-row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {[0, 25, 50, 100, 250].map((w) => (
                <button key={w} className="tw-pill" style={{
                  cursor: "pointer",
                  background: wager === w ? "linear-gradient(135deg, #f59e0b, #ef4444)" : undefined,
                  color: wager === w ? "#fff" : undefined,
                  border: wager === w ? "none" : undefined,
                  fontWeight: wager === w ? 700 : 600,
                }} onClick={() => setWager(w)}>
                  {w === 0 ? "No wager" : `🪙 ${w}`}
                </button>
              ))}
            </div>

            <button className="tw-btn block" disabled={!friendId || busy} onClick={send}>
              {busy ? "Sending…" : friendId ? `Send challenge${wager > 0 ? ` (−${wager} coins)` : ""}` : "Pick a friend first"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PlayView({ challengeId, onDone }) {
  const dispatch = useDispatch();
  const [phase, setPhase] = useState("loading");
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState([]);
  const startMsRef = React.useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/challenges/${challengeId}/play`);
        if (cancelled) return;
        setData(r.data);
        startMsRef.current = Date.now();
        setPhase("playing");
      } catch (e) {
        if (cancelled) return;
        setPhase("error");
        dispatch(pushToast({ icon: "⚠️", title: "Couldn't load challenge" }));
      }
    })();
    return () => { cancelled = true; };
  }, [challengeId, dispatch]);

  const onAnswer = ({ correct, timedOut }) => {
    const next = [...results, timedOut ? null : correct];
    setResults(next);
    if (index + 1 < (data?.questions?.length || 0)) {
      setIndex(index + 1);
    } else {
      const correctCount = next.filter((x) => x === true).length;
      const timeMs = Date.now() - startMsRef.current;
      api.post(`/challenges/${challengeId}/submit`, { correct: correctCount, time_ms: timeMs })
        .then(() => {
          dispatch(fetchStats());
          setPhase("submitted");
        })
        .catch(() => setPhase("submitted"));
    }
  };

  if (phase === "loading") return <div className="tw-card" style={{ textAlign: "center", padding: 30 }}><div className="tw-spinner" style={{ margin: "0 auto" }} /></div>;
  if (phase === "error") return <button className="tw-btn block" onClick={onDone}>Back</button>;
  if (phase === "submitted") {
    const correctCount = results.filter((x) => x === true).length;
    const total = data?.questions?.length || 5;
    const grid = results.map((r) => r === true ? "🟩" : r === false ? "🟥" : "🟨").join(" ");
    const snark = snarkForRound({ correct: correctCount, total });
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          Submitted!
        </div>
        <div style={{ fontSize: 38, letterSpacing: 3, margin: "12px 0" }}>{grid}</div>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>{correctCount}/{total}</div>
        <div style={{ marginTop: 10, fontStyle: "italic", color: "var(--text)" }}>{snark}</div>
        <div style={{ marginTop: 10, color: "var(--text-dim)", fontSize: 13 }}>
          Result will land when your opponent plays (or in 24h).
        </div>
        <button className="tw-btn block" style={{ marginTop: 14 }} onClick={onDone}>Back to challenges</button>
      </div>
    );
  }
  const q = data.questions[index];
  return (
    <div className="tw-col">
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>⚔️ Friend Challenge</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
          {data.wager > 0 ? `Wager: ${data.wager} coins · ` : ""}5 questions · 15s each
        </div>
      </div>
      <Question key={index} q={q} index={index} total={data.questions.length} onAnswer={onAnswer} />
    </div>
  );
}

// ── Top-level component — picks the right sub-view ──────────────

export default function FriendChallenges() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [challenges, setChallenges] = useState([]);
  const [friends, setFriends] = useState([]);
  const [mode, setMode] = useState("list"); // list | send | play:<id>
  const [playId, setPlayId] = useState(null);

  const loadAll = async () => {
    try {
      const [c, f] = await Promise.all([
        api.get("/challenges/"),
        api.get("/friends/"),
      ]);
      setChallenges(c.data || []);
      // /friends returns accepted friends (not pending requests)
      setFriends((f.data?.accepted || f.data || []).filter((x) => x && x.id));
    } catch (e) {}
  };
  useEffect(() => { if (user) loadAll(); }, [user]);

  if (!user) {
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Friend Challenges</div>
        <div style={{ color: "var(--text-dim)", marginBottom: 12 }}>Sign in to send and play friend challenges.</div>
        <button className="tw-btn block" onClick={() => dispatch(setView("home"))}>Back to home</button>
      </div>
    );
  }

  if (mode === "send") {
    return <SendView friends={friends} onSent={() => { setMode("list"); loadAll(); }} onCancel={() => setMode("list")} />;
  }
  if (mode.startsWith("play")) {
    return <PlayView challengeId={playId} onDone={() => { setMode("list"); loadAll(); }} />;
  }
  return (
    <ListView
      challenges={challenges}
      me={user}
      friends={friends}
      onOpen={(id) => { setPlayId(id); setMode("play"); }}
      onSend={() => setMode("send")}
    />
  );
}
