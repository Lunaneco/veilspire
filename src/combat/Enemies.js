import * as THREE from 'three';

// Wisp-fiends: corrupted floating spirits that haunt the forest edge.
// AI states: patrol -> aggro (approach) -> attack (ranged shadow bolt),
// with stagger on hit and a shard-burst death.

const CORE_MAT = new THREE.MeshStandardMaterial({
  color: 0x1c1228, roughness: 0.4, metalness: 0.1,
  emissive: 0x7a3adf, emissiveIntensity: 1.5,
});
const SHARD_MAT = new THREE.MeshStandardMaterial({ color: 0x1c1626, roughness: 0.7, metalness: 0.3 });
const BOLT_MAT = new THREE.MeshBasicMaterial({ color: 0xc06aff });
BOLT_MAT.toneMapped = false;

const AGGRO_RANGE = 30;
const ATTACK_RANGE = 18;
const BOLT_SPEED = 22;

export class WispFiend {
  constructor(scene, world, x, z) {
    this.world = world;
    this.scene = scene;
    this.group = new THREE.Group();

    this.coreMat = CORE_MAT.clone(); // per-enemy so freeze/burn/flash tint individually
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), this.coreMat);
    this.core.castShadow = true;
    this.group.add(this.core);

    this.shards = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16 + Math.random() * 0.1), SHARD_MAT);
      s.userData.orbit = {
        r: 0.75 + Math.random() * 0.3,
        speed: 0.8 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        tilt: Math.random() * Math.PI,
      };
      s.castShadow = true;
      this.group.add(s);
      this.shards.push(s);
    }

    this.homeX = x;
    this.homeZ = z;
    this.position = new THREE.Vector3(x, 0, z);
    this.position.y = world.groundHeight(x, z) + 1.8;
    this.group.position.copy(this.position);
    scene.add(this.group);

    this.hp = 100;
    this.maxHp = 100;
    this.state = 'patrol';
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.staggerTimer = 0;
    this.attackCooldown = 1 + Math.random() * 2;
    this.flashTimer = 0;
    this.burnTimer = 0;
    this.frozenTimer = 0;
    this.dead = false;
    this.deathTimer = 0;
    this.knockback = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  takeHit(damage, fromDir, knockbackForce = 6) {
    if (this.dead) return;
    this.hp -= damage;
    this.flashTimer = 0.15;
    this.staggerTimer = Math.max(this.staggerTimer, 0.45);
    this.knockback.addScaledVector(fromDir, knockbackForce);
    if (this.hp <= 0) {
      this.dead = true;
      this.deathTimer = 0.9;
      this.state = 'dying';
    } else {
      this.state = 'aggro';
    }
  }

  applyBurn(seconds) {
    this.burnTimer = Math.max(this.burnTimer, seconds);
  }

  applyFreeze(seconds) {
    if (this.dead) return;
    this.frozenTimer = Math.max(this.frozenTimer, seconds);
    this.burnTimer = 0; // frost quenches burn
  }

  update(dt, elapsed, player, fireBolt, spawnBurst) {
    if (this.dead) {
      this.deathTimer -= dt;
      const t = Math.max(this.deathTimer / 0.9, 0);
      // Shards fly outward, core collapses
      for (const s of this.shards) {
        const o = s.userData.orbit;
        o.r += dt * 14;
        s.position.set(
          Math.cos(elapsed * o.speed + o.phase) * o.r,
          Math.sin(elapsed * o.speed * 0.7 + o.tilt) * o.r * 0.6,
          Math.sin(elapsed * o.speed + o.phase) * o.r);
        s.scale.setScalar(Math.max(t, 0.01));
      }
      this.core.scale.setScalar(Math.max(t * t, 0.01));
      this.coreMat.emissiveIntensity = 1.5 + (1 - t) * 6;
      if (this.deathTimer <= 0 && !this.removed) {
        this.removed = true;
        spawnBurst(this.position, 42, 9, 0xc06aff);
        this.scene.remove(this.group);
        this.onKilled?.();
      }
      return;
    }

    // Burn DoT
    if (this.burnTimer > 0) {
      this.burnTimer -= dt;
      this.hp -= 6 * dt;
      if (this.hp <= 0) this.takeHit(0, this._tmp.set(0, 1, 0), 0);
    }
    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.staggerTimer > 0) this.staggerTimer -= dt;

    // Frozen: locked in place, no attacks, icy tint
    if (this.frozenTimer > 0) {
      this.frozenTimer -= dt;
      this.coreMat.emissive.setHex(0x6ab8e8);
      this.coreMat.emissiveIntensity = 1.0;
      this.core.scale.setScalar(1.05);
      this.group.position.copy(this.position);
      return;
    }
    this.coreMat.emissive.setHex(this.burnTimer > 0 ? 0xff8a3c : 0x7a3adf);
    this.coreMat.emissiveIntensity = this.flashTimer > 0 ? 4 : 1.5;

    const toPlayer = this._tmp.copy(player.position).sub(this.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();

    // State transitions
    if (this.state === 'patrol' && dist < AGGRO_RANGE) this.state = 'aggro';
    if (this.state === 'aggro' && dist > AGGRO_RANGE * 1.8) this.state = 'patrol';

    let moveX = 0, moveZ = 0;
    const speed = this.state === 'aggro' ? 5.2 : 1.6;
    if (this.staggerTimer <= 0) {
      if (this.state === 'patrol') {
        this.patrolAngle += dt * 0.3;
        const tx = this.homeX + Math.cos(this.patrolAngle) * 8;
        const tz = this.homeZ + Math.sin(this.patrolAngle) * 8;
        moveX = tx - this.position.x;
        moveZ = tz - this.position.z;
        const l = Math.hypot(moveX, moveZ) || 1;
        moveX /= l; moveZ /= l;
      } else if (this.state === 'aggro') {
        const dir = toPlayer.normalize();
        if (dist > ATTACK_RANGE) {
          moveX = dir.x; moveZ = dir.z;
        } else if (dist < ATTACK_RANGE * 0.55) {
          moveX = -dir.x; moveZ = -dir.z; // keep distance
        } else {
          // strafe orbit
          moveX = -dir.z * 0.6; moveZ = dir.x * 0.6;
        }
        // Attack
        this.attackCooldown -= dt;
        if (this.attackCooldown <= 0 && dist < ATTACK_RANGE * 1.2) {
          this.attackCooldown = 2.2 + Math.random() * 0.8;
          const origin = this.position.clone();
          const target = player.position.clone();
          target.y += 1.2;
          const vel = target.sub(origin).normalize().multiplyScalar(BOLT_SPEED);
          fireBolt(origin, vel, this);
        }
      }
    }

    this.position.x += (moveX * speed + this.knockback.x) * dt;
    this.position.z += (moveZ * speed + this.knockback.z) * dt;
    this.knockback.multiplyScalar(Math.exp(-4 * dt));

    // Hover height with bob
    const groundY = this.world.groundHeight(this.position.x, this.position.z);
    const targetY = groundY + 1.8 + Math.sin(elapsed * 2 + this.patrolAngle) * 0.25;
    this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, 1 - Math.exp(-5 * dt));

    this.group.position.copy(this.position);

    // Shard orbits (rattle when staggered)
    const rattle = this.staggerTimer > 0 ? 3 : 1;
    for (const s of this.shards) {
      const o = s.userData.orbit;
      s.position.set(
        Math.cos(elapsed * o.speed * rattle + o.phase) * o.r,
        Math.sin(elapsed * o.speed * 0.7 * rattle + o.tilt) * o.r * 0.6,
        Math.sin(elapsed * o.speed * rattle + o.phase) * o.r);
      s.rotation.x = elapsed * o.speed;
      s.rotation.y = elapsed * o.speed * 0.7;
    }

    this.core.scale.setScalar(1 + (this.flashTimer > 0 ? 0.25 : 0) + Math.sin(elapsed * 5) * 0.04);
  }
}

