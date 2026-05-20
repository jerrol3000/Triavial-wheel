// Pixi-arena infrastructure shared across the WebGL-rendered mini-games
// (Anomaly, Cascade, Surge). Encapsulates the canvas/Application
// lifecycle, post-processing setup, and the recording stream so each
// game just describes its scene graph.
//
// Why Pixi.js: the de facto 2D WebGL renderer for HTML5 games (Crazy
// Games, Poki, etc.). Buttery 60fps, sprite batching, filter pipeline
// (glow, blur, displacement, custom shaders). The mini-games render
// into a Pixi <canvas> instead of DOM divs, which is the difference
// between "made in CSS" and "real game look."
//
// API:
//   <PixiArena setup={(app, refs) => cleanup} width? height? />
//
// `setup` is called once when the Pixi Application is ready. Caller
// builds the scene graph (sprites, containers, filters), wires up
// the per-frame ticker, returns a cleanup function. PixiArena hands
// the app + refs to a parent ref so the parent can read it later
// (e.g. for canvas.captureStream during recording).
import React, { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";
import { AdvancedBloomFilter } from "@pixi/filter-advanced-bloom";
import { GlowFilter } from "@pixi/filter-glow";
import { RGBSplitFilter } from "@pixi/filter-rgb-split";
import { ShockwaveFilter } from "@pixi/filter-shockwave";

// Re-export filter constructors so games can grab them without
// importing @pixi/filter-* directly.
export { AdvancedBloomFilter, GlowFilter, RGBSplitFilter, ShockwaveFilter };

// Apply a tasteful "premium game" filter stack to a container. Bloom
// + Glow gives that high-end "everything is alive" look. Optional
// chromatic aberration triggered transiently on hits via
// flashChromatic(container, ms).
export function applyPremiumFilters(container, { glowColor = 0xa78bfa, bloomThreshold = 0.5, bloomIntensity = 0.55 } = {}) {
  const bloom = new AdvancedBloomFilter({
    threshold: bloomThreshold,
    bloomScale: bloomIntensity,
    brightness: 1.0,
    blur: 8,
    quality: 4,
  });
  const glow = new GlowFilter({
    distance: 12,
    outerStrength: 1.2,
    innerStrength: 0,
    color: glowColor,
    quality: 0.2,
  });
  container.filters = [bloom, glow];
  return { bloom, glow };
}

// Trigger a brief chromatic aberration on a container (channel split
// expands then settles back). Used on impacts — gives that "feedback"
// flash without being heavy-handed.
export function flashChromatic(target, durationMs = 180, intensity = 8) {
  if (!target) return;
  const split = new RGBSplitFilter([intensity, 0], [0, intensity], [-intensity, -intensity]);
  const existing = target.filters ? [...target.filters] : [];
  target.filters = [...existing, split];
  const start = Date.now();
  const tick = () => {
    const t = (Date.now() - start) / durationMs;
    if (t >= 1) {
      target.filters = existing;
      return;
    }
    const k = 1 - t;
    split.red = [intensity * k, 0];
    split.green = [0, intensity * k];
    split.blue = [-intensity * k, -intensity * k];
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Trigger a radial shockwave that ripples outward from a point. The
// filter is applied to the whole stage briefly.
export function shockwave(app, x, y, durationMs = 700) {
  if (!app || !app.stage) return;
  const filter = new ShockwaveFilter([x, y], {
    amplitude: 30,
    wavelength: 160,
    speed: 600,
    radius: -1,
    brightness: 1.0,
  }, 0);
  const existing = app.stage.filters ? [...app.stage.filters] : [];
  app.stage.filters = [...existing, filter];
  const start = Date.now();
  const tick = () => {
    const elapsed = (Date.now() - start) / 1000;
    if (elapsed * 1000 >= durationMs) {
      app.stage.filters = existing;
      return;
    }
    filter.time = elapsed;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Active-canvas singleton — set whenever a PixiArena mounts, cleared
// when it unmounts. The Recorder (_recorder.js) reads from this to
// know what canvas to capture, so individual game components don't
// have to wire props through. Single canvas at a time is the typical
// game flow.
const arenaRegistry = { canvas: null, app: null };
export function getActivePixiCanvas() { return arenaRegistry.canvas; }
export function getActivePixiApp()    { return arenaRegistry.app; }

export function PixiArena({ setup, width, height, style, onReady }) {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const cleanupRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // resolution → use devicePixelRatio for retina sharpness without
    // doubling logical layout. autoDensity true keeps the rendered
    // size in CSS pixels.
    const w = width || container.clientWidth;
    const h = height || 360;

    const app = new PIXI.Application({
      width: w, height: h,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      // preserveDrawingBuffer keeps canvas data readable for clip-record.
      preserveDrawingBuffer: true,
    });
    appRef.current = app;

    // Mount the canvas
    const canvas = app.view;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = `${h}px`;
    canvas.style.borderRadius = "12px";
    container.appendChild(canvas);

    // Handle resize so the canvas keeps filling its container.
    const onResize = () => {
      const newW = container.clientWidth;
      if (newW && Math.abs(newW - app.renderer.width) > 4) {
        app.renderer.resize(newW, h);
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // Register as the active canvas for the recorder to pick up.
    arenaRegistry.canvas = canvas;
    arenaRegistry.app = app;

    // Let parent grab the app handle (e.g. for captureStream).
    if (onReady) onReady(app, canvas);

    // Caller's setup gets the app — returns a cleanup function.
    try {
      cleanupRef.current = setup(app);
    } catch (e) {
      console.error("[pixi-arena] setup threw", e);
    }

    return () => {
      try { ro.disconnect(); } catch (e) {}
      try { if (cleanupRef.current) cleanupRef.current(); } catch (e) {}
      try { app.destroy(true, { children: true, texture: true, baseTexture: true }); } catch (e) {}
      appRef.current = null;
      if (arenaRegistry.canvas === canvas) {
        arenaRegistry.canvas = null;
        arenaRegistry.app = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: height || 360,
        borderRadius: 12,
        overflow: "hidden",
        background: "radial-gradient(circle at center, rgba(0,0,0,0.4), rgba(0,0,0,0.7))",
        border: "1px solid rgba(255,255,255,0.06)",
        position: "relative",
        ...style,
      }}
    />
  );
}

// ─── Custom Pixi Filter: Plasma Shader ──────────────────────────────
// A GLSL fragment shader that draws a plasma/anomaly effect. Pixi's
// Filter wraps shaders for use on a Container. The shader samples
// from uTime + uniforms to animate. Vertex shader is Pixi's default.
const PLASMA_FRAG = `
  precision mediump float;
  varying vec2 vTextureCoord;
  uniform sampler2D uSampler;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;

  // Cheap noise function.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 uv = vTextureCoord;
    vec2 centered = uv - 0.5;
    float r = length(centered);
    float angle = atan(centered.y, centered.x);

    // Layered plasma: two octaves of noise scrolling in opposite directions.
    float n1 = noise(uv * 4.0 + vec2(uTime * 0.3, 0.0));
    float n2 = noise(uv * 8.0 - vec2(0.0, uTime * 0.5));
    float plasma = (n1 + n2 * 0.5);

    // Concentric ripple emanating from the center.
    float ripple = sin(r * 24.0 - uTime * 4.0) * 0.5 + 0.5;
    plasma *= mix(0.5, ripple, 0.5);

    // Soft vignette toward edges.
    float vignette = 1.0 - smoothstep(0.1, 0.5, r);

    // Hot core glow
    float core = exp(-r * r * 18.0) * 1.5;

    vec3 col = uColor * plasma * vignette * uIntensity + uColor * core;
    float alpha = (plasma * vignette + core * 0.6) * uIntensity;
    gl_FragColor = vec4(col, alpha);
  }
`;

export class PlasmaFilter extends PIXI.Filter {
  constructor(color = [0.75, 0.45, 1.0]) {
    super(undefined, PLASMA_FRAG, {
      uTime: 0,
      uColor: color,
      uIntensity: 1.0,
    });
  }
  setColor(rgb) { this.uniforms.uColor = rgb; }
  tick(deltaSeconds) { this.uniforms.uTime += deltaSeconds; }
  setIntensity(n) { this.uniforms.uIntensity = n; }
}

// Hex → [r, g, b] floats for shader uniforms.
export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [
    ((n >> 16) & 0xff) / 255,
    ((n >> 8) & 0xff) / 255,
    (n & 0xff) / 255,
  ];
}

export { PIXI };
