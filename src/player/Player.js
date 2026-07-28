import * as THREE from 'three';
import { WizardModel } from './WizardModel.js';

// Third-person character controller: walk/sprint/jump/dodge with gravity,
// terrain + collider collision, camera-relative movement, smooth turning.

const WALK_SPEED = 4.2;
const RUN_SPEED = 8.6;
const SWIM_SPEED = 3.0;
const FLY_SPEED = 15.5;
const FLY_VERT = 8.0;
const SWIM_LEVEL_OFFSET = 0.45; // body sits this far below the surface
const ACCEL = 28;
const JUMP_V = 8.5;
const GRAVITY = 24;
const DODGE_SPEED = 12.5;
const DODGE_TIME = 0.48;
const COYOTE = 0.12;

export class Player {
  constructor(scene, world, input, camera) {
    this.world = world;
    this.input = input;
    this.camera = camera;

    this.model = new WizardModel({}, { broom: true });
    scene.add(this.model.root);

    this.position = new THREE.Vector3(21, 0, 37);
    this.position.y = world.groundHeight(this.position.x, this.position.z);
    this.velocity = new THREE.Vector3();
    this.facing = Math.PI; // face the academy (north) at spawn
    this.grounded = true;
    this.coyoteTimer = 0;
    this.dodgeTimer = 0;
    this.dodgeDir = new THREE.Vector3();
    this.radius = 0.42;
    this.height = 1.75;
    this.flying = false;
    this.flightLockout = 0; // set when a hit knocks you out of the sky

    this.health = 100;
    this.maxHealth = 100;
    this.mana = 100;
    this.maxMana = 100;

    this._moveDir = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  get isDodging() { return this.dodgeTimer > 0; }

  update(dt) {
    const input = this.input;

    // Camera-relative input direction
    this.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    this._fwd.normalize();
    this._right.crossVectors(this._fwd, new THREE.Vector3(0, 1, 0)).multiplyScalar(-1);

    // WASD and the arrow keys both drive movement
    const right = input.isDown('KeyD') || input.isDown('ArrowRight');
    const left = input.isDown('KeyA') || input.isDown('ArrowLeft');
    const fwd = input.isDown('KeyW') || input.isDown('ArrowUp');
    const back = input.isDown('KeyS') || input.isDown('ArrowDown');
    const ix = (right ? 1 : 0) - (left ? 1 : 0);
    const iz = (fwd ? 1 : 0) - (back ? 1 : 0);
    this._moveDir.set(0, 0, 0)
      .addScaledVector(this._fwd, iz)
      .addScaledVector(this._right, -ix);
    const hasInput = this._moveDir.lengthSq() > 0.001;
    if (hasInput) this._moveDir.normalize();

    // Climbing: face a wall, hold forward against it and press Space to grab.
    // Holding forward then hauls you up; cresting the top mantles you over.
    this.climbTimer = Math.max(0, (this.climbTimer ?? 0) - dt);
    if (this.climbing) {
      const wall = this.findClimbable();
      const wantUp = input.isDown('KeyW') || input.isDown('ArrowUp');
      const wantDown = input.isDown('KeyS') || input.isDown('ArrowDown');
      if (!wall || input.wasPressed('Space') || input.wasPressed('KeyQ')) {
        // Let go — a small hop off the wall
        this.climbing = false;
        this.climbTimer = 0.35;
        this.velocity.y = 3.0;
        this.velocity.x = -Math.sin(this.facing) * 3;
        this.velocity.z = -Math.cos(this.facing) * 3;
      } else {
        this.velocity.set(0, 0, 0);
        if (wantUp) this.position.y += 2.6 * dt;
        else if (wantDown) this.position.y -= 3.2 * dt;
        // Hug the wall
        this.position.x += (wall.nx * 0.02);
        this.position.z += (wall.nz * 0.02);
        // nx/nz point from the player into the wall — face that way, or the
        // next probe looks backwards and the grab is lost immediately
        this.facing = Math.atan2(wall.nx, wall.nz);
        // Mantle over the top
        if (this.position.y > wall.topY - 0.35) {
          this.climbing = false;
          this.climbTimer = 0.4;
          // Step forward onto the ledge (nx/nz point into the wall)
          this.position.y = wall.topY + 0.05;
          this.position.x += wall.nx * 1.1;
          this.position.z += wall.nz * 1.1;
          this.velocity.set(0, 0, 0);
          this.grounded = true;
          this.audio?.footstep(this.position);
        }
        // Only let go at the bottom when actively climbing down — otherwise
        // grabbing a wall while standing on the ground releases instantly.
        if (wantDown && this.position.y <= this.world.groundHeight(this.position.x, this.position.z) + 0.05) {
          this.climbing = false;
        }
        this.model.root.position.copy(this.position);
        this.model.root.rotation.y = this.facing;
        this.model.animate(dt, { mode: 'climb', speed01: wantUp ? 1 : 0 });
        return;
      }
    } else if (input.wasPressed('Space') && !this.flying && !this.swimming && this.climbTimer <= 0) {
      const wall = this.findClimbable();
      if (wall) {
        this.climbing = true;
        this.velocity.set(0, 0, 0);
        this.audio?.footstep(this.position);
      }
    }

    // Magical flight: G toggles. Cancels swim/dodge, disables gravity.
    if (this.flightLockout > 0) this.flightLockout -= dt;
    if (input.wasPressed('KeyG') && (this.flying || this.flightLockout <= 0)) {
      this.flying = !this.flying;
      if (this.flying) {
        this.swimming = false;
        this.dodgeTimer = 0;
        this.velocity.y = 4.5; // little kick off the ground
        this.audio?.castWhoosh(0.5);
        this.onBroomSummoned?.();
      }
    }

    // Swim detection: deep water underfoot and body at/below the surface
    const ground = this.world.groundHeight(this.position.x, this.position.z, this.position.y);
    const waterLevel = this.world.waterLevel;
    const deepWater = ground < waterLevel - 1.1;
    if (!this.flying && !this.swimming && deepWater && this.position.y < waterLevel - SWIM_LEVEL_OFFSET + 0.05) {
      this.swimming = true;
      this.velocity.y = 0;
    } else if (this.swimming && !deepWater) {
      this.swimming = false;
    }

    const sprinting = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const m = this.mods;
    const targetSpeed = hasInput
      ? (this.flying ? FLY_SPEED * (m?.flightSpeed ?? 1) * (sprinting ? 1.45 : 1)
        : this.swimming ? SWIM_SPEED
        : sprinting ? RUN_SPEED * (m?.sprintSpeed ?? 1) : WALK_SPEED)
      : 0;

    // Dodge
    if ((input.wasPressed('ControlLeft') || input.wasPressed('KeyQ')) && this.grounded && !this.isDodging) {
      this.dodgeTimer = DODGE_TIME;
      this.dodgeDir.copy(hasInput ? this._moveDir : this._fwd);
    }

    if (this.isDodging) {
      this.dodgeTimer -= dt;
      const t = 1 - this.dodgeTimer / DODGE_TIME;
      const speed = DODGE_SPEED * (1 - t * 0.55);
      this.velocity.x = this.dodgeDir.x * speed;
      this.velocity.z = this.dodgeDir.z * speed;
      this.facing = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    } else {
      // Smooth horizontal acceleration
      const vx = this._moveDir.x * targetSpeed;
      const vz = this._moveDir.z * targetSpeed;
      const t = 1 - Math.exp(-ACCEL * dt / Math.max(targetSpeed, WALK_SPEED));
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, vx, t);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, vz, t);

      // Face movement direction
      if (hasInput) {
        const targetYaw = Math.atan2(this._moveDir.x, this._moveDir.z);
        let d = targetYaw - this.facing;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.facing += d * (1 - Math.exp(-12 * dt));
      }
    }

