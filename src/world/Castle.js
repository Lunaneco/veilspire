import * as THREE from 'three';
import { terrainHeight, CASTLE_PLATEAU } from './Terrain.js';
import { makeRng } from '../util/noise.js';
import { mergeStatics } from '../util/mergeStatics.js';
import { OPTIMIZED } from '../util/perfFlags.js';

// The Academy of Veilspire: keep cluster with corner turrets and spire,
// curtain-wall ring with a south gatehouse, great hall, astronomy tower,
// banners, framed windows, courtyard lamps. Exposes collision primitives.

// Stone materials get world-space noise so large surfaces never read flat.
function addStoneDetail(mat, scale = 0.35, amount = 0.16) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vWorldPos3;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vWorldPos3 = (modelMatrix * instanceMatrixMaybe(vec4(transformed, 1.0))).xyz;`
    ).replace(
      'void main() {',
      `vec4 instanceMatrixMaybe(vec4 p) {
        #ifdef USE_INSTANCING
          return instanceMatrix * p;
        #else
          return p;
        #endif
      }
      void main() {`
    );
    shader.fragmentShader = `varying vec3 vWorldPos3;
float scHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float scNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(scHash(i), scHash(i + vec2(1.0, 0.0)), u.x),
             mix(scHash(i + vec2(0.0, 1.0)), scHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
` + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        vec3 sp = vWorldPos3 * ${scale.toFixed(3)};
        float v = (scNoise(sp.xy + sp.z) * 0.55 + scNoise(sp.yz * 1.7 + sp.x) * 0.45 - 0.5) * ${amount.toFixed(3)};
        diffuseColor.rgb *= (1.0 + v);
      }`
    );
  };
  return mat;
}

const STONE = addStoneDetail(new THREE.MeshStandardMaterial({ color: 0x9a9287, roughness: 0.88, metalness: 0.02 }));
const STONE_DARK = addStoneDetail(new THREE.MeshStandardMaterial({ color: 0x746c62, roughness: 0.92 }));
const ROOF = new THREE.MeshStandardMaterial({ color: 0x3d5068, roughness: 0.55, metalness: 0.12 });
const BANNER = new THREE.MeshStandardMaterial({ color: 0x7a1f2b, roughness: 0.75, side: THREE.DoubleSide });
const BANNER_TRIM = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
const WINDOW_MAT = new THREE.MeshStandardMaterial({
  color: 0x2b3a52, roughness: 0.12, metalness: 0.6,
  emissive: 0xffb43c, emissiveIntensity: 0.0,
});
const FRAME_MAT = addStoneDetail(new THREE.MeshStandardMaterial({ color: 0x847c70, roughness: 0.9 }));
const LAMP_MAT = new THREE.MeshStandardMaterial({ color: 0x2c2a26, roughness: 0.7, metalness: 0.5 });
const LAMP_GLOW = new THREE.MeshBasicMaterial({ color: 0xffc86a });
LAMP_GLOW.toneMapped = false;

export class Castle {
  constructor(scene) {
    this.group = new THREE.Group();
    this.colliders = [];
    const { x: cx, z: cz } = CASTLE_PLATEAU;
    const rng = makeRng(1337);
    const windows = [];

    const addBoxCollider = (x, y, z, w, h, d, camBlock = true) => {
      const box = new THREE.Box3();
      box.setFromCenterAndSize(new THREE.Vector3(x, y, z), new THREE.Vector3(w, h, d));
      this.colliders.push({ type: 'box', box, camBlock });
    };

    // ---------- tower builder ----------
    const addTower = (x, z, radius, height, opts = {}) => {
      const { sides = 12, roofH = radius * 2.2, roofType = 'cone', windowsOn = true, rim = true } = opts;
      const y = terrainHeight(x, z);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.1, height, sides), STONE);
      tower.position.set(x, y + height / 2, z);
      tower.castShadow = tower.receiveShadow = true;
      this.group.add(tower);

