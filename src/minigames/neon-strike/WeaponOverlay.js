// WeaponOverlay — 2D SVG/CSS weapon graphic at bottom-center of the
// screen. DOM-only, no WebGL. Guaranteed visible regardless of any
// 3D rendering pipeline issue.
//
// Why DOM not WebGL: after multiple iterations of trying to make the
// three.js viewmodel reliably visible, we punted to a DOM overlay.
// A stylized cyber-weapon SVG renders cleanly across all browsers
// and devices, and gives the player an unmistakable "I am holding a
// gun" visual. Each weapon has its own color + silhouette.
//
// Animations:
//   • Subtle vertical bob (idle sway)
//   • Recoil kick on fire (downward shift + rotation pulse)
//   • Muzzle flash circle that pulses bright on fire then fades
//   • Reload spin (gun rotates 360° during reload)

import React, { useEffect, useRef, useState } from "react";

// Per-weapon palette + silhouette glyph. Each entry is rendered as a
// stylized SVG sci-fi gun in the chosen color scheme.
const WEAPONS = {
  plasma:  { name: "PLASMA",    color: "#a78bfa", accent: "#c084fc", barrel: "long",  silhouette: "rifle" },
  smg:     { name: "PULSE-SMG", color: "#34d399", accent: "#10b981", barrel: "short", silhouette: "smg" },
  shotgun: { name: "PULSE-12",  color: "#f472b6", accent: "#ec4899", barrel: "wide",  silhouette: "shotgun" },
  sniper:  { name: "Q-SNIPER",  color: "#c084fc", accent: "#a855f7", barrel: "xlong", silhouette: "sniper" },
  railgun: { name: "RAILGUN",   color: "#22d3ee", accent: "#06b6d4", barrel: "long",  silhouette: "rail" },
  gravity: { name: "G-LAUNCH",  color: "#60a5fa", accent: "#3b82f6", barrel: "wide",  silhouette: "launcher" },
  pistol:  { name: "SIDEKICK",  color: "#fbbf24", accent: "#f59e0b", barrel: "short", silhouette: "pistol" },
};

export default function WeaponOverlay({ hud }) {
  const weaponId = hud?.weaponId || "plasma";
  const reloading = hud?.reloading;
  const ammo = hud?.ammo ?? 24;
  const w = WEAPONS[weaponId] || WEAPONS.plasma;
  // Track "fire moments" — when ammo decreases, trigger a recoil
  // animation pulse.
  const [recoilKey, setRecoilKey] = useState(0);
  const [muzzleKey, setMuzzleKey] = useState(0);
  const lastAmmoRef = useRef(ammo);
  useEffect(() => {
    if (ammo < lastAmmoRef.current && !reloading) {
      setRecoilKey((k) => k + 1);
      setMuzzleKey((k) => k + 1);
    }
    lastAmmoRef.current = ammo;
  }, [ammo, reloading]);

  return (
    <div style={{
      position: "absolute",
      left: 0, right: 0,
      bottom: 0,
      height: 200,
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-end",
      pointerEvents: "none",
      zIndex: 5,
    }}>
      {/* Idle bob wrapper */}
      <div style={{
        position: "relative",
        width: 320, height: 200,
        animation: reloading ? "wo-reload 1s linear infinite" : "wo-bob 3.4s ease-in-out infinite",
      }}>
        {/* Recoil wrapper — gets re-keyed on each shot so the CSS
            animation restarts. */}
        <div key={recoilKey} style={{
          position: "absolute", inset: 0,
          animation: "wo-recoil 220ms cubic-bezier(.2,.7,.3,1)",
        }}>
          <WeaponSVG weapon={w} />
        </div>
        {/* Muzzle flash — pulses on each shot. Positioned at the gun's
            barrel tip. */}
        <MuzzleFlash key={muzzleKey} color={w.color} />
      </div>
      <style>{`
        @keyframes wo-bob {
          0%, 100% { transform: translateY(0) rotate(-0.5deg); }
          50%      { transform: translateY(-6px) rotate(0.5deg); }
        }
        @keyframes wo-recoil {
          0%   { transform: translateY(0)    rotate(0)    scale(1); }
          15%  { transform: translateY(8px)  rotate(-2deg) scale(0.985); }
          60%  { transform: translateY(-2px) rotate(1deg)  scale(1.005); }
          100% { transform: translateY(0)    rotate(0)     scale(1); }
        }
        @keyframes wo-reload {
          0%   { transform: rotate(0)    translateY(0); }
          50%  { transform: rotate(180deg) translateY(20px); }
          100% { transform: rotate(360deg) translateY(0); }
        }
        @keyframes wo-muzzle {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
          20%  { opacity: 1; transform: translate(-50%, -50%) scale(1.5); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(2.2); }
        }
      `}</style>
    </div>
  );
}

