import * as THREE from 'three';

// Orbit-follow camera with collision, shoulder offset, zoom, and smoothing.

export class ThirdPersonCamera {
  constructor(camera, player, world, input) {
    this.camera = camera;
    this.player = player;
    this.world = world;
    this.input = input;

    this.yaw = 0.12; // slightly angled hero view of the academy at spawn
    this.pitch = 0.14;
    this.autoFollow = true; // swing behind the player when moving (toggle: F1)
    this._manualTimer = 0;
    this.distance = 5.2;
    this.targetDistance = 5.2;
    this.currentDistance = 5.2;

    this._pivot = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._smoothPivot = new THREE.Vector3().copy(player.position);
  }

  update(dt) {
    const input = this.input;
    const SENS = 0.0024;
    this.yaw -= input.mouseDX * SENS;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.mouseDY * SENS, -0.55, 1.25);

    // Manual look suspends auto-follow for a moment
    if (Math.abs(input.mouseDX) > 0.5 || Math.abs(input.mouseDY) > 0.5) this._manualTimer = 1.2;
    else this._manualTimer = Math.max(0, (this._manualTimer ?? 0) - dt);

    // Auto-follow: ease the camera around behind the direction of travel so
    // the view sits over the character's shoulder without touching the mouse.
    const v = this.player.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (this.autoFollow && this._manualTimer <= 0 && speed > 1.5 && !this.lockTarget) {
      const travel = Math.atan2(v.x, v.z);
      const want = travel + Math.PI; // camera sits opposite the heading
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const rate = 1.6 * Math.min(1, speed / 6);
      this.yaw += d * (1 - Math.exp(-rate * dt));
      // Settle to a natural over-the-shoulder height
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0.13, 1 - Math.exp(-0.8 * dt));
    }

    // Lock-on: ease the camera to keep the target framed past the player
    const lock = this.lockTarget;
    if (lock && !lock.dead) {
      const dx = this.player.position.x - lock.position.x;
      const dz = this.player.position.z - lock.position.z;
      const wantYaw = Math.atan2(dx, dz);
      let d = wantYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-4 * dt));
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0.16, 1 - Math.exp(-3 * dt));
    }
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + input.wheelDelta * 0.7, 2.2, 10);

    // Pivot at chest height, smoothed for stability on stairs/jumps
    this._pivot.copy(this.player.position);
    this._pivot.y += 1.45;
    const k = 1 - Math.exp(-14 * dt);
    this._smoothPivot.lerp(this._pivot, k);
    // Vertical follows slower for pleasant jump arcs
    this._smoothPivot.y = THREE.MathUtils.lerp(this._smoothPivot.y, this._pivot.y, 1 - Math.exp(-8 * dt));

    // Desired offset in spherical coords
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this._dir.set(
      Math.sin(this.yaw) * cp,
      sp,
      Math.cos(this.yaw) * cp
    ).normalize();

    // Collision: shrink distance if something blocks
    const clear = this.world.cameraClearance(this._smoothPivot, this._dir, this.targetDistance);
    // Snap in fast, ease out slow — avoids clipping while staying calm
    if (clear < this.currentDistance) this.currentDistance = clear;
    else this.currentDistance = THREE.MathUtils.lerp(this.currentDistance, clear, 1 - Math.exp(-3 * dt));

    this._desired.copy(this._smoothPivot).addScaledVector(this._dir, this.currentDistance);
    this.camera.position.copy(this._desired);

    // Look slightly above pivot, with subtle shoulder offset
    const look = this._pivot.clone();
    look.y += 0.1;
    this.camera.lookAt(look);
  }
}
