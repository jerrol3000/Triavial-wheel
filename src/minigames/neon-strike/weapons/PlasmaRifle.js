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
      bodySize: [0.26, 0.22, 0.70],
      bodyColor: 0x3a2a78,
      accentColor: 0xa78bfa,
      tipColor: 0xa78bfa,
      // Center horizontally so the mobile FIRE button (bottom-right)
      // and joystick (bottom-left) don't cover the viewmodel. This
      // was THE root cause of "I don't see the weapon" — on mobile
      // the gun sat exactly behind the 92px FIRE button.
      anchor: [0.0, -0.20, -0.60],
    });
    this._attachViewmodel(grp.group, grp.tip);
  }
}

// ── Shared viewmodel builder ───────────────────────────────────────
// All weapons use the same "body + glow trim + barrel tip" silhouette
// with per-weapon colors. The original viewmodels were 12cm wide and
// painted nearly the same color as the scene background — invisible.
// This builder positions the model 16cm right + 22cm down + 48cm in
// front of the camera so it stays in-frustum even at lower FOV
// settings, and adds:
//   • bright accent body color (not near-black)
//   • bold glowing top trim strip
//   • neon wireframe outline (EdgesGeometry) so the silhouette pops
//     even when the body color blends with the scene
//   • bright barrel + accent muzzle tip
function buildViewmodel({ bodySize, bodyColor, accentColor, tipColor, anchor }) {
  const grp = new THREE.Group();
  const [bw, bh, bd] = bodySize;
  const [ax, ay, az] = anchor;

  // Main body
  const bodyGeom = new THREE.BoxGeometry(bw, bh, bd);
  const body = new THREE.Mesh(
    bodyGeom,
    new THREE.MeshBasicMaterial({ color: bodyColor }),
  );
  body.position.set(ax, ay, az);
  grp.add(body);

  // Neon wireframe edges — guaranteed visible silhouette regardless
  // of body fill color. This is the key trick: a thin glowing line
  // outline pops against any background.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(bodyGeom),
    new THREE.LineBasicMaterial({ color: accentColor, transparent: true, opacity: 0.9 }),
  );
  edges.position.copy(body.position);
  grp.add(edges);

  // Glow trim strip along the top — solid accent so the top of the
  // gun reads as a bright bar from the player's POV.
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(bw * 0.7, bh * 0.22, bd * 0.92),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  trim.position.set(ax, ay + bh * 0.48, az);
  grp.add(trim);

  // Side rail (small accent on the inboard side).
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(bw * 0.22, bh * 0.55, bd * 0.65),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  rail.position.set(ax - bw * 0.48, ay, az);
  grp.add(rail);

  // Barrel (cylinder, body-tinted)
  const barrelLen = bd * 0.55;
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(bw * 0.26, bw * 0.26, barrelLen, 12),
    new THREE.MeshBasicMaterial({ color: bodyColor }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(ax, ay, az - bd * 0.5 - barrelLen * 0.5);
  grp.add(barrel);

  // Bright muzzle ring around the barrel tip — extra visible.
  const muzzleRing = new THREE.Mesh(
    new THREE.TorusGeometry(bw * 0.32, bw * 0.06, 6, 16),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  muzzleRing.position.set(ax, ay, az - bd * 0.5 - barrelLen);
  grp.add(muzzleRing);

  // Barrel tip — glowing accent. This is the anchor for muzzle flash.
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(bw * 0.34, bw * 0.22, bw * 0.6, 10),
    new THREE.MeshBasicMaterial({ color: tipColor }),
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.set(ax, ay, az - bd * 0.5 - barrelLen - bw * 0.25);
  grp.add(tip);

  return { group: grp, tip };
}
export { buildViewmodel };
