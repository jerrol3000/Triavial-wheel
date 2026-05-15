export function levelForXp(xp) {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 100));
}

export function xpForLevel(level) {
  return Math.pow(level - 1, 2) * 100;
}

export function progressToNext(xp) {
  const lvl = levelForXp(xp);
  const cur = xpForLevel(lvl);
  const next = xpForLevel(lvl + 1);
  return {
    level: lvl,
    xpInLevel: xp - cur,
    xpForNext: next - cur,
    percent: Math.min(100, Math.round(((xp - cur) / Math.max(1, next - cur)) * 100)),
  };
}
