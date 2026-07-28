import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { World } from './world/World.js';
import { Player } from './player/Player.js';
import { ThirdPersonCamera } from './player/ThirdPersonCamera.js';
import { SpellSystem } from './combat/SpellSystem.js';
import { EnemyManager } from './combat/Enemies.js';
import { HollowWarden } from './combat/Boss.js';
import { HUD } from './ui/HUD.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { NPCManager } from './world/NPCs.js';
import { Collectibles } from './world/Collectibles.js';
import { PropManager } from './world/Props.js';
import { Weather } from './world/Weather.js';
import { QuestSystem } from './quests/QuestSystem.js';
import { Progression } from './systems/Progression.js';
import { Inventory } from './systems/Inventory.js';
import { WorldState } from './systems/WorldState.js';
import { Karma } from './systems/Karma.js';
import { Profiler } from './core/Profiler.js';
import { Equipment, GEAR } from './systems/Equipment.js';
import { Caches } from './world/Caches.js';
import { ShopPanel } from './ui/ShopPanel.js';
import { DialogueRunner, MAELIS_TREE } from './systems/DialogueTree.js';
import { DialoguePanel } from './ui/DialoguePanel.js';
import { CharacterPanel } from './ui/CharacterPanel.js';
import { MobileControls } from './ui/MobileControls.js';
import { Minimap } from './ui/Minimap.js';
import { Plants } from './world/Plants.js';

const container = document.getElementById('app');
const engine = new Engine(container);
const mobile = new MobileControls(container, engine.input);

const world = new World(engine.scene);
const player = new Player(engine.scene, world, engine.input, engine.camera);
const camera = new ThirdPersonCamera(engine.camera, player, world, engine.input);
const spells = new SpellSystem(engine.scene, world, player, engine.camera, engine.input);
const hud = new HUD(container, player, world.sky, spells);
const enemies = new EnemyManager(engine.scene, world, player, spells, hud);
spells.enemies = enemies;
player.world = world; // for respawn ground lookup
const audio = new AudioEngine();
spells.audio = audio;
world.settlements.spells = spells; // ruin puzzle uses spell VFX/audio
player.audio = audio;
hud.camera = engine.camera;
const worldState = new WorldState();
const npcs = new NPCManager(engine.scene, world, worldState);
hud.npcs = npcs;

// Karma: raising a wand on the valley's own people has a price, and past a
// point it cannot be paid off. NPCs fight back through the enemy bolt system,
// so ward, parry and lock-on all work against them unchanged.
const karma = new Karma();
npcs.karma = karma;
hud.karma = karma;
spells.karma = karma;
spells.bystanders = npcs;
// The two exclusive spells announce themselves, since which one you have is
// the consequence of how the whole run has been played
spells.onOathlight = (purity) => {
  hud.banner('OATHLIGHT', purity > 0.99
    ? 'Unclouded — the light answers in full'
    : 'The light answers, dimmed by what you have done');
  audio.castWhoosh(2.4);
};
spells.onBloodtithe = (sin, drained) => {
  hud.toast(drained > 0 ? 'The tithe is paid' : 'Nothing near enough to take');
  audio.castWhoosh(0.28);
};
for (const n of npcs.npcs) {
  n.combat = enemies;
  n.onHarmed = (npc, dmg, wasCalm) => {
    karma.sin(wasCalm ? 9 : 2.5, 'struck a bystander');
    if (wasCalm) hud.toast(karma.outlawed ? 'They will not forget this' : 'You struck an innocent');
  };
  n.onSlain = (npc) => {
    karma.sin(30, 'killed a bystander');
    hud.toast(`${npc.displayName.toLowerCase()} falls`);
    audio.impact(1.2, npc.position);
  };
}
karma.onOutlawed = () => {
  hud.banner('OUTLAWED', 'Word runs ahead of you now — the valley draws first');
  audio.impact(1.6);
  spells.onShake?.(0.5);
};
karma.onTierChange = (tier, prev) => {
  if (tier.name !== 'clear' && tier.name !== 'outlawed') hud.toast(`Standing: ${tier.label.toLowerCase()}`);
  else if (tier.name === 'clear' && prev !== 'clear') hud.toast('Your name is clean again');
};
const collectibles = new Collectibles(engine.scene, world, player, spells, audio);
hud.collectibles = collectibles;
const props = new PropManager(engine.scene, world);
spells.props = props;
// Hand-placed caches: the gear the shop will never stock
const caches = new Caches(engine.scene, world, spells, audio);
const plants = new Plants(engine.scene, world, spells, audio);
plants.onHarvest = (node) => {
  hud.toast(`Gathered ${node.itemId === 'emberCap' ? 'Ember Cap' : 'Frost Leaf'}`);
};
const boss = new HollowWarden(engine.scene, world, spells, enemies);
enemies.enemies.push(boss); // spells and lock-on treat it as an enemy
hud.boss = boss;
const progression = new Progression(player);
const inventory = new Inventory(player);
const charPanel = new CharacterPanel(
  container, progression, player, collectibles, engine.input, inventory);
