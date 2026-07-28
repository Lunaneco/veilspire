import * as THREE from 'three';
import { terrainHeight, WATER_LEVEL } from './Terrain.js';
import { makeRng } from '../util/noise.js';
import { mergeStatics } from '../util/mergeStatics.js';

// Two hand-placed landmarks that give the valley somewhere to go:
//   Mirefall — a lakeside hamlet of thatched cottages, dock and well.
//   The Sunken Ring — a ruined stone circle whose vault opens when all four
//   braziers are lit with fire magic (see Puzzle below).

const THATCH = new THREE.MeshStandardMaterial({ color: 0x8a7040, roughness: 0.95, flatShading: true });
const PLASTER = new THREE.MeshStandardMaterial({ color: 0xcfc4ad, roughness: 0.9 });
const BEAM = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 });
const PLANK = new THREE.MeshStandardMaterial({ color: 0x6a5138, roughness: 0.9 });
const RUIN = new THREE.MeshStandardMaterial({ color: 0x7d786e, roughness: 0.95, flatShading: true });
const MOSS = new THREE.MeshStandardMaterial({ color: 0x4c6238, roughness: 1.0, flatShading: true });
const BRAZIER = new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.6, metalness: 0.6 });

export const VILLAGE = { x: 150, z: 245 };
export const RUINS = { x: -235, z: -70 };

export class Settlements {
  constructor(scene, spells) {
    this.group = new THREE.Group();
    this.spells = spells;
    this.colliders = [];
    this.buildingRects = [];
    // Landmarks stand in cleared ground — vegetation keeps out
    this.clearings = [
      { x: VILLAGE.x, z: VILLAGE.z, r: 34 },
      { x: RUINS.x, z: RUINS.z, r: 22 },
    ];
    const rng = makeRng(20260727);

    this.buildVillage(rng);
    this.buildRuins(rng);
    // Cottages and standing stones never move: batch each cluster down to a
    // few draw calls. The cell size keeps village and ruin separately cullable.
    this.mergeStats = mergeStatics(this.group, { cellSize: 60 });
    scene.add(this.group);
  }

