// WeaponOverlay — DOM-only stylized gun illustrations.
//
// Each weapon is a custom SVG drawn to look like the actual firearm
// type it represents (assault rifle, SMG, pump shotgun, sniper, etc).
// Uses real gun proportions: grip behind the magazine, body/receiver
// horizontal, barrel forward, sights on top, stock to the rear.
// Realistic shading via multi-stop linear gradients on each major
// part (body, barrel, mag, grip) so the weapon reads as a 3D object
// not a flat icon.
//
// Animations:
//   • Subtle vertical bob (idle sway)
//   • Recoil kick on fire (downward shift + slight rotation)
//   • Muzzle flash at barrel tip (radial gradient flash)
//   • Reload spin (gun rotates during reload)

import React, { useEffect, useRef, useState } from "react";

export default function WeaponOverlay({ hud }) {
  const weaponId = hud?.weaponId || "plasma";
  const reloading = hud?.reloading;
  const ammo = hud?.ammo ?? 24;

  // Restart the recoil animation on each shot by bumping a key.
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
      left: 0, right: 0,
      bottom: 0,
      height: 220,
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-end",
      pointerEvents: "none",
      zIndex: 5,
    }}>
      <div style={{
        position: "relative",
        width: 380, height: 220,
        animation: reloading ? "wo-reload 1s linear infinite" : "wo-bob 3.4s ease-in-out infinite",
      }}>
        <div key={recoilKey} style={{
          position: "absolute", inset: 0,
          animation: "wo-recoil 220ms cubic-bezier(.2,.7,.3,1)",
        }}>
          <WeaponSVG />
        </div>
        <MuzzleFlash key={muzzleKey} flashColor={MUZZLE_COLORS[weaponId] || "#fff7d6"} />
      </div>
      <style>{`
        @keyframes wo-bob {
          0%, 100% { transform: translateY(0) rotate(-0.4deg); }
          50%      { transform: translateY(-5px) rotate(0.4deg); }
        }
        @keyframes wo-recoil {
          0%   { transform: translateY(0)    rotate(0); }
          18%  { transform: translateY(10px) rotate(-2.5deg); }
          60%  { transform: translateY(-3px) rotate(1deg); }
          100% { transform: translateY(0)    rotate(0); }
        }
        @keyframes wo-reload {
          0%   { transform: rotate(0)    translateY(0); }
          50%  { transform: rotate(180deg) translateY(20px); }
          100% { transform: rotate(360deg) translateY(0); }
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
  plasma: "#d8c8ff",
  smg: "#a5e8c8",
  shotgun: "#ffb4d8",
  sniper: "#e8c8ff",
  railgun: "#a5e8ff",
  gravity: "#b8d4ff",
  pistol: "#ffe8a5",
};

// Shared gradient defs — used by every gun so we don't repeat them.
function SharedDefs() {
  return (
    <defs>
      {/* Gunmetal — top to bottom, with a bright top highlight + dark bottom shadow.
          Standard gunmetal black-grey palette so every gun reads as metallic. */}
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
      {/* Polymer grip texture — slightly more brown for contrast */}
      <linearGradient id="polymer" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3a322a" />
        <stop offset="1" stopColor="#15110d" />
      </linearGradient>
      {/* Barrel — slightly bluer steel */}
      <linearGradient id="barrelSteel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6a6e7a" />
        <stop offset="0.5" stopColor="#3a3e48" />
        <stop offset="1" stopColor="#1a1e24" />
      </linearGradient>
      {/* Neon accent gradients per weapon — sets the energy-weapon vibe */}
      <linearGradient id="accentPurple" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e0d4ff" />
        <stop offset="0.5" stopColor="#a78bfa" />
        <stop offset="1" stopColor="#6d28d9" />
      </linearGradient>
      <linearGradient id="accentGreen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#a5e8c8" />
        <stop offset="0.5" stopColor="#34d399" />
        <stop offset="1" stopColor="#047857" />
      </linearGradient>
      <linearGradient id="accentPink" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffb4d8" />
        <stop offset="0.5" stopColor="#f472b6" />
        <stop offset="1" stopColor="#9d174d" />
      </linearGradient>
      <linearGradient id="accentLilac" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e8c8ff" />
        <stop offset="0.5" stopColor="#c084fc" />
        <stop offset="1" stopColor="#7e22ce" />
      </linearGradient>
      <linearGradient id="accentCyan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#a5e8ff" />
        <stop offset="0.5" stopColor="#22d3ee" />
        <stop offset="1" stopColor="#0e7490" />
      </linearGradient>
      <linearGradient id="accentBlue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#b8d4ff" />
        <stop offset="0.5" stopColor="#60a5fa" />
        <stop offset="1" stopColor="#1d4ed8" />
      </linearGradient>
      <linearGradient id="accentAmber" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffe8a5" />
        <stop offset="0.5" stopColor="#fbbf24" />
        <stop offset="1" stopColor="#b45309" />
      </linearGradient>
    </defs>
  );
}

// Each weapon is its own function so the silhouette can be uniquely
// tuned. Coordinates use a 380×220 viewBox.

// ═══════════════════════════════════════════════════════════════════
// PLASMA RIFLE — assault rifle silhouette: receiver + handguard +
// barrel + mag + pistol grip + scope rail. Purple energy accent.
// ═══════════════════════════════════════════════════════════════════
function PlasmaSVG() {
  return (
    <svg viewBox="0 0 380 220" width="100%" height="100%" style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.6))" }}>
      <SharedDefs />

      {/* Stock — extends behind grip */}
      <polygon points="20,118 70,118 75,150 25,150" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <rect x="25" y="124" width="45" height="3" fill="url(#accentPurple)" opacity="0.6" />

      {/* Receiver — main body */}
      <rect x="70" y="100" width="160" height="44" rx="3" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      {/* Receiver top accent rail */}
      <rect x="78" y="96" width="148" height="6" fill="url(#gunmetalDark)" />
      <rect x="78" y="98" width="148" height="2" fill="url(#accentPurple)" />

      {/* Pistol grip — angled */}
      <polygon points="135,140 160,140 168,196 145,196" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <rect x="140" y="155" width="22" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="140" y="165" width="22" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="140" y="175" width="22" height="3" fill="#2a2422" opacity="0.8" />

      {/* Trigger guard */}
      <path d="M 168 144 Q 168 162 182 162 L 195 162 Q 200 162 200 156 L 200 144 Z"
        fill="none" stroke="url(#gunmetalLight)" strokeWidth="2.5" />
      {/* Trigger */}
      <line x1="185" y1="147" x2="185" y2="158" stroke="#000" strokeWidth="2.5" />

      {/* Magazine — curved STANAG-style */}
      <path d="M 90 144 L 90 200 Q 90 208 95 208 L 122 208 Q 128 208 128 200 L 122 144 Z"
        fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <line x1="95" y1="155" x2="120" y2="155" stroke="#2a2422" strokeWidth="1" />
      <line x1="95" y1="170" x2="121" y2="170" stroke="#2a2422" strokeWidth="1" />
      <line x1="95" y1="185" x2="123" y2="185" stroke="#2a2422" strokeWidth="1" />

      {/* Charging handle / bolt area */}
      <rect x="200" y="106" width="22" height="6" rx="2" fill="url(#accentPurple)" />
      <circle cx="211" cy="109" r="2" fill="#fff" opacity="0.7" />

      {/* Handguard — runs from receiver to barrel */}
      <rect x="230" y="106" width="80" height="32" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
      {/* Handguard vent slots */}
      <rect x="238" y="113" width="40" height="3" fill="#000" />
      <rect x="238" y="120" width="40" height="3" fill="#000" />
      <rect x="238" y="127" width="40" height="3" fill="#000" />
      <rect x="284" y="113" width="20" height="17" fill="url(#accentPurple)" opacity="0.85" />
      <rect x="287" y="115" width="14" height="2" fill="#fff" opacity="0.6" />

      {/* Barrel — extends forward */}
      <rect x="310" y="115" width="50" height="14" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      {/* Muzzle device / flash hider */}
      <rect x="358" y="111" width="14" height="22" rx="2" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="361" y="115" width="2" height="14" fill="#000" />
      <rect x="365" y="115" width="2" height="14" fill="#000" />
      <rect x="369" y="115" width="2" height="14" fill="#000" />
      {/* Muzzle hole */}
      <ellipse cx="365" cy="122" rx="4" ry="6" fill="#000" />
      <ellipse cx="365" cy="122" rx="2" ry="3" fill="url(#accentPurple)" opacity="0.8" />

      {/* Sight rail on top */}
      <rect x="120" y="90" width="80" height="8" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="0.5" />
      {[124, 132, 140, 148, 156, 164, 172, 180, 188, 196].map((x) => (
        <rect key={x} x={x} y="92" width="2" height="4" fill="#000" />
      ))}

      {/* Holographic sight */}
      <rect x="148" y="78" width="32" height="14" rx="2" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="153" y="82" width="22" height="6" fill="url(#accentPurple)" opacity="0.9" />
      <circle cx="164" cy="85" r="2" fill="#fff" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PULSE-SMG — compact SMG silhouette: short barrel, magazine forward
// of trigger, folding stock. Green energy accent.
// ═══════════════════════════════════════════════════════════════════
function SmgSVG() {
  return (
    <svg viewBox="0 0 380 220" width="100%" height="100%" style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.6))" }}>
      <SharedDefs />

      {/* Folding stock — compact */}
      <rect x="40" y="108" width="40" height="6" fill="url(#gunmetal)" stroke="#000" strokeWidth="0.8" />
      <rect x="40" y="118" width="40" height="6" fill="url(#gunmetal)" stroke="#000" strokeWidth="0.8" />
      <rect x="40" y="128" width="40" height="6" fill="url(#gunmetal)" stroke="#000" strokeWidth="0.8" />

      {/* Receiver — shorter than rifle */}
      <rect x="80" y="100" width="120" height="42" rx="3" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <rect x="88" y="96" width="108" height="6" fill="url(#gunmetalDark)" />
      <rect x="88" y="98" width="108" height="2" fill="url(#accentGreen)" />

      {/* Pistol grip */}
      <polygon points="125,138 152,138 158,194 138,194" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <rect x="132" y="152" width="20" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="132" y="162" width="20" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="132" y="172" width="20" height="3" fill="#2a2422" opacity="0.8" />

      {/* Trigger guard */}
      <path d="M 158 142 Q 158 158 170 158 L 182 158 Q 188 158 188 152 L 188 142 Z"
        fill="none" stroke="url(#gunmetalLight)" strokeWidth="2.5" />
      <line x1="175" y1="145" x2="175" y2="156" stroke="#000" strokeWidth="2.5" />

      {/* Magazine — extended, vertical */}
      <path d="M 100 142 L 100 200 Q 100 208 105 208 L 132 208 Q 138 208 138 200 L 132 142 Z"
        fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <line x1="105" y1="155" x2="132" y2="155" stroke="#2a2422" strokeWidth="1" />
      <line x1="105" y1="170" x2="133" y2="170" stroke="#2a2422" strokeWidth="1" />
      <line x1="105" y1="185" x2="134" y2="185" stroke="#2a2422" strokeWidth="1" />

      {/* Charging handle */}
      <rect x="178" y="106" width="18" height="5" rx="2" fill="url(#accentGreen)" />

      {/* Front handguard */}
      <rect x="200" y="108" width="56" height="28" rx="2" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
      <rect x="208" y="114" width="30" height="3" fill="#000" />
      <rect x="208" y="121" width="30" height="3" fill="#000" />
      <rect x="208" y="128" width="30" height="3" fill="#000" />
      <rect x="240" y="114" width="14" height="18" fill="url(#accentGreen)" opacity="0.85" />

      {/* Short barrel */}
      <rect x="256" y="116" width="42" height="12" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      {/* Flash suppressor */}
      <rect x="296" y="112" width="14" height="20" rx="2" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <ellipse cx="303" cy="122" rx="4" ry="6" fill="#000" />
      <ellipse cx="303" cy="122" rx="2" ry="3" fill="url(#accentGreen)" opacity="0.8" />

      {/* Iron sights */}
      <rect x="100" y="92" width="6" height="8" fill="url(#gunmetal)" />
      <rect x="188" y="92" width="6" height="8" fill="url(#gunmetal)" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PULSE-12 SHOTGUN — tactical pump-action: shorter receiver, large
// pump grip, wide barrel. Pink accent.
// ═══════════════════════════════════════════════════════════════════
function ShotgunSVG() {
  return (
    <svg viewBox="0 0 380 220" width="100%" height="100%" style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.6))" }}>
      <SharedDefs />

      {/* Stock */}
      <polygon points="15,108 80,108 88,158 22,158" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <rect x="25" y="118" width="55" height="4" fill="#2a1a22" opacity="0.85" />
      <rect x="25" y="130" width="55" height="4" fill="#2a1a22" opacity="0.85" />

      {/* Receiver — thicker than rifle */}
      <rect x="80" y="98" width="100" height="50" rx="3" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <rect x="86" y="94" width="88" height="6" fill="url(#gunmetalDark)" />
      <rect x="86" y="96" width="88" height="2" fill="url(#accentPink)" />

      {/* Trigger group */}
      <rect x="120" y="148" width="40" height="14" rx="2" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <path d="M 130 162 Q 130 175 142 175 L 152 175 Q 158 175 158 168 L 158 162 Z"
        fill="none" stroke="url(#gunmetalLight)" strokeWidth="2.5" />
      <line x1="146" y1="165" x2="146" y2="174" stroke="#000" strokeWidth="2.5" />

      {/* Pump grip — large, ribbed */}
      <rect x="190" y="124" width="80" height="28" rx="4" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      {/* Pump ribs */}
      {[197, 207, 217, 227, 237, 247, 257].map((x) => (
        <rect key={x} x={x} y="128" width="3" height="20" fill="#2a1a22" />
      ))}

      {/* Barrel — wide tube (12-gauge) */}
      <rect x="270" y="116" width="80" height="20" rx="2" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      {/* Front sight bead */}
      <circle cx="345" cy="113" r="3" fill="url(#accentPink)" />
      <circle cx="345" cy="113" r="1.5" fill="#fff" />
      {/* Wide muzzle */}
      <rect x="346" y="112" width="14" height="28" rx="3" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <ellipse cx="353" cy="126" rx="6" ry="10" fill="#000" />
      <ellipse cx="353" cy="126" rx="3" ry="5" fill="url(#accentPink)" opacity="0.7" />

      {/* Magazine tube under barrel */}
      <rect x="200" y="148" width="120" height="10" rx="3" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      <circle cx="316" cy="153" r="3" fill="url(#accentPink)" />

      {/* Ejection port */}
      <rect x="115" y="108" width="34" height="14" rx="1" fill="#000" />
      <rect x="118" y="111" width="28" height="3" fill="url(#accentPink)" opacity="0.6" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Q-SNIPER — long bolt-action with massive scope. Lilac accent.
// ═══════════════════════════════════════════════════════════════════
function SniperSVG() {
  return (
    <svg viewBox="0 0 380 220" width="100%" height="100%" style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.6))" }}>
      <SharedDefs />

      {/* Stock — long sniper stock with cheek riser */}
      <polygon points="10,118 60,118 65,134 65,158 12,158" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <rect x="20" y="124" width="40" height="4" fill="url(#accentLilac)" opacity="0.5" />
      {/* Cheek riser */}
      <rect x="58" y="108" width="40" height="14" rx="2" fill="url(#polymer)" stroke="#000" strokeWidth="1" />

      {/* Receiver */}
      <rect x="65" y="122" width="100" height="32" rx="3" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <rect x="72" y="118" width="86" height="6" fill="url(#gunmetalDark)" />

      {/* Bolt handle */}
      <rect x="148" y="106" width="14" height="20" rx="2" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <circle cx="155" cy="106" r="6" fill="url(#gunmetalLight)" stroke="#000" strokeWidth="1" />

      {/* Pistol grip */}
      <polygon points="98,150 124,150 130,200 105,200" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <rect x="105" y="162" width="20" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="105" y="172" width="20" height="3" fill="#2a2422" opacity="0.8" />

      {/* Trigger guard */}
      <path d="M 130 154 Q 130 170 144 170 L 156 170 Q 162 170 162 164 L 162 154 Z"
        fill="none" stroke="url(#gunmetalLight)" strokeWidth="2.5" />
      <line x1="148" y1="157" x2="148" y2="168" stroke="#000" strokeWidth="2.5" />

      {/* Detachable magazine */}
      <rect x="78" y="154" width="22" height="32" rx="2" fill="url(#polymer)" stroke="#000" strokeWidth="1" />

      {/* Long barrel */}
      <rect x="165" y="130" width="180" height="14" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      {/* Barrel taper */}
      <polygon points="335,130 345,128 345,146 335,144" fill="url(#barrelSteel)" stroke="#000" strokeWidth="1" />
      {/* Muzzle brake */}
      <rect x="345" y="126" width="18" height="22" rx="2" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="349" y="130" width="2" height="14" fill="#000" />
      <rect x="353" y="130" width="2" height="14" fill="#000" />
      <rect x="357" y="130" width="2" height="14" fill="#000" />
      <ellipse cx="352" cy="137" rx="4" ry="6" fill="#000" />
      <ellipse cx="352" cy="137" rx="2" ry="3" fill="url(#accentLilac)" opacity="0.7" />

      {/* MASSIVE SCOPE — defining sniper feature */}
      <rect x="80" y="74" width="100" height="20" rx="4" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      {/* Scope front bell */}
      <ellipse cx="180" cy="84" rx="14" ry="14" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <ellipse cx="180" cy="84" rx="9" ry="9" fill="#0a0a14" />
      <ellipse cx="183" cy="81" rx="3" ry="3" fill="url(#accentLilac)" />
      {/* Scope rear bell */}
      <ellipse cx="80" cy="84" rx="10" ry="11" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      {/* Turrets on top of scope */}
      <rect x="120" y="64" width="14" height="12" rx="2" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <circle cx="127" cy="65" r="3" fill="url(#accentLilac)" />
      <rect x="140" y="68" width="10" height="8" rx="1" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />

      {/* Bipod attached to barrel */}
      <line x1="200" y1="144" x2="180" y2="200" stroke="url(#gunmetal)" strokeWidth="3" />
      <line x1="220" y1="144" x2="240" y2="200" stroke="url(#gunmetal)" strokeWidth="3" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RAILGUN — sci-fi heavy weapon with energy coils along the barrel.
// Cyan accent.
// ═══════════════════════════════════════════════════════════════════
function RailgunSVG() {
  return (
    <svg viewBox="0 0 380 220" width="100%" height="100%" style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.6))" }}>
      <SharedDefs />

      {/* Cyber stock */}
      <polygon points="10,108 70,108 76,164 16,164" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <rect x="20" y="116" width="48" height="6" fill="url(#accentCyan)" opacity="0.7" />
      <rect x="20" y="148" width="48" height="6" fill="url(#accentCyan)" opacity="0.4" />

      {/* Bulky receiver */}
      <rect x="70" y="96" width="120" height="60" rx="4" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <rect x="78" y="92" width="106" height="6" fill="url(#gunmetalDark)" />
      <rect x="78" y="94" width="106" height="3" fill="url(#accentCyan)" />
      {/* Energy core display */}
      <rect x="86" y="108" width="40" height="20" rx="2" fill="#0a0a14" stroke="url(#accentCyan)" strokeWidth="1.5" />
      <rect x="90" y="114" width="32" height="3" fill="url(#accentCyan)" />
      <rect x="90" y="120" width="22" height="3" fill="url(#accentCyan)" opacity="0.7" />
      {/* Power gauge */}
      <circle cx="160" cy="118" r="14" fill="#0a0a14" stroke="url(#accentCyan)" strokeWidth="1.5" />
      <circle cx="160" cy="118" r="10" fill="none" stroke="url(#accentCyan)" strokeWidth="2" opacity="0.8" />
      <circle cx="160" cy="118" r="5" fill="url(#accentCyan)" />

      {/* Pistol grip */}
      <polygon points="120,156 148,156 156,206 126,206" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <rect x="128" y="168" width="22" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="128" y="178" width="22" height="3" fill="#2a2422" opacity="0.8" />

      {/* Trigger guard */}
      <path d="M 156 160 Q 156 178 172 178 L 184 178 Q 190 178 190 172 L 190 160 Z"
        fill="none" stroke="url(#gunmetalLight)" strokeWidth="2.5" />
      <line x1="178" y1="163" x2="178" y2="176" stroke="#000" strokeWidth="2.5" />

      {/* Rail accelerator — main barrel */}
      <rect x="190" y="118" width="160" height="18" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      {/* Top rail */}
      <rect x="190" y="112" width="160" height="6" fill="url(#gunmetal)" stroke="#000" strokeWidth="0.8" />
      {/* Bottom rail */}
      <rect x="190" y="136" width="160" height="6" fill="url(#gunmetal)" stroke="#000" strokeWidth="0.8" />

      {/* Energy coils wrapping the barrel — signature railgun look */}
      {[210, 234, 258, 282, 306, 330].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="127" rx="6" ry="14" fill="none" stroke="url(#accentCyan)" strokeWidth="3" />
          <ellipse cx={x} cy="127" rx="4" ry="10" fill="none" stroke="#fff" strokeWidth="1" opacity="0.5" />
        </g>
      ))}

      {/* Muzzle aperture */}
      <rect x="350" y="108" width="18" height="38" rx="3" fill="url(#gunmetal)" stroke="#000" strokeWidth="1" />
      <ellipse cx="359" cy="127" rx="6" ry="14" fill="#000" />
      <ellipse cx="359" cy="127" rx="3" ry="9" fill="url(#accentCyan)" opacity="0.85" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// G-LAUNCH — grenade launcher: thick body with large bore aperture.
// Blue accent.
// ═══════════════════════════════════════════════════════════════════
function LauncherSVG() {
  return (
    <svg viewBox="0 0 380 220" width="100%" height="100%" style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.6))" }}>
      <SharedDefs />

      {/* Stock */}
      <polygon points="20,108 75,108 80,158 25,158" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <rect x="30" y="118" width="46" height="3" fill="url(#accentBlue)" opacity="0.5" />

      {/* Receiver — chunky */}
      <rect x="75" y="98" width="110" height="52" rx="4" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      <rect x="82" y="94" width="96" height="6" fill="url(#gunmetalDark)" />
      <rect x="82" y="96" width="96" height="2" fill="url(#accentBlue)" />

      {/* Ammo counter display */}
      <rect x="90" y="106" width="30" height="14" rx="2" fill="#0a0a14" stroke="url(#accentBlue)" strokeWidth="1.2" />
      <text x="105" y="118" textAnchor="middle" fontSize="11" fontWeight="800" fontFamily="JetBrains Mono, monospace" fill="url(#accentBlue)">06</text>

      {/* Pistol grip */}
      <polygon points="120,150 148,150 156,202 128,202" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      <rect x="128" y="162" width="22" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="128" y="172" width="22" height="3" fill="#2a2422" opacity="0.8" />

      {/* Trigger guard */}
      <path d="M 156 154 Q 156 172 172 172 L 184 172 Q 190 172 190 166 L 190 154 Z"
        fill="none" stroke="url(#gunmetalLight)" strokeWidth="2.5" />
      <line x1="178" y1="157" x2="178" y2="170" stroke="#000" strokeWidth="2.5" />

      {/* Heavy barrel with grenade bore */}
      <rect x="185" y="100" width="130" height="56" rx="4" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1.2" />
      {/* Side cooling vents */}
      <rect x="195" y="106" width="40" height="3" fill="#000" />
      <rect x="195" y="113" width="40" height="3" fill="#000" />
      <rect x="195" y="146" width="40" height="3" fill="#000" />
      <rect x="195" y="139" width="40" height="3" fill="#000" />
      {/* Pump grip on barrel */}
      <rect x="246" y="106" width="58" height="44" rx="3" fill="url(#polymer)" stroke="#000" strokeWidth="1" />
      {[252, 262, 272, 282, 292].map((x) => (
        <rect key={x} x={x} y="112" width="3" height="32" fill="#2a1a22" />
      ))}

      {/* MASSIVE BORE — defining feature */}
      <ellipse cx="335" cy="128" rx="22" ry="32" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.5" />
      <ellipse cx="335" cy="128" rx="17" ry="26" fill="#000" />
      <ellipse cx="335" cy="128" rx="11" ry="18" fill="url(#accentBlue)" opacity="0.55" />
      <ellipse cx="335" cy="128" rx="6" ry="10" fill="url(#accentBlue)" />
      <ellipse cx="333" cy="124" rx="2" ry="3" fill="#fff" opacity="0.8" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SIDEKICK PISTOL — compact, vertical mag through grip. Amber accent.
// ═══════════════════════════════════════════════════════════════════
function PistolSVG() {
  return (
    <svg viewBox="0 0 380 220" width="100%" height="100%" style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.6))" }}>
      <SharedDefs />

      {/* Slide — top of pistol */}
      <rect x="120" y="106" width="160" height="26" rx="3" fill="url(#gunmetal)" stroke="#000" strokeWidth="1.2" />
      {/* Slide top rail */}
      <rect x="126" y="102" width="148" height="6" fill="url(#gunmetalDark)" />
      <rect x="126" y="104" width="148" height="2" fill="url(#accentAmber)" />
      {/* Serrations on the back of the slide */}
      {[128, 134, 140, 146].map((x) => (
        <line key={x} x1={x} y1="108" x2={x} y2="130" stroke="#000" strokeWidth="1" />
      ))}
      {/* Ejection port */}
      <rect x="200" y="110" width="34" height="10" rx="1" fill="#000" />
      <rect x="204" y="113" width="26" height="3" fill="url(#accentAmber)" opacity="0.6" />

      {/* Front sight */}
      <rect x="266" y="98" width="6" height="10" fill="url(#gunmetal)" />
      {/* Rear sight */}
      <rect x="134" y="98" width="14" height="10" fill="url(#gunmetal)" />
      <rect x="139" y="100" width="4" height="6" fill="#000" />

      {/* Barrel poking out front */}
      <rect x="282" y="114" width="14" height="10" fill="url(#barrelSteel)" stroke="#000" strokeWidth="0.8" />
      <ellipse cx="294" cy="119" rx="3" ry="5" fill="#000" />
      <ellipse cx="294" cy="119" rx="1.5" ry="2.5" fill="url(#accentAmber)" opacity="0.8" />

      {/* Frame / grip — angled */}
      <polygon points="160,132 234,132 244,200 168,200" fill="url(#polymer)" stroke="#000" strokeWidth="1.2" />
      {/* Grip stippling pattern */}
      <rect x="175" y="148" width="50" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="175" y="158" width="50" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="175" y="168" width="50" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="175" y="178" width="50" height="3" fill="#2a2422" opacity="0.8" />
      <rect x="175" y="188" width="50" height="3" fill="#2a2422" opacity="0.8" />

      {/* Trigger guard */}
      <path d="M 234 132 Q 234 152 220 158 L 196 158 Q 186 158 186 150 L 186 132 Z"
        fill="none" stroke="url(#gunmetalLight)" strokeWidth="2.8" />
      <line x1="204" y1="142" x2="204" y2="155" stroke="#000" strokeWidth="2.5" />

      {/* Magazine base */}
      <rect x="166" y="198" width="80" height="8" rx="1" fill="url(#gunmetalDark)" stroke="#000" strokeWidth="1" />
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

function MuzzleFlash({ flashColor }) {
  // Barrel-tip locations vary slightly per weapon. We pick a position
  // that lands near the average barrel-tip across the silhouettes.
  return (
    <div style={{
      position: "absolute",
      left: "93%", top: "57%",
      width: 70, height: 70,
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
