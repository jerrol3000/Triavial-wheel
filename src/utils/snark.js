// Spinlore's voice. This is the brand.
//
// LOCALIZATION POLICY — read before adding `useT()` to this file:
//   Snark is intentionally English-only across all locales. Three
//   reasons:
//     1. Brand voice. The roast cadence ("Plausible. Wrong.") is
//        load-bearing English humor; translating it dilutes the
//        joke into mush. Wordle made the same call with its
//        English-only word list and it didn't hurt adoption.
//     2. Translation cost. Each tier has 5-12 lines, 13 tiers
//        total → ~100 lines × 5 locales = 500 translations to
//        commission + maintain. Disproportionate ROI before we
//        know the snark is the right brand voice at all.
//     3. Snark in English IS the Gen-Z internet-English vibe we're
//        leaning into — like how K-pop fans speak "stan English"
//        regardless of native language. The English roast feels
//        intentional, not a localization gap.
//   Revisit if a target market complains specifically OR if we
//   commit to a non-English-speaking territory. Until then: ship
//   English, comment about it once, move on.
//
// Snark Mode fires a witty one-liner after every question + at the end
// of the round. The intent is "screenshot worthy" — players send the
// snark to their friends and the friend asks "wait what app is this"
// and that's our viral loop.
//
// Lines are deliberately punchy (under 60 chars) so they fit on a
// single line of the result card and read as text-message-quick.
// Mix of compliments, roasts, and self-aware game-host energy. No
// profanity (we want this installable for the 14-25 demo without
// store-rating headaches). No mean-spirited body/identity stuff —
// the burn is always at the ANSWER, never the player as a person.
//
// Per-question tiers are decided by `tierForAnswer(correct, ms)`;
// per-round tiers by `tierForRound(correct, total)`. Each tier has
// 8-12 lines so a 5-question session very rarely repeats.

// ── Per-question tiers ───────────────────────────────────────────
//
//   instant_correct : correct  +   <2s   → top-shelf compliment
//   fast_correct    : correct  +  2-5s   → confident compliment
//   correct         : correct  +   >5s   → quiet acknowledgement
//   wrong_fast      : wrong    +   <3s   → "you panicked" energy
//   wrong           : wrong    +  3-10s  → standard burn
//   wrong_slow      : wrong    +  >10s   → "and you THOUGHT about it" burn
//   timeout         : no answer in time  → ghosted

const PER_QUESTION = {
  instant_correct: [
    "👑 Reflex tier. Showing off.",
    "⚡ Filthy. Move on.",
    "💎 Surgical.",
    "🔥 Did you just blink at it?",
    "👑 Locked in. Frame this.",
    "⚡ Faster than the wheel could think.",
    "🎯 Center mass.",
    "💯 The algorithm saluted.",
    "🥇 Suspiciously fast. We love it.",
    "🚀 Cooked.",
  ],
  fast_correct: [
    "✅ Clean. Confident. Correct.",
    "💎 Locked it.",
    "🎯 Centered.",
    "✅ The wheel approves.",
    "💯 Decisive. Respect.",
    "🔥 You knew that one.",
    "✨ Easy work.",
    "🥇 Carrying.",
  ],
  correct: [
    "✅ Got there.",
    "✅ Scenic route, but you arrived.",
    "✅ Took a second. Earned it.",
    "✅ Honest work.",
    "🙂 Acceptable.",
    "✅ Worked it out. Respect.",
    "⏳ Slow and right beats fast and wrong.",
    "✅ Banked.",
  ],
  wrong_fast: [
    "❌ Panic-clicked. We saw that.",
    "❌ Confidently wrong. Iconic.",
    "❌ Bold. Disastrous.",
    "❌ The first option was a trap. You walked in.",
    "❌ Wrong, but loud about it.",
    "💀 That was a guess. Wasn't it.",
    "❌ Read the question next time.",
    "❌ Speed kills. Specifically yours.",
  ],
  wrong: [
    "❌ Off by a vibe.",
    "❌ Plausible. Still wrong.",
    "❌ Not it. The other one.",
    "❌ A vibe was had. The answer wasn't.",
    "❌ Close, but no.",
    "❌ Wrong, but I respect the chaos.",
    "💀 A 7-year-old just got that one.",
    "❌ The algorithm is concerned.",
    "❌ Wrong, and yet so confident.",
  ],
  wrong_slow: [
    "💀 You thought about it. Still wrong.",
    "💀 All that time for THAT?",
    "❌ Eight seconds of contemplation. Wasted.",
    "❌ Took your time. Picked the wrong one. Art.",
    "💀 The wheel grew old waiting for you to be wrong.",
    "❌ A long, thoughtful, incorrect answer.",
  ],
  timeout: [
    "⏰ Did you fall asleep?",
    "⏰ Time's up. We'll pretend that was strategic.",
    "⏰ Ghosted by your own brain.",
    "⏰ The wheel waited. You did not show up.",
    "⏰ Skipped. We see you.",
    "⏰ A new strategy: don't answer. Bold.",
  ],
};

