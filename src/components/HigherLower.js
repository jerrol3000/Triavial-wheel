import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { HL_DATASETS } from "../data/higherLowerData";
import { setView, pushToast } from "../store/uiSlice";
import { addCoins, addXp } from "../store/statsSlice";
import { sfx } from "../utils/sound";
import { snarkForAnswer, snarkForRound } from "../utils/snark";

// Higher/Lower — pop-culture comparison mini-mode.
//
// The mechanic that captures the young-demo retention better than any
// trivia round can: a single binary choice ("which is more popular?")
// answered in <1 second, with an instant reveal, repeat. This is the
// dopamine loop that drives TikTok-style content (think "Songs Ranked
// By Streams" / "Rate Celebs By Followers").
//
// Game loop:
//   - Pick a dataset (songs / movies / instagram / youtube)
//   - Show left item (revealed value) + right item (hidden value)
//   - Player picks HIGHER or LOWER for the right item
//   - Reveal right's value, animate to compare
//   - If correct: right slides into left's slot, fresh right appears.
//                 streak +1, coin reward scales with streak.
//   - If wrong: round ends, show final score + share snark + retry CTA.
//
// Why this works:
//   - <1 second decisions = TikTok-pace
//   - Zero learning curve (it's literally "which is bigger")
//   - High-flexibility content — swap the dataset for any new trend
//   - Numbers ARE the gameplay; the player learns the cultural
//     hierarchy as a side effect, which feels like flexing knowledge
//     even when they're guessing.
//
// Scoring: 5 coins per correct + 1 XP per correct. Multiplier kicks
// in at streak 5 (×1.5) and 10 (×2). Wrong = round ends.

function fmtBig(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

// Lookup an item's index in its dataset. Used to track which items
// have already been shown so we don't repeat within a round.
function indexOf(dsKey, item) {
  const items = HL_DATASETS[dsKey]?.items || [];
  return items.findIndex((x) => x.label === item.label);
}

function pickRandomNew(dsKey, exclude) {
  const items = HL_DATASETS[dsKey]?.items || [];
  const candidates = items
    .map((item, i) => ({ item, i }))
    .filter((p) => !exclude.has(p.i));
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)].item;
}

