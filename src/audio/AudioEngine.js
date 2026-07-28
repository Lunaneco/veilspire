// Fully procedural WebAudio: ambient wind bed, day birdsong, spell casts,
// impacts, footsteps. No external assets. Context resumes on first gesture.

export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    const resume = () => {
      if (this.ctx.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);

    this._buildWind();
    this._birdTimer = 2;
    this._up = [0, 1, 0];
  }

  // Keep the listener on the camera so positioned sounds pan correctly
  setListener(camera, dir) {
    const l = this.ctx.listener;
    const p = camera.position;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(dir.x, t);
      l.forwardY.setValueAtTime(dir.y, t);
      l.forwardZ.setValueAtTime(dir.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(dir.x, dir.y, dir.z, 0, 1, 0);
    }
  }

  // Destination for a sound: a 3D panner when a position is given, else master
  _dest(pos) {
    if (!pos) return this.master;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 6;
    panner.maxDistance = 220;
    panner.rolloffFactor = 1.1;
    if (panner.positionX) {
      const t = this.ctx.currentTime;
      panner.positionX.setValueAtTime(pos.x, t);
      panner.positionY.setValueAtTime(pos.y, t);
      panner.positionZ.setValueAtTime(pos.z, t);
    } else {
      panner.setPosition(pos.x, pos.y, pos.z);
    }
    panner.connect(this.master);
    this._panners = (this._panners ?? 0) + 1;
    return panner;
  }

  _noiseBuffer(seconds = 2) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4);
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.05;
    src.connect(lp);
    lp.connect(this.windGain);
    this.windGain.connect(this.master);
    src.start();
    // Slow LFO on filter for gusts
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();
  }

  // Rush of air while flying: a second, brighter noise bed on top of the
  // ambient wind, opened up by speed. Built lazily — most sessions never fly.
  _buildRush() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4);
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.5;
    this.rushFilter = bp;
    this.rushGain = this.ctx.createGain();
    this.rushGain.gain.value = 0;
    src.connect(bp);
    bp.connect(this.rushGain);
    this.rushGain.connect(this.master);
    src.start();
  }

  // speed01 0..1; silent and free when not flying
  setFlightRush(speed01) {
    if (!speed01 && !this.rushGain) return;
    if (!this.rushGain) this._buildRush();
    const t = this.ctx.currentTime;
    // Ramp rather than jump, or toggling flight clicks
    this.rushGain.gain.setTargetAtTime(0.16 * speed01 * speed01, t, 0.12);
    this.rushFilter.frequency.setTargetAtTime(700 + speed01 * 1500, t, 0.18);
  }

  // dayness 0..1 controls bird likelihood; wind strength varies with weather later
  update(dt, dayness = 1) {
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 3 + Math.random() * 9;
      if (this.ctx.state === 'running' && Math.random() < dayness * 0.85) this._chirp();
    }
  }

  _env(gainNode, t0, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  _chirp() {
    const t = this.ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const g = this.ctx.createGain();
      o.connect(g);
      g.connect(this.master);
      const nt = t + i * (0.09 + Math.random() * 0.06);
      const f = base * (1 + (Math.random() - 0.3) * 0.25);
      o.frequency.setValueAtTime(f, nt);
      o.frequency.exponentialRampToValueAtTime(f * (1.1 + Math.random() * 0.3), nt + 0.06);
      this._env(g, nt, 0.012, 0.05 + Math.random() * 0.04, 0.09);
      o.start(nt);
      o.stop(nt + 0.2);
    }
  }

  castWhoosh(pitch = 1, pos = null) {
    if (this.ctx.state !== 'running') return;
    const out = this._dest(pos);
    const t = this.ctx.currentTime;
    // Filtered noise sweep + chime
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.5);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(500 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(2600 * pitch, t + 0.18);
    const g = this.ctx.createGain();
    src.connect(bp); bp.connect(g); g.connect(out);
    this._env(g, t, 0.02, 0.35, 0.24);
    src.start(t); src.stop(t + 0.5);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880 * pitch, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(1760 * pitch, t + 0.22);
    const og = this.ctx.createGain();
    o.connect(og); og.connect(out);
    this._env(og, t + 0.05, 0.02, 0.12, 0.3);
    o.start(t + 0.05); o.stop(t + 0.6);
  }

  impact(strength = 1, pos = null) {
    if (this.ctx.state !== 'running') return;
    const out = this._dest(pos);
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.4);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + 0.22);
    const g = this.ctx.createGain();
    src.connect(lp); lp.connect(g); g.connect(out);
    this._env(g, t, 0.005, 0.5 * strength, 0.26);
    src.start(t); src.stop(t + 0.45);
    // Sub thump
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    const og = this.ctx.createGain();
    o.connect(og); og.connect(out);
    this._env(og, t, 0.005, 0.45 * strength, 0.2);
    o.start(t); o.stop(t + 0.4);
  }

  footstep(pos = null) {
    if (this.ctx.state !== 'running') return;
    const out = this._dest(pos);
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.12);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 + Math.random() * 250;
    const g = this.ctx.createGain();
    src.connect(lp); lp.connect(g); g.connect(out);
    this._env(g, t, 0.004, 0.1 + Math.random() * 0.05, 0.07);
    src.start(t); src.stop(t + 0.15);
  }
}
