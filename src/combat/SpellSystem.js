import * as THREE from 'three';

// First two spells: Arc Bolt (LMB projectile) and Ward (RMB shield bubble).
// Projectiles carry a point light + trail sprite; impacts spawn a particle
// burst, a light flash, and a brief camera shake via the shake callback.

const BOLT_SPEED = 42;
const BOLT_LIFE = 2.2;
const MAX_PARTICLES = 600;
const OATH_COST = 35; // virtue spent per Oathlight

export class SpellSystem {
  constructor(scene, world, player, camera, input) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.camera = camera;
    this.input = input;
    this.onShake = null; // set by main to trigger camera shake
    this.enemies = null; // EnemyManager, wired in main
    this.props = null;   // PropManager, wired in main
    this.heldProp = null;
    // Counter window: a ward raised this recently turns a hit into a parry
    this.wardRaisedAt = -99;
    this.COUNTER_WINDOW = 0.32;
    this.onCounter = null;
    // Veilbreak: charges from damage dealt and taken
    this.ult = 0;
    this.ultMax = 100;
    this.ultActive = 0;

    this.bolts = [];
    this.cooldown = 0;
    this.pushCooldown = 0;
    this.emberCooldown = 0;
    this.frostCooldown = 0;
    // The two karma spells (see castOathlight / castBloodtithe)
    this.karma = null;   // wired in main
    this.oathCooldown = 0;
    this.tetheCooldown = 0;
    this.blessing = 0;   // Oathlight afterglow: stronger bolts, free wards
    this.blessPower = 0;
    this.lockTarget = null;
    this.decals = [];

    // Shared assets
    this.boltGeo = new THREE.SphereGeometry(0.12, 10, 8);
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
    this.boltMat.toneMapped = false;

    // Particle pool (Points)
    const pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMaxLife = new Float32Array(MAX_PARTICLES);
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const pMat = new THREE.PointsMaterial({
      vertexColors: true, size: 0.16, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    pMat.toneMapped = false;
    this.points = new THREE.Points(pGeo, pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pCursor = 0;
    // Park dead particles far underground
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -9999;

    // Ward shield
    this.ward = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0x7fb8ff, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    this.ward.material.toneMapped = false;
    scene.add(this.ward);
    this.wardActive = false;

    this._ray = new THREE.Raycaster();
    this._aimDir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    // Scorch decal texture (radial gradient, generated once)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, 'rgba(20,14,10,0.85)');
    grad.addColorStop(0.55, 'rgba(30,22,16,0.5)');
    grad.addColorStop(1, 'rgba(30,22,16,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    this.decalTex = new THREE.CanvasTexture(cv);
    this.decalGeo = new THREE.CircleGeometry(1, 20);

    // Force Push ring visual
    this.pushRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.12, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0, depthWrite: false })
    );
    this.pushRing.material.toneMapped = false;
    this.pushRing.visible = false;
    scene.add(this.pushRing);
    this.pushRingT = 1; // 0..1 animating

    this._wardFlash = 0;
  }

  wardFlash() {
    this._wardFlash = 0.25;
  }

  // True when the ward went up inside the counter window — a parry, not a block
  get counterReady() {
    return this.wardActive && (this._clock ?? 0) - this.wardRaisedAt < this.COUNTER_WINDOW;
  }

  // Called when something the ward can catch arrives. Returns true if parried.
  tryCounter(point, sourceEnemy = null, incomingVel = null) {
    if (!this.counterReady) return false;
    this.wardFlash();
    this.spawnBurst(point, 34, 8, 0xfff0b0, 0.9);
    this.onShake?.(0.24);
    this.audio?.impact(0.9, point);
    this.addUlt(14);
    // Reflect: send it back as a fast bolt aimed at whoever threw it
    if (sourceEnemy && !sourceEnemy.dead) {
      const dir = sourceEnemy.position.clone().sub(point).normalize();
      const mesh = new THREE.Mesh(this.boltGeo, this.boltMat);
      mesh.position.copy(point);
      const light = new THREE.PointLight(0xffe58f, 14, 16, 2);
      mesh.add(light);
      this.scene.add(mesh);
      this.bolts.push({ mesh, vel: dir.multiplyScalar(52), life: 1.6, light, reflected: true });
    } else if (incomingVel) {
      const mesh = new THREE.Mesh(this.boltGeo, this.boltMat);
      mesh.position.copy(point);
      const light = new THREE.PointLight(0xffe58f, 14, 16, 2);
      mesh.add(light);
      this.scene.add(mesh);
      this.bolts.push({
        mesh, vel: incomingVel.clone().multiplyScalar(-2), life: 1.6, light, reflected: true,
      });
    }
    this.onCounter?.();
    return true;
  }