export default function HigherLower() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [dsKey, setDsKey] = useState(null);          // null = picker screen
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [revealed, setRevealed] = useState(false);   // is right.value showing?
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(() => {
    try { return Number(localStorage.getItem("spinlore_hl_best") || "0"); } catch (e) { return 0; }
  });
  const [done, setDone] = useState(false);
  const [snark, setSnark] = useState("");
  const [usedIdx, setUsedIdx] = useState(new Set());

  // Start a new round in the given dataset.
  const start = (key) => {
    sfx.click();
    const items = HL_DATASETS[key].items;
    // Two distinct random items to begin.
    let i1 = Math.floor(Math.random() * items.length);
    let i2 = Math.floor(Math.random() * (items.length - 1));
    if (i2 >= i1) i2 += 1;
    setDsKey(key);
    setLeft(items[i1]);
    setRight(items[i2]);
    setRevealed(false);
    setStreak(0);
    setDone(false);
    setSnark("");
    setUsedIdx(new Set([i1, i2]));
  };

  const stopAndReturn = () => {
    if (typeof window !== "undefined") window.history.replaceState({}, "", "/");
    dispatch(setView("home"));
  };

  // Player picks: did right have HIGHER or LOWER value than left?
  // We compute correctness against right.value > left.value.
  const guess = (saysHigher) => {
    if (revealed || done) return;
    const actuallyHigher = right.value > left.value;
    // Edge case: equal values. Treat exact ties as correct either way
    // (rare in practice with raw counts but defensive).
    const isCorrect = right.value === left.value ? true : saysHigher === actuallyHigher;
    sfx[isCorrect ? "correct" : "wrong"]();
    setRevealed(true);
    if (isCorrect) {
      const newStreak = streak + 1;
      setStreak(newStreak);
      // Coin reward scales with streak: 5 coins base, ×1.5 at 5, ×2 at 10.
      const mult = newStreak >= 10 ? 2 : newStreak >= 5 ? 1.5 : 1;
      const reward = Math.round(5 * mult);
      if (user) {
        dispatch(addCoins(reward));
        dispatch(addXp(2));
      }
      setSnark(snarkForAnswer({ correct: true, ms: 1500 }));
      // After ~1.4s, slide right into left's slot and pick a new right.
      setTimeout(() => {
        const newExclude = new Set([...usedIdx, indexOf(dsKey, right)]);
        const newRight = pickRandomNew(dsKey, newExclude);
        if (!newRight) {
          // Ran out of items — end round cleanly.
          setDone(true);
          return;
        }
        setLeft(right);
        setRight(newRight);
        setRevealed(false);
        setSnark("");
        setUsedIdx(newExclude);
      }, 1400);
    } else {
      setSnark(snarkForRound({ correct: streak, total: streak + 1 }));
      // Persist best streak across sessions for the leaderboard flex.
      if (streak > bestStreak) {
        try { localStorage.setItem("spinlore_hl_best", String(streak)); } catch (e) {}
        setBestStreak(streak);
      }
      setTimeout(() => setDone(true), 1800);
    }
  };

  // Picker screen — choose a dataset.
  if (!dsKey) {
    return (
      <div className="tw-col">
        <div className="tw-card" style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 26, fontWeight: 700 }}>
            📈 Higher or Lower
          </div>
          <div style={{ color: "var(--text-dim)", marginTop: 6, fontSize: 14 }}>
            Which is bigger? You have one second to decide. Pick a category.
          </div>
        </div>
        {Object.entries(HL_DATASETS).map(([key, ds]) => (
          <button key={key} className="tw-card" style={{ textAlign: "left", cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)" }}
                  onClick={() => start(key)}>
            <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700 }}>{ds.label}</div>
            <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>{ds.blurb}</div>
          </button>
        ))}
        <button className="tw-pill" style={{ alignSelf: "flex-start", cursor: "pointer" }} onClick={stopAndReturn}>← Back</button>
      </div>
    );
  }

  // Done screen — share + retry.
  if (done) {
    const ds = HL_DATASETS[dsKey];
    return (
      <div className="tw-col">
        <div className="tw-card" style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "Fredoka", fontSize: 28, fontWeight: 700, marginBottom: 4 }}>
            {streak} in a row
          </div>
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>
            {ds.label} · best: {Math.max(streak, bestStreak)}
          </div>
          {snark && (
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(124,58,237,0.18)", border: "1px solid rgba(124,58,237,0.4)", fontFamily: "Fredoka", fontWeight: 600, fontStyle: "italic", marginBottom: 12 }}>
              {snark}
            </div>
          )}
          <button className="tw-btn block" onClick={() => start(dsKey)}>🔁 Play again</button>
          <button className="tw-pill" style={{ marginTop: 10, cursor: "pointer" }} onClick={() => setDsKey(null)}>← Pick a different category</button>
        </div>
      </div>
    );
  }

  // Playing screen — left revealed, right hidden until guess.
  const ds = HL_DATASETS[dsKey];
  const leftFmt = ds.formatValue(left.value);
  const rightFmt = ds.formatValue(right.value);

  return (
    <div className="tw-col" style={{ gap: 10 }}>
      <div className="tw-row" style={{ justifyContent: "space-between" }}>
        <button className="tw-pill" style={{ cursor: "pointer" }} onClick={stopAndReturn}>← Back</button>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="tw-pill" title="Current streak">🔥 {streak}</span>
          <span className="tw-pill" title="Personal best">🏆 {bestStreak}</span>
        </div>
      </div>

      <div className="tw-card" style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.3)", textAlign: "center" }}>
        <div style={{ color: "var(--text-dim)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>{ds.label}</div>
        <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginTop: 4 }}>{ds.blurb}</div>
      </div>

      <div className="tw-card" style={{ textAlign: "center", padding: "26px 18px" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 20, fontWeight: 700 }}>{left.label}</div>
        <div style={{ marginTop: 6, fontSize: 22, fontFamily: "Fredoka", color: "var(--good)" }}>{leftFmt}</div>
      </div>

      <div className="tw-card" style={{ textAlign: "center", padding: "26px 18px", border: revealed ? `2px solid ${right.value > left.value ? "var(--good)" : "var(--bad)"}` : "1px solid rgba(255,255,255,0.1)", transition: "border-color 0.2s ease" }}>
        <div style={{ fontFamily: "Fredoka", fontSize: 20, fontWeight: 700 }}>{right.label}</div>
        <div style={{ marginTop: 6, fontSize: 22, fontFamily: "Fredoka", color: revealed ? (right.value > left.value ? "var(--good)" : "var(--bad)") : "var(--text-dim)" }}>
          {revealed ? rightFmt : "??? "}
        </div>
        {!revealed && (
          <div className="tw-row" style={{ marginTop: 14, gap: 8, justifyContent: "center" }}>
            <button className="tw-btn" style={{ flex: 1, maxWidth: 160, background: "linear-gradient(135deg, #10b981, #059669)" }} onClick={() => guess(true)}>⬆ Higher</button>
            <button className="tw-btn" style={{ flex: 1, maxWidth: 160, background: "linear-gradient(135deg, #ef4444, #b91c1c)" }} onClick={() => guess(false)}>⬇ Lower</button>
          </div>
        )}
        {revealed && snark && (
          <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(124,58,237,0.16)", border: "1px solid rgba(124,58,237,0.4)", fontFamily: "Fredoka", fontWeight: 600 }}>
            {snark}
          </div>
        )}
      </div>
    </div>
  );
}
