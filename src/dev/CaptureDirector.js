const DURATIONS = {
  approach: 9,
  combat: 10,
  flight: 10,
  village: 8,
  ruins: 9,
  cavern: 9,
  dialogue: 10,
  systems: 10,
  boss: 12,
};

function setWeather(weather, state) {
  const values = {
    clear: { rain: 0, dim: 0, cloud: 0, fogMult: 1, snow: 0 },
    overcast: { rain: 0, dim: 0.45, cloud: 0.75, fogMult: 1.6, snow: 0 },
    rain: { rain: 1, dim: 0.6, cloud: 0.9, fogMult: 2.2, snow: 0 },
    storm: { rain: 1.6, dim: 0.75, cloud: 1, fogMult: 2.8, snow: 0 },
  };
  weather.state = state;
  weather.next = state;
  weather.blend = 1;
  weather.holdTimer = 9999;
  Object.assign(weather.cur, values[state]);
}

function groundPlayer(ctx, x, z, extraY = 0) {
  const { player, world } = ctx;
  player.position.set(x, world.groundHeight(x, z) + extraY, z);
  player.velocity.set(0, 0, 0);
  player.grounded = extraY <= 0;
  player.flying = false;
  player.swimming = false;
  player.health = player.maxHealth;
  player.mana = player.maxMana;
  player.model.root.position.copy(player.position);
}

function pulse(input, code, fired, id, t, at) {
  if (!fired.has(id) && t >= at) {
    fired.add(id);
    input.pressed.add(code);
  }
}

function hold(input, code, on) {
  if (on) input.keys.add(code);
  else input.keys.delete(code);
}

function setStatus(el, ctx, scene, loop, t, phase) {
  el.dataset.scene = scene;
  el.dataset.loop = String(loop);
  el.dataset.time = t.toFixed(2);
  el.dataset.phase = phase;
  el.dataset.complete = t > DURATIONS[scene] - 0.25 ? 'true' : 'false';
  el.dataset.playerHealth = Math.round(ctx.player.health).toString();
  el.dataset.playerMana = Math.round(ctx.player.mana).toString();
  el.dataset.flying = String(ctx.player.flying);
  el.dataset.enemiesAlive = String(ctx.enemies.enemies.filter((e) => !e.dead).length);
  el.dataset.bossPhase = String(ctx.boss.phase);
  el.dataset.level = String(ctx.progression.level);
  el.dataset.potions = String(ctx.inventory.potions().length);
  el.dataset.shopOpen = String(ctx.shop.open);
  el.dataset.characterOpen = String(ctx.charPanel.open);
}

