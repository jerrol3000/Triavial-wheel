// WeaponOverlay — first-person SVG weapon viewmodel.
//
// Each gun is drawn to match a real-world reference:
//
//   PLASMA   — AKS-74 / AK-74 (wood furniture, side-folding stock,
//              curved 5.45 mag, gas tube above barrel)
//   PULSE-SMG — B&T MP9 / HK UMP-style compact SMG (all-black polymer,
//              top picatinny rail, vertical mag, folding stock)
//   PULSE-12 — Remington 870-style pump shotgun (chrome receiver,
//              wooden pump grip + stock, mag tube under barrel)
//   Q-SNIPER — AWP / L96A1 (OD-green chassis, thumbhole stock with
//              vent holes, massive black scope, long thin barrel,
//              muzzle brake)
//   RAILGUN  — L85A2 / SA80 bullpup (tan furniture, carrying handle
//              with iron sights, vented handguard, mag behind grip)
//   G-LAUNCH — M203 / standalone grenade launcher with chunky body
//              and wide bore
//   SIDEKICK — Makarov PM (compact frame, wood grip panels, short
//              slide)
//
// Each weapon retains a small neon accent (rail dot, scope reticle,
// muzzle glow) so it still fits the Neon Strike aesthetic — the body
// is realistic but the energy elements glow.
//
// Rendering: wrapper applies CSS 3D perspective for FPS pose. Inner
// SVG handles the gun's anatomy. A separate hand SVG layer renders
// the player's right hand wrapping the grip.

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
      perspective: "900px",
      perspectiveOrigin: "50% 100%",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute",
        right: "-3%", bottom: "-8%",
        width: 600, height: 380,
        transform: "rotateY(-28deg) rotateX(18deg) rotateZ(-5deg) translateZ(-30px)",
        transformOrigin: "85% 85%",
        animation: reloading
          ? "wo-reload 1s linear infinite"
          : "wo-bob 3.4s ease-in-out infinite",
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

      <FirstPersonHand reloading={reloading} />

      <style>{`
        @keyframes wo-bob {
          0%, 100% { transform: rotateY(-28deg) rotateX(18deg) rotateZ(-5deg) translateZ(-30px) translateY(0); }
          50%      { transform: rotateY(-28deg) rotateX(18deg) rotateZ(-5deg) translateZ(-30px) translateY(-5px); }
        }
        @keyframes wo-recoil {
          0%   { transform: translateY(0)    translateZ(0) rotateZ(0); }
          18%  { transform: translateY(12px) translateZ(-30px) rotateZ(-3deg); }
          60%  { transform: translateY(-3px) translateZ(10px) rotateZ(1deg); }
          100% { transform: translateY(0)    translateZ(0) rotateZ(0); }
        }
        @keyframes wo-reload {
          0%   { transform: rotateY(-28deg) rotateX(18deg) rotateZ(-5deg) translateZ(-30px) rotate(0); }
          50%  { transform: rotateY(-28deg) rotateX(18deg) rotateZ(-5deg) translateZ(-30px) rotate(180deg); }
          100% { transform: rotateY(-28deg) rotateX(18deg) rotateZ(-5deg) translateZ(-30px) rotate(360deg); }
        }
        @keyframes wo-muzzle {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.2); }
          15%  { opacity: 1; transform: translate(-50%, -50%) scale(1.6); }
          55%  { opacity: 0.7; transform: translate(-50%, -50%) scale(2.1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(2.6); }
        }
      `}</style>
    </div>
  );
}

const MUZZLE_COLORS = {
  plasma: "#ffcc66",
  smg: "#ffcc66",
  shotgun: "#ffb366",
  sniper: "#fff2a8",
  railgun: "#a5e8ff",
  gravity: "#b8d4ff",
  pistol: "#ffcc66",
};

