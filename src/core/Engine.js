import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GradingPass } from './GradingPass.js';
import { Input } from './Input.js';
import { OPTIMIZED, opt } from '../util/perfFlags.js';

// Owns renderer, composer, camera, and the fixed-update main loop. Game
// systems register with addSystem({update(dt), lateUpdate?(dt)}).

export class Engine {
  constructor(container) {
    this.container = container;
    // No MSAA: everything is drawn into the composer's own render target and
    // only a fullscreen quad ever reaches the canvas, so a multisampled
    // backbuffer would cost memory and bandwidth to antialias nothing.
    this.renderer = new THREE.WebGLRenderer({
      antialias: !OPTIMIZED, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opt(1.5, 2)));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.2, 3000);
    this.camera.position.set(0, 3, 8);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom is a blur: running its mip chain at half resolution is four times
    // cheaper and, at this radius, indistinguishable.
    this._bloomScale = opt(0.5, 1);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth * this._bloomScale,
        container.clientHeight * this._bloomScale),
      0.35, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // Grade after OutputPass so we work in display space
    this.grading = new GradingPass();
    this.composer.addPass(this.grading);

    this.input = new Input(this.renderer.domElement);
    this.clock = new THREE.Clock();
    this.systems = [];
    this.elapsed = 0;

    window.addEventListener('resize', () => this.onResize());
  }

  // The composer's targets are sized in drawing-buffer pixels, so they have to
  // be resized whenever the pixel ratio moves. Without this the quality
  // governor's pixelRatio steps only rescaled the final blit — the scene kept
  // being rendered at full resolution, which is most of the frame's GPU cost.
  _resizeTargets() {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setSize(s.width, s.height);
    this.bloom.setSize(s.width * this._bloomScale, s.height * this._bloomScale);
  }

  setPixelRatio(ratio) {
    const want = Math.min(window.devicePixelRatio, ratio);
    if (Math.abs(this.renderer.getPixelRatio() - want) < 0.001) return;
    this.renderer.setPixelRatio(want);
    this._resizeTargets();
  }

  onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this._resizeTargets();
  }

  addSystem(system) {
    this.systems.push(system);
    return system;
  }

  start() {
    this.renderer.setAnimationLoop(() => this.tick());
  }

  tick(fixedDt) {
    const dt = fixedDt ?? Math.min(this.clock.getDelta(), 1 / 20);
    this.elapsed += dt;
    const t0 = performance.now();
    for (const s of this.systems) s.update(dt, this.elapsed);
    for (const s of this.systems) s.lateUpdate?.(dt, this.elapsed);
    this.composer.render();
    this.input.lateUpdate();
    // Measured CPU+submit time drives the adaptive quality governor
    this.profiler?.update(performance.now() - t0, this.renderer, this.bloom);
  }
}