// Stone Golem: slow melee bruiser. Closes distance, winds up a ground slam
// that shakes the camera and damages in a radius. Heavy armour halves ranged
// damage, but frost cracks it (takes full damage while frozen).
const GOLEM_STONE = new THREE.MeshStandardMaterial({ color: 0x6e6a63, roughness: 0.95, flatShading: true });
const GOLEM_CORE = new THREE.MeshStandardMaterial({
  color: 0x3a2418, roughness: 0.5, emissive: 0xff6a2a, emissiveIntensity: 1.8,
});

export class StoneGolem {
  constructor(scene, world, x, z) {
    this.world = world;
    this.scene = scene;
    this.group = new THREE.Group();
    this.isGolem = true;

    const mat = GOLEM_STONE.clone();
    this.mat = mat;
    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 0), mat);
    torso.scale.set(1, 1.15, 0.85);
    torso.position.y = 1.75;
    torso.castShadow = true;
    this.group.add(torso);
    this.torso = torso;

    this.coreMat = GOLEM_CORE.clone();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), this.coreMat);
    core.position.set(0, 1.85, 0.7);
    this.group.add(core);
    this.core = core;

    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), mat);
    head.position.y = 3.0;
    head.castShadow = true;
    this.group.add(head);

    this.arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 1.15, 2.35, 0);
      this.group.add(shoulder);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), mat);
      upper.position.y = -0.5;
      upper.castShadow = true;
      shoulder.add(upper);
      const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), mat);
      fist.position.y = -1.25;
      fist.castShadow = true;
      shoulder.add(fist);
      this.arms.push(shoulder);
    }
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.45, 1.15, 0);
      this.group.add(hip);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.15, 0.55), mat);
      leg.position.y = -0.58;
      leg.castShadow = true;
      hip.add(leg);
      this.legs.push(hip);
    }

    this.homeX = x; this.homeZ = z;
    this.position = new THREE.Vector3(x, world.groundHeight(x, z), z);
    this.group.position.copy(this.position);
    scene.add(this.group);

    this.hp = 260;
    this.maxHp = 260;
    this.state = 'idle';
    this.facing = 0;
    this.staggerTimer = 0;
    this.flashTimer = 0;
    this.burnTimer = 0;
    this.frozenTimer = 0;
    this.windupTimer = 0;
    this.slamCooldown = 2;
    this.knockback = new THREE.Vector3();
    this.dead = false;
    this.deathTimer = 0;
    this._tmp = new THREE.Vector3();
  }

  takeHit(damage, fromDir, knockbackForce = 6) {
    if (this.dead) return;
    // Armoured: ranged chip damage halved unless frozen solid
    const armour = this.frozenTimer > 0 ? 1 : 0.55;
    this.hp -= damage * armour;
    this.flashTimer = 0.15;
    this.knockback.addScaledVector(fromDir, knockbackForce * 0.22); // heavy
    if (this.hp <= 0) {
      this.dead = true;
      this.deathTimer = 1.2;
      this.state = 'dying';
    } else if (damage > 25) {
      this.staggerTimer = Math.max(this.staggerTimer, 0.5);
      this.windupTimer = 0; // heavy hits interrupt the slam
    }
  }

  applyBurn(seconds) { this.burnTimer = Math.max(this.burnTimer, seconds); }
  applyFreeze(seconds) {
    if (this.dead) return;
    this.frozenTimer = Math.max(this.frozenTimer, seconds * 0.6); // resists
    this.burnTimer = 0;
  }

  update(dt, elapsed, player, fireBolt, spawnBurst, onSlam) {
    if (this.dead) {
      this.deathTimer -= dt;
      const t = Math.max(this.deathTimer / 1.2, 0);
      // Crumbles: sinks and breaks apart
      this.group.position.y = this.position.y - (1 - t) * 1.6;
      this.group.rotation.z = (1 - t) * 0.5;
      this.coreMat.emissiveIntensity = 1.8 * t;
      for (const a of this.arms) a.rotation.x = (1 - t) * 1.4;
      if (this.deathTimer <= 0 && !this.removed) {
        this.removed = true;
        spawnBurst(this.position.clone().setY(this.position.y + 1.4), 60, 7, 0x8a7f70);
        this.scene.remove(this.group);
        this.onKilled?.();
      }
      return;
    }

    if (this.burnTimer > 0) { this.burnTimer -= dt; this.hp -= 4 * dt; }
    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.staggerTimer > 0) this.staggerTimer -= dt;
    this.slamCooldown -= dt;

    if (this.frozenTimer > 0) {
      this.frozenTimer -= dt;
      this.coreMat.emissive.setHex(0x6ab8e8);
      this.mat.color.setHex(0x8fb6cc);
      this.group.position.copy(this.position);
      return;
    }
    this.mat.color.setHex(this.flashTimer > 0 ? 0xd8cfc4 : 0x6e6a63);
    this.coreMat.emissive.setHex(this.burnTimer > 0 ? 0xffa03c : 0xff6a2a);

    const to = this._tmp.copy(player.position).sub(this.position);
    to.y = 0;
    const dist = to.length();
    to.normalize();

    if (dist < 26) {
      const targetYaw = Math.atan2(to.x, to.z);
      let d = targetYaw - this.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.facing += d * (1 - Math.exp(-3.5 * dt)); // ponderous turn
    }

    let walking = false;
    if (this.windupTimer > 0) {
      // Telegraphed slam: arms rise, then crash down
      this.windupTimer -= dt;
      const t = 1 - this.windupTimer / 0.9;
      for (const a of this.arms) a.rotation.x = -Math.min(t * 3.2, 2.4);
      if (this.windupTimer <= 0) {
        for (const a of this.arms) a.rotation.x = 0.5;
        onSlam(this.position.clone(), 5.5);
        this.slamCooldown = 3.4;
      }
    } else if (this.staggerTimer > 0) {
      for (const a of this.arms) a.rotation.x = Math.sin(elapsed * 22) * 0.25;
    } else if (dist < 3.6 && this.slamCooldown <= 0) {
      this.windupTimer = 0.9;
    } else if (dist < 26 && dist > 2.6) {
      // Lumber toward the player
      const speed = 2.4;
      this.position.x += to.x * speed * dt;
      this.position.z += to.z * speed * dt;
      walking = true;
      for (const a of this.arms) a.rotation.x = Math.sin(elapsed * 3.2) * 0.35;
    } else {
      for (const a of this.arms) a.rotation.x *= Math.exp(-3 * dt);
    }

    this.position.x += this.knockback.x * dt;
    this.position.z += this.knockback.z * dt;
    this.knockback.multiplyScalar(Math.exp(-6 * dt));
    this.position.y = this.world.groundHeight(this.position.x, this.position.z);

    // Heavy gait
    const stride = walking ? Math.sin(elapsed * 3.2) : 0;
    this.legs[0].rotation.x = stride * 0.5;
    this.legs[1].rotation.x = -stride * 0.5;
    this.group.position.copy(this.position);
    this.group.position.y += walking ? Math.abs(Math.cos(elapsed * 3.2)) * 0.09 : 0;
    this.group.rotation.y = this.facing;
    this.core.scale.setScalar(1 + Math.sin(elapsed * 2.4) * 0.08 + (this.flashTimer > 0 ? 0.3 : 0));
  }
}

