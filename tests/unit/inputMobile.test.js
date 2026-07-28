import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

function fakeDom() {
  return {
    addEventListener() {},
    requestPointerLock() { return Promise.resolve(); },
  };
}

function installDomGlobals() {
  if (typeof globalThis.window !== 'undefined') return;
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    addEventListener() {},
    removeEventListener() {},
    pointerLockElement: null,
  };
}

let Input;
let stickDirections;
before(async () => {
  installDomGlobals();
  ({ Input } = await import('../../src/core/Input.js'));
  ({ stickDirections } = await import('../../src/ui/MobileControls.js'));
});

describe('Input mobile injectors', () => {
  it('hold and release drive movement without keyboard events', () => {
    const input = new Input(fakeDom());
    input.hold('KeyW');
    assert.equal(input.isDown('KeyW'), true);
    input.release('KeyW');
    assert.equal(input.isDown('KeyW'), false);
  });

  it('does not release a physical key when its virtual hold ends', () => {
    const input = new Input(fakeDom());
    input.keys.add('KeyW');
    input.hold('KeyW');
    input.release('KeyW');
    assert.equal(input.isDown('KeyW'), true);
  });

  it('press lasts for one lateUpdate cycle', () => {
    const input = new Input(fakeDom());
    input.press('KeyZ');
    assert.equal(input.wasPressed('KeyZ'), true);
    assert.equal(input.isDown('KeyZ'), true);
    input.lateUpdate();
    assert.equal(input.wasPressed('KeyZ'), false);
    assert.equal(input.isDown('KeyZ'), false);
  });

  it('look deltas accumulate and clear', () => {
    const input = new Input(fakeDom());
    input.addLookDelta(12, -4);
    input.addLookDelta(3, 1);
    assert.equal(input.mouseDX, 15);
    assert.equal(input.mouseDY, -3);
    input.lateUpdate();
    assert.equal(input.mouseDX, 0);
    assert.equal(input.mouseDY, 0);
  });

  it('suspension blocks gameplay holds but keeps menu keys', () => {
    const input = new Input(fakeDom());
    input.hold('KeyW');
    input.hold('KeyI');
    input.suspended = true;
    assert.equal(input.isDown('KeyW'), false);
    assert.equal(input.isDown('KeyI'), true);
  });

  it('maps a virtual stick to directions and edge sprint', () => {
    assert.deepEqual(stickDirections(0.9, -0.9), {
      forward: true,
      back: false,
      left: false,
      right: true,
      sprint: true,
    });
    assert.equal(stickDirections(0.1, 0.1).forward, false);
  });
});
