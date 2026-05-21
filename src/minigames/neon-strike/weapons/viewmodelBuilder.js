// Shared viewmodel builder — used by every concrete weapon.
//
// Lives in its own module to avoid the fragile pattern of importing
// from PlasmaRifle.js with the import statement at the BOTTOM of
// every weapon file. While ES module imports are technically hoisted,
// production webpack + terser can resolve that pattern unpredictably
// — moving the helper to a dedicated module is the safe fix.
//
// All weapons share the same "body + glow trim + barrel tip + hand
// grip + forearm" silhouette with per-weapon colors. The grip +
// forearm make the weapon read as "held by a first-person character"
// instead of floating mid-air.

import * as THREE from "three";

export function buildViewmodel({ bodySize, bodyColor, accentColor, tipColor, anchor }) {
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

  // Neon wireframe edges — guaranteed visible silhouette.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(bodyGeom),
    new THREE.LineBasicMaterial({ color: accentColor, transparent: true, opacity: 0.95 }),
  );
  edges.position.copy(body.position);
  grp.add(edges);

  // Glow trim strip along the top.
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(bw * 0.7, bh * 0.25, bd * 0.92),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  trim.position.set(ax, ay + bh * 0.50, az);
  grp.add(trim);

  // Side rail (small accent on the inboard side).
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(bw * 0.24, bh * 0.55, bd * 0.65),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  rail.position.set(ax - bw * 0.50, ay, az);
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

  // Bright muzzle ring around the barrel tip.
  const muzzleRing = new THREE.Mesh(
    new THREE.TorusGeometry(bw * 0.38, bw * 0.08, 6, 16),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  muzzleRing.position.set(ax, ay, az - bd * 0.5 - barrelLen);
  grp.add(muzzleRing);

  // Barrel tip — anchor for muzzle flash.
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(bw * 0.34, bw * 0.22, bw * 0.6, 10),
    new THREE.MeshBasicMaterial({ color: tipColor }),
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.set(ax, ay, az - bd * 0.5 - barrelLen - bw * 0.25);
  grp.add(tip);

  // ── HAND GRIP + forearm — makes the gun read as held by a first-
  // person character instead of floating mid-air.
  const gripW = bw * 0.5;
  const gripH = bh * 1.3;
  const gripD = bd * 0.20;
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(gripW, gripH, gripD),
    new THREE.MeshBasicMaterial({ color: 0x3a2818 }),
  );
  grip.position.set(ax + bw * 0.08, ay - bh * 0.55 - gripH * 0.35, az + bd * 0.05);
  grp.add(grip);
  const gloveBand = new THREE.Mesh(
    new THREE.BoxGeometry(gripW * 1.15, gripH * 0.18, gripD * 1.15),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  gloveBand.position.set(ax + bw * 0.08, ay - bh * 0.48 - gripH * 0.12, az + bd * 0.05);
  grp.add(gloveBand);
  // Forearm — extends down + back from the grip toward the player.
  const armLen = gripH * 1.5;
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(gripW * 0.95, armLen, gripD * 1.2),
    new THREE.MeshBasicMaterial({ color: 0x241810 }),
  );
  arm.position.set(ax + bw * 0.12, ay - bh * 0.55 - gripH - armLen * 0.45, az + bd * 0.25);
  arm.rotation.x = -0.30;
  grp.add(arm);
  // Forearm accent stripe
  const armStripe = new THREE.Mesh(
    new THREE.BoxGeometry(gripW * 1.0, armLen * 0.12, gripD * 1.25),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  armStripe.position.copy(arm.position);
  armStripe.rotation.x = -0.30;
  armStripe.position.y += armLen * 0.30;
  grp.add(armStripe);

  return { group: grp, tip };
}
