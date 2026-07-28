// Keyboard + pointer-lock mouse input, with virtual injectors used by the
// on-screen mobile controls. Systems read state each frame; edge events
// (pressed this frame) are cleared in lateUpdate().

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this._virtualHold = new Set();
    this._virtualTap = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.mouseButtons = new Set();
    this.mousePressed = new Set();
    this.pointerLocked = false;
    this.touchMode = false;
    this._menuCodes = new Set([
      'Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyI',
    ]);

    window.addEventListener('keydown', (e) => {
      // Tab is lock-on; arrows and space are movement, not page scrolling
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this._virtualHold.clear();
      this._virtualTap.clear();
      this.mouseButtons.clear();
    });

    this.dom.addEventListener('mousedown', (e) => {
      // Pointer lock is unavailable and disruptive on touch devices.
      if (!this.touchMode && !this.pointerLocked) {
        this.dom.requestPointerLock({ unadjustedMovement: true }).catch?.(() => this.dom.requestPointerLock());
      }
      this.mouseButtons.add(e.button);
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => { this.wheelDelta += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    });
  }

  hold(code) {
    this._virtualHold.add(code);
  }

  release(code) {
    this._virtualHold.delete(code);
  }

  press(code) {
    this._virtualTap.add(code);
    this.pressed.add(code);
  }

  releaseVirtualKeys() {
    this._virtualHold.clear();
    this._virtualTap.clear();
  }

  addLookDelta(dx, dy) {
    if (!this.suspended) {
      this.mouseDX += dx;
      this.mouseDY += dy;
    }
  }

  // While a panel or conversation is open, gameplay keys read as released.
  // Edge events still fire so menus can react to number keys and Esc.
  isDown(code) {
    if (this.suspended && !this._menuCodes.has(code)) return false;
    return this.keys.has(code)
      || this._virtualHold.has(code)
      || this._virtualTap.has(code);
  }
  wasPressed(code) { return this.pressed.has(code); }
  isMouseDown(button) { return this.mouseButtons.has(button); }
  wasMousePressed(button) { return this.mousePressed.has(button); }

  lateUpdate() {
    this._virtualTap.clear();
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
  }
}
