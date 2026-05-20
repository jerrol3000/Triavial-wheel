import React, { useEffect, useState, useCallback, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { decode } from "html-entities";
import { api } from "../api/client";
import { rt } from "../realtime/client";
import { setView, pushToast } from "../store/uiSlice";
import { fetchStats } from "../store/statsSlice";
import { sfx } from "../utils/sound";
import { snarkForAnswer, snarkForRound } from "../utils/snark";
import { confirmDialog } from "../utils/confirm";
import { MiniGameRunner, gameMeta } from "../minigames";
import { celebrateWin, celebratePB, commiserate } from "../minigames/_fx";

// FriendChallenges — list + play UI for the head-to-head challenge feature.
//
// What makes this feature work as a hook (not just a feature):
//   - Realtime push from server → list auto-refreshes the SECOND the
//     opponent plays or the result resolves. No "pull to refresh"
//     ritual, no stale "pending" zombie rows. That bug ("they finished
//     but my screen still says pending") killed engagement; fixed.
//   - Wordle-style side-by-side reveal card after resolution. Both
//     players see green/red grid of who got what — instantly shareable.
//   - Head-to-head rivalry chip ("3-1 vs Alex this month") on every
//     past result. Builds persistent feuds, the strongest 1v1 hook.
//   - "Playing right now" + "Just answered" live state on outgoing
//     row turns the wait into part of the show.
//   - One-tap rematch from any past row + double-or-nothing on a loss.

// ── Per-question card (shared with public daily — light copy here to
//    keep this file self-contained; not worth a generic abstraction yet).
function Question({ q, index, total, onAnswer }) {
  const [picked, setPicked] = useState(null);
  const [snark, setSnark] = useState(null);
  const startMs = useRef(Date.now());
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

// ── H2H rivalry chip — "3-1 vs Alex" inline pill. Returns null if no
//    history yet (don't show "0-0" zero state — it's just noise).
function RivalryChip({ h2h, oppId }) {
  const r = h2h && h2h[oppId];
  if (!r || (r.wins + r.losses + r.ties) === 0) return null;
  const dominant = r.wins > r.losses;
  const even = r.wins === r.losses;
  const bg = dominant ? "linear-gradient(135deg, rgba(16,185,129,0.25), rgba(34,197,94,0.2))"
           : even     ? "linear-gradient(135deg, rgba(245,158,11,0.25), rgba(234,179,8,0.2))"
                      : "linear-gradient(135deg, rgba(239,68,68,0.25), rgba(244,63,94,0.2))";
  const label = `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ""}`;
  return (
    <span className="tw-pill" style={{ background: bg, border: "1px solid rgba(255,255,255,0.15)", fontWeight: 700, fontSize: 11 }} title="Wins–losses–ties">
      {dominant ? "📈" : even ? "⚖️" : "📉"} {label}
    </span>
  );
}

// ── Wordle-style result reveal — both players' answer grids side by
//    side, with a clear win/loss/tie banner and a one-tap share. This
//    is the share-able artifact that turns a private match into social
//    proof. Used both on the play-screen end (after the LAST player
//    submits) and as the expanded view of past results.
function ResultRevealCard({ c, me, onClose, onRematch }) {
  const dispatch = useDispatch();
  const youSent = c.sender_id === me.id;
  const youCorrect  = youSent ? c.sender_correct   : c.receiver_correct;
  const oppCorrect  = youSent ? c.receiver_correct : c.sender_correct;
  const youTime     = youSent ? c.sender_time_ms   : c.receiver_time_ms;
  const oppTime     = youSent ? c.receiver_time_ms : c.sender_time_ms;
  const oppName     = youSent ? c.receiver_username : c.sender_username;
  // Outcome priority matters: 'cancelled' / 'expired' must short-circuit
  // BEFORE the winner check, because cancelled challenges have winner_id
  // = null with no plays on either side. Without this branch the card
  // mis-rendered as 🤝 TIED with "Dead heat — both refunded" copy.
  const outcome = c.status === "cancelled" ? "cancelled"
                : c.status === "expired" ? "expired"
                : c.winner_id === me.id ? "won"
                : c.winner_id ? "lost"
                : "tied";
  // Per-question grid isn't stored server-side (only totals), so we
  // approximate using the score: render `youCorrect` greens followed
  // by reds to fill the row. Not the actual question-by-question
  // breakdown, but visually communicates the result. (Real per-Q grid
  // would require storing each player's per-Q result on submit —
  // future enhancement when the backend stores it.)
  const gridFor = (n) => {
    const total = 5;
    const greens = "🟩".repeat(Math.max(0, Math.min(total, n | 0)));
    const reds = "🟥".repeat(Math.max(0, total - (n | 0)));
    return greens + reds;
  };
  const youGrid = youCorrect !== null ? gridFor(youCorrect) : "⬛⬛⬛⬛⬛";
  const oppGrid = oppCorrect !== null ? gridFor(oppCorrect) : "⬛⬛⬛⬛⬛";

  const banner = outcome === "won" ? { icon: "🏆", title: `You beat ${oppName}!`, glow: "rgba(16,185,129,0.55)" }
               : outcome === "lost" ? { icon: "💔", title: `${oppName} won this one.`, glow: "rgba(239,68,68,0.55)" }
               : outcome === "tied" ? { icon: "🤝", title: "Dead heat — both refunded.", glow: "rgba(245,158,11,0.55)" }
               : outcome === "cancelled" ? {
                   icon: "🚫",
                   // Differentiate by perspective — sender vs receiver.
                   // Sender almost never sees this card (they auto-hide on
                   // cancel) but we cover them anyway in case they un-hide
                   // via a future endpoint.
                   title: youSent ? "Challenge withdrawn" : `${oppName} withdrew this challenge`,
                   glow: "rgba(148,163,184,0.45)",
                 }
               : { icon: "⏰", title: `${oppName} didn't play in time.`, glow: "rgba(148,163,184,0.5)" };

  // Snark for the score margin — same generator as solo end-cards.
  const flavor = snarkForRound({ correct: youCorrect || 0, total: 5 });

  const outcomeTag = outcome === "won" ? "🏆 W"
                   : outcome === "lost" ? "💔 L"
                   : outcome === "tied" ? "🤝 Tie"
                   : outcome === "cancelled" ? "🚫 Withdrawn"
                   : "⏰ Expired";
  const shareText = `⚔️ Spinlore Arena · 5 mini-games\nMe:  ${youGrid}  ${youCorrect ?? "—"}/5\n${oppName}: ${oppGrid}  ${oppCorrect ?? "—"}/5\n${outcomeTag}\nhttps://triviawheel.app`;

  const doShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Spinlore Challenge", text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
        dispatch(pushToast({ icon: "📋", title: "Result copied", text: "Paste it wherever." }));
      }
    } catch (e) { /* share cancelled */ }
  };

  return (
    <div className="tw-card" style={{ position: "relative", overflow: "hidden" }}>
      {/* Soft outcome-tinted glow behind everything — outcome shouts
          before the user even reads the text. */}
      <div style={{
        position: "absolute", inset: -40, background: `radial-gradient(circle at top, ${banner.glow}, transparent 60%)`,
        pointerEvents: "none",
      }} />
      <div style={{ position: "relative", textAlign: "center" }}>
        <div style={{ fontSize: 56, lineHeight: 1, animation: "tw-bounce-in 0.6s ease-out" }}>{banner.icon}</div>
        <div style={{ fontFamily: "Fredoka", fontSize: 24, fontWeight: 700, marginTop: 8 }}>{banner.title}</div>
        {c.wager > 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
            {outcome === "won"     ? `+${c.wager * 2} coins`
             : outcome === "lost"  ? `−${c.wager} coins`
                                   : `${c.wager} coins refunded`}
          </div>
        )}

        <div className="tw-row" style={{ justifyContent: "space-around", marginTop: 18, gap: 14, alignItems: "stretch" }}>
          <div style={{ flex: 1, padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, letterSpacing: 1 }}>YOU</div>
            <div style={{ fontSize: 22, letterSpacing: 2, margin: "8px 0" }}>{youGrid}</div>
            <div style={{ fontFamily: "Fredoka", fontWeight: 700 }}>{youCorrect ?? "—"}/5</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{youTime ? `${(youTime / 1000).toFixed(1)}s` : "—"}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", fontFamily: "Fredoka", fontWeight: 700, fontSize: 18, color: "var(--text-dim)" }}>VS</div>
          <div style={{ flex: 1, padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700, letterSpacing: 1 }}>{(oppName || "").toUpperCase()}</div>
            <div style={{ fontSize: 22, letterSpacing: 2, margin: "8px 0" }}>{oppGrid}</div>
            <div style={{ fontFamily: "Fredoka", fontWeight: 700 }}>{oppCorrect ?? "—"}/5</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{oppTime ? `${(oppTime / 1000).toFixed(1)}s` : "—"}</div>
          </div>
        </div>

        {flavor && outcome !== "expired" && outcome !== "cancelled" && (
          <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 12, background: "rgba(124,58,237,0.16)", border: "1px solid rgba(124,58,237,0.4)", fontFamily: "Fredoka", fontWeight: 600 }}>
            {flavor}
          </div>
        )}

        <div className="tw-row" style={{ justifyContent: "center", marginTop: 14, gap: 8, flexWrap: "wrap" }}>
          <button className="tw-btn" onClick={doShare} title="Share result">📤 Share</button>
          {/* Double-or-nothing only after a loss — that's the natural
              "one more shot to claw it back" hook. After a win, plain
              rematch (same wager) keeps the streak going. */}
          {onRematch && outcome === "lost" && c.wager > 0 && (
            <button
              className="tw-btn"
              style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "#fff", border: "none", fontWeight: 700 }}
              onClick={() => onRematch(youSent ? c.receiver_id : c.sender_id, c.wager * 2)}
              title="Send a rematch with double the wager"
            >
              🔥 Double or nothing
            </button>
          )}
          {onRematch && outcome !== "lost" && (
            <button className="tw-btn ghost" onClick={() => onRematch(youSent ? c.receiver_id : c.sender_id, c.wager || 0)}>
              ⚔️ Rematch
            </button>
          )}
          {onClose && <button className="tw-btn ghost" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  );
}

