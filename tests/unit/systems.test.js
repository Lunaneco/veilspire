import './../setup-localstorage.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, RECIPES, ITEMS } from '../../src/systems/Inventory.js';
import { Karma } from '../../src/systems/Karma.js';
import { Progression } from '../../src/systems/Progression.js';
import { DialogueRunner, MAELIS_TREE } from '../../src/systems/DialogueTree.js';
import { WorldState } from '../../src/systems/WorldState.js';
import { fbm2D, valueNoise2D } from '../../src/util/noise.js';
import {
  terrainHeight, WATER_LEVEL, distanceToPath,
} from '../../src/world/Terrain.js';
import { PLANT_NODES } from '../../src/world/Plants.js';

function fakePlayer() {
  return {
    health: 50,
    maxHealth: 100,
    mana: 20,
    maxMana: 100,
    mods: {},
  };
}

describe('Inventory', () => {
  it('adds, brews, and uses a potion', () => {
    const player = fakePlayer();
    const inventory = new Inventory(player);
    inventory.add('emberCap', 2);
    inventory.add('aetherDust', 1);
    const recipe = RECIPES.find((item) => item.id === 'healPotion');
    assert.equal(inventory.canBrew(recipe), true);
    assert.equal(inventory.brew(recipe), true);
    assert.equal(inventory.use('healPotion'), true);
    assert.equal(player.health, 100);
  });

  it('keeps item and recipe identifiers consistent', () => {
    for (const recipe of RECIPES) {
      assert.ok(ITEMS[recipe.id]);
      for (const id of Object.keys(recipe.needs)) assert.ok(ITEMS[id]);
    }
  });
});

describe('Karma', () => {
  beforeEach(() => localStorage.clear());

  it('latches the outlaw state at the infamy threshold', () => {
    const karma = new Karma();
    karma.reset();
    while (!karma.outlawed && karma.infamy < 100) karma.sin(20);
    assert.equal(karma.outlawed, true);
    assert.equal(karma.hostile, true);
    assert.equal(karma.sin01, 1);
  });

  it('spends virtue for Oathlight', () => {
    const karma = new Karma();
    karma.reset();
    karma.praise(40);
    assert.equal(karma.spendVirtue(35), true);
    assert.equal(karma.spendVirtue(35), false);
  });
});

describe('Progression and dialogue', () => {
  beforeEach(() => localStorage.clear());

  it('levels and applies a talent', () => {
    const player = fakePlayer();
    const progression = new Progression(player);
    progression.reset();
    progression.addXp(progression.xpForNext(), 'test');
    assert.equal(progression.level, 2);
    assert.equal(progression.spend('atk1'), true);
    assert.equal(player.mods.boltDamage, 1.2);
  });

  it('accepts the professor work quest', () => {
    const worldState = new WorldState();
    const quests = { state: 'none' };
    const player = fakePlayer();
    const runner = new DialogueRunner({
      worldState,
      inventory: new Inventory(player),
      progression: new Progression(player),
      quests,
      player,
      hud: null,
      equipment: null,
    });
    runner.start(MAELIS_TREE);
    const work = runner.visibleChoices(MAELIS_TREE.start)
      .find((choice) => choice.label.includes('work'));
    runner.choose(runner.visibleChoices(MAELIS_TREE.start).indexOf(work));
    const accept = runner.visibleChoices(MAELIS_TREE.cullOffer)
      .findIndex((choice) => choice.label.includes('handle'));
    runner.choose(accept);
    assert.equal(worldState.has('questAccepted'), true);
    assert.equal(quests.state, 'active');
  });
});

describe('World data', () => {
  it('keeps terrain math deterministic', () => {
    assert.ok(Number.isFinite(terrainHeight(200, 200)));
    assert.ok(terrainHeight(0, -120) > 20);
    assert.equal(typeof WATER_LEVEL, 'number');
    assert.ok(distanceToPath(5, -70) < 5);
    assert.equal(valueNoise2D(1.5, 2.5, 3), valueNoise2D(1.5, 2.5, 3));
    assert.equal(fbm2D(0.1, 0.2), fbm2D(0.1, 0.2));
  });

  it('uses original reagent identifiers for field plants', () => {
    assert.ok(PLANT_NODES.length >= 6);
    for (const [, , , itemId, count] of PLANT_NODES) {
      assert.ok(itemId === 'emberCap' || itemId === 'frostLeaf');
      assert.ok(count >= 1);
    }
  });
});
