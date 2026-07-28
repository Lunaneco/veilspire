import * as THREE from 'three';
import { makeRng } from '../util/noise.js';

// Aether shards: glowing crystals hidden across the valley. Approaching one
// collects it (burst + light flash + mana), driving exploration.

const SHARD_SPOTS = [
  // [x, z, heightAboveGround] — ledges, lakeshore, forest clearings, rooftops
  [86, 96, 0.9], [-96, 44, 0.9], [150, -40, 0.9], [-40, 150, 0.9],
  [210, 30, 0.9], [-170, -30, 0.9], [60, -190, 0.9], [-120, -150, 0.9],
  [255, 130, 1.2], [-210, 120, 0.9], [120, 200, 0.9], [-60, 230, 0.9],
  [30, -250, 0.9], [190, -160, 0.9], [-250, -80, 0.9],
  // Two rewarding flight: high on the mountain ring
  [330, 120, 1.4], [-320, -140, 1.4],
];

export class Collectibles {
  constructor(scene, world, player, spells, audio) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.spells = spells;
    this.audio = audio;
    this.collected = 0;
    this.total = SHARD_SPOTS.length;
    this.shards = [];
    this.onCollect = null;

    const rng = makeRng(31337);
    const geo = new THREE.OctahedronGeometry(0.42, 0);
    geo.scale(1, 1.7, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a4a7a, roughness: 0.15, metalness: 0.35,
      emissive: 0x6ad8ff, emissiveIntensity: 2.6,
      transparent: true, opacity: 0.92,
    });
    this.mat = mat;

    for (const [x, z, h] of SHARD_SPOTS) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      g.add(mesh);
      // Halo ring so it reads from a distance
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.78, 20),
        new THREE.MeshBasicMaterial({
          color: 0x8ae4ff, transparent: true, opacity: 0.35,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      halo.material.toneMapped = false;
      halo.rotation.x = -Math.PI / 2;
      g.add(halo);
      const light = new THREE.PointLight(0x6ad8ff, 3.5, 10, 2);
      g.add(light);

      const y = world.groundHeight(x, z) + h;
      g.position.set(x, y, z);
      g.userData = { baseY: y, phase: rng() * Math.PI * 2, mesh, halo, light };
      scene.add(g);
      this.shards.push(g);
    }
  }

  update(dt, elapsed) {
    const p = this.player.position;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      const u = s.userData;
      s.position.y = u.baseY + Math.sin(elapsed * 1.3 + u.phase) * 0.28;
      u.mesh.rotation.y = elapsed * 0.9 + u.phase;
      u.halo.rotation.z = elapsed * 0.5;
      u.halo.scale.setScalar(1 + Math.sin(elapsed * 2 + u.phase) * 0.12);

      // Collect on approach
      const dx = p.x - s.position.x, dy = p.y + 1 - s.position.y, dz = p.z - s.position.z;
      if (dx * dx + dy * dy + dz * dz < 6.25) { // 2.5m
        this.spells.spawnBurst(s.position, 40, 6, 0x8ae4ff, 1.1);
        this.spells.onShake?.(0.08);
        this.audio?.castWhoosh(2.0);
        this.player.maxMana += this.player.mods?.shardMana ?? 5;
        this.player.mana = this.player.maxMana;
        this.scene.remove(s);
        this.shards.splice(i, 1);
        this.collected++;
        this.onCollect?.(this.collected, this.total);
      }
    }
  }
}
