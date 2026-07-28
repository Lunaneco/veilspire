import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDeepWater, shouldStartSwim, canToggleFlight, breakFlightOnHit,
  canStartClimb, shouldMantle, shouldReleaseAtGround, locomotionMode,
  SWIM_LEVEL_OFFSET,
} from '../../src/player/moveModes.js';

describe('moveModes', () => {
  it('detects deep water and swim entry', () => {
    assert.equal(isDeepWater(-4, -2.2), true);
    const base = {
      flying: false,
      swimming: false,
      groundY: -5,
      waterLevel: -2.2,
      y: -2.65,
    };
    assert.equal(shouldStartSwim(base), true);
    assert.equal(shouldStartSwim({ ...base, flying: true }), false);
  });

  it('gates flight and breaks flight on a hit', () => {
    assert.equal(canToggleFlight(false, 1), false);
    assert.equal(canToggleFlight(false, 0), true);
    const result = breakFlightOnHit({ flying: true, velocityY: 3 });
    assert.equal(result.flying, false);
    assert.ok(result.velocityY <= -4.5);
    assert.equal(result.flightLockout, 1.4);
  });

  it('gates climb, mantle, and ground release', () => {
    assert.equal(canStartClimb({
      flying: false, swimming: false, climbTimer: 0,
    }), true);
    assert.equal(shouldMantle(5.7, 6), true);
    assert.equal(shouldReleaseAtGround(true, 1, 1), true);
  });

  it('prioritizes the active locomotion mode', () => {
    assert.equal(locomotionMode({
      climbing: true, flying: true, swimming: true,
      grounded: true, dodgeTimer: 1,
    }), 'climb');
    assert.equal(locomotionMode({
      climbing: false, flying: true, swimming: false,
      grounded: false, dodgeTimer: 0,
    }), 'fly');
    assert.equal(SWIM_LEVEL_OFFSET, 0.45);
  });
});
