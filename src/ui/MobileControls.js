// Touch controls share the keyboard-shaped Input API so gameplay systems do
// not need separate mobile branches.

const MOVE_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];
const HELD_KEYS = [...MOVE_KEYS, 'ShiftLeft', 'KeyX'];

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const forced = new URLSearchParams(window.location.search).get('mobile') === '1';
  return forced
    || 'ontouchstart' in window
    || (navigator.maxTouchPoints || 0) > 0
    || window.matchMedia?.('(pointer: coarse)').matches;
}

export function stickDirections(nx, ny, deadZone = 0.28) {
  return {
    forward: ny < -deadZone,
    back: ny > deadZone,
    left: nx < -deadZone,
    right: nx > deadZone,
    sprint: Math.hypot(nx, ny) > 0.85,
  };
}

export class MobileControls {
  constructor(container, input) {
    this.input = input;
    this.enabled = isTouchDevice();
    this.root = null;
    this._stick = {
      active: false, id: null, ox: 0, oy: 0, nx: 0, ny: 0,
    };
    this._look = {
      active: false, id: null, x: 0, y: 0,
    };
    this._manualSprint = false;
    this._manualWard = false;
    this._wasSuspended = false;

    if (!this.enabled) return;

    input.touchMode = true;
    document.documentElement.classList.add('touch-ui');
    document.body?.classList.add('touch-ui');

    const el = document.createElement('div');
    el.id = 'mobile-controls';
    el.setAttribute('aria-label', 'Touch game controls');
    el.innerHTML = `
      <style>
        #mobile-controls {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100%;
          height: 100dvh;
          overflow: hidden;
          z-index: 40;
          pointer-events: none;
          color: #e8f0fa;
          font-family: system-ui, -apple-system, sans-serif;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
        }
        #mobile-controls * {
          box-sizing: border-box;
          touch-action: none;
          -webkit-tap-highlight-color: transparent;
        }
        #mc-stick-zone {
          position: absolute;
          left: 0;
          bottom: 0;
          width: 46%;
          height: 48%;
          pointer-events: auto;
        }
        #mc-stick-base {
          position: absolute;
          left: max(18px, env(safe-area-inset-left));
          bottom: max(22px, env(safe-area-inset-bottom));
          width: 128px;
          height: 128px;
          border: 2px solid rgba(190, 210, 240, 0.28);
          border-radius: 50%;
          background: rgba(8, 14, 28, 0.38);
          box-shadow: inset 0 0 24px rgba(0, 0, 0, 0.35);
        }
        #mc-stick-knob {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 54px;
          height: 54px;
          margin: -27px 0 0 -27px;
          border: 2px solid rgba(230, 240, 255, 0.55);
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%,
            rgba(210, 230, 255, 0.78), rgba(90, 120, 170, 0.55));
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
        }
        #mc-stick-base.active #mc-stick-knob {
          background: radial-gradient(circle at 35% 30%,
            rgba(240, 248, 255, 0.96), rgba(120, 160, 220, 0.72));
        }
        #mc-look-zone {
          position: absolute;
          top: 0;
          right: 0;
          width: 54%;
          height: 62%;
          pointer-events: auto;
        }
        #mc-look-zone::after {
          content: 'SWIPE TO LOOK';
          position: absolute;
          right: max(18px, env(safe-area-inset-right));
          top: 48%;
          color: rgba(220, 235, 250, 0.26);
          font-size: 9px;
          letter-spacing: 2px;
        }
        #mc-actions {
          position: absolute;
          right: max(12px, env(safe-area-inset-right));
          bottom: max(96px, calc(env(safe-area-inset-bottom) + 88px));
          display: grid;
          grid-template-columns: repeat(3, 58px);
          gap: 10px;
          pointer-events: auto;
        }
        .mc-btn,
        .mc-spell,
        .mc-util {
          appearance: none;
          -webkit-appearance: none;
          color: #e8f0fa;
          font: inherit;
          cursor: pointer;
        }
        .mc-btn {
          display: flex;
          width: 58px;
          height: 58px;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          border: 1.5px solid rgba(200, 220, 245, 0.42);
          border-radius: 50%;
          background: rgba(10, 16, 30, 0.66);
          box-shadow: 0 3px 14px rgba(0, 0, 0, 0.4);
          font-size: 11px;
          letter-spacing: 0.4px;
        }
        .mc-btn .g { font-size: 18px; line-height: 1; }
        .mc-btn.primary {
          width: 68px;
          height: 68px;
          border-color: rgba(160, 200, 255, 0.58);
          background: rgba(40, 70, 130, 0.76);
        }
        .mc-btn.ward { border-color: rgba(120, 190, 255, 0.68); }
        .mc-btn:active,
        .mc-btn.held,
        .mc-spell:active,
        .mc-util:active,
        .mc-util.held {
          border-color: rgba(225, 238, 255, 0.9);
          background: rgba(65, 105, 175, 0.84);
          transform: scale(0.94);
        }
        #mc-actions .mc-jump { grid-column: 3; grid-row: 1; }
        #mc-actions .mc-dodge { grid-column: 2; grid-row: 1; }
        #mc-actions .mc-attack { grid-column: 3; grid-row: 2; }
        #mc-actions .mc-ward { grid-column: 2; grid-row: 2; }
        #mc-actions .mc-sprint { grid-column: 1; grid-row: 2; }
        #mc-actions .mc-interact { grid-column: 1; grid-row: 1; }
        #mc-spells {
          position: absolute;
          left: 50%;
          bottom: max(8px, env(safe-area-inset-bottom));
          display: flex;
          max-width: calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right) - 12px);
          gap: 4px;
          padding: 4px 8px;
          overflow-x: auto;
          pointer-events: auto;
          transform: translateX(-50%);
          scrollbar-width: none;
        }
        #mc-spells::-webkit-scrollbar { display: none; }
        .mc-spell {
          display: flex;
          min-width: 44px;
          width: 44px;
          height: 48px;
          flex: 0 0 auto;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          padding: 0 6px;
          border: 1px solid rgba(190, 210, 240, 0.42);
          border-radius: 12px;
          background: rgba(8, 12, 24, 0.76);
          font-size: 10px;
        }
        .mc-spell .g { font-size: 16px; line-height: 1; }
        #mc-utils {
          position: absolute;
          top: max(54px, calc(env(safe-area-inset-top) + 48px));
          left: max(10px, env(safe-area-inset-left));
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: auto;
        }
        .mc-util {
          display: flex;
          width: 46px;
          height: 46px;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          border: 1px solid rgba(180, 200, 230, 0.38);
          border-radius: 12px;
          background: rgba(8, 14, 28, 0.6);
          font-size: 10px;
        }
        .mc-util .g { font-size: 15px; }
        #mobile-controls.suspended #mc-stick-zone,
        #mobile-controls.suspended #mc-look-zone,
        #mobile-controls.suspended #mc-actions,
        #mobile-controls.suspended #mc-spells {
          opacity: 0.14;
          pointer-events: none;
        }
        #mobile-controls.suspended #mc-utils .mc-util:not([data-press="KeyI"]) {
          opacity: 0;
          pointer-events: none;
        }

        /* HUD and modal layout while touch controls are active. */
        html.touch-ui #hud #hint { display: none !important; }
        html.touch-ui #hud #spells { display: none !important; }
        html.touch-ui #hud #bars {
          left: max(14px, env(safe-area-inset-left));
          bottom: max(168px, calc(env(safe-area-inset-bottom) + 150px));
        }
        html.touch-ui #hud #bars .bar {
          width: min(180px, 42vw);
          height: 10px;
        }
        html.touch-ui #hud #levelbadge {
          left: max(14px, env(safe-area-inset-left));
          bottom: max(208px, calc(env(safe-area-inset-bottom) + 190px));
        }
        html.touch-ui #hud #karma {
          left: max(14px, env(safe-area-inset-left));
          bottom: max(230px, calc(env(safe-area-inset-bottom) + 212px));
        }
        html.touch-ui #hud #prompt {
          bottom: max(200px, calc(env(safe-area-inset-bottom) + 180px));
          max-width: 68vw;
          font-size: 14px;
        }
        html.touch-ui #hud #toast {
          top: max(64px, calc(env(safe-area-inset-top) + 54px));
          right: auto;
          left: 50%;
          max-width: 52vw;
          transform: translateX(-50%);
          text-align: center;
        }
        html.touch-ui #hud #title {
          top: max(10px, env(safe-area-inset-top));
          font-size: 16px;
          letter-spacing: 6px;
        }
        html.touch-ui #hud #clock,
        html.touch-ui #hud #shards {
          top: max(10px, env(safe-area-inset-top));
          right: max(12px, env(safe-area-inset-right));
          font-size: 12px;
        }
        html.touch-ui #hud #shards {
          top: max(28px, calc(env(safe-area-inset-top) + 18px));
        }
        html.touch-ui #hud #helpbtn {
          top: max(8px, env(safe-area-inset-top));
          right: max(72px, calc(env(safe-area-inset-right) + 60px));
        }
        html.touch-ui #hud #crosshair { opacity: 0.48; }
        html.touch-ui #minimap {
          top: max(60px, calc(env(safe-area-inset-top) + 50px));
          right: max(10px, env(safe-area-inset-right));
          width: 138px;
        }
        html.touch-ui #minimap .map-surface {
          width: 138px;
          height: 138px;
        }
        html.touch-ui #minimap .map-head { font-size: 8px; }
        html.touch-ui #minimap .map-foot { padding: 5px 7px 6px; }
        html.touch-ui #minimap .map-legend {
          grid-template-columns: repeat(3, max-content);
          gap: 3px 6px;
          font-size: 6.5px;
        }
        html.touch-ui #dlg,
        html.touch-ui #charpanel,
        html.touch-ui #shop {
          z-index: 60;
        }
        html.touch-ui #dlg {
          bottom: max(72px, calc(env(safe-area-inset-bottom) + 60px));
          width: min(680px, calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right) - 20px));
          max-height: 68vh;
          overflow-y: auto;
        }
        html.touch-ui #dlg .op,
        html.touch-ui #charsheet .node,
        html.touch-ui #charsheet .brew,
        html.touch-ui #shopsheet .card {
          min-height: 44px;
          padding: 12px 14px;
          font-size: 15px;
        }
        html.touch-ui #charsheet,
        html.touch-ui #shopsheet {
          width: min(960px, calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right) - 16px));
          max-height: calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px);
          max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px);
          padding: 18px 16px;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
        html.touch-ui #charsheet .trees {
          grid-template-columns: 1fr;
          gap: 10px;
        }

        @media (orientation: portrait), (max-width: 520px) {
          #mc-stick-base {
            left: max(12px, env(safe-area-inset-left));
            bottom: max(74px, calc(env(safe-area-inset-bottom) + 66px));
            width: 104px;
            height: 104px;
          }
          #mc-actions {
            right: max(8px, env(safe-area-inset-right));
            bottom: max(76px, calc(env(safe-area-inset-bottom) + 68px));
            grid-template-columns: repeat(3, 48px);
            gap: 6px;
          }
          .mc-btn { width: 48px; height: 48px; font-size: 9px; }
          .mc-btn .g { font-size: 16px; }
          .mc-btn.primary { width: 54px; height: 54px; }
          #mc-utils {
            top: max(48px, calc(env(safe-area-inset-top) + 40px));
            left: max(7px, env(safe-area-inset-left));
            gap: 5px;
          }
          .mc-util {
            width: 38px;
            height: 38px;
            border-radius: 10px;
            font-size: 8px;
          }
          .mc-util .g { font-size: 13px; }
          #mc-spells {
            max-width: calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right) - 8px);
            bottom: max(4px, env(safe-area-inset-bottom));
            gap: 3px;
            padding-inline: 4px;
          }
          .mc-spell {
            min-width: 42px;
            width: 42px;
            height: 46px;
            padding-inline: 3px;
            border-radius: 10px;
            font-size: 8px;
          }
          .mc-spell .g { font-size: 14px; }
          #mc-look-zone::after { display: none; }
          html.touch-ui #hud #bars {
            left: max(12px, env(safe-area-inset-left));
            bottom: max(220px, calc(env(safe-area-inset-bottom) + 204px));
          }
          html.touch-ui #hud #bars .bar {
            width: min(168px, 43vw);
            height: 9px;
          }
          html.touch-ui #hud #levelbadge {
            left: max(12px, env(safe-area-inset-left));
            bottom: max(254px, calc(env(safe-area-inset-bottom) + 238px));
            font-size: 12px;
          }
          html.touch-ui #hud #karma {
            left: max(12px, env(safe-area-inset-left));
            bottom: max(276px, calc(env(safe-area-inset-bottom) + 260px));
            width: min(168px, 43vw);
          }
          html.touch-ui #hud #prompt {
            bottom: max(222px, calc(env(safe-area-inset-bottom) + 206px));
            max-width: 54vw;
            font-size: 12px;
          }
          html.touch-ui #hud #title {
            max-width: 48vw;
            overflow: hidden;
            font-size: 14px;
            letter-spacing: 5px;
            white-space: nowrap;
          }
          html.touch-ui #hud #toast {
            max-width: 42vw;
            padding: 7px 10px;
            font-size: 11px;
          }
          html.touch-ui #minimap {
            top: max(48px, calc(env(safe-area-inset-top) + 40px));
            right: max(7px, env(safe-area-inset-right));
            width: 106px;
          }
          html.touch-ui #minimap .map-surface {
            width: 106px;
            height: 106px;
          }
          html.touch-ui #minimap .map-head {
            margin: 0 3px 3px;
            font-size: 7px;
            letter-spacing: 1.2px;
          }
          html.touch-ui #minimap .map-foot {
            margin-top: 4px;
            padding: 4px 6px 5px;
          }
          html.touch-ui #minimap .objective-kicker {
            margin-bottom: 1px;
            font-size: 6.5px;
            letter-spacing: 1.2px;
          }
          html.touch-ui #minimap .objective-name {
            font-size: 9px;
          }
          html.touch-ui #minimap .objective-distance {
            margin-top: 1px;
            font-size: 7.5px;
          }
          html.touch-ui #minimap .map-legend {
            grid-template-columns: repeat(5, 1fr);
            gap: 0;
            margin-top: 4px;
            font-size: 0;
          }
          html.touch-ui #minimap .legend-item {
            justify-content: center;
            gap: 0;
          }
          html.touch-ui #minimap .legend-item::after {
            content: attr(data-short);
            margin-left: 2px;
            font-size: 5px;
          }
          html.touch-ui #hud #bossbar { width: 74vw; }
          html.touch-ui #hud #banner .btitle {
            font-size: 21px;
            letter-spacing: 5px;
          }
          html.touch-ui #charsheet,
          html.touch-ui #shopsheet {
            padding: 14px 12px;
          }
        }

        @media (orientation: landscape) and (max-height: 520px) {
          #mc-stick-base {
            width: 108px;
            height: 108px;
            bottom: max(12px, env(safe-area-inset-bottom));
          }
          #mc-actions {
            right: max(8px, env(safe-area-inset-right));
            bottom: max(68px, calc(env(safe-area-inset-bottom) + 58px));
            grid-template-columns: repeat(3, 48px);
            gap: 6px;
          }
          .mc-btn { width: 48px; height: 48px; font-size: 9px; }
          .mc-btn.primary { width: 56px; height: 56px; }
          #mc-spells { gap: 5px; padding-block: 2px; }
          .mc-spell { min-width: 44px; height: 42px; font-size: 9px; }
          #mc-utils {
            top: max(44px, calc(env(safe-area-inset-top) + 36px));
            flex-direction: row;
            gap: 5px;
          }
          .mc-util { width: 40px; height: 38px; font-size: 8px; }
          html.touch-ui #hud #bars {
            bottom: max(126px, calc(env(safe-area-inset-bottom) + 110px));
          }
          html.touch-ui #hud #levelbadge {
            bottom: max(160px, calc(env(safe-area-inset-bottom) + 144px));
          }
          html.touch-ui #hud #karma {
            bottom: max(180px, calc(env(safe-area-inset-bottom) + 164px));
          }
          html.touch-ui #hud #toast {
            top: max(48px, calc(env(safe-area-inset-top) + 40px));
            max-width: 38vw;
            padding: 6px 9px;
            font-size: 10px;
          }
          html.touch-ui #minimap {
            top: max(50px, calc(env(safe-area-inset-top) + 40px));
            width: 116px;
          }
          html.touch-ui #minimap .map-surface {
            width: 116px;
            height: 116px;
          }
          html.touch-ui #minimap .map-foot {
            display: none;
          }
          html.touch-ui #minimap .map-legend { display: none; }
          #mc-look-zone::after { display: none; }
        }

        @media (orientation: landscape) and (max-height: 360px) {
          #mc-stick-base { width: 92px; height: 92px; }
          #mc-actions {
            bottom: max(56px, calc(env(safe-area-inset-bottom) + 48px));
            grid-template-columns: repeat(3, 44px);
            gap: 4px;
          }
          .mc-btn { width: 44px; height: 44px; font-size: 8px; }
          .mc-btn.primary { width: 50px; height: 50px; }
          .mc-util { width: 36px; height: 34px; }
          .mc-spell { min-width: 40px; width: 40px; height: 38px; font-size: 8px; }
          html.touch-ui #hud #bars { bottom: 106px; }
          html.touch-ui #hud #levelbadge { bottom: 138px; }
          html.touch-ui #minimap { width: 100px; }
          html.touch-ui #minimap .map-surface { width: 100px; height: 100px; }
        }
      </style>

      <div id="mc-stick-zone" aria-label="Move">
        <div id="mc-stick-base"><div id="mc-stick-knob"></div></div>
      </div>
      <div id="mc-look-zone" aria-label="Swipe to look"></div>

      <div id="mc-utils">
        <button type="button" class="mc-util" data-press="KeyI"><span class="g">☰</span>menu</button>
        <button type="button" class="mc-util" data-press="Tab"><span class="g">◎</span>lock</button>
        <button type="button" class="mc-util" data-press="KeyG"><span class="g">✧</span>fly</button>
        <button type="button" class="mc-util" data-press="Digit1"><span class="g">❤</span>pot</button>
        <button type="button" class="mc-util" data-press="Digit2"><span class="g">✦</span>mana</button>
      </div>

      <div id="mc-actions">
        <button type="button" class="mc-btn mc-interact" data-press="KeyF"><span class="g">◉</span>use</button>
        <button type="button" class="mc-btn mc-dodge" data-press="KeyQ"><span class="g">⇢</span>dodge</button>
        <button type="button" class="mc-btn mc-jump" data-press="Space"><span class="g">↑</span>jump</button>
        <button type="button" class="mc-btn mc-sprint" data-hold="ShiftLeft"><span class="g">≫</span>run</button>
        <button type="button" class="mc-btn mc-ward ward" data-hold="KeyX"><span class="g">◈</span>ward</button>
        <button type="button" class="mc-btn mc-attack primary" data-press="KeyZ"><span class="g">✦</span>bolt</button>
      </div>

      <div id="mc-spells">
        <button type="button" class="mc-spell" data-press="KeyE"><span class="g">≋</span>push</button>
        <button type="button" class="mc-spell" data-press="KeyR"><span class="g">❋</span>ember</button>
        <button type="button" class="mc-spell" data-press="KeyC"><span class="g">❆</span>frost</button>
        <button type="button" class="mc-spell" data-press="KeyV"><span class="g">⌖</span>lift</button>
        <button type="button" class="mc-spell" data-press="KeyT"><span class="g">✶</span>ult</button>
        <button type="button" class="mc-spell" data-press="KeyB"><span class="g">✸</span>oath</button>
        <button type="button" class="mc-spell" data-press="KeyN"><span class="g">⚱</span>tithe</button>
      </div>
    `;

    container.appendChild(el);
    this.root = el;
    this.stickBase = el.querySelector('#mc-stick-base');
    this.stickKnob = el.querySelector('#mc-stick-knob');
    this.stickZone = el.querySelector('#mc-stick-zone');
    this.lookZone = el.querySelector('#mc-look-zone');

    this._bindStick();
    this._bindLook();
    this._bindButtons();

    el.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('gesturestart', (event) => event.preventDefault(), {
      passive: false,
    });
    const reset = () => this._resetControls();
    window.addEventListener('blur', reset);
    window.addEventListener('orientationchange', reset);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) reset();
    });
  }

  _bindStick() {
    const radius = 40;
    this.stickZone.addEventListener('pointerdown', (event) => {
      if (this._stick.active) return;
      this._stick.active = true;
      this._stick.id = event.pointerId;
      try {
        this.stickZone.setPointerCapture?.(event.pointerId);
      } catch {
        // Some embedded WebViews report a pointer after it is no longer
        // capturable. Movement still works while it remains over the zone.
      }
      const rect = this.stickBase.getBoundingClientRect();
      this._stick.ox = rect.left + rect.width / 2;
      this._stick.oy = rect.top + rect.height / 2;
      this.stickBase.classList.add('active');
      this._moveStick(event.clientX, event.clientY, radius);
      event.preventDefault();
    });
    this.stickZone.addEventListener('pointermove', (event) => {
      if (!this._stick.active || event.pointerId !== this._stick.id) return;
      this._moveStick(event.clientX, event.clientY, radius);
      event.preventDefault();
    });
    const end = (event) => {
      if (!this._stick.active || event.pointerId !== this._stick.id) return;
      this._stick.active = false;
      this._stick.id = null;
      this._stick.nx = 0;
      this._stick.ny = 0;
      this.stickKnob.style.transform = 'translate(0, 0)';
      this.stickBase.classList.remove('active');
      this._applyStickKeys(0, 0);
      event.preventDefault();
    };
    this.stickZone.addEventListener('pointerup', end);
    this.stickZone.addEventListener('pointercancel', end);
  }

  _moveStick(clientX, clientY, radius) {
    let dx = clientX - this._stick.ox;
    let dy = clientY - this._stick.oy;
    const length = Math.hypot(dx, dy) || 1;
    if (length > radius) {
      dx = (dx / length) * radius;
      dy = (dy / length) * radius;
    }
    this._stick.nx = dx / radius;
    this._stick.ny = dy / radius;
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    this._applyStickKeys(this._stick.nx, this._stick.ny);
  }

  _applyStickKeys(nx, ny) {
    for (const code of MOVE_KEYS) this.input.release(code);
    const directions = stickDirections(nx, ny);
    if (directions.forward) this.input.hold('KeyW');
    if (directions.back) this.input.hold('KeyS');
    if (directions.left) this.input.hold('KeyA');
    if (directions.right) this.input.hold('KeyD');
    if (directions.sprint) this.input.hold('ShiftLeft');
    else if (!this._manualSprint) this.input.release('ShiftLeft');
  }

  _bindLook() {
    const sensitivity = 1.15;
    this.lookZone.addEventListener('pointerdown', (event) => {
      if (this._look.active) return;
      this._look.active = true;
      this._look.id = event.pointerId;
      this._look.x = event.clientX;
      this._look.y = event.clientY;
      try {
        this.lookZone.setPointerCapture?.(event.pointerId);
      } catch {
        // Keep swipe look working in WebViews without reliable capture.
      }
      event.preventDefault();
    });
    this.lookZone.addEventListener('pointermove', (event) => {
      if (!this._look.active || event.pointerId !== this._look.id) return;
      const dx = (event.clientX - this._look.x) * sensitivity;
      const dy = (event.clientY - this._look.y) * sensitivity;
      this._look.x = event.clientX;
      this._look.y = event.clientY;
      this.input.addLookDelta(dx, dy);
      event.preventDefault();
    });
    const end = (event) => {
      if (!this._look.active || event.pointerId !== this._look.id) return;
      this._look.active = false;
      this._look.id = null;
      event.preventDefault();
    };
    this.lookZone.addEventListener('pointerup', end);
    this.lookZone.addEventListener('pointercancel', end);
  }

  _bindButtons() {
    for (const button of this.root.querySelectorAll('[data-press]')) {
      const code = button.dataset.press;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.input.press(code);
        navigator.vibrate?.(8);
      });
      button.addEventListener('click', (event) => {
        if (event.detail === 0) this.input.press(code);
      });
    }

    for (const button of this.root.querySelectorAll('[data-hold]')) {
      const code = button.dataset.hold;
      const down = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.input.hold(code);
        button.classList.add('held');
        if (code === 'ShiftLeft') this._manualSprint = true;
        if (code === 'KeyX') this._manualWard = true;
        try {
          button.setPointerCapture?.(event.pointerId);
        } catch {
          // Releasing on pointercancel still clears the held action.
        }
        navigator.vibrate?.(8);
      };
      const up = (event) => {
        event.preventDefault();
        this.input.release(code);
        button.classList.remove('held');
        if (code === 'ShiftLeft') this._manualSprint = false;
        if (code === 'KeyX') this._manualWard = false;
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
    }
  }

  _resetControls() {
    this._stick.active = false;
    this._stick.id = null;
    this._stick.nx = 0;
    this._stick.ny = 0;
    this._look.active = false;
    this._look.id = null;
    this._manualSprint = false;
    this._manualWard = false;
    for (const code of HELD_KEYS) this.input.release(code);
    this.stickKnob.style.transform = 'translate(0, 0)';
    this.stickBase.classList.remove('active');
    for (const button of this.root.querySelectorAll('.held')) {
      button.classList.remove('held');
    }
  }

  update() {
    if (!this.enabled) return;
    const suspended = !!this.input.suspended;
    this.root.classList.toggle('suspended', suspended);
    if (suspended && !this._wasSuspended) this._resetControls();
    this._wasSuspended = suspended;
    if (this.input.suspended) {
      for (const code of HELD_KEYS) this.input.release(code);
    } else if (this._stick.active) {
      this._applyStickKeys(this._stick.nx, this._stick.ny);
    }
  }
}
