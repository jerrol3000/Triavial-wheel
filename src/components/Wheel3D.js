import React, { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { useSelector } from "react-redux";
import { sfx } from "../utils/sound";
import { pointerPngUrl } from "../data/cosmeticIcons";

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
      // Tuned for ~3–4 s total spin — a "realistic" wheel-of-fortune
      // feel. Several iterations:
      //   original 14-22 ω / 1.6-2.4 f  → 7-9 s   (way too long)
      //   first cut 10-15 / 3-4          → 2.5-3.5 s (good)
      //   over-tuned 8-12 / 4-5.2        → 1.8-2.4 s (felt unrealistically fast)
      //   now: 11-15 / 3.2-4.2           → ~3-4 s  (weighty but not slow)
      // Initial velocity gives 1.7-2.4 visible rotations — enough for
      // the player to see the wheel actually pick up speed and slow
      // down naturally, not just teleport to a category.
      const ω0 = 11 + Math.random() * 4;
      const friction = 3.2 + Math.random() * 1.0;
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
      const segAng = (Math.PI * 2) / Math.max(1, data.length);

      // Deceleration model. Linear friction dominates; a tiny
      // velocity-proportional drag (0.04·v) adds gentle curvature so
      // the slowdown FADES rather than dropping at a perfectly
      // constant rate — what air resistance + bearing friction do on
      // a real wheel. Removed the per-frame ±4 % "jitter" multiplier:
      // it was random noise on the deceleration that read as
      // judder when the eye was tracking the settle.
      const decel = s.friction + 0.04 * s.velocity;
      s.velocity = Math.max(0, s.velocity - decel * dt);

      // Magnetic settling. Engages at 1.6 rad/s — late enough that
      // the deceleration reads as natural friction, early enough
      // that the magnet locks onto a segment center within ~400 ms
      // of crossing the threshold. Strength 18 (down from the
      // over-tuned 22) so the lock feels deliberate, not snappy.
      const SETTLE_THRESHOLD = 1.6;
      let err = 0;
      if (s.velocity < SETTLE_THRESHOLD) {
        const idx = computeSegmentIndex(s.angle, data.length);
        const targetAngle = -Math.PI / 2 - idx * segAng - segAng / 2;
        err = targetAngle - s.angle;
        // Shortest signed angular distance (wrap to [-π, π]).
        while (err >  Math.PI) err -= Math.PI * 2;
        while (err < -Math.PI) err += Math.PI * 2;
        const pull = (SETTLE_THRESHOLD - s.velocity) / SETTLE_THRESHOLD; // 0..1
        s.velocity += err * 18 * pull * dt;
      }

      s.angle += s.velocity * dt;

      // Peg-passing-pointer detection. Each segAng of rotation past
      // the baseline counts as one peg striking the pointer. Fires
      // the flick animation + clack sound. Volume tapers with
      // velocity so the last few clacks are subtle "tink"s. Uses
      // absolute crossings to handle the brief backward motion the
      // magnet can introduce as the wheel settles.
      const dCross = s.angle - s.lastPointerCrossing;
      const crossings = Math.trunc(dCross / segAng);
      if (crossings !== 0) {
        s.lastPointerCrossing += crossings * segAng;
        if (s.velocity > 0.12) {
          sfx.clack();
          flickPointer(Math.min(1, s.velocity / 8));
        }
      }

      // Stop condition: low velocity AND close to a segment center.
      // Tolerances loosened further (0.25 rad/s, 0.06 rad ≈ 3.4°)
      // — at 460-px wheel scale 3.4° offset is ~13 px out of a 460
      // wheel, well within the safe band of a slice's center text.
      // Cuts another ~0.3 s off the average tail vs the previous
      // 0.15 / 0.04 gates.
      if (Math.abs(s.velocity) < 0.25 && Math.abs(err) < 0.06) {
        const idx = computeSegmentIndex(s.angle, data.length);
        const targetAngle = -Math.PI / 2 - idx * segAng - segAng / 2;
        s.angle = targetAngle;
        s.velocity = 0;
        s.spinning = false;
        s.settling = false;
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

  // The equipped pointer cosmetic rides on top of the default flap.
  // Prefers the PNG art (looks crisp at retina sizes) and falls back
  // to the emoji from `data.emoji` so older items without art still
  // render. Returns null when no pointer is equipped or the user
  // picked the default arrow — the bare yellow flap stays.
  const pointerArt = useEquippedPointerArt();

  return (
    <div className="tw-wheel3d-wrap" style={{ maxWidth: size, margin: "0 auto", position: "relative" }}>
      <div className="tw-wheel3d-tilt">
        <canvas ref={canvasRef} className="tw-wheel3d-canvas" />
      </div>
      <div
        ref={pointerRef}
        // `has-art` swaps the default yellow flap out for the cosmetic
        // PNG cleanly — without it, the yellow shows around the edges
        // of any non-rectangular art (dragon, rocket, etc).
        className={`tw-wheel3d-pointer ${pointerArt && pointerArt.png ? "has-art" : ""}`}
        aria-hidden="true"
      >
        {pointerArt && pointerArt.png ? (
          // PNG path — sized + positioned via CSS so the art sits
          // over the flap area and never reaches the wheel slices.
          // <img> for native lazy-load + a clean 404 fallback.
          <img
            className="tw-wheel3d-pointer-art"
            src={pointerArt.png}
            alt=""
            draggable={false}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : pointerArt && pointerArt.emoji && pointerArt.emoji !== "▼" ? (
          <span className="tw-wheel3d-pointer-emoji" aria-hidden="true">{pointerArt.emoji}</span>
        ) : null}
      </div>
    </div>
  );
});

// Returns { png, emoji } for the equipped pointer. `png` takes
// precedence in Wheel3D; emoji is the fallback for catalog items
// whose art hasn't shipped yet. Returns null entirely when the user
// hasn't equipped a pointer cosmetic.
function useEquippedPointerArt() {
  const equippedId = useSelector((s) => s.cosmetics?.equipped?.pointer);
  const item = useSelector((s) => equippedId
    ? s.cosmetics.catalog.find((c) => c.id === equippedId)
    : null);
  if (!item) return null;
  return {
    png: pointerPngUrl(item),
    emoji: item.data && item.data.emoji ? item.data.emoji : null,
  };
}

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
