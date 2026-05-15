export const POWERUPS = {
  fifty:  { id: "fifty",  icon: "✂️", name: "50/50",       desc: "Eliminate two wrong answers.",   cost: 100 },
  skip:   { id: "skip",   icon: "⏭️", name: "Skip",        desc: "Skip without losing a life.",    cost: 80  },
  freeze: { id: "freeze", icon: "❄️", name: "Freeze",      desc: "Add 15 seconds to the timer.",   cost: 60  },
  double: { id: "double", icon: "✖️2", name: "Double",     desc: "Double points if you're right.", cost: 120 },
};

export const POWERUP_LIST = Object.values(POWERUPS);
