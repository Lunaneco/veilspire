#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  mkdirSync, writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = process.env.VERIFY_SCRATCH || join(ROOT, 'verify-out');
const PORT = Number(process.env.LAUNCH_PORT || 5199);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
mkdirSync(OUTPUT, { recursive: true });

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // Retry while the local server starts.
    }
    await delay(250);
  }
  return false;
}

function insideViewport(rect, viewport) {
  return rect.left >= -1
    && rect.top >= -1
    && rect.right <= viewport.width + 1
    && rect.bottom <= viewport.height + 1;
}

function overlaps(a, b) {
  return a.left < b.right
    && a.right > b.left
    && a.top < b.bottom
    && a.bottom > b.top;
}

const require = createRequire(join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const server = spawn(
  process.execPath,
  [
    join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--strictPort',
  ],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
);
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

let browser;
try {
  if (!await waitForServer(BASE_URL)) {
    throw new Error(`Vite did not start:\n${serverLog.slice(-2000)}`);
  }
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  const results = [];
  const profiles = [
    { name: 'desktop', width: 1280, height: 720, mobile: false, touchLayout: false },
    { name: 'phone-portrait', width: 390, height: 844, mobile: true, touchLayout: true },
    { name: 'phone-landscape', width: 844, height: 390, mobile: true, touchLayout: true },
    { name: 'phone-compact-portrait', width: 320, height: 568, mobile: true, touchLayout: true },
    { name: 'phone-compact-landscape', width: 568, height: 320, mobile: true, touchLayout: true },
    {
      name: 'phone-preview-no-touch',
      width: 390,
      height: 844,
      mobile: false,
      touchLayout: true,
    },
  ];

  for (const profile of profiles) {
    const page = await browser.newPage({
      viewport: { width: profile.width, height: profile.height },
      hasTouch: profile.mobile,
      isMobile: profile.mobile,
      deviceScaleFactor: profile.mobile ? 2 : 1,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.player, null, {
      timeout: 20000,
    });
    await page.evaluate(() => window.__game.step(30, 1 / 60));

    const state = await page.evaluate((checkRespawn) => {
      let respawn = null;
      if (checkRespawn) {
        const game = window.__game;
        const retainedState = () => ({
          progression: {
            level: game.progression.level,
            xp: game.progression.xp,
            points: game.progression.points,
            ranks: { ...game.progression.ranks },
          },
          equipment: {
            owned: [...game.equipment.owned].sort(),
            equipped: { ...game.equipment.equipped },
          },
          inventory: {
            slots: { ...game.inventory.slots },
            crowns: game.inventory.crowns,
          },
          world: {
            flags: { ...game.worldState.flags },
            shardsFound: game.worldState.shardsFound,
            wispsSlain: game.worldState.wispsSlain,
          },
        });
        game.progression.addXp(game.progression.xpForNext(), 'respawn-check');
        game.progression.spend('atk1');
        game.equipment.grant('wandHollow');
        game.equipment.equip('wandHollow');
        game.inventory.add('emberCap', 2);
        game.inventory.addCrowns(77);
        game.worldState.set('questAccepted');
        const retainedBefore = retainedState();
        game.karma.praise(24, 'respawn-check');
        game.karma.sin(70, 'respawn-check');
        game.player.position.set(180, 40, -90);
        game.player.velocity.set(3, -5, 2);
        game.player.health = 1;
        game.player.mana = 2;
        game.player.flying = true;
        game.player.climbing = true;
        game.player.swimming = true;
        game.player.takeDamage(1);
        const savedKarma = JSON.parse(
          localStorage.getItem('veilspire.karma.v1') || 'null',
        );
        const atStart = Math.abs(game.player.position.x - game.player.startPosition.x) < 0.001
          && Math.abs(game.player.position.y - game.player.startPosition.y) < 0.001
          && Math.abs(game.player.position.z - game.player.startPosition.z) < 0.001;
        respawn = {
          atStart,
          fullHealth: game.player.health === game.player.maxHealth,
          fullMana: game.player.mana === game.player.maxMana,
          movementReset: game.player.velocity.lengthSq() === 0
            && !game.player.flying
            && !game.player.climbing
            && !game.player.swimming
            && game.player.grounded,
          infamyReset: game.karma.infamy === 0
            && game.karma.peakInfamy === 0
            && !game.karma.outlawed,
          virtueRetained: game.karma.virtue === 24,
          progressionRetained: JSON.stringify(retainedState())
            === JSON.stringify(retainedBefore),
          persisted: savedKarma?.infamy === 0
            && savedKarma?.peakInfamy === 0
            && savedKarma?.outlawed === false
            && savedKarma?.virtue === 24,
        };
        respawn.pass = Object.values(respawn).every(Boolean);
      }
      const controlRoot = document.querySelector('#mobile-controls');
      const playerMarker = document.querySelector('.player-marker');
      const controls = controlRoot
        ? [...controlRoot.querySelectorAll('button')].map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              label: button.textContent.trim(),
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            };
          })
        : [];
      const groupIds = [
        'mc-stick-base', 'mc-actions', 'mc-spells', 'mc-utils', 'minimap', 'bars',
      ];
      const groups = Object.fromEntries(groupIds.map((id) => {
        const group = document.getElementById(id);
        if (!group) return [id, null];
        const rect = group.getBoundingClientRect();
        return [id, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }];
      }));
      const input = window.__game.engine.input;
      const attackButton = document.querySelector('#mc-actions .mc-attack');
      attackButton?.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 41,
        pointerType: 'touch',
        isPrimary: true,
      }));
      const injectedAttack = input.wasPressed('KeyZ') && input.isDown('KeyZ');
      input.lateUpdate();
      const stick = document.querySelector('#mc-stick-zone');
      const stickRect = document.querySelector('#mc-stick-base')?.getBoundingClientRect();
      stick?.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 42,
        pointerType: 'touch',
        isPrimary: true,
        clientX: stickRect ? stickRect.left + stickRect.width / 2 : 0,
        clientY: stickRect ? stickRect.top + 8 : 0,
      }));
      const stickMoved = input.isDown('KeyW');
      stick?.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 42,
        pointerType: 'touch',
        isPrimary: true,
      }));
      const look = document.querySelector('#mc-look-zone');
      look?.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 43,
        pointerType: 'touch',
        isPrimary: true,
        clientX: innerWidth * 0.7,
        clientY: innerHeight * 0.3,
      }));
      look?.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 43,
        pointerType: 'touch',
        isPrimary: true,
        clientX: innerWidth * 0.7 + 30,
        clientY: innerHeight * 0.3 + 10,
      }));
      const lookChanged = Math.abs(input.mouseDX) > 0 && Math.abs(input.mouseDY) > 0;
      look?.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 43,
        pointerType: 'touch',
        isPrimary: true,
      }));
      return {
        title: document.title,
        hasCanvas: !!document.querySelector('canvas'),
        touchMode: input.touchMode,
        mobileControls: !!controlRoot,
        buttonCount: controls.length,
        controls,
        injectedAttack,
        stickMoved,
        lookChanged,
        groups,
        viewportHeight: document.getElementById('app')?.getBoundingClientRect().height,
        rendererMobile: window.__game.engine.mobileMode,
        rendererPixelRatio: window.__game.engine.renderer.getPixelRatio(),
        qualityTier: window.__game.profiler.tierName,
        minimapRotation: playerMarker?.style
          .getPropertyValue('--player-rotation'),
        respawn,
      };
    }, profile.name === 'desktop');

    const controlsInside = state.controls.every(
      (rect) => insideViewport(rect, profile),
    );
    const layoutPairs = [
      ['mc-stick-base', 'mc-spells'],
      ['mc-stick-base', 'bars'],
      ['mc-actions', 'mc-spells'],
      ['mc-actions', 'minimap'],
      ['minimap', 'mc-utils'],
    ];
    const layoutOverlaps = layoutPairs.filter(([a, b]) => {
      const first = state.groups[a];
      const second = state.groups[b];
      return first && second && overlaps(first, second);
    });
    const groupsInside = Object.values(state.groups)
      .filter(Boolean)
      .every((rect) => insideViewport(rect, profile));
    const overflowingControls = state.controls
      .filter((rect) => !insideViewport(rect, profile));
    const pass = errors.length === 0
      && state.title === 'Veilspire'
      && state.hasCanvas
      && (!state.respawn || state.respawn.pass)
      && (profile.touchLayout ? (
        state.touchMode
        && state.mobileControls
        && state.buttonCount >= 16
        && controlsInside
        && groupsInside
        && layoutOverlaps.length === 0
        && state.injectedAttack
        && state.stickMoved
        && state.lookChanged
        && state.rendererMobile
        && state.rendererPixelRatio <= 1.25
        && state.qualityTier === 'MEDIUM'
        && Math.abs(state.viewportHeight - profile.height) <= 1
      ) : !state.mobileControls);
    const screenshot = join(OUTPUT, `${profile.name}.png`);
    await page.screenshot({ path: screenshot });
    results.push({
      profile: profile.name,
      viewport: { width: profile.width, height: profile.height },
      pass,
      controlsInside,
      groupsInside,
      layoutOverlaps,
      overflowingControls,
      errors,
      state: {
        ...state,
        controls: undefined,
        groups: undefined,
      },
      screenshot,
    });
    await page.close();
  }

  const ok = results.every((result) => result.pass);
  writeFileSync(
    join(OUTPUT, 'browser-results.json'),
    `${JSON.stringify({ ok, results }, null, 2)}\n`,
  );
  if (!ok) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('PASS desktop, phone portrait, phone landscape\n');
  }
} catch (error) {
  writeFileSync(
    join(OUTPUT, 'browser-error.log'),
    `${String(error)}\n${error?.stack || ''}\n${serverLog}\n`,
  );
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
