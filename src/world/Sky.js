import * as THREE from 'three';
import { opt } from '../util/perfFlags.js';

// Dynamic sky dome with day/night cycle: gradient atmosphere shader, sun/moon
// discs, stars, plus scene lights (sun directional, hemisphere ambient) and
// fog color all driven from one timeOfDay value (hours, 0-24).

const SKY_VERT = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
varying vec3 vWorldDir;
uniform vec3 uSunDir;
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uGroundColor;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uStarAmount;
uniform float uTime;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float h = dir.y;
  float horizonBlend = pow(1.0 - clamp(h, 0.0, 1.0), 3.0);
  vec3 sky = mix(uZenithColor, uHorizonColor, horizonBlend);
  sky = mix(sky, uGroundColor, smoothstep(0.0, -0.25, h));

  // Sun disc + glow
  float sunDot = dot(dir, uSunDir);
  float disc = smoothstep(0.9993, 0.9997, sunDot);
  float glow = pow(clamp(sunDot, 0.0, 1.0), 32.0) * 0.35;
  sky += uSunColor * (disc * uSunIntensity + glow * uSunIntensity);

  // Stars (only above horizon, fade near horizon)
  if (uStarAmount > 0.001 && h > 0.02) {
    vec2 sp = dir.xz / (dir.y + 0.4) * 90.0;
    vec2 cell = floor(sp);
    float star = step(0.996, hash21(cell));
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.5 + hash21(cell + 7.0) * 3.0) + hash21(cell + 3.0) * 6.28);
    sky += vec3(0.9, 0.95, 1.0) * star * twinkle * uStarAmount * smoothstep(0.02, 0.25, h);
  }

  gl_FragColor = vec4(sky, 1.0);
}
`;

function lerpColor(out, a, b, t) {
  out.copy(a).lerp(b, t);
  return out;
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.timeOfDay = 15.2; // warm afternoon default — full light on the approach façade
    this.daySpeed = 1 / 60; // 1 game hour per minute by default

    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uZenithColor: { value: new THREE.Color(0x2b5da8) },
      uHorizonColor: { value: new THREE.Color(0xbdd7ee) },
      uGroundColor: { value: new THREE.Color(0x1a2030) },
      uSunColor: { value: new THREE.Color(0xfff2d0) },
      uSunIntensity: { value: 1.0 },
      uStarAmount: { value: 0.0 },
      uTime: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    dome.frustumCulled = false;
    scene.add(dome);
    this.dome = dome;

    this.sun = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    // Tighter than it was: the same 2048 map over a 124m box instead of a 180m
    // one is both sharper and cheaper, since fewer casters fall inside it.
    const ext = opt(62, 90);
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun, this.sun.target);

    // Ground bounce kept fairly light so downward-facing faces never read black
    this.hemi = new THREE.HemisphereLight(0xbdd7ee, 0x6b7a52, 0.55);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xbdd7ee, 0.0016);

    // Reusable palette colors
    this._c = {
      dayZenith: new THREE.Color(0x2e64b0), dayHorizon: new THREE.Color(0xa8c8e8),
      duskZenith: new THREE.Color(0x1f2c56), duskHorizon: new THREE.Color(0xff8f4d),
      nightZenith: new THREE.Color(0x050810), nightHorizon: new THREE.Color(0x101a30),
      daySun: new THREE.Color(0xfff4d6), duskSun: new THREE.Color(0xff9a3d),
      moon: new THREE.Color(0x9fb4d8),
      dayFog: new THREE.Color(0xa8c8e8), duskFog: new THREE.Color(0xd88a5a),
      nightFog: new THREE.Color(0x0a1020),
    };
    this._tmp = new THREE.Color();
    this._tmp2 = new THREE.Color();
    this._envTimer = -1; // force env build on first update
    this._pmrem = null;
  }

  // Build/refresh scene.environment from the sky dome so PBR materials get
  // real image-based ambient + specular. Called periodically (cheap: 64px).
  refreshEnvironment(renderer) {
    if (!this._pmrem) this._pmrem = new THREE.PMREMGenerator(renderer);
    if (!this._envScene) {
      // Built once and reused: this runs every few seconds, and cloning the
      // dome into a fresh Scene each time was pure garbage. The clone shares
      // the live shader uniforms, so it still tracks the time of day.
      this._envScene = new THREE.Scene();
      this._envScene.add(this.dome.clone());
    }
    const rt = this._pmrem.fromScene(this._envScene, 0.04, 0.1, 2000); // far must cover the dome
    const old = this.scene.environment;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.75;
    if (old) old.dispose();
    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
  }

  // Anchor shadow camera around a focus point (the player) so shadows stay sharp.
  setFocus(pos) {
    const d = this.uniforms.uSunDir.value;
    this.sun.position.set(pos.x + d.x * 120, pos.y + d.y * 120, pos.z + d.z * 120);
    this.sun.target.position.copy(pos);
  }

  update(dt, elapsed, weather = null) {
    this.timeOfDay = (this.timeOfDay + dt * this.daySpeed) % 24;
    const t = this.timeOfDay;
    this.uniforms.uTime.value = elapsed;

    // Sun path: rises 6h, sets 18h. Elevation angle from time.
    const dayPhase = (t - 6) / 12; // 0..1 during day
    const sunAngle = dayPhase * Math.PI; // 0=east horizon, pi=west horizon
    const elev = Math.sin(sunAngle);
    const sunDir = this.uniforms.uSunDir.value;
    // Sun arcs through the SOUTHERN sky (+z) so the academy's approach façade is lit
    sunDir.set(Math.cos(sunAngle) * 0.8, elev, 0.45 - 0.18 * Math.cos(sunAngle)).normalize();
    this.sunElevation = elev; // true sun elevation, valid even when moonlight flips uSunDir

    const c = this._c;
    const dayness = THREE.MathUtils.smoothstep(elev, -0.06, 0.25); // 0 night, 1 day
    const duskness = Math.max(0, 1 - Math.abs(elev) / 0.28) * (elev > -0.12 ? 1 : 0);

    // Sky colors: night -> day base, then push dusk tint in.
    const zen = lerpColor(this._tmp, c.nightZenith, c.dayZenith, dayness);
    this.uniforms.uZenithColor.value.copy(zen).lerp(c.duskZenith, duskness * 0.7);
    const hor = lerpColor(this._tmp2, c.nightHorizon, c.dayHorizon, dayness);
    this.uniforms.uHorizonColor.value.copy(hor).lerp(c.duskHorizon, duskness);

    this.uniforms.uStarAmount.value = 1 - THREE.MathUtils.smoothstep(elev, -0.18, 0.02);

    const isDay = elev > -0.1;
    if (isDay) {
      this.uniforms.uSunColor.value.copy(c.daySun).lerp(c.duskSun, duskness);
      this.uniforms.uSunIntensity.value = 1.0;
      this.sun.color.copy(this.uniforms.uSunColor.value);
      // Keep meaningful sun presence even at low elevation for readable forms
      this.sun.intensity = 1.2 + 2.6 * Math.max(0, elev) + 0.8 * duskness;
    } else {
      // Moonlight: dim cool light from opposite direction
      sunDir.multiplyScalar(-1);
      this.uniforms.uSunColor.value.copy(c.moon);
      this.uniforms.uSunIntensity.value = 0.25;
      this.sun.color.copy(c.moon);
      this.sun.intensity = 1.1; // cinematic moonlight — night stays readable
    }

    this.hemi.intensity = 0.75 + 0.85 * dayness;
    this.hemi.color.copy(this.uniforms.uHorizonColor.value).lerp(this.uniforms.uZenithColor.value, 0.4);

    const fog = lerpColor(this._tmp, c.nightFog, c.dayFog, dayness);
    fog.lerp(c.duskFog, duskness * 0.6);
    // Weather: dim the sun, gray the sky, thicken fog
    const dim = weather?.cur.dim ?? 0;
    const fogMult = weather?.cur.fogMult ?? 1;
    if (dim > 0.01) {
      this.sun.intensity *= (1 - dim * 0.8);
      this.hemi.intensity *= (1 - dim * 0.35);
      const gray = this._tmp2.setScalar(0.45);
      this.uniforms.uZenithColor.value.lerp(gray, dim * 0.7);
      this.uniforms.uHorizonColor.value.lerp(gray, dim * 0.55);
      fog.lerp(gray, dim * 0.5);
      this.uniforms.uSunIntensity.value *= (1 - dim);
    }
    this.scene.fog.color.copy(fog);
    let density = (0.0014 + 0.0012 * (1 - dayness)) * fogMult;
    // Indoors: fog vanishes, exterior light recedes, warm interior takes over
    const interior = this.interiorFactor ?? 0;
    if (interior > 0.01) {
      density *= (1 - interior * 0.92);
      this.sun.intensity *= (1 - interior * 0.75);
      this.hemi.intensity *= (1 - interior * 0.45);
    }
    this.scene.fog.density = density;
  }
}
