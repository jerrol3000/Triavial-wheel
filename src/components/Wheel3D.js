import React, { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { sfx } from "../utils/sound";

// Wheel-of-Fortune-style canvas wheel.
//
// Visual:
//   * Gold studded outer ring (small "lights" around the perimeter)
//   * Inner pegs at every segment boundary — small vertical posts that
//     visually push past the pointer flap as the wheel rotates
//   * Bright saturated segment colors
//   * Domed metal hub
//   * CSS rotateX tilt for faux 3D perspective
//
// Physics:
//   ω₀ uniformly random in [14, 22] rad/s (~135–210 rpm — never crawls)
//   Friction random in [1.6, 2.4] rad/s² — total spin 3.5–6 seconds
//   Per-frame jitter ±8% for organic feel
//   Settle wobble (dampened sinusoid) when ω < 1.2 rad/s
//
// Pointer flick:
//   When a peg crosses the pointer, the pointer DOM element gets a one-shot
//   "flick" CSS class — restarted on every strike so successive pegs each
//   flick it back and forth like a real wheel-of-fortune flap.

const DEFAULT_COLORS = ["#7c3aed", "#ec4899"];

const Wheel3D = forwardRef(function Wheel3D(
  { data = [], theme, onStop, size = 460, fontSize = 14 }, ref
) {
  const canvasRef = useRef(null);
  const pointerRef = useRef(null);
  const stateRef = useRef({
    angle: Math.random() * Math.PI * 2,
    velocity: 0,
    spinning: false,
    friction: 2,
    lastFrame: 0,
    lastPointerCrossing: 0,
    settling: false,
  });
  const rafRef = useRef(null);

  const wheelColors = (theme && theme.wheelColors) || DEFAULT_COLORS;
  const textColors = (theme && theme.wheelTextColors) || ["#ffffff"];

  // Strike the pointer flap. Restart-trick: remove the class, force a reflow,
  // re-add — guarantees the CSS animation replays from frame 0 on every hit.
  const flickPointer = (intensity = 1) => {
    const el = pointerRef.current;
    if (!el) return;
    el.classList.remove("flicking");
    el.style.setProperty("--flick-amount", String(Math.min(1, intensity)));
    // Force reflow:
    void el.offsetWidth;
    el.classList.add("flicking");
  };

  useImperativeHandle(ref, () => ({
    spin: () => {
      if (stateRef.current.spinning) return;
      const ω0 = 14 + Math.random() * 8;
      const friction = 1.6 + Math.random() * 0.8;
      stateRef.current.velocity = ω0;
      stateRef.current.friction = friction;
      stateRef.current.spinning = true;
      stateRef.current.settling = false;
      stateRef.current.lastFrame = performance.now();
      // Align the crossing-counter to the current angle so the first flick
      // fires exactly when a peg first reaches the pointer.
      const segAng = (Math.PI * 2) / Math.max(1, data.length);
      stateRef.current.lastPointerCrossing = stateRef.current.angle;
      sfx.spin();
      if (!rafRef.current) tick();
    },
    isSpinning: () => stateRef.current.spinning,
  }));

  const tick = () => {
    const now = performance.now();
    const last = stateRef.current.lastFrame || now;
    const dt = Math.min(0.05, (now - last) / 1000);
    stateRef.current.lastFrame = now;

    if (stateRef.current.spinning) {
      const s = stateRef.current;

      const jitter = 1 + (Math.random() - 0.5) * 0.08;
      s.velocity = Math.max(0, s.velocity - s.friction * dt * jitter);

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

      // Peg-passing-pointer detection. Each segAng of rotation past the
      // baseline counts as one peg striking the pointer. Fires the flick
      // animation + clack sound. Volume tapers with velocity so the last
      // few clacks are subtle "tink"s.
      const segAng = (Math.PI * 2) / Math.max(1, data.length);
      const crossings = Math.floor((s.angle - s.lastPointerCrossing) / segAng);
      if (crossings > 0) {
        s.lastPointerCrossing += crossings * segAng;
        if (s.velocity > 0.12) {
          sfx.clack();
          // Flick intensity drops with velocity for visual realism.
          flickPointer(Math.min(1, s.velocity / 8));
        }
      }

      if (s.velocity < 0.05 && (!s.settling || (now - s.settleStart) > 700)) {
        s.spinning = false;
        s.settling = false;
        const idx = computeSegmentIndex(s.angle, data.length);
        const segAng2 = (Math.PI * 2) / data.length;
        const snapTarget = -Math.PI / 2 - idx * segAng2 - segAng2 / 2;
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

  function computeSegmentIndex(angle, n) {
    const segAng = (Math.PI * 2) / n;
    let local = -Math.PI / 2 - angle;
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
    const outerR = cssSize / 2 - 4;
    const goldR = outerR;
    const segOuterR = outerR - 24;   // segments end here; gold ring sits outside
    const segInnerR = 36;            // hub radius
    const n = data.length || 1;
    const segAng = (Math.PI * 2) / n;
    const angle = stateRef.current.angle;

    // Outer gold ring (Wheel-of-Fortune signature).
    const goldGrad = ctx.createRadialGradient(cx, cy, segOuterR + 4, cx, cy, goldR);
    goldGrad.addColorStop(0, "#fbbf24");
    goldGrad.addColorStop(0.5, "#f59e0b");
    goldGrad.addColorStop(1, "#92400e");
    ctx.fillStyle = goldGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, goldR, 0, Math.PI * 2);
    ctx.fill();

    // Studded "lights" around the gold ring — 2 per segment.
    const studCount = n * 2;
    const studRadius = (goldR + segOuterR) / 2;
    for (let i = 0; i < studCount; i++) {
      const a = (i / studCount) * Math.PI * 2 + angle * 0.0; // stationary, not rotating with wheel
      const sx = cx + Math.cos(a) * studRadius;
      const sy = cy + Math.sin(a) * studRadius;
      // alternate gold / off-white for variety
      const isLight = i % 2 === 0;
      const studGrad = ctx.createRadialGradient(sx - 1, sy - 1, 0.5, sx, sy, 4);
      studGrad.addColorStop(0, isLight ? "#fff8e1" : "#fde68a");
      studGrad.addColorStop(1, "#92400e");
      ctx.fillStyle = studGrad;
      ctx.beginPath();
      ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Inner ring (dark frame between gold and segments).
    ctx.fillStyle = "#1a1626";
    ctx.beginPath();
    ctx.arc(cx, cy, segOuterR + 6, 0, Math.PI * 2);
    ctx.fill();

    // Segments.
    for (let i = 0; i < n; i++) {
      const start = angle + i * segAng;
      const end = start + segAng;
      const segColor =
        (data[i] && data[i].style && data[i].style.backgroundColor) ||
        wheelColors[i % wheelColors.length];

      const sg = ctx.createRadialGradient(cx, cy, segInnerR, cx, cy, segOuterR);
      sg.addColorStop(0, shade(segColor, 0.25));
      sg.addColorStop(0.7, segColor);
      sg.addColorStop(1, shade(segColor, -0.2));
      ctx.fillStyle = sg;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, segOuterR, start, end);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + segAng / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = (data[i] && data[i].style && data[i].style.textColor) || textColors[i % textColors.length];
      ctx.font = `700 ${fontSize}px "Fredoka", "Inter", sans-serif`;
      const label = (data[i] && data[i].option) || "";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 3;
      ctx.fillText(label, segOuterR - 18, 5);
      ctx.restore();
    }

    // Pegs at every segment boundary — small vertical posts the pointer flicks off.
    // Drawn rotating with the wheel so they appear to pass under the pointer.
    for (let i = 0; i < n; i++) {
      const a = angle + i * segAng;
      const px = cx + Math.cos(a) * (segOuterR + 2);
      const py = cy + Math.sin(a) * (segOuterR + 2);
      const pegGrad = ctx.createRadialGradient(px - 1, py - 1, 0.3, px, py, 5);
      pegGrad.addColorStop(0, "#fef3c7");
      pegGrad.addColorStop(0.6, "#cbd5e1");
      pegGrad.addColorStop(1, "#1f2937");
      ctx.fillStyle = pegGrad;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    // Glossy top highlight.
    const highlight = ctx.createLinearGradient(cx, cy - segOuterR, cx, cy);
    highlight.addColorStop(0, "rgba(255,255,255,0.22)");
    highlight.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.arc(cx, cy, segOuterR, Math.PI, Math.PI * 2);
    ctx.fill();

    // Center hub.
    const hubGrad = ctx.createRadialGradient(cx - 8, cy - 8, 2, cx, cy, segInnerR);
    hubGrad.addColorStop(0, "#fde68a");
    hubGrad.addColorStop(0.4, "#f59e0b");
    hubGrad.addColorStop(1, "#1f2937");
    ctx.fillStyle = hubGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, segInnerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Inner highlight on the hub.
    ctx.beginPath();
    ctx.arc(cx - 6, cy - 6, segInnerR * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
    // Hub center dot.
    ctx.fillStyle = "#1f2937";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  };

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
      <div ref={pointerRef} className="tw-wheel3d-pointer" aria-hidden="true" />
    </div>
  );
});

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