charPanel.caches = caches;
inventory.onMessage = (msg) => hud.toast(msg);
const equipment = new Equipment(player);
charPanel.equipment = equipment;
progression.equipment = equipment;
progression.apply(); // fold gear into the mods now that it exists
const shop = new ShopPanel(container, inventory, equipment, player);
// Robes restyle the character for real
equipment.onRobeChange = (g) => player.model.setPalette({ robe: g.robe, trim: g.trim });
// Every new piece is a collection milestone worth calling out
equipment.onFound = (g) => {
  const c = equipment.collection;
  hud.banner(g.name.toUpperCase(), `Gear ${c.owned}/${c.total} — press I to equip`);
};
equipment.equip(equipment.equipped.robe); // apply the saved robe on load

// Branching conversations with the professor
const dialogue = new DialogueRunner({
  worldState, inventory, progression, hud, equipment, player, quests: null,
});
const dialoguePanel = new DialoguePanel(container, dialogue, engine.input);
hud.progression = progression;

// XP flows from every source of accomplishment; the work the valley wanted
// done also earns virtue, which quietly burns infamy back down
collectibles.onCollect = () => {
  progression.addXp(25, 'shard');
  karma.praise(1.5, 'shard');
};
progression.onLevelUp = (lvl) => {
  hud.banner(`LEVEL ${lvl}`, 'A talent point awaits — press I');
  audio.castWhoosh(1.8);
};
progression.onXp = (amt) => hud.floatXp(amt);
const weather = new Weather(engine.scene, engine.camera, audio);
const quests = new QuestSystem(container, player, npcs, engine.input);
dialogue.ctx.quests = quests; // the tree drives the objective tracker
const minimap = new Minimap(container, {
  player, worldState, quests, npcs, enemies, boss,
  caches, collectibles, cavern: world.cavern,
});
quests.onReward = (xp) => {
  progression.addXp(xp, 'quest');
  karma.praise(18, 'quest');
};
boss.onPhase = (p) => hud.banner('THE WARDEN WAKES', `Phase ${p} — the heartwood burns`);
boss.onFinisherReady = () => hud.toast('The Warden is broken — press F');
boss.onDefeated = () => {
  hud.banner('WARDEN FELLED', 'The deep wood exhales');
  progression.addXp(600, 'boss');
  karma.praise(25, 'boss');
  inventory.add('aetherDust', 3);
  worldState.set('bossFelled');
};
world.settlements.onSolved = () => {
  hud.banner('THE RING AWAKENS', 'Something long sealed stirs beneath the stones');
  progression.addXp(200, 'puzzle');
  karma.praise(12, 'ring');
  worldState.set('ringAwakened');
};
enemies.onEnemyKilled = (enemy) => {
  quests.onEnemyKilled();
  progression.addXp(enemy?.isGolem ? 90 : 30, 'kill');
  karma.praise(enemy?.isGolem ? 5 : 2, 'cleared a fiend');
  worldState.wispsSlain++;
  // Reagent drops feed the brewing loop
  if (enemy?.isGolem) inventory.add('aetherDust', 1);
  else if (Math.random() < 0.6) inventory.add(Math.random() < 0.5 ? 'emberCap' : 'frostLeaf', 1);
  inventory.addCrowns(enemy?.isBoss ? 250 : enemy?.isGolem ? 45 : 12);
};

