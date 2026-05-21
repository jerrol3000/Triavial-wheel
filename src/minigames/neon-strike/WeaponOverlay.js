// WeaponOverlay — first-person SVG weapon viewmodel.
//
// Layout matches the reference photo of a typical FPS viewmodel:
//   • Gun held in the player's right hand, anchored bottom-right
//   • Barrel pointing into the scene (upper-left from the camera POV)
//   • Receiver tilted so we see the TOP + LEFT SIDE of the gun
//   • Camo-gloved right hand wrapping the pistol grip
//   • Bare wrist visible between glove and forearm
//   • Forearm extending off-screen to the bottom-right
//
// Implementation:
//   • Each weapon SVG is drawn in side-profile (real gun anatomy)
//   • A wrapper applies CSS 3D perspective so the side-profile reads
//     as a slightly-rotated 3D object pointing into the scene
//   • A separate Hand SVG layer (not transformed with the gun) sits
//     at the bottom-right and is anatomically drawn
//
// Animations: idle bob, recoil kick, muzzle flash at barrel tip.

import React, { useEffect, useRef, useState } from "react";

export default function WeaponOverlay({ hud }) {
  const weaponId = hud?.weaponId || "plasma";
  const reloading = hud?.reloading;
  const ammo = hud?.ammo ?? 24;

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

  const WeaponSVG = WEAPON_RENDERERS[weaponId] || WEAPON_RENDERERS.plasma;

  return (
    <div style={{
      position: "absolute",
      left: 0, right: 0, top: 0, bottom: 0,
      pointerEvents: "none",
      zIndex: 5,
      perspective: "1200px",
      perspectiveOrigin: "50% 100%",
      overflow: "hidden",
    }}>
      {/* GUN — anchored bottom-right. Mirrored horizontally so the
          GRIP is on the right side of the SVG (which lands at the
          right side of the screen, where the hand is). Then rotated
          ~15deg so the barrel angles up-into-the-scene. */}
      <div style={{
        position: "absolute",
        right: "-5%", bottom: "-8%",
        width: 640, height: 380,
        // scaleX(-1) mirrors the gun so muzzle is on the LEFT side of
        // the SVG and grip on the RIGHT. Then a small Z rotation lifts
        // the muzzle. rotateY adds a hint of perspective.
        transform: "scaleX(-1) rotateZ(15deg) rotateY(15deg) rotateX(6deg)",
        transformOrigin: "78% 78%",
        animation: reloading
          ? "wo-reload 1s linear infinite"
          : "wo-bob 3.6s ease-in-out infinite",
      }}>
        <div key={recoilKey} style={{
          position: "absolute", inset: 0,
          animation: "wo-recoil 220ms cubic-bezier(.2,.7,.3,1)",
          transformStyle: "preserve-3d",
        }}>
          <WeaponSVG />
        </div>
        <MuzzleFlash key={muzzleKey} flashColor={MUZZLE_COLORS[weaponId] || "#fff7d6"} />
      </div>

      {/* HAND + FOREARM — separate layer so it always reads as "your
          hand" regardless of the gun rotation. */}
      <FirstPersonHand reloading={reloading} />

      <style>{`
        @keyframes wo-bob {
          0%, 100% { transform: scaleX(-1) rotateZ(15deg) rotateY(15deg) rotateX(6deg) translateY(0); }
          50%      { transform: scaleX(-1) rotateZ(15deg) rotateY(15deg) rotateX(6deg) translateY(-6px); }
        }
        @keyframes wo-recoil {
          0%   { transform: translateY(0) translateX(0) rotate(0); }
          18%  { transform: translateY(14px) translateX(-8px) rotate(2deg); }
          60%  { transform: translateY(-3px) translateX(2px) rotate(-0.5deg); }
          100% { transform: translateY(0) translateX(0) rotate(0); }
        }
        @keyframes wo-reload {
          0%   { transform: scaleX(-1) rotateZ(15deg) rotateY(15deg) rotateX(6deg) rotate(0); }
          50%  { transform: scaleX(-1) rotateZ(15deg) rotateY(15deg) rotateX(6deg) rotate(180deg) translateY(30px); }
          100% { transform: scaleX(-1) rotateZ(15deg) rotateY(15deg) rotateX(6deg) rotate(360deg); }
        }
        @keyframes wo-muzzle {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.2); }
          15%  { opacity: 1; transform: translate(-50%, -50%) scale(1.4); }
          55%  { opacity: 0.7; transform: translate(-50%, -50%) scale(1.9); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4); }
        }
      `}</style>
    </div>
  );
}

const MUZZLE_COLORS = {
  plasma: "#ffcc66",
  smg: "#ffd28c",
  shotgun: "#ffb366",
  sniper: "#fff2a8",
  railgun: "#a5e8ff",
  gravity: "#b8d4ff",
  pistol: "#ffcc66",
};

