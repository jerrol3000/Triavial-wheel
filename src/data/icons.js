// Central icon registry. The app references icons by name (e.g. "vs"); the
// <Icon name="vs" /> component renders either a PNG from /public/icons/<name>.png
// (when the file exists) or falls back to the emoji.
//
// To use the custom illustrated icons:
//   1. Drop each PNG into public/icons/ with the matching filename
//   2. The Icon component auto-detects and uses them (with emoji as fallback
//      while loading or if a file 404s).
export const ICONS = {
  // UI / navigation
  vs:            { emoji: "🆚", file: "vs.png",            label: "VS / Online" },
  stats:         { emoji: "📊", file: "stats.png",         label: "My Stats" },
  shop:          { emoji: "🛒", file: "shop.png",          label: "Shop" },
  daily_bonus:   { emoji: "🎁", file: "daily-bonus.png",   label: "Daily Login Prize" },
  free_spin:     { emoji: "🎡", file: "free-spin.png",     label: "Free Spin" },
  coins:         { emoji: "🪙", file: "coins.png",         label: "Gold Coins" },
  sound:         { emoji: "🔊", file: "sound.png",         label: "Sound" },
  admin:         { emoji: "🛠️", file: "admin.png",         label: "Admin Panel" },
  daily_quest:   { emoji: "📋", file: "daily-quest.png",   label: "Daily Quest" },
  leaderboard:   { emoji: "🌍", file: "leaderboard.png",   label: "World Leaderboard" },
  // Extras
  play:          { emoji: "🎡", file: "play.png",          label: "Play" },
  daily:         { emoji: "📅", file: "daily.png",         label: "Daily Challenge" },
  settings:      { emoji: "⚙️", file: "settings.png",      label: "Settings" },
  me:            { emoji: "👤", file: "me.png",            label: "Me" },
  back:          { emoji: "←",  file: "back.png",          label: "Back" },
};

// Preset profile-picture avatars. Each renders as an emoji; you can replace
// with PNGs by saving files to public/icons/avatars/<key>.png — same
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
