import * as THREE from 'three';
import { WizardModel } from '../player/WizardModel.js';
import { makeRng } from '../util/noise.js';
import { pickGreeting, pickConversation } from '../systems/Dialogue.js';
import { OPTIMIZED } from '../util/perfFlags.js';

// Students follow a daily schedule: lessons in the great hall in the morning,
// courtyard at midday, meadow walks in the afternoon, keep (dorms) at night.
// Each NPC walks waypoint-to-waypoint, snaps to terrain, and idles on arrival.

const ROBE_COLORS = [0x27314f, 0x3d2a4f, 0x2a4436, 0x4f2f2a, 0x2f3f4f, 0x44304f];
const TRIM_COLORS = [0xb08a3e, 0x8ab0c9, 0x9ec98a, 0xc98a8a];
const HAIR_COLORS = [0x3a2a1c, 0x1c1c1c, 0x8a6a3a, 0xb0947a, 0x6a3a2a];
const SKIN_COLORS = [0xd9a988, 0xc98f6f, 0x8a6248, 0xe8c0a0];

// Destination zones by schedule block (world coords)
const ZONES = {
  // `via` is a doorway waypoint walked to first — NPCs have no pathfinding,
  // so without it they press against the hall's east wall.
  // rx/rz make the hall zone elongated so students spread along the tables
  // `via` is the doorway approach chain (outside → inside). NPCs have no
  // pathfinding, so without it they press against the hall's east wall.
  hall: {
    x: -30, z: -122, r: 6, rx: 5.5, rz: 14,
    // doorway → through the cross-aisle → central aisle, then on to the seat
    via: [{ x: -18.5, z: -122 }, { x: -24.5, z: -122 }, { x: -30, z: -122 }],
  },
  courtyard: { x: 2, z: -100, r: 16 },
  meadow: { x: 14, z: 10, r: 26 },
  keep: { x: -2, z: -125, r: 10 },
  gate: { x: 5, z: -60, r: 8 },
};

function zoneForHour(h) {
  if (h >= 8 && h < 12) return 'hall';
  if (h >= 12 && h < 15) return 'courtyard';
  if (h >= 15 && h < 19) return 'meadow';
  return 'keep';
}