const listenerDir = new THREE.Vector3();

// Profiler + adaptive quality (F3 toggles the overlay)
const profiler = new Profiler(engine, container);
engine.profiler = profiler;
profiler.onTierChange = (t) => {
  world.vegetation.setQuality({ grass: t.grass, lowDetailTrees: t.grass < 0.6 });
  world.sky.sun.shadow.mapSize.setScalar(t.shadow);
  world.sky.sun.shadow.map?.dispose();
  world.sky.sun.shadow.map = null;
};
profiler.applyTier(engine.renderer, engine.bloom); // honour the starting tier

// Point lights are expensive, and how expensive depends on how many are lit:
// three.js compiles the count into every material, so a light flicking on or
// off rebuilds the entire program cache — the old distance cull did that every
// quarter second. Instead exactly LIGHT_POOL of them stay enabled, always the
// nearest ones. The count never changes, so the shaders never rebuild, and the
// ones parked far away contribute nothing anyway: every lamp here has a
// falloff distance well under the range at which it would be swapped out.
const LIGHT_POOL = 6;
const allPointLights = [];
engine.scene.traverse((o) => { if (o.isPointLight) allPointLights.push(o); });
const lightRank = allPointLights.map((l) => ({ l, d: 0 }));
let lightCullTimer = 0;
const _lightPos = new THREE.Vector3();

// Finisher cinematic: slow-motion orbit around the killing blow
const cinematic = { active: false, t: 0 };
let trailTimer = 0;

// The broom arrives in a scatter of sparks rather than blinking into being
player.onBroomSummoned = () => {
  spells.spawnBurst(player.position.clone().setY(player.position.y + 0.6),
    26, 4, 0xffd27a, 0.8);
};

// Taking a hit in the air drops you out of the sky
player.onFlightBroken = () => {
  hud.toast('You are thrown from the broom');
  spells.onShake?.(0.3);
  audio.impact(0.8, player.position);
};

// Stripping a body is its own small transgression, on top of the killing
function lootBody(npc) {
  const haul = npc.loot();
  if (!haul) return;
  const named = [];
  if (haul.crowns) inventory.addCrowns(haul.crowns);
  for (const [id, n] of Object.entries(haul.items)) inventory.add(id, n);
  if (haul.gear && equipment.grant(haul.gear)) named.push(GEAR[haul.gear].name);
  spells.spawnBurst(npc.position.clone().setY(npc.position.y + 0.5), 16, 3, 0x8a7a5a, 0.7);
  audio.castWhoosh(0.5);
  hud.toast(named.length ? `Taken: ${named[0]}` : 'You search the body');
  karma.sin(4, 'robbed the dead');
}

// Camera shake: spells feed impulses, camera system applies decay
let shake = 0;
spells.onShake = (amt) => { shake = Math.min(shake + amt, 0.7); };
// A clean parry flashes the word and gives a brief slow-motion beat
let parrySlow = 0;
spells.onCounter = () => {
  hud._counterTimer = 0.75;
  parrySlow = 0.28;
  audio.castWhoosh(2.2, player.position);
};

// Refresh IBL environment as the sky changes (every ~6s real time)
let envTimer = 0;
world.sky.update(0, 0); // prime sky colors before first env bake
world.sky.refreshEnvironment(engine.renderer);

