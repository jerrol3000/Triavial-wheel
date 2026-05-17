// Central icon registry. The app references icons by name (e.g. "vs"); the
// <Icon name="vs" /> component renders either an image from /icons/<file>
// (when the file exists) or falls back to the emoji on 404.
//
// File names below match the actual assets in public/icons/. Filenames are
// case-sensitive on Linux/Netlify — leave them exactly as committed.
//
// Refreshed asset set: 2.5D illustrated icons generated from the master
// prompt in AI_ASSET_PROMPTS.md. Old filenames (Shop.png, coin.png,
// leader_board.png, etc.) were renamed to match the new naming
// convention. New entries (notification, gift, wheel, gem, quest,
// daily_challenge) bring previously emoji-only spots up to par.
export const ICONS = {
  // UI / navigation — real illustrated icons (transparent PNGs).
  vs:             { emoji: "🆚", file: "VS.png",              label: "VS / Online" },
  shop:           { emoji: "🛒", file: "shopping_bag.png",    label: "Shop" },
  coins:          { emoji: "🪙", file: "coins.png",           label: "Gold Coins" },
  sound:          { emoji: "🔊", file: "sound.png",           label: "Sound" },
  admin:          { emoji: "🛠️", file: "admin.png",           label: "Admin Panel" },
  leaderboard:    { emoji: "🌍", file: "leaderboard.png",     label: "World Leaderboard" },
  settings:       { emoji: "⚙️", file: "settings.png",        label: "Settings" },

  // Rewards / power-up surfaces.
  daily_bonus:    { emoji: "🎁", file: "gift.png",            label: "Daily Login Prize" },
  gift:           { emoji: "🎁", file: "gift.png",            label: "Gift" },
  free_spin:      { emoji: "🎡", file: "wheel.png",           label: "Free Spin" },
  wheel:          { emoji: "🎡", file: "wheel.png",           label: "Wheel" },
  gem:            { emoji: "💎", file: "diamond_gem.png",     label: "Gem / Premium" },
  pro:            { emoji: "💎", file: "diamond_gem.png",     label: "Pro / Premium" },

  // Quests + daily challenges — both have their own art now.
  daily_quest:    { emoji: "📋", file: "quest.png",           label: "Daily Quest" },
  quest:          { emoji: "📋", file: "quest.png",           label: "Quest" },
  daily:          { emoji: "📅", file: "daily_challenge.png", label: "Daily Challenge" },
  daily_challenge:{ emoji: "📅", file: "daily_challenge.png", label: "Daily Challenge" },

  // Notification bell — new asset that's used by the banner bell.
  notification:   { emoji: "🔔", file: "notification.png",    label: "Notifications" },
  bell:           { emoji: "🔔", file: "notification.png",    label: "Notifications" },

  // Still emoji-only — drop a matching PNG into public/icons/ and set
  // `file` here to upgrade.
  play:           { emoji: "🎡", file: null, label: "Play" },
  me:             { emoji: "👤", file: null, label: "Me" },
  back:           { emoji: "←",  file: null, label: "Back" },
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
