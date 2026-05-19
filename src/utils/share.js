import { snarkForRound } from "./snark";

export async function shareText({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}${url ? "\n" + url : ""}`);
    return "copied";
  } catch (e) {
    return "failed";
  }
}

// Wordle-style result text. Now uses:
//   - 🟩 / 🟥 / 🟨 (yellow for time-out, not the old black ⬛ which read as "missing data")
//   - The same Snark Mode round-tier line that the result card shows in-app
//     (consistent voice across share + share preview)
//   - A deep-link back to the SAME date's challenge — so a friend who
//     opens the link drops into the exact 5 questions the sharer just
//     played. The "/d/<date>" route is the public no-auth landable.
export function buildDailyShareText({ date, score, correct, total, results }) {
  const grid = (results || []).map((r) =>
    r === true ? "🟩"
    : r === false ? "🟥"
    : "🟨"
  ).join(" ");
  const snark = snarkForRound({ correct, total });
  const origin = (typeof window !== "undefined" && window.location && window.location.origin) || "https://spinlore.app";
  return [
    `🎡 Spinlore · Daily · ${date}`,
    "",
    grid,
    "",
    `${correct}/${total}`,
    snark,
    "",
    `${origin}/d/${date}`,
  ].join("\n");
}
