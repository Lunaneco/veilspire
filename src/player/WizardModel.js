import * as THREE from 'three';
import { mergeStatics } from '../util/mergeStatics.js';

// Procedural robed apprentice: articulated Object3D rig with code-driven
// animation states (idle, walk, run, jump, fall, dodge, cast). Placeholder
// for a skinned mesh later, but built to read well in silhouette.
//
// A dozen of these stand around the academy, so the part count is a budget,
// not a detail: every mesh is a draw call and every shadow caster is a second
// one. The rig is built at full detail, batched per joint (see _batchRig),
// then thinned by distance through setDetail().

export class WizardModel {
  constructor(palette = {}, { broom = false } = {}) {
    const ROBE = new THREE.MeshStandardMaterial({ color: palette.robe ?? 0x27314f, roughness: 0.8 });
    const ROBE_TRIM = new THREE.MeshStandardMaterial({ color: palette.trim ?? 0xb08a3e, roughness: 0.5, metalness: 0.35 });
    const SKIN = new THREE.MeshStandardMaterial({ color: palette.skin ?? 0xd9a988, roughness: 0.7 });
    const HAIR = new THREE.MeshStandardMaterial({ color: palette.hair ?? 0x3a2a1c, roughness: 0.9 });
    const BOOT = new THREE.MeshStandardMaterial({ color: 0x2c2018, roughness: 0.85 });
    const WAND = new THREE.MeshStandardMaterial({ color: 0x54371f, roughness: 0.7 });
    this.root = new THREE.Group();
    const g = this.root;

    // Hips is the animation root; everything hangs off it.
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    g.add(this.hips);

    // Torso + robe skirt
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.34, 6, 12), ROBE);
    chest.position.y = 0.34;
    chest.castShadow = true;
    this.torso.add(chest);
    // Trim pieces: readable up close, invisible past a few metres
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.035, 8, 16), ROBE_TRIM);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.1;
    this.torso.add(belt);
    // Robe skirt: knee-length and open at the front so legs read while running
    this.skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.42, 0.62, 12, 1, true, Math.PI * 0.18, Math.PI * 1.64), ROBE);
    this.skirt.position.y = -0.28;
    this.skirt.castShadow = true;
    this.hips.add(this.skirt);
    // Gold chest trim: thin strip down the front
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.02), ROBE_TRIM);
    trim.position.set(0, 0.33, 0.215);
    this.torso.add(trim);

    // Head
    this.neck = new THREE.Group();
    this.neck.position.y = 0.62;
    this.torso.add(this.neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), SKIN);
    head.position.y = 0.16;
    head.castShadow = true;
    this.neck.add(head);
    // Hair: cap sitting on top-back of the skull, face fully visible
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.158, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), HAIR);
    hair.position.set(0, 0.165, -0.02);
    hair.rotation.x = 0.25;
    this.neck.add(hair);
    // Simple eyes so the face reads at gameplay camera distance
    const eyeGeo = new THREE.SphereGeometry(0.016, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1c1a18 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(0.052 * side, 0.17, 0.135);
      this.neck.add(eye);
    }
    // Hood: draped half-shell behind the head, resting on the shoulders
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 14, 10, Math.PI * 0.9, Math.PI * 1.2, 0, Math.PI * 0.75), ROBE);
    hood.position.set(0, 0.05, -0.05);
    hood.rotation.x = -0.35;
    hood.scale.set(1, 1.15, 1.1);
    hood.castShadow = true;
    this.neck.add(hood);
    // Collar ring where hood meets the robe
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 8, 14), ROBE);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.02;
    collar.castShadow = true; // matches the hood so the two batch together
    this.neck.add(collar);
    // Back cape panel, swings with movement
    this.cape = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.92, 1, 6), ROBE);
    {
      const cp = this.cape.geometry.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const yy = cp.getY(i);
        cp.setZ(i, -Math.pow(Math.abs(yy - 0.46) / 0.92, 1.6) * 0.12);
        cp.setX(i, cp.getX(i) * (1 + (0.46 - yy) * 0.35)); // widens toward hem
      }
      this.cape.geometry.computeVertexNormals();
    }
    this.cape.position.set(0, 0.04, -0.235);
    this.cape.rotation.x = 0.12;
    this.cape.castShadow = true;
    this.cape.material = ROBE;
    this.cape.userData.dynamic = true; // swings on its own — never batch it
    this.torso.add(this.cape);

    // Arms: shoulder -> elbow -> hand, wand in right hand
    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.22 * side, 0.52, 0);
      this.torso.add(shoulder);
      // Shoulder pad closes the gap between torso and arm
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), ROBE);
      shoulder.add(pad);
      // Arms cast no shadow: the robe silhouette carries the shape, and this
      // halves the model's contribution to the shadow pass.
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.24, 4, 8), ROBE);
      upper.position.y = -0.16;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.32;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 8), ROBE);
      fore.position.y = -0.15;
      elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), SKIN);
      hand.position.y = -0.3;
      elbow.add(hand);
      return { shoulder, elbow, hand };
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);

    this.wand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.42, 6), WAND);
    this.wand.position.set(0, -0.32, -0.16);
    this.wand.rotation.x = Math.PI / 2.6;
    this.armR.elbow.add(this.wand);
    // Wand tip anchor for spell spawn position
    this.wandTip = new THREE.Object3D();
    this.wandTip.position.y = 0.24;
    this.wand.add(this.wandTip);

    // Legs: hip -> knee
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0.11 * side, -0.02, 0);
      this.hips.add(hip);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 8), ROBE);
      thigh.position.y = -0.2;
      thigh.castShadow = true;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 8), BOOT);
      shin.position.y = -0.2;
      knee.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.24), BOOT);
      foot.position.set(0, -0.42, 0.05);
      knee.add(foot);
      return { hip, knee };
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);

    if (broom) this._buildBroom();

    this._castTimer = 0;
    this._phase = 0;
    this._broomT = 0;
    this._mats = { ROBE, ROBE_TRIM, SKIN, HAIR };
    this._batchRig({ ROBE, ROBE_TRIM, SKIN, HAIR, WAND, EYE: eyeMat });
  }

  // The broom hangs off the hips so it inherits the rider's lean, and runs
  // along local +z because that is the direction the model faces. It is only
  // ever built for the player — nobody else in the valley flies.
  _buildBroom() {
    const WOOD = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.65 });
    const BIND = new THREE.MeshStandardMaterial({ color: 0x8a6a2e, roughness: 0.45, metalness: 0.5 });
    const STRAW = new THREE.MeshStandardMaterial({ color: 0xb98a44, roughness: 0.9 });
    const broom = new THREE.Group();
    broom.userData.dynamic = true;
    broom.position.set(0, -0.26, 0.1); // the seat sits just above the shaft
    broom.visible = false;

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.052, 2.5, 8), WOOD);
    shaft.rotation.x = Math.PI / 2; // cylinder's Y axis onto the model's +z
    shaft.position.z = 0.32;
    shaft.castShadow = true;
    broom.add(shaft);
    // The handle curves up at the nose, the way a swept broom does
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.42, 8), WOOD);
    nose.rotation.x = Math.PI / 2.55;
    nose.position.set(0, 0.09, 1.72);
    broom.add(nose);
    // Bristles: a cone flaring backwards, apex buried in the shaft
    const bristles = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.72, 9), STRAW);
    bristles.rotation.x = Math.PI / 2;
    bristles.position.z = -1.22;
    bristles.castShadow = true;
    broom.add(bristles);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.11, 8), BIND);
    band.rotation.x = Math.PI / 2;
    band.position.z = -0.84;
    broom.add(band);
    // Footrests to stand the boots on
    for (const side of [-1, 1]) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 6), BIND);
      peg.rotation.z = Math.PI / 2;
      peg.position.set(side * 0.11, -0.02, -0.34);
      broom.add(peg);
    }
    this.hips.add(broom);
    this.broom = broom;
  }

  // Merge the meshes rigidly attached to each joint. The arm still bends
  // because shoulder and elbow remain separate objects — only what hangs off a
  // single joint is welded together. Handles for the LOD sets are recovered by
  // material afterwards, so they are correct whether or not the merge ran.
  _batchRig(mats) {
    const joints = [this.torso, this.neck, this.hips,
      this.armL.shoulder, this.armR.shoulder, this.armL.elbow, this.armR.elbow,
      this.legL.hip, this.legR.hip, this.legL.knee, this.legR.knee];
    for (const j of joints) mergeStatics(j, { cellSize: 1e6, descend: false });
    const of = (node, mat) => node.children.filter((o) => o.isMesh && o.material === mat);
    // Trim: gold edging, eyes, hands and wand stop reading a few metres out
    this._lodTrim = [
      ...of(this.neck, mats.EYE), ...of(this.torso, mats.ROBE_TRIM),
      ...of(this.armL.elbow, mats.SKIN), ...of(this.armR.elbow, mats.SKIN),
      this.wand,
    ];
    // Limbs: past ~70m the arms are a pixel wide and the robe reads alone
    this._lodLimbs = [
      ...of(this.armL.shoulder, mats.ROBE), ...of(this.armR.shoulder, mats.ROBE),
      ...of(this.armL.elbow, mats.ROBE), ...of(this.armR.elbow, mats.ROBE),
      ...of(this.neck, mats.HAIR),
    ];
    this._casters = [];
    this.root.traverse((o) => { if (o.isMesh && o.castShadow) this._casters.push(o); });
    this._detail = 2;
  }

  // 2 full, 1 trim dropped, 0 distant silhouette, -1 not drawn at all.
  setDetail(level) {
    if (level === this._detail) return;
    this._detail = level;
    this.root.visible = level >= 0;
    if (level < 0) return;
    for (const m of this._lodTrim) m.visible = level >= 2;
    for (const m of this._lodLimbs) m.visible = level >= 1;
    // A shadow too small to resolve is a shadow not worth a draw call
    for (const m of this._casters) m.castShadow = level >= 1;
  }

  // Restyle without rebuilding: robes and trim share one material each
  setPalette({ robe, trim, skin, hair } = {}) {
    if (robe !== undefined) this._mats.ROBE.color.setHex(robe);
    if (trim !== undefined) this._mats.ROBE_TRIM.color.setHex(trim);
    if (skin !== undefined) this._mats.SKIN.color.setHex(skin);
    if (hair !== undefined) this._mats.HAIR.color.setHex(hair);
  }

  // state: {mode:'idle'|'move'|'air'|'dodge', speed01, dodgeT, airV}
  animate(dt, state) {
    const s = state.speed01 ?? 0;
    this._phase += dt * (4 + s * 8);
    const p = this._phase;
    const lerp = THREE.MathUtils.lerp;
    const damp = (cur, tgt, rate) => lerp(cur, tgt, 1 - Math.exp(-rate * dt));

    if (this._castTimer > 0) this._castTimer -= dt;
    const casting = this._castTimer > 0;

    if (state.mode === 'move' || state.mode === 'idle') {
      const swing = Math.sin(p) * (0.25 + s * 0.65);
      const bounce = Math.abs(Math.cos(p)) * 0.05 * s;
      this.hips.position.y = 0.95 + bounce - s * 0.03;
      this.hips.rotation.x = damp(this.hips.rotation.x, s * 0.12, 10);
      this.legL.hip.rotation.x = damp(this.legL.hip.rotation.x, swing, 18);
      this.legR.hip.rotation.x = damp(this.legR.hip.rotation.x, -swing, 18);
      this.legL.knee.rotation.x = damp(this.legL.knee.rotation.x, Math.max(0, -Math.sin(p)) * 0.9 * s, 18);
      this.legR.knee.rotation.x = damp(this.legR.knee.rotation.x, Math.max(0, Math.sin(p)) * 0.9 * s, 18);

      if (!casting) {
        this.armL.shoulder.rotation.x = damp(this.armL.shoulder.rotation.x, -swing * 0.8, 15);
        this.armR.shoulder.rotation.x = damp(this.armR.shoulder.rotation.x, swing * 0.8, 15);
        this.armL.elbow.rotation.x = damp(this.armL.elbow.rotation.x, -0.25 - s * 0.3, 12);
        this.armR.elbow.rotation.x = damp(this.armR.elbow.rotation.x, -0.25 - s * 0.3, 12);
      }
      // Idle breathing
      if (s < 0.05) {
        this.torso.rotation.x = Math.sin(p * 0.35) * 0.02;
        this.torso.position.y = Math.sin(p * 0.7) * 0.008;
      } else {
        this.torso.rotation.x = damp(this.torso.rotation.x, 0.05 * s, 8);
      }
      // Skirt + cape sway
      this.skirt.rotation.x = damp(this.skirt.rotation.x, s * 0.22, 10);
      this.skirt.rotation.z = Math.sin(p) * 0.06 * s;
      this.cape.rotation.x = damp(this.cape.rotation.x, 0.12 + s * 0.55 + Math.sin(p * 2) * 0.05 * s, 8);
    } else if (state.mode === 'air') {
      const rising = (state.airV ?? 0) > 0;
      this.legL.hip.rotation.x = damp(this.legL.hip.rotation.x, rising ? -0.5 : -0.15, 8);
      this.legR.hip.rotation.x = damp(this.legR.hip.rotation.x, rising ? 0.3 : -0.35, 8);
      this.legL.knee.rotation.x = damp(this.legL.knee.rotation.x, 0.8, 8);
      this.legR.knee.rotation.x = damp(this.legR.knee.rotation.x, 0.5, 8);
      if (!casting) {
        this.armL.shoulder.rotation.x = damp(this.armL.shoulder.rotation.x, -1.9, 6);
        this.armR.shoulder.rotation.x = damp(this.armR.shoulder.rotation.x, -1.9, 6);
        this.armL.shoulder.rotation.z = damp(this.armL.shoulder.rotation.z, -0.5, 6);
        this.armR.shoulder.rotation.z = damp(this.armR.shoulder.rotation.z, 0.5, 6);
      }
      this.skirt.rotation.x = damp(this.skirt.rotation.x, -0.25, 6);
      this.cape.rotation.x = damp(this.cape.rotation.x, 0.85, 5); // billows in the air
    } else if (state.mode === 'sit') {
      // Seated at a bench: thighs forward, shins down, hands near the table
      this.hips.position.y = damp(this.hips.position.y, 0.68, 8);
      this.hips.rotation.x = damp(this.hips.rotation.x, 0.04, 8);
      this.legL.hip.rotation.x = damp(this.legL.hip.rotation.x, -1.5, 8);
      this.legR.hip.rotation.x = damp(this.legR.hip.rotation.x, -1.5, 8);
      this.legL.knee.rotation.x = damp(this.legL.knee.rotation.x, 1.5, 8);
      this.legR.knee.rotation.x = damp(this.legR.knee.rotation.x, 1.5, 8);
      this.armL.shoulder.rotation.x = damp(this.armL.shoulder.rotation.x, -0.85, 7);
      this.armR.shoulder.rotation.x = damp(this.armR.shoulder.rotation.x, -0.8, 7);
      this.armL.elbow.rotation.x = damp(this.armL.elbow.rotation.x, -0.75, 7);
      this.armR.elbow.rotation.x = damp(this.armR.elbow.rotation.x, -0.8, 7);
      this.skirt.rotation.x = damp(this.skirt.rotation.x, -0.15, 6);
      this.cape.rotation.x = damp(this.cape.rotation.x, 0.1, 6);
      // Small idle life: breathing plus an occasional lean
      this.torso.rotation.x = Math.sin(p * 0.32) * 0.03;
      this.neck.rotation.y = Math.sin(p * 0.21) * 0.25;
    } else if (state.mode === 'climb') {
      // Splayed against the wall, hands and feet alternating as you haul up
      const reach = Math.sin(p * 1.2) * (state.speed01 ?? 0);
      this.hips.rotation.x = damp(this.hips.rotation.x, -0.12, 8);
      this.hips.position.y = damp(this.hips.position.y, 0.95, 8);
      this.armL.shoulder.rotation.x = damp(this.armL.shoulder.rotation.x, -2.5 + reach * 0.5, 9);
      this.armR.shoulder.rotation.x = damp(this.armR.shoulder.rotation.x, -2.5 - reach * 0.5, 9);
      this.armL.shoulder.rotation.z = damp(this.armL.shoulder.rotation.z, -0.35, 8);
      this.armR.shoulder.rotation.z = damp(this.armR.shoulder.rotation.z, 0.35, 8);
      this.armL.elbow.rotation.x = damp(this.armL.elbow.rotation.x, -0.25, 8);
      this.armR.elbow.rotation.x = damp(this.armR.elbow.rotation.x, -0.25, 8);
      this.legL.hip.rotation.x = damp(this.legL.hip.rotation.x, -0.55 - reach * 0.35, 9);
      this.legR.hip.rotation.x = damp(this.legR.hip.rotation.x, -0.55 + reach * 0.35, 9);
      this.legL.knee.rotation.x = damp(this.legL.knee.rotation.x, 0.9, 8);
      this.legR.knee.rotation.x = damp(this.legR.knee.rotation.x, 0.9, 8);
      this.skirt.rotation.x = damp(this.skirt.rotation.x, -0.35, 7);
      this.cape.rotation.x = damp(this.cape.rotation.x, 0.35, 6);
    } else if (state.mode === 'fly') {
      // Riding: seated astride the shaft, both hands out on the handle ahead,
      // knees folded back over the footrests. Speed tips the whole body down
      // over the broom rather than changing the grip.
      const s01 = state.speed01 ?? 0;
      const lean = 0.3 + s01 * 0.42;
      this.hips.rotation.x = damp(this.hips.rotation.x, lean, 5);
      // Sitting, so the whole body drops onto the shaft
      this.hips.position.y = damp(this.hips.position.y, 0.86, 6);
      // The broom stays nearer level than the rider: leaning into speed tips
      // the body over the handle, it does not point the broom at the ground
      if (this.broom) this.broom.rotation.x = damp(this.broom.rotation.x, -lean * 0.6, 5);
      // Both arms reach forward and down to the handle
      for (const arm of [this.armL, this.armR]) {
        arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x, -1.05 - s01 * 0.15, 7);
        arm.elbow.rotation.x = damp(arm.elbow.rotation.x, -0.5, 7);
      }
      this.armL.shoulder.rotation.z = damp(this.armL.shoulder.rotation.z, -0.2, 7);
      this.armR.shoulder.rotation.z = damp(this.armR.shoulder.rotation.z, 0.2, 7);
      // Astride: thighs forward across the seat, shins folded back under it
      this.legL.hip.rotation.x = damp(this.legL.hip.rotation.x, -1.25, 6);
      this.legR.hip.rotation.x = damp(this.legR.hip.rotation.x, -1.2, 6);
      this.legL.knee.rotation.x = damp(this.legL.knee.rotation.x, 1.5 + Math.sin(p * 0.5) * 0.05, 6);
      this.legR.knee.rotation.x = damp(this.legR.knee.rotation.x, 1.55 - Math.sin(p * 0.5) * 0.05, 6);
      this.skirt.rotation.x = damp(this.skirt.rotation.x, -0.15, 5);
      this.cape.rotation.x = damp(this.cape.rotation.x, -0.35 - s01 * 0.5 + Math.sin(p * 1.4) * 0.12, 5);
      // Head up, watching where the broom is going
      this.neck.rotation.x = damp(this.neck.rotation.x, -0.3 - lean * 0.5, 6);
    } else if (state.mode === 'swim') {
      // Prone glide: body pitched forward, alternating strokes, flutter kicks
      this.hips.rotation.x = damp(this.hips.rotation.x, 1.25, 6);
      this.hips.position.y = damp(this.hips.position.y, 0.55, 8);
      const stroke = Math.sin(p * 0.9);
      this.armL.shoulder.rotation.x = damp(this.armL.shoulder.rotation.x, -1.6 + stroke * 0.9, 8);
      this.armR.shoulder.rotation.x = damp(this.armR.shoulder.rotation.x, -1.6 - stroke * 0.9, 8);
      this.armL.elbow.rotation.x = damp(this.armL.elbow.rotation.x, -0.4, 8);
      this.armR.elbow.rotation.x = damp(this.armR.elbow.rotation.x, -0.4, 8);
      this.legL.hip.rotation.x = Math.sin(p * 1.6) * 0.4;
      this.legR.hip.rotation.x = -Math.sin(p * 1.6) * 0.4;
      this.legL.knee.rotation.x = 0.3;
      this.legR.knee.rotation.x = 0.3;
      this.skirt.rotation.x = damp(this.skirt.rotation.x, 0.5, 6);
      this.cape.rotation.x = damp(this.cape.rotation.x, 0.6, 5);
      this.neck.rotation.x = damp(this.neck.rotation.x, -0.9, 6); // head up out of the water
    } else if (state.mode === 'dodge') {
      // Forward roll driven by dodgeT (0..1)
      const t = state.dodgeT ?? 0;
      this.hips.rotation.x = t * Math.PI * 2;
      this.legL.hip.rotation.x = -1.2;
      this.legR.hip.rotation.x = -1.2;
      this.legL.knee.rotation.x = 2.0;
      this.legR.knee.rotation.x = 2.0;
      this.armL.shoulder.rotation.x = -0.8;
      this.armR.shoulder.rotation.x = -0.8;
    }
    if (state.mode !== 'dodge' && state.mode !== 'air') {
      // Undo roll rotation smoothly
      this.hips.rotation.x = this.hips.rotation.x % (Math.PI * 2);
      if (Math.abs(this.hips.rotation.x) > 0.4) {
        this.hips.rotation.x = damp(this.hips.rotation.x, 0, 14);
      }
    }
    if (state.mode !== 'air') {
      this.armL.shoulder.rotation.z = damp(this.armL.shoulder.rotation.z, -0.12, 8);
      this.armR.shoulder.rotation.z = damp(this.armR.shoulder.rotation.z, 0.12, 8);
    }
    if (state.mode !== 'swim' && state.mode !== 'fly') {
      this.neck.rotation.x = damp(this.neck.rotation.x, 0, 8);
    }
    if (state.mode !== 'sit') {
      this.neck.rotation.y = damp(this.neck.rotation.y, 0, 8);
      // 'move'/'idle' drive hips.y themselves; only airborne states need a reset
      if (state.mode === 'air' || state.mode === 'dodge') {
        this.hips.position.y = damp(this.hips.position.y, 0.95, 10);
      }
    }

    // The broom is summoned as you take off and dismissed as you land
    if (this.broom) {
      this._broomT = damp(this._broomT, state.mode === 'fly' ? 1 : 0, 14);
      this.broom.visible = this._broomT > 0.03;
      if (this.broom.visible) this.broom.scale.setScalar(this._broomT);
    }

    // Casting overrides right arm: thrust wand forward
    if (casting) {
      const t = 1 - this._castTimer / 0.35;
      const thrust = Math.sin(Math.min(t * Math.PI, Math.PI));
      this.armR.shoulder.rotation.x = -1.5 * thrust - 0.1;
      this.armR.elbow.rotation.x = -0.15;
    }
  }

  triggerCast() {
    this._castTimer = 0.35;
  }
}
