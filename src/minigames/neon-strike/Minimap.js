// Minimap — top-down arena view in the top-left corner.
//
// Implementation: a small <canvas> that we redraw at ~10Hz with the
// current player + bot positions. We don't render the whole arena
// geometry each frame — instead we cache a static "map plan" on a
// separate canvas at mount time (drawn from arena collider AABBs +
// phase walls + spawn points), then composite it under the dynamic
// dots each frame.
//
// Layout: 140×140 px square top-left. Player = white triangle
// (oriented to facing). Bots = small dots colored by personality.
// Phase walls drawn in pink. Cover blocks drawn in slate.

import React, { useEffect, useRef } from "react";

const SIZE = 140;
const WORLD_HALF = 40; // matches Arena GRID

export default function Minimap({ engine }) {
  const canvasRef = useRef(null);
  const staticCanvasRef = useRef(null);

  // Build the static "map plan" once when engine is ready.
  useEffect(() => {
    if (!engine?.arena) return;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    // Background
    ctx.fillStyle = "rgba(10,15,30,0.85)";
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Grid lines (every 8 world units)
    ctx.strokeStyle = "rgba(96,165,250,0.15)";
    ctx.lineWidth = 1;
    for (let i = -WORLD_HALF; i <= WORLD_HALF; i += 8) {
      const p = ((i + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(SIZE, p); ctx.stroke();
    }
    // Colliders — phase walls drawn pink + translucent, cover slate.
    for (const c of engine.arena.colliders) {
      const min = c.aabb.min, max = c.aabb.max;
      const x1 = ((min.x + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
      const x2 = ((max.x + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
      const z1 = ((min.z + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
      const z2 = ((max.z + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
      ctx.fillStyle = c.phasable ? "rgba(244,114,182,0.55)" : "rgba(96,118,160,0.55)";
      ctx.fillRect(x1, z1, x2 - x1, z2 - z1);
    }
    // Spawn rings
    for (const sp of engine.arena.spawnPoints) {
      const px = ((sp.x + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
      const pz = ((sp.z + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
      ctx.strokeStyle = "rgba(167,139,250,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, pz, 4, 0, Math.PI * 2); ctx.stroke();
    }
    staticCanvasRef.current = canvas;
  }, [engine]);

  // Redraw the dynamic layer at ~10Hz. Anything faster wastes CPU
  // — the minimap doesn't need 60fps.
  useEffect(() => {
    if (!engine) return;
    const target = canvasRef.current;
    if (!target) return;
    const ctx = target.getContext("2d");
    let running = true;
    const draw = () => {
      if (!running) return;
      if (engine.running || engine._pausedAt) {
        ctx.clearRect(0, 0, SIZE, SIZE);
        // Composite the static plan.
        if (staticCanvasRef.current) ctx.drawImage(staticCanvasRef.current, 0, 0);
        // Bots
        for (const bot of engine.bots) {
          if (bot.dead) continue;
          const px = ((bot.position.x + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
          const pz = ((bot.position.z + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
          const color = bot.personalityName === "AGGRO"  ? "#f472b6"
                      : bot.personalityName === "SNIPER" ? "#22d3ee"
                                                         : "#fbbf24";
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(px, pz, 3.5, 0, Math.PI * 2); ctx.fill();
          // Outline so they pop against the slate wall fills.
          ctx.strokeStyle = "rgba(0,0,0,0.5)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // Player — a triangle oriented to facing.
        const ppos = engine.player.position;
        const px = ((ppos.x + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
        const pz = ((ppos.z + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
        const yaw = engine.controls?.getObject?.()?.rotation.y ?? 0;
        // Camera faces -Z by default; yaw rotates around Y. Combine
        // with the THREE Z-flip (world Z+ → screen down in our map).
        const dirX = Math.sin(-yaw);
        const dirZ = -Math.cos(-yaw);
        ctx.save();
        ctx.translate(px, pz);
        ctx.rotate(Math.atan2(dirX, dirZ));
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4, 4);
        ctx.lineTo(-4, 4);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      setTimeout(draw, 100);
    };
    draw();
    return () => { running = false; };
  }, [engine]);

  return (
    <div style={{
      position: "absolute", left: 16, top: 16,
      padding: 4,
      background: "rgba(10,15,30,0.7)",
      border: "1px solid rgba(167,139,250,0.3)",
      borderRadius: 6,
      pointerEvents: "none",
    }}>
      <canvas ref={canvasRef} width={SIZE} height={SIZE}
        style={{ display: "block", borderRadius: 4 }} />
    </div>
  );
}