function setup(scene, ctx) {
  const {
    input, camera, hud, world, player, spells, boss, dialogue, charPanel, shop,
    progression,
  } = ctx;
  input.keys.clear();
  input.pressed.clear();
  input.mouseButtons.clear();
  input.mousePressed.clear();
  input.suspended = false;
  progression.save = () => {};
  ctx.equipment.save = () => {};
  ctx.karma.save = () => {};
  hud.toggleHelp(false);
  dialogue.end();
  charPanel.toggle(false);
  shop.toggle(false);
  spells.lockTarget = null;
  player.maxMana = Math.max(player.maxMana, 240);
  player.mana = player.maxMana;
  camera.autoFollow = false;
  camera.pitch = 0.14;
  camera.targetDistance = camera.currentDistance = 6.5;
  ctx.engine.renderer.toneMappingExposure = 1.05;
  world.sky.daySpeed = 0;
  setWeather(ctx.weather, 'clear');

  if (scene === 'approach') {
    groundPlayer(ctx, 21, 37);
    camera.yaw = 0.12;
    camera.pitch = 0.12;
    camera.targetDistance = camera.currentDistance = 7.2;
    world.sky.timeOfDay = 15.2;
  } else if (scene === 'combat') {
    groundPlayer(ctx, 58, 62);
    camera.yaw = Math.PI;
    camera.pitch = 0.13;
    camera.targetDistance = camera.currentDistance = 7.8;
    world.sky.timeOfDay = 16.2;
    const target = ctx.enemies.enemies.find((e) => !e.isBoss && !e.isGolem && !e.dead);
    if (target) {
      target.position.set(58, world.groundHeight(58, 52), 52);
      target.group?.position.copy(target.position);
      target.state = 'aggro';
      target.hp = Math.max(target.hp ?? 100, 170);
      spells.lockTarget = target;
    }
  } else if (scene === 'flight') {
    groundPlayer(ctx, 18, 70, 26);
    player.flying = true;
    player.grounded = false;
    player.velocity.set(0, 0, -10);
    camera.yaw = 0.08;
    camera.pitch = 0.02;
    camera.targetDistance = camera.currentDistance = 10;
    world.sky.timeOfDay = 16.8;
  } else if (scene === 'village') {
    // Follow the narrow lane between the two northern cottages instead of
    // walking directly into the cottage centered at x=148.
    groundPlayer(ctx, 155, 279);
    camera.yaw = 0;
    camera.pitch = 0.12;
    camera.targetDistance = camera.currentDistance = 6.8;
    world.sky.timeOfDay = 8.4;
  } else if (scene === 'ruins') {
    groundPlayer(ctx, -235, -48);
    camera.yaw = 0;
    camera.pitch = 0.1;
    camera.targetDistance = camera.currentDistance = 7.5;
    world.sky.timeOfDay = 18.1;
    setWeather(ctx.weather, 'storm');
  } else if (scene === 'cavern') {
    player.position.set(-60, world.cavern.floorY + 0.1, -286);
    player.velocity.set(0, 0, 0);
    player.grounded = true;
    player.flying = false;
    player.model.root.position.copy(player.position);
    camera.yaw = 0;
    camera.pitch = 0.08;
    camera.targetDistance = camera.currentDistance = 6;
    world.sky.timeOfDay = 20.2;
  } else if (scene === 'dialogue') {
    groundPlayer(ctx, 21, 37);
    camera.yaw = 0.12;
    camera.pitch = 0.14;
    camera.targetDistance = camera.currentDistance = 6.2;
    world.sky.timeOfDay = 14.5;
  } else if (scene === 'systems') {
    groundPlayer(ctx, 150, 258);
    camera.yaw = 0;
    camera.pitch = 0.12;
    camera.targetDistance = camera.currentDistance = 6.2;
    world.sky.timeOfDay = 11.2;
    ctx.inventory.crowns = 1000;
    ctx.inventory.add('emberCap', 4);
    ctx.inventory.add('frostLeaf', 4);
    ctx.inventory.add('aetherDust', 3);
    ctx.equipment.grant('robeStorm');
    ctx.equipment.equip('robeStorm');
    progression.points = Math.max(progression.points, 3);
  } else if (scene === 'boss') {
    groundPlayer(ctx, 250, -212);
    camera.yaw = 0;
    camera.pitch = 0.12;
    camera.targetDistance = camera.currentDistance = 9;
    world.sky.timeOfDay = 17.4;
    boss.hp = boss.maxHp;
    boss.phase = 1;
    boss.state = 'fight';
    boss.dead = false;
    boss.finisherReady = false;
    boss.finisherPlaying = false;
    boss.group.visible = true;
    spells.lockTarget = boss;
  }
}

