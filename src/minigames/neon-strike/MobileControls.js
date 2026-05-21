// MobileControls — on-screen virtual joystick + action buttons.
//
// Why this exists: pointer-lock + WASD doesn't work on touchscreens.
// We render React DOM overlays that write into engine.input.{...},
// which the Engine then reads each frame instead of (or alongside)
// the keyboard. On desktop the overlay hides via touch-detect or a
// settings toggle.
//
// Layout:
//   • Left thumb: virtual joystick (drag = movement vector)
//   • Right thumb: look-pad (drag = camera yaw/pitch deltas)
//   • Bottom-right cluster: FIRE (big), JUMP, DASH, Q (shift)
//
// Implementation: we use plain pointer events. Each control owns its
// active pointerId so multi-touch works (left joystick + right look
// + fire button simultaneously).

import React, { useEffect, useRef, useState } from "react";

function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
}

export default function MobileControls({ engine, visible }) {
  const [touch, setTouch] = useState(isTouchDevice());
  useEffect(() => { setTouch(isTouchDevice()); }, []);
  if (!touch || !visible) return null;

  return (
    <>
      <VirtualJoystick engine={engine} />
      <LookPad engine={engine} />
      <ActionButtons engine={engine} />
    </>
  );
}

// ── Left thumb: virtual joystick ───────────────────────────────────
function VirtualJoystick({ engine }) {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const stateRef = useRef({ pointerId: null, cx: 0, cy: 0 });

  useEffect(() => {
    const base = baseRef.current;
    if (!base) return;
    const RADIUS = 60;
    const onDown = (e) => {
      if (stateRef.current.pointerId !== null) return;
      const rect = base.getBoundingClientRect();
      stateRef.current.pointerId = e.pointerId;
      stateRef.current.cx = rect.left + rect.width / 2;
      stateRef.current.cy = rect.top + rect.height / 2;
      base.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (stateRef.current.pointerId !== e.pointerId) return;
      const dx = e.clientX - stateRef.current.cx;
      const dy = e.clientY - stateRef.current.cy;
      const dist = Math.min(RADIUS, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      const kx = Math.cos(angle) * dist;
      const ky = Math.sin(angle) * dist;
      if (knobRef.current) {
        knobRef.current.style.transform = `translate(${kx}px, ${ky}px)`;
      }
      // Write into engine.input. moveX = right, moveY = forward.
      // dy is INVERTED — pulling thumb up = move forward.
      if (engine?.input) {
        engine.input.moveX = kx / RADIUS;
        engine.input.moveY = -ky / RADIUS;
      }
    };
    const onUp = (e) => {
      if (stateRef.current.pointerId !== e.pointerId) return;
      stateRef.current.pointerId = null;
      if (knobRef.current) knobRef.current.style.transform = "translate(0,0)";
      if (engine?.input) { engine.input.moveX = 0; engine.input.moveY = 0; }
    };
    base.addEventListener("pointerdown", onDown);
    base.addEventListener("pointermove", onMove);
    base.addEventListener("pointerup", onUp);
    base.addEventListener("pointercancel", onUp);
    return () => {
      base.removeEventListener("pointerdown", onDown);
      base.removeEventListener("pointermove", onMove);
      base.removeEventListener("pointerup", onUp);
      base.removeEventListener("pointercancel", onUp);
    };
  }, [engine]);

  return (
    <div ref={baseRef} style={{
      position: "absolute", left: 20, bottom: 100,
      width: 130, height: 130, borderRadius: "50%",
      background: "rgba(10,15,30,0.5)",
      border: "1px solid rgba(167,139,250,0.4)",
      touchAction: "none", userSelect: "none",
      pointerEvents: "auto",
    }}>
      <div ref={knobRef} style={{
        position: "absolute", left: "50%", top: "50%",
        width: 50, height: 50, borderRadius: "50%",
        background: "rgba(167,139,250,0.6)",
        boxShadow: "0 0 14px rgba(167,139,250,0.6)",
        marginLeft: -25, marginTop: -25,
        transition: "transform 0.05s linear",
      }} />
    </div>
  );
}

// ── Right thumb area: look-pad ────────────────────────────────────
// A large invisible region on the right side that translates pointer
// drags into camera yaw/pitch deltas — same units as a mouse on
// desktop. Sensitivity matches PointerLockControls' default.
function LookPad({ engine }) {
  const padRef = useRef(null);
  const stateRef = useRef({ pointerId: null, lastX: 0, lastY: 0 });

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    const SENS = 0.0025;
    const onDown = (e) => {
      if (stateRef.current.pointerId !== null) return;
      stateRef.current.pointerId = e.pointerId;
      stateRef.current.lastX = e.clientX;
      stateRef.current.lastY = e.clientY;
      pad.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (stateRef.current.pointerId !== e.pointerId) return;
      const dx = e.clientX - stateRef.current.lastX;
      const dy = e.clientY - stateRef.current.lastY;
      stateRef.current.lastX = e.clientX;
      stateRef.current.lastY = e.clientY;
      if (engine?.controls) {
        // Mimic PointerLockControls' yaw + pitch path.
        const obj = engine.controls.getObject();
        obj.rotation.y -= dx * SENS;
        engine.camera.rotation.x -= dy * SENS;
        engine.camera.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, engine.camera.rotation.x));
      }
    };
    const onUp = (e) => {
      if (stateRef.current.pointerId !== e.pointerId) return;
      stateRef.current.pointerId = null;
    };
    pad.addEventListener("pointerdown", onDown);
    pad.addEventListener("pointermove", onMove);
    pad.addEventListener("pointerup", onUp);
    pad.addEventListener("pointercancel", onUp);
    return () => {
      pad.removeEventListener("pointerdown", onDown);
      pad.removeEventListener("pointermove", onMove);
      pad.removeEventListener("pointerup", onUp);
      pad.removeEventListener("pointercancel", onUp);
    };
  }, [engine]);

  return (
    <div ref={padRef} style={{
      position: "absolute", right: 0, top: 0, bottom: 0, width: "50%",
      touchAction: "none", userSelect: "none",
      pointerEvents: "auto",
      // Invisible — we don't want it to obscure the game view.
    }} />
  );
}