  // Every damaging spell asks here who it caught. Fiends and people answer the
  // same interface (takeHit / applyBurn / applyFreeze), so magic does not
  // politely stop at the edge of a robe — hit a student and you hit a student.
  _hits(point, radius) {
    if (!this.enemies) return [];
    const hits = this.enemies.queryHits(point, radius);
    const bystanders = this.bystanders?.queryHits(point, radius);
    return bystanders?.length ? hits.concat(bystanders) : hits;
  }

  addUlt(n) {
    if (this.ultActive > 0) return;
    this.ult = Math.min(this.ultMax, this.ult + n);
  }

  // Veilbreak: a rift that stuns and shatters everything near the caster
  castUltimate() {
    if (this.ult < this.ultMax || this.ultActive > 0) return false;
    this.ult = 0;
    this.ultActive = 1.9;
    this.player.model.triggerCast();
    this.onShake?.(0.7);
    this.audio?.impact(1.9, this.player.position);
    this.audio?.castWhoosh(0.35, this.player.position);

    const origin = this.player.position.clone();
    origin.y += 0.4;
    this.addScorch(origin, 7.5);
    for (let ring = 0; ring < 4; ring++) {
      this.spawnBurst(origin, 60, 7 + ring * 4, ring % 2 ? 0xc9a6ff : 0x9fd8ff, 1.3);
    }
    const flare = new THREE.PointLight(0xb090ff, 90, 46, 2);
    flare.position.copy(origin).setY(origin.y + 2);
    this.scene.add(flare);
    this._ultFlare = flare;

    if (this.enemies) {
      for (const e of this._hits(origin, 18)) {
        const dir = e.position.clone().sub(origin).normalize();
        e.takeHit(140, dir, 16);
        e.applyFreeze?.(2.2);   // the rift locks them in place
        e.staggerTimer = Math.max(e.staggerTimer ?? 0, 1.2);
      }
    }
    this.world.classroom?.hitDummies(origin, 14, false);
    return true;
  }

  // ---- The two karma spells. You can only ever really have one. ----
  //
  // Oathlight is gated on `purity`, which is 1.0 only for a run that has never
  // hurt a bystander — so it is at its strongest for a player who took the
  // clean road the whole way, and permanently weaker for anyone who did not,
  // even after atoning. Bloodtithe is the opposite bargain: it only exists
  // once you have done real harm, it scales with how much, and it feeds itself
  // by hurting whoever is standing nearby.

  // Bolt damage multiplier from the Oathlight afterglow
  get blessMult() { return this.blessing > 0 ? 1 + 0.5 * this.blessPower : 1; }

  get oathlightReady() {
    const k = this.karma;
    return !!k && !k.outlawed && k.purity > 0.55 && k.virtue >= OATH_COST;
  }

  get bloodtitheReady() {
    const k = this.karma;
    return !!k && k.sin01 >= 0.33;
  }

  // Radiant nova: heals, buffs, and burns fiends — and cannot touch a person.
  castOathlight() {
    if (!this.oathlightReady || this.oathCooldown > 0) return false;
    if (!this.player.spendMana(30)) return false;
    if (!this.karma.spendVirtue(OATH_COST)) return false;
    const purity = this.karma.purity;
    this.oathCooldown = 16;
    this.player.model.triggerCast();
    this.onShake?.(0.4);
    this.audio?.castWhoosh(0.3, this.player.position);
    this.audio?.impact(1.2, this.player.position);

    const origin = this.player.position.clone();
    origin.y += 0.9;
    const radius = 14 + 10 * purity;
    for (let ring = 0; ring < 3; ring++) {
      this.spawnBurst(origin, 54, 5 + ring * 5, ring % 2 ? 0xfff0c0 : 0xbfe8ff, 1.5);
    }
    const flare = new THREE.PointLight(0xffe9b0, 70, radius * 2, 2);
    flare.position.copy(origin);
    this.scene.add(flare);
    this._ultFlare = flare;
    this.ultActive = Math.max(this.ultActive, 1.4);

    // Only fiends: the light will not answer to being pointed at a person
    for (const e of this.enemies?.queryHits(origin, radius) ?? []) {
      const dir = e.position.clone().sub(origin).normalize();
      e.takeHit(150 + 110 * purity, dir, 12);
      e.staggerTimer = Math.max(e.staggerTimer ?? 0, 1.0);
    }
    this.player.health = Math.min(this.player.maxHealth,
      this.player.health + 30 + 25 * purity);
    this.player.mana = Math.min(this.player.maxMana, this.player.mana + 40 * purity);
    this.blessing = 12; // sharper bolts and free wards while it lasts
    this.blessPower = purity;
    this.onOathlight?.(purity);
    return true;
  }

