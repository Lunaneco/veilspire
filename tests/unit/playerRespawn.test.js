import './../setup-localstorage.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player, PLAYER_START } from '../../src/player/Player.js';
import { Karma } from '../../src/systems/Karma.js';
import { Progression } from '../../src/systems/Progression.js';

function createPlayer() {
  const world = {
    groundHeight: (x, z) => 4 + x * 0.01 + z * 0.001,
  };
  return new Player(new THREE.Scene(), world, {}, {});
}

describe('Player death and respawn', () => {
  beforeEach(() => localStorage.clear());

  it('returns to the starting position with full health and mana', () => {
    const player = createPlayer();
    const expectedY = player.startPosition.y;
    let respawns = 0;
    player.onRespawn = () => { respawns++; };
    player.position.set(180, 40, -90);
    player.velocity.set(4, -8, 3);
    player.health = 1;
    player.mana = 2;
    player.flying = true;
    player.climbing = true;
    player.swimming = true;

    player.takeDamage(1);

    assert.equal(respawns, 1);
    assert.deepEqual(
      player.position.toArray(),
      [PLAYER_START.x, expectedY, PLAYER_START.z],
    );
    assert.equal(player.facing, PLAYER_START.facing);
    assert.equal(player.health, player.maxHealth);
    assert.equal(player.mana, player.maxMana);
    assert.deepEqual(player.velocity.toArray(), [0, 0, 0]);
    assert.equal(player.flying, false);
    assert.equal(player.climbing, false);
    assert.equal(player.swimming, false);
    assert.equal(player.grounded, true);
  });

  it('clears infamy but retains experience, talents and virtue', () => {
    const player = createPlayer();
    const progression = new Progression(player);
    const karma = new Karma();
    progression.addXp(progression.xpForNext(), 'test');
    assert.equal(progression.spend('atk1'), true);
    karma.praise(24, 'test');
    karma.sin(70, 'test');
    const before = {
      level: progression.level,
      xp: progression.xp,
      points: progression.points,
      ranks: { ...progression.ranks },
      virtue: karma.virtue,
    };
    player.onRespawn = () => karma.resetInfamy();
    player.health = 1;

    player.takeDamage(1);

    assert.equal(karma.infamy, 0);
    assert.equal(karma.peakInfamy, 0);
    assert.equal(karma.outlawed, false);
    assert.equal(karma.virtue, before.virtue);
    assert.equal(progression.level, before.level);
    assert.equal(progression.xp, before.xp);
    assert.equal(progression.points, before.points);
    assert.deepEqual(progression.ranks, before.ranks);

    const reloaded = new Karma();
    assert.equal(reloaded.infamy, 0);
    assert.equal(reloaded.outlawed, false);
    assert.equal(reloaded.virtue, before.virtue);
  });
});
