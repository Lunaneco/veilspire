import * as THREE from 'three';
import { terrainHeight, CASTLE_PLATEAU } from './Terrain.js';
import { makeRng } from '../util/noise.js';
import { mergeStatics } from '../util/mergeStatics.js';
import { OPTIMIZED } from '../util/perfFlags.js';

// The Charms Hall — a teaching room in the castle's west annex, plus the
// academy's moving stair. Enchanted books orbit the lectern, a candelabra
// drifts, straw dummies take spell practice, and the great stair swings
// between two landings on its own schedule.

const STONE = new THREE.MeshStandardMaterial({ color: 0x948d81, roughness: 0.9 });
const STONE_DARK = new THREE.MeshStandardMaterial({ color: 0x6f695f, roughness: 0.93 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x6a5138, roughness: 0.85 });
const SLATE = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.75 });
const STRAW = new THREE.MeshStandardMaterial({ color: 0xbfa25c, roughness: 0.95 });
const CLOTH = new THREE.MeshStandardMaterial({ color: 0x6d3f3f, roughness: 0.9 });
const BOOK_COLORS = [0x7a2f2f, 0x2f4a7a, 0x2f6b46, 0x6b5a2f, 0x54305e];

// Sited clear of the castle's ring towers (nearest is at -52,-142, r 8.5)
export const CHARMS = { x: -94, z: -152, w: 24, d: 30, h: 13 };

