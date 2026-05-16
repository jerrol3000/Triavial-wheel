// Central icon registry. The app references icons by name (e.g. "vs"); the
// <Icon name="vs" /> component renders either an image from /icons/<file>
// (when the file exists) or falls back to the emoji on 404.
//
// File names below match the actual assets in public/icons/. Filenames are
// case-sensitive on Linux/Netlify — leave them exactly as committed.
export const ICONS = {
  // UI / navigation — real illustrated icons (transparent PNGs).
  vs:            { emoji: "🆚", file: "VS.png",           label: "VS / Online" },
  stats:         { emoji: "📊", file: "My_stats.png",     label: "My Stats" },
  shop:          { emoji: "🛒", file: "Shop.png",         label: "Shop" },
  daily_bonus:   { emoji: "🎁", file: "daily_prize.PNG",  label: "Daily Login Prize" },
  free_spin:     { emoji: "🎡", file: "free_spin.PNG",    label: "Free Spin" },
  coins:         { emoji: "🪙", file: "coin.png",         label: "Gold Coins" },
  sound:         { emoji: "🔊", file: "sound.png",        label: "Sound" },
  admin:         { emoji: "🛠️", file: "admin_panel.png",  label: "Admin Panel" },
  daily_quest:   { emoji: "📋", file: "daily_quest.png",  label: "Daily Quest" },
  leaderboard:   { emoji: "🌍", file: "leader_board.png", label: "World Leaderboard" },

  // Nav / utility — fall back to emoji until you drop in custom files.
  // Drop e.g. public/icons/play.png and set `file` here to enable it.
  play:          { emoji: "🎡", file: null, label: "Play" },
  daily:         { emoji: "📅", file: null, label: "Daily Challenge" },
  settings:      { emoji: "⚙️", file: null, label: "Settings" },
  me:            { emoji: "👤", file: null, label: "Me" },
  back:          { emoji: "←",  file: null, label: "Back" },
};

// Preset profile-picture avatars. Each renders as an emoji; replace with
// custom PNGs by saving files to public/icons/avatars/<key>.png — same
// fallback semantics as ICONS.
export const AVATAR_PRESETS = [
  { id: "cool",      emoji: "😎", file: "avatars/cool.png" },
  { id: "girl",      emoji: "👩", file: "avatars/girl.png" },
  { id: "joy",       emoji: "😂", file: "avatars/joy.png" },
  { id: "smug",      emoji: "🕶️", file: "avatars/smug.png" },
  { id: "love",      emoji: "😍", file: "avatars/love.png" },
  { id: "tongue",    emoji: "😋", file: "avatars/tongue.png" },
  { id: "angry",     emoji: "😡", file: "avatars/angry.png" },
  { id: "unicorn",   emoji: "🦄", file: "avatars/unicorn.png" },
  { id: "wink",      emoji: "😉", file: "avatars/wink.png" },
  { id: "grin",      emoji: "😄", file: "avatars/grin.png" },
  { id: "alien",     emoji: "👽", file: "avatars/alien.png" },
  { id: "panda",     emoji: "🐼", file: "avatars/panda.png" },
  { id: "sob",       emoji: "😭", file: "avatars/sob.png" },
  { id: "plead",     emoji: "🥺", file: "avatars/plead.png" },
  { id: "robot",     emoji: "🤖", file: "avatars/robot.png" },
  { id: "ghost",     emoji: "👻", file: "avatars/ghost.png" },
];

export function getPresetById(id) {
  return AVATAR_PRESETS.find((p) => p.id === id);
}