  // Life drain: hits everything in reach, bystanders included, and gives back
  // a share of it. Using it on people is how it gets stronger.
  castBloodtithe() {
    if (!this.bloodtitheReady || this.tetheCooldown > 0) return false;
    if (!this.player.spendMana(25)) return false;
    const sin = this.karma.sin01;
    this.tetheCooldown = 11;
    this.player.model.triggerCast();
    this.onShake?.(0.45);
    this.audio?.impact(1.4, this.player.position);

    const origin = this.player.position.clone();
    origin.y += 0.7;
    const radius = 11 + 5 * sin;
    this.addScorch(origin, radius * 0.4);
    for (let ring = 0; ring < 3; ring++) {
      this.spawnBurst(origin, 46, 4 + ring * 4, ring % 2 ? 0x8a1030 : 0x3a0a24, 1.4);
    }
    const flare = new THREE.PointLight(0xff2a4a, 55, radius * 2, 2);
    flare.position.copy(origin);
    this.scene.add(flare);
    this._ultFlare = flare;
    this.ultActive = Math.max(this.ultActive, 1.2);

    let drained = 0;
    for (const e of this._hits(origin, radius)) {
      const dir = e.position.clone().sub(origin).normalize();
      const dmg = 70 + 150 * sin;
      e.takeHit(dmg, dir, 6);
      e.applyBurn?.(2.0);
      drained += dmg;
    }
    this.player.health = Math.min(this.player.maxHealth,
      this.player.health + Math.min(70, drained * 0.45));
    this.onBloodtithe?.(sin, drained);
    return true;
  }