engine.addSystem({
  update(rawDt, elapsed) {
    // Slow-mo during the finisher, easing back to normal as it ends
    let dt = rawDt;
    if (cinematic.active) {
      cinematic.t += rawDt;
      dt = rawDt * (cinematic.t < 2.4 ? 0.32 : 1);
      if (cinematic.t > 4.2) cinematic.active = false;
    } else if (parrySlow > 0) {
      parrySlow -= rawDt;
      dt = rawDt * 0.35; // the parry beat
    }
    weather.indoors = world.castle.isInsideHall(player.position);
    weather.update(dt, elapsed);
    karma.update(dt);
    world.update(dt, elapsed, weather, player.position);
    npcs.weatherState = weather.state;
    // LOD follows the camera, not the player — flying pulls the view far back
    npcs.viewPos = engine.camera.position;
    npcs.update(dt, elapsed, world.sky.timeOfDay, player.position);
    collectibles.update(dt, elapsed);
    caches.update(dt, elapsed);
    plants.update(dt, elapsed);
    quests.update();
    minimap.update(dt);
    charPanel.update();

    // Chest: F to open when standing close, showers reagents and a potion
    const cav = world.cavern;
    const nearChest = !cav.looted && player.position.distanceTo(cav.chestPos) < 3.2;
    // A conversation owns the controls, but the world keeps living around it
    engine.input.suspended = dialogue.active || shop.open || charPanel.open;
    mobile.update();
    if (dialogue.active) {
      dialoguePanel.update();
      hud.setPrompt(null);
      return;
    }
    // Standing over a body or a cache beats everything else you could be doing
    const body = nearChest ? null : npcs.nearestLootable(player.position);
    const cache = (nearChest || body) ? null : caches.nearest(player.position);
    const plant = (nearChest || body || cache) ? null : plants.nearest(player.position);
    const professor = (body || cache || plant)
      ? null : npcs.availableProfessor(player.position);
    const merchant = (nearChest || body || cache || plant)
      ? null : npcs.nearestMerchant(player.position);
    // Talking to a student takes priority only when nothing else is in reach
    const speaker = (nearChest || body || cache || plant || merchant)
      ? null : npcs.nearestSpeaker(player.position);
    hud.setPrompt(shop.open ? null
      : nearChest ? 'F — open the warded chest'
      : body ? 'F — search the body'
      : cache ? 'F — open the cache'
      : plant ? 'F — harvest plant'
      : professor ? 'F — speak with Professor Maelis'
      : merchant ? 'F — trade with Bramwell'
      : speaker ? 'F — speak' : null);
    if (shop.open) {
      if (engine.input.wasPressed('KeyF') || engine.input.wasPressed('Escape')) shop.toggle(false);
    } else if (body && engine.input.wasPressed('KeyF')) {
      lootBody(body);
    } else if (cache && engine.input.wasPressed('KeyF')) {
      caches.open(cache, inventory, equipment);
    } else if (plant && engine.input.wasPressed('KeyF')) {
      plants.harvest(plant, inventory);
    } else if (professor && engine.input.wasPressed('KeyF')) {
      dialogue.start(MAELIS_TREE);
    } else if (merchant && engine.input.wasPressed('KeyF')) {
      shop.toggle(true);
    } else if (speaker && engine.input.wasPressed('KeyF')) {
      npcs.converse(speaker);
    }
    if (nearChest && engine.input.wasPressed('KeyF') && cav.open()) {
      inventory.add('emberCap', 3);
      inventory.add('frostLeaf', 3);
      inventory.add('aetherDust', 2);
      inventory.add('healPotion', 1);
      progression.addXp(120, 'chest');
      spells.spawnBurst(cav.chestPos.clone().setY(cav.chestPos.y + 1), 40, 5, 0xffd27a, 1.1);
      audio.castWhoosh(1.5);
      hud.banner('WARDED CHEST', 'Reagents and a draught within');
    }
    // Finisher: F when the Warden is broken triggers the cinematic
    if (boss.finisherReady && !boss.finisherPlaying && !boss.dead &&
        engine.input.wasPressed('KeyF') && boss.startFinisher()) {
      cinematic.t = 0;
      cinematic.active = true;
    }
    // Quick-drink: 1 and 2 use the first two potions carried
    if (engine.input.wasPressed('Digit1')) inventory.use(inventory.potions()[0]);
    if (engine.input.wasPressed('Digit2')) inventory.use(inventory.potions()[1]);
    envTimer += dt;
    if (envTimer > 6) {
      envTimer = 0;
      world.sky.refreshEnvironment(engine.renderer);
    }
    player.update(dt);
    spells.update(dt);
    enemies.update(dt, elapsed); // drives the boss too — it is in the enemy list
    props.update(dt, (p, n, s, c, l) => spells.spawnBurst(p, n, s, c, l), audio, enemies);
    world.sky.setFocus(player.position);
    const elev = world.sky.sunElevation ?? 0.5;
    const dayness = Math.max(0, Math.min(1, (elev + 0.05) * 4));
    audio.update(dt, dayness);
    // Flight: rushing air scaled by speed, and a thin ribbon of sparks so the
    // sense of speed reads visually as well as audibly
    const flySpeed01 = player.flying
      ? Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 26) : 0;
    audio.setFlightRush(flySpeed01);
    if (flySpeed01 > 0.25) {
      trailTimer -= dt;
      if (trailTimer <= 0) {
        trailTimer = 0.045;
        spells.spawnBurst(player.position.clone().setY(player.position.y + 0.9),
          2, 1.2, 0x9fd8ff, 0.5);
      }
    }
    audio.setListener(engine.camera, engine.camera.getWorldDirection(listenerDir));
    // Cinematic grade follows the hour and the sky
    const duskness = Math.max(0, 1 - Math.abs(elev) / 0.28) * (elev > -0.12 ? 1 : 0);
    engine.grading.applyMood(dayness, duskness, weather.cur.dim, weather.snowCover);
  },
  lateUpdate(dt) {
    // Cinematic camera: slow orbit framing the Warden and the player
    if (cinematic.active) {
      const t = cinematic.t;
      const focus = boss.position.clone().setY(boss.position.y + 3.2);
      const ang = Math.atan2(player.position.x - boss.position.x,
        player.position.z - boss.position.z) + t * 0.42;
      const radius = 15 - Math.min(t, 2.4) * 3.4;
      engine.camera.position.set(
        focus.x + Math.sin(ang) * radius,
        focus.y + 3.4 + Math.sin(t * 0.7) * 0.8,
        focus.z + Math.cos(ang) * radius);
      engine.camera.lookAt(focus);
      hud.update(dt);
      return;
    }
    camera.lockTarget = spells.lockTarget;
    camera.update(dt);
    if (shake > 0.001) {
      engine.camera.position.x += (Math.random() - 0.5) * shake;
      engine.camera.position.y += (Math.random() - 0.5) * shake;
      shake *= Math.exp(-8 * dt);
    }
    // Flight widens the lens for a sense of speed
    const wantFov = player.flying ? 68 : 55;
    if (Math.abs(engine.camera.fov - wantFov) > 0.05) {
      engine.camera.fov = THREE.MathUtils.lerp(engine.camera.fov, wantFov, 1 - Math.exp(-3 * dt));
      engine.camera.updateProjectionMatrix();
    }
    // Underwater: deep teal fog swallows the view
    if (engine.camera.position.y < world.waterLevel) {
      engine.scene.fog.color.setHex(0x0d3540);
      engine.scene.fog.density = 0.045;
    }
    // Hand the light pool to whichever lamps are nearest, on a slow cadence
    lightCullTimer -= dt;
    if (lightCullTimer <= 0) {
      lightCullTimer = 0.25;
      for (const e of lightRank) {
        e.l.getWorldPosition(_lightPos);
        e.d = _lightPos.distanceToSquared(engine.camera.position);
      }
      lightRank.sort((a, b) => a.d - b.d);
      for (let i = 0; i < lightRank.length; i++) lightRank[i].l.visible = i < LIGHT_POOL;
      profiler._litLights = Math.min(LIGHT_POOL, lightRank.length);
    }
    if (engine.input.wasPressed('F3')) profiler.toggle();
    // Pointer lock swallows clicks on the HUD, so '?' does the same job as
    // the button without having to leave the game first
    if (engine.input.wasPressed('Slash')) hud.toggleHelp();
    profiler.render({
      objects: engine.scene.children.length,
      lights: `${profiler._litLights ?? 0}/${allPointLights.length}`,
      instanced: world.vegetation.treeLodNear.length + world.vegetation.treeLodFar.length,
      grass: world.vegetation.grass.count,
      props: props.props.filter((p) => !p.broken).length,
      enemies: enemies.enemies.filter((e) => !e.dead).length,
    });
    hud.update(dt);
  },
});

