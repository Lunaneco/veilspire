import * as THREE from 'three';
import { fbm2D, ridgedFbm2D } from '../util/noise.js';

// Heightfield terrain around the academy. Height sampling is a pure function
// so gameplay code (player collision, prop scattering) can query it anywhere.

const SIZE = 1200;          // world units, square
const SEGMENTS = 256;
const CASTLE_PLATEAU = { x: 0, z: -120, radius: 95, height: 26 };
const LAKE = { x: 210, z: 150, radius: 130, depth: 10 };

export function terrainHeight(x, z) {
  // Base rolling hills
  let h = fbm2D(x * 0.004, z * 0.004, { octaves: 5, seed: 11 }) * 34 - 10;
  // Distant mountains ring the playable area
  const distFromCenter = Math.hypot(x, z);
  const mountainMask = THREE.MathUtils.smoothstep(distFromCenter, 380, 580);
  h += ridgedFbm2D(x * 0.0035, z * 0.0035, { octaves: 5, seed: 23 }) * 190 * mountainMask;

  // Castle plateau: smooth raised disc
  const dCastle = Math.hypot(x - CASTLE_PLATEAU.x, z - CASTLE_PLATEAU.z);
  const plateauMask = 1 - THREE.MathUtils.smoothstep(dCastle, CASTLE_PLATEAU.radius * 0.55, CASTLE_PLATEAU.radius);
  h = THREE.MathUtils.lerp(h, CASTLE_PLATEAU.height, plateauMask);

  // Lake basin
  const dLake = Math.hypot(x - LAKE.x, z - LAKE.z);
  const lakeMask = 1 - THREE.MathUtils.smoothstep(dLake, LAKE.radius * 0.4, LAKE.radius);
  h = THREE.MathUtils.lerp(h, -LAKE.depth, lakeMask * 0.9);

  return h;
}

export const WATER_LEVEL = -2.2;
export { CASTLE_PLATEAU, LAKE, SIZE as TERRAIN_SIZE };

// Winding dirt path from the southern meadow up to the academy gate.
const PATH_POINTS = [
  [30, 120], [22, 80], [10, 52], [16, 34], [8, 6], [-2, -20], [2, -44], [5, -70], [2, -92],
];
export function distanceToPath(x, z) {
  let best = Infinity;
  for (let i = 0; i < PATH_POINTS.length - 1; i++) {
    const [ax, az] = PATH_POINTS[i], [bx, bz] = PATH_POINTS[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, pz = az + dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

export class Terrain {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(0x5e9440);
    const grassDry = new THREE.Color(0x8fa04e);
    const rock = new THREE.Color(0x7d766e);
    const rockDark = new THREE.Color(0x5a544c);
    const sand = new THREE.Color(0x9a8c66);
    const dirt = new THREE.Color(0x7a6248);
    const snow = new THREE.Color(0xdfe4ea);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);

      // Color by height/slope with noise breakup
      const n = fbm2D(x * 0.02, z * 0.02, { octaves: 3, seed: 41 });
      tmp.copy(grass).lerp(grassDry, n);
      // Slope estimate via finite difference
      const s = Math.abs(terrainHeight(x + 2, z) - h) + Math.abs(terrainHeight(x, z + 2) - h);
      const slope = THREE.MathUtils.smoothstep(s, 1.2, 3.5);
      tmp.lerp(n > 0.5 ? rock : rockDark, slope);
      // Beach near water level
      const beach = 1 - THREE.MathUtils.smoothstep(Math.abs(h - WATER_LEVEL), 0.4, 2.4);
      tmp.lerp(sand, beach * (1 - slope));
      // Dirt path with soft, noisy edges
      const dPath = distanceToPath(x, z);
      const pathMask = 1 - THREE.MathUtils.smoothstep(dPath, 1.2 + n * 0.8, 2.8 + n);
      tmp.lerp(dirt, pathMask * 0.5);
      // Snow caps
      const snowAmt = THREE.MathUtils.smoothstep(h, 95, 130) * (1 - slope * 0.5);
      tmp.lerp(snow, snowAmt);

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0.0,
    });
    // High-frequency albedo variation so the ground never reads as smooth gradients
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWet = { value: 0 };
      shader.uniforms.uSnow = { value: 0 };
      this._shader = shader;
      shader.vertexShader = 'varying vec3 vTWorld;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader = `varying vec3 vTWorld;
uniform float uWet;
uniform float uSnow;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x),
             mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
` + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 sp = vTWorld.xz;
          float v = (tNoise(sp * 1.7) * 0.45 + tNoise(sp * 0.31) * 0.55 - 0.5) * 0.16;
          diffuseColor.rgb *= (1.0 + v) * (1.0 - uWet * 0.3);
          // Snow settles on flatter, higher ground first
          if (uSnow > 0.001) {
            float cover = uSnow * smoothstep(-4.0, 14.0, vTWorld.y);
            cover *= 0.75 + 0.25 * tNoise(sp * 0.6);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.98), clamp(cover, 0.0, 0.95));
          }
        }`
      );
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    scene.add(this.mesh);

    scene.add(this.buildPathRibbon());
  }

  setWetness(w) {
    if (this._shader) this._shader.uniforms.uWet.value = w;
  }

  setSnow(s) {
    if (this._shader) this._shader.uniforms.uSnow.value = s;
  }

  // Draped dirt ribbon following PATH_POINTS, sampled densely and offset just
  // above the terrain to avoid z-fighting.
  buildPathRibbon() {
    const positions = [];
    const uvs = [];
    const indices = [];
    const halfW = 1.7;
    let ring = 0;
    for (let i = 0; i < PATH_POINTS.length - 1; i++) {
      const [ax, az] = PATH_POINTS[i], [bx, bz] = PATH_POINTS[i + 1];
      const segLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(2, Math.ceil(segLen / 2));
      for (let sIdx = 0; sIdx <= steps; sIdx++) {
        if (i > 0 && sIdx === 0) continue; // shared with previous segment end
        const t = sIdx / steps;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        // Direction (smoothed by neighboring segment at joints)
        let dx = bx - ax, dz = bz - az;
        const dl = Math.hypot(dx, dz);
        dx /= dl; dz /= dl;
        const nx = -dz, nz = dx; // perpendicular
        for (const side of [-1, 1]) {
          const px = x + nx * halfW * side, pz = z + nz * halfW * side;
          positions.push(px, terrainHeight(px, pz) + 0.07, pz);
          uvs.push(side * 0.5 + 0.5, ring * 0.25);
        }
        if (ring > 0) {
          const b0 = (ring - 1) * 2, b1 = ring * 2;
          indices.push(b0, b1, b0 + 1, b0 + 1, b1, b1 + 1);
        }
        ring++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8a6f50, roughness: 0.95,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }
}