  addScorch(pos, radius = 1.4) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.decalTex, transparent: true, depthWrite: false, opacity: 0.95,
    });
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(radius);
    m.position.set(pos.x, this.world.groundHeight(pos.x, pos.z) + 0.05, pos.z);
    this.scene.add(m);
    this.decals.push({ mesh: m, life: 22 });
    if (this.decals.length > 24) {
      const old = this.decals.shift();
      this.scene.remove(old.mesh);
      old.mesh.material.dispose();
    }
  }

  castForcePush() {
    if (this.pushCooldown > 0) return;
    if (!this.player.spendMana(15)) return;
    this.pushCooldown = 2.5;
    this.player.model.triggerCast();
    this.onShake?.(0.18);
    this.audio?.castWhoosh(0.8);

    const fwd = this._tmp.set(Math.sin(this.player.facing), 0, Math.cos(this.player.facing));
    const origin = this.player.position.clone();
    origin.y += 1.1;
    // Cone check: enemies within 11m and ~50 degrees of facing
    if (this.enemies) {
      for (const e of this._hits(origin, 11)) {
        const to = e.position.clone().sub(origin);
        const d = to.length();
        to.normalize();
        if (to.dot(fwd) > 0.6) {
          const force = Math.max(14, 40 * (1 - d / 14));
          e.takeHit(10, to, force);
        }
      }
    }
    // Ring visual expands from player along facing
    this.world.classroom?.hitDummies(origin.clone().addScaledVector(fwd, 3), 4, false);
    this.pushRing.visible = true;
    this.pushRingT = 0;
    this.pushRing.position.copy(origin).addScaledVector(fwd, 1.2);
    this.pushRing.lookAt(origin.clone().addScaledVector(fwd, 10));
    this.spawnBurst(origin.clone().addScaledVector(fwd, 1.5), 20, 6, 0xbfe4ff);
  }

  castFrostLash() {
    if (this.frostCooldown > 0) return;
    if (!this.player.spendMana(20)) return;
    this.frostCooldown = 5;
    this.player.model.triggerCast();
    this.onShake?.(0.15);
    this.audio?.castWhoosh(1.6);

    const fwd = this._tmp.set(Math.sin(this.player.facing), 0, Math.cos(this.player.facing));
    const origin = this.player.position.clone();
    origin.y += 1.1;
    // Frost spray particles along the cone
    for (let i = 0; i < 6; i++) {
      const p = origin.clone().addScaledVector(fwd, 1.5 + i * 2.1);
      this.spawnBurst(p, 14, 3.5, 0xcfe8ff, 0.7);
    }
    if (this.enemies) {
      for (const e of this._hits(origin, 14)) {
        const to = e.position.clone().sub(origin);
        const d = to.length();
        to.normalize();
        if (to.dot(fwd) > 0.65) {
          e.takeHit(8, to, 2);
          e.applyFreeze(2.6 + (this.player.mods?.freezeBonus ?? 0));
          this.spawnBurst(e.position, 18, 4, 0xcfe8ff);
        }
      }
    }
  }

  // Levitate: V grabs the nearest prop, it orbits ahead of the wand.
  // Pressing V again (or LMB) hurls it along the aim line.
  toggleLevitate() {
    if (this.heldProp) { this.hurlHeld(); return; }
    if (!this.props) return;
    const origin = this.player.position.clone();
    origin.y += 1.0;
    const p = this.props.nearest(origin, 12);
    if (!p) return;
    if (!this.player.spendMana(10)) return;
    this.heldProp = p;
    p.held = true;
    p.grounded = false;
    p.velocity.set(0, 0, 0);
    this.player.model.triggerCast();
    this.audio?.castWhoosh(1.4);
    this.spawnBurst(p.position, 16, 3, 0x9fd8ff, 0.7);
  }

  hurlHeld() {
    const p = this.heldProp;
    if (!p) return;
    this.heldProp = null;
    p.held = false;
    this.camera.getWorldDirection(this._aimDir);
    // Aim at the locked target if one is held, else down the camera ray
    if (this.lockTarget && !this.lockTarget.dead) {
      this._aimDir.copy(this.lockTarget.position).sub(p.position).normalize();
    }
    p.applyImpulse(this._aimDir, 26);
    this.player.model.triggerCast();
    this.audio?.castWhoosh(0.9);
    this.onShake?.(0.1);
  }

  updateLevitate(dt, elapsed) {
    const p = this.heldProp;
    if (!p) return;
    if (p.broken) { this.heldProp = null; return; }
    // Float it ahead of the player at chest height, bobbing and turning
    const fwd = this._tmp.set(Math.sin(this.player.facing), 0, Math.cos(this.player.facing));
    const want = this.player.position.clone().addScaledVector(fwd, 3.4);
    want.y += 2.15 + Math.sin(elapsed * 2.2) * 0.14;
    p.position.lerp(want, 1 - Math.exp(-9 * dt));
    p.mesh.position.copy(p.position);
    p.mesh.rotation.y += dt * 1.4;
    p.mesh.rotation.x = Math.sin(elapsed * 1.6) * 0.18;
    // Sustained cost; drops when mana runs dry
    this.player.mana -= dt * 5;
    if (this.player.mana <= 0) {
      this.player.mana = 0;
      this.heldProp = null;
      p.held = false;
      p.grounded = false;
    }
  }

  toggleLockOn() {
    if (this.lockTarget && !this.lockTarget.dead) {
      this.lockTarget = null;
      return;
    }
    this.lockTarget = null;
    if (!this.enemies) return;
    // Nearest living enemy within 32m
    let best = null, bestD = 32;
    for (const e of this.enemies.enemies) {
      if (e.dead) continue;
      const d = e.position.distanceTo(this.player.position);
      if (d < bestD) { bestD = d; best = e; }
    }
    // Anyone who has drawn on you is a valid target too — but never a
    // bystander, or lock-on would hand you an execution by accident.
    for (const n of this.bystanders?.npcs ?? []) {
      if (n.dead || n.mood !== 'hostile') continue;
      const d = n.position.distanceTo(this.player.position);
      if (d < bestD) { bestD = d; best = n; }
    }
    this.lockTarget = best;
  }

  castEmberBurst() {
    if (this.emberCooldown > 0) return;
    if (!this.player.spendMana(30)) return;
    this.emberCooldown = 8;
    this.player.model.triggerCast();
    this.onShake?.(0.3);
    this.audio?.impact(1.3);
    this.audio?.castWhoosh(0.6);

    const origin = this.player.position.clone();
    origin.y += 0.4;
    // Fire magic lights the ruin braziers and scorches practice dummies
    this.world.settlements?.igniteAt(origin, 6.5);
    this.world.classroom?.hitDummies(origin, 8 * (this.player.mods?.emberRadius ?? 1), true);
    // Fire ring: heavy particle burst + scorch + burn DoT
    this.spawnBurst(origin, 70, 9, 0xff8a3c, 0.9);
    this.addScorch(origin, 4.2);
    const flare = new THREE.PointLight(0xff7a2c, 40, 20, 2);
    flare.position.copy(origin).setY(origin.y + 1.5);
    this.scene.add(flare);
    setTimeout(() => { this.scene.remove(flare); flare.dispose(); }, 250);
    const emberR = 8 * (this.player.mods?.emberRadius ?? 1);
    if (this.enemies) {
      for (const e of this._hits(origin, emberR)) {
        const dir = e.position.clone().sub(origin).normalize();
        e.takeHit(35, dir, 10);
        e.applyBurn(3.5);
      }
    }
  }

  spawnBurst(pos, count, speed, color = 0xaadfff, lifeScale = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const idx = this.pCursor;
      this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pPos[idx * 3] = pos.x;
      this.pPos[idx * 3 + 1] = pos.y;
      this.pPos[idx * 3 + 2] = pos.z;
      this.pVel[idx * 3] = Math.sin(phi) * Math.cos(theta) * s;
      this.pVel[idx * 3 + 1] = Math.abs(Math.cos(phi)) * s * 0.9 + 1.2;
      this.pVel[idx * 3 + 2] = Math.sin(phi) * Math.sin(theta) * s;
      const shade = 0.7 + Math.random() * 0.5;
      this.pCol[idx * 3] = c.r * shade;
      this.pCol[idx * 3 + 1] = c.g * shade;
      this.pCol[idx * 3 + 2] = c.b * shade;
      this.pLife[idx] = this.pMaxLife[idx] = (0.5 + Math.random() * 0.5) * lifeScale;
    }
  }

  castBolt() {
    if (this.cooldown > 0) return;
    if (!this.player.spendMana(8)) return;
    this.cooldown = 0.22;
    this.player.model.triggerCast();
    this.audio?.castWhoosh(1.2);

    // Aim from camera center
    this.camera.getWorldDirection(this._aimDir);

    const mesh = new THREE.Mesh(this.boltGeo, this.boltMat);
    const tip = new THREE.Vector3();
    this.player.model.wandTip.getWorldPosition(tip);
    mesh.position.copy(tip);
    const light = new THREE.PointLight(0x8fd0ff, 12, 14, 2);
    mesh.add(light);
    this.scene.add(mesh);

    // Aim: locked target if any, else where the camera ray points at range
    const target = this.lockTarget && !this.lockTarget.dead
      ? this._tmp.copy(this.lockTarget.position)
      : this._tmp.copy(this.camera.position).addScaledVector(this._aimDir, 60);
    const vel = target.sub(tip).normalize().multiplyScalar(BOLT_SPEED);

    this.bolts.push({ mesh, vel, life: BOLT_LIFE, light });
  }

  updateWard(dt) {
    // Ward: hold right mouse or X
    const want = (this.input.isMouseDown(2) || this.input.isDown('KeyX')) && this.player.mana > 4;
    // Stamp the moment the ward goes up so we can judge a parry
    if (want && !this.wardActive) this.wardRaisedAt = this._clock ?? 0;
    if (want) {
      // Oathlight's afterglow holds the ward up for nothing
      if (this.blessing <= 0) {
        this.player.mana = Math.max(0, this.player.mana - dt * 14 * (this.player.mods?.wardCost ?? 1));
      }
    }
    this.wardActive = want;
    const targetOpacity = want ? 0.28 : 0;
    this.ward.material.opacity = THREE.MathUtils.lerp(
      this.ward.material.opacity, targetOpacity, 1 - Math.exp(-14 * dt));
    if (this.ward.material.opacity > 0.01) {
      this.ward.position.copy(this.player.position);
      this.ward.position.y += 1.0;
      const t = performance.now() * 0.002;
      this.ward.scale.setScalar(1 + Math.sin(t * 3) * 0.03);
    }
  }

  update(dt) {
    this._clock = (this._clock ?? 0) + dt;
    if (this.ultActive > 0) {
      this.ultActive -= dt;
      if (this._ultFlare) {
        this._ultFlare.intensity = Math.max(0, this.ultActive / 1.9) * 90;
        if (this.ultActive <= 0) {
          this.scene.remove(this._ultFlare);
          this._ultFlare.dispose();
          this._ultFlare = null;
        }
      }
    }
    if (this.input.wasPressed('KeyT')) this.castUltimate();
    if (this.input.wasPressed('KeyB')) this.castOathlight();
    if (this.input.wasPressed('KeyN')) this.castBloodtithe();
    this.cooldown -= dt;
    this.pushCooldown -= dt;
    this.emberCooldown -= dt;
    this.frostCooldown -= dt;
    this.oathCooldown -= dt;
    this.tetheCooldown -= dt;
    if (this.blessing > 0) this.blessing -= dt;
    // Arc Bolt: desktop LMB requires pointer lock; touch buttons inject KeyZ.
    const attackHeld = (this.input.isMouseDown(0)
      && (this.input.pointerLocked || this.input.touchMode))
      || this.input.isDown('KeyZ');
    const attackPressed = this.input.wasMousePressed(0) || this.input.wasPressed('KeyZ');
    if (this.heldProp) {
      if (attackPressed) this.hurlHeld();
    } else if (attackHeld) {
      this.castBolt();
    }
    if (this.input.wasPressed('KeyV')) this.toggleLevitate();
    this.updateLevitate(dt, performance.now() * 0.001);
    if (this.input.wasPressed('KeyE')) this.castForcePush();
    if (this.input.wasPressed('KeyR')) this.castEmberBurst();
    if (this.input.wasPressed('KeyC')) this.castFrostLash();
    if (this.input.wasPressed('Tab')) this.toggleLockOn();
    // Drop lock when the target dies or drifts out of range
    if (this.lockTarget && (this.lockTarget.dead ||
        this.lockTarget.position.distanceTo(this.player.position) > 42)) {
      this.lockTarget = null;
    }
    // While locked, the player squares up to the target
    if (this.lockTarget && !this.player.isDodging) {
      const t = this.lockTarget.position;
      this.player.facing = Math.atan2(t.x - this.player.position.x, t.z - this.player.position.z);
    }
    this.updateWard(dt);

    // Ward flash on block
    if (this._wardFlash > 0) {
      this._wardFlash -= dt;
      this.ward.material.opacity = Math.max(this.ward.material.opacity, 0.5 * (this._wardFlash / 0.25));
    }

    // Push ring animation
    if (this.pushRing.visible) {
      this.pushRingT += dt * 3.2;
      const t = this.pushRingT;
      if (t >= 1) {
        this.pushRing.visible = false;
      } else {
        this.pushRing.scale.setScalar(1 + t * 7);
        this.pushRing.material.opacity = 0.7 * (1 - t);
      }
    }

    // Decal aging
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life < 4) d.mesh.material.opacity = Math.max(d.life / 4, 0) * 0.95;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        d.mesh.material.dispose();
        this.decals.splice(i, 1);
      }
    }

    // Bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      const p = b.mesh.position;

      let hit = b.life <= 0;
      let hitGround = false;
      // Enemy hit
      if (!hit && this.enemies) {
        const targets = this._hits(p, 0.55);
        if (targets.length > 0) {
          const dir = b.vel.clone().normalize();
          // Reflected bolts hit far harder — the reward for a clean parry
          const base = b.reflected ? 70 : 28;
          targets[0].takeHit(
            base * (this.player.mods?.boltDamage ?? 1) * this.blessMult, dir, b.reflected ? 14 : 8);
          this.addUlt(b.reflected ? 6 : 4);
          this.spawnBurst(p, 20, 6, 0xc06aff);
          hit = true;
        }
      }
      // Terrain hit
      if (!hit && p.y < this.world.groundHeight(p.x, p.z) + 0.1) { hit = true; hitGround = true; }
      // Collider hit
      if (!hit) {
        for (const c of this.world.collidersNear(p.x, p.z, 1)) {
          if (c.type === 'cylinder') {
            if (p.y < c.topY && Math.hypot(p.x - c.x, p.z - c.z) < c.r + 0.15) { hit = true; break; }
          } else if (c.box.distanceToPoint(p) < 0.15) { hit = true; break; }
        }
      }

      if (hit) {
        this.world.classroom?.hitDummies(p, 0.6, false);
        this.spawnBurst(p, 26, 7, 0xaadfff);
        if (hitGround) this.addScorch(p, 1.1);
        this.onShake?.(0.12);
        this.audio?.impact(0.7, p); // positioned at the point of impact
        // Impact flash: reuse the bolt light briefly
        b.mesh.remove(b.light);
        b.light.position.copy(p);
        b.light.intensity = 30;
        this.scene.add(b.light);
        const light = b.light;
        setTimeout(() => { this.scene.remove(light); light.dispose(); }, 120);
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
      }
    }

    // Particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -9999;
        continue;
      }
      this.pVel[i * 3 + 1] -= 9 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
