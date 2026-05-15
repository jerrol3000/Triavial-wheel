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

export function buildDailyShareText({ date, score, correct, total, results }) {
  const grid = results.map((r) => (r === true ? "🟩" : r === false ? "🟥" : "⬛")).join("");
  return `Trivia Wheel — Daily ${date}\nScore: ${score}  ·  ${correct}/${total}\n${grid}\nplay → https://triviawheel.app`;
}
