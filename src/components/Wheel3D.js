import React, { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { sfx } from "../utils/sound";

// Physics-based wheel with a faked 3D look (perspective tilt + radial
// gradients + drop shadow). Rendered to a single <canvas>.
//
// API (matches the old react-custom-roulette one closely):
//   <Wheel3D ref={ref} data={[{option, style:{backgroundColor,textColor}}]}
//     theme={{ wheelColors, wheelTextColors }} onStop={(idx) => ...} />
//   ref.current.spin()  — kicks off a spin with random velocity
//
// Physics:
//   ω₀ uniformly random in [14, 22] rad/s (~135–210 rpm — fast enough to feel
//   weighty, never crawls).
//   Friction (deceleration) random in [1.6, 2.4] rad/s² — different total
//   spin time each go. Adds slight jitter per frame for organic feel.
//   Wobble: when ω drops below 1 rad/s, dampened sinusoidal jitter is added
//   so the wheel "settles" instead of clicking to a halt.
//
// Pointer is at the top (12 o'clock). The segment under the pointer when ω
// reaches zero is the winner.

const DEFAULT_COLORS = ["#7c3aed", "#ec4899"];

const Wheel3D = forwardRef(function Wheel3D(
  { data = [], theme, onStop, size = 380, fontSize = 13 }, ref
) {
  const canvasRef = useRef(null);
  const stateRef = useRef({
    angle: Math.random() * Math.PI * 2,
    velocity: 0,
    spinning: false,
    friction: 2,
    lastFrame: 0,
    lastTickAngle: 0,
    settling: false,
  });
  const rafRef = useRef(null);

  // Resolve theme colors (fall back to per-segment colors, then defaults).
  const wheelColors = (theme && theme.wheelColors) || DEFAULT_COLORS;
  const textColors = (theme && theme.wheelTextColors) || ["#ffffff"];

  // ── Imperative spin ──────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    spin: () => {
      if (stateRef.current.spinning) return;
      // Random initial angular velocity. 14 ≈ 130 rpm baseline; up to 22 (~210 rpm).
      const ω0 = 14 + Math.random() * 8;
      // Friction varies per spin so total duration is ~3.5–6 seconds.
      const friction = 1.6 + Math.random() * 0.8;
      // Direction always positive (clockwise visually).
      stateRef.current.velocity = ω0;
      stateRef.current.friction = friction;
      stateRef.current.spinning = true;
      stateRef.current.settling = false;
      stateRef.current.lastFrame = performance.now();
      stateRef.current.lastTickAngle = stateRef.current.angle;
      sfx.spin();
      if (!rafRef.current) tick();
    },
    isSpinning: () => stateRef.current.spinning,
  }));

  // ── Draw + step loop ─────────────────────────────────────────────────────
  const tick = () => {
    const now = performance.now();
    const last = stateRef.current.lastFrame || now;
    const dt = Math.min(0.05, (now - last) / 1000);
    stateRef.current.lastFrame = now;

    if (stateRef.current.spinning) {
      const s = stateRef.current;

      // Per-frame friction with a small jitter for organic feel.
      const jitter = 1 + (Math.random() - 0.5) * 0.08;
      s.velocity = Math.max(0, s.velocity - s.friction * dt * jitter);

      // Wobble while settling: dampened oscillation simulating the wheel's
      // last few degrees of overshoot/undershoot.
      let extra = 0;
      if (!s.settling && s.velocity < 1.2) {
        s.settling = true;
        s.settleStart = now;
      }
      if (s.settling) {
        const t = (now - s.settleStart) / 1000;
        extra = 0.6 * Math.sin(t * 12) * Math.exp(-t * 2.5);
      }
      s.angle += (s.velocity + extra) * dt;

      // Click sound at every segment boundary crossing.
      const segAng = (Math.PI * 2) / Math.max(1, data.length);
      const crossings = Math.floor((s.angle - s.lastTickAngle) / segAng);
      if (crossings > 0) {
        s.lastTickAngle += crossings * segAng;
        // Volume scales with current velocity so it tapers naturally.
        if (s.velocity > 0.2) sfx.clack();
      }

      // Stop condition: velocity low AND settle wobble small.
      if (s.velocity < 0.05 && (!s.settling || (now - s.settleStart) > 700)) {
        s.spinning = false;
        s.settling = false;
        // Snap to the center of the segment that's currently under the pointer.
        const idx = computeSegmentIndex(s.angle, data.length);
        const snapTarget = -Math.PI / 2 - idx * segAng - segAng / 2;
        s.angle = snapTarget;
        draw();
        sfx.coin();
        if (onStop) onStop(idx);
        rafRef.current = null;
        return;
      }
    }

    draw();
    rafRef.current = requestAnimationFrame(tick);
  };

  // The wheel rotates by `angle` clockwise from its initial orientation
  // (segment 0 starts at the right, angle 0). The pointer sits at the top
  // (world angle -π/2). To find which segment is under the pointer we
  // subtract the rotation and floor by segment width.
  function computeSegmentIndex(angle, n) {
    const segAng = (Math.PI * 2) / n;
    // Local angle of the pointer relative to the un-rotated wheel:
    let local = -Math.PI / 2 - angle;
    // Normalize to [0, 2π)
    local = ((local % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(local / segAng) % n;
  }

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssSize = size;
    if (canvas.width !== cssSize * dpr) {
      canvas.width = cssSize * dpr;
      canvas.height = cssSize * dpr;
      canvas.style.width = cssSize + "px";
      canvas.style.height = cssSize + "px";
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    const cx = cssSize / 2;
    const cy = cssSize / 2;
    const radius = cssSize / 2 - 4;
    const n = data.length || 1;
    const segAng = (Math.PI * 2) / n;
    const angle = stateRef.current.angle;

    // Outer rim with brushed-metal gradient.
    const rimGrad = ctx.createRadialGradient(cx, cy, radius - 14, cx, cy, radius);
    rimGrad.addColorStop(0, "#3a3145");
    rimGrad.addColorStop(0.5, "#1a1626");
    rimGrad.addColorStop(1, "#3a3145");
    ctx.fillStyle = rimGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Drop shadow under the wheel.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 10, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fill();
    ctx.restore();

    // Segments.
    const inner = 28; // hub radius
    for (let i = 0; i < n; i++) {
      const start = angle + i * segAng;
      const end = start + segAng;
      const segColor =
        (data[i] && data[i].style && data[i].style.backgroundColor) ||
        wheelColors[i % wheelColors.length];

      // Per-segment radial gradient: brighter in the middle, darker at edges,
      // gives a faux-bevel "depth" without being heavy.
      const sg = ctx.createRadialGradient(cx, cy, inner, cx, cy, radius - 12);
      sg.addColorStop(0, shade(segColor, 0.25));
      sg.addColorStop(0.7, segColor);
      sg.addColorStop(1, shade(segColor, -0.2));
      ctx.fillStyle = sg;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius - 12, start, end);
      ctx.closePath();
      ctx.fill();

      // Segment divider line.
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + segAng / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = (data[i] && data[i].style && data[i].style.textColor) || textColors[i % textColors.length];
      ctx.font = `700 ${fontSize}px "Fredoka", "Inter", sans-serif`;
      const label = (data[i] && data[i].option) || "";
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 3;
      ctx.fillText(label, radius - 22, 5);
      ctx.restore();
    }

    // Glossy highlight across the top half — subtle "depth".
    const highlight = ctx.createLinearGradient(cx, cy - radius, cx, cy);
    highlight.addColorStop(0, "rgba(255,255,255,0.22)");
    highlight.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 12, Math.PI, Math.PI * 2);
    ctx.fill();

    // Outer ring stroke.
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 12, 0, Math.PI * 2);
    ctx.stroke();

    // Center hub: domed metal disc with screws.
    const hubGrad = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, inner);
    hubGrad.addColorStop(0, "#f1f5f9");
    hubGrad.addColorStop(0.5, "#94a3b8");
    hubGrad.addColorStop(1, "#1f2937");
    ctx.fillStyle = hubGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Hub highlight
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 4, inner * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
  };

  // Initial draw + handle data changes.
  useEffect(() => {
    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, theme && theme.wheelColors && theme.wheelColors.join(",")]);

  return (
    <div className="tw-wheel3d-wrap" style={{ maxWidth: size, margin: "0 auto", position: "relative" }}>
      <div className="tw-wheel3d-tilt">
        <canvas ref={canvasRef} className="tw-wheel3d-canvas" />
      </div>
      <div className="tw-wheel3d-pointer" aria-hidden="true" />
    </div>
  );
});

// Lighten (positive amount) or darken (negative) a hex color by `amount` in [-1,1].
function shade(hex, amount) {
  const c = hex.replace("#", "");
  if (c.length !== 3 && c.length !== 6) return hex;
  const expand = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const r = parseInt(expand.slice(0, 2), 16);
  const g = parseInt(expand.slice(2, 4), 16);
  const b = parseInt(expand.slice(4, 6), 16);
  const adj = (v) => Math.max(0, Math.min(255, Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount))));
  const hx = (v) => v.toString(16).padStart(2, "0");
  return `#${hx(adj(r))}${hx(adj(g))}${hx(adj(b))}`;
}

export default Wheel3D;