// ── Action buttons cluster (bottom-right) ─────────────────────────
function ActionButtons({ engine }) {
  const fire = useRef(null);
  const jump = useRef(null);
  const dash = useRef(null);
  const shift = useRef(null);

  useEffect(() => {
    const bindHold = (el, key) => {
      const down = (e) => {
        if (!engine?.input) return;
        engine.input[key] = true;
        el.classList.add("held");
        e.preventDefault();
      };
      const up = (e) => {
        if (!engine?.input) return;
        engine.input[key] = false;
        el.classList.remove("held");
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      return () => {
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      };
    };
    const bindTap = (el, fn) => {
      const handler = (e) => { e.preventDefault(); fn(); };
      el.addEventListener("pointerdown", handler);
      return () => el.removeEventListener("pointerdown", handler);
    };
    const cleanups = [];
    if (fire.current) cleanups.push(bindHold(fire.current, "fire"));
    if (jump.current) cleanups.push(bindTap(jump.current, () => engine?.player?.requestJump?.()));
    if (dash.current) cleanups.push(bindTap(dash.current, () => engine?.player?.requestDash?.(engine.state)));
    if (shift.current) cleanups.push(bindTap(shift.current, () => engine?.energyShift?.toggle?.(engine.state)));
    return () => cleanups.forEach((c) => c());
  }, [engine]);

  const btnStyle = (size = 64, color = "rgba(167,139,250,0.4)") => ({
    width: size, height: size, borderRadius: "50%",
    background: "rgba(10,15,30,0.6)",
    border: `1.5px solid ${color}`,
    color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: 2,
    display: "flex", alignItems: "center", justifyContent: "center",
    touchAction: "none", userSelect: "none",
    pointerEvents: "auto",
  });

  return (
    <div style={{
      position: "absolute", right: 24, bottom: 100,
      display: "flex", flexDirection: "column", gap: 12, alignItems: "center",
      pointerEvents: "none",
    }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div ref={shift} style={{ ...btnStyle(58, "rgba(244,114,182,0.55)"), color: "#f472b6" }}>Q</div>
        <div ref={dash}  style={btnStyle(58)}>DASH</div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div ref={jump} style={btnStyle(70)}>JUMP</div>
        <div ref={fire} style={{ ...btnStyle(92, "rgba(244,114,182,0.7)"), fontSize: 13 }}>FIRE</div>
      </div>
    </div>
  );
}