      if (rim) {
        const rimM = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.16, radius * 1.05, radius * 0.4, sides), STONE_DARK);
        rimM.position.set(x, y + height - radius * 0.1, z);
        rimM.castShadow = true;
        this.group.add(rimM);
      }
      if (roofType === 'cone') {
        const roof = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.2, roofH, sides), ROOF);
        roof.position.set(x, y + height + roofH / 2, z);
        roof.castShadow = true;
        this.group.add(roof);
      } else if (roofType === 'dome') {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), ROOF);
        dome.position.set(x, y + height, z);
        dome.castShadow = true;
        this.group.add(dome);
      }
      if (windowsOn) {
        const levels = Math.max(2, Math.floor(height / 10));
        for (let l = 1; l <= levels; l++) {
          const wy = y + (height * l) / (levels + 1);
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + l * 0.5;
            windows.push({
              x: x + Math.cos(a) * (radius + 0.09), y: wy, z: z + Math.sin(a) * (radius + 0.09),
              ry: -a + Math.PI / 2, w: 0.85, h: 1.7,
            });
          }
        }
      }
      this.colliders.push({ type: 'cylinder', x, z, r: radius + 0.4, topY: y + height + roofH });
      return { x, z, y, radius, height };
    };

    // ---------- wall builder ----------
    const addWall = (ax, az, bx, bz, h = 10, thick = 2.6) => {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      const y = Math.max(terrainHeight(ax, az), terrainHeight(bx, bz));
      const yaw = -Math.atan2(dz, dx);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, h, thick), STONE);
      wall.position.set((ax + bx) / 2, y + h / 2, (az + bz) / 2);
      wall.rotation.y = yaw;
      wall.castShadow = wall.receiveShadow = true;
      this.group.add(wall);
      // walkway cap
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, thick + 0.7), STONE_DARK);
      cap.position.set((ax + bx) / 2, y + h + 0.25, (az + bz) / 2);
      cap.rotation.y = yaw;
      cap.castShadow = true;
      this.group.add(cap);
      // merlons
      const count = Math.floor(len / 2.6);
      const mGeo = new THREE.BoxGeometry(1.3, 1.2, 0.5);
      const merlons = new THREE.InstancedMesh(mGeo, STONE_DARK, count * 2);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
      const nx = -dz / len, nz = dx / len;
      let mi = 0;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        for (const side of [-1, 1]) {
          m.compose(new THREE.Vector3(
            ax + dx * t + nx * side * (thick / 2 + 0.2),
            y + h + 1.1,
            az + dz * t + nz * side * (thick / 2 + 0.2)),
            q, new THREE.Vector3(1, 1, 1));
          merlons.setMatrixAt(mi++, m);
        }
      }
      merlons.castShadow = true;
      merlons.frustumCulled = false;
      this.group.add(merlons);
      addBoxCollider((ax + bx) / 2, y + h / 2, (az + bz) / 2, Math.abs(dx) + thick, h, Math.abs(dz) + thick);
    };

    // ---------- keep cluster ----------
    const keepX = cx - 2, keepZ = cz - 16;
    const keepY = terrainHeight(keepX, keepZ);
    const keepR = 13, keepH = 50;
    addTower(keepX, keepZ, keepR, keepH, { sides: 16, roofH: 20 });
    // spire on top of keep roof
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.2, 16, 8), ROOF);
    spire.position.set(keepX, keepY + keepH + 20 + 6, keepZ);
    spire.castShadow = true;
    this.group.add(spire);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), BANNER_TRIM);
    finial.position.set(keepX, keepY + keepH + 34.5, keepZ);
    this.group.add(finial);
    // corner turrets hugging the keep
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      addTower(keepX + Math.cos(a) * (keepR + 2.5), keepZ + Math.sin(a) * (keepR + 2.5), 3.8, keepH + 8,
        { sides: 8, roofH: 9, windowsOn: i % 2 === 0 });
    }

    // ---------- great hall (west of courtyard) — hollow, walkable ----------
    const hallX = cx - 30, hallZ = cz - 2;
    const hallY = terrainHeight(hallX, hallZ);
    const hallW = 18, hallH = 17, hallD = 34;
    const wallT = 1.2;
    const doorW = 3.2, doorH = 5.0;
    // Footprints where vegetation must not grow (published to Vegetation)
    this.buildingRects = [{
      minX: hallX - hallW / 2 - 1, maxX: hallX + hallW / 2 + 1,
      minZ: hallZ - hallD / 2 - 1, maxZ: hallZ + hallD / 2 + 1,
    }];
    this.hallBounds = {
      minX: hallX - hallW / 2, maxX: hallX + hallW / 2,
      minZ: hallZ - hallD / 2, maxZ: hallZ + hallD / 2,
      y: hallY, h: hallH,
    };
    const wall = (wx, wy, wz, ww, wh, wd) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, wd), STONE);
      w.position.set(wx, wy, wz);
      w.castShadow = w.receiveShadow = true;
      this.group.add(w);
      addBoxCollider(wx, wy, wz, ww, wh, wd);
    };
    // West wall, north/south gables
    wall(hallX - hallW / 2 + wallT / 2, hallY + hallH / 2, hallZ, wallT, hallH, hallD);
    wall(hallX, hallY + hallH / 2, hallZ - hallD / 2 + wallT / 2, hallW, hallH, wallT);
    wall(hallX, hallY + hallH / 2, hallZ + hallD / 2 - wallT / 2, hallW, hallH, wallT);
    // East wall split around the door
    const eX = hallX + hallW / 2 - wallT / 2;
    const segD = (hallD - doorW) / 2;
    wall(eX, hallY + hallH / 2, hallZ - doorW / 2 - segD / 2, wallT, hallH, segD);
    wall(eX, hallY + hallH / 2, hallZ + doorW / 2 + segD / 2, wallT, hallH, segD);
    // Lintel above the door
    wall(eX, hallY + doorH + (hallH - doorH) / 2, hallZ, wallT, hallH - doorH, doorW);
    // Floor + ceiling
    const wood = addStoneDetail(new THREE.MeshStandardMaterial({ color: 0x6a5138, roughness: 0.8 }), 0.9, 0.22);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(hallW, 0.3, hallD), wood);
    floor.position.set(hallX, hallY + 0.15, hallZ);
    floor.receiveShadow = true;
    this.group.add(floor);
    // Timber ceiling — warm surface so candlelight reads on it
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(hallW, 0.4, hallD), wood);
    ceil.position.set(hallX, hallY + hallH - 0.2, hallZ);
    this.group.add(ceil);

    // Long tables + benches (seats are published for NPC lesson behaviour)
    this.hallSeats = [];
    // Each side has two table halves with a cross-aisle at the door line, so
    // people entering can actually reach the central aisle.
    const tblLen = hallD * 0.32, tblOff = hallD * 0.22;
    for (const tz of [-1, 1]) {
      for (const half of [-1, 1]) {
        const tx = hallX + tz * 3.4;
        const tcz = hallZ + half * tblOff;
        const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, tblLen), wood);
        table.position.set(tx, hallY + 0.75, tcz);
        table.castShadow = table.receiveShadow = true;
        this.group.add(table);
        addBoxCollider(tx, hallY + 0.75, tcz, 2.2, 0.9, tblLen, false);
        for (const bz of [-1, 1]) {
          const bx = tx + bz * 1.9;
          const bench = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, tblLen * 0.92), wood);
          bench.position.set(bx, hallY + 0.45, tcz);
          bench.castShadow = true;
          this.group.add(bench);
          // Seats face the table this bench serves
          const faceYaw = bz < 0 ? Math.PI / 2 : -Math.PI / 2;
          for (let s = 0; s < 3; s++) {
            const sz = tcz - tblLen * 0.32 + s * (tblLen * 0.64) / 2;
            // Inner benches border the central aisle and are reachable; outer
            // benches sit behind the tables, so NPC routing skips them.
            this.hallSeats.push({
              x: bx, y: hallY + 0.675, z: sz, facing: faceYaw,
              inner: Math.abs(bx - hallX) < 2.5,
            });
          }
        }
      }
    }

    // Table settings: goblets, plates, stacked books — instanced
    {
      const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.35, metalness: 0.75 });
      const pewter = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.6 });
      const bookMat = new THREE.MeshStandardMaterial({ color: 0x6b2f2f, roughness: 0.85 });
      const gobletGeo = new THREE.CylinderGeometry(0.055, 0.075, 0.17, 8);
      const plateGeo = new THREE.CylinderGeometry(0.15, 0.13, 0.03, 12);
      const bookGeo = new THREE.BoxGeometry(0.26, 0.07, 0.19);
      const settings = [];
      const rngT = makeRng(777);
      for (const tSide of [-1, 1]) {
        for (let i = 0; i < 11; i++) {
          const z = hallZ - hallD * 0.28 + i * (hallD * 0.56) / 10;
          if (Math.abs(z - hallZ) < 4.4) continue; // cross-aisle gap has no table
          for (const seat of [-1, 1]) {
            settings.push({
              x: hallX + tSide * 3.4 + seat * 0.62 + (rngT() - 0.5) * 0.12,
              z: z + (rngT() - 0.5) * 0.3,
              rot: rngT() * Math.PI * 2,
              kind: rngT(),
            });
          }
        }
      }
      const mk = (geo, mat, yOff, filter) => {
        const list = settings.filter(filter);
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        const mm = new THREE.Matrix4();
        const qq = new THREE.Quaternion();
        const ee = new THREE.Euler();
        list.forEach((s, i) => {
          ee.set(0, s.rot, 0);
          qq.setFromEuler(ee);
          mm.compose(new THREE.Vector3(s.x, hallY + 1.2 + yOff, s.z), qq, new THREE.Vector3(1, 1, 1));
          im.setMatrixAt(i, mm);
        });
        im.castShadow = true;
        im.frustumCulled = false;
        this.group.add(im);
      };
      mk(gobletGeo, brass, 0.085, (s) => s.kind < 0.45);
      mk(plateGeo, pewter, 0.015, (s) => s.kind >= 0.45 && s.kind < 0.8);
      mk(bookGeo, bookMat, 0.035, (s) => s.kind >= 0.8);
    }

    // Fireplace on the west wall
    const hearth = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4.2, 5), STONE_DARK);
    hearth.position.set(hallX - hallW / 2 + wallT + 0.4, hallY + 2.1, hallZ);
    this.group.add(hearth);
    const fireGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.85 }));
    fireGlow.material.toneMapped = false;
    fireGlow.rotation.y = Math.PI / 2;
    fireGlow.position.set(hallX - hallW / 2 + wallT + 0.85, hallY + 1.3, hallZ);
    this.group.add(fireGlow);
    this.fireLight = new THREE.PointLight(0xff8a3c, 8, 18, 2);
    this.fireLight.position.set(hallX - hallW / 2 + 2.4, hallY + 2, hallZ);
    this.group.add(this.fireLight);

    // Everything that dresses the hall interior lives under one switch: it is
    // some sixty draw calls of candles and flames that nobody can see from
    // outside the building, let alone from across the valley.
    this.hallDressing = new THREE.Group();
    this.hallDressing.userData.dynamic = true;
    this.group.add(this.hallDressing);
    this.hallCenter = new THREE.Vector3(hallX, hallY + 4, hallZ);

    // Floating candles — the hall's signature: bobbing lights below the ceiling
    this.candles = [];
    const candleGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.4, 6);
    const candleMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6 });
    const flameGeo = new THREE.SphereGeometry(0.075, 8, 8);
    // Above-1.0 color so the bloom pass actually catches the flames
    const flameMat = new THREE.MeshBasicMaterial();
    flameMat.color.setRGB(3.2, 2.0, 0.85);
    flameMat.toneMapped = false;
    // Soft additive halo billboard around each flame
    const glowTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const ctx = cv.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
      g.addColorStop(0, 'rgba(255,205,130,0.95)');
      g.addColorStop(0.4, 'rgba(255,160,70,0.35)');
      g.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9,
    });
    glowMat.toneMapped = false;
    this._glowMat = glowMat;
    for (let i = 0; i < 22; i++) {
      const cGroup = new THREE.Group();
      const body = new THREE.Mesh(candleGeo, candleMat);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.scale.y = 1.8;
      flame.position.y = 0.28;
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(1.1);
      glow.position.y = 0.28;
      cGroup.add(body, flame, glow);
      cGroup.position.set(
        hallX + (Math.random() - 0.5) * (hallW - 5),
        hallY + 5.5 + Math.random() * 3,
        hallZ + (Math.random() - 0.5) * (hallD - 8));
      cGroup.userData.phase = Math.random() * Math.PI * 2;
      cGroup.userData.baseY = cGroup.position.y;
      cGroup.userData.dynamic = true; // bobs every frame — keep out of the merge
      this.hallDressing.add(cGroup);
      this.candles.push(cGroup);
    }
    // Three warm pools down the length of the hall, plus flicker lights on
    // three of the candles so the ceiling reads lit rather than flat black.
    this.hallLights = [];
    for (const off of [-10, 0, 10]) {
      const l = new THREE.PointLight(0xffb768, 26, 34, 1.5);
      l.position.set(hallX, hallY + 8.5, hallZ + off);
      this.group.add(l);
      this.hallLights.push(l);
    }
    this.candleLights = [];
    for (let i = 0; i < 3; i++) {
      const src = this.candles[i * 7];
      const l = new THREE.PointLight(0xffb45a, 5, 12, 2);
      l.position.copy(src.position);
      l.userData.src = src;
      this.group.add(l);
      this.candleLights.push(l);
    }

    // Wall sconces along both long walls — brackets with flame billboards
    const sconceMat = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.6, metalness: 0.6 });
    for (const side of [-1, 1]) {
      for (const sz of [-11, -3.5, 4, 11.5]) {
        const bx = hallX + side * (hallW / 2 - wallT - 0.25);
        const by = hallY + 4.2;
        const bz = hallZ + sz;
        const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.7, 6), sconceMat);
        bracket.position.set(bx, by, bz);
        bracket.rotation.z = side * 0.5;
        this.group.add(bracket);
        const cup = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 8), sconceMat);
        cup.position.set(bx - side * 0.2, by + 0.4, bz);
        this.group.add(cup);
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), flameMat);
        fl.scale.y = 1.7;
        fl.position.set(bx - side * 0.2, by + 0.62, bz);
        this.group.add(fl);
        const fg = new THREE.Sprite(glowMat);
        fg.scale.setScalar(1.7);
        fg.position.copy(fl.position);
        this.hallDressing.add(fg);
      }
    }
    // steep gabled roof (triangular prism via cylinder trick, 3 sides)
    const gable = new THREE.Mesh(new THREE.CylinderGeometry(0.01, hallW * 0.74, hallD, 4, 1), ROOF);
    gable.rotation.x = Math.PI / 2;
    gable.rotation.y = Math.PI / 4;
    gable.scale.set(1, 1, 0.85);
    gable.position.set(hallX, hallY + hallH + 4.6, hallZ);
    gable.castShadow = true;
    this.group.add(gable);
    // tall arched hall windows on the east (courtyard) side
    for (let i = 0; i < 5; i++) {
      const wz = hallZ - hallD / 2 + 4 + i * (hallD - 8) / 4;
      windows.push({ x: hallX + hallW / 2 + 0.09, y: hallY + 9, z: wz, ry: Math.PI / 2, w: 1.6, h: 4.2 });
    }

    // ---------- astronomy tower (NE, tallest, dome) ----------
    addTower(cx + 30, cz - 8, 5.5, 64, { sides: 10, roofType: 'dome', roofH: 6 });

    // ---------- curtain wall ring with south gatehouse ----------
    const R = [
      [-16, 54], [-48, 26], [-52, -22], [-14, -50], [34, -44], [52, 6], [24, 52],
    ].map(([dx, dz]) => ({ x: cx + dx, z: cz + dz }));
    const ringTowers = R.map((p, i) =>
      addTower(p.x, p.z, 5.5 + (i % 3) * 1.3, 22 + ((i * 7) % 12), { sides: i % 2 ? 8 : 12 }));
    for (let i = 0; i < R.length - 1; i++) {
      addWall(R[i].x, R[i].z, R[i + 1].x, R[i + 1].z, 9.5 + (i % 2) * 1.5);
    }

    // Gatehouse between R[6] (east flank) and R[0] (west flank)
    const gateL = { x: cx - 4, z: cz + 56 };
    const gateR = { x: cx + 14, z: cz + 56 };
    addTower(gateL.x, gateL.z, 4.2, 19, { sides: 8, roofH: 9 });
    addTower(gateR.x, gateR.z, 4.2, 19, { sides: 8, roofH: 9 });
    addWall(R[0].x, R[0].z, gateL.x, gateL.z, 10);
    addWall(gateR.x, gateR.z, R[6].x, R[6].z, 10);
    // Arch over the gate: lintel + parapet (opening stays walkable)
    const gateY = terrainHeight((gateL.x + gateR.x) / 2, gateL.z);
    const gateSpan = gateR.x - gateL.x;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(gateSpan, 4.5, 3.4), STONE);
    lintel.position.set((gateL.x + gateR.x) / 2, gateY + 8 + 2.25, gateL.z);
    lintel.castShadow = true;
    this.group.add(lintel);
    addBoxCollider((gateL.x + gateR.x) / 2, gateY + 10.2, gateL.z, gateSpan, 4.5, 3.4);
    // Corbels under the lintel ends
    for (const side of [-1, 1]) {
      const corbel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 3.6), STONE_DARK);
      corbel.position.set((gateL.x + gateR.x) / 2 + side * (gateSpan / 2 - 3.4), gateY + 7.6, gateL.z);
      corbel.castShadow = true;
      this.group.add(corbel);
    }

    // ---------- banners on gatehouse + keep ----------
    const bannerGeo = new THREE.PlaneGeometry(1.6, 3.4, 1, 6);
    {
      const pos = bannerGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const yy = pos.getY(i);
        pos.setZ(i, Math.sin((yy + 1.7) * 1.1) * 0.16); // gentle baked curl
      }
      bannerGeo.computeVertexNormals();
    }
    const bannerAt = (x, y, z) => {
      const b = new THREE.Mesh(bannerGeo, BANNER);
      b.position.set(x, y, z);
      b.castShadow = true;
      this.group.add(b);
      const trim = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.35), BANNER_TRIM);
      trim.position.set(x, y + 1.75, z + 0.02);
      this.group.add(trim);
    };
    bannerAt(gateL.x, gateY + 14, gateL.z + 4.4);
    bannerAt(gateR.x, gateY + 14, gateR.z + 4.4);
    bannerAt(keepX - keepR - 0.2, keepY + keepH - 8, keepZ + 4);
    bannerAt(keepX + keepR + 0.2, keepY + keepH - 8, keepZ - 4);

    // ---------- courtyard lamps along the path ----------
    // The orbs glow through the shared LAMP_GLOW material (see setNightAmount),
    // so they need no per-mesh handles and can be merged away.
    const lampSpots = [
      [cx + 8, cz + 48], [cx - 2, cz + 30], [cx + 6, cz + 10],
      [cx - 8, cz - 8], [cx + 12, cz - 24],
    ];
    for (const [lx, lz] of lampSpots) {
      const ly = terrainHeight(lx, lz);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 3.4, 6), LAMP_MAT);
      post.position.set(lx, ly + 1.7, lz);
      post.castShadow = true;
      this.group.add(post);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), LAMP_GLOW);
      orb.position.set(lx, ly + 3.5, lz);
      this.group.add(orb);
    }
    // Two real point lights at the gate + courtyard center (perf budget)
    this.gateLight = new THREE.PointLight(0xffb45a, 0, 26, 2);
    this.gateLight.position.set((gateL.x + gateR.x) / 2, gateY + 5, gateL.z + 2);
    this.group.add(this.gateLight);
    this.courtLight = new THREE.PointLight(0xffb45a, 0, 30, 2);
    this.courtLight.position.set(cx + 2, terrainHeight(cx + 2, cz + 6) + 4, cz + 6);
    this.group.add(this.courtLight);

    // ---------- courtyard paving ----------
    const courtY = terrainHeight(cx + 2, cz + 8);
    const paving = new THREE.Mesh(new THREE.CircleGeometry(38, 48), addStoneDetail(
      new THREE.MeshStandardMaterial({ color: 0x8d867b, roughness: 0.95 }), 1.1, 0.3));
    paving.rotation.x = -Math.PI / 2;
    paving.position.set(cx + 2, courtY + 0.06, cz + 8);
    paving.receiveShadow = true;
    this.group.add(paving);
    const pavingRing = new THREE.Mesh(new THREE.RingGeometry(36.5, 38, 48), STONE_DARK);
    pavingRing.rotation.x = -Math.PI / 2;
    pavingRing.position.set(cx + 2, courtY + 0.09, cz + 8);
    this.group.add(pavingRing);

    // ---------- great hall courtyard door + lower windows ----------
    const doorY = terrainHeight(hallX + hallW / 2 + 1, hallZ);
    // Hinged door: pivot group at the north jamb, swings open on approach
    this.hallDoorPivot = new THREE.Group();
    this.hallDoorPivot.userData.dynamic = true; // swings open
    this.hallDoorPivot.position.set(hallX + hallW / 2 + 0.12, doorY + 2.3, hallZ - 1.5);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.6, 3.0),
      new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.85 }));
    door.position.z = 1.5; // offset so the pivot sits at the hinge edge
    door.castShadow = true;
    this.hallDoorPivot.add(door);
    this.group.add(this.hallDoorPivot);
    this._doorOpen = 0;
    this._hallDoorSpot = new THREE.Vector3(hallX + hallW / 2, doorY, hallZ);
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.4, 3.9), STONE_DARK);
    doorFrame.position.set(hallX + hallW / 2 - 0.06, doorY + 2.6, hallZ);
    doorFrame.castShadow = true;
    this.group.add(doorFrame);
    for (let i = 0; i < 4; i++) {
      const wz = hallZ - hallD / 2 + 6 + i * (hallD - 12) / 3;
      if (Math.abs(wz - hallZ) < 2.6) continue; // skip the door bay
      windows.push({ x: hallX + hallW / 2 + 0.09, y: doorY + 3.4, z: wz, ry: Math.PI / 2, w: 1.1, h: 2.0 });
    }

    // ---------- keep string courses + courtyard-facing windows ----------
    for (const frac of [0.36, 0.68]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(keepR + 0.25, 0.4, 8, 24), STONE_DARK);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(keepX, keepY + keepH * frac, keepZ);
      this.group.add(ring);
    }
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i - 1) * 0.55; // south arc faces the courtyard
      windows.push({
        x: keepX + Math.cos(a) * (keepR + 0.09), y: keepY + 7 + (i % 2) * 4,
        z: keepZ + Math.sin(a) * (keepR + 0.09), ry: -a + Math.PI / 2, w: 1.1, h: 2.4,
      });
    }

    // ---------- windows + frames (instanced) ----------
    const winGeo = new THREE.PlaneGeometry(1, 1);
    this.windowMesh = new THREE.InstancedMesh(winGeo, WINDOW_MAT, windows.length);
    const frameGeo = new THREE.BoxGeometry(1, 1, 0.12);
    this.frameMesh = new THREE.InstancedMesh(frameGeo, FRAME_MAT, windows.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      e.set(0, w.ry, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(w.x, w.y, w.z), q, new THREE.Vector3(w.w, w.h, 1));
      this.windowMesh.setMatrixAt(i, m);
      // Frame sits recessed into the wall so the glass plane stays in front
      const nrm = new THREE.Vector3(Math.sin(w.ry), 0, Math.cos(w.ry));
      m.compose(
        new THREE.Vector3(w.x - nrm.x * 0.09, w.y, w.z - nrm.z * 0.09),
        q, new THREE.Vector3(w.w + 0.28, w.h + 0.3, 1));
      this.frameMesh.setMatrixAt(i, m);
    }
    this.windowMesh.frustumCulled = false;
    this.frameMesh.frustumCulled = false;
    this.group.add(this.frameMesh, this.windowMesh);

    // The castle is authored as ~250 little meshes; none of the stonework
    // moves, so bake it down to a handful of draw calls.
    this.mergeStats = mergeStatics(this.group, { cellSize: 70 });

    scene.add(this.group);
  }

  // True when a position is inside the great hall (for interior lighting)
  isInsideHall(pos) {
    const b = this.hallBounds;
    return b && pos.x > b.minX && pos.x < b.maxX && pos.z > b.minZ && pos.z < b.maxZ &&
      pos.y > b.y - 1 && pos.y < b.y + b.h;
  }

  update(dt, elapsed, playerPos) {
    // Door swings open when the player comes near. Outside the dressing gate,
    // so it can never be left frozen half-open for the world to see.
    if (this.hallDoorPivot && playerPos) {
      const atDoor = playerPos.distanceTo(this._hallDoorSpot) < 5.5;
      this._doorOpen = THREE.MathUtils.lerp(this._doorOpen, atDoor ? 1 : 0, 1 - Math.exp(-4 * dt));
      this.hallDoorPivot.rotation.y = this._doorOpen * 1.9;
    }
    if (playerPos && OPTIMIZED) {
      // Interior dressing only exists when someone is close enough to see in.
      // 60m: the courtyard still sees candlelight through the tall east
      // windows, the approach road below the gate does not.
      const near = playerPos.distanceToSquared(this.hallCenter) < 60 * 60;
      if (this.hallDressing.visible !== near) this.hallDressing.visible = near;
      if (!near) return;
    }
    // Candles bob; fire flickers
    if (this.candles) {
      for (const c of this.candles) {
        c.position.y = c.userData.baseY + Math.sin(elapsed * 0.9 + c.userData.phase) * 0.22;
      }
    }
    if (this.candleLights) {
      for (let i = 0; i < this.candleLights.length; i++) {
        const l = this.candleLights[i];
        l.position.copy(l.userData.src.position);
        l.intensity = 4.6 + Math.sin(elapsed * 7 + i * 2.1) * 0.7;
      }
    }
    if (this.fireLight) {
      this.fireLight.intensity = 11 + Math.sin(elapsed * 11) * 2.0 + Math.sin(elapsed * 23) * 1.2;
    }
  }

  setNightAmount(night) {
    WINDOW_MAT.emissiveIntensity = night * 2.6;
    const lamp = night * 14;
    this.gateLight.intensity = lamp;
    this.courtLight.intensity = lamp;
    LAMP_GLOW.color.setHSL(0.09, 0.85, 0.35 + night * 0.35);
  }
}
