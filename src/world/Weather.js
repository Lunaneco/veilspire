import * as THREE from 'three';

// Weather state machine: clear -> overcast -> rain -> storm. Blended params
// drive rain particles, sun dimming, fog, cloud layer, lightning, wind audio.

const STATES = {
  clear: { rain: 0, dim: 0, cloud: 0, fogMult: 1, snow: 0 },
  overcast: { rain: 0, dim: 0.45, cloud: 0.75, fogMult: 1.6, snow: 0 },
  rain: { rain: 1, dim: 0.6, cloud: 0.9, fogMult: 2.2, snow: 0 },
  storm: { rain: 1.6, dim: 0.75, cloud: 1, fogMult: 2.8, snow: 0 },
  snow: { rain: 0, dim: 0.5, cloud: 0.85, fogMult: 2.6, snow: 1 },
};
const RAIN_COUNT = 2600;

export class Weather {
  constructor(scene, camera, audio = null) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.state = 'clear';
    this.next = 'clear';
    this.blend = 1; // 1 = fully in `state`
    this.holdTimer = 30; // seconds until considering a change
    this.cur = { ...STATES.clear };
    this.lightningTimer = 0;
    this.flash = 0;

    // Rain: vertical streak line segments falling in a box around the camera
    const geo = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(RAIN_COUNT * 6); // two verts per drop
    const STREAK = 0.55;
    this.STREAK = STREAK;
    for (let i = 0; i < RAIN_COUNT; i++) {
      const x = (Math.random() - 0.5) * 44;
      const y = Math.random() * 30;
      const z = (Math.random() - 0.5) * 44;
      this.rainPos[i * 6] = x;
      this.rainPos[i * 6 + 1] = y;
      this.rainPos[i * 6 + 2] = z;
      this.rainPos[i * 6 + 3] = x;
      this.rainPos[i * 6 + 4] = y - STREAK;
      this.rainPos[i * 6 + 5] = z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x9ab4d0, transparent: true, opacity: 0, depthWrite: false,
    });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);

    // Cloud layer: procedural canvas alpha texture on a huge plane
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        let v = 0, amp = 1, f = 1;
        for (let o = 0; o < 4; o++) {
          v += amp * (Math.sin(x * 0.045 * f + o * 13.7) * Math.cos(y * 0.05 * f + o * 7.3));
          amp *= 0.55; f *= 2.1;
        }
        const a = Math.max(0, Math.min(1, v * 0.5 + 0.45));
        const idx = (y * 256 + x) * 4;
        img.data[idx] = 30; img.data[idx + 1] = 34; img.data[idx + 2] = 44;
        img.data[idx + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const cloudTex = new THREE.CanvasTexture(cv);
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    cloudTex.repeat.set(4, 4);
    this.cloudTex = cloudTex;
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshBasicMaterial({
        map: cloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false,
      })
    );
    this.clouds.rotation.x = Math.PI / 2;
    this.clouds.position.y = 260;
    this.clouds.visible = false;
    scene.add(this.clouds);

    // Snow: soft drifting flakes in a box that follows the camera
    const SNOW_COUNT = 2200;
    const sGeo = new THREE.BufferGeometry();
    this.snowPos = new Float32Array(SNOW_COUNT * 3);
    this.snowPhase = new Float32Array(SNOW_COUNT);
    for (let i = 0; i < SNOW_COUNT; i++) {
      this.snowPos[i * 3] = (Math.random() - 0.5) * 46;
      this.snowPos[i * 3 + 1] = Math.random() * 30;
      this.snowPos[i * 3 + 2] = (Math.random() - 0.5) * 46;
      this.snowPhase[i] = Math.random() * 6.28;
    }
    this.SNOW_COUNT = SNOW_COUNT;
    sGeo.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    // Round soft flake sprite — square points read as paper confetti
    const flakeTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const ctx = cv.getContext('2d');
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(cv);
    })();
    this.snow = new THREE.Points(sGeo, new THREE.PointsMaterial({
      map: flakeTex, color: 0xffffff, size: 0.075, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    scene.add(this.snow);

    this.flashLight = new THREE.DirectionalLight(0xd8e8ff, 0);
    this.flashLight.position.set(50, 200, -50);
    scene.add(this.flashLight);
  }

  // wetness for ground darkening, 0..1
  get wetness() { return Math.min(1, this.cur.rain); }

  // snow coverage for ground whitening, 0..1
  get snowCover() { return Math.min(1, this.cur.snow ?? 0); }

  requestState(s) {
    if (STATES[s] && s !== this.state) {
      this.next = s;
      this.blend = 0;
    }
  }

  update(dt, elapsed) {
    // Autonomous transitions
    this.holdTimer -= dt;
    if (this.holdTimer <= 0) {
      this.holdTimer = 60 + Math.random() * 120;
      const r = Math.random();
      const options = this.state === 'clear'
        ? (r < 0.55 ? 'clear' : r < 0.8 ? 'overcast' : 'rain')
        : this.state === 'overcast'
          ? (r < 0.35 ? 'clear' : r < 0.6 ? 'rain' : r < 0.75 ? 'snow' : 'overcast')
          : this.state === 'rain'
            ? (r < 0.35 ? 'overcast' : r < 0.55 ? 'storm' : 'rain')
            : this.state === 'snow'
              ? (r < 0.5 ? 'overcast' : 'snow')
              : (r < 0.6 ? 'rain' : 'overcast');
      this.requestState(options);
    }

    // Blend params
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 8);
      if (this.blend >= 1) this.state = this.next;
    }
    const from = STATES[this.state], to = STATES[this.next];
    for (const k of Object.keys(this.cur)) {
      this.cur[k] = THREE.MathUtils.lerp(from[k], to[k], this.blend);
    }

    // Rain particles — suppressed indoors (there is a roof overhead)
    const raining = this.cur.rain > 0.03 && !this.indoors;
    this.rain.visible = raining;
    if (raining) {
      this.rain.material.opacity = Math.min(0.4, this.cur.rain * 0.32);
      const c = this.camera.position;
      this.rain.position.set(c.x, c.y, c.z);
      const fall = (34 + this.cur.rain * 10) * dt;
      for (let i = 0; i < RAIN_COUNT; i++) {
        let y = this.rainPos[i * 6 + 1] - fall;
        if (y < -8) y = 22 + Math.random() * 8;
        this.rainPos[i * 6 + 1] = y;
        this.rainPos[i * 6 + 4] = y - this.STREAK;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // Snow drifts down and sideways, and is also suppressed indoors
    const snowing = (this.cur.snow ?? 0) > 0.03 && !this.indoors;
    this.snow.visible = snowing;
    if (snowing) {
      this.snow.material.opacity = Math.min(0.85, this.cur.snow * 0.8);
      const c = this.camera.position;
      this.snow.position.set(c.x, c.y, c.z);
      for (let i = 0; i < this.SNOW_COUNT; i++) {
        let y = this.snowPos[i * 3 + 1] - 2.6 * dt;
        if (y < -8) y = 22 + Math.random() * 8;
        this.snowPos[i * 3 + 1] = y;
        // Gentle lateral drift so flakes swirl rather than fall straight
        this.snowPos[i * 3] += Math.sin(elapsed * 0.7 + this.snowPhase[i]) * 0.9 * dt;
        this.snowPos[i * 3 + 2] += Math.cos(elapsed * 0.5 + this.snowPhase[i]) * 0.9 * dt;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }

    // Clouds
    this.clouds.visible = this.cur.cloud > 0.02;
    this.clouds.material.opacity = this.cur.cloud * 0.85;
    this.cloudTex.offset.x = elapsed * 0.0016;
    this.cloudTex.offset.y = elapsed * 0.0007;
    this.clouds.position.x = this.camera.position.x;
    this.clouds.position.z = this.camera.position.z;

    // Lightning during storm
    if (this.state === 'storm' || this.next === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0 && this.cur.rain > 1.2) {
        this.lightningTimer = 4 + Math.random() * 9;
        this.flash = 1;
        this.audio?.impact(1.6); // thunder stand-in (dedicated rumble later)
      }
    }
    if (this.flash > 0) {
      this.flash -= dt * 3.5;
      this.flashLight.intensity = Math.max(0, this.flash) * 6 * (0.6 + Math.sin(this.flash * 40) * 0.4);
    } else {
      this.flashLight.intensity = 0;
    }

    // Wind audio follows weather
    if (this.audio) {
      this.audio.windGain.gain.value = 0.05 + this.cur.rain * 0.06 + this.cur.cloud * 0.03;
    }
  }
}
