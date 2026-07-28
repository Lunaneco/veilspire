import * as THREE from 'three';
import { terrainHeight } from '../world/Terrain.js';
import { WispFiend } from './Enemies.js';
import { resolveBossHit, canStartFinisher, burnDps } from './combatMath.js';

// The Hollow Warden — a bark-and-stone colossus that guards the deep wood.
// Phase 1: slams and summons wisp adds that flank while it holds the centre.
// Phase 2 (below half): enrages, quickens, and sweeps a searing beam.
// Below 8% health it kneels, opening a finisher the player triggers with F.

export const BOSS_ARENA = { x: 250, z: -230, r: 34 };

const BARK = new THREE.MeshStandardMaterial({ color: 0x4a3d2c, roughness: 0.95, flatShading: true });
const STONE = new THREE.MeshStandardMaterial({ color: 0x5c564c, roughness: 0.95, flatShading: true });
const HEART = new THREE.MeshStandardMaterial({
  color: 0x2a1408, roughness: 0.4, emissive: 0x4affc0, emissiveIntensity: 2.4,
});

export class HollowWarden {
  constructor(scene, world, spells, enemies) {
    this.scene = scene;
    this.world = world;
    this.spells = spells;
    this.enemies = enemies;
    this.isBoss = true;
    this.isGolem = true; // shares the heavy-hit rules

    const { x, z } = BOSS_ARENA;
    this.position = new THREE.Vector3(x, terrainHeight(x, z), z);
    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    scene.add(this.group);

    // Silhouette: broad root-mass base, twisted trunk torso, antlered crown
    const base = new THREE.Mesh(new THREE.DodecahedronGeometry(2.6, 0), STONE);
    base.scale.set(1.3, 0.55, 1.3);
    base.position.y = 1.1;
    base.castShadow = base.receiveShadow = true;
    this.group.add(base);

    this.torso = new THREE.Group();
    this.torso.position.y = 2.0;
    this.group.add(this.torso);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.2, 4.4, 9), BARK);
    trunk.position.y = 2.2;
    trunk.castShadow = trunk.receiveShadow = true;
    this.torso.add(trunk);

    this.heartMat = HEART.clone();
    this.heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), this.heartMat);
    this.heart.position.set(0, 2.6, 1.3);
    this.torso.add(this.heart);
    this.heartLight = new THREE.PointLight(0x4affc0, 9, 22, 2);
    this.heartLight.position.copy(this.heart.position);
    this.torso.add(this.heartLight);

    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0, 0), BARK);
    head.position.y = 5.0;
    head.castShadow = true;
    this.torso.add(head);
    // Antlers
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.3 + i * 0.35, 5), BARK);
        horn.position.set(side * (0.5 + i * 0.22), 5.7 + i * 0.35, -0.1 * i);
        horn.rotation.z = side * (0.5 + i * 0.22);
        horn.castShadow = true;
        this.torso.add(horn);
      }
    }

    this.arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 1.7, 3.9, 0);
      this.torso.add(shoulder);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 2.2, 7), BARK);
      upper.position.y = -1.1;
      upper.castShadow = true;
      shoulder.add(upper);
      const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), STONE);
      fist.position.y = -2.4;
      fist.castShadow = true;
      shoulder.add(fist);
      this.arms.push(shoulder);
    }

    // Beam emitter used in phase two
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 30, 8, 1, true),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    this.beam.material.color.setRGB(2.6, 3.4, 2.0);
    this.beam.material.toneMapped = false;
    this.beam.rotation.z = Math.PI / 2;
    this.beam.visible = false;
    scene.add(this.beam);

    this.maxHp = 900;
    this.hp = this.maxHp;
    this.phase = 1;
    this.facing = 0;
    this.state = 'dormant';
    this.windupTimer = 0;
    this.beamTimer = 0;
    this.beamAngle = 0;
    this.attackCooldown = 3;
    this.summonCooldown = 8;
    this.flashTimer = 0;
    this.frozenTimer = 0;
    this.burnTimer = 0;
    this.staggerTimer = 0;
    this.knockback = new THREE.Vector3();
    this.dead = false;
    this.deathTimer = 0;
    this.finisherReady = false;
    this.finisherPlaying = false;
    this.adds = [];
    this._tmp = new THREE.Vector3();

    this.onPhase = null;
    this.onFinisherReady = null;
    this.onDefeated = null;
  }

  get healthFrac() { return Math.max(0, this.hp / this.maxHp); }

  takeHit(damage, fromDir, knockbackForce = 0) {
    if (this.dead || this.finisherPlaying) return;
    if (this.state === 'dormant') this.state = 'fight';
    const next = resolveBossHit({
      hp: this.hp,
      maxHp: this.maxHp,
      phase: this.phase,
      frozenTimer: this.frozenTimer,
      finisherReady: this.finisherReady,
      dead: this.dead,
      finisherPlaying: this.finisherPlaying,
      state: this.state,
    }, damage);
    this.hp = next.hp;
    this.flashTimer = 0.14;
    this.knockback.addScaledVector(fromDir, knockbackForce * 0.08);
    if (damage > 30) this.staggerTimer = Math.max(this.staggerTimer, 0.35);

    if (next.enteredPhaseTwo) this.enterPhaseTwo();
    if (next.openedFinisher) {
      this.finisherReady = true;
      this.state = 'kneel';
      this.windupTimer = 0;
      this.beamTimer = 0;
      this.beam.visible = false;
      this.onFinisherReady?.();
    }
  }

  applyBurn(s) { this.burnTimer = Math.max(this.burnTimer, s); }
  applyFreeze(s) { if (!this.dead) this.frozenTimer = Math.max(this.frozenTimer, s * 0.45); }

  enterPhaseTwo() {
    this.phase = 2;
    this.heartMat.emissive.setHex(0xff5a3c);
    this.heartLight.color.setHex(0xff5a3c);
    this.attackCooldown = 1.2;
    this.spells.onShake?.(0.5);
    this.spells.audio?.impact(1.7);
    this.spells.spawnBurst(
      this.position.clone().setY(this.position.y + 3), 70, 10, 0xff7a4a, 1.2);
    this.onPhase?.(2);
  }

  summonAdds(count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const x = this.position.x + Math.cos(a) * 11;
      const z = this.position.z + Math.sin(a) * 11;
      const w = new WispFiend(this.scene, this.world, x, z);
      w.state = 'aggro';
      w.onKilled = () => this.enemies.onEnemyKilled?.(w);
      this.enemies.enemies.push(w);
      this.adds.push(w);
      this.spells.spawnBurst(new THREE.Vector3(x, terrainHeight(x, z) + 1.8, z), 22, 5, 0xc06aff);
    }
    this.spells.audio?.castWhoosh(0.5);
  }

  startFinisher() {
    if (!canStartFinisher(this.finisherReady, this.finisherPlaying, this.dead)) return false;
    this.finisherPlaying = true;
    this.finisherTime = 0;
    return true;
  }

  // Signature matches the other enemies so EnemyManager can drive it
  update(dt, elapsed, player, _fireBolt, _spawnBurst, onSlam) {
    if (this.dead) {
      this.deathTimer -= dt;
      const t = Math.max(this.deathTimer / 2.2, 0);
      this.group.position.y = this.position.y - (1 - t) * 2.2;
      this.torso.rotation.x = (1 - t) * 0.9;
      this.heartMat.emissiveIntensity = 2.4 * t;
      this.heartLight.intensity = 9 * t;
      if (this.deathTimer <= 0 && !this.removed) {
        this.removed = true;
        this.spells.spawnBurst(
          this.position.clone().setY(this.position.y + 3), 90, 11, 0x4affc0, 1.4);
        this.scene.remove(this.group);
        this.scene.remove(this.beam);
        this.onDefeated?.();
      }
      return;
    }

    // Finisher cinematic: the Warden kneels, then bursts apart
    if (this.finisherPlaying) {
      this.finisherTime += dt;
      const t = this.finisherTime;
      this.torso.rotation.x = Math.min(t * 0.7, 0.75);
      this.heartMat.emissiveIntensity = 2.4 + Math.sin(t * 22) * 2.2;
      this.heartLight.intensity = 9 + Math.sin(t * 22) * 7;
      if (t > 1.1 && !this._finisherBurst) {
        this._finisherBurst = true;
        this.spells.spawnBurst(
          this.position.clone().setY(this.position.y + 3.5), 80, 9, 0x4affc0, 1.3);
        this.spells.onShake?.(0.6);
        this.spells.audio?.impact(1.9);
      }
      if (t > 1.9) {
        this.dead = true;
        this.deathTimer = 2.2;
      }
      return;
    }

    if (this.burnTimer > 0) {
      this.burnTimer -= dt;
      this.hp -= burnDps(true) * dt;
    }
    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.staggerTimer > 0) this.staggerTimer -= dt;
    this.heartMat.emissiveIntensity = this.flashTimer > 0 ? 6 : 2.4 + Math.sin(elapsed * 3) * 0.5;

    if (this.frozenTimer > 0) {
      this.frozenTimer -= dt;
      this.heartMat.emissive.setHex(0x6ab8e8);
      return;
    }
    this.heartMat.emissive.setHex(this.phase === 2 ? 0xff5a3c : 0x4affc0);

    const to = this._tmp.copy(player.position).sub(this.position);
    to.y = 0;
    const dist = to.length();
    to.normalize();

    // Wake when the player enters the arena
    if (this.state === 'dormant') {
      if (dist < BOSS_ARENA.r) {
        this.state = 'fight';
        this.spells.onShake?.(0.3);
        this.spells.audio?.impact(1.2);
      } else {
        this.group.position.copy(this.position);
        return;
      }
    }

    // Kneeling: waits for the killing blow
    if (this.state === 'kneel') {
      this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, 0.55, 1 - Math.exp(-4 * dt));
      for (const a of this.arms) a.rotation.x = THREE.MathUtils.lerp(a.rotation.x, 0.6, 1 - Math.exp(-4 * dt));
      this.group.position.copy(this.position);
      return;
    }

    // Face the player, ponderously
    const wantYaw = Math.atan2(to.x, to.z);
    let d = wantYaw - this.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.facing += d * (1 - Math.exp(-(this.phase === 2 ? 3.5 : 2.2) * dt));

    this.attackCooldown -= dt;
    this.summonCooldown -= dt;

    // Group tactics: keep a screen of wisps out while the Warden holds centre
    this.adds = this.adds.filter((w) => !w.removed && !w.dead);
    if (this.summonCooldown <= 0 && this.adds.length < (this.phase === 2 ? 4 : 2)) {
      this.summonCooldown = this.phase === 2 ? 9 : 13;
      this.summonAdds(this.phase === 2 ? 2 : 1);
    }

    if (this.beamTimer > 0) {
      // Sweeping beam: rotates across the arena, burning what it crosses
      this.beamTimer -= dt;
      this.beamAngle += dt * 1.1;
      const origin = this.position.clone().setY(this.position.y + 4.6);
      const dir = new THREE.Vector3(Math.sin(this.beamAngle), 0, Math.cos(this.beamAngle));
      this.beam.visible = true;
      this.beam.material.opacity = 0.85;
      this.beam.position.copy(origin).addScaledVector(dir, 15);
      this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      // Damage if the player stands in the sweep line
      const rel = player.position.clone().sub(origin);
      rel.y = 0;
      const along = rel.dot(dir);
      const perp = rel.clone().addScaledVector(dir, -along).length();
      if (along > 0 && along < 30 && perp < 1.6) {
        if (this.spells.wardActive) {
          this.spells.wardFlash();
          player.mana = Math.max(0, player.mana - 20 * dt * 10);
        } else {
          player.takeDamage(16 * dt * 6);
        }
      }
      if (this.beamTimer <= 0) {
        this.beam.visible = false;
        this.attackCooldown = 3.2;
      }
    } else if (this.windupTimer > 0) {
      this.windupTimer -= dt;
      const t = 1 - this.windupTimer / 1.0;
      for (const a of this.arms) a.rotation.x = -Math.min(t * 3.4, 2.5);
      if (this.windupTimer <= 0) {
        for (const a of this.arms) a.rotation.x = 0.7;
        onSlam(this.position.clone(), 9);
        this.attackCooldown = this.phase === 2 ? 2.2 : 3.4;
      }
    } else if (this.staggerTimer > 0) {
      for (const a of this.arms) a.rotation.x = Math.sin(elapsed * 26) * 0.2;
    } else if (this.attackCooldown <= 0) {
      // Phase two alternates: the beam needs a little room, so it also fires
      // at closer range rather than defaulting to slams forever.
      if (this.phase === 2 && dist > 4.5 && (this._lastWasSlam || Math.random() < 0.5)) {
        this._lastWasSlam = false;
        this.beamTimer = 3.4;
        this.beamAngle = Math.atan2(to.x, to.z) - 1.7;
        this.spells.audio?.castWhoosh(0.4);
      } else if (dist < 7.5) {
        this.windupTimer = this.phase === 2 ? 0.7 : 1.0;
        this._lastWasSlam = true;
      } else {
        // Close the gap
        const speed = this.phase === 2 ? 4.2 : 2.8;
        this.position.x += to.x * speed * dt;
        this.position.z += to.z * speed * dt;
        for (const a of this.arms) a.rotation.x = Math.sin(elapsed * 3) * 0.3;
      }
    } else {
      for (const a of this.arms) a.rotation.x *= Math.exp(-3 * dt);
      if (dist > 11) {
        const speed = this.phase === 2 ? 4.2 : 2.8;
        this.position.x += to.x * speed * dt;
        this.position.z += to.z * speed * dt;
      }
    }

    this.position.x += this.knockback.x * dt;
    this.position.z += this.knockback.z * dt;
    this.knockback.multiplyScalar(Math.exp(-6 * dt));
    this.position.y = terrainHeight(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;
    this.torso.rotation.x = Math.sin(elapsed * 1.2) * 0.03;
    this.heart.rotation.y = elapsed * 0.8;
  }
}
