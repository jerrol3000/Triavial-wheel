export const CATEGORIES = [
  { id: 9,  option: "General",     color: "#7c3aed", premium: false },
  { id: 11, option: "Film",        color: "#ec4899", premium: false },
  { id: 14, option: "TV",          color: "#06b6d4", premium: false },
  { id: 17, option: "Science",     color: "#10b981", premium: false },
  { id: 21, option: "Sports",      color: "#ef4444", premium: false },
  { id: 22, option: "Geography",   color: "#3b82f6", premium: false },
  { id: 12, option: "Music",       color: "#f59e0b", premium: false },
  { id: 18, option: "Computers",   color: "#64748b", premium: true  },
  { id: 20, option: "Mythology",   color: "#14b8a6", premium: true  },
  { id: 27, option: "Animals",     color: "#f97316", premium: false },
];

// Special "Mystery" slot — picks a random category and grants a score bonus.
export const MYSTERY = { id: -1, option: "MYSTERY x1.5", color: "#fde047", premium: false, isMystery: true };

export const WHEEL_DATA = [
  ...CATEGORIES.slice(0, 5),
  MYSTERY,
  ...CATEGORIES.slice(5),
].map((c) => ({
  option: c.option,
  style: { backgroundColor: c.color, textColor: c.isMystery ? "#0f0c29" : "#ffffff" },
  id: c.id,
  isMystery: !!c.isMystery,
}));
