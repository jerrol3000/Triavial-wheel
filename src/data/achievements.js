export const ACHIEVEMENTS = [
  { id: "first_correct",    icon: "🎯", title: "First Blood",     desc: "Get your first correct answer." },
  { id: "streak_5",         icon: "🔥", title: "On Fire",         desc: "Get 5 correct in a row." },
  { id: "streak_10",        icon: "⚡", title: "Unstoppable",     desc: "Get 10 correct in a row." },
  { id: "perfect_round",    icon: "💯", title: "Flawless",        desc: "Get a perfect round of 10." },
  { id: "daily_3",          icon: "📅", title: "Habit Forming",   desc: "3-day daily challenge streak." },
  { id: "daily_7",          icon: "🗓️", title: "Week Strong",     desc: "7-day daily challenge streak." },
  { id: "daily_30",         icon: "🏆", title: "Monthlong",       desc: "30-day daily challenge streak." },
  { id: "level_5",          icon: "⭐", title: "Rising Star",     desc: "Reach level 5." },
  { id: "level_10",         icon: "🌟", title: "Trivia Pro",      desc: "Reach level 10." },
  { id: "level_25",         icon: "💎", title: "Trivia Master",   desc: "Reach level 25." },
  { id: "fifty_used",       icon: "✂️", title: "Smart Pick",      desc: "Use a 50/50 power-up." },
  { id: "all_categories",   icon: "🎡", title: "Wheel Spinner",   desc: "Play every category at least once." },
  { id: "speed_demon",      icon: "💨", title: "Speed Demon",     desc: "Answer correctly in under 3 seconds." },
  { id: "high_score_1000",  icon: "🚀", title: "Four Digits",     desc: "Score 1,000 in a single game." },
  { id: "friend_winner",    icon: "👑", title: "Friend Crusher",  desc: "Win a multiplayer match." },
];

export const ACHIEVEMENT_MAP = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
