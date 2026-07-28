import * as THREE from 'three';
import { terrainHeight, WATER_LEVEL } from './Terrain.js';
import { makeRng } from '../util/noise.js';
import { VILLAGE, RUINS } from './Settlements.js';
import { CASTLE_PLATEAU } from './Terrain.js';

// Barrels and crates with lightweight rigid-body motion. They can be
// levitated, hurled, and smashed — the physics playground for spellwork.

const WOOD = new THREE.MeshStandardMaterial({ color: 0x6b5231, roughness: 0.9 });
const HOOP = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.6, metalness: 0.5 });
const CRATE = new THREE.MeshStandardMaterial({ color: 0x7a6039, roughness: 0.92 });
const DEBRIS = new THREE.MeshStandardMaterial({ color: 0x5d472b, roughness: 0.95, flatShading: true });

const GRAVITY = 22;

export class Prop {
  constructor(scene, world, x, z, kind, rng) {
    this.world = world;
    this.scene = scene;
    this.kind = kind;
    this.radius = kind === 'barrel' ? 0.42 : 0.48;
    this.height = kind === 'barrel' ? 1.0 : 0.9;

    this.mesh = new THREE.Group();
    if (kind === 'barrel') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.34, 1.0, 10), WOOD);
      body.castShadow = body.receiveShadow = true;
      this.mesh.add(body);
      for (const hy of [-0.28, 0.28]) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.395, 0.035, 6, 14), HOOP);
        hoop.rotation.x = Math.PI / 2;
        hoop.position.y = hy;
        this.mesh.add(hoop);
      }
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), CRATE);
      body.castShadow = body.receiveShadow = true;
      this.mesh.add(body);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.08, 0.88), HOOP);
      this.mesh.add(band);
    }

    this.position = new THREE.Vector3(x, terrainHeight(x, z) + this.height / 2, z);
    this.velocity = new THREE.Vector3();
    this.spin = new THREE.Vector3((rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4);
    this.mesh.rotation.y = rng() * Math.PI * 2;
    this.mesh.position.copy(this.position);
    this.grounded = true;
    this.held = false;
    this.broken = false;
    scene.add(this.mesh);
  }

  applyImpulse(dir, force) {
    this.velocity.addScaledVector(dir, force);
    this.grounded = false;
    this.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  }

  break_(spawnBurst, audio) {
    if (this.broken) return;
    this.broken = true;
    this.scene.remove(this.mesh);
    spawnBurst?.(this.position, 26, 5, 0x8a6b3d, 0.9);
    audio?.impact(0.8);
    // Debris chunks that tumble and fade
    this.debris = [];
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(new THREE.TetrahedronGeometry(0.12 + Math.random() * 0.12), DEBRIS);
      c.position.copy(this.position);
      c.castShadow = true;
      this.scene.add(c);
      this.debris.push({
        mesh: c, life: 3.5,
        vel: new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      });
    }
  }

  update(dt, spawnBurst, audio, enemies) {
    if (this.broken) {
      if (!this.debris) return;
      for (let i = this.debris.length - 1; i >= 0; i--) {
        const d = this.debris[i];
        d.life -= dt;
        d.vel.y -= GRAVITY * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        const g = terrainHeight(d.mesh.position.x, d.mesh.position.z) + 0.1;
        if (d.mesh.position.y < g) {
          d.mesh.position.y = g;
          d.vel.y *= -0.28;
          d.vel.x *= 0.6; d.vel.z *= 0.6;
        }
        d.mesh.rotation.x += d.spin.x * dt;
        d.mesh.rotation.z += d.spin.z * dt;
        if (d.life <= 0) {
          this.scene.remove(d.mesh);
          this.debris.splice(i, 1);
        }
      }
      return;
    }
    if (this.held) return; // the spell drives position while levitated

    if (!this.grounded) {
      this.velocity.y -= GRAVITY * dt;
      this.position.addScaledVector(this.velocity, dt);
      this.mesh.rotation.x += this.spin.x * dt;
      this.mesh.rotation.y += this.spin.y * dt;
      this.mesh.rotation.z += this.spin.z * dt;

      // Enemy impact: a hurled barrel actually hurts
      if (enemies && this.velocity.lengthSq() > 40) {
        const hits = enemies.queryHits(this.position, this.radius + 0.5);
        if (hits.length) {
          const dir = this.velocity.clone().normalize();
          hits[0].takeHit(26, dir, 9);
          this.break_(spawnBurst, audio);
          return;
        }
      }

      const g = terrainHeight(this.position.x, this.position.z) + this.height / 2;
      if (this.position.y <= g) {
        const impact = -this.velocity.y;
        this.position.y = g;
        if (impact > 11) { this.break_(spawnBurst, audio); return; }
        this.velocity.y = impact * 0.25;
        this.velocity.x *= 0.55;
        this.velocity.z *= 0.55;
        this.spin.multiplyScalar(0.5);
        if (Math.abs(this.velocity.y) < 0.9 && this.velocity.lengthSq() < 1.2) {
          this.grounded = true;
          this.velocity.set(0, 0, 0);
          this.spin.set(0, 0, 0);
          // Settle upright
          this.mesh.rotation.x = 0;
          this.mesh.rotation.z = 0;
        }
      }
      // Sink props that land in the lake
      if (this.position.y < WATER_LEVEL - 2) this.break_(spawnBurst, audio);
    }
    this.mesh.position.copy(this.position);
  }
}

export class PropManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.props = [];
    const rng = makeRng(8080);

    const cluster = (cx, cz, count, spread) => {
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * spread;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (terrainHeight(x, z) < WATER_LEVEL + 0.5) continue;
        this.props.push(new Prop(scene, world, x, z, rng() < 0.55 ? 'barrel' : 'crate', rng));
      }
    };
    cluster(VILLAGE.x, VILLAGE.z, 14, 22);           // village yards
    cluster(CASTLE_PLATEAU.x + 6, CASTLE_PLATEAU.z + 30, 10, 16); // castle courtyard
    cluster(RUINS.x, RUINS.z, 6, 15);                // scattered by the ruins
  }

  // Nearest un-held, unbroken prop within range of a point
  nearest(point, range) {
    let best = null, bestD = range;
    for (const p of this.props) {
      if (p.broken || p.held) continue;
      const d = p.position.distanceTo(point);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  update(dt, spawnBurst, audio, enemies) {
    for (const p of this.props) p.update(dt, spawnBurst, audio, enemies);
  }
}