// ── Shared gradient defs reused by every gun ────────────────────────
function SharedDefs() {
  return (
    <defs>
      {/* Generic gunmetal blue-black */}
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
      {/* Chrome / polished steel — for the shotgun receiver */}
      <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d8dadd" />
        <stop offset="0.3" stopColor="#9da0a5" />
        <stop offset="0.65" stopColor="#6a6e74" />
        <stop offset="1" stopColor="#3a3e44" />
      </linearGradient>
      {/* OD green for the AWP */}
      <linearGradient id="odGreen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6b7855" />
        <stop offset="0.5" stopColor="#4a5340" />
        <stop offset="1" stopColor="#2a301f" />
      </linearGradient>
      {/* Tan/khaki for the L85 bullpup */}
      <linearGradient id="khaki" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d4b885" />
        <stop offset="0.5" stopColor="#a78858" />
        <stop offset="1" stopColor="#6a5230" />
      </linearGradient>
      {/* Warm reddish-brown wood for AK + Makarov grips */}
      <linearGradient id="woodWarm" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#a85838" />
        <stop offset="0.4" stopColor="#7a3e20" />
        <stop offset="1" stopColor="#3a1a0a" />
      </linearGradient>
      {/* Light wood for shotgun stock */}
      <linearGradient id="woodLight" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#9a5a2a" />
        <stop offset="0.5" stopColor="#6a3e1a" />
        <stop offset="1" stopColor="#2a1a08" />
      </linearGradient>
      {/* Barrel steel — slightly bluer */}
      <linearGradient id="barrelSteel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6a6e7a" />
        <stop offset="0.5" stopColor="#3a3e48" />
        <stop offset="1" stopColor="#1a1e24" />
      </linearGradient>
      {/* Black polymer */}
      <linearGradient id="polymerBlack" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#34383e" />
        <stop offset="0.5" stopColor="#1c1e22" />
        <stop offset="1" stopColor="#0a0c10" />
      </linearGradient>
      {/* Neon accents — single subtle dot per weapon */}
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
// PLASMA — AKS-74 (warm wood furniture, side-folding stock, curved
// 5.45 magazine, gas tube above barrel, classic AK silhouette)
// ═══════════════════════════════════════════════════════════════════
function PlasmaSVG() {
  return (
    <svg viewBox="0 0 600 380" width="100%" height="100%" style={{ filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Side-folding skeleton stock (visible past the receiver) */}
      <path d="M 30 165 L 80 158 L 80 168 L 32 174 Z" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <path d="M 30 195 L 80 188 L 80 198 L 32 204 Z" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <rect x="76" y="158" width="6" height="48" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />

      {/* Receiver — main body */}
      <rect x="80" y="155" width="180" height="60" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      {/* Top dust cover */}
      <rect x="86" y="148" width="170" height="10" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      {/* Ribbed cover detail */}
      {[100, 115, 130, 145, 160, 175, 190, 205, 220, 235].map((x) => (
        <line key={x} x1={x} y1="150" x2={x} y2="155" stroke="#000" strokeWidth="0.5" />
      ))}

      {/* Selector lever on right side */}
      <rect x="218" y="160" width="22" height="6" rx="1" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="220" y="161" width="18" height="2" fill="#000" />

      {/* Wood pistol grip */}
      <path d="M 178 215 Q 175 222 178 232 L 192 290 Q 196 296 204 296 L 218 296 Q 228 294 230 286 L 220 215 Z"
        fill="url(#woodWarm)" stroke="#000" strokeWidth="1.5" />
      {/* Grip checkering */}
      {[230, 245, 260].map((y) => (
        <line key={y} x1="186" y1={y} x2="226" y2={y - 6} stroke="#3a1808" strokeWidth="0.8" opacity="0.7" />
      ))}

      {/* Trigger guard */}
      <path d="M 220 215 L 220 230 Q 220 248 244 248 L 268 248 Q 280 248 280 238 L 280 215 Z"
        fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      {/* Trigger */}
      <path d="M 252 230 Q 252 246 256 246 L 260 244 Q 260 235 256 230 Z" fill="#000" stroke="#1a1a1a" />

      {/* Curved AK-74 magazine (5.45mm) — extends down + curves forward */}
      <path d="M 116 215 L 122 220 L 132 280 Q 134 296 144 298 L 188 304 Q 200 302 198 292 L 188 220 L 178 213 Z"
        fill="url(#woodWarm)" stroke="#000" strokeWidth="1.5" />
      {/* Mag ribbing */}
      <path d="M 122 234 Q 145 244 188 246" fill="none" stroke="#3a1808" strokeWidth="0.8" opacity="0.65" />
      <path d="M 125 260 Q 148 270 190 270" fill="none" stroke="#3a1808" strokeWidth="0.8" opacity="0.65" />
      <path d="M 128 286 Q 152 294 192 294" fill="none" stroke="#3a1808" strokeWidth="0.8" opacity="0.65" />

      {/* Gas tube (above barrel, signature AK feature) */}
      <rect x="260" y="140" width="120" height="14" fill="url(#woodWarm)" stroke="#000" strokeWidth="1.2" />
      {/* Gas tube vent holes */}
      {[272, 290, 308, 326, 344, 362].map((x) => (
        <ellipse key={x} cx={x} cy="147" rx="3" ry="2.5" fill="#1a1008" />
      ))}

      {/* Lower handguard (wood forend) */}
      <rect x="260" y="174" width="120" height="34" fill="url(#woodWarm)" stroke="#000" strokeWidth="1.2" />
      {/* Handguard finger grooves */}
      <path d="M 268 184 Q 320 178 372 184" fill="none" stroke="#3a1808" strokeWidth="0.8" opacity="0.6" />
      <path d="M 268 196 Q 320 192 372 196" fill="none" stroke="#3a1808" strokeWidth="0.8" opacity="0.6" />

      {/* Front sight base + tower */}
      <rect x="380" y="148" width="20" height="62" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <rect x="383" y="130" width="14" height="20" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      {/* Front sight post */}
      <rect x="389" y="126" width="2" height="8" fill="#000" />
      {/* Front sight protective ears */}
      <line x1="383" y1="142" x2="383" y2="128" stroke="url(#gunmetal)" strokeWidth="3" />
      <line x1="397" y1="142" x2="397" y2="128" stroke="url(#gunmetal)" strokeWidth="3" />

      {/* Cleaning rod under barrel */}
      <rect x="265" y="208" width="115" height="3" fill="url(#barrelSteel)" />

      {/* Barrel */}
      <rect x="400" y="172" width="120" height="14" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1.2" />
      {/* AK-74 distinctive muzzle brake */}
      <rect x="520" y="166" width="32" height="26" rx="2" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <ellipse cx="528" cy="179" rx="2" ry="6" fill="#000" />
      <ellipse cx="540" cy="179" rx="3" ry="7" fill="#000" />
      {/* Muzzle hole */}
      <ellipse cx="546" cy="179" rx="5" ry="8" fill="#0a0a0a" />
      <ellipse cx="546" cy="179" rx="2" ry="4" fill="url(#neonPurple)" opacity="0.7" />

      {/* Small purple accent — energy core peeking from receiver vent */}
      <rect x="106" y="174" width="6" height="22" fill="url(#neonPurple)" opacity="0.85" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PULSE-SMG — B&T MP9 / UMP-style compact SMG: all-black polymer,
// top picatinny rail, vertical mag, side-folding stock
// ═══════════════════════════════════════════════════════════════════
function SmgSVG() {
  return (
    <svg viewBox="0 0 600 380" width="100%" height="100%" style={{ filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Side-folding stock — visible behind receiver */}
      <rect x="20" y="160" width="50" height="8" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1" />
      <rect x="20" y="180" width="50" height="8" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1" />
      <rect x="20" y="200" width="50" height="8" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1" />
      {/* Stock attachment hinge */}
      <circle cx="80" cy="184" r="8" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <circle cx="80" cy="184" r="4" fill="#000" />

      {/* Receiver — boxy polymer body */}
      <rect x="90" y="152" width="200" height="74" rx="6" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />

      {/* Top picatinny rail */}
      <rect x="100" y="142" width="200" height="12" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
      {[105, 115, 125, 135, 145, 155, 165, 175, 185, 195, 205, 215, 225, 235, 245, 255, 265, 275, 285].map((x) => (
        <rect key={x} x={x} y="144" width="2" height="8" fill="#000" />
      ))}

      {/* Iron sights (deployable, on the rail) */}
      <rect x="118" y="130" width="10" height="14" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="270" y="132" width="8" height="12" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />

      {/* Ergonomic pistol grip */}
      <path d="M 196 226 L 198 232 L 208 290 Q 212 296 220 296 L 234 296 Q 244 294 246 286 L 240 226 Z"
        fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />
      {/* Grip stippling */}
      {[244, 254, 264, 274].map((y) => (
        <g key={y}>
          <line x1="204" y1={y} x2="240" y2={y - 4} stroke="#000" strokeWidth="0.6" opacity="0.6" />
        </g>
      ))}

      {/* Trigger guard */}
      <path d="M 240 226 L 240 238 Q 240 256 256 256 L 280 256 Q 290 256 290 246 L 290 226 Z"
        fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <line x1="264" y1="238" x2="264" y2="254" stroke="#000" strokeWidth="2.5" />

      {/* Vertical magazine — extends down from receiver */}
      <rect x="130" y="226" width="40" height="80" rx="3" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />
      {/* Magazine witness lines */}
      <line x1="135" y1="240" x2="165" y2="240" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="135" y1="258" x2="165" y2="258" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="135" y1="276" x2="165" y2="276" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="135" y1="294" x2="165" y2="294" stroke="#1a1a1a" strokeWidth="1" />

      {/* Charging handle — left side */}
      <rect x="270" y="160" width="22" height="8" rx="2" fill="url(#gunmetalLight)" stroke="#000" strokeWidth="1" />

      {/* Front handguard with attachment points */}
      <rect x="290" y="166" width="80" height="48" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />
      {/* M-LOK / KeyMod slots */}
      <rect x="298" y="178" width="14" height="6" rx="1" fill="#000" />
      <rect x="318" y="178" width="14" height="6" rx="1" fill="#000" />
      <rect x="338" y="178" width="14" height="6" rx="1" fill="#000" />
      <rect x="298" y="198" width="14" height="6" rx="1" fill="#000" />
      <rect x="318" y="198" width="14" height="6" rx="1" fill="#000" />
      <rect x="338" y="198" width="14" height="6" rx="1" fill="#000" />

      {/* Barrel */}
      <rect x="370" y="180" width="80" height="14" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      {/* Suppressor / muzzle device */}
      <rect x="450" y="172" width="60" height="30" rx="3" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      {/* Suppressor ridges */}
      {[460, 472, 484, 496].map((x) => (
        <line key={x} x1={x} y1="174" x2={x} y2="200" stroke="#000" strokeWidth="0.8" />
      ))}
      <ellipse cx="506" cy="187" rx="4" ry="11" fill="#000" />
      <ellipse cx="506" cy="187" rx="2" ry="6" fill="url(#neonGreen)" opacity="0.6" />

      {/* Subtle green accent — energy indicator on receiver */}
      <circle cx="108" cy="190" r="4" fill="url(#neonGreen)" />
      <circle cx="108" cy="190" r="2" fill="#fff" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PULSE-12 — Remington 870-style pump shotgun: chrome/silver receiver,
// wood pump grip + stock, magazine tube under barrel
// ═══════════════════════════════════════════════════════════════════
function ShotgunSVG() {
  return (
    <svg viewBox="0 0 600 380" width="100%" height="100%" style={{ filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Wood stock with characteristic curved butt */}
      <path d="M 30 158 Q 28 152 36 148 L 90 142 L 100 200 L 100 230 L 40 234 Q 32 232 30 224 Z"
        fill="url(#woodLight)" stroke="#000" strokeWidth="1.5" />
      {/* Wood grain highlights */}
      <path d="M 38 162 Q 60 158 90 156" fill="none" stroke="#3a1f08" strokeWidth="0.8" opacity="0.5" />
      <path d="M 40 200 Q 60 200 90 200" fill="none" stroke="#3a1f08" strokeWidth="0.8" opacity="0.5" />
      {/* Recoil pad */}
      <path d="M 28 156 Q 26 152 30 148 L 38 146 L 40 232 L 32 232 Q 26 230 28 224 Z"
        fill="#1a0a05" stroke="#000" strokeWidth="1" />

      {/* Chrome receiver — distinctive shotgun look */}
      <rect x="100" y="158" width="120" height="58" fill="url(#chrome)" stroke="#000" strokeWidth="1.5" />
      {/* Top sight rail */}
      <rect x="106" y="152" width="108" height="6" fill="url(#gunmetalDark)" />
      {/* Ejection port (right side) */}
      <rect x="140" y="166" width="50" height="18" rx="2" fill="#000" />
      <rect x="144" y="170" width="42" height="10" fill="url(#gunmetalDark)" />

      {/* Trigger guard */}
      <rect x="158" y="216" width="42" height="22" rx="2" fill="url(#chrome)" stroke="#000" strokeWidth="1.2" />
      <path d="M 168 230 Q 168 244 178 244 L 192 244 Q 198 244 198 238 L 198 230 Z"
        fill="none" stroke="url(#gunmetalDark)" strokeWidth="2.5" />
      <line x1="184" y1="232" x2="184" y2="244" stroke="#000" strokeWidth="2.5" />

      {/* Wood pistol grip / wrist of stock */}
      <path d="M 96 216 L 96 238 Q 96 248 100 248 L 158 248 L 158 216 Z"
        fill="url(#woodLight)" stroke="#000" strokeWidth="1.2" />

      {/* Wooden pump grip — ribbed/checkered, slides on the action bars */}
      <rect x="240" y="186" width="100" height="42" rx="3" fill="url(#woodLight)" stroke="#000" strokeWidth="1.5" />
      {/* Pump ribs (distinctive vertical lines) */}
      {[248, 258, 268, 278, 288, 298, 308, 318, 328].map((x) => (
        <rect key={x} x={x} y="190" width="2" height="34" fill="#2a1408" opacity="0.9" />
      ))}

      {/* Magazine tube under barrel */}
      <rect x="220" y="226" width="240" height="14" fill="url(#chrome)" stroke="#000" strokeWidth="1" />
      <rect x="220" y="226" width="240" height="4" fill="url(#gunmetalLight)" />
      {/* Mag cap at front */}
      <ellipse cx="460" cy="233" rx="4" ry="9" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />

      {/* Barrel — wide 12-gauge tube */}
      <rect x="220" y="174" width="240" height="14" fill="url(#chrome)" stroke="#000" strokeWidth="1.2" />
      <rect x="220" y="174" width="240" height="3" fill="url(#gunmetalLight)" opacity="0.8" />
      {/* Front sight bead */}
      <circle cx="450" cy="170" r="3" fill="url(#neonPink)" />
      <circle cx="450" cy="170" r="1.5" fill="#fff" />

      {/* Wide muzzle */}
      <rect x="460" y="170" width="14" height="22" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
      <ellipse cx="467" cy="181" rx="5" ry="9" fill="#000" />
      <ellipse cx="467" cy="181" rx="2.5" ry="5" fill="url(#neonPink)" opacity="0.5" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Q-SNIPER — AWP / L96A1: OD-green chassis with thumbhole stock,
// massive scope, long thin barrel with muzzle brake
// ═══════════════════════════════════════════════════════════════════
function SniperSVG() {
  return (
    <svg viewBox="0 0 600 380" width="100%" height="100%" style={{ filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Skeletonized OD-green stock with thumbhole */}
      <path d="M 20 168 Q 16 162 22 156 L 80 150 L 88 165 L 88 220 L 80 232 L 22 232 Q 16 226 20 220 Z"
        fill="url(#odGreen)" stroke="#000" strokeWidth="1.5" />
      {/* Thumbhole (cutout) */}
      <ellipse cx="65" cy="192" rx="14" ry="12" fill="#0a0a08" stroke="#000" strokeWidth="1" />
      {/* Ventilation holes in stock */}
      <ellipse cx="42" cy="172" rx="5" ry="4" fill="#1a1a14" />
      <ellipse cx="42" cy="186" rx="5" ry="4" fill="#1a1a14" />
      <ellipse cx="42" cy="200" rx="5" ry="4" fill="#1a1a14" />
      <ellipse cx="42" cy="214" rx="5" ry="4" fill="#1a1a14" />
      {/* Number stencil "048" */}
      <text x="30" y="156" fontFamily="JetBrains Mono, monospace" fontSize="9" fontWeight="800" fill="#d8d4c0" opacity="0.85" letterSpacing="1">048</text>
      {/* Cheek piece */}
      <rect x="76" y="142" width="50" height="14" rx="2" fill="url(#odGreen)" stroke="#000" strokeWidth="1.2" />

      {/* Receiver / action — OD green */}
      <rect x="88" y="158" width="140" height="50" fill="url(#odGreen)" stroke="#000" strokeWidth="1.5" />
      {/* Bolt action */}
      <rect x="160" y="148" width="50" height="14" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <circle cx="206" cy="155" r="9" fill="url(#gunmetalLight)" stroke="#000" strokeWidth="1" />

      {/* Trigger guard */}
      <path d="M 128 208 L 128 234 Q 128 248 144 248 L 162 248 Q 170 248 170 240 L 170 208 Z"
        fill="url(#odGreen)" stroke="#000" strokeWidth="1.2" />
      <line x1="152" y1="222" x2="152" y2="246" stroke="#000" strokeWidth="2.5" />

      {/* Detachable box magazine */}
      <rect x="100" y="208" width="30" height="42" rx="2" fill="url(#odGreen)" stroke="#000" strokeWidth="1.2" />
      <line x1="105" y1="220" x2="125" y2="220" stroke="#1a1f10" strokeWidth="1" opacity="0.8" />
      <line x1="105" y1="232" x2="125" y2="232" stroke="#1a1f10" strokeWidth="1" opacity="0.8" />

      {/* Long thin barrel */}
      <rect x="228" y="178" width="280" height="10" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      {/* Tapered profile darker section */}
      <rect x="228" y="184" width="280" height="3" fill="url(#gunmetalDark)" />
      {/* Muzzle brake */}
      <rect x="508" y="172" width="30" height="22" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <ellipse cx="514" cy="183" rx="2" ry="6" fill="#000" />
      <ellipse cx="522" cy="183" rx="2.5" ry="7" fill="#000" />
      <ellipse cx="532" cy="183" rx="3.5" ry="8" fill="#000" />
      <ellipse cx="532" cy="183" rx="2" ry="4" fill="url(#neonLilac)" opacity="0.7" />

      {/* HUGE SCOPE — the defining sniper feature */}
      {/* Scope tube */}
      <rect x="106" y="98" width="140" height="22" rx="4" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      {/* Scope rings (mounts) */}
      <rect x="120" y="118" width="18" height="14" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <rect x="212" y="118" width="18" height="14" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      {/* Adjustment turrets */}
      <rect x="158" y="80" width="22" height="18" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <circle cx="169" cy="84" r="6" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="185" y="92" width="14" height="8" rx="1" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />

      {/* Front objective bell */}
      <ellipse cx="252" cy="109" rx="18" ry="18" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <ellipse cx="252" cy="109" rx="13" ry="13" fill="#0a0a14" />
      <ellipse cx="256" cy="105" rx="5" ry="5" fill="url(#neonLilac)" opacity="0.9" />
      <ellipse cx="258" cy="103" rx="2" ry="2" fill="#fff" />

      {/* Rear eyepiece bell */}
      <ellipse cx="100" cy="109" rx="12" ry="13" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <ellipse cx="100" cy="109" rx="7" ry="8" fill="#000" />

      {/* Bipod legs under handguard */}
      <line x1="280" y1="190" x2="260" y2="270" stroke="url(#gunmetalDark)" strokeWidth="4" strokeLinecap="round" />
      <line x1="300" y1="190" x2="320" y2="270" stroke="url(#gunmetalDark)" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="260" cy="272" rx="6" ry="2" fill="#000" />
      <ellipse cx="320" cy="272" rx="6" ry="2" fill="#000" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RAILGUN — L85A2 / SA80 bullpup: tan/khaki furniture, carrying handle
// with iron sights, mag BEHIND grip (bullpup), short OAL
// ═══════════════════════════════════════════════════════════════════
function RailgunSVG() {
  return (
    <svg viewBox="0 0 600 380" width="100%" height="100%" style={{ filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Stock cap / butt plate */}
      <path d="M 25 168 Q 22 162 28 158 L 56 156 L 56 232 L 28 232 Q 22 230 25 224 Z"
        fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      {/* Cheek pad (tan) */}
      <rect x="56" y="156" width="60" height="18" fill="url(#khaki)" stroke="#000" strokeWidth="1.2" />

      {/* Receiver — runs full length (bullpup = receiver behind grip) */}
      <rect x="56" y="174" width="280" height="58" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      {/* Tan upper handguard panel covering rear half of receiver */}
      <rect x="60" y="178" width="160" height="50" fill="url(#khaki)" stroke="#000" strokeWidth="1.2" />
      {/* "017" stencil on the tan panel */}
      <text x="180" y="218" fontFamily="JetBrains Mono, monospace" fontSize="11" fontWeight="800" fill="#3a2818" opacity="0.9" letterSpacing="1.5">017</text>

      {/* Magazine — BEHIND the grip (bullpup signature) */}
      <rect x="80" y="232" width="44" height="64" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <line x1="86" y1="248" x2="118" y2="248" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="86" y1="266" x2="118" y2="266" stroke="#1a1a1a" strokeWidth="1" />
      <line x1="86" y1="284" x2="118" y2="284" stroke="#1a1a1a" strokeWidth="1" />

      {/* Ejection port on the side */}
      <rect x="140" y="186" width="40" height="14" rx="1" fill="#000" />
      <rect x="143" y="189" width="34" height="8" fill="url(#gunmetalLight)" opacity="0.4" />

      {/* Pistol grip (tan) — positioned in front of magazine */}
      <path d="M 200 232 L 204 240 L 214 286 Q 218 292 224 292 L 238 292 Q 248 290 250 282 L 246 232 Z"
        fill="url(#khaki)" stroke="#000" strokeWidth="1.5" />
      {/* Grip ridges */}
      {[244, 256, 268].map((y) => (
        <line key={y} x1="208" y1={y} x2="246" y2={y - 4} stroke="#5a4220" strokeWidth="0.6" opacity="0.7" />
      ))}

      {/* Trigger guard — winter trigger style (loops down further) */}
      <path d="M 246 232 L 250 248 Q 250 262 264 262 L 286 262 Q 296 262 296 252 L 296 232 Z"
        fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <line x1="278" y1="244" x2="278" y2="260" stroke="#000" strokeWidth="2.5" />

      {/* Carrying handle with integrated optic (SUSAT-style or rail) */}
      <rect x="120" y="140" width="120" height="20" rx="3" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      {/* Optic housing on the carry handle */}
      <rect x="135" y="120" width="80" height="22" rx="3" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      <ellipse cx="148" cy="131" rx="6" ry="8" fill="#000" stroke="url(#gunmetal)" strokeWidth="1" />
      <ellipse cx="148" cy="131" rx="3" ry="4" fill="url(#neonCyan)" opacity="0.8" />
      <ellipse cx="202" cy="131" rx="9" ry="11" fill="#000" stroke="url(#gunmetal)" strokeWidth="1" />
      <ellipse cx="202" cy="131" rx="5" ry="6" fill="url(#neonCyan)" opacity="0.6" />

      {/* Front handguard with vent slots */}
      <rect x="336" y="174" width="120" height="58" fill="url(#khaki)" stroke="#000" strokeWidth="1.5" />
      {/* Cooling vents */}
      {[180, 192, 204, 216].map((y) => (
        <rect key={y} x="346" y={y} width="40" height="3" fill="#3a2818" opacity="0.85" />
      ))}
      {/* M-LOK slots on the side */}
      {[180, 196, 212].map((y) => (
        <rect key={y} x="400" y={y} width="44" height="4" rx="1" fill="#1a1208" />
      ))}

      {/* Front sight tower */}
      <rect x="456" y="148" width="14" height="62" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <rect x="458" y="140" width="10" height="14" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      {/* Sight post */}
      <rect x="462" y="136" width="2" height="6" fill="#000" />

      {/* Short barrel + muzzle */}
      <rect x="470" y="190" width="50" height="14" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      <rect x="520" y="184" width="22" height="26" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <ellipse cx="528" cy="197" rx="5" ry="9" fill="#000" />
      <ellipse cx="528" cy="197" rx="2.5" ry="5" fill="url(#neonCyan)" opacity="0.7" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// G-LAUNCH — standalone grenade launcher: chunky frame, large bore,
// pump-style fore-end, simple iron sights
// ═══════════════════════════════════════════════════════════════════
function LauncherSVG() {
  return (
    <svg viewBox="0 0 600 380" width="100%" height="100%" style={{ filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Stock */}
      <path d="M 25 156 Q 22 150 28 146 L 90 144 L 100 226 L 32 232 Q 22 230 25 222 Z"
        fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />

      {/* Receiver — chunky body */}
      <rect x="98" y="146" width="160" height="86" rx="4" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.5" />
      <rect x="104" y="140" width="148" height="8" fill="url(#gunmetalDark)" />

      {/* Ammo counter LCD */}
      <rect x="112" y="156" width="44" height="22" rx="2" fill="#0a0a14" stroke="url(#neonBlue)" strokeWidth="1.5" />
      <text x="134" y="172" textAnchor="middle" fontSize="14" fontWeight="800"
        fontFamily="JetBrains Mono, monospace" fill="url(#neonBlue)" letterSpacing="2">06</text>

      {/* Side rails / cooling */}
      {[186, 198, 210].map((y) => (
        <rect key={y} x="170" y={y} width="60" height="4" fill="#000" />
      ))}

      {/* Pistol grip */}
      <path d="M 192 232 L 196 240 L 206 296 Q 210 302 218 302 L 230 302 Q 240 300 242 292 L 238 232 Z"
        fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />

      {/* Trigger guard */}
      <path d="M 238 232 L 242 248 Q 242 264 258 264 L 280 264 Q 290 264 290 254 L 290 232 Z"
        fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      <line x1="270" y1="246" x2="270" y2="262" stroke="#000" strokeWidth="2.5" />

      {/* Forward grip / pump */}
      <rect x="260" y="180" width="100" height="60" rx="3" fill="url(#polymerBlack)" stroke="#000" strokeWidth="1.5" />
      {[270, 286, 302, 318, 334, 350].map((x) => (
        <rect key={x} x={x} y="190" width="3" height="42" fill="#000" />
      ))}

      {/* HEAVY BARREL with MASSIVE BORE — defining 40mm look */}
      <rect x="358" y="166" width="160" height="88" rx="8" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      {/* Front sight on top */}
      <rect x="430" y="156" width="6" height="12" fill="url(#gunmetal)" />

      {/* 40mm bore — concentric circles with depth */}
      <ellipse cx="510" cy="210" rx="28" ry="38" fill="url(#gunmetal)" stroke="#000" strokeWidth="2" />
      <ellipse cx="510" cy="210" rx="22" ry="32" fill="#000" />
      <ellipse cx="510" cy="210" rx="16" ry="24" fill="#0a0a14" />
      <ellipse cx="510" cy="210" rx="9" ry="14" fill="url(#neonBlue)" opacity="0.5" />
      <ellipse cx="510" cy="210" rx="4" ry="7" fill="url(#neonBlue)" />
      <ellipse cx="508" cy="206" rx="2" ry="3" fill="#fff" opacity="0.7" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SIDEKICK — Makarov PM: small frame, wooden grip panels, short slide
// ═══════════════════════════════════════════════════════════════════
function PistolSVG() {
  return (
    <svg viewBox="0 0 600 380" width="100%" height="100%" style={{ filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.7))" }}>
      <SharedDefs />

      {/* Slide — top of pistol, gunmetal */}
      <rect x="220" y="170" width="160" height="42" rx="3" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.5" />
      {/* Slide top */}
      <rect x="226" y="166" width="148" height="6" fill="url(#gunmetal)" />
      {/* Front sight blade */}
      <rect x="370" y="158" width="6" height="12" fill="url(#gunmetal)" />
      {/* Rear sight notch */}
      <rect x="232" y="160" width="14" height="10" fill="url(#gunmetal)" />
      <rect x="236" y="162" width="6" height="6" fill="#000" />

      {/* Slide serrations (rear, classic Makarov style) */}
      {[230, 238, 246, 254, 262].map((x) => (
        <line key={x} x1={x} y1="174" x2={x} y2="208" stroke="#000" strokeWidth="1" />
      ))}

      {/* Ejection port */}
      <rect x="290" y="172" width="32" height="14" rx="1" fill="#000" />
      <rect x="294" y="175" width="24" height="6" fill="url(#gunmetalLight)" opacity="0.4" />

      {/* Short barrel poking out */}
      <rect x="380" y="178" width="14" height="14" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      <ellipse cx="390" cy="185" rx="3" ry="5" fill="#000" />
      <ellipse cx="390" cy="185" rx="1.5" ry="2.5" fill="url(#neonAmber)" opacity="0.7" />

      {/* Frame — extends down to grip */}
      <path d="M 244 212 L 354 212 L 360 232 L 360 246 L 348 246 L 348 240 L 256 240 L 252 246 L 244 246 Z"
        fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />

      {/* Trigger guard */}
      <path d="M 264 240 L 264 254 Q 264 270 280 270 L 296 270 Q 304 270 304 262 L 304 240 Z"
        fill="none" stroke="url(#gunmetalDark)" strokeWidth="2.5" />
      <line x1="286" y1="252" x2="286" y2="268" stroke="#000" strokeWidth="2.5" />

      {/* Wood grip panels — distinctive Makarov look */}
      <path d="M 252 240 L 256 246 L 268 320 Q 272 326 280 326 L 320 326 Q 330 324 332 316 L 324 246 L 320 240 Z"
        fill="url(#woodWarm)" stroke="#000" strokeWidth="1.5" />
      {/* Wood grain accents */}
      <path d="M 264 270 Q 290 274 322 270" fill="none" stroke="#3a1808" strokeWidth="0.7" opacity="0.6" />
      <path d="M 268 296 Q 292 300 322 296" fill="none" stroke="#3a1808" strokeWidth="0.7" opacity="0.6" />
      <path d="M 270 314 Q 294 318 320 314" fill="none" stroke="#3a1808" strokeWidth="0.7" opacity="0.6" />
      {/* Grip medallion / decoration */}
      <circle cx="296" cy="284" r="6" fill="url(#gunmetalDark)" stroke="url(#neonAmber)" strokeWidth="1" />
      <text x="296" y="288" textAnchor="middle" fontSize="7" fontWeight="800"
        fontFamily="JetBrains Mono, monospace" fill="url(#neonAmber)">N</text>

      {/* Mag base */}
      <rect x="266" y="324" width="64" height="8" rx="1" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />

      {/* Hammer at the rear (DA/SA pistol) */}
      <path d="M 218 174 L 220 158 L 232 158 L 232 174 Z" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
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

// First-person hand wrapping the grip.
function FirstPersonHand({ reloading }) {
  if (reloading) return null;
  return (
    <div style={{
      position: "absolute",
      right: 30, bottom: -10,
      width: 220, height: 260,
      pointerEvents: "none",
      filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.7))",
    }}>
      <svg viewBox="0 0 220 260" width="100%" height="100%">
        <defs>
          <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7d5c42" />
            <stop offset="0.5" stopColor="#5a4030" />
            <stop offset="1" stopColor="#2e1f18" />
          </linearGradient>
          <linearGradient id="glove" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a322a" />
            <stop offset="1" stopColor="#15110d" />
          </linearGradient>
        </defs>
        {/* Forearm */}
        <polygon points="130,260 220,260 220,150 150,128" fill="url(#glove)" stroke="#000" strokeWidth="1.5" />
        {/* Glove cuff with glow */}
        <polygon points="130,170 220,150 220,180 138,196" fill="#1a1410" stroke="#a78bfa" strokeWidth="1.5" />
        <polygon points="130,180 220,160 220,166 132,186" fill="#a78bfa" opacity="0.85" />

        {/* Hand wrapping grip */}
        <ellipse cx="115" cy="135" rx="42" ry="32" fill="url(#skin)" stroke="#000" strokeWidth="1.2" />
        {/* Thumb */}
        <path d="M 80 118 Q 64 122 62 142 Q 65 158 84 156" fill="url(#skin)" stroke="#000" strokeWidth="1.2" />
        {/* Knuckles */}
        {[
          [92, 108],
          [104, 102],
          [116, 102],
          [126, 106],
        ].map(([x, y], i) => (
          <ellipse key={i} cx={x} cy={y} rx="9" ry="11" fill="url(#skin)" stroke="#000" strokeWidth="1" />
        ))}
        <ellipse cx="66" cy="134" rx="3" ry="5" fill="#3a2818" />
      </svg>
    </div>
  );
}

function MuzzleFlash({ flashColor }) {
  return (
    <div style={{
      position: "absolute",
      left: "92%", top: "48%",
      width: 80, height: 80,
      borderRadius: "50%",
      background: `radial-gradient(circle, ${flashColor} 0%, ${flashColor}aa 30%, ${flashColor}44 55%, transparent 75%)`,
      transform: "translate(-50%, -50%) scale(0)",
      opacity: 0,
      animation: "wo-muzzle 130ms ease-out forwards",
      filter: `drop-shadow(0 0 28px ${flashColor})`,
      pointerEvents: "none",
      mixBlendMode: "screen",
    }} />
  );
}