// SVG silhouette of a stylized first-person sci-fi gun. The "camera"
// is behind + slightly above the gun, looking forward — so we see the
// REAR + TOP of the weapon with the barrel pointing into the screen.
function WeaponSVG({ weapon }) {
  const c = weapon.color;
  const a = weapon.accent;
  // SVG viewBox is 320×200. The gun is drawn in a 3/4-from-above
  // first-person perspective: rear-grip lower-left, barrel up-right.
  return (
    <svg viewBox="0 0 320 200" width="100%" height="100%"
         style={{ filter: `drop-shadow(0 0 18px ${c}66)` }}>
      <defs>
        <linearGradient id={`bodyGrad-${weapon.silhouette}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="0.9" />
          <stop offset="0.5" stopColor={c} stopOpacity="0.55" />
          <stop offset="1" stopColor="#0a0a1a" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`accentGrad-${weapon.silhouette}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor={a} stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Forearm — extends from bottom-center down-and-forward */}
      <polygon
        points="120,200 200,200 195,150 125,150"
        fill="#241810"
        stroke={a} strokeWidth="1.5"
      />
      <rect x="130" y="155" width="60" height="6" fill={a} opacity="0.9" />

      {/* Wrist / cyber-glove */}
      <rect x="125" y="125" width="70" height="30" rx="4"
        fill="#3a2818" stroke={a} strokeWidth="1.5" />
      <rect x="125" y="125" width="70" height="6" fill={a} opacity="0.95" />
      <rect x="125" y="148" width="70" height="3" fill={c} opacity="0.7" />

      {/* Grip — extends up from the wrist */}
      <rect x="135" y="95" width="50" height="38" rx="3"
        fill="#252533" stroke={a} strokeWidth="1.5" />

      {/* Receiver / main body — sits on top of grip, runs left-to-right */}
      <rect x="85" y="68" width="180" height="40" rx="4"
        fill={`url(#bodyGrad-${weapon.silhouette})`}
        stroke={c} strokeWidth="2" />

      {/* Top trim strip — bright accent */}
      <rect x="95" y="64" width="160" height="8" rx="3"
        fill={`url(#accentGrad-${weapon.silhouette})`} />

      {/* Side details / vents */}
      <rect x="105" y="80" width="6" height="20" fill={a} opacity="0.8" />
      <rect x="118" y="80" width="6" height="20" fill={a} opacity="0.8" />
      <rect x="131" y="80" width="6" height="20" fill={a} opacity="0.8" />

      {/* Sight rail — small notch on top */}
      <rect x="180" y="56" width="14" height="10" rx="1" fill="#0a0a1a" stroke={a} />
      <rect x="183" y="58" width="8" height="2" fill={a} />

      {/* Barrel — extends right toward where the player aims */}
      {weapon.silhouette === "sniper" && (
        <>
          {/* Scope on top */}
          <ellipse cx="200" cy="50" rx="32" ry="10" fill="#0a0a1a" stroke={a} strokeWidth="1.5" />
          <ellipse cx="220" cy="50" rx="6" ry="5" fill={c} opacity="0.7" />
          <rect x="240" y="80" width="56" height="14" fill="#1a1a2a" stroke={c} strokeWidth="1.5" />
          <circle cx="296" cy="87" r="9" fill={c} />
          <circle cx="296" cy="87" r="5" fill="#fff" opacity="0.9" />
        </>
      )}
      {weapon.silhouette === "shotgun" && (
        <>
          <rect x="240" y="74" width="48" height="28" rx="3" fill="#1a1a2a" stroke={c} strokeWidth="1.5" />
          <circle cx="284" cy="82" r="5" fill={c} opacity="0.85" />
          <circle cx="284" cy="92" r="5" fill={c} opacity="0.85" />
          <circle cx="294" cy="82" r="4" fill="#fff" opacity="0.9" />
        </>
      )}
      {weapon.silhouette === "rail" && (
        <>
          <rect x="240" y="78" width="58" height="18" fill="#1a1a2a" stroke={c} strokeWidth="1.5" />
          {/* Energy coils */}
          <circle cx="252" cy="87" r="5" fill="none" stroke={c} strokeWidth="2" />
          <circle cx="266" cy="87" r="5" fill="none" stroke={c} strokeWidth="2" />
          <circle cx="280" cy="87" r="5" fill="none" stroke={c} strokeWidth="2" />
          <circle cx="294" cy="87" r="6" fill={c} opacity="0.9" />
        </>
      )}
      {weapon.silhouette === "launcher" && (
        <>
          <rect x="240" y="70" width="50" height="32" rx="6" fill="#1a1a2a" stroke={c} strokeWidth="1.5" />
          <circle cx="286" cy="86" r="11" fill={c} opacity="0.85" />
          <circle cx="286" cy="86" r="6" fill="#0a0a1a" />
          <circle cx="286" cy="86" r="3" fill={c} />
        </>
      )}
      {weapon.silhouette === "pistol" && (
        <rect x="232" y="80" width="38" height="14" fill="#1a1a2a" stroke={c} strokeWidth="1.5" />
      )}
      {(weapon.silhouette === "rifle" || weapon.silhouette === "smg") && (
        <>
          <rect x="240" y="80" width={weapon.silhouette === "rifle" ? 60 : 40} height="14"
            fill="#1a1a2a" stroke={c} strokeWidth="1.5" />
          {/* Muzzle ring at the very end */}
          <circle cx={weapon.silhouette === "rifle" ? 304 : 284} cy="87" r="9"
            fill="none" stroke={c} strokeWidth="2.5" />
          <circle cx={weapon.silhouette === "rifle" ? 304 : 284} cy="87" r="4"
            fill={c} opacity="0.7" />
        </>
      )}

      {/* Trigger guard */}
      <path d="M 145 108 Q 145 122 158 122 L 175 122 Q 188 122 188 108"
        fill="none" stroke={a} strokeWidth="2" />

      {/* Name plate — small label on the body */}
      <text x="175" y="92" textAnchor="middle"
        fontFamily="JetBrains Mono, monospace"
        fontSize="9" fontWeight="800" fill={a} opacity="0.9"
        letterSpacing="2">
        {weapon.name}
      </text>
    </svg>
  );
}

function MuzzleFlash({ color }) {
  // Position relative to the gun SVG — barrel tip is roughly at
  // (300, 87) in 320×200 viewbox, which translates to 93.75% / 43.5%.
  return (
    <div style={{
      position: "absolute",
      left: "93%", top: "43%",
      width: 60, height: 60,
      borderRadius: "50%",
      background: `radial-gradient(circle, ${color} 0%, ${color}cc 30%, transparent 65%)`,
      transform: "translate(-50%, -50%) scale(0)",
      opacity: 0,
      animation: "wo-muzzle 110ms ease-out forwards",
      filter: `drop-shadow(0 0 22px ${color})`,
      pointerEvents: "none",
    }} />
  );
}
