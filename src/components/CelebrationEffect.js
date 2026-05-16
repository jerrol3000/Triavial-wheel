import React, { useMemo } from "react";
import Confetti from "react-confetti";
import { useSelector } from "react-redux";

// Renders the user's equipped celebration cosmetic when `show` is true.
// Falls back to the default react-confetti shower when nothing equipped.
// Effects with custom particles (fireworks/coins/hearts/stars/rainbow/
// phoenix) render via inline CSS-animated emoji rain so we don't need
// an extra animation library.
export default function CelebrationEffect({ show, width, height }) {
  const equipped = useSelector((s) => {
    const id = s.cosmetics?.equipped?.celebration;
    if (!id) return null;
    return s.cosmetics.catalog.find((c) => c.id === id) || null;
  });

  if (!show) return null;

  const effect = (equipped && equipped.data && equipped.data.effect) || "confetti";
  if (effect === "confetti") {
    return <Confetti recycle={false} numberOfPieces={250} width={width} height={height} />;
  }

  return <EmojiBurst effect={effect} />;
}

const EFFECT_EMOJI = {
  fireworks: ["🎆", "🎇", "✨", "💥"],
  coins:     ["🪙", "💰", "💵", "💲"],
  hearts:    ["💖", "💗", "💕", "❤️"],
  stars:     ["⭐", "🌟", "✨", "🌠"],
  rainbow:   ["🌈", "🟥", "🟧", "🟨", "🟩", "🟦", "🟪"],
  phoenix:   ["🦅", "🔥", "✨", "💫"],
};

function EmojiBurst({ effect }) {
  const emojiSet = EFFECT_EMOJI[effect] || EFFECT_EMOJI.fireworks;
  // Memoize the particle layout so React doesn't shuffle on re-render.
  const particles = useMemo(() => {
    const count = 60;
    return Array.from({ length: count }, (_, i) => ({
      emoji: emojiSet[i % emojiSet.length],
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      duration: 2.2 + Math.random() * 1.6,
      size: 20 + Math.random() * 28,
      drift: (Math.random() - 0.5) * 40,
      rotate: Math.random() * 720 - 360,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect]);

  return (
    <div className="tw-celebration-layer" aria-hidden="true">
      {particles.map((p, i) => (
        <span
          key={i}
          className="tw-celebration-particle"
          style={{
            left: `${p.left}%`,
            fontSize: `${p.size}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            "--drift": `${p.drift}vw`,
            "--rotate": `${p.rotate}deg`,
          }}
        >{p.emoji}</span>
      ))}
    </div>
  );
}
