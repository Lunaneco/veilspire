// Keyboard + pointer-lock mouse input. Systems read state each frame; edge
// events (pressed this frame) are cleared in lateUpdate().

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.mouseButtons = new Set();
    this.mousePressed = new Set();
    this.pointerLocked = false;

    window.addEventListener('keydown', (e) => {
      // Tab is lock-on; arrows and space are movement, not page scrolling
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });

    this.dom.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) {
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

  // While a panel or conversation is open, gameplay keys read as released.
  // Edge events still fire so menus can react to number keys and Esc.
  isDown(code) { return !this.suspended && this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  isMouseDown(button) { return this.mouseButtons.has(button); }
  wasMousePressed(button) { return this.mousePressed.has(button); }

  lateUpdate() {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
  }
}