export class NPC {
  constructor(scene, world, rng, isProfessor = false) {
    this.world = world;
    this.isProfessor = isProfessor;
    const palette = isProfessor
      ? { robe: 0x1c1c24, trim: 0xc9a24a, hair: 0x9a9a9a, skin: SKIN_COLORS[1] }
      : {
          robe: ROBE_COLORS[Math.floor(rng() * ROBE_COLORS.length)],
          trim: TRIM_COLORS[Math.floor(rng() * TRIM_COLORS.length)],
          hair: HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)],
          skin: SKIN_COLORS[Math.floor(rng() * SKIN_COLORS.length)],
        };
    this._palette = palette;
    this.model = new WizardModel(palette);
    const s = isProfessor ? 1.04 : 0.88 + rng() * 0.14;
    this.model.root.scale.setScalar(s);
    scene.add(this.model.root);

    this.position = new THREE.Vector3();
    this.facing = rng() * Math.PI * 2;
    this.speed = 1.5 + rng() * 0.5;
    this.target = null;
    this.idleTimer = rng() * 4;
    this.zone = null;
    this.rng = rng;
    this._speed01 = 0;
    this.bubble = null;      // { text, timer }
    this.chatCooldown = rng() * 6;
    this.name = null;

    // Everyone in the valley can be attacked, and answers for it. Students are
    // apprentices, not fiends: they break and run before they draw a wand.
    this.hp = 55;
    this.maxHp = 55;
    this.dead = false;
    this.removed = false;
    this.mood = 'calm';       // calm | fleeing | hostile | yielded
    this.alarmTimer = 0;
    this.castTimer = 0;
    this.staggerTimer = 0;
    this.burnTimer = 0;
    this.frozenTimer = 0;
    this.knockback = new THREE.Vector3();
    this.onHarmed = null;     // wired by NPCManager, feeds the karma gauges
    this.onSlain = null;
  }

  get displayName() {
    return this.isMerchant ? 'BRAMWELL'
      : this.isProfessor ? 'PROFESSOR MAELIS' : 'APPRENTICE';
  }

  // Damage interface shared with the fiends, so every spell reaches them
  // without the spell system needing to know who it is hitting.
  takeHit(damage, dir = null, knockback = 0) {
    if (this.dead || this.mood === 'yielded') return;
    const wasCalm = this.mood === 'calm';
    this.hp -= damage;
    this.staggerTimer = Math.max(this.staggerTimer, 0.35);
    if (dir && knockback) this.knockback.addScaledVector(dir, knockback * 0.32);
    this.sitting = false;
    this.onHarmed?.(this, damage, wasCalm);
    if (this.hp <= 0) {
      if (this.essential) this._yield();
      else this._die();
      return;
    }
    if (this.mood !== 'hostile') {
      this.mood = this.willFight ? 'hostile' : 'fleeing';
      this.alarmTimer = 16;
      if (wasCalm) this.say(this.willFight ? 'Then you leave me no choice!' : 'Help! Someone, help!', 3.5);
    }
  }

  applyBurn(seconds) {
    if (this.dead) return;
    this.burnTimer = Math.max(this.burnTimer, seconds);
  }

  applyFreeze(seconds) {
    if (this.dead) return;
    this.frozenTimer = Math.max(this.frozenTimer, seconds);
    this.burnTimer = 0;
  }

  // Quest-critical people (the professor, the trader) do not die — they give
  // in and withdraw. Killing them outright would leave the story unfinishable,
  // which is a harsher punishment than the design is trying to hand out.
  _yield() {
    this.mood = 'yielded';
    this.hp = 1;
    this.alarmTimer = 45;
    this.say('Enough! Enough — I want no part of this.', 5);
  }

  _die() {
    this.dead = true;
    this.fallT = 0;
    this.lootable = true;   // the body stays until it is searched
    this.deathTimer = Infinity;
    this.bubble = null;
    this.onSlain?.(this);
  }

  // Crumple where they stood. The body is left face-down and searchable; only
  // once it has been stripped (or given up on) does it sink away.
  _updateFallen(dt) {
    this.fallT = Math.min(1, this.fallT + dt * 2.2);
    const root = this.model.root;
    root.rotation.x = -this.fallT * Math.PI * 0.5;
    root.position.copy(this.position);
    if (this.deathTimer !== Infinity) {
      this.deathTimer -= dt;
      root.position.y = this.position.y - Math.max(0, (1 - this.deathTimer / 1.6)) * 2.4;
      if (this.deathTimer <= 0) {
        root.parent?.remove(root);
        this.removed = true;
      }
    }
  }

  // What is on them. Students carry little; what makes it worth doing is the
  // chance of the robe off their back.
  loot() {
    if (!this.lootable) return null;
    this.lootable = false;
    this.deathTimer = 2.2; // now it sinks
    const r = this.rng;
    const out = { crowns: 6 + Math.floor(r() * 22), items: {}, gear: null };
    if (r() < 0.55) out.items.emberCap = 1;
    if (r() < 0.55) out.items.frostLeaf = 1;
    if (r() < 0.2) out.items.aetherDust = 1;
    if (r() < 0.3) out.items.healPotion = 1;
    // One in six is carrying something worth having
    if (r() < 0.17) {
      const pool = ['wandElm', 'amuletBrass', 'robeCrimson', 'robeMoss', 'amuletTide'];
      out.gear = pool[Math.floor(r() * pool.length)];
    }
    return out;
  }

  // Shared tail of every behaviour: drive the rig from a mode and a speed.
  _settleModel(dt, mode, speed01) {
    this._speed01 = THREE.MathUtils.lerp(this._speed01, speed01, 1 - Math.exp(-6 * dt));
    this.position.y = this.world.groundHeight(this.position.x, this.position.z);
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.facing;
    this.model.animate(dt, { mode, speed01: this._speed01 });
  }

  _faceTowards(dx, dz, dt, rate = 9) {
    const want = Math.atan2(dx, dz);
    let d = want - this.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.facing += d * (1 - Math.exp(-rate * dt));
  }

  // Break and run, straight away from whatever just hit them.
  _flee(dt, playerPos) {
    if (!playerPos) return this._settleModel(dt, 'idle', 0);
    const dx = this.position.x - playerPos.x;
    const dz = this.position.z - playerPos.z;
    const d = Math.hypot(dx, dz) || 1;
    const speed = 5.2;
    this.position.x += (dx / d) * speed * dt;
    this.position.z += (dz / d) * speed * dt;
    this.world.resolveCollisions(this.position, 0.4, 1.7);
    this._faceTowards(dx, dz, dt, 11);
    this._settleModel(dt, 'move', 0.85);
  }

  // Apprentices fight the way they were taught: hold the line at a wand's
  // range, keep moving, and throw a bolt whenever the count comes round.
  _fight(dt, elapsed, playerPos) {
    if (!playerPos) return this._settleModel(dt, 'idle', 0);
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    // Lost them: give up the chase and go back to the day
    if (d > 60) {
      this.mood = 'calm';
      this.target = null;
      this.zone = null;
      return this._settleModel(dt, 'idle', 0);
    }
    const HOLD = 11;
    let speed01 = 0;
    // Close in, back off, and strafe so a fight is not a staring contest
    const drive = d > HOLD + 1.5 ? 1 : d < HOLD - 2 ? -1 : 0;
    const step = 3.4 * drive * dt;
    if (drive) {
      this.position.x += (dx / d) * step;
      this.position.z += (dz / d) * step;
      speed01 = 0.5;
    }
    const strafe = Math.sin(elapsed * 0.7 + this.facing) * 2.2 * dt;
    this.position.x += (-dz / d) * strafe;
    this.position.z += (dx / d) * strafe;
    speed01 = Math.max(speed01, 0.28);
    this.world.resolveCollisions(this.position, 0.4, 1.7);
    this._faceTowards(dx, dz, dt);

    this.castTimer -= dt;
    if (this.castTimer <= 0 && this.combat) {
      this.castTimer = 2.2 + this.rng() * 1.6;
      const origin = new THREE.Vector3(this.position.x, this.position.y + 1.5, this.position.z);
      const aim = new THREE.Vector3(playerPos.x, playerPos.y + 1.0, playerPos.z)
        .sub(origin).normalize();
      this.combat.fireEnemyBolt(origin, aim.multiplyScalar(26), this);
      this.model.triggerCast();
    }
    this._settleModel(dt, speed01 > 0.35 ? 'move' : 'idle', speed01);
  }

  say(text, seconds = 4) {
    this.bubble = { text, timer: seconds };
  }

  // Head position for projecting the speech bubble
  headPosition(out) {
    return out.set(this.position.x, this.position.y + (this.sitting ? 1.5 : 2.05), this.position.z);
  }

  placeAt(x, z) {
    this.position.set(x, this.world.groundHeight(x, z), z);
  }

  // Walk to `dest`, prefixed by the zone's doorway chain when still outside.
  setRoute(zoneDef, dest) {
    this.waypoints = [];
    if (zoneDef.via && !this.world.castle.isInsideHall(this.position)) {
      for (const v of zoneDef.via) this.waypoints.push(new THREE.Vector2(v.x, v.z));
    }
    this.waypoints.push(dest);
    this.target = this.waypoints.shift();
  }

  pickTargetInZone(zone) {
    const z = ZONES[zone];
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng());
    this.setRoute(z, new THREE.Vector2(
      z.x + Math.cos(a) * r * (z.rx ?? z.r),
      z.z + Math.sin(a) * r * (z.rz ?? z.r)));
  }

  update(dt, elapsed, hour, playerPos = null, viewPos = null) {
    // Detail — and how often this student is worth thinking about — falls off
    // with distance. Past the cull line they still walk their schedule, just
    // four times a second instead of sixty, so the world stays consistent.
    if (viewPos && OPTIMIZED) {
      const d2 = this.position.distanceToSquared(viewPos);
      this.model.setDetail(d2 > 150 * 150 ? -1 : d2 > 70 * 70 ? 0 : d2 > 25 * 25 ? 1 : 2);
      if (d2 > 150 * 150) {
        this._offscreenDt = (this._offscreenDt ?? 0) + dt;
        if (this._offscreenDt < 0.25) return;
        dt = this._offscreenDt;
        this._offscreenDt = 0;
      }
    }
    if (this.dead) return this._updateFallen(dt);

    if (this.bubble) {
      this.bubble.timer -= dt;
      if (this.bubble.timer <= 0) this.bubble = null;
    }
    if (this.chatCooldown > 0) this.chatCooldown -= dt;

    // Burning, frozen, staggered, shoved — same states the fiends carry
    if (this.burnTimer > 0) {
      this.burnTimer -= dt;
      this.hp -= 5 * dt;
      if (this.hp <= 0) { if (this.essential) this._yield(); else this._die(); return; }
    }
    if (this.frozenTimer > 0) this.frozenTimer -= dt;
    if (this.staggerTimer > 0) this.staggerTimer -= dt;
    if (this.knockback.lengthSq() > 0.0001) {
      this.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.exp(-6 * dt));
      this.world.resolveCollisions(this.position, 0.4, 1.7);
    }
    // Robe glows hot while burning — only touched on the transition, since
    // setPalette writes shared material colours
    const burning = this.burnTimer > 0;
    if (burning !== this._burnTint) {
      this._burnTint = burning;
      this.model.setPalette({ robe: burning ? 0xff7a3c : this._palette.robe });
    }

    if (this.alarmTimer > 0) this.alarmTimer -= dt;
    // Frozen or reeling, they can only stand there and take it
    if (this.frozenTimer > 0 || this.staggerTimer > 0) {
      this._settleModel(dt, 'idle', 0);
      return;
    }
    if (this.mood === 'hostile') return this._fight(dt, elapsed, playerPos);
    if (this.mood === 'fleeing' || this.mood === 'yielded') {
      if (this.alarmTimer > 0) return this._flee(dt, playerPos);
      this.mood = 'calm';       // calmed down; back to the daily round
      this.target = null;
      this.zone = null;
    }

    if (this.isProfessor) {
      // The professor holds post near the gate, idly turning
      this.model.root.position.copy(this.position);
      this.model.root.rotation.y = this.facing;
      this.model.animate(dt, { mode: 'idle', speed01: 0 });
      return;
    }

    const wantZone = zoneForHour(hour);
    if (wantZone !== this.zone) {
      this.zone = wantZone;
      this.sitting = false;
      // Lessons: head for an assigned bench seat rather than wandering
      if (wantZone === 'hall' && this.seat) {
        this.setRoute(ZONES.hall, new THREE.Vector2(this.seat.x, this.seat.z));
      } else {
        this.pickTargetInZone(wantZone);
      }
    }

    // Seated: locked to the bench, playing the sit pose
    if (this.sitting) {
      this.model.root.position.set(this.seat.x, this.seat.y, this.seat.z);
      this.model.root.rotation.y = this.seat.facing;
      this.model.animate(dt, { mode: 'sit', speed01: 0 });
      return;
    }

    let speed01 = 0;
    if (this.target) {
      const dx = this.target.x - this.position.x;
      const dz = this.target.y - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.8) {
        const vx = (dx / dist) * this.speed;
        const vz = (dz / dist) * this.speed;
        this.position.x += vx * dt;
        this.position.z += vz * dt;
        // Stay out of walls and furniture
        this.world.resolveCollisions(this.position, 0.4, 1.7);
        const targetYaw = Math.atan2(dx, dz);
        let d = targetYaw - this.facing;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.facing += d * (1 - Math.exp(-8 * dt));
        speed01 = this.speed / 8.6;
      } else if (this.waypoints && this.waypoints.length) {
        this.target = this.waypoints.shift(); // next leg of the doorway route
      } else if (this.zone === 'hall' && this.seat &&
                 Math.hypot(this.position.x - this.seat.x, this.position.z - this.seat.z) < 1.6) {
        this.sitting = true; // arrived at the bench — take a seat
        this.target = null;
      } else {
        this.target = null;
        this.idleTimer = 2 + this.rng() * 6;
      }
    } else {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) this.pickTargetInZone(this.zone);
    }

    this.position.y = this.world.groundHeight(this.position.x, this.position.z);
    this._speed01 = THREE.MathUtils.lerp(this._speed01, speed01, 1 - Math.exp(-6 * dt));
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.facing;
    this.model.animate(dt, {
      mode: this._speed01 > 0.02 ? 'move' : 'idle',
      speed01: this._speed01,
    });
  }
}

