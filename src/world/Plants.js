import * as THREE from 'three';
import { makeRng } from '../util/noise.js';

// [id, x, z, itemId, count]
const NODES = [
  ['meadow-ember-a', 48, 72, 'emberCap', 2],
  ['meadow-ember-b', 62, 88, 'emberCap', 1],
  ['lake-frost-a', 248, 118, 'frostLeaf', 2],
  ['lake-frost-b', 268, 96, 'frostLeaf', 2],
  ['forest-ember', 110, 40, 'emberCap', 2],
  ['forest-frost', 96, -20, 'frostLeaf', 1],
  ['gate-ember', 28, 10, 'emberCap', 1],
  ['north-frost', -80, 160, 'frostLeaf', 2],
];

const SAVE_KEY = 'veilspire.plants.v1';

export class Plants {
  constructor(scene, world, spells, audio) {
    this.scene = scene;
    this.world = world;
    this.spells = spells;
    this.audio = audio;
    this.group = new THREE.Group();
    this.nodes = [];
    this.harvested = this._load();
    this.total = NODES.length;
    this.collected = this.harvested.size;

    const rng = makeRng(4242);
    for (const [id, x, z, itemId, count] of NODES) {
      if (this.harvested.has(id)) continue;
      const group = this._build(itemId, rng);
      const y = world.groundHeight(x, z);
      group.position.set(x, y, z);
      group.rotation.y = rng() * Math.PI * 2;
      this.group.add(group);
      this.nodes.push({
        id,
        itemId,
        count,
        group,
        pos: new THREE.Vector3(x, y, z),
      });
    }
    scene.add(this.group);
  }

  _build(itemId, rng) {
    const group = new THREE.Group();
    const isEmber = itemId === 'emberCap';
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, 0.55, 5),
      new THREE.MeshStandardMaterial({
        color: isEmber ? 0x3a5a28 : 0x2e4a3a,
        roughness: 0.9,
      }),
    );
    stem.position.y = 0.28;
    stem.castShadow = true;
    group.add(stem);

    const cap = new THREE.Mesh(
      isEmber
        ? new THREE.SphereGeometry(0.22, 8, 6)
        : new THREE.ConeGeometry(0.28, 0.35, 7),
      new THREE.MeshStandardMaterial({
        color: isEmber ? 0xc45a28 : 0x6ab8c8,
        roughness: 0.55,
        emissive: isEmber ? 0xff6a20 : 0x3a90b0,
        emissiveIntensity: isEmber ? 0.55 : 0.35,
      }),
    );
    cap.position.y = isEmber ? 0.62 : 0.72;
    cap.castShadow = true;
    group.add(cap);

    const glint = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 4),
      new THREE.MeshBasicMaterial({
        color: isEmber ? 0xffb070 : 0xa0e8ff,
        transparent: true,
        opacity: 0.7,
      }),
    );
    glint.material.toneMapped = false;
    glint.position.y = 0.9;
    group.add(glint);
    group.userData.glint = glint;
    group.userData.phase = rng() * Math.PI * 2;
    return group;
  }

  nearest(point, range = 2.8) {
    let best = null;
    let bestDistance = range;
    for (const node of this.nodes) {
      const distance = point.distanceTo(node.pos);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best;
  }

  harvest(node, inventory) {
    if (!node || !this.nodes.includes(node)) return false;
    inventory.add(node.itemId, node.count);
    this.spells?.spawnBurst?.(
      node.pos.clone().setY(node.pos.y + 0.6),
      18,
      3.5,
      node.itemId === 'emberCap' ? 0xff8a40 : 0x8ad8ff,
      0.8,
    );
    this.audio?.castWhoosh?.(0.9);
    this.group.remove(node.group);
    this.nodes = this.nodes.filter((candidate) => candidate !== node);
    this.harvested.add(node.id);
    this.collected = this.harvested.size;
    this._save();
    this.onHarvest?.(node);
    return true;
  }

  update(dt, elapsed) {
    void dt;
    for (const node of this.nodes) {
      const glint = node.group.userData.glint;
      if (!glint) continue;
      glint.position.y =
        0.9 + Math.sin(elapsed * 2.2 + node.group.userData.phase) * 0.08;
      glint.material.opacity =
        0.45 + Math.sin(elapsed * 3 + node.group.userData.phase) * 0.25;
    }
  }

  _save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify([...this.harvested]));
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }

  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw : []);
    } catch {
      return new Set();
    }
  }
}

export { NODES as PLANT_NODES };
