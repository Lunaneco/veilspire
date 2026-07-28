import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  heavyArmourMul, bossArmourMul, resolveBossHit, resolveGolemHit,
  resolveWispHit, flankWaypoint, canStartFinisher, burnDps,
} from '../../src/combat/combatMath.js';

describe('combatMath', () => {
  it('cracks heavy armour while frozen', () => {
    assert.equal(heavyArmourMul(0, 0.55), 0.55);
    assert.equal(heavyArmourMul(1.2, 0.55), 1);
    assert.equal(bossArmourMul(0), 0.7);
    assert.equal(bossArmourMul(0.5), 1);
  });

  it('enters boss phase two at half HP', () => {
    const next = resolveBossHit({
      hp: 460,
      maxHp: 900,
      phase: 1,
      frozenTimer: 0,
      finisherReady: false,
      dead: false,
      finisherPlaying: false,
      state: 'fight',
    }, 20);
    assert.equal(next.enteredPhaseTwo, true);
    assert.equal(next.phase, 2);
  });

  it('opens the boss finisher at eight percent HP', () => {
    const next = resolveBossHit({
      hp: 80,
      maxHp: 900,
      phase: 2,
      frozenTimer: 1,
      finisherReady: false,
      dead: false,
      finisherPlaying: false,
      state: 'fight',
    }, 20);
    assert.equal(next.openedFinisher, true);
    assert.equal(next.finisherReady, true);
    assert.equal(next.state, 'kneel');
  });

  it('applies golem armour and wisp stagger', () => {
    const golem = resolveGolemHit({
      hp: 100, frozenTimer: 0, dead: false, state: 'idle',
    }, 40);
    assert.equal(golem.applied, 40 * 0.55);
    const wisp = resolveWispHit({
      hp: 50, dead: false, state: 'patrol', staggerTimer: 0,
    }, 30);
    assert.equal(wisp.hp, 20);
    assert.equal(wisp.state, 'aggro');
    assert.ok(wisp.staggerTimer >= 0.45);
  });

  it('creates a side waypoint behind golem cover', () => {
    const waypoint = flankWaypoint(0, 0, 0, 0, 0, 10, 1);
    assert.ok(waypoint.z < 0);
    assert.ok(Math.abs(waypoint.x) > 0);
  });

  it('gates finishers and burn damage', () => {
    assert.equal(canStartFinisher(true, false, false), true);
    assert.equal(canStartFinisher(true, true, false), false);
    assert.equal(burnDps(true), 5);
    assert.equal(burnDps(false), 8);
  });
});