// ── Per-round tiers ──────────────────────────────────────────────
//
//   perfect : 5/5
//   clutch  : 4/5
//   decent  : 3/5
//   meh     : 2/5
//   rough   : 1/5
//   shutout : 0/5

const PER_ROUND = {
  perfect: [
    "🏆 Flawless. We're suspicious.",
    "🏆 Perfect. Put it on a billboard.",
    "🏆 You absolutely cooked.",
    "🏆 The leaderboard is in shambles.",
    "🏆 5-for-5. Frame this.",
    "🏆 Surgeon hands. Wheel respects you.",
    "🏆 Did you study?",
  ],
  clutch: [
    "🔥 4/5. One slipup. We won't mention it.",
    "🔥 Solid. Brag responsibly.",
    "🔥 Paying attention pays.",
    "🔥 4/5. Confident swagger earned.",
    "🔥 Just shy of a flex. Still a flex.",
  ],
  decent: [
    "🙂 3/5. Mid, but stable.",
    "🙂 Average. Honest work.",
    "🙂 3/5. Could've been worse. Could've been better.",
    "🙂 Solid C+. The wheel accepts it.",
    "🙂 Right down the middle.",
  ],
  meh: [
    "😬 2/5. The wheel has questions about you.",
    "😬 Half-asleep energy.",
    "😬 We've all had days like this.",
    "😬 The algorithm is sending a wellness check.",
    "😬 2/5. Tomorrow's daily is going to humble you back.",
  ],
  rough: [
    "💀 1/5. Bold strategy.",
    "💀 At least you got one. That's something. Barely.",
    "💀 1/5. The algorithm is calling backup.",
    "💀 Was this on purpose?",
  ],
  shutout: [
    "💀 0/5. Impressive. Just not the way you wanted.",
    "💀 The leaderboard requires an apology.",
    "💀 Statistically, you should've gotten ONE right by accident.",
    "💀 We're proud of the commitment to the bit.",
    "💀 0/5. Wow. Genuinely.",
  ],
};

// ── Public API ──────────────────────────────────────────────────

// Returns one random line for the given tier. Falls back to "" for an
// unknown tier so the caller can render nothing rather than crash.
function pick(bucket, tier) {
  const lines = bucket[tier];
  if (!lines || !lines.length) return "";
  return lines[Math.floor(Math.random() * lines.length)];
}

// Decide which per-question tier applies based on correctness +
// response time in milliseconds. Cliff thresholds are chosen so the
// vast majority of plays hit `fast_correct` or `wrong` — the more
// extreme buckets (instant, slow-wrong, timeout) are rarer + therefore
// more delightful when they fire.
export function tierForAnswer({ correct, timedOut, ms }) {
  if (timedOut) return "timeout";
  if (correct) {
    if (ms != null && ms < 2000) return "instant_correct";
    if (ms != null && ms < 5000) return "fast_correct";
    return "correct";
  }
  // Wrong.
  if (ms != null && ms < 3000) return "wrong_fast";
  if (ms != null && ms > 10000) return "wrong_slow";
  return "wrong";
}

// Decide which end-of-round tier applies based on raw score / total.
export function tierForRound({ correct, total }) {
  if (!total || total <= 0) return "decent";
  const pct = correct / total;
  if (correct === total) return "perfect";          // 5/5
  if (pct >= 0.8) return "clutch";                  // 4/5
  if (pct >= 0.5) return "decent";                  // 3/5
  if (pct >= 0.35) return "meh";                    // 2/5 of 5
  if (correct > 0) return "rough";                  // 1/5
  return "shutout";                                  // 0/5
}

// One-liner for a question result. Returns a random line from the
// matching tier; safe to render the result as-is in any UI.
export function snarkForAnswer(opts) {
  return pick(PER_QUESTION, tierForAnswer(opts));
}

// One-liner for end-of-round.
export function snarkForRound(opts) {
  return pick(PER_ROUND, tierForRound(opts));
}
