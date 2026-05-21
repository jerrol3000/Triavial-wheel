// PlasmaRifle — the starter weapon. Balanced for general-purpose
// combat: medium damage, medium fire rate, tight recoil.
// Alt-fire: 3-round BURST that drains 3 ammo for a single click.
//
// Evolution (Mk-up every 3 kills, capped at 5):
//   Mk 1 — base
//   Mk 2 — fire rate ×1.4, recoil halved
//   Mk 3 — burst becomes 5-round + pierce
//   Mk 4 — homing slug aim-assist (12° cone)
//   Mk 5 — full pierce + 70ms fire rate
import * as THREE from "three";
import { Weapon } from "./Weapon.js";

export class PlasmaRifle extends Weapon {
  constructor(scene, camera, arena, particles, controls) {
    super(scene, camera, arena, particles, controls);
    this.id = "plasma";
    this.name = "PLASMA";
    this.icon = "✦";
    this.maxAmmo = 24;
    this.damage = 25;
    this.fireRateMs = 125;
    this.tracerColor = 0xa78bfa;
    this.altLabel = "3-RD BURST";
    this._burstCount = 3;
    this._homing = false;
    this._pierce = false;
    this._buildViewmodel();
  }

  evolve(level) {
    super.evolve(level);
    if (level === 2) { this.fireRateMs = 90; }
    if (level === 3) { this._pierce = true; this._burstCount = 5; }
    if (level === 4) { this._homing = true; }
    if (level >= 5)  { this._pierce = true; this.fireRateMs = 70; }
    if (this.barrelTip) {
      const c = level <= 1 ? 0xa78bfa : level === 2 ? 0x22d3ee : level === 3 ? 0xfbbf24 : level === 4 ? 0xf472b6 : 0xffffff;
      this.barrelTip.material.color.setHex(c);
    }
  }

  _doShot(player, bots, onResolved, state) {
    let dir = null;
    if (this._homing) {
      // Aim-assist: nudge dir toward nearest bot in a 12° cone.
      const origin = new THREE.Vector3();
      this.camera.getWorldPosition(origin);
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      let best = null, bestDot = Math.cos((12 * Math.PI) / 180);
      for (const b of bots) {
        if (b.dead) continue;
        const toBot = b.position.clone().sub(origin).normalize();
        const d = fwd.dot(toBot);
        if (d > bestDot) { bestDot = d; best = b; }
      }
      if (best) dir = best.position.clone().sub(origin).normalize();
    }
    this._hitscan(player, bots, onResolved, state, { directionOverride: dir, pierce: this._pierce });
  }

  altFire(player, bots, onResolved, state) {
    const now = Date.now();
    if (now - this._lastAltFire < this.altFireRateMs) return;
    if (state.reloading || state.ammo < this._burstCount) return;
    this._lastAltFire = now;
    // Fire N tightly-spaced shots — burst feel.
    for (let i = 0; i < this._burstCount; i++) {
      setTimeout(() => {
        if (state.ammo <= 0) return;
        state.ammo -= 1;
        this._applyRecoil();
        this._hitscan(player, bots, onResolved, state, { pierce: this._pierce });
      }, i * 60);
    }
  }

  _buildViewmodel() {
    const grp = buildViewmodel({
      bodySize: [0.18, 0.18, 0.72],
      bodyColor: 0x1a2050,
      accentColor: 0xa78bfa,
      tipColor: 0xa78bfa,
      anchor: [0.32, -0.32, -0.65],
    });
    this._attachViewmodel(grp.group, grp.tip);
  }
}

// ── Shared viewmodel builder ───────────────────────────────────────
// All weapons use the same "body + glow trim + barrel tip" silhouette
// with per-weapon colors. The original viewmodels were 12cm wide and
// painted nearly the same color as the scene background — invisible.
// This builder sizes them up + adds an emissive trim strip the player
// can actually see.
function buildViewmodel({ bodySize, bodyColor, accentColor, tipColor, anchor }) {
  const grp = new THREE.Group();
  const [bw, bh, bd] = bodySize;
  const [ax, ay, az] = anchor;

  // Main body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(bw, bh, bd),
    new THREE.MeshBasicMaterial({ color: bodyColor }),
  );
  body.position.set(ax, ay, az);
  grp.add(body);

  // Glow trim strip along the top of the body — gives the gun a
  // visible silhouette against the dark scene.
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(bw * 0.55, bh * 0.18, bd * 0.85),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  trim.position.set(ax, ay + bh * 0.45, az);
  grp.add(trim);

  // Side rail (small accent on the inboard side).
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(bw * 0.2, bh * 0.5, bd * 0.6),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  rail.position.set(ax - bw * 0.45, ay, az);
  grp.add(rail);

  // Barrel
  const barrelLen = bd * 0.55;
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(bw * 0.22, bw * 0.22, barrelLen, 10),
    new THREE.MeshBasicMaterial({ color: bodyColor }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(ax, ay, az - bd * 0.5 - barrelLen * 0.5);
  grp.add(barrel);

  // Barrel tip — glowing accent. This is the anchor for muzzle flash.
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(bw * 0.28, bw * 0.18, bw * 0.5, 10),
    new THREE.MeshBasicMaterial({ color: tipColor }),
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.set(ax, ay, az - bd * 0.5 - barrelLen - bw * 0.2);
  grp.add(tip);

  return { group: grp, tip };
}
export { buildViewmodel };
