import * as THREE from 'three';
import { GEAR } from '../systems/Equipment.js';

// Hidden caches: strongboxes, satchels and urns tucked into the corners of the
// valley. Each one is hand-placed with fixed contents, so finding a particular
// wand is a place you can go rather than a roll of the dice — and so a player
// who explores is rewarded with gear the shop will never stock.
//
// Contents are deliberately anchored to where they are: the Warden's wand is
// in the Warden's wood, the ward amulet is behind the ruin puzzle.

// [id, x, z, kind, reward, y?] — y is only given for interiors, where the
// terrain height under the floor is not the height you can stand at.
const CACHES = [
  ['gatehouse', 12, -52, 'box', { crowns: 45, items: { emberCap: 2 } }],
  ['courtyard', -14, -96, 'urn', { gear: 'robeThorn' }],
  ['astronomy', 24, -146, 'box', { gear: 'amuletEmber' }],
  ['hallnook', -37, -134, 'satchel', { crowns: 70, items: { frostLeaf: 2, aetherDust: 1 } }],
  ['lakeshore', 276, 86, 'urn', { crowns: 55, items: { frostLeaf: 3 } }],
  ['mirefall', 138, 236, 'satchel', { gear: 'robeStorm' }],
  ['ringstones', -228, -62, 'urn', { gear: 'amuletWarden' }],
  ['glimmerdeep', -54, -292, 'box', { crowns: 120, items: { aetherDust: 2 } }, 9.5],
  ['wardenwood', 258, -222, 'box', { gear: 'wandHollow' }],
  ['deepwood', 118, 86, 'satchel', { crowns: 40, items: { emberCap: 2, frostLeaf: 1 } }],
  ['northridge', -104, 136, 'urn', { crowns: 65, items: { aetherDust: 1 } }],
  ['southcrag', 146, -104, 'satchel', { crowns: 90, items: { emberCap: 1, frostLeaf: 1, aetherDust: 1 } }],
];

const SAVE_KEY = 'veilspire.caches.v1';

const WOOD = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.85 });
const IRON = new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.5, metalness: 0.6 });
const CLAY = new THREE.MeshStandardMaterial({ color: 0x6f4c33, roughness: 0.9 });
const CLOTH = new THREE.MeshStandardMaterial({ color: 0x4c4536, roughness: 0.95 });

export class Caches {
  constructor(scene, world, spells, audio) {
    this.scene = scene;
    this.world = world;
    this.spells = spells;
    this.audio = audio;
    this.group = new THREE.Group();
    this.caches = [];
    this.opened = this._load();
    this.onOpened = null;
    this.total = CACHES.length;

    for (const [id, x, z, kind, reward, fixedY] of CACHES) {
      if (this.opened.has(id)) continue; // already emptied in a past session
      const g = this._build(kind);
      const y = fixedY ?? world.groundHeight(x, z);
      g.position.set(x, y, z);
      g.rotation.y = (x * 0.37 + z * 0.11) % (Math.PI * 2);
      // A faint glint so a cache reads as findable without a map marker
      const glint = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 })
      );
      glint.material.toneMapped = false;
      glint.position.y = 0.95;
      g.add(glint);
      this.group.add(g);
      this.caches.push({ id, reward, group: g, glint, pos: new THREE.Vector3(x, y, z) });
    }
    scene.add(this.group);
  }

  _build(kind) {
    const g = new THREE.Group();
    if (kind === 'box') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.55, 0.6), WOOD);
      body.position.y = 0.28;
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.16, 0.63), WOOD);
      lid.position.y = 0.62;
      lid.castShadow = true;
      g.add(lid);
      for (const s of [-1, 1]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.64), IRON);
        band.position.set(s * 0.3, 0.36, 0);
        g.add(band);
      }
    } else if (kind === 'urn') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.19, 0.72, 10), CLAY);
      body.position.y = 0.36;
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.045, 6, 12), CLAY);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = 0.71;
      g.add(lip);
    } else { // satchel
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 0.34), CLOTH);
      body.position.y = 0.24;
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.22, 0.36), CLOTH);
      flap.position.set(0, 0.42, 0.02);
      flap.rotation.x = 0.18;
      g.add(flap);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 6, 14, Math.PI), IRON);
      strap.position.y = 0.46;
      g.add(strap);
    }
    return g;
  }

  // Nearest unopened cache within range, for the F prompt
  nearest(pos, range = 2.6) {
    let best = null, bestD = range * range;
    for (const c of this.caches) {
      const d = c.pos.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  open(cache, inventory, equipment) {
    const i = this.caches.indexOf(cache);
    if (i < 0) return null;
    this.caches.splice(i, 1);
    this.group.remove(cache.group);
    this.opened.add(cache.id);
    this._save();

    const r = cache.reward;
    const gained = [];
    // A duplicate piece of gear pays out in crowns instead of nothing
    if (r.gear) {
      if (equipment.grant(r.gear)) gained.push(GEAR[r.gear].name);
      else inventory.addCrowns(150);
    }
    if (r.crowns) inventory.addCrowns(r.crowns);
    for (const [id, n] of Object.entries(r.items ?? {})) inventory.add(id, n);

    this.spells?.spawnBurst(cache.pos.clone().setY(cache.pos.y + 0.7), 30, 4, 0xffd27a, 1.0);
    this.audio?.castWhoosh(1.4);
    this.onOpened?.(this.found, this.total, gained);
    return r;
  }

  get found() { return this.opened.size; }

  update(dt, elapsed) {
    for (const c of this.caches) {
      c.glint.material.opacity = 0.45 + Math.sin(elapsed * 2.2 + c.pos.x) * 0.35;
    }
  }

  _save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify([...this.opened])); }
    catch { /* storage unavailable */ }
  }

  _load() {
    try { return new Set(JSON.parse(localStorage.getItem(SAVE_KEY) ?? '[]')); }
    catch { return new Set(); }
  }
}