export class NPCManager {
  constructor(scene, world, worldState = null) {
    this.world = world;
    this.worldState = worldState;
    this.npcs = [];
    this.weatherState = 'clear';
    this._head = new THREE.Vector3();
    const rng = makeRng(9090);
    const seats = (world.castle.hallSeats ?? []).filter((s) => s.inner);
    for (let i = 0; i < 10; i++) {
      const npc = new NPC(scene, world, rng);
      // Spread students across benches so lessons fill the hall evenly
      if (seats.length) npc.seat = seats[Math.floor((i * seats.length) / 10)];
      const zone = ZONES[zoneForHour(15)]; // spawn in the current-block zone
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * zone.r;
      npc.placeAt(zone.x + Math.cos(a) * r, zone.z + Math.sin(a) * r);
      this.npcs.push(npc);
    }
    // Bramwell the trader keeps the Mirefall market stall
    this.merchant = new NPC(scene, world, rng, true);
    this.merchant.isMerchant = true;
    this.merchant.essential = true;
    this.merchant.placeAt(142, 247); // beside the village stalls
    this.merchant.facing = Math.PI * 0.5;
    this.merchant.model.root.traverse((o) => {
      if (o.isMesh && o.material?.color) o.material = o.material.clone();
    });
    this.npcs.push(this.merchant);

    // Professor Maelis holds post by the gate — the first quest giver
    this.professor = new NPC(scene, world, rng, true);
    this.professor.essential = true;
    this.professor.hp = this.professor.maxHp = 140; // a tutor, not a first-year
    this.professor.placeAt(ZONES.gate.x + 3, ZONES.gate.z + 4);
    this.professor.facing = Math.PI; // faces the approach
    this.npcs.push(this.professor);
  }