// ── Shared gradient defs ────────────────────────────────────────────
function SharedDefs() {
  return (
    <defs>
      <linearGradient id="gunmetal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5a5e68" />
        <stop offset="0.3" stopColor="#3a3e48" />
        <stop offset="0.7" stopColor="#202428" />
        <stop offset="1" stopColor="#0e1014" />
      </linearGradient>
      <linearGradient id="gunmetalDark" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2a2e34" />
        <stop offset="1" stopColor="#08090c" />
      </linearGradient>
      <linearGradient id="gunmetalLight" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8a8e98" />
        <stop offset="0.5" stopColor="#5a5e68" />
        <stop offset="1" stopColor="#2a2e34" />
      </linearGradient>
      <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d8dadd" />
        <stop offset="0.3" stopColor="#9da0a5" />
        <stop offset="0.65" stopColor="#6a6e74" />
        <stop offset="1" stopColor="#3a3e44" />
      </linearGradient>
      <linearGradient id="odGreen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6b7855" />
        <stop offset="0.5" stopColor="#4a5340" />
        <stop offset="1" stopColor="#2a301f" />
      </linearGradient>
      <linearGradient id="khaki" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d4b885" />
        <stop offset="0.5" stopColor="#a78858" />
        <stop offset="1" stopColor="#6a5230" />
      </linearGradient>
      <linearGradient id="woodWarm" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#a85838" />
        <stop offset="0.4" stopColor="#7a3e20" />
        <stop offset="1" stopColor="#3a1a0a" />
      </linearGradient>
      <linearGradient id="woodLight" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#9a5a2a" />
        <stop offset="0.5" stopColor="#6a3e1a" />
        <stop offset="1" stopColor="#2a1a08" />
      </linearGradient>
      <linearGradient id="barrelSteel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6a6e7a" />
        <stop offset="0.5" stopColor="#3a3e48" />
        <stop offset="1" stopColor="#1a1e24" />
      </linearGradient>
      <linearGradient id="polymerBlack" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#34383e" />
        <stop offset="0.5" stopColor="#1c1e22" />
        <stop offset="1" stopColor="#0a0c10" />
      </linearGradient>
      <radialGradient id="redDotGrad">
        <stop offset="0" stopColor="#ff5050" />
        <stop offset="0.5" stopColor="#cc2020" />
        <stop offset="1" stopColor="#400000" stopOpacity="0" />
      </radialGradient>
      {/* Neon accents */}
      <radialGradient id="neonPurple">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.4" stopColor="#a78bfa" />
        <stop offset="1" stopColor="#6d28d9" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neonGreen">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.4" stopColor="#34d399" />
        <stop offset="1" stopColor="#047857" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neonCyan">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.4" stopColor="#22d3ee" />
        <stop offset="1" stopColor="#0e7490" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neonPink">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.4" stopColor="#f472b6" />
        <stop offset="1" stopColor="#9d174d" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neonLilac">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.4" stopColor="#c084fc" />
        <stop offset="1" stopColor="#7e22ce" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neonAmber">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.4" stopColor="#fbbf24" />
        <stop offset="1" stopColor="#b45309" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neonBlue">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.4" stopColor="#60a5fa" />
        <stop offset="1" stopColor="#1d4ed8" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PLASMA — AKS-74 (warm wood furniture, gas tube, curved 5.45 mag,
// distinctive muzzle brake) — drawn in side profile.
// ═══════════════════════════════════════════════════════════════════
function PlasmaSVG() {
  return (
    <svg viewBox="0 0 720 420" width="100%" height="100%" style={{ filter: "drop-shadow(0 12px 16px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Side-folding skeleton stock */}
      <rect x="20" y="190" width="78" height="6" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
      <rect x="20" y="216" width="78" height="6" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
      <rect x="94" y="190" width="6" height="32" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />

      {/* Receiver */}
      <rect x="100" y="184" width="200" height="68" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <rect x="108" y="174" width="184" height="12" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      {[124, 144, 164, 184, 204, 224, 244, 264].map((x) => (
        <line key={x} x1={x} y1="176" x2={x} y2="184" stroke="#000" strokeWidth="0.5" />
      ))}
      {/* Rear sight */}
      <rect x="186" y="166" width="28" height="10" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="196" y="170" width="8" height="4" fill="#000" />

      {/* Selector lever */}
      <rect x="260" y="194" width="28" height="8" rx="1" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />

      {/* Wood pistol grip */}
      <path d="M 212 252 Q 208 260 212 272 L 228 332 Q 232 340 240 340 L 256 340 Q 268 338 270 328 L 258 252 Z"
        fill="url(#woodWarm)" stroke="#000" strokeWidth="1.5" />
      {[270, 288, 306].map((y) => (
        <line key={y} x1="222" y1={y} x2="264" y2={y - 6} stroke="#3a1808" strokeWidth="0.8" opacity="0.7" />
      ))}

      {/* Trigger guard */}
      <path d="M 258 252 L 258 268 Q 258 290 286 290 L 314 290 Q 326 290 326 280 L 326 252 Z"
        fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <path d="M 296 270 Q 296 286 300 286 L 304 284 Q 304 274 300 270 Z" fill="#000" />

      {/* Curved AK-74 magazine */}
      <path d="M 138 252 L 144 258 L 156 320 Q 158 340 170 342 L 220 348 Q 232 346 230 336 L 220 258 L 210 250 Z"
        fill="url(#woodWarm)" stroke="#000" strokeWidth="1.5" />
      <path d="M 144 274 Q 175 286 222 290" fill="none" stroke="#3a1808" strokeWidth="0.9" opacity="0.65" />
      <path d="M 148 304 Q 178 314 226 314" fill="none" stroke="#3a1808" strokeWidth="0.9" opacity="0.65" />
      <path d="M 152 334 Q 184 340 230 340" fill="none" stroke="#3a1808" strokeWidth="0.9" opacity="0.65" />

      {/* Gas tube (wood, above barrel) */}
      <rect x="300" y="166" width="140" height="16" fill="url(#woodWarm)" stroke="#000" strokeWidth="1.2" />
      {[316, 336, 356, 376, 396, 416].map((x) => (
        <ellipse key={x} cx={x} cy="174" rx="4" ry="3" fill="#1a0a05" />
      ))}

      {/* Lower handguard */}
      <rect x="300" y="206" width="140" height="40" fill="url(#woodWarm)" stroke="#000" strokeWidth="1.2" />
      <path d="M 308 218 Q 370 212 432 218" fill="none" stroke="#3a1808" strokeWidth="0.8" opacity="0.6" />
      <path d="M 308 230 Q 370 224 432 230" fill="none" stroke="#3a1808" strokeWidth="0.8" opacity="0.6" />

      {/* Front sight tower */}
      <rect x="440" y="176" width="24" height="72" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <rect x="444" y="156" width="16" height="22" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="450" y="152" width="4" height="6" fill="#000" />

      {/* Cleaning rod */}
      <rect x="305" y="246" width="135" height="3" fill="url(#barrelSteel)" />

      {/* Barrel */}
      <rect x="464" y="204" width="140" height="14" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1.2" />

      {/* AK-74 muzzle brake */}
      <rect x="604" y="198" width="40" height="28" rx="2" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <ellipse cx="614" cy="212" rx="3" ry="7" fill="#000" />
      <ellipse cx="628" cy="212" rx="3" ry="8" fill="#000" />
      <ellipse cx="640" cy="212" rx="5" ry="9" fill="#0a0a0a" />
      <ellipse cx="640" cy="212" rx="2" ry="4" fill="url(#neonPurple)" opacity="0.7" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PULSE-SMG — MP9/UMP-style: black polymer, picatinny rail, vertical
// mag, folding stock
// ═══════════════════════════════════════════════════════════════════
function SmgSVG() {
  return (
    <svg viewBox="0 0 720 420" width="100%" height="100%" style={{ filter: "drop-shadow(0 12px 16px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Folding stock */}
      <rect x="20" y="186" width="58" height="8" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1" />
      <rect x="20" y="208" width="58" height="8" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1" />
      <rect x="20" y="230" width="58" height="8" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1" />
      <circle cx="90" cy="214" r="10" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <circle cx="90" cy="214" r="5" fill="#000" />

      {/* Receiver */}
      <rect x="100" y="180" width="240" height="84" rx="6" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />

      {/* Picatinny rail */}
      <rect x="112" y="170" width="240" height="14" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
      {[118, 128, 138, 148, 158, 168, 178, 188, 198, 208, 218, 228, 238, 248, 258, 268, 278, 288, 298, 308, 318, 328, 338].map((x) => (
        <rect key={x} x={x} y="172" width="2" height="10" fill="#000" />
      ))}

      {/* Iron sights flanking red dot */}
      <rect x="134" y="156" width="10" height="16" fill="url(#chrome)" stroke="#000" strokeWidth="1" />
      <circle cx="139" cy="160" r="2" fill="#fff" />
      <rect x="320" y="156" width="10" height="16" fill="url(#chrome)" stroke="#000" strokeWidth="1" />
      <circle cx="325" cy="160" r="2" fill="#fff" />

      {/* Red dot sight on top */}
      <rect x="216" y="138" width="50" height="34" rx="3" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <rect x="222" y="144" width="38" height="22" rx="2" fill="#1a0a0a" />
      <rect x="224" y="146" width="34" height="18" rx="1" fill="#4a1a14" opacity="0.6" />
      <circle cx="241" cy="155" r="4" fill="url(#redDotGrad)" />

      {/* Ergonomic pistol grip */}
      <path d="M 224 264 L 226 274 L 238 332 Q 242 340 250 340 L 266 340 Q 278 338 280 328 L 274 264 Z"
        fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />

      {/* Trigger guard */}
      <path d="M 274 264 L 274 278 Q 274 296 294 296 L 320 296 Q 332 296 332 286 L 332 264 Z"
        fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <line x1="302" y1="278" x2="302" y2="294" stroke="#000" strokeWidth="2.5" />

      {/* Vertical magazine */}
      <rect x="146" y="264" width="48" height="96" rx="3" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />
      <line x1="152" y1="280" x2="188" y2="280" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="152" y1="300" x2="188" y2="300" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="152" y1="320" x2="188" y2="320" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="152" y1="340" x2="188" y2="340" stroke="#1a1a1a" strokeWidth="1" />

      {/* Charging handle */}
      <rect x="320" y="190" width="26" height="10" rx="2" fill="url(#gunmetalLight)" stroke="#000" strokeWidth="1" />

      {/* Front handguard with M-LOK slots */}
      <rect x="340" y="198" width="96" height="58" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />
      {[214, 234].map((y) => (
        <g key={y}>
          <rect x="350" y={y} width="18" height="6" rx="1" fill="#000" />
          <rect x="374" y={y} width="18" height="6" rx="1" fill="#000" />
          <rect x="398" y={y} width="18" height="6" rx="1" fill="#000" />
        </g>
      ))}

      {/* Barrel + suppressor */}
      <rect x="436" y="214" width="96" height="16" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      <rect x="532" y="204" width="72" height="36" rx="3" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      {[546, 562, 578, 594].map((x) => (
        <line key={x} x1={x} y1="206" x2={x} y2="238" stroke="#000" strokeWidth="0.8" />
      ))}
      <ellipse cx="604" cy="222" rx="5" ry="13" fill="#000" />
      <ellipse cx="604" cy="222" rx="2.5" ry="7" fill="url(#neonGreen)" opacity="0.6" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PULSE-12 — Remington 870 pump shotgun
// ═══════════════════════════════════════════════════════════════════
function ShotgunSVG() {
  return (
    <svg viewBox="0 0 720 420" width="100%" height="100%" style={{ filter: "drop-shadow(0 12px 16px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Wood stock */}
      <path d="M 30 188 Q 26 180 36 174 L 100 168 L 112 240 L 112 274 L 42 280 Q 32 278 30 268 Z"
        fill="url(#woodLight)" stroke="#000" strokeWidth="1.5" />
      <path d="M 44 192 Q 70 188 102 186" fill="none" stroke="#3a1f08" strokeWidth="0.8" opacity="0.5" />
      <path d="M 46 240 Q 70 240 100 240" fill="none" stroke="#3a1f08" strokeWidth="0.8" opacity="0.5" />
      <path d="M 28 186 Q 26 180 30 174 L 38 172 L 42 278 L 32 278 Q 26 276 28 268 Z" fill="#1a0a05" />

      {/* Chrome receiver */}
      <rect x="112" y="188" width="140" height="68" fill="url(#chrome)" stroke="#000" strokeWidth="1.5" />
      <rect x="118" y="180" width="128" height="8" fill="url(#gunmetalDark)" />
      <rect x="160" y="198" width="60" height="22" rx="2" fill="#000" />
      <rect x="164" y="202" width="50" height="12" fill="url(#gunmetalDark)" />

      {/* Trigger guard */}
      <rect x="180" y="256" width="50" height="26" rx="2" fill="url(#chrome)" stroke="#000" strokeWidth="1.2" />
      <path d="M 192 272 Q 192 288 204 288 L 220 288 Q 226 288 226 282 L 226 272 Z" fill="none" stroke="#000" strokeWidth="2.5" />

      {/* Wood wrist of stock */}
      <path d="M 108 256 L 108 282 Q 108 294 114 294 L 180 294 L 180 256 Z" fill="url(#woodLight)" stroke="#000" strokeWidth="1.2" />

      {/* Wooden pump grip with ribs */}
      <rect x="278" y="220" width="116" height="48" rx="3" fill="url(#woodLight)" stroke="#000" strokeWidth="1.5" />
      {[286, 298, 310, 322, 334, 346, 358, 370, 382].map((x) => (
        <rect key={x} x={x} y="224" width="2" height="40" fill="#2a1408" opacity="0.9" />
      ))}

      {/* Magazine tube under barrel */}
      <rect x="252" y="266" width="278" height="14" fill="url(#chrome)" stroke="#000" strokeWidth="1" />
      <ellipse cx="528" cy="273" rx="5" ry="9" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />

      {/* Barrel */}
      <rect x="252" y="204" width="278" height="14" fill="url(#chrome)" stroke="#000" strokeWidth="1.2" />
      <circle cx="520" cy="200" r="4" fill="url(#neonPink)" />
      <circle cx="520" cy="200" r="2" fill="#fff" />

      {/* Wide muzzle */}
      <rect x="530" y="200" width="16" height="22" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
      <ellipse cx="538" cy="212" rx="5" ry="9" fill="#000" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Q-SNIPER — AWP / L96
// ═══════════════════════════════════════════════════════════════════
function SniperSVG() {
  return (
    <svg viewBox="0 0 720 420" width="100%" height="100%" style={{ filter: "drop-shadow(0 12px 16px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* OD-green skeleton stock with thumbhole */}
      <path d="M 20 196 Q 16 190 22 184 L 90 178 L 98 194 L 98 256 L 90 270 L 22 270 Q 16 264 20 258 Z"
        fill="url(#odGreen)" stroke="#000" strokeWidth="1.5" />
      <ellipse cx="74" cy="226" rx="16" ry="14" fill="#0a0a08" stroke="#000" strokeWidth="1" />
      <ellipse cx="46" cy="202" rx="5" ry="4" fill="#1a1a14" />
      <ellipse cx="46" cy="218" rx="5" ry="4" fill="#1a1a14" />
      <ellipse cx="46" cy="234" rx="5" ry="4" fill="#1a1a14" />
      <ellipse cx="46" cy="250" rx="5" ry="4" fill="#1a1a14" />
      <text x="34" y="186" fontFamily="JetBrains Mono, monospace" fontSize="11" fontWeight="800" fill="#d8d4c0" opacity="0.85" letterSpacing="1">048</text>
      <rect x="86" y="170" width="58" height="16" rx="2" fill="url(#odGreen)" stroke="#000" strokeWidth="1.2" />

      {/* Receiver */}
      <rect x="98" y="188" width="156" height="56" fill="url(#odGreen)" stroke="#000" strokeWidth="1.5" />
      <rect x="180" y="176" width="56" height="16" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <circle cx="232" cy="184" r="10" fill="url(#gunmetalLight)" stroke="#000" strokeWidth="1" />

      {/* Trigger guard */}
      <path d="M 142 244 L 142 270 Q 142 286 158 286 L 178 286 Q 188 286 188 278 L 188 244 Z"
        fill="url(#odGreen)" stroke="#000" strokeWidth="1.2" />

      {/* Magazine */}
      <rect x="112" y="244" width="32" height="48" rx="2" fill="url(#odGreen)" stroke="#000" strokeWidth="1.2" />

      {/* Long thin barrel */}
      <rect x="254" y="208" width="318" height="12" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      <rect x="572" y="200" width="34" height="26" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <ellipse cx="580" cy="213" rx="2" ry="7" fill="#000" />
      <ellipse cx="590" cy="213" rx="3" ry="8" fill="#000" />
      <ellipse cx="600" cy="213" rx="4" ry="9" fill="#0a0a0a" />
      <ellipse cx="600" cy="213" rx="2" ry="5" fill="url(#neonLilac)" opacity="0.7" />

      {/* HUGE SCOPE */}
      <rect x="120" y="118" width="156" height="26" rx="4" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <rect x="138" y="142" width="20" height="16" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <rect x="240" y="142" width="20" height="16" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <rect x="180" y="98" width="26" height="22" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <circle cx="193" cy="103" r="8" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="212" y="112" width="16" height="10" rx="1" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
      {/* Front objective bell */}
      <ellipse cx="282" cy="131" rx="22" ry="22" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <ellipse cx="282" cy="131" rx="16" ry="16" fill="#0a0a14" />
      <ellipse cx="287" cy="126" rx="6" ry="6" fill="url(#neonLilac)" opacity="0.85" />
      <ellipse cx="289" cy="124" rx="2.5" ry="2.5" fill="#fff" />
      {/* Rear bell */}
      <ellipse cx="114" cy="131" rx="14" ry="15" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <ellipse cx="114" cy="131" rx="9" ry="10" fill="#000" />

      {/* Bipod */}
      <line x1="312" y1="222" x2="288" y2="320" stroke="url(#gunmetalDark)" strokeWidth="5" strokeLinecap="round" />
      <line x1="336" y1="222" x2="360" y2="320" stroke="url(#gunmetalDark)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RAILGUN — L85A2 bullpup
// ═══════════════════════════════════════════════════════════════════
function RailgunSVG() {
  return (
    <svg viewBox="0 0 720 420" width="100%" height="100%" style={{ filter: "drop-shadow(0 12px 16px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      <path d="M 24 196 Q 20 188 28 184 L 60 182 L 60 270 L 28 270 Q 20 266 24 258 Z" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <rect x="60" y="182" width="70" height="22" fill="url(#khaki)" stroke="#000" strokeWidth="1.2" />

      {/* Receiver */}
      <rect x="60" y="204" width="320" height="68" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <rect x="68" y="208" width="180" height="58" fill="url(#khaki)" stroke="#000" strokeWidth="1.2" />
      <text x="204" y="248" fontFamily="JetBrains Mono, monospace" fontSize="13" fontWeight="800" fill="#3a2818" opacity="0.9" letterSpacing="1.5">017</text>

      {/* Magazine behind grip (bullpup) */}
      <rect x="84" y="272" width="50" height="74" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />

      {/* Ejection port */}
      <rect x="158" y="218" width="46" height="16" rx="1" fill="#000" />

      {/* Pistol grip (tan, in front of mag) */}
      <path d="M 228 272 L 232 282 L 244 332 Q 248 340 256 340 L 274 340 Q 286 338 288 328 L 282 272 Z"
        fill="url(#khaki)" stroke="#000" strokeWidth="1.5" />

      {/* Trigger guard */}
      <path d="M 282 272 L 286 290 Q 286 308 304 308 L 328 308 Q 340 308 340 298 L 340 272 Z"
        fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />

      {/* Carrying handle / SUSAT */}
      <rect x="138" y="168" width="138" height="22" rx="3" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <rect x="156" y="142" width="92" height="26" rx="3" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <ellipse cx="172" cy="155" rx="8" ry="10" fill="#000" stroke="url(#gunmetal)" strokeWidth="1" />
      <ellipse cx="172" cy="155" rx="4" ry="5" fill="url(#neonCyan)" opacity="0.8" />
      <ellipse cx="234" cy="155" rx="11" ry="13" fill="#000" stroke="url(#gunmetal)" strokeWidth="1" />
      <ellipse cx="234" cy="155" rx="6" ry="7" fill="url(#neonCyan)" opacity="0.6" />

      {/* Front handguard */}
      <rect x="380" y="204" width="140" height="68" fill="url(#khaki)" stroke="#000" strokeWidth="1.5" />
      {[214, 230, 246, 262].map((y) => (
        <rect key={y} x="394" y={y} width="46" height="3" fill="#3a2818" opacity="0.85" />
      ))}

      {/* Front sight tower */}
      <rect x="520" y="178" width="16" height="74" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <rect x="522" y="168" width="12" height="14" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />

      {/* Barrel + muzzle */}
      <rect x="536" y="222" width="60" height="16" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      <rect x="596" y="216" width="26" height="30" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <ellipse cx="606" cy="231" rx="5" ry="10" fill="#000" />
      <ellipse cx="606" cy="231" rx="2.5" ry="5" fill="url(#neonCyan)" opacity="0.7" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// G-LAUNCH — 40mm grenade launcher
// ═══════════════════════════════════════════════════════════════════
function LauncherSVG() {
  return (
    <svg viewBox="0 0 720 420" width="100%" height="100%" style={{ filter: "drop-shadow(0 12px 16px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      <path d="M 24 184 Q 20 176 30 172 L 100 170 L 112 262 L 32 270 Q 22 268 24 258 Z" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />
      <rect x="112" y="170" width="180" height="98" rx="4" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.5" />
      <rect x="118" y="162" width="170" height="10" fill="url(#gunmetalDark)" />
      <rect x="124" y="184" width="50" height="26" rx="2" fill="#0a0a14" stroke="url(#neonBlue)" strokeWidth="1.5" />
      <text x="149" y="204" textAnchor="middle" fontSize="16" fontWeight="800" fontFamily="JetBrains Mono, monospace" fill="url(#neonBlue)" letterSpacing="2">06</text>

      {/* Grip */}
      <path d="M 218 268 L 224 278 L 236 334 Q 240 342 248 342 L 264 342 Q 276 340 278 330 L 272 268 Z" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />
      <path d="M 272 268 L 276 282 Q 276 302 296 302 L 322 302 Q 334 302 334 292 L 334 268 Z" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />

      {/* Forward grip pump */}
      <rect x="296" y="200" width="116" height="68" rx="3" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />
      {[306, 320, 334, 348, 362, 376, 390].map((x) => (
        <rect key={x} x={x} y="208" width="3" height="52" fill="#000" />
      ))}

      {/* Heavy barrel with massive bore */}
      <rect x="412" y="188" width="180" height="100" rx="8" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <rect x="488" y="178" width="8" height="14" fill="url(#gunmetal)" />
      <ellipse cx="580" cy="238" rx="28" ry="42" fill="url(#gunmetal)" stroke="#000" strokeWidth="2" />
      <ellipse cx="580" cy="238" rx="22" ry="34" fill="#000" />
      <ellipse cx="580" cy="238" rx="14" ry="22" fill="url(#neonBlue)" opacity="0.6" />
      <ellipse cx="580" cy="238" rx="6" ry="11" fill="url(#neonBlue)" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SIDEKICK — Makarov PM
// ═══════════════════════════════════════════════════════════════════
function PistolSVG() {
  return (
    <svg viewBox="0 0 720 420" width="100%" height="100%" style={{ filter: "drop-shadow(0 12px 16px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Slide */}
      <rect x="200" y="190" width="200" height="48" rx="3" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <rect x="206" y="186" width="190" height="6" fill="url(#gunmetal)" />
      <rect x="394" y="172" width="6" height="14" fill="url(#gunmetal)" />
      <rect x="212" y="174" width="16" height="14" fill="url(#gunmetal)" />
      <rect x="218" y="178" width="6" height="6" fill="#000" />
      {[214, 222, 230, 238, 246, 254].map((x) => (
        <line key={x} x1={x} y1="194" x2={x} y2="232" stroke="#000" strokeWidth="1" />
      ))}
      <rect x="280" y="192" width="40" height="16" rx="1" fill="#000" />
      <rect x="284" y="195" width="32" height="8" fill="url(#gunmetalLight)" opacity="0.4" />

      {/* Barrel */}
      <rect x="400" y="200" width="16" height="20" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      <ellipse cx="412" cy="210" rx="4" ry="7" fill="#000" />
      <ellipse cx="412" cy="210" rx="2" ry="3" fill="url(#neonAmber)" opacity="0.7" />

      {/* Frame */}
      <polygon points="194,238 416,238 426,266 184,266" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />

      {/* Trigger guard */}
      <path d="M 220 266 L 220 282 Q 220 302 240 302 L 260 302 Q 270 302 270 294 L 270 266 Z"
        fill="none" stroke="url(#gunmetalDark)" strokeWidth="3" />

      {/* Wood grip */}
      <path d="M 196 266 L 202 282 L 214 366 Q 218 374 226 374 L 274 374 Q 286 372 288 362 L 280 266 Z"
        fill="url(#woodWarm)" stroke="#000" strokeWidth="1.5" />
      <path d="M 208 312 Q 244 318 282 312" fill="none" stroke="#3a1808" strokeWidth="0.8" opacity="0.6" />
      <path d="M 210 344 Q 246 350 282 344" fill="none" stroke="#3a1808" strokeWidth="0.8" opacity="0.6" />
      <circle cx="244" cy="328" r="8" fill="url(#gunmetalDark)" stroke="url(#neonAmber)" strokeWidth="1.5" />
      <text x="244" y="332" textAnchor="middle" fontSize="9" fontWeight="800" fontFamily="JetBrains Mono, monospace" fill="url(#neonAmber)">★</text>

      <rect x="210" y="370" width="76" height="10" rx="1" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />

      {/* Hammer */}
      <path d="M 196 192 L 198 174 L 212 174 L 212 192 Z" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
    </svg>
  );
}

const WEAPON_RENDERERS = {
  plasma: PlasmaSVG,
  smg: SmgSVG,
  shotgun: ShotgunSVG,
  sniper: SniperSVG,
  railgun: RailgunSVG,
  gravity: LauncherSVG,
  pistol: PistolSVG,
};

// ── First-person hand on the grip — anatomically detailed ───────────
// Drawn in 320×400 viewBox. The hand wraps the pistol grip with the
// knuckles visible to the camera (we see the back of the right hand),
// thumb wrapping around the front of the grip, fingers curling
// underneath. Camo glove with a hex texture; bare wrist showing
// between glove cuff and forearm.
function FirstPersonHand({ reloading }) {
  if (reloading) return null;
  return (
    <div style={{
      position: "absolute",
      right: "8%", bottom: "-3%",
      width: 230, height: 280,
      pointerEvents: "none",
      filter: "drop-shadow(0 10px 16px rgba(0,0,0,0.75))",
    }}>
      <svg viewBox="0 0 380 460" width="100%" height="100%">
        <defs>
          {/* Skin tone gradient (warm, with shadow on far side) */}
          <linearGradient id="handSkin" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#d4a888" />
            <stop offset="0.5" stopColor="#b88868" />
            <stop offset="1" stopColor="#6a4030" />
          </linearGradient>
          {/* Tactical tan glove — solid color, gradient for form */}
          <linearGradient id="gloveTan" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor="#7d6a42" />
            <stop offset="0.5" stopColor="#5a4c2a" />
            <stop offset="1" stopColor="#2a2410" />
          </linearGradient>
          {/* Black tactical glove option (palm/finger reinforcement) */}
          <linearGradient id="gloveBlack" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2a30" />
            <stop offset="1" stopColor="#0a0a0e" />
          </linearGradient>
          {/* Highlight along the top of the glove (light from above) */}
          <linearGradient id="gloveHighlight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a89868" stopOpacity="0.8" />
            <stop offset="1" stopColor="#a89868" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* ── FOREARM — extends from bottom-right corner up to wrist ── */}
        <path d="M 380 460
                 L 380 250
                 Q 360 245  335 252
                 Q 290 268  260 290
                 L 240 320
                 L 240 460 Z"
          fill="url(#handSkin)" stroke="#1a0a05" strokeWidth="2" />
        {/* Arm hair / shading */}
        <path d="M 300 320 Q 320 330 340 332" fill="none" stroke="#6a3820" strokeWidth="1" opacity="0.4" />
        <path d="M 290 350 Q 320 360 350 360" fill="none" stroke="#6a3820" strokeWidth="1" opacity="0.4" />

        {/* ── GLOVE CUFF — band where the glove meets the wrist ── */}
        <path d="M 240 320
                 L 256 296
                 Q 280 282  308 274
                 Q 330 270  348 274
                 L 360 250
                 L 380 245
                 L 380 230
                 Q 350 222  314 230
                 Q 280 240  254 258
                 L 236 282
                 L 222 308 Z"
          fill="url(#gloveTan)" stroke="#0a0a0a" strokeWidth="2" />
        {/* Cuff inner strap */}
        <path d="M 240 320 L 256 296 Q 280 282 308 274 Q 330 270 348 274 L 360 250"
          fill="none" stroke="#000" strokeWidth="3" />
        {/* Velcro strap detail */}
        <rect x="296" y="262" width="44" height="6" rx="1" fill="#1a1208" />

        {/* ── HAND — wraps the pistol grip ── */}
        {/* Back of hand (palm hidden behind grip) */}
        <path d="M 222 308
                 Q 196 286  186 246
                 Q 184 214  196 192
                 Q 218 168  254 168
                 Q 296 174  314 200
                 Q 326 230  320 264
                 Q 308 290  280 304
                 Q 250 312  222 308 Z"
          fill="url(#gloveTan)" stroke="#0a0a0a" strokeWidth="2" />

        {/* Knuckle pads (black rubber strips across the back of hand) */}
        <path d="M 206 196 Q 222 184 244 184 Q 270 184 290 200"
          fill="none" stroke="url(#gloveBlack)" strokeWidth="10" strokeLinecap="round" />
        <path d="M 198 222 Q 220 212 248 214 Q 280 218 304 228"
          fill="none" stroke="url(#gloveBlack)" strokeWidth="8" strokeLinecap="round" />

        {/* THUMB — wrapping around the front of the grip (visible side) */}
        <path d="M 186 246
                 Q 168 240  154 220
                 Q 144 200  152 182
                 Q 168 168  186 176
                 Q 200 188  204 208
                 Q 204 230  198 244 Z"
          fill="url(#gloveTan)" stroke="#0a0a0a" strokeWidth="2" />
        {/* Thumb knuckle pad */}
        <ellipse cx="174" cy="210" rx="14" ry="9" fill="url(#gloveBlack)" opacity="0.85" />
        {/* Thumbnail bump suggestion */}
        <ellipse cx="158" cy="186" rx="6" ry="4" fill="#3a2818" opacity="0.6" />

        {/* INDEX FINGER — extends UP toward the gun's trigger area */}
        <path d="M 254 168
                 Q 258 142  274 130
                 Q 290 122  302 138
                 Q 306 158  300 178 Z"
          fill="url(#gloveTan)" stroke="#0a0a0a" strokeWidth="2" />
        <ellipse cx="286" cy="142" rx="8" ry="6" fill="url(#gloveBlack)" opacity="0.8" />

        {/* Bottom edge — fingers curling underneath (suggested via dark shading) */}
        <path d="M 222 308 Q 250 320 280 318 Q 308 312 318 296"
          fill="none" stroke="#000" strokeWidth="2.5" opacity="0.6" />
      </svg>
    </div>
  );
}

function MuzzleFlash({ flashColor }) {
  // Side-profile guns: muzzle is at the right end (~95%, 50%).
  return (
    <div style={{
      position: "absolute",
      left: "92%", top: "50%",
      width: 100, height: 100,
      borderRadius: "50%",
      background: `radial-gradient(circle, ${flashColor} 0%, ${flashColor}cc 25%, ${flashColor}55 50%, transparent 75%)`,
      transform: "translate(-50%, -50%) scale(0)",
      opacity: 0,
      animation: "wo-muzzle 140ms ease-out forwards",
      filter: `drop-shadow(0 0 40px ${flashColor})`,
      pointerEvents: "none",
      mixBlendMode: "screen",
    }} />
  );
}
