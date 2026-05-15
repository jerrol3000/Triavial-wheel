export const THEMES = {
  classic: {
    id: "classic",
    name: "Classic",
    cost: 0,
    proOnly: false,
    wheelColors: ["#3e3e3e", "#7c3aed"],
    wheelTextColors: ["#ffffff"],
  },
  neon: {
    id: "neon",
    name: "Neon Nights",
    cost: 200,
    proOnly: false,
    wheelColors: ["#ec4899", "#06b6d4"],
    wheelTextColors: ["#ffffff"],
  },
  midnight: {
    id: "midnight",
    name: "Midnight",
    cost: 200,
    proOnly: false,
    wheelColors: ["#0f0c29", "#7c3aed"],
    wheelTextColors: ["#ffffff"],
  },
  sunset: {
    id: "sunset",
    name: "Sunset",
    cost: 200,
    proOnly: false,
    wheelColors: ["#f97316", "#ec4899"],
    wheelTextColors: ["#ffffff"],
  },
  forest: {
    id: "forest",
    name: "Forest",
    cost: 200,
    proOnly: true,
    wheelColors: ["#064e3b", "#10b981"],
    wheelTextColors: ["#ffffff"],
  },
  candy: {
    id: "candy",
    name: "Candy",
    cost: 200,
    proOnly: true,
    wheelColors: ["#fb7185", "#f59e0b"],
    wheelTextColors: ["#ffffff"],
  },
};

export const THEME_LIST = Object.values(THEMES);