engine.start();

if (import.meta.env.DEV) {
  // Fixed camera poses for __game.probe(): the views whose cost actually
  // matters — the approach, the courtyard, the hall, deep forest, the village.
  const PROBE_VIEWS = [
    ['approach', [6, 22, -40], [0, 24, -120]],
    ['court', [2, 32, -95], [-20, 26, -125]],
    ['hall', [-30, 28, -112], [-30, 26, -132]],
    ['forest', [120, 26, 60], [60, 14, -20]],
    ['village', [150, 8, 280], [150, 4, 240]],
  ];

  // Development-only handle for teleport, time control, and inspection.
  // It is removed from production builds.
  window.__game = {
    engine, world, player, camera, spells, enemies, npcs, weather, quests, collectibles, audio, hud,
    progression, charPanel, props, inventory, boss, cinematic, worldState,
    equipment, shop, profiler, dialogue, dialoguePanel, karma, caches, plants, mobile,
    minimap,
    step(n = 1, dt = 1 / 60) {
      for (let i = 0; i < n; i++) engine.tick(dt);
    },
    // Draw-call/triangle census from fixed camera poses. It renders without
    // advancing the simulation, so the numbers are reproducible between runs.
    probe(views = PROBE_VIEWS) {
      const r = engine.renderer;
      const cam = engine.camera;
      const pos = cam.position.clone();
      const quat = cam.quaternion.clone();
      const playerPos = player.position.clone();
      r.info.autoReset = false;
      const out = {};
      for (const [name, from, to] of views) {
        // Stand the player where the camera is and tick once, so every
        // distance-driven gate (LOD, interior dressing) settles for this view.
        player.position.set(from[0], from[1], from[2]);
        engine.tick(1 / 60);
        cam.position.set(from[0], from[1], from[2]);
        cam.lookAt(to[0], to[1], to[2]);
        cam.updateMatrixWorld(true);
        r.info.reset();
        engine.composer.render();
        out[name] = {
          calls: r.info.render.calls,
          ktris: Math.round(r.info.render.triangles / 1000),
        };
      }
      r.info.autoReset = true;
      player.position.copy(playerPos);
      cam.position.copy(pos);
      cam.quaternion.copy(quat);
      return out;
    },
  };

  const captureScene = new URLSearchParams(window.location.search).get('capture');
  if (captureScene) {
    import('./dev/CaptureDirector.js').then(({ startCaptureDirector }) => {
      startCaptureDirector(captureScene, {
        input: engine.input,
        engine,
        world,
        player,
        camera,
        spells,
        enemies,
        npcs,
        weather,
        quests,
        collectibles,
        audio,
        hud,
        progression,
        charPanel,
        props,
        inventory,
        boss,
        cinematic,
        worldState,
        equipment,
        shop,
        dialogue,
        dialoguePanel,
        karma,
        caches,
        plants,
        mobile,
        dialogueTree: MAELIS_TREE,
      });
    });
  }
}