export class EnemyManager {
  constructor(scene, world, player, spells, hud) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.spells = spells;
    this.hud = hud;
    this.enemies = [];
    this.enemyBolts = [];

    this.boltGeo = new THREE.SphereGeometry(0.16, 8, 6);

    // Spawn packs at the forest edge, east and south of the path
    const spots = [
      [58, 52], [66, 44], [50, 66],
      [88, -8], [96, 2],
      [-52, 70], [-44, 82],
    ];
    for (const [x, z] of spots) {
      const e = new WispFiend(scene, world, x, z);
      e.onKilled = () => this.onEnemyKilled?.(e);
      this.enemies.push(e);
    }
    // Golems guard the deeper woods — heavier fights that reward frost
    for (const [x, z] of [[112, 78], [-96, 128], [136, -96]]) {
      const g = new StoneGolem(scene, world, x, z);
      g.onKilled = () => this.onEnemyKilled?.(g);
      this.enemies.push(g);
    }
  }

  // Golem ground slam: shockwave ring, debris, camera kick, radial damage
  golemSlam(origin, radius) {
    this.spells.spawnBurst(origin.clone().setY(origin.y + 0.3), 46, 8, 0xa89880, 1.1);
    this.spells.addScorch(origin, radius * 0.55);
    this.spells.onShake?.(0.42);
    this.spells.audio?.impact(1.5, origin);
    const d = this.player.position.distanceTo(origin);
    if (d < radius) {
      const hitPoint = this.player.position.clone().setY(this.player.position.y + 1.1);
      if (this.spells.wardActive) {
        // A last-moment ward parries the shockwave outright
        if (!this.spells.tryCounter(hitPoint, null, null)) {
          this.spells.wardFlash();
          this.player.mana = Math.max(0, this.player.mana - 14);
          this.spells.addUlt(6);
        }
      } else {
        this.player.takeDamage(20);
        this.spells.addUlt(10);
      }
    }
  }

  fireEnemyBolt(origin, vel, owner = null) {
    const mesh = new THREE.Mesh(this.boltGeo, BOLT_MAT);
    mesh.position.copy(origin);
    const light = new THREE.PointLight(0xc06aff, 6, 8, 2);
    mesh.add(light);
    this.scene.add(mesh);
    this.enemyBolts.push({ mesh, vel: vel.clone(), life: 3, owner });
  }

  update(dt, elapsed) {
    const fireBolt = (o, v, owner) => this.fireEnemyBolt(o, v, owner);
    const burst = (p, n, s, c) => this.spells.spawnBurst(p, n, s, c);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, elapsed, this.player, fireBolt, burst, (o, r) => this.golemSlam(o, r));
      if (e.removed) this.enemies.splice(i, 1);
    }

    // Enemy bolts: move, collide with player / ward / terrain
    for (let i = this.enemyBolts.length - 1; i >= 0; i--) {
      const b = this.enemyBolts[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      const p = b.mesh.position;
      let done = b.life <= 0;

      if (!done && p.y < this.world.groundHeight(p.x, p.z) + 0.1) {
        this.spells.spawnBurst(p, 10, 4, 0xc06aff);
        done = true;
      }
      if (!done) {
        const toPlayer = p.distanceTo(this.player.position.clone().setY(this.player.position.y + 1.1));
        if (this.spells.wardActive && toPlayer < 1.6) {
          // A ward raised at the last moment parries and reflects instead
          if (!this.spells.tryCounter(p.clone(), b.owner, b.vel)) {
            this.spells.wardFlash();
            this.spells.spawnBurst(p, 16, 5, 0x7fb8ff);
            this.player.mana = Math.max(0, this.player.mana - 6);
            this.spells.addUlt(4);
          }
          done = true;
        } else if (toPlayer < 0.9) {
          this.player.takeDamage(9);
          this.spells.spawnBurst(p, 14, 5, 0xc06aff);
          this.spells.onShake?.(0.22);
          this.spells.addUlt(8);
          done = true;
        }
      }
      if (done) {
        this.scene.remove(b.mesh);
        this.enemyBolts.splice(i, 1);
      }
    }
  }

  _golemPoint(e) {
    return (this._gp ??= new THREE.Vector3()).set(e.position.x, e.position.y + 1.8, e.position.z);
  }

  // For player spells: find enemies within radius of a point
  queryHits(point, radius) {
    const out = [];
    for (const e of this.enemies) {
      // Golems are large: measure to their torso, with a fatter hit radius
      const r = radius + (e.isGolem ? 1.6 : 0.8);
      const p = e.isGolem ? this._golemPoint(e) : e.position;
      if (!e.dead && p.distanceTo(point) < r) out.push(e);
    }
    return out;
  }
}