    // Gravity + jump (buoyancy while swimming, free vertical while flying)
    if (this.flying) {
      const up = (input.isDown('Space') ? 1 : 0) - (input.isDown('ControlLeft') || input.isDown('KeyZ') ? 1 : 0);
      this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, up * FLY_VERT, 1 - Math.exp(-6 * dt));
      this.coyoteTimer = 0;
    } else if (this.swimming) {
      const targetY = this.world.waterLevel - SWIM_LEVEL_OFFSET;
      this.velocity.y = (targetY - this.position.y) * 6;
      this.coyoteTimer = 0;
    } else if (this.grounded) {
      this.coyoteTimer = COYOTE;
    } else {
      this.coyoteTimer -= dt;
      this.velocity.y -= GRAVITY * dt;
    }
    if (input.wasPressed('Space') && this.coyoteTimer > 0 && !this.isDodging && !this.swimming) {
      this.velocity.y = JUMP_V;
      this.grounded = false;
      this.coyoteTimer = 0;
    }

    // Integrate
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Collide with world colliders (horizontal push-out)
    this.world.resolveCollisions(this.position, this.radius, this.height);

    // Terrain (recompute after collision push-out)
    const groundNow = this.world.groundHeight(this.position.x, this.position.z, this.position.y);
    if (this.flying) {
      // Land when settling onto the ground; never sink through it
      if (this.position.y <= groundNow + 0.05) {
        this.position.y = groundNow;
        if (this.velocity.y <= 0.1) {
          this.flying = false;
          this.grounded = true;
          this.velocity.y = 0;
          this.audio?.footstep(this.position);
        }
      }
      this.grounded = false;
    } else if (!this.swimming) {
      if (this.position.y <= groundNow + 0.02) {
        this.position.y = groundNow;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.grounded = true;
      } else if (this.position.y > groundNow + 0.1) {
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }

    // Mana regen
    this.mana = Math.min(this.maxMana, this.mana + dt * 12 * (this.mods?.manaRegen ?? 1));

    // Drive model
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.facing;

    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    // Footsteps: fire when the stride phase crosses each half-cycle
    if (this.grounded && !this.swimming && hSpeed > 1.5) {
      const stridePhase = Math.sin(this.model._phase);
      if (this._lastStride !== undefined && Math.sign(stridePhase) !== Math.sign(this._lastStride)) {
        this.audio?.footstep(this.position);
      }
      this._lastStride = stridePhase;
    }
    let mode = 'idle';
    if (this.flying) mode = 'fly';
    else if (this.swimming) mode = 'swim';
    else if (this.isDodging) mode = 'dodge';
    else if (!this.grounded) mode = 'air';
    else if (hSpeed > 0.3) mode = 'move';
    this.model.animate(dt, {
      mode,
      speed01: THREE.MathUtils.clamp(hSpeed / RUN_SPEED, 0, 1),
      dodgeT: this.isDodging ? 1 - this.dodgeTimer / DODGE_TIME : 0,
      airV: this.velocity.y,
    });
  }

  // A box collider just ahead whose top is above head height is climbable.
  // Returns the surface normal pointing back at the player, plus its top.
  findClimbable() {
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const probeX = this.position.x + fx * 0.75;
    const probeZ = this.position.z + fz * 0.75;
    for (const c of this.world.collidersNear(probeX, probeZ, 1.4)) {
      if (c.type !== 'box') continue;
      const b = c.box;
      // Needs real height to grab, but once climbing we must keep holding on
      // right up to the lip — otherwise we let go just before the mantle.
      if (b.max.y < this.position.y + (this.climbing ? -0.2 : 1.4)) continue;
      if (b.min.y > this.position.y + 1.2) continue;       // starts above reach
      const cx = Math.max(b.min.x, Math.min(probeX, b.max.x));
      const cz = Math.max(b.min.z, Math.min(probeZ, b.max.z));
      if (Math.hypot(probeX - cx, probeZ - cz) > 0.45) continue;
      // Outward normal from the box face nearest the player
      const dx = this.position.x - cx, dz = this.position.z - cz;
      const len = Math.hypot(dx, dz) || 1;
      return { nx: -dx / len, nz: -dz / len, topY: b.max.y };
    }
    return null;
  }

  spendMana(cost) {
    if (this.mana < cost) return false;
    this.mana -= cost;
    return true;
  }

  takeDamage(amount) {
    if (this.isDodging) return; // dodge i-frames
    this.health = Math.max(0, this.health - amount);
    this.onDamaged?.(amount);
    // A hit breaks the spell that holds you up: you drop, and have to get
    // back on the ground before you can take off again. Flight stops being
    // a way to ignore a fight.
    if (this.flying) {
      this.flying = false;
      this.velocity.y = Math.min(this.velocity.y, -2);
      this.flightLockout = 1.4;
      this.onFlightBroken?.();
    }
    if (this.health <= 0) {
      // Soft death: restore at spawn-ish spot with half health
      this.health = this.maxHealth * 0.5;
      this.position.set(21, 0, 37);
      this.position.y = this.world.groundHeight(21, 37);
      this.velocity.set(0, 0, 0);
    }
  }
}