// ── Per-screen logic ─────────────────────────────────────────────

function ListView({ challenges, h2h, me, onOpen, onSend, friends, onRematch, onCancel, onDismiss, onClearHistory, lastChange, expandedId, onExpand }) {
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
            <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700 }}>⚔️ Friend Arena</div>
            <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
              Send a 5-mini-game duel. They have 24h to beat your scores.
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
                <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    {c.sender_username}
                    <RivalryChip h2h={h2h} oppId={c.sender_id} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {hoursLeft}h left · wager {c.wager}
                    {c.sender_correct !== null && (
                      <> · <span style={{ color: "var(--good)", fontWeight: 700 }}>they scored {c.sender_correct}/5 — beat it</span></>
                    )}
                  </div>
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
          {outgoing.map((c) => {
            // Live state, computed off the row + the last realtime
            // change ping. If the receiver has scored, we already have
            // their score — show it as "they got 4/5, eyes on you".
            // Otherwise stay on "pending".
            const opponentScored = c.receiver_correct !== null;
            // Spotlight the most-recently-updated row when a realtime
            // event lands — a subtle glow draws the eye without
            // shouting.
            const isFresh = lastChange && lastChange.challenge_id === c.id && (Date.now() - lastChange.at) < 6000;
            // Cancel is only allowed BEFORE the receiver has answered.
            // Once they've played their side, the sender is locked in —
            // letting them bail would be a wager-grief escape hatch
            // (the server enforces this too; we hide the button to
            // match).
            const canCancel = !opponentScored;
            return (
              <div key={c.id} className="tw-row" style={{
                justifyContent: "space-between", padding: "10px 12px", marginLeft: -12, marginRight: -12,
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                borderRadius: isFresh ? 10 : 0,
                background: isFresh ? "rgba(245,158,11,0.10)" : "transparent",
                transition: "background 0.5s ease, border-radius 0.5s ease",
                gap: 8,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    {c.receiver_username}
                    <RivalryChip h2h={h2h} oppId={c.receiver_id} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    You: {c.sender_correct ?? "—"}/5 · wager {c.wager}
                    {opponentScored && (
                      <> · <span style={{ color: "var(--good)", fontWeight: 700 }}>they scored {c.receiver_correct}/5</span></>
                    )}
                  </div>
                </div>
                <div className="tw-row" style={{ gap: 6, alignItems: "center" }}>
                  <span className="tw-pill" style={{
                    fontSize: 11,
                    background: opponentScored ? "linear-gradient(135deg, rgba(245,158,11,0.4), rgba(239,68,68,0.4))" : undefined,
                    color: opponentScored ? "#fff" : undefined,
                    fontWeight: opponentScored ? 700 : 600,
                    border: opponentScored ? "none" : undefined,
                  }}>
                    {opponentScored ? "📬 just played" : "⏳ pending"}
                  </span>
                  {canCancel && onCancel && (
                    <button
                      className="tw-pill"
                      style={{
                        cursor: "pointer", fontSize: 11, padding: "4px 10px",
                        background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)",
                        color: "var(--text)", fontWeight: 600,
                      }}
                      title={c.wager > 0 ? `Cancel and refund ${c.wager} coins` : "Cancel this challenge"}
                      onClick={() => onCancel(c)}
                    >
                      ✕ Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {past.length > 0 && (
        <div className="tw-card">
          <div className="tw-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 14 }}>Past results</div>
            {onClearHistory && (
              <button
                className="tw-pill"
                style={{ cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                title="Hide every past result from your list (your opponent's view is unaffected)"
                onClick={onClearHistory}
              >
                🧹 Clear all
              </button>
            )}
          </div>
          {past.slice(0, 10).map((c) => {
            const youSent = c.sender_id === me.id;
            const oppName = youSent ? c.receiver_username : c.sender_username;
            const yourScore = youSent ? c.sender_correct : c.receiver_correct;
            const oppScore  = youSent ? c.receiver_correct : c.sender_correct;
            const oppId     = youSent ? c.receiver_id : c.sender_id;
            // Same priority fix as ResultRevealCard: cancelled status
            // must short-circuit before winner_id checks, otherwise a
            // cancelled challenge with no plays mis-renders as TIED.
            const outcome = c.status === "cancelled" ? "cancelled"
                          : c.status === "expired" ? "expired"
                          : c.winner_id === me.id ? "won"
                          : c.winner_id ? "lost"
                          : "tied";
            const color = outcome === "won" ? "var(--good)"
                        : outcome === "lost" ? "var(--bad)"
                        : "var(--text-dim)";
            const icon = outcome === "won" ? "🏆"
                       : outcome === "lost" ? "💔"
                       : outcome === "tied" ? "🤝"
                       : outcome === "cancelled" ? "🚫"
                       : "⏰";
            // Spotlight the most-recently-resolved row — same fresh
            // highlight used on the outgoing list, so the player's eye
            // follows the action.
            const isFresh = lastChange && lastChange.challenge_id === c.id && (Date.now() - lastChange.at) < 8000;
            const isExpanded = expandedId === c.id;
            return (
              <div key={c.id} style={{
                padding: isExpanded ? "10px 12px" : "8px 12px",
                marginLeft: -12, marginRight: -12,
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                background: isFresh ? "rgba(16,185,129,0.10)" : "transparent",
                transition: "background 0.5s ease",
              }}>
                <div className="tw-row" style={{ gap: 8, width: "100%", alignItems: "center" }}>
                  <button onClick={() => onExpand(isExpanded ? null : c.id)} className="tw-row" style={{
                    justifyContent: "space-between", gap: 8, flex: 1, minWidth: 0,
                    background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--text)",
                  }}>
                    <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                      <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        {icon} vs {oppName}
                        <RivalryChip h2h={h2h} oppId={oppId} />
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                        {yourScore ?? "—"} – {oppScore ?? "—"}
                      </div>
                    </div>
                    <div className="tw-row" style={{ gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color }}>{outcome.toUpperCase()}</span>
                      <span style={{ fontSize: 14, color: "var(--text-dim)" }}>{isExpanded ? "▴" : "▾"}</span>
                    </div>
                  </button>
                  {/* Per-row dismiss × — small, low-key, only on
                      past (non-pending) rows. Outside the expander
                      button so a tap doesn't toggle the card open. */}
                  {onDismiss && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDismiss(c); }}
                      title="Hide this from your list"
                      style={{
                        background: "transparent", border: "none", color: "var(--text-dim)",
                        cursor: "pointer", fontSize: 14, padding: "4px 8px", borderRadius: 8,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.15)"; e.currentTarget.style.color = "var(--bad)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}
                    >✕</button>
                  )}
                </div>
                {isExpanded && (
                  <div style={{ marginTop: 10 }}>
                    <ResultRevealCard c={c} me={me} onRematch={onRematch} onClose={() => onExpand(null)} />
                  </div>
                )}
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

function SendView({ friends, h2h, onSent, onCancel }) {
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
        <div style={{ fontFamily: "Fredoka", fontSize: 20, fontWeight: 700, marginBottom: 4 }}>New duel</div>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>Pick a friend. Both play the same 5 mini-games. Higher score per round wins.</div>

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
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                }} onClick={() => setFriendId(f.id)}>
                  <span>{f.username}</span>
                  <RivalryChip h2h={h2h} oppId={f.id} />
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
  const me = useSelector((s) => s.auth.user);
  const [phase, setPhase] = useState("loading");
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState([]);
  const [resolvedRow, setResolvedRow] = useState(null); // populated if both sides done → reveal
  const startMsRef = useRef(0);

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

  // Watch for the sender cancelling MID-PLAY. Narrow but real race:
  // the receiver loaded /play, started answering, then the sender hit
  // Cancel. The /submit at end-of-round would 400 with already_resolved
  // and the receiver would land on "Submitted!" without an actual
  // submission. Now we navigate them out cleanly with a toast the
  // instant the cancel push arrives. Only active during the play phase
  // — once submitted, the other useEffect's listener takes over.
  useEffect(() => {
    if (phase !== "playing") return;
    const off = rt.on((msg) => {
      if (msg?.type !== "challenge_update") return;
      if (Number(msg.challenge_id) !== Number(challengeId)) return;
      if (msg.subtype === "cancelled") {
        dispatch(pushToast({
          icon: "🚫",
          title: "Challenge withdrawn",
          text: "Your friend cancelled this challenge while you were playing.",
          duration: 5000,
        }));
        onDone();
      }
    });
    return () => { off(); };
  }, [phase, challengeId, dispatch, onDone]);

  // After submitting, listen for the realtime `challenge_update` push.
  // If the OTHER side had already played, this is when we transition
  // from "submitted, waiting" → full reveal card. Without this, the
  // player had to leave + re-enter to see the result.
  useEffect(() => {
    if (phase !== "submitted") return;
    let cancelled = false;
    const fetchAndReveal = async () => {
      try {
        const r = await api.get("/challenges/");
        if (cancelled) return;
        // /challenges/ returns a bare array; tolerate the briefly-deployed
        // {challenges, h2h} shape too so any in-flight rolling-deploy
        // window can't crash the reveal.
        const list = Array.isArray(r.data) ? r.data : (r.data?.challenges || []);
        const meRow = list.find((c) => c.id === Number(challengeId));
        if (meRow && meRow.status !== "pending") setResolvedRow(meRow);
      } catch (e) {}
    };
    // Immediate poll so if both sides already played (the player was
    // the SECOND to submit), the reveal lands without waiting for an
    // event we'll never get.
    fetchAndReveal();
    const off = rt.on((msg) => {
      if (msg?.type === "challenge_update" && Number(msg.challenge_id) === Number(challengeId)) {
        fetchAndReveal();
      }
    });
    return () => { cancelled = true; off(); };
  }, [phase, challengeId]);

  // Mini-game completion handler — each game submits { score: int }.
  // For receiver, we compare against sender's already-stored scores
  // (returned by /play) and tally round_wins; for sender, we submit
  // round_wins = 0 (the receiver computes the H2H comparison later).
  const onGameComplete = ({ score }) => {
    const games = (data && (data.games || data.questions)) || [];
    const senderScores = (data && data.sender_scores) || []; // populated below by server
    const youAreReceiver = data && data.receiver_id === me?.id;
    const next = [...results, Number(score) || 0];
    setResults(next);
    if (index + 1 < games.length) {
      setIndex(index + 1);
    } else {
      // Tally round wins client-side. If the sender is submitting first
      // (no sender_scores known yet), round_wins = 0 — server will
      // re-resolve on the receiver's submit. If the receiver is
      // submitting and has the sender's per-round scores, compare
      // each round.
      let roundWins = 0;
      if (youAreReceiver && senderScores.length === games.length) {
        for (let i = 0; i < games.length; i++) {
          if (next[i] > senderScores[i]) roundWins += 1;
        }
      }
      const timeMs = Date.now() - startMsRef.current;
      api.post(`/challenges/${challengeId}/submit`, {
        round_wins: roundWins,
        scores: next,
        // legacy field for any in-flight old server; harmless either way
        correct: roundWins,
        time_ms: timeMs,
      })
        .then((r) => {
          dispatch(fetchStats());
          setPhase("submitted");
          // PB beats on any individual mini-game inside the duel —
          // confetti shower. /submit now returns pb_hits[] with the
          // game_type + new score for each new PB.
          if (Array.isArray(r?.data?.pb_hits) && r.data.pb_hits.length > 0) {
            celebratePB();
            for (const hit of r.data.pb_hits) {
              dispatch(pushToast({
                icon: "🏆",
                title: "New personal best!",
                text: `${gameMeta(hit.game_type).name}: ${hit.score}${hit.prevBest > 0 ? ` (was ${hit.prevBest})` : ""}`,
                duration: 4500,
              }));
            }
          }
          // If the server resolved on this submit (we were the second
          // player), it returns result; fetch the row to render reveal.
          if (r?.data?.result) {
            // Celebrate the final outcome — winner gets full shower,
            // loser gets a soft slate-dust commiseration.
            if (me && r.data.result.winner_id === me.id) celebrateWin();
            else if (r.data.result.winner_id && r.data.result.winner_id !== me?.id) commiserate();
            api.get("/challenges/").then((res) => {
              const list = Array.isArray(res.data) ? res.data : (res.data?.challenges || []);
              const meRow = list.find((c) => c.id === Number(challengeId));
              if (meRow) setResolvedRow(meRow);
            }).catch(() => {});
          }
        })
        .catch((err) => {
          // Most common failure cause is "already_resolved" — fires if
          // the sender cancelled while the receiver was answering, OR
          // if the player's tab was offline and the server expired the
          // challenge. Surface clear copy in either case rather than
          // silently dropping the player on a "Submitted!" screen that
          // never actually submitted.
          const code = err?.response?.data?.error;
          if (code === "already_resolved") {
            dispatch(pushToast({
              icon: "🚫",
              title: "Challenge no longer open",
              text: "Your friend either withdrew it or it expired. No score recorded.",
              duration: 5000,
            }));
            onDone();
            return;
          }
          // Network / unexpected — keep the player on the submitted
          // screen so they don't lose their result; they can retry by
          // re-submitting on a future load.
          setPhase("submitted");
        });
    }
  };

  if (phase === "loading") return <div className="tw-card" style={{ textAlign: "center", padding: 30 }}><div className="tw-spinner" style={{ margin: "0 auto" }} /></div>;
  if (phase === "error") return <button className="tw-btn block" onClick={onDone}>Back</button>;
  if (phase === "submitted") {
    // For mini-game arena: convert numeric per-round scores to a
    // green/red grid by comparing against sender_scores when known.
    // Falls back to a yellow grid if we can't compare (sender plays
    // first, hasn't seen the receiver's scores yet).
    const games = (data && (data.games || data.questions)) || [];
    const total = games.length || 5;
    const senderScores = (data && data.sender_scores) || [];
    const youAreReceiver = data && data.receiver_id === me?.id;
    let correctCount = 0;
    const grid = results.map((r, i) => {
      if (!youAreReceiver || senderScores.length !== games.length) return "🟨";
      const won = r > senderScores[i];
      const tie = r === senderScores[i];
      if (won) { correctCount += 1; return "🟩"; }
      if (tie) return "🟨";
      return "🟥";
    }).join(" ");
    const snark = snarkForRound({ correct: correctCount, total });
    // If both players have now played and we've fetched the row, jump
    // straight to the rich side-by-side reveal — no "wait" interstitial.
    if (resolvedRow && me) {
      return (
        <div className="tw-col">
          <ResultRevealCard c={resolvedRow} me={me} onClose={onDone} onRematch={null} />
          <button className="tw-btn block" onClick={onDone}>Back to challenges</button>
        </div>
      );
    }
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          Submitted!
        </div>
        <div style={{ fontSize: 38, letterSpacing: 3, margin: "12px 0" }}>{grid}</div>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>{correctCount}/{total}</div>
        <div style={{ marginTop: 10, fontStyle: "italic", color: "var(--text)" }}>{snark}</div>
        <div style={{ marginTop: 10, color: "var(--text-dim)", fontSize: 13 }}>
          Waiting for your opponent. We'll auto-reveal the moment they play.
        </div>
        <button className="tw-btn block" style={{ marginTop: 14 }} onClick={onDone}>Back to challenges</button>
      </div>
    );
  }
  // Mini-game render path. The PlayView is now generic — it sequences
  // whatever the server gave us in `games`/`questions`, identifying
  // each by type + seed and delegating to the runner. The runner picks
  // the matching React component from src/minigames/.
  const games = (data && (data.games || data.questions)) || [];
  const g = games[index];
  const meta = g ? gameMeta(g.type) : null;
  return (
    <div className="tw-col">
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>⚔️ Friend Challenge</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
          {data.wager > 0 ? `Wager: ${data.wager} coins · ` : ""}{games.length} mini-games · best score wins each
        </div>
        <div className="tw-row" style={{ justifyContent: "center", gap: 4, marginTop: 8 }}>
          {games.map((gg, i) => (
            <span key={i} className="tw-pill" style={{
              fontSize: 11,
              background: i < index ? "rgba(16,185,129,0.18)" : i === index ? "linear-gradient(135deg, #f59e0b, #ef4444)" : undefined,
              color: i === index ? "#fff" : undefined,
              border: i === index ? "none" : undefined,
              fontWeight: i === index ? 700 : 500,
            }}>
              {gameMeta(gg.type).icon} {i + 1}
            </span>
          ))}
        </div>
        {meta && (
          <div style={{ fontFamily: "Fredoka", fontSize: 15, fontWeight: 700, marginTop: 10 }}>
            Round {index + 1} / {games.length}: {meta.icon} {meta.name}
          </div>
        )}
      </div>
      {g && <MiniGameRunner key={`${index}-${g.type}`} game={g} onComplete={onGameComplete} />}
    </div>
  );
}

// ── Top-level component — picks the right sub-view ──────────────

export default function FriendChallenges() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [challenges, setChallenges] = useState([]);
  const [h2h, setH2h] = useState({});
  const [friends, setFriends] = useState([]);
  const [mode, setMode] = useState("list"); // list | send | play
  const [playId, setPlayId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  // Tracks the most recent realtime change so the list can spotlight
  // the affected row with a subtle highlight. { challenge_id, at }.
  const [lastChange, setLastChange] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      // Three parallel requests: challenges (bare array — back-compat
      // with any cached old-client expectation), friends, and the
      // optional H2H side-channel. H2H is a NEW endpoint; if it 404s
      // against an old server, we just degrade to no rivalry chips —
      // the rest of the screen still works.
      const [c, f, hh] = await Promise.all([
        api.get("/challenges/"),
        api.get("/friends/"),
        api.get("/challenges/h2h").catch(() => ({ data: { h2h: {} } })),
      ]);
      // Defensive parsing: handle BOTH the bare-array shape AND the
      // transient {challenges, h2h} shape this endpoint briefly had.
      // Belt + suspenders so a stale CDN copy of either side can't
      // crash the screen with "filter is not a function".
      const payload = c.data;
      if (Array.isArray(payload)) {
        setChallenges(payload);
      } else if (payload && Array.isArray(payload.challenges)) {
        setChallenges(payload.challenges);
      } else {
        setChallenges([]);
      }
      setH2h((hh && hh.data && hh.data.h2h) || (payload && payload.h2h) || {});
      // /friends returns accepted friends (not pending requests)
      setFriends((f.data?.accepted || f.data || []).filter((x) => x && x.id));
    } catch (e) {}
  }, []);

  useEffect(() => { if (user) loadAll(); }, [user, loadAll]);

  // ── REALTIME SUBSCRIPTION ──
  // Server pushes `challenge_update` whenever a state-changing event
  // happens (opponent played, both sides resolved, expiry timeout fired).
  // Auto-refresh on each → the list is always current without the user
  // pulling. This is the fix for the original "shows pending forever
  // after friend already played" bug.
  useEffect(() => {
    if (!user) return;
    rt.connect();
    const off = rt.on((msg) => {
      if (!msg || msg.type !== "challenge_update") return;
      // Re-fetch so we get the canonical state (including new H2H tallies
      // if this was a resolution).
      loadAll();
      // Flash the affected row for ~6s after a 'played' update,
      // ~8s after a 'resolved' update.
      if (msg.challenge_id) {
        setLastChange({ challenge_id: Number(msg.challenge_id), at: Date.now(), subtype: msg.subtype });
        // If we just got a 'resolved' ping, auto-expand the result card
        // so the user lands on the dramatic reveal without an extra tap.
        if (msg.subtype === "resolved") setExpandedId(Number(msg.challenge_id));
      }
      // Subtle sound for the resolve — feels like a slot-machine
      // payout cue. 'played' stays silent to avoid spam.
      if (msg.subtype === "resolved") sfx.win?.();
    });
    return () => { off(); };
  }, [user, loadAll]);

  if (!user) {
    return (
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Friend Challenges</div>
        <div style={{ color: "var(--text-dim)", marginBottom: 12 }}>Sign in to send and play friend challenges.</div>
        <button className="tw-btn block" onClick={() => dispatch(setView("home"))}>Back to home</button>
      </div>
    );
  }

  // One-tap rematch — fire the same send-challenge call directly,
  // bypassing the picker. Falls back to opening the picker UI if
  // the API call fails (so the player still has a path forward).
  const rematch = async (oppId, wager) => {
    try {
      const r = await api.post("/challenges/send", { friend_id: oppId, wager: wager || 0 });
      if (r.data.ok) {
        dispatch(pushToast({ icon: "⚔️", title: "Rematch sent", text: "They have 24h." }));
        dispatch(fetchStats());
        loadAll();
      }
    } catch (e) {
      const err = e?.response?.data?.error;
      if (err === "challenge_already_open") {
        dispatch(pushToast({ icon: "⏳", title: "Pending challenge", text: "You already have one open with them." }));
      } else if (err === "insufficient_funds") {
        dispatch(pushToast({ icon: "🪙", title: "Not enough coins", text: "You need more coins for the double-or-nothing wager." }));
      } else {
        setMode("send");
      }
    }
  };

  // Cancel a pending outgoing challenge → refund wager. Confirms first
  // (especially important with wagered challenges — clear copy on
  // "you'll get X coins back" so the action's reversible nature is
  // unambiguous). Optimistically removes the row locally before the
  // server confirms so the click feels instant.
  const cancelChallenge = async (c) => {
    const ok = await confirmDialog(dispatch, {
      icon: "🚫",
      title: "Cancel this challenge?",
      message: c.wager > 0
        ? `Your ${c.wager}-coin wager will be refunded. ${c.receiver_username} won't be able to play it anymore.`
        : `${c.receiver_username} won't be able to play it anymore.`,
      confirmText: "Cancel challenge",
      cancelText: "Keep it",
    });
    if (!ok) return;
    setChallenges((prev) => prev.filter((x) => x.id !== c.id)); // optimistic
    try {
      const r = await api.post(`/challenges/${c.id}/cancel`);
      if (r.data?.refunded > 0) {
        dispatch(pushToast({ icon: "🪙", title: "Wager refunded", text: `+${r.data.refunded} coins back.` }));
      } else {
        dispatch(pushToast({ icon: "🚫", title: "Challenge cancelled" }));
      }
      dispatch(fetchStats());
      loadAll();
    } catch (e) {
      const err = e?.response?.data?.error;
      // Roll back the optimistic remove if the server rejected.
      loadAll();
      dispatch(pushToast({
        icon: "⚠️",
        title: "Couldn't cancel",
        text: err === "receiver_already_played" ? "Your friend already locked in their answer — you're committed."
            : err === "not_cancellable" ? "This challenge is already resolved."
            : "Try again.",
      }));
    }
  };

  // Dismiss a single past row from this user's list. Opponent still
  // sees it; this is purely UI tidying. No confirm — single tap, fully
  // reversible from the opponent's side (they can rematch you and the
  // history re-appears via that row anyway).
  const dismissChallenge = async (c) => {
    setChallenges((prev) => prev.filter((x) => x.id !== c.id)); // optimistic
    try {
      await api.post(`/challenges/${c.id}/dismiss`);
    } catch (e) {
      loadAll(); // roll back on failure
    }
  };

  // Clear ALL past results for this user. Confirms first — it's a big
  // action even though it's reversible (we don't undelete, but the
  // history isn't really "lost", it's just hidden from this view).
  const clearHistory = async () => {
    const ok = await confirmDialog(dispatch, {
      icon: "🧹",
      title: "Clear past results?",
      message: "Hides every resolved, expired, and cancelled challenge from your list. Your opponents' lists are not affected, and pending challenges stay.",
      confirmText: "Clear all",
      cancelText: "Keep them",
    });
    if (!ok) return;
    try {
      const r = await api.post("/challenges/clear-history");
      const n = r.data?.cleared || 0;
      dispatch(pushToast({
        icon: "🧹",
        title: n > 0 ? `Cleared ${n} result${n === 1 ? "" : "s"}` : "Nothing to clear",
      }));
      loadAll();
    } catch (e) {
      dispatch(pushToast({ icon: "⚠️", title: "Couldn't clear", text: "Try again." }));
    }
  };

  if (mode === "send") {
    return <SendView friends={friends} h2h={h2h} onSent={() => { setMode("list"); loadAll(); }} onCancel={() => setMode("list")} />;
  }
  if (mode.startsWith("play")) {
    return <PlayView challengeId={playId} onDone={() => { setMode("list"); loadAll(); }} />;
  }
  return (
    <>
      <style>{`
        @keyframes tw-bounce-in {
          0%   { transform: scale(0.3); opacity: 0; }
          60%  { transform: scale(1.18); opacity: 1; }
          80%  { transform: scale(0.94); }
          100% { transform: scale(1); }
        }
      `}</style>
      <ListView
        challenges={challenges}
        h2h={h2h}
        me={user}
        friends={friends}
        onOpen={(id) => { setPlayId(id); setMode("play"); }}
        onSend={() => setMode("send")}
        onRematch={rematch}
        onCancel={cancelChallenge}
        onDismiss={dismissChallenge}
        onClearHistory={clearHistory}
        lastChange={lastChange}
        expandedId={expandedId}
        onExpand={setExpandedId}
      />
    </>
  );
}