  _box(x, y, z, w, h, d, mat, camBlock = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    const box = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, y, z), new THREE.Vector3(w, h, d));
    this.colliders.push({ type: 'box', box, camBlock });
    return m;
  }

  // ---------------- Mirefall ----------------
  buildVillage(rng) {
    const { x: vx, z: vz } = VILLAGE;

    const cottage = (cx, cz, rot, w, d, h) => {
      const y = terrainHeight(cx, cz);
      const g = new THREE.Group();
      g.position.set(cx, y, cz);
      g.rotation.y = rot;
      this.group.add(g);

      const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), PLASTER);
      walls.position.y = h / 2;
      walls.castShadow = walls.receiveShadow = true;
      g.add(walls);
      // Thatched gable roof (4-sided cone reads as a hipped thatch)
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.85, 4), THATCH);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = h + h * 0.42;
      roof.castShadow = true;
      g.add(roof);
      // Timber framing + door + window
      for (const sx of [-1, 1]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.16), BEAM);
        beam.position.set(sx * (w / 2 - 0.1), h / 2, d / 2 - 0.08);
        g.add(beam);
      }
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.12), BEAM);
      door.position.set(0, 0.95, d / 2 + 0.02);
      g.add(door);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.6),
        new THREE.MeshStandardMaterial({
          color: 0x2b3a52, roughness: 0.15, metalness: 0.5,
          emissive: 0xffb43c, emissiveIntensity: 0,
        }));
      win.position.set(w * 0.3, 1.6, d / 2 + 0.03);
      g.add(win);
      this.villageWindows ??= [];
      this.villageWindows.push(win.material);

      const box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(cx, y + h / 2, cz),
        new THREE.Vector3(Math.max(w, d) + 0.4, h, Math.max(w, d) + 0.4));
      this.colliders.push({ type: 'box', box });
      this.buildingRects.push({
        minX: cx - Math.max(w, d) / 2 - 1, maxX: cx + Math.max(w, d) / 2 + 1,
        minZ: cz - Math.max(w, d) / 2 - 1, maxZ: cz + Math.max(w, d) / 2 + 1,
      });
    };

    // Cottages arranged around a green, backs to the water
    const layout = [
      [-16, -10, 0.3], [-4, -16, -0.2], [10, -12, 0.5], [18, 0, 1.2],
      [12, 14, 2.4], [-2, 18, 3.0], [-16, 10, -1.1],
    ];
    for (const [dx, dz, rot] of layout) {
      cottage(vx + dx, vz + dz, rot, 5.5 + rng() * 2, 4.5 + rng() * 1.5, 3.2 + rng() * 0.8);
    }

    // Well on the green
    const wy = terrainHeight(vx, vz);
    const wellWall = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 1.0, 12), RUIN);
    wellWall.position.set(vx, wy + 0.5, vz);
    wellWall.castShadow = wellWall.receiveShadow = true;
    this.group.add(wellWall);
    this.colliders.push({ type: 'cylinder', x: vx, z: vz, r: 1.3, topY: wy + 1.6, camBlock: false });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.0, 0.14), BEAM);
      post.position.set(vx + sx * 0.95, wy + 2.0, vz);
      post.castShadow = true;
      this.group.add(post);
    }
    const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.8, 4), THATCH);
    wellRoof.rotation.y = Math.PI / 4;
    wellRoof.position.set(vx, wy + 3.3, vz);
    wellRoof.castShadow = true;
    this.group.add(wellRoof);

    // Dock: starts where the shore meets the water and runs out over the lake.
    // Walk the shoreline first so it never ends up buried in the bank.
    let dockZ = vz - 20;
    while (dockZ > vz - 60 && terrainHeight(vx, dockZ) > WATER_LEVEL - 0.3) dockZ -= 1;
    for (let i = 0; i < 9; i++) {
      const pz = dockZ - i * 2.2;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 2.2), PLANK);
      plank.position.set(vx, WATER_LEVEL + 0.55, pz);
      plank.receiveShadow = plank.castShadow = true;
      this.group.add(plank);
      for (const sx of [-1, 1]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.4, 6), BEAM);
        pile.position.set(vx + sx * 1.1, WATER_LEVEL - 1.0, pz);
        this.group.add(pile);
      }
    }
    // Market stalls with striped awnings
    for (const [sx, sz, hue] of [[-8, 2, 0xb44a3a], [6, 4, 0x3a6ab4]]) {
      const px = vx + sx, pz = vz + sz;
      const py = terrainHeight(px, pz);
      const table = this._box(px, py + 0.55, pz, 2.4, 0.15, 1.2, PLANK, false);
      void table;
      for (const cx2 of [-1, 1]) {
        for (const cz2 of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), BEAM);
          post.position.set(px + cx2 * 1.1, py + 1.1, pz + cz2 * 0.55);
          this.group.add(post);
        }
      }
      const awn = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 1.6),
        new THREE.MeshStandardMaterial({ color: hue, roughness: 0.85 }));
      awn.position.set(px, py + 2.25, pz);
      awn.rotation.x = 0.12;
      awn.castShadow = true;
      this.group.add(awn);
    }
  }

  // ---------------- The Sunken Ring ----------------
  buildRuins(rng) {
    const { x: rx, z: rz } = RUINS;
    const ry = terrainHeight(rx, rz);

    // Broken standing stones in a ring, several toppled
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const px = rx + Math.cos(a) * 13;
      const pz = rz + Math.sin(a) * 13;
      const py = terrainHeight(px, pz);
      const h = 2.6 + rng() * 3.4;
      const toppled = rng() < 0.3;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(1.1 + rng() * 0.5, h, 0.7), RUIN);
      if (toppled) {
        stone.rotation.z = (rng() - 0.5) * 2.4;
        stone.rotation.y = a;
        stone.position.set(px, py + 0.4, pz);
      } else {
        stone.rotation.y = a + (rng() - 0.5) * 0.3;
        stone.rotation.z = (rng() - 0.5) * 0.14;
        stone.position.set(px, py + h / 2, pz);
        this.colliders.push({ type: 'cylinder', x: px, z: pz, r: 0.8, topY: py + h, camBlock: false });
      }
      stone.castShadow = stone.receiveShadow = true;
      this.group.add(stone);
      // Moss cap
      const moss = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.18, 0.75), MOSS);
      moss.position.copy(stone.position);
      moss.position.y += toppled ? 0.3 : h / 2;
      moss.rotation.copy(stone.rotation);
      this.group.add(moss);
    }

    // Sunken floor with a rune disc
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, 0.6, 24), RUIN);
    floor.position.set(rx, ry - 0.1, rz);
    floor.receiveShadow = true;
    this.group.add(floor);
    const runeMat = new THREE.MeshStandardMaterial({
      color: 0x2c3040, roughness: 0.5, emissive: 0x4a86ff, emissiveIntensity: 0.0,
    });
    this.runeMat = runeMat;
    const disc = new THREE.Mesh(new THREE.RingGeometry(2.4, 5.6, 32, 1), runeMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(rx, ry + 0.22, rz);
    this.group.add(disc);

    // Four braziers at the cardinal points — the puzzle
    this.braziers = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = rx + Math.cos(a) * 7.2;
      const pz = rz + Math.sin(a) * 7.2;
      const py = terrainHeight(px, pz);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 1.5, 8), BRAZIER);
      stand.position.set(px, py + 0.75, pz);
      stand.castShadow = true;
      this.group.add(stand);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.34, 0.5, 10), BRAZIER);
      bowl.position.set(px, py + 1.7, pz);
      bowl.castShadow = true;
      this.group.add(bowl);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 10),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
      flame.material.color.setRGB(3.4, 1.7, 0.6);
      flame.material.toneMapped = false;
      flame.scale.y = 1.5;
      flame.userData.dynamic = true; // flickers when the brazier is lit
      flame.position.set(px, py + 2.1, pz);
      this.group.add(flame);
      const light = new THREE.PointLight(0xff8a3c, 0, 16, 2);
      light.position.set(px, py + 2.3, pz);
      this.group.add(light);
      this.braziers.push({ x: px, y: py + 1.9, z: pz, lit: false, flame, light });
    }

    // Sealed vault slab in the centre — sinks away when the ring is lit
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.7, 16), RUIN);
    slab.position.set(rx, ry + 0.35, rz);
    slab.castShadow = slab.receiveShadow = true;
    slab.userData.dynamic = true; // sinks away when the ring is solved
    this.group.add(slab);
    this.vaultSlab = slab;
    this.vaultY = ry + 0.35;
    this.vaultOpen = 0;

    // What waits inside: a lore stone and a shard of aether
    const loreMat = new THREE.MeshStandardMaterial({
      color: 0x3a4256, roughness: 0.4, emissive: 0x6ad8ff, emissiveIntensity: 0.6,
    });
    const lore = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.24), loreMat);
    lore.position.set(rx, ry - 1.2, rz);
    lore.castShadow = true;
    lore.userData.dynamic = true; // rises out of the vault
    this.group.add(lore);
    this.loreStone = lore;
    this.loreY = ry - 1.2;

    this.ruinCenter = new THREE.Vector3(rx, ry, rz);
    this.solved = false;
    this.onSolved = null;
  }

  // Fire magic landing near a brazier lights it
  igniteAt(point, radius = 3.2) {
    if (this.solved) return false;
    let changed = false;
    for (const b of this.braziers) {
      if (b.lit) continue;
      const d = Math.hypot(point.x - b.x, point.z - b.z);
      if (d < radius && Math.abs(point.y - b.y) < 4) {
        b.lit = true;
        changed = true;
        this.spells?.spawnBurst(new THREE.Vector3(b.x, b.y + 0.3, b.z), 24, 5, 0xff9a3c);
        this.spells?.audio?.castWhoosh(0.7);
      }
    }
    if (changed && this.braziers.every((b) => b.lit)) {
      this.solved = true;
      this.spells?.onShake?.(0.35);
      this.spells?.audio?.impact(1.2);
      this.onSolved?.();
    }
    return changed;
  }

  setNightAmount(night) {
    if (this.villageWindows) {
      for (const m of this.villageWindows) m.emissiveIntensity = night * 2.2;
    }
  }

  update(dt, elapsed) {
    for (const b of this.braziers) {
      const target = b.lit ? 1 : 0;
      b.flame.material.opacity = THREE.MathUtils.lerp(b.flame.material.opacity, target, 1 - Math.exp(-6 * dt));
      b.light.intensity = THREE.MathUtils.lerp(b.light.intensity, target * (9 + Math.sin(elapsed * 12) * 1.6), 1 - Math.exp(-6 * dt));
      b.flame.scale.set(1, 1.5 + Math.sin(elapsed * 9 + b.x) * 0.18, 1);
    }
    // Rune disc glows as the ring fills, then the vault opens
    const litCount = this.braziers.filter((b) => b.lit).length;
    this.runeMat.emissiveIntensity = THREE.MathUtils.lerp(
      this.runeMat.emissiveIntensity, litCount / 4 * 1.6, 1 - Math.exp(-3 * dt));
    if (this.solved) {
      this.vaultOpen = Math.min(1, this.vaultOpen + dt * 0.6);
      this.vaultSlab.position.y = this.vaultY - this.vaultOpen * 2.4;
      this.vaultSlab.rotation.y = this.vaultOpen * 1.2;
      this.loreStone.position.y = this.loreY + this.vaultOpen * 2.6 + Math.sin(elapsed * 1.4) * 0.08;
      this.loreStone.rotation.y = elapsed * 0.5;
      this.loreStone.material.emissiveIntensity = 0.6 + this.vaultOpen * 1.8;
    }
  }
}
