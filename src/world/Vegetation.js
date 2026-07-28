import * as THREE from 'three';
import { terrainHeight, WATER_LEVEL, CASTLE_PLATEAU, LAKE, distanceToPath } from './Terrain.js';
import { makeRng, fbm2D } from '../util/noise.js';
import { opt } from '../util/perfFlags.js';

// Instanced pines + broadleaf trees + wind-animated grass around the academy.

function canPlace(x, z) {
  const h = terrainHeight(x, z);
  if (h < WATER_LEVEL + 1.2 || h > 55) return false; // keep trees off mountain flanks
  const slope = Math.abs(terrainHeight(x + 2, z) - h) + Math.abs(terrainHeight(x, z + 2) - h);
  if (slope > 2.2) return false;
  const dCastle = Math.hypot(x - CASTLE_PLATEAU.x, z - CASTLE_PLATEAU.z);
  if (dCastle < CASTLE_PLATEAU.radius + 12) return false;
  const dLake = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dLake < LAKE.radius * 0.55) return false;
  return true;
}

export class Vegetation {
  constructor(scene, buildingRects = [], clearings = []) {
    this.buildingRects = buildingRects;
    this.clearings = clearings;
    const inClearing = (x, z) =>
      clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
    this.group = new THREE.Group();
    const rng = makeRng(4242);

    // ---- Pine trees ----
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 3.2, 6);
    trunkGeo.translate(0, 1.6, 0);
    const pineGeo = new THREE.ConeGeometry(2.0, 5.4, 7);
    pineGeo.translate(0, 5.6, 0);
    const pineGeo2 = new THREE.ConeGeometry(1.5, 4.2, 7);
    pineGeo2.translate(0, 7.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2d4a28, roughness: 0.9 });

    // ---- Broadleaf ----
    const leafGeo = new THREE.IcosahedronGeometry(2.4, 1);
    leafGeo.translate(0, 4.6, 0);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6631, roughness: 0.9, flatShading: true });
    const bTrunkGeo = new THREE.CylinderGeometry(0.22, 0.4, 3.6, 6);
    bTrunkGeo.translate(0, 1.8, 0);

    const MAX_TREES = 900;
    const pinePositions = [];
    const leafPositions = [];
    let attempts = 0;
    while (pinePositions.length + leafPositions.length < MAX_TREES && attempts < MAX_TREES * 12) {
      attempts++;
      const x = (rng() - 0.5) * 900;
      const z = (rng() - 0.5) * 900;
      if (!canPlace(x, z)) continue;
      if (distanceToPath(x, z) < 4) continue; // trees stay off the walkway
      if (inClearing(x, z)) continue;         // village green and ruin circle
      // Forest density mask: clumpy noise
      const density = fbm2D(x * 0.008, z * 0.008, { octaves: 3, seed: 77 });
      if (rng() > density * 1.25) continue;
      const h = terrainHeight(x, z);
      const s = 0.7 + rng() * 0.9;
      const entry = { x, y: h - 0.15, z, s, rot: rng() * Math.PI * 2 };
      if (fbm2D(x * 0.005, z * 0.005, { octaves: 2, seed: 99 }) > 0.52) pinePositions.push(entry);
      else leafPositions.push(entry);
    }

    const buildInstanced = (geo, mat, list) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        e.set(0, p.rot, 0);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
        mesh.setMatrixAt(i, m);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    // Full-detail trees, plus a cheap silhouette set used past the LOD line.
    // Both hold every instance; we swap visibility rather than rebuild.
    this.treeLodNear = [
      buildInstanced(trunkGeo, trunkMat, pinePositions),
      buildInstanced(pineGeo, pineMat, pinePositions),
      buildInstanced(pineGeo2, pineMat, pinePositions),
      buildInstanced(bTrunkGeo, trunkMat, leafPositions),
      buildInstanced(leafGeo, leafMat, leafPositions),
    ];
    const pineFar = new THREE.ConeGeometry(2.0, 9.0, 5);
    pineFar.translate(0, 5.0, 0);
    const leafFar = new THREE.IcosahedronGeometry(2.4, 0);
    leafFar.translate(0, 4.6, 0);
    this.treeLodFar = [
      buildInstanced(pineFar, pineMat, pinePositions),
      buildInstanced(leafFar, leafMat, leafPositions),
    ];
    for (const m of this.treeLodFar) {
      m.visible = false;
      m.castShadow = false; // distant trees stop paying for shadows
    }

    // Tree collision (cylinders, trunk only)
    // camBlock:false — thin trunks never obstruct the camera, only movement
    this.colliders = [...pinePositions, ...leafPositions].map((p) => ({
      type: 'cylinder', x: p.x, z: p.z, r: 0.45 * p.s, topY: p.y + 8 * p.s, camBlock: false,
    }));

    // ---- Grass: thin tapered blades (crossed), vertex-shader wind ----
    const GRASS_COUNT = opt(24000, 34000);
    const blade = (w, h) => {
      // Tapered triangle-ish blade: 4 verts, dark at root, light at tip
      const g = new THREE.BufferGeometry();
      const verts = new Float32Array([
        -w / 2, 0, 0,  w / 2, 0, 0,  -w / 6, h, 0,  w / 6, h, 0,
      ]);
      const idx = [0, 1, 2, 2, 1, 3];
      const cols = new Float32Array([
        0.55, 0.62, 0.4,  0.55, 0.62, 0.4,  1.05, 1.1, 0.85,  1.05, 1.1, 0.85,
      ]);
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    // Clump of 5 blades at varied angles/heights — one instance = one tuft
    const grassGeo = (() => {
      const parts = [];
      const clumpRng = makeRng(555);
      for (let i = 0; i < 5; i++) {
        const b = blade(0.07 + clumpRng() * 0.04, 0.4 + clumpRng() * 0.45);
        b.rotateZ((clumpRng() - 0.5) * 0.5);
        b.rotateY(clumpRng() * Math.PI * 2);
        b.translate((clumpRng() - 0.5) * 0.22, 0, (clumpRng() - 0.5) * 0.22);
        parts.push(b);
      }
      const g = new THREE.BufferGeometry();
      let vCount = 0, posArr = [], colArr = [], idxArr = [];
      for (const b of parts) {
        posArr.push(...b.attributes.position.array);
        colArr.push(...b.attributes.color.array);
        idxArr.push(...[...b.index.array].map((ix) => ix + vCount));
        vCount += b.attributes.position.count;
      }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colArr), 3));
      g.setIndex(idxArr);
      g.computeVertexNormals();
      return g;
    })();
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x6fa844, roughness: 0.85, side: THREE.DoubleSide, vertexColors: true,
    });
    grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uSnow = { value: 0 };
      this._grassShader = shader;
      // Snow settles on the blades too, or the ground stays green in a blizzard
      shader.fragmentShader = 'uniform float uSnow;\n' + shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.99), uSnow * 0.85);`
      );
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wpos = instanceMatrix * vec4(transformed, 1.0);
          float sway = sin(uTime * 1.8 + wpos.x * 0.35 + wpos.z * 0.5) * 0.14;
          transformed.x += sway * position.y * 1.4;
          transformed.z += sway * position.y * 0.8;
        }`
      );
    };
    // Grass lives in a wrap-around box that follows the player: tufts that
    // drift outside the box get wrapped to the far side and revalidated, so
    // the whole world reads vegetated at constant instance cost.
    // The box is deliberately smaller than it looks like it should be: the old
    // 250m one spent a third of its blades past 100m, where a tuft is under a
    // pixel, and it can't be frustum-culled. Pulling it in raises the density
    // where you can actually see it while cutting the triangle count.
    this.GRASS_BOX = opt(170, 250);
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    this.grassData = new Float32Array(GRASS_COUNT * 4); // x, z, yaw, scale
    for (let gi = 0; gi < GRASS_COUNT; gi++) {
      this.grassData[gi * 4] = 21 + (rng() - 0.5) * this.GRASS_BOX;
      this.grassData[gi * 4 + 1] = 37 + (rng() - 0.5) * this.GRASS_BOX;
      this.grassData[gi * 4 + 2] = rng() * Math.PI;
      this.grassData[gi * 4 + 3] = 0.7 + rng() * 0.8;
      this._placeGrass(grass, gi, m, q, e);
      col.setHSL(0.23 + rng() * 0.07, 0.5 + rng() * 0.25, 0.55 + rng() * 0.3);
      grass.setColorAt(gi, col);
    }
    grass.receiveShadow = true;
    grass.frustumCulled = false;
    this.group.add(grass);
    this.grass = grass;
    this._grassCursor = 0;
    this._gm = m; this._gq = q; this._ge = e;

    // ---- Rocks: flattened dodecahedra, three sizes, on slopes and meadows ----
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.95, flatShading: true });
    const rockGeos = [0.5, 1.1, 2.2].map((s) => {
      const gRock = new THREE.DodecahedronGeometry(s, 0);
      gRock.scale(1, 0.62, 1);
      return gRock;
    });
    const rockLists = [[], [], []];
    for (let i = 0; i < 900; i++) {
      const x = (rng() - 0.5) * 1000;
      const z = (rng() - 0.5) * 1000;
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL - 1 || h > 110) continue;
      if (distanceToPath(x, z) < 3) continue;
      if (Math.hypot(x - CASTLE_PLATEAU.x - 2, z - CASTLE_PLATEAU.z - 8) < 40) continue;
      if (inClearing(x, z)) continue;
      const slope = Math.abs(terrainHeight(x + 2, z) - h) + Math.abs(terrainHeight(x, z + 2) - h);
      // Rocks favor slopes and shoreline
      const shoreBonus = Math.abs(h - WATER_LEVEL) < 3 ? 0.35 : 0;
      if (rng() > 0.1 + slope * 0.22 + shoreBonus) continue;
      const size = rng() < 0.6 ? 0 : rng() < 0.8 ? 1 : 2;
      rockLists[size].push({ x, y: h - 0.2, z, s: 0.6 + rng() * 1.1, rot: rng() * Math.PI * 2 });
    }
    rockGeos.forEach((gRock, i) => buildInstanced(gRock, rockMat, rockLists[i]));

    // ---- Flowers: bright quad heads on thin stems, meadow patches ----
    const FLOWER_COUNT = 2600;
    // Head quad + thin stem quad merged, with vertex colors marking the stem
    const flowerGeo = (() => {
      const head = new THREE.PlaneGeometry(0.16, 0.16);
      head.translate(0, 0.34, 0);
      const stem = new THREE.PlaneGeometry(0.025, 0.34);
      stem.translate(0, 0.17, 0);
      const g = new THREE.BufferGeometry();
      const hp = head.attributes.position.array, sp = stem.attributes.position.array;
      const pos = new Float32Array(hp.length + sp.length);
      pos.set(hp); pos.set(sp, hp.length);
      // Head vertices stay white (instance color shows); stem vertices go green
      const col = new Float32Array((hp.length / 3 + sp.length / 3) * 3);
      col.fill(1);
      for (let i = hp.length / 3; i < col.length / 3; i++) {
        col[i * 3] = 0.25; col[i * 3 + 1] = 0.5; col[i * 3 + 2] = 0.2;
      }
      const idx = [...head.index.array, ...[...stem.index.array].map((i) => i + hp.length / 3)];
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    })();
    const flowerMat = new THREE.MeshStandardMaterial({
      vertexColors: true, side: THREE.DoubleSide, roughness: 0.7, color: 0xffffff,
    });
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, FLOWER_COUNT);
    const fCol = new THREE.Color();
    const fPalette = [0xf5f0e0, 0xf7d54a, 0xb07ae0, 0xe07a9a, 0x8ab6f0];
    let fi = 0, fa = 0;
    while (fi < FLOWER_COUNT && fa < FLOWER_COUNT * 10) {
      fa++;
      const cxp = (rng() - 0.5) * 600;
      const czp = (rng() - 0.5) * 600;
      // Patchiness: flowers cluster
      if (fbm2D(cxp * 0.02, czp * 0.02, { octaves: 2, seed: 171 }) < 0.55) continue;
      const h = terrainHeight(cxp, czp);
      if (h < WATER_LEVEL + 0.6 || h > 55) continue;
      if (distanceToPath(cxp, czp) < 1.8) continue;
      if (Math.hypot(cxp - CASTLE_PLATEAU.x - 2, czp - CASTLE_PLATEAU.z - 8) < 40) continue;
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      const s = 0.8 + rng() * 0.6;
      m.compose(new THREE.Vector3(cxp, h, czp), q, new THREE.Vector3(s, s, s));
      flowers.setMatrixAt(fi, m);
      fCol.set(fPalette[Math.floor(rng() * fPalette.length)]);
      flowers.setColorAt(fi, fCol);
      fi++;
    }
    flowers.count = fi;
    this.group.add(flowers);

    scene.add(this.group);
  }

  insideBuilding(x, z) {
    for (const r of this.buildingRects) {
      if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return true;
    }
    return false;
  }

  // Compose one tuft's matrix from grassData; invalid spots collapse to zero scale.
  _placeGrass(grass, gi, m, q, e) {
    const x = this.grassData[gi * 4], z = this.grassData[gi * 4 + 1];
    const yaw = this.grassData[gi * 4 + 2], s = this.grassData[gi * 4 + 3];
    const h = terrainHeight(x, z);
    let scale = s;
    if (h < WATER_LEVEL + 0.6 || h > 70 || distanceToPath(x, z) < 2.2 ||
        Math.hypot(x - CASTLE_PLATEAU.x - 2, z - CASTLE_PLATEAU.z - 8) < 39 ||
        this.insideBuilding(x, z) ||
        Math.abs(terrainHeight(x + 2, z) - h) + Math.abs(terrainHeight(x, z + 2) - h) > 2.0) {
      scale = 0.0001;
    }
    e.set(0, yaw, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(scale, scale, scale));
    grass.setMatrixAt(gi, m);
  }

  setSnow(s) {
    if (this._grassShader) this._grassShader.uniforms.uSnow.value = s;
  }

  // Quality governor: fraction of grass tufts drawn, and which tree LOD is up
  setQuality({ grass = 1, lowDetailTrees = false } = {}) {
    if (this.grass) this.grass.count = Math.floor(this.grassData.length / 4 * grass);
    if (this.treeLodNear && this._lowTrees !== lowDetailTrees) {
      this._lowTrees = lowDetailTrees;
      for (const m of this.treeLodNear) m.visible = !lowDetailTrees;
      for (const m of this.treeLodFar) m.visible = lowDetailTrees;
    }
  }

  update(dt, elapsed, playerPos = null) {
    if (this._grassShader) this._grassShader.uniforms.uTime.value = elapsed;
    if (!playerPos || !this.grass) return;
    // Round-robin: wrap tufts that fell outside the follow box (toroidal shift)
    const B = this.GRASS_BOX, half = B / 2;
    const N = this.grass.count;
    const BATCH = 1500;
    let dirty = false;
    for (let k = 0; k < BATCH; k++) {
      const gi = this._grassCursor;
      this._grassCursor = (this._grassCursor + 1) % N;
      let x = this.grassData[gi * 4], z = this.grassData[gi * 4 + 1];
      let moved = false;
      while (x - playerPos.x > half) { x -= B; moved = true; }
      while (x - playerPos.x < -half) { x += B; moved = true; }
      while (z - playerPos.z > half) { z -= B; moved = true; }
      while (z - playerPos.z < -half) { z += B; moved = true; }
      if (moved) {
        this.grassData[gi * 4] = x;
        this.grassData[gi * 4 + 1] = z;
        this._placeGrass(this.grass, gi, this._gm, this._gq, this._ge);
        dirty = true;
      }
    }
    if (dirty) this.grass.instanceMatrix.needsUpdate = true;
  }
}