function direct(scene, ctx, t, fired) {
  const {
    input, camera, player, spells, boss, cinematic, world, dialogue, charPanel,
    shop, inventory, progression,
  } = ctx;
  let phase = 'explore';

  if (scene === 'approach') {
    phase = t < 1 ? 'establish' : 'sprint';
    hold(input, 'KeyW', t > 0.8 && t < 8.4);
    hold(input, 'ShiftLeft', t > 1.1 && t < 8.4);
    pulse(input, 'Space', fired, 'approach-jump', t, 5.2);
    camera.yaw = 0.12 + Math.sin(t * 0.28) * 0.08;
  } else if (scene === 'combat') {
    phase = t < 2 ? 'ward' : t < 6.5 ? 'spells' : 'ultimate';
    hold(input, 'KeyX', t > 0.6 && t < 1.9);
    hold(input, 'KeyZ', t > 2.0 && t < 4.8);
    if (!fired.has('combat-frost') && t >= 3.2) {
      fired.add('combat-frost');
      spells.castFrostLash();
    }
    if (!fired.has('combat-ember') && t >= 5.1) {
      fired.add('combat-ember');
      player.mana = player.maxMana;
      spells.castEmberBurst();
    }
    if (!fired.has('combat-push') && t >= 6.5) {
      fired.add('combat-push');
      player.mana = player.maxMana;
      spells.castForcePush();
    }
    if (!fired.has('combat-ult') && t >= 8.0) {
      fired.add('combat-ult');
      spells.ultCharge = spells.ultMax;
      spells.castUltimate();
    }
  } else if (scene === 'flight') {
    phase = t < 1 ? 'summon' : 'flight';
    player.flying = true;
    hold(input, 'KeyW', t > 0.6 && t < 9.7);
    hold(input, 'ShiftLeft', t > 1.2 && t < 9.7);
    hold(input, 'Space', t > 2.4 && t < 4.2);
    camera.yaw = 0.08 + Math.sin(t * 0.22) * 0.14;
    camera.pitch = 0.02 + Math.sin(t * 0.32) * 0.035;
  } else if (scene === 'village') {
    phase = t < 1 ? 'establish' : 'walk';
    hold(input, 'KeyW', t > 1.0 && t < 7.7);
    camera.yaw = Math.sin(t * 0.36) * 0.1;
  } else if (scene === 'ruins') {
    phase = t < 4.5 ? 'storm' : 'ignite';
    hold(input, 'KeyW', t > 0.8 && t < 4.2);
    if (!fired.has('ruins-ignite') && t >= 4.6) {
      fired.add('ruins-ignite');
      player.mana = player.maxMana;
      world.settlements.igniteAt(player.position, 30);
      spells.castEmberBurst();
    }
    camera.yaw = Math.sin(t * 0.2) * 0.14;
  } else if (scene === 'cavern') {
    phase = t < 5.2 ? 'explore' : 'treasure';
    ctx.engine.renderer.toneMappingExposure = 1.38;
    for (const crystal of world.cavern.crystals) {
      if (crystal.light) crystal.light.intensity = 11;
    }
    hold(input, 'KeyW', t > 1.0 && t < 4.8);
    camera.yaw = Math.sin(t * 0.32) * 0.16;
    if (!fired.has('cavern-chest') && t >= 5.4) {
      fired.add('cavern-chest');
      world.cavern.open();
      spells.spawnBurst(world.cavern.chestPos.clone().setY(world.cavern.chestPos.y + 1), 40, 5, 0xffd27a, 1.1);
    }
  } else if (scene === 'dialogue') {
    phase = t < 4.8 ? 'dialogue' : 'progression';
    if (!fired.has('dialogue-open') && t >= 0.8) {
      fired.add('dialogue-open');
      dialogue.start(ctx.dialogueTree);
    }
    if (!fired.has('dialogue-close') && t >= 4.8) {
      fired.add('dialogue-close');
      dialogue.end();
      charPanel.toggle(true);
    }
    if (!fired.has('dialogue-panel-close') && t >= 9.2) {
      fired.add('dialogue-panel-close');
      charPanel.toggle(false);
    }
  } else if (scene === 'systems') {
    phase = t < 4.7 ? 'shop' : t < 7.6 ? 'inventory' : 'potion';
    if (!fired.has('systems-shop') && t >= 0.8) {
      fired.add('systems-shop');
      shop.toggle(true);
    }
    if (!fired.has('systems-character') && t >= 4.8) {
      fired.add('systems-character');
      shop.toggle(false);
      inventory.brew({ id: 'healPotion', needs: { emberCap: 2, aetherDust: 1 } });
      inventory.brew({ id: 'manaPotion', needs: { frostLeaf: 2, aetherDust: 1 } });
      progression.addXp(90, 'capture-test');
      charPanel.toggle(true);
    }
    if (!fired.has('systems-use') && t >= 7.8) {
      fired.add('systems-use');
      charPanel.toggle(false);
      player.health = Math.max(1, player.maxHealth - 50);
      inventory.use('healPotion');
    }
  } else if (scene === 'boss') {
    phase = t < 4.2 ? 'phase-one' : t < 7.2 ? 'phase-two' : 'finisher';
    hold(input, 'KeyZ', t > 1.0 && t < 5.8);
    if (!fired.has('boss-phase-two') && t >= 4.2) {
      fired.add('boss-phase-two');
      boss.hp = boss.maxHp * 0.49;
      boss.enterPhaseTwo();
    }
    if (!fired.has('boss-break') && t >= 6.8) {
      fired.add('boss-break');
      boss.hp = boss.maxHp * 0.07;
      boss.finisherReady = true;
      boss.state = 'kneel';
      boss.beam.visible = false;
    }
    if (!fired.has('boss-finisher') && t >= 7.6) {
      fired.add('boss-finisher');
      boss.startFinisher();
      cinematic.t = 0;
      cinematic.active = true;
    }
  }

  return phase;
}

export function startCaptureDirector(scene, ctx) {
  if (!DURATIONS[scene]) throw new Error(`Unknown capture scene: ${scene}`);

  const status = document.createElement('div');
  status.id = 'capture-status';
  status.hidden = true;
  document.body.appendChild(status);

  const duration = DURATIONS[scene];
  let loop = 0;
  let loopStart = performance.now();
  let fired = new Set();
  setup(scene, ctx);

  function frame(now) {
    let t = (now - loopStart) / 1000;
    if (t >= duration) {
      loop++;
      loopStart = now;
      t = 0;
      fired = new Set();
      setup(scene, ctx);
    }
    const phase = direct(scene, ctx, t, fired);
    setStatus(status, ctx, scene, loop, t, phase);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
