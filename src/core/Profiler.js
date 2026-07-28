import { OPTIMIZED, opt } from '../util/perfFlags.js';

// Frame profiler and adaptive quality governor. F3 shows the overlay.
// When the rolling frame time exceeds the budget the governor steps quality
// down (pixel ratio, bloom, grass density, shadows); when there is headroom
// to spare it steps back up, so the game keeps a stable frame rate.

const TIERS = [
  { name: 'ULTRA', pixelRatio: 1.75, bloom: 0.35, grass: 1.0, shadow: 2048 },
  { name: 'HIGH', pixelRatio: 1.5, bloom: 0.32, grass: 0.8, shadow: 2048 },
  { name: 'MEDIUM', pixelRatio: 1.25, bloom: 0.28, grass: 0.55, shadow: 1024 },
  { name: 'LOW', pixelRatio: 1.0, bloom: 0.0, grass: 0.35, shadow: 1024 },
];

export class Profiler {
  constructor(engine, container) {
    this.engine = engine;
    this.samples = new Float32Array(90);
    this.cursor = 0;
    this.filled = 0;
    this.visible = false;
    // Phones start at medium and never climb to ultra. They are constrained by
    // fill rate and thermals long before a desktop-class scene becomes costly.
    this.bestTier = engine.mobileMode ? 1 : 0;
    this.tier = engine.mobileMode ? 2 : (OPTIMIZED ? 1 : 0);
    this.autoQuality = true;
    this.budgetMs = opt(15, 20);   // 15ms leaves room inside a 60fps frame
    this.headroomMs = opt(9, 11);  // step back up below this
    this.settleTimer = 3;
    this.onTierChange = null;

    const el = document.createElement('div');
    el.id = 'profiler';
    el.innerHTML = `
      <style>
        #profiler { position: absolute; left: 28px; top: 70px; display: none;
          font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; line-height: 1.7;
          color: #bfe6ff; background: rgba(6,10,18,0.78); padding: 10px 14px;
          border: 1px solid rgba(140,190,240,0.3); border-radius: 8px; pointer-events: none;
          white-space: pre; letter-spacing: 0.3px; }
        #profiler b { color: #ffd27a; font-weight: normal; }
      </style>
      <div class="body"></div>
    `;
    container.appendChild(el);
    this.el = el;
    this.body = el.querySelector('.body');
  }

  get avgMs() {
    if (!this.filled) return 0;
    let sum = 0;
    for (let i = 0; i < this.filled; i++) sum += this.samples[i];
    return sum / this.filled;
  }

  get p95Ms() {
    if (!this.filled) return 0;
    const a = Array.from(this.samples.slice(0, this.filled)).sort((x, y) => x - y);
    return a[Math.floor(a.length * 0.95)];
  }

  applyTier(renderer, bloomPass) {
    const t = TIERS[this.tier];
    this.engine.setPixelRatio(t.pixelRatio);
    if (bloomPass) {
      bloomPass.enabled = t.bloom > 0;
      bloomPass.strength = t.bloom;
    }
    this.onTierChange?.(t);
  }

  update(dtMs, renderer, bloomPass) {
    this.samples[this.cursor] = dtMs;
    this.cursor = (this.cursor + 1) % this.samples.length;
    this.filled = Math.min(this.filled + 1, this.samples.length);

    if (this.autoQuality) {
      this.settleTimer -= dtMs / 1000;
      if (this.settleTimer <= 0 && this.filled >= this.samples.length) {
        const avg = this.avgMs;
        if (avg > this.budgetMs && this.tier < TIERS.length - 1) {
          this.tier++;
          this.applyTier(renderer, bloomPass);
          this.settleTimer = 3;
        } else if (avg < this.headroomMs && this.tier > this.bestTier) {
          this.tier--;
          this.applyTier(renderer, bloomPass);
          this.settleTimer = 5; // slower to climb than to drop
        }
      }
    }
  }

  render(extra = {}) {
    if (!this.visible) return;
    const info = this.engine.renderer.info;
    const avg = this.avgMs;
    const lines = [
      `<b>${(1000 / Math.max(avg, 0.001)).toFixed(0)} fps</b>   ${avg.toFixed(2)} ms   p95 ${this.p95Ms.toFixed(2)} ms`,
      `quality  <b>${TIERS[this.tier].name}</b>${this.autoQuality ? '' : ' (locked)'}   dpr ${this.engine.renderer.getPixelRatio().toFixed(2)}`,
      `geometry ${info.memory.geometries}   textures ${info.memory.textures}   programs ${info.programs?.length ?? 0}`,
      `objects  ${extra.objects ?? '-'}   lights ${extra.lights ?? '-'}   instanced ${extra.instanced ?? '-'}`,
      `grass    ${extra.grass ?? '-'}   props ${extra.props ?? '-'}   enemies ${extra.enemies ?? '-'}`,
    ];
    this.body.innerHTML = lines.join('\n');
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  get tierName() { return TIERS[this.tier].name; }
  get tierSettings() { return TIERS[this.tier]; }
}