  // Called by the spell system so player magic reaches people, not just fiends
  queryHits(point, radius) {
    const out = [];
    for (const n of this.npcs) {
      if (n.dead || n.mood === 'yielded') continue;
      if (this._chest(n).distanceTo(point) < radius + 0.7) out.push(n);
    }
    return out;
  }

  _chest(n) {
    return (this._cp ??= new THREE.Vector3())
      .set(n.position.x, n.position.y + 1.1, n.position.z);
  }

  update(dt, elapsed, hour, playerPos = null) {
    const viewPos = this.viewPos ?? playerPos;
    const outlawed = !!this.karma?.hostile;
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i];
      n.willFight = outlawed;
      // Once you are outlawed there is no walking past anyone: whoever sees
      // you draws. This is the permanent half of the karma system.
      if (outlawed && n.mood === 'calm' && !n.dead && playerPos &&
          n.position.distanceToSquared(playerPos) < 45 * 45) {
        n.mood = 'hostile';
      }
      n.update(dt, elapsed, hour, playerPos, viewPos);
      if (n.removed) this.npcs.splice(i, 1);
    }
    if (!playerPos || !this.worldState) return;

    // Approach greetings: one voice at a time, so a crowd never speaks in
    // chorus. The nearest eligible student remarks, then everyone holds off.
    this._greetGap = (this._greetGap ?? 0) - dt;
    if (this._greetGap > 0) return;

    let speaker = null, bestD = 7;
    for (const n of this.npcs) {
      if (n.isProfessor || n.bubble || n.chatCooldown > 0) continue;
      if (n.mood !== 'calm' || n.dead) continue; // nobody chats mid-fight
      const d = n.position.distanceTo(playerPos);
      if (d < bestD) { bestD = d; speaker = n; }
    }
    if (!speaker) return;

    // Don't echo a line that is already floating over someone's head
    const inUse = new Set(this.npcs.filter((n) => n.bubble).map((n) => n.bubble.text));
    let line = null;
    for (let i = 0; i < 6; i++) {
      const candidate = pickGreeting(this.worldState, hour, this.weatherState, speaker.rng);
      if (!inUse.has(candidate) && candidate !== this._lastLine) { line = candidate; break; }
      line = candidate;
    }
    speaker.say(line);
    this._lastLine = line;
    speaker.chatCooldown = 22 + speaker.rng() * 20;
    this._greetGap = 3.5 + speaker.rng() * 3;
  }

  // Nearest student within talking range, for the F prompt
  nearestMerchant(playerPos, range = 4.5) {
    const m = this.merchant;
    if (!m || m.dead || m.mood !== 'calm') return null; // no trade under a drawn wand
    return m.position.distanceTo(playerPos) < range ? m : null;
  }

  // Nearest body that still has something on it, for the F prompt
  nearestLootable(playerPos, range = 3.0) {
    let best = null, bestD = range;
    for (const n of this.npcs) {
      if (!n.lootable) continue;
      const d = n.position.distanceTo(playerPos);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  // The quest giver, if he is still willing to speak to you
  availableProfessor(playerPos, range = 4.5) {
    const p = this.professor;
    if (!p || p.dead || p.mood !== 'calm') return null;
    return p.position.distanceTo(playerPos) < range ? p : null;
  }

  nearestSpeaker(playerPos, range = 4.5) {
    let best = null, bestD = range;
    for (const n of this.npcs) {
      if (n.isProfessor || n.dead || n.mood !== 'calm') continue;
      const d = n.position.distanceTo(playerPos);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  converse(npc) {
    npc.say(pickConversation(this.worldState), 7);
    npc.chatCooldown = 20;
  }

  // Bubbles that are currently visible, with head positions for projection
  activeBubbles() {
    const out = [];
    for (const n of this.npcs) {
      if (!n.bubble) continue;
      out.push({ text: n.bubble.text, pos: n.headPosition(new THREE.Vector3()), timer: n.bubble.timer });
    }
    return out;
  }
}
