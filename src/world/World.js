import * as THREE from 'three';
import { Sky } from './Sky.js';
import { Terrain, terrainHeight, WATER_LEVEL } from './Terrain.js';
import { Castle } from './Castle.js';
import { Vegetation } from './Vegetation.js';
import { Water } from './Water.js';
import { Settlements } from './Settlements.js';
import { Cavern, CAVERN } from './Cavern.js';
import { Classroom, MovingStair } from './Classroom.js';
import { resolveCapsuleColliders, ledgeHeight } from '../util/collisionMath.js';

// Aggregates all world content and provides collision queries for gameplay.

export class World {
  constructor(scene) {
    this.scene = scene;
    this.sky = new Sky(scene);
    this.terrain = new Terrain(scene);
    this.castle = new Castle(scene);
    this.settlements = new Settlements(scene, null); // spells wired in main
    this.cavern = new Cavern(scene);
    this.classroom = new Classroom(scene);
    this.stair = new MovingStair(scene);
    this.vegetation = new Vegetation(scene,
      [
        ...this.castle.buildingRects, ...this.settlements.buildingRects,
        ...this.classroom.buildingRects,
        // Nothing grows on the cavern floor
        {
          minX: CAVERN.x - CAVERN.r - 3, maxX: CAVERN.x + CAVERN.r + 3,
          minZ: CAVERN.z - CAVERN.r - 3, maxZ: CAVERN.z + CAVERN.r + 10,
        },
      ],
      [...this.settlements.clearings, { x: CAVERN.x, z: CAVERN.z, r: CAVERN.r + 14 }]);
    this.water = new Water(scene);

    this.colliders = [
      ...this.castle.colliders, ...this.settlements.colliders,
      ...this.cavern.colliders, ...this.classroom.colliders,
      ...this.vegetation.colliders,
    ];
    // Spatial hash for colliders so per-frame queries stay cheap.
    this.cellSize = 24;
    this.grid = new Map();
    for (const c of this.colliders) {
      let minX, maxX, minZ, maxZ;
      if (c.type === 'cylinder') {
        minX = c.x - c.r; maxX = c.x + c.r; minZ = c.z - c.r; maxZ = c.z + c.r;
      } else {
        minX = c.box.min.x; maxX = c.box.max.x; minZ = c.box.min.z; maxZ = c.box.max.z;
      }
      for (let gx = Math.floor(minX / this.cellSize); gx <= Math.floor(maxX / this.cellSize); gx++) {
        for (let gz = Math.floor(minZ / this.cellSize); gz <= Math.floor(maxZ / this.cellSize); gz++) {
          const key = gx + ':' + gz;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(c);
        }
      }
    }
  }

  // Walkable height: terrain, raised by interior floors, the moving stair, and
  // the tops of box colliders you are already standing at or above (ledges).
  groundHeight(x, z, fromY = -Infinity) {
    let base = terrainHeight(x, z);
    if (fromY > -Infinity) {
      const boxes = [];
      for (const c of this.collidersNear(x, z, 1)) {
        if (c.type === 'box' && c.box) boxes.push(c.box);
      }
      base = ledgeHeight(x, z, fromY, boxes, base);
    }
    const cr = this.classroom;
    if (cr) {
      const b = cr.bounds;
      // The classroom sits on a plinth, so its floor is the walking surface
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) {
        base = Math.max(base, cr.floorY + 0.3);
      }
    }
    if (this.stair) {
      const s = this.stair.surfaceHeight({ x, z });
      if (s !== null && s > base) return s;
    }
    return base;
  }

  get waterLevel() { return WATER_LEVEL; }

  collidersNear(x, z, radius = 2) {
    const out = [];
    const seen = new Set();
    const min = -Math.ceil(radius / this.cellSize), max = Math.ceil(radius / this.cellSize);
    const bx = Math.floor(x / this.cellSize), bz = Math.floor(z / this.cellSize);
    for (let gx = bx + min; gx <= bx + max; gx++) {
      for (let gz = bz + min; gz <= bz + max; gz++) {
        const cell = this.grid.get(gx + ':' + gz);
        if (!cell) continue;
        for (const c of cell) {
          if (!seen.has(c)) { seen.add(c); out.push(c); }
        }
      }
    }
    return out;
  }

  // Push a capsule (foot position + radius) out of colliders. Mutates pos.
  resolveCollisions(pos, radius, height) {
    resolveCapsuleColliders(
      pos,
      radius,
      height,
      this.collidersNear(pos.x, pos.z, radius + 2),
    );
  }

  // Camera obstruction: march from target toward desired camera pos, return
  // safe distance (against terrain + colliders).
  cameraClearance(from, dir, maxDist, margin = 0.35) {
    const steps = 24;
    const p = new THREE.Vector3();
    // Interiors have flat floors laid over sloped ground — the raw heightfield
    // would shove the camera into the player, so skip it while indoors.
    const indoors = (this._interior ?? 0) > 0.5;
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * maxDist;
      p.copy(from).addScaledVector(dir, d);
      if (!indoors && p.y < terrainHeight(p.x, p.z) + margin) return Math.max(0.5, d - margin * 2);
      for (const c of this.collidersNear(p.x, p.z, margin + 1)) {
        if (c.camBlock === false) continue;
        if (c.type === 'cylinder') {
          if (p.y < c.topY && Math.hypot(p.x - c.x, p.z - c.z) < c.r + margin) {
            return Math.max(0.5, d - margin * 2);
          }
        } else if (c.box.distanceToPoint(p) < margin) {
          return Math.max(0.5, d - margin * 2);
        }
      }
    }
    return maxDist;
  }

  update(dt, elapsed, weather = null, playerPos = null) {
    // Indoor factor eases fog/sun down inside the great hall
    if (playerPos) {
      const inside = (this.castle.isInsideHall(playerPos) || this.cavern.isInside(playerPos)
        || this.classroom.isInside(playerPos)) ? 1 : 0;
      this._interior = THREE.MathUtils.lerp(this._interior ?? 0, inside, 1 - Math.exp(-3 * dt));
      this.sky.interiorFactor = this._interior;
    }
    this.sky.update(dt, elapsed, weather);
    this.vegetation.update(dt, elapsed, playerPos);
    this.water.update(dt, elapsed);
    this.castle.update(dt, elapsed, playerPos);
    this.settlements.update(dt, elapsed);
    this.cavern.update(dt, elapsed, playerPos);
    this.classroom.update(dt, elapsed, playerPos);
    this.stair.update(dt, elapsed);
    if (weather) {
      this.terrain.setWetness(weather.wetness);
      this.terrain.setSnow(weather.snowCover);
      this.vegetation.setSnow(weather.snowCover);
    }
    // Window glow at night
    const night = 1 - THREE.MathUtils.smoothstep(this.sky.sunElevation ?? 1, -0.12, 0.15);
    this.castle.setNightAmount(night);
    this.settlements.setNightAmount(night);
  }
}
