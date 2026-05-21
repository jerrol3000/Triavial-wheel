// ParticlePool — pre-allocated burst particles for impacts.
//
// Why a pool: spawning fresh THREE.Mesh objects per hit pegs the GC
// and stalls the render thread. Instead, we allocate N invisible
// sprite-like meshes up front and recycle them — each "burst" picks
// k free particles, repositions them, animates them outward, then
// returns them to the pool.

import * as THREE from "three";

export class ParticlePool {
  constructor(scene, capacity = 200) {
    this.scene = scene;
    this.particles = [];
    this._sharedGeom = new THREE.SphereGeometry(0.06, 4, 4);
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(this._sharedGeom, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.particles.push({
        mesh, mat,
        free: true, born: 0, life: 0,
        vx: 0, vy: 0, vz: 0,
      });
    }
  }

  burst(point, colorHex, count = 8) {
    let spawned = 0;
    for (const p of this.particles) {
      if (!p.free) continue;
      const angle = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.5) * 0.8;
      const speed = 4 + Math.random() * 4;
      p.vx = Math.cos(angle) * speed;
      p.vy = elev * speed + 2;
      p.vz = Math.sin(angle) * speed;
      p.mesh.position.copy(point);
      p.mesh.visible = true;
      p.mat.color.setHex(colorHex);
      p.mat.opacity = 1.0;
      p.free = false;
      p.born = Date.now();
      p.life = 400 + Math.random() * 200;
      spawned += 1;
      if (spawned >= count) break;
    }
  }

  update(dt) {
    const now = Date.now();
    for (const p of this.particles) {
      if (p.free) continue;
      const age = (now - p.born) / p.life;
      if (age >= 1) {
        p.free = true;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      // Gravity on particles for natural arc.
      p.vy -= 12 * dt;
      p.mat.opacity = 1 - age;
      p.mesh.scale.setScalar(1 - age * 0.4);
    }
  }
}
