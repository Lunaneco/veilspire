import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCylinder, resolveBox, resolveCapsuleColliders, ledgeHeight,
} from '../../src/util/collisionMath.js';

describe('collisionMath', () => {
  it('pushes a capsule out of an overlapping cylinder', () => {
    const pos = { x: 0.2, y: 0, z: 0 };
    assert.equal(resolveCylinder(
      pos, 0.4, { x: 0, z: 0, r: 1, topY: 3 },
    ), true);
    assert.ok(Math.hypot(pos.x, pos.z) >= 1.4 - 1e-6);
  });

  it('handles an exact cylinder centre overlap', () => {
    const pos = { x: 0, y: 0, z: 0 };
    assert.equal(resolveCylinder(
      pos, 0.4, { x: 0, z: 0, r: 1, topY: 3 },
    ), true);
    assert.equal(pos.x, 1.4);
  });

  it('ignores a cylinder below the player', () => {
    const pos = { x: 0, y: 5, z: 0 };
    assert.equal(resolveCylinder(
      pos, 0.4, { x: 0, z: 0, r: 2, topY: 2 },
    ), false);
  });

  it('pushes a capsule out of an axis-aligned box', () => {
    const pos = { x: 0, y: 0, z: 0 };
    const box = {
      min: { x: -1, y: 0, z: -1 },
      max: { x: 1, y: 2, z: 1 },
    };
    resolveBox(pos, 0.5, 1.7, box);
    assert.ok(Math.abs(pos.x) >= 1.5 - 1e-6
      || Math.abs(pos.z) >= 1.5 - 1e-6);
  });

  it('resolves a list of colliders', () => {
    const pos = { x: 0.1, y: 0, z: 0 };
    resolveCapsuleColliders(pos, 0.4, 1.7, [
      { type: 'cylinder', x: 0, z: 0, r: 1, topY: 3 },
    ]);
    assert.ok(Math.hypot(pos.x, pos.z) >= 1.39);
  });

  it('uses box tops as walkable ledges', () => {
    const boxes = [{
      min: { x: -1, y: 0, z: -1 },
      max: { x: 1, y: 2.5, z: 1 },
    }];
    assert.equal(ledgeHeight(0, 0, 2.6, boxes, 0), 2.5);
  });
});
