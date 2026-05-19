import React, { useState } from "react";
import { sfx } from "../utils/sound";
import { snarkForRound } from "../utils/snark";

// Wordle-style result card for the public daily challenge.
//
// Layout (kept deliberately phone-friendly + screenshot-friendly):
//
//   ┌─────────────────────────────────────┐
//   │   🎡 SPINLORE · DAILY · May 19      │
//   │                                     │
//   │       🟩 🟩 🟨 🟥 🟩                 │
//   │                                     │
//   │   4 / 5 · 🔥 7-day streak           │
//   │   ✨ <snark line for this round>    │
//   │                                     │
//   │   spinlore.app/d/2026-05-19         │
//   └─────────────────────────────────────┘
//
// One-tap "Share" copies a plain-text version (same emoji grid, same
// link) to the clipboard and triggers the Web Share API on mobile.
// The link points at the SAME day's URL so a friend who opens it
// drops directly into the same questions — the deep-link loop is
// what makes Wordle viral and we want the same here.
//
// Per-question results are encoded by a 3-state value: true (correct,
// 🟩), false (incorrect, 🟥), or null/undefined (timed-out, 🟨).
// Note: we use yellow for timed-out rather than red because timing
// out feels different to players than getting it wrong — and the
// 3-color grid pattern reads more interestingly when shared.
export default function DailyShareCard({ date, score, correct, total, perQuestion, streak, plays, onPlayAgain }) {
  const [copied, setCopied] = useState(false);
  const snark = snarkForRound({ correct, total });

  const grid = (perQuestion || []).map((r) =>
    r === true ? "🟩"
    : r === false ? "🟥"
    : "🟨"
  ).join(" ");

  // Resilient origin pick — production points at the Netlify host,
  // local dev at localhost:8080. window.location.origin is fine for
  // both because the public daily route lives on the same origin as
  // the frontend regardless of where the API is.
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/d/${date}`;

  const shareText = [
    `🎡 Spinlore · Daily · ${date}`,
    "",
    grid,
    "",
    `${correct}/${total}${typeof streak === "number" && streak > 0 ? ` · 🔥 ${streak}-day streak` : ""}`,
    snark,
    "",
    url,
  ].join("\n");

  const onShare = async () => {
    sfx.click();
    // Web Share API is the primary path on mobile (opens the native
    // share sheet). On desktop / unsupported browsers we fall back
    // to clipboard, which covers every other case including Discord
    // and DM pastes.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Spinlore — Daily", text: shareText });
        return;
      } catch (e) { /* user cancelled or unsupported — fall through to clipboard */ }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {}
  };

  return (
    <div className="tw-card tw-share-card-wrap" style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "Fredoka", fontSize: 14, fontWeight: 700, letterSpacing: 1, color: "var(--text-dim)", textTransform: "uppercase" }}>
        🎡 Spinlore · Daily · {date}
      </div>

      <div style={{ fontSize: 42, letterSpacing: 4, margin: "16px 0 8px" }}>
        {grid || "—"}
      </div>

      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "Fredoka" }}>
        {correct}/{total}
        {typeof streak === "number" && streak > 0 && (
          <span style={{ marginLeft: 10, color: "#f59e0b" }}>🔥 {streak}-day streak</span>
        )}
      </div>

      {snark && (
        <div style={{ marginTop: 10, fontSize: 16, color: "var(--text)", fontStyle: "italic", padding: "0 8px" }}>
          {snark}
        </div>
      )}

      {typeof plays === "number" && plays > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}>
          {plays.toLocaleString()} {plays === 1 ? "player" : "players"} played today
        </div>
      )}

      <div className="tw-row" style={{ marginTop: 16, gap: 8, justifyContent: "center" }}>
        <button className="tw-btn" style={{ flex: 1, maxWidth: 200 }} onClick={onShare}>
          {copied ? "✓ Copied" : "📤 Share result"}
        </button>
        {onPlayAgain && (
          <button className="tw-btn ghost" style={{ flex: 1, maxWidth: 200 }} onClick={onPlayAgain}>
            🔁 Play again
          </button>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-dim)", fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>
        {url}
      </div>
    </div>
  );
}
