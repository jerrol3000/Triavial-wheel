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

// Preset profile-picture avatars. Each renders the image from `file`
// (relative to /icons/) if present; otherwise falls back to the emoji.
//
// The first row below points at the new illustrated PNG set in
// /icons/cosmetics/avatars/ and shows real custom art. Remaining
// entries stay as emoji-only fallbacks so the picker grid stays full
// — drop a matching PNG into /icons/cosmetics/avatars/<id>.png and
// update the file path to upgrade any one of them.
export const AVATAR_PRESETS = [
  // Custom illustrated set (priority — appears first in the grid).
  { id: "owl",       emoji: "🦉", file: "cosmetics/avatars/owl.png" },
  { id: "dragon",    emoji: "🐉", file: "cosmetics/avatars/dragon.png" },
  { id: "robot",     emoji: "🤖", file: "cosmetics/avatars/robot.png" },
  { id: "panda",     emoji: "🐼", file: "cosmetics/avatars/panda.png" },
  { id: "space_boy", emoji: "👨‍🚀", file: "cosmetics/avatars/space_boy.png" },
  { id: "smart_pup", emoji: "🐶", file: "cosmetics/avatars/smart_pup.png" },

  // Emoji-only fallbacks — picker still renders these, just as the
  // emoji glyph until you drop in a PNG with the matching id.
  { id: "cool",      emoji: "😎", file: null },
  { id: "girl",      emoji: "👩", file: null },
  { id: "joy",       emoji: "😂", file: null },
  { id: "smug",      emoji: "🕶️", file: null },
  { id: "love",      emoji: "😍", file: null },
  { id: "tongue",    emoji: "😋", file: null },
  { id: "unicorn",   emoji: "🦄", file: null },
  { id: "wink",      emoji: "😉", file: null },
  { id: "grin",      emoji: "😄", file: null },
  { id: "alien",     emoji: "👽", file: null },
  { id: "ghost",     emoji: "👻", file: null },
];

export function getPresetById(id) {
  return AVATAR_PRESETS.find((p) => p.id === id);
}
