import * as THREE from 'three';
import { terrainHeight } from './Terrain.js';
import { makeRng } from '../util/noise.js';
import { mergeStatics } from '../util/mergeStatics.js';
import { OPTIMIZED } from '../util/perfFlags.js';

// The Glimmerdeep — a hollow crystal cavern set into the northern foothills.
// Entered through a boulder-framed corridor; inside, glowing crystals light a
// domed chamber holding a warded chest.

const ROCK = new THREE.MeshStandardMaterial({ color: 0x5d574e, roughness: 0.98, flatShading: true });
const ROCK_IN = new THREE.MeshStandardMaterial({
  color: 0x4a453d, roughness: 1.0, flatShading: true, side: THREE.BackSide,
});
const CHEST_WOOD = new THREE.MeshStandardMaterial({ color: 0x5a3f24, roughness: 0.85 });
const CHEST_IRON = new THREE.MeshStandardMaterial({ color: 0x3a352e, roughness: 0.5, metalness: 0.7 });

export const CAVERN = { x: -60, z: -300, r: 15 };

export class Cavern {
  constructor(scene) {
    this.group = new THREE.Group();
    this.colliders = [];
    const rng = makeRng(4242424);
    const { x: cx, z: cz, r } = CAVERN;
    const floorY = terrainHeight(cx, cz);
    this.floorY = floorY;

    // Entrance faces south (+z) — a gap in the chamber wall
    const gapHalf = 0.22; // radians either side of +z
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 11, 32, 1, true, gapHalf, Math.PI * 2 - gapHalf * 2),
      ROCK_IN);
    wall.position.set(cx, floorY + 5.5, cz);
    wall.receiveShadow = true;
    this.group.add(wall);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), ROCK_IN);
    dome.position.set(cx, floorY + 11, cz);
    this.group.add(dome);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(r, 32), ROCK);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, floorY + 0.05, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    // Wall colliders: a ring of posts, skipping the entrance arc
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      // Entrance sits at angle 0 in cylinder space, which maps to +z
      const toGap = Math.min(Math.abs(a), Math.PI * 2 - Math.abs(a));
      if (toGap < 0.34) continue;
      const px = cx + Math.sin(a) * (r + 0.5);
      const pz = cz + Math.cos(a) * (r + 0.5);
      this.colliders.push({ type: 'cylinder', x: px, z: pz, r: 1.6, topY: floorY + 11 });
    }

    // Exterior: overlapping boulders so it reads as a hill from outside
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const toGap = Math.min(Math.abs(a - Math.PI / 2), Math.PI * 2 - Math.abs(a - Math.PI / 2));
      const rad = r + 2.5 + rng() * 3;
      const px = cx + Math.cos(a) * rad;
      const pz = cz + Math.sin(a) * rad;
      if (toGap < 0.5 && pz > cz) continue; // keep the doorway clear
      const s = 3.5 + rng() * 4;
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), ROCK);
      b.position.set(px, terrainHeight(px, pz) + s * 0.35 + rng() * 2, pz);
      b.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      b.castShadow = b.receiveShadow = true;
      this.group.add(b);
    }
    // Capstone boulders across the dome
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const rad = rng() * r * 0.7;
      const s = 5 + rng() * 4;
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), ROCK);
      b.position.set(cx + Math.cos(a) * rad, floorY + 11 + s * 0.3, cz + Math.sin(a) * rad);
      b.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      b.castShadow = true;
      this.group.add(b);
    }

    // Entrance corridor: two flanking walls + lintel
    const eZ = cz + r;
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.6, 6, 9), ROCK);
      w.position.set(cx + sx * 3.0, floorY + 3, eZ + 4);
      w.castShadow = w.receiveShadow = true;
      this.group.add(w);
      const box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(cx + sx * 3.0, floorY + 3, eZ + 4), new THREE.Vector3(1.6, 6, 9));
      this.colliders.push({ type: 'box', box });
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.6, 1.6, 9), ROCK);
    lintel.position.set(cx, floorY + 6.6, eZ + 4);
    lintel.castShadow = true;
    this.group.add(lintel);

    // Crystals and chest hang off one switch — invisible from outside the
    // hill, so there is no reason to submit them from across the map.
    this.dressing = new THREE.Group();
    this.dressing.userData.dynamic = true;
    this.group.add(this.dressing);

    // ---- Glowing crystals ----
    this.crystals = [];
    const crystalGeo = new THREE.OctahedronGeometry(1, 0);
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2;
      const rad = 4 + rng() * (r - 5);
      const px = cx + Math.cos(a) * rad;
      const pz = cz + Math.sin(a) * rad;
      const hue = rng() < 0.6 ? 0x6ad8ff : 0xb07aff;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x223448, roughness: 0.12, metalness: 0.3,
        emissive: hue, emissiveIntensity: 2.2, transparent: true, opacity: 0.9,
      });
      const s = 0.5 + rng() * 1.4;
      const c = new THREE.Mesh(crystalGeo, mat);
      c.scale.set(s * 0.5, s * (1.6 + rng()), s * 0.5);
      c.position.set(px, floorY + s * 0.8, pz);
      c.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
      c.castShadow = true;
      this.dressing.add(c);
      this.crystals.push({ mesh: c, mat, phase: rng() * 6.28 });
      // A few carry real lights
      if (i % 4 === 0) {
        const l = new THREE.PointLight(hue, 6, 18, 2);
        l.position.set(px, floorY + 2.2, pz);
        this.dressing.add(l);
        this.crystals[this.crystals.length - 1].light = l;
      }
    }
    // Ceiling shards hanging down — one shared material so they batch
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x223448, roughness: 0.15, emissive: 0x6ad8ff, emissiveIntensity: 1.4,
    });
    for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2;
      const rad = rng() * (r - 3);
      const s = 0.4 + rng() * 0.9;
      const c = new THREE.Mesh(crystalGeo, shardMat);
      c.scale.set(s * 0.4, s * 2.2, s * 0.4);
      c.position.set(cx + Math.cos(a) * rad, floorY + 9.5 - rng() * 1.5, cz + Math.sin(a) * rad);
      c.rotation.x = Math.PI;
      this.group.add(c);
    }

    // ---- Warded chest at the back of the chamber ----
    const chestX = cx, chestZ = cz - r * 0.6;
    const chest = new THREE.Group();
    chest.position.set(chestX, floorY, chestZ);
    chest.rotation.y = Math.PI;
    this.dressing.add(chest);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.0), CHEST_WOOD);
    base.position.y = 0.45;
    base.castShadow = base.receiveShadow = true;
    chest.add(base);
    this.chestLid = new THREE.Group();
    this.chestLid.userData.dynamic = true; // rotates open
    this.chestLid.position.set(0, 0.9, -0.5);
    chest.add(this.chestLid);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.35, 1.05), CHEST_WOOD);
    lid.position.z = 0.5;
    lid.castShadow = true;
    this.chestLid.add(lid);
    for (const bx of [-0.55, 0.55]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 1.06), CHEST_IRON);
      band.position.set(bx, 0.45, 0);
      chest.add(band);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.14), CHEST_IRON);
    lock.position.set(0, 0.85, 0.53);
    chest.add(lock);
    this.chestGlow = new THREE.PointLight(0xffd27a, 0, 8, 2);
    this.chestGlow.position.set(chestX, floorY + 1.2, chestZ);
    this.dressing.add(this.chestGlow);
    this.chestPos = new THREE.Vector3(chestX, floorY, chestZ);
    this.chestOpen = 0;
    this.looted = false;
    this.colliders.push({ type: 'cylinder', x: chestX, z: chestZ, r: 1.0, topY: floorY + 1.2, camBlock: false });

    this.center = new THREE.Vector3(cx, floorY, cz);
    // Rock shell, chest body and ceiling shards are fixed — batch them
    this.mergeStats = mergeStatics(this.group, { cellSize: 1e6 });
    scene.add(this.group);
  }

  isInside(pos) {
    const d = Math.hypot(pos.x - this.center.x, pos.z - this.center.z);
    return d < CAVERN.r + 2 && pos.y < this.floorY + 11 && pos.y > this.floorY - 3;
  }

  open() {
    if (this.looted) return false;
    this.looted = true;
    return true;
  }

  update(dt, elapsed, playerPos = null) {
    if (playerPos && OPTIMIZED) {
      // The crystals and the chest are only ever seen from inside the hill
      const near = playerPos.distanceToSquared(this.center) < 130 * 130;
      if (this.dressing.visible !== near) this.dressing.visible = near;
      if (!near) return;
    }
    for (const c of this.crystals) {
      const pulse = 1.9 + Math.sin(elapsed * 1.4 + c.phase) * 0.5;
      c.mat.emissiveIntensity = pulse;
      if (c.light) c.light.intensity = 4.5 + Math.sin(elapsed * 1.4 + c.phase) * 1.5;
    }
    if (this.looted) {
      this.chestOpen = Math.min(1, this.chestOpen + dt * 1.6);
      this.chestLid.rotation.x = -this.chestOpen * 1.9;
      this.chestGlow.intensity = (1 - this.chestOpen) * 14;
    } else {
      // Faint pulse marks it as interactable
      this.chestGlow.intensity = 2.5 + Math.sin(elapsed * 2.6) * 1.2;
    }
  }
}
