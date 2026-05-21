// Arena — procedural cyberpunk geometry + collision data.
//
// The arena is built from a small set of primitive types:
//   • Floor — a single large quad with grid pattern
//   • Walls — outer perimeter + interior cover blocks
//   • Pillars — emissive neon columns providing vertical interest
//   • Spawn rings — glowing circles marking spawn points
//   • Hazard zones (energy-shift-only pathways) — translucent
//     planes that block normal-dimension players but pass shifted
//     players.
//
// Collision strategy:
//   • Walls/pillars provide AABB collision via this.colliders[].
//   • Phase-walls (marked with userData.phasable = true) are
//     ignored when player.shifting === true.
//   • Floor is a hard plane at y=0.
//   • Spawn points are exposed via randomSpawnPoint().
//
// Visual strategy:
//   • Emissive MeshBasicMaterial for neon glow — cheap, no light
//     computation needed.
//   • Wireframe overlays on key surfaces sell the "data lattice" look.
//   • A single InstancedMesh handles the repeating floor-tile grid
//     (60×60 tiles = 1 draw call instead of 3600).

import * as THREE from "three";

// P1-8 — Phase wall shader factory.
// Animated scanlines + data-stream noise + edge-Fresnel rim glow.
// Two states selected by uShifted (0 = solid, 1 = phased through).
// In the solid state it pulses subtly; in the phased state it
// becomes a translucent flowing pattern showing the player can pass.
function makePhaseWallMaterial(colorHex) {
  const color = new THREE.Color(colorHex);
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:     { value: 0 },
      uShifted:  { value: 0 },
      uColor:    { value: new THREE.Vector3(color.r, color.g, color.b) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      uniform float uTime;
      uniform float uShifted;
      uniform vec3 uColor;

      // Simple hash + value noise.
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      void main() {
        // Vertical scanlines moving upward.
        float scan = sin((vUv.y * 60.0) - uTime * 6.0) * 0.5 + 0.5;
        // Data-stream noise — two layered noises drifting at different speeds.
        float n1 = noise(vUv * vec2(20.0, 6.0) + vec2(uTime * 0.4, uTime * 0.9));
        float n2 = noise(vUv * vec2(40.0, 12.0) - vec2(0.0, uTime * 1.4));
        float dataStream = clamp(n1 * 0.6 + n2 * 0.5, 0.0, 1.0);

        // Fresnel rim — bright at edges, dark at center face.
        float fres = pow(1.0 - max(0.0, dot(vNormal, vViewDir)), 2.0);

        // Solid-state look: emit base color + subtle data shimmer.
        vec3 solidCol = uColor * (0.6 + scan * 0.4) + uColor * dataStream * 0.25;
        float solidAlpha = 0.85 + fres * 0.1;

        // Phased-state look: translucent data weave, edges glow strong.
        vec3 phaseCol = uColor * (0.4 + dataStream * 0.9) + vec3(0.2, 0.7, 0.95) * fres * 0.4;
        float phaseAlpha = 0.15 + dataStream * 0.25 + fres * 0.18;

        // Blend by uShifted (0 → 1)
        vec3 col = mix(solidCol, phaseCol, uShifted);
        float alpha = mix(solidAlpha, phaseAlpha, uShifted);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.colliders = []; // [{aabb: Box3, phasable: boolean}]
    this.spawnPoints = [];
    this._build();
  }

  _build() {
    const GRID = 40; // arena half-size in world units
    const colors = {
      grid:      0x2540a0,
      gridDark:  0x10183a,
      neonA:     0xa78bfa, // violet
      neonB:     0x22d3ee, // cyan
      neonC:     0xf472b6, // pink
      neonD:     0xfbbf24, // amber
    };

    // ── Floor: visibly-toned base + bright grid lines ──────────
    // Floor was previously near-black (0x070a18) which blended with
    // the scene background and made the world feel like infinite
    // void. Lifted to a clearly-readable mid-tone navy.
    const floorGeom = new THREE.PlaneGeometry(GRID * 2, GRID * 2, 1, 1);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0x1a2050 });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Bright grid lines so the floor reads as a grid pattern, giving
    // the player clear ground reference + sense of motion.
    const grid = new THREE.GridHelper(GRID * 2, 40, 0x5a7adf, 0x2030a0);
    grid.position.y = 0.01;
    this.scene.add(grid);

    // ── Ceiling: bright accent plane above so the arena reads as
    // an enclosed space instead of "infinite night". Also helps with
    // spatial orientation.
    const ceilingGeom = new THREE.PlaneGeometry(GRID * 2, GRID * 2, 1, 1);
    const ceilingMat = new THREE.MeshBasicMaterial({ color: 0x0a0e2a });
    const ceiling = new THREE.Mesh(ceilingGeom, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 6;
    this.scene.add(ceiling);
    // Bright accent grid on the ceiling for visual depth.
    const ceilingGrid = new THREE.GridHelper(GRID * 2, 20, 0xa78bfa, 0x4030a0);
    ceilingGrid.position.y = 5.99;
    this.scene.add(ceilingGrid);

    // ── Outer walls (4 of them) ────────────────────────────────
    const wallH = 6;
    const wallT = 1;
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x202a5a });
    const addWall = (x, z, w, d) => {
      const g = new THREE.BoxGeometry(w, wallH, d);
      const m = new THREE.Mesh(g, wallMat);
      m.position.set(x, wallH / 2, z);
      this.scene.add(m);
      // Emissive trim along the top edge.
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.1, 0.12, d + 0.1),
        new THREE.MeshBasicMaterial({ color: colors.neonA }),
      );
      trim.position.set(x, wallH, z);
      this.scene.add(trim);
      this.colliders.push({
        aabb: new THREE.Box3(
          new THREE.Vector3(x - w / 2, 0, z - d / 2),
          new THREE.Vector3(x + w / 2, wallH, z + d / 2),
        ),
        phasable: false,
        mesh: m,
      });
    };
    addWall(0, -GRID, GRID * 2, wallT);
    addWall(0,  GRID, GRID * 2, wallT);
    addWall(-GRID, 0, wallT, GRID * 2);
    addWall( GRID, 0, wallT, GRID * 2);

    // ── Interior cover blocks ──────────────────────────────────
    // A handful of waist-high blocks scattered around. Player can
    // crouch behind them; bullets blocked.
    const cover = (x, z, w, h, d, neonHex) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2a3060 }));
      m.position.set(x, h / 2, z);
      this.scene.add(m);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.06, 0.1, d + 0.06),
        new THREE.MeshBasicMaterial({ color: neonHex }),
      );
      cap.position.set(x, h, z);
      this.scene.add(cap);
      this.colliders.push({
        aabb: new THREE.Box3(
          new THREE.Vector3(x - w / 2, 0, z - d / 2),
          new THREE.Vector3(x + w / 2, h, z + d / 2),
        ),
        phasable: false,
        mesh: m,
      });
    };
    cover(-8, 4, 4, 2.0, 1.5, colors.neonB);
    cover( 8, 4, 4, 2.0, 1.5, colors.neonC);
    cover(0, -8, 6, 2.6, 2, colors.neonA);
    cover(-14, -14, 3, 3.5, 3, colors.neonD);
    cover(14, -14, 3, 3.5, 3, colors.neonD);
    cover(-22, 10, 4, 2, 4, colors.neonB);
    cover(22, 10, 4, 2, 4, colors.neonC);
    cover(0, 18, 8, 2.4, 1.5, colors.neonA);

    // ── PHASE WALL — central diagonal corridor blocked in the
    // normal dimension. Solid + opaque normally, translucent + non-
    // colliding when EnergyShift is active. The defining unique
    // mechanic visualized.
    //
    // P1-8: custom ShaderMaterial draws an animated data-noise
    // pattern flowing across the wall. The material exposes uniforms
    // (uTime, uShifted, uColor) that EnergyShift writes to so the
    // visual flips between "solid neon" and "phased data stream"
    // smoothly. Cheap fragment program — runs everywhere.
    {
      const w = 12, h = 4, d = 1;
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, makePhaseWallMaterial(colors.neonC));
      m.position.set(0, h / 2, -2);
      m.rotation.y = Math.PI / 4;
      m.userData.phasable = true;
      this.scene.add(m);
      // Track the material so EnergyShift can poke its uniforms
      // (we expose this via this.phaseMaterials for that purpose).
      this.phaseMaterials = this.phaseMaterials || [];
      this.phaseMaterials.push(m.material);
      const box = new THREE.Box3().setFromObject(m);
      this.colliders.push({ aabb: box, phasable: true, mesh: m });
    }

    // ── Neon pillars at corners — purely decorative, cast emissive
    // glow on nearby surfaces by being bright enough to show.
    const pillar = (x, z, neonHex) => {
      const g = new THREE.CylinderGeometry(0.4, 0.4, wallH * 1.4, 6, 1, true);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: neonHex }));
      m.position.set(x, wallH * 0.7, z);
      this.scene.add(m);
      // Wireframe cage around it for the "data lattice" look.
      const cage = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, wallH * 1.4, 6, 4, true),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.15 }),
      );
      cage.position.copy(m.position);
      this.scene.add(cage);
    };
    pillar(-GRID + 4, -GRID + 4, colors.neonA);
    pillar( GRID - 4, -GRID + 4, colors.neonB);
    pillar(-GRID + 4,  GRID - 4, colors.neonC);
    pillar( GRID - 4,  GRID - 4, colors.neonD);

    // ── Spawn ring decals ──────────────────────────────────────
    const ring = (x, z, hex) => {
      const geom = new THREE.RingGeometry(1.4, 1.6, 32);
      const mat = new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
      const r = new THREE.Mesh(geom, mat);
      r.rotation.x = -Math.PI / 2;
      r.position.set(x, 0.02, z);
      this.scene.add(r);
      this.spawnPoints.push(new THREE.Vector3(x, 0, z));
    };
    ring(0, 12, colors.neonA);
    ring(-20, -20, colors.neonB);
    ring(20, -20, colors.neonC);
    ring(0, -25, colors.neonD);

    // ── Skybox vibe — a large back-faced cube with a soft
    // gradient. Cheaper than a real cubemap, looks fine.
    const skyGeo = new THREE.BoxGeometry(180, 180, 180);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x05060e, side: THREE.BackSide });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
  }

  // Used by PlayerController.collide() — returns true if a
  // candidate position collides with any non-phasable solid (or
  // any solid if `shifted` is false).
  collidesAt(pos, radius, shifted) {
    const box = new THREE.Box3(
      new THREE.Vector3(pos.x - radius, pos.y - 0.9, pos.z - radius),
      new THREE.Vector3(pos.x + radius, pos.y + 0.9, pos.z + radius),
    );
    for (const c of this.colliders) {
      if (c.phasable && shifted) continue;
      if (c.aabb.intersectsBox(box)) return true;
    }
    return false;
  }

  // Raycaster target list for combat hit-scan.
  raycastTargets() {
    return this.colliders.map((c) => c.mesh).filter(Boolean);
  }

  randomSpawnPoint() {
    if (this.spawnPoints.length === 0) return new THREE.Vector3(0, 0, 0);
    return this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
  }

  // Returns the list of phasable mesh nodes — used by EnergyShift
  // to fade them in/out as the player shifts.
  phaseMeshes() {
    return this.colliders.filter((c) => c.phasable).map((c) => c.mesh);
  }

  // P1-8: per-frame uniform tick for the phase-wall shader. Engine
  // calls this from its main loop. uShifted is set externally by
  // EnergyShift; here we just animate uTime.
  tickShaders(dt) {
    if (!this.phaseMaterials) return;
    for (const m of this.phaseMaterials) {
      if (m.uniforms?.uTime) m.uniforms.uTime.value += dt;
    }
  }
}