export class Classroom {
  constructor(scene) {
    this.group = new THREE.Group();
    this.colliders = [];
    this.buildingRects = [];
    const rng = makeRng(555777);
    const { x: cx, z: cz, w, d, h } = CHARMS;
    // Sit the floor above the highest ground under the footprint, or the slope
    // pushes through it. A plinth fills the gap down to the lowest corner.
    let maxG = -Infinity, minG = Infinity;
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const t = terrainHeight(cx + gx * (w / 2 + 1), cz + gz * (d / 2 + 1));
        maxG = Math.max(maxG, t);
        minG = Math.min(minG, t);
      }
    }
    const y = maxG + 0.4;
    this.floorY = y;
    this.bounds = {
      minX: cx - w / 2, maxX: cx + w / 2,
      minZ: cz - d / 2, maxZ: cz + d / 2, y, h,
    };
    this.buildingRects.push({
      minX: cx - w / 2 - 1, maxX: cx + w / 2 + 1,
      minZ: cz - d / 2 - 1, maxZ: cz + d / 2 + 1,
    });

    const wallT = 1.1;
    const doorW = 3.4, doorH = 5.0;
    const wall = (wx, wy, wz, ww, wh, wd, mat = STONE) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, wd), mat);
      m.position.set(wx, wy, wz);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      const box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(wx, wy, wz), new THREE.Vector3(ww, wh, wd));
      this.colliders.push({ type: 'box', box });
    };

    // Shell — door faces east (toward the castle courtyard)
    wall(cx - w / 2 + wallT / 2, y + h / 2, cz, wallT, h, d);
    wall(cx, y + h / 2, cz - d / 2 + wallT / 2, w, h, wallT);
    wall(cx, y + h / 2, cz + d / 2 - wallT / 2, w, h, wallT);
    const eX = cx + w / 2 - wallT / 2;
    const seg = (d - doorW) / 2;
    wall(eX, y + h / 2, cz - doorW / 2 - seg / 2, wallT, h, seg);
    wall(eX, y + h / 2, cz + doorW / 2 + seg / 2, wallT, h, seg);
    wall(eX, y + doorH + (h - doorH) / 2, cz, wallT, h - doorH, doorW);

    // Plinth: solid stone from the lowest ground up to the floor slab
    const plinthH = Math.max(0.6, y - (minG - 1.2));
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, plinthH, d + 1.2), STONE_DARK);
    plinth.position.set(cx, y - plinthH / 2, cz);
    plinth.castShadow = plinth.receiveShadow = true;
    this.group.add(plinth);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), STONE_DARK);
    floor.position.set(cx, y + 0.15, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    // Steps up to the east doorway so the entrance is reachable
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(5, 0.34, 1.1), STONE);
      st.position.set(cx + w / 2 + 0.8 + i * 1.0, y - 0.2 - i * 0.34, cz);
      st.castShadow = st.receiveShadow = true;
      this.group.add(st);
    }
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), WOOD);
    ceil.position.set(cx, y + h - 0.2, cz);
    this.group.add(ceil);

    // Blackboard and lectern at the north end
    const board = new THREE.Mesh(new THREE.BoxGeometry(11, 4.2, 0.22), SLATE);
    board.position.set(cx, y + 4.2, cz - d / 2 + wallT + 0.15);
    board.castShadow = true;
    this.group.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(11.6, 4.7, 0.16), WOOD);
    frame.position.set(cx, y + 4.2, cz - d / 2 + wallT + 0.05);
    this.group.add(frame);
    // Interior dressing — chalk, books, candelabra, dummies. Fifty-odd draw
    // calls that only matter once you are in the room, so they hang off one
    // switch the update loop flips by distance.
    this.dressing = new THREE.Group();
    this.dressing.userData.dynamic = true;
    this.group.add(this.dressing);

    // Chalked runes — thin emissive strokes that fade in and out
    this.chalkMat = new THREE.MeshBasicMaterial({
      color: 0xe8e2d0, transparent: true, opacity: 0.75,
    });
    this.chalk = [];
    for (let i = 0; i < 9; i++) {
      const len = 0.5 + rng() * 1.5;
      const s = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.03), this.chalkMat);
      s.position.set(
        cx - 4.4 + rng() * 8.8,
        y + 2.7 + rng() * 2.7,
        cz - d / 2 + wallT + 0.28);
      s.rotation.z = (rng() - 0.5) * 1.6;
      s.userData.dynamic = true; // scales as it is "written"
      this.dressing.add(s);
      this.chalk.push({ mesh: s, phase: rng() * 6.28 });
    }

    const lectern = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 1.2, 8), WOOD);
    lectern.position.set(cx, y + 0.9, cz - d / 2 + 5);
    lectern.castShadow = true;
    this.group.add(lectern);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.8), WOOD);
    top.position.set(cx, y + 1.55, cz - d / 2 + 5);
    top.rotation.x = -0.35;
    this.group.add(top);
    this.lecternPos = new THREE.Vector3(cx, y + 2.4, cz - d / 2 + 5);

    // Student desks in rows
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const dx = cx - 6.5 + col * 6.5;
        const dz = cz - 4 + row * 6;
        const desk = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 1.3), WOOD);
        desk.position.set(dx, y + 0.95, dz);
        desk.castShadow = desk.receiveShadow = true;
        this.group.add(desk);
        for (const sx of [-1.2, 1.2]) {
          for (const sz of [-0.45, 0.45]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), WOOD);
            leg.position.set(dx + sx, y + 0.5, dz + sz);
            this.group.add(leg);
          }
        }
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.55, 8), WOOD);
        stool.position.set(dx, y + 0.3, dz + 1.3);
        stool.castShadow = true;
        this.group.add(stool);
        const box = new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(dx, y + 0.55, dz), new THREE.Vector3(3.0, 1.1, 1.3));
        this.colliders.push({ type: 'box', box, camBlock: false });
      }
    }

    // Shared bright flame material (above 1.0 so bloom catches it)
    const flameMat = new THREE.MeshBasicMaterial();
    flameMat.color.setRGB(3.2, 2.0, 0.85);
    flameMat.toneMapped = false;

    // ---- Enchanted books orbiting the lectern ----
    this.books = [];
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      g.userData.dynamic = true; // orbits the lectern
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.62),
        new THREE.MeshStandardMaterial({
          color: BOOK_COLORS[i % BOOK_COLORS.length], roughness: 0.85,
        }));
      cover.castShadow = true;
      g.add(cover);
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.07, 0.56),
        new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.9 }));
      pages.position.y = 0.012;
      g.add(pages);
      this.dressing.add(g);
      this.books.push({
        mesh: g,
        radius: 1.5 + rng() * 1.4,
        speed: 0.5 + rng() * 0.6,
        phase: rng() * 6.28,
        bobPhase: rng() * 6.28,
        tilt: (rng() - 0.5) * 0.7,
        yOff: rng() * 1.4,
      });
    }
    const bookGlow = new THREE.PointLight(0xffd9a0, 14, 16, 1.8);
    bookGlow.position.copy(this.lecternPos);
    this.group.add(bookGlow);
    // Wall sconces so the room is readable end to end
    for (const sz of [-8, 4]) {
      for (const sx of [-1, 1]) {
        const l = new THREE.PointLight(0xffb45a, 12, 20, 1.6);
        l.position.set(cx + sx * (w / 2 - 2), y + 4.6, cz + sz);
        this.group.add(l);
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), flameMat);
        fl.scale.y = 1.7;
        fl.position.copy(l.position);
        this.group.add(fl);
        const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 6),
          new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.6, metalness: 0.6 }));
        bracket.position.set(cx + sx * (w / 2 - 1.5), y + 4.3, cz + sz);
        bracket.rotation.z = sx * 0.5;
        this.group.add(bracket);
      }
    }

    // ---- Drifting candelabra ----
    this.candelabra = new THREE.Group();
    this.candelabra.userData.dynamic = true; // drifts on a lissajous
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.07, 6, 20),
      new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.5, metalness: 0.6 }));
    ring.rotation.x = Math.PI / 2;
    this.candelabra.add(ring);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.36, 6),
        new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6 }));
      c.position.set(Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5);
      this.candelabra.add(c);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), flameMat);
      f.scale.y = 1.7;
      f.position.set(Math.cos(a) * 1.5, 0.46, Math.sin(a) * 1.5);
      this.candelabra.add(f);
    }
    const candleLight = new THREE.PointLight(0xffb45a, 30, 32, 1.4);
    this.candelabra.add(candleLight);
    this.candelabra.position.set(cx, y + h - 5.6, cz + 2);
    this.dressing.add(this.candelabra);
    this.candelabraBase = this.candelabra.position.clone();

    // ---- Straw practice dummies ----
    this.dummies = [];
    for (const dx of [-7, 0, 7]) {
      const dz = cz + d / 2 - 5;
      const g = new THREE.Group();
      g.userData.dynamic = true; // rocks when struck
      g.position.set(cx + dx, y, dz);
      this.dressing.add(g);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.0, 7), WOOD);
      post.position.y = 1.0;
      post.castShadow = true;
      g.add(post);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.7, 5, 10), STRAW);
      body.position.y = 1.55;
      body.castShadow = true;
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), STRAW);
      head.position.y = 2.3;
      head.castShadow = true;
      g.add(head);
      const sash = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 6, 14), CLOTH);
      sash.rotation.x = Math.PI / 2;
      sash.position.y = 1.5;
      g.add(sash);
      const arms = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.14), WOOD);
      arms.position.y = 1.85;
      arms.castShadow = true;
      g.add(arms);
      this.dummies.push({
        group: g, lean: 0, leanVel: 0, burn: 0,
        pos: new THREE.Vector3(cx + dx, y + 1.6, dz),
        mats: [body.material, head.material],
      });
      this.colliders.push({
        type: 'cylinder', x: cx + dx, z: dz, r: 0.5, topY: y + 2.5, camBlock: false,
      });
    }
    // Each dummy gets its own straw material so scorching is individual
    for (const dm of this.dummies) {
      dm.mats = dm.mats.map((m) => {
        const c = m.clone();
        return c;
      });
      let i = 0;
      dm.group.traverse((o) => {
        if (o.isMesh && o.material === STRAW) o.material = dm.mats[Math.min(i++, dm.mats.length - 1)];
      });
    }

    // Room shell, desks and sconces are fixed — batch them
    this.mergeStats = mergeStatics(this.group, { cellSize: 60 });

    scene.add(this.group);
  }

  isInside(pos) {
    const b = this.bounds;
    return pos.x > b.minX && pos.x < b.maxX && pos.z > b.minZ && pos.z < b.maxZ &&
      pos.y > b.y - 1 && pos.y < b.y + b.h;
  }

  // A spell landing near a dummy knocks it and may set the straw smouldering
  hitDummies(point, radius, fire = false) {
    let hit = false;
    for (const dm of this.dummies) {
      const d = dm.pos.distanceTo(point);
      if (d < radius + 0.7) {
        dm.leanVel += 5.5;
        if (fire) dm.burn = 4;
        hit = true;
      }
    }
    return hit;
  }

  update(dt, elapsed, playerPos = null) {
    if (playerPos && OPTIMIZED) {
      const near = playerPos.distanceToSquared(this.lecternPos) < 90 * 90;
      if (this.dressing.visible !== near) this.dressing.visible = near;
      if (!near) return;
    }
    // Books orbit and page-flutter above the lectern
    for (const b of this.books) {
      const a = elapsed * b.speed + b.phase;
      b.mesh.position.set(
        this.lecternPos.x + Math.cos(a) * b.radius,
        this.lecternPos.y + b.yOff + Math.sin(elapsed * 1.3 + b.bobPhase) * 0.24,
        this.lecternPos.z + Math.sin(a) * b.radius);
      b.mesh.rotation.y = -a + Math.PI / 2;
      b.mesh.rotation.z = b.tilt + Math.sin(elapsed * 2 + b.phase) * 0.12;
    }
    // Candelabra drifts on a slow lissajous
    this.candelabra.position.set(
      this.candelabraBase.x + Math.sin(elapsed * 0.31) * 1.4,
      this.candelabraBase.y + Math.sin(elapsed * 0.53) * 0.35,
      this.candelabraBase.z + Math.cos(elapsed * 0.24) * 1.1);
    this.candelabra.rotation.y = elapsed * 0.15;
    // Chalk strokes fade as though being written and rubbed out
    for (const c of this.chalk) {
      c.mesh.scale.x = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * 0.5 + c.phase));
    }
    // Dummies rock back upright after a hit, and smoulder if burned
    for (const dm of this.dummies) {
      dm.leanVel += -dm.lean * 26 * dt;   // spring back
      dm.leanVel *= Math.exp(-3.4 * dt);  // damping
      dm.lean += dm.leanVel * dt;
      dm.group.rotation.x = THREE.MathUtils.clamp(dm.lean, -1.0, 1.0);
      if (dm.burn > 0) {
        dm.burn -= dt;
        const t = Math.max(dm.burn / 4, 0);
        for (const m of dm.mats) m.color.setRGB(0.75 - t * 0.45, 0.64 - t * 0.5, 0.36 - t * 0.3);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The Turning Stair: a flight of steps that swings between two landings.
export class MovingStair {
  constructor(scene, audio = null) {
    this.audio = audio;
    this.group = new THREE.Group();
    this.colliders = [];
    const { x: cx, z: cz } = CASTLE_PLATEAU;
    const baseX = cx + 26, baseZ = cz - 4;
    const y = terrainHeight(baseX, baseZ);
    this.pivot = new THREE.Group();
    this.pivot.position.set(baseX, y, baseZ);
    this.group.add(this.pivot);
    this.origin = new THREE.Vector3(baseX, y, baseZ);

    // Steps climbing away from the pivot
    this.stepCount = 14;
    this.stepRise = 0.45;
    this.stepRun = 0.95;
    for (let i = 0; i < this.stepCount; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.32, this.stepRun), STONE);
      s.position.set(0, (i + 1) * this.stepRise, 1.5 + i * this.stepRun);
      s.castShadow = s.receiveShadow = true;
      this.pivot.add(s);
    }
    // Balustrades
    for (const sx of [-1.75, 1.75]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.22, this.stepCount * this.stepRun + 1.4), STONE_DARK);
      rail.position.set(sx, this.stepCount * this.stepRise * 0.5 + 1.0,
        1.2 + (this.stepCount * this.stepRun) / 2);
      rail.rotation.x = -Math.atan2(this.stepRise, this.stepRun);
      rail.castShadow = true;
      this.pivot.add(rail);
    }
    // Landing at the top
    const landing = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.4, 3.2), STONE);
    landing.position.set(0, this.stepCount * this.stepRise + 0.2,
      1.5 + this.stepCount * this.stepRun + 1.2);
    landing.castShadow = landing.receiveShadow = true;
    this.pivot.add(landing);

    // Two destinations it alternates between
    this.angles = [0, -Math.PI / 2];
    this.target = 0;
    this.current = 0;
    this.holdTimer = 12;
    this.moving = false;

    // Merge inside the pivot: the steps are rigid relative to it, so the
    // whole flight becomes two draw calls and still swings as one piece.
    mergeStatics(this.pivot, { cellSize: 1e6 });

    scene.add(this.group);
  }

  // Height of the stair surface under a point, or null if not over the stair
  surfaceHeight(pos) {
    const dx = pos.x - this.origin.x;
    const dz = pos.z - this.origin.z;
    // Rotate the query into stair-local space. rotation.y = θ maps local
    // (lx,lz) to world (lx·cosθ + lz·sinθ, −lx·sinθ + lz·cosθ), so the
    // inverse uses +θ here — negating it silently mirrors the stair.
    const c = Math.cos(this.current), s = Math.sin(this.current);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) > 1.8) return null;
    const alongStart = 1.5 - this.stepRun / 2;
    const alongEnd = 1.5 + this.stepCount * this.stepRun + 2.6;
    if (lz < alongStart || lz > alongEnd) return null;
    const stepIndex = Math.min(this.stepCount, Math.max(0, Math.ceil((lz - alongStart) / this.stepRun)));
    return this.origin.y + stepIndex * this.stepRise + 0.16;
  }

  update(dt, elapsed) {
    if (this.moving) {
      const diff = this.angles[this.target] - this.current;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.32);
      this.current += step;
      if (Math.abs(this.angles[this.target] - this.current) < 0.002) {
        this.current = this.angles[this.target];
        this.moving = false;
        this.holdTimer = 14 + Math.random() * 8;
        this.audio?.impact(0.5);
      }
    } else {
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) {
        this.target = 1 - this.target;
        this.moving = true;
        this.audio?.impact(0.35);
      }
    }
    this.pivot.rotation.y = this.current;
  }
}
