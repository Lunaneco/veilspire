import * as THREE from 'three';

// DOM-based HUD: health/mana orbs, spell slots, crosshair, time-of-day,
// and a controls hint that fades after first input.

export class HUD {
  constructor(container, player, sky, spells = null) {
    this.player = player;
    this.sky = sky;
    this.spells = spells;
    this._vignetteTimer = 0;

    const el = document.createElement('div');
    el.id = 'hud';
    el.innerHTML = `
      <style>
        #hud { position: absolute; inset: 0; pointer-events: none; font-family: 'Georgia', serif; user-select: none; }
        #crosshair { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px;
          border-radius: 50%; background: rgba(255,255,255,0.75); box-shadow: 0 0 6px rgba(160,220,255,0.9); }
        #bars { position: absolute; left: 28px; bottom: 26px; display: flex; flex-direction: column; gap: 7px; }
        .bar { width: 240px; height: 12px; border-radius: 7px; background: rgba(10,14,24,0.65);
          border: 1px solid rgba(200,215,240,0.35); overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
        .bar .fill { height: 100%; border-radius: 6px; transition: width 0.15s ease-out; }
        #hp .fill { background: linear-gradient(180deg, #ff7a6b, #c93a2e); width: 100%; }
        #mp .fill { background: linear-gradient(180deg, #7fc0ff, #2e63c9); width: 100%; }
        #ult { position: relative; height: 9px; }
        #ult .fill { background: linear-gradient(180deg, #d5b3ff, #7a45cf); width: 0%; }
        #ult.ready { box-shadow: 0 0 14px rgba(190,140,255,0.85); border-color: rgba(220,190,255,0.9); }
        #ult.ready .fill { background: linear-gradient(180deg, #f0e0ff, #a061ff); }
        #ult .ready { position: absolute; left: 0; top: -17px; font-size: 10px; letter-spacing: 2.5px;
          color: #e0c8ff; opacity: 0; transition: opacity 0.3s; }
        #ult.ready .ready { opacity: 1; }
        #counterflash { position: absolute; left: 50%; top: 44%; transform: translateX(-50%);
          color: #fff0b0; font-size: 30px; letter-spacing: 10px; opacity: 0;
          text-shadow: 0 0 26px rgba(255,220,120,0.95); transition: opacity 0.25s; }
        #spells { position: absolute; right: 28px; bottom: 22px; display: flex; gap: 10px; }
        .slot { width: 52px; height: 52px; border-radius: 10px; background: rgba(10,14,24,0.7);
          border: 1px solid rgba(200,215,240,0.4); display: flex; align-items: center; justify-content: center;
          flex-direction: column; color: #cfe0f5; box-shadow: 0 2px 12px rgba(0,0,0,0.45); }
        .slot .glyph { font-size: 22px; line-height: 1; text-shadow: 0 0 8px rgba(140,200,255,0.8); }
        .slot .key { font-size: 10px; opacity: 0.7; margin-top: 3px; letter-spacing: 0.5px; }
        #clock { position: absolute; top: 20px; right: 28px; color: rgba(225,235,250,0.85);
          font-size: 15px; letter-spacing: 1.5px; text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
        #hint { position: absolute; left: 50%; bottom: 90px; transform: translateX(-50%);
          color: rgba(230,240,255,0.9); background: rgba(8,12,22,0.55); padding: 10px 22px; border-radius: 10px;
          font-size: 14px; letter-spacing: 0.4px; border: 1px solid rgba(180,200,230,0.25);
          transition: opacity 0.25s ease; text-align: center; line-height: 1.7; }
        /* The controls live behind this, so it has to stay clickable even
           though the rest of the HUD lets the mouse through to the game. */
        #helpbtn { position: absolute; top: 16px; right: 92px; width: 27px; height: 27px;
          border-radius: 50%; border: 1px solid rgba(190,210,235,0.45);
          background: rgba(8,12,22,0.6); color: rgba(225,235,250,0.9);
          font-size: 15px; line-height: 25px; text-align: center; cursor: pointer;
          pointer-events: auto; transition: background 0.15s, border-color 0.15s, color 0.15s; }
        #helpbtn:hover { background: rgba(30,44,70,0.85); border-color: rgba(220,235,255,0.8); }
        #helpbtn.on { background: rgba(60,90,140,0.9); border-color: rgba(230,242,255,0.95);
          color: #fff; }
        #title { position: absolute; top: 24px; left: 50%; transform: translateX(-50%);
          color: rgba(235,242,252,0.92); font-size: 26px; letter-spacing: 10px; font-variant: small-caps;
          text-shadow: 0 2px 14px rgba(80,140,220,0.5); }
        #vignette { position: absolute; inset: 0; pointer-events: none; opacity: 0;
          background: radial-gradient(ellipse at center, transparent 55%, rgba(180,20,20,0.55) 100%);
          transition: opacity 0.08s ease-in; }
        .slot.cooling { opacity: 0.35; }
        /* The karma spells: only the one your run has earned is ever shown */
        .slot.karma-slot { display: none; }
        #slot-oath { border-color: rgba(255,225,150,0.6); box-shadow: 0 0 16px rgba(255,205,110,0.3); }
        #slot-oath .glyph { color: #ffe6a8; text-shadow: 0 0 12px rgba(255,205,110,0.95); }
        #slot-tithe { border-color: rgba(210,60,70,0.6); box-shadow: 0 0 16px rgba(190,30,50,0.3); }
        #slot-tithe .glyph { color: #ff7a86; text-shadow: 0 0 12px rgba(220,40,60,0.95); }
        #shards { position: absolute; top: 46px; right: 28px; color: #bfe6ff; font-size: 14px;
          letter-spacing: 1.5px; text-shadow: 0 0 8px rgba(110,200,255,0.6); display: flex; gap: 7px; }
        #shards .glyph { color: #8ae4ff; }
        #bossbar { position: absolute; left: 50%; top: 84px; transform: translateX(-50%);
          width: min(560px, 60vw); display: none; text-align: center; }
        #bossbar .bname { color: #e8dcc0; font-size: 14px; letter-spacing: 6px;
          font-variant: small-caps; margin-bottom: 6px; text-shadow: 0 0 14px rgba(0,0,0,0.8); }
        #bossbar .btrack { height: 13px; border-radius: 7px; background: rgba(10,8,12,0.8);
          border: 1px solid rgba(220,200,170,0.45); overflow: hidden; }
        #bossbar .bfill { height: 100%; width: 100%; transition: width 0.25s ease-out;
          background: linear-gradient(180deg, #7fe8c0, #2a9f78); }
        #bossbar.phase2 .bfill { background: linear-gradient(180deg, #ff9a6a, #c9402a); }
        #bossbar .bphase { color: #ffb98a; font-size: 11.5px; letter-spacing: 3px; margin-top: 5px;
          min-height: 14px; }
        #finisher { position: absolute; left: 50%; top: 52%; transform: translateX(-50%);
          color: #fff0c8; font-size: 26px; letter-spacing: 9px; display: none;
          text-shadow: 0 0 24px rgba(255,190,90,0.95); animation: fpulse 1.1s ease-in-out infinite; }
        @keyframes fpulse { 0%,100% { opacity: 0.65; } 50% { opacity: 1; } }
        #bubbles { position: absolute; inset: 0; pointer-events: none; }
        .bub { position: absolute; transform: translate(-50%, -100%);
          background: rgba(12,17,28,0.82); color: #e6eefa; font-size: 13px; line-height: 1.45;
          padding: 7px 12px; border-radius: 10px; border: 1px solid rgba(190,210,235,0.3);
          max-width: 230px; text-align: center; box-shadow: 0 4px 18px rgba(0,0,0,0.5); }
        .bub::after { content: ''; position: absolute; left: 50%; bottom: -6px;
          transform: translateX(-50%); border-left: 6px solid transparent;
          border-right: 6px solid transparent; border-top: 6px solid rgba(12,17,28,0.82); }
        #toast { position: absolute; right: 28px; top: 96px; color: #e8f0fa; font-size: 13.5px;
          letter-spacing: 1px; opacity: 0; transition: opacity 0.4s;
          background: rgba(8,12,22,0.6); padding: 7px 14px; border-radius: 8px;
          border: 1px solid rgba(190,210,235,0.25); }
        #prompt { position: absolute; left: 50%; bottom: 165px; transform: translateX(-50%);
          color: #e8f0fa; background: rgba(10,14,24,0.7); padding: 8px 18px; border-radius: 8px;
          font-size: 15px; border: 1px solid rgba(190,210,235,0.3); display: none;
          letter-spacing: 0.5px; }
        #levelbadge { position: absolute; left: 28px; bottom: 66px; color: #ffd27a;
          font-size: 13px; letter-spacing: 3px; text-shadow: 0 0 10px rgba(255,190,90,0.5); }
        #banner { position: absolute; left: 50%; top: 38%; transform: translateX(-50%);
          text-align: center; opacity: 0; transition: opacity 0.5s; pointer-events: none; }
        #banner .btitle { font-size: 40px; letter-spacing: 12px; color: #ffe6b0;
          font-variant: small-caps; text-shadow: 0 0 28px rgba(255,190,90,0.8); }
        #banner .bsub { font-size: 14px; letter-spacing: 3px; color: #cfe0f5; margin-top: 8px; }
        #xpfloat { position: absolute; left: 50%; bottom: 200px; transform: translateX(-50%);
          color: #9fd8ff; font-size: 16px; letter-spacing: 2px; opacity: 0;
          text-shadow: 0 0 12px rgba(120,200,255,0.8); transition: opacity 0.3s, bottom 0.9s; }
        #flightbadge { position: absolute; left: 50%; top: 64px; transform: translateX(-50%);
          color: #cfe4ff; font-size: 13px; letter-spacing: 4px; opacity: 0; transition: opacity 0.3s;
          text-shadow: 0 0 12px rgba(120,190,255,0.9); }
        #lockon { position: absolute; color: #ffd27a; font-size: 30px; display: none;
          transform: translate(-50%, -50%); text-shadow: 0 0 10px rgba(255,190,90,0.9);
          animation: lockspin 2.4s linear infinite; }
        @keyframes lockspin { from { transform: translate(-50%,-50%) rotate(0deg); }
          to { transform: translate(-50%,-50%) rotate(360deg); } }
        /* Health plate that rides above the locked target */
        #target { position: absolute; display: none; transform: translate(-50%, -100%);
          text-align: center; pointer-events: none; width: 132px; }
        #target .tname { color: #f0e2c8; font-size: 11px; letter-spacing: 3px;
          font-variant: small-caps; margin-bottom: 3px; text-shadow: 0 1px 6px rgba(0,0,0,0.9); }
        #target .ttrack { height: 6px; border-radius: 3px; background: rgba(10,8,12,0.75);
          border: 1px solid rgba(220,200,170,0.4); overflow: hidden; }
        #target .tfill { height: 100%; width: 100%; background: linear-gradient(180deg, #ff8a7a, #c9402a);
          transition: width 0.18s ease-out; }
        /* The bar recolours to whatever is eating the target right now */
        #target.burning .tfill { background: linear-gradient(180deg, #ffc06a, #e0631f); }
        #target.frozen .tfill { background: linear-gradient(180deg, #bfe8ff, #4aa8d8); }
        #target .tstate { font-size: 10px; letter-spacing: 2px; margin-top: 3px; min-height: 12px;
          color: #ffd6a0; text-shadow: 0 1px 6px rgba(0,0,0,0.9); }
        /* Standing: how the valley sees you. Hidden while both gauges are empty. */
        #karma { position: absolute; left: 28px; bottom: 96px; width: 190px; display: none; }
        #karma .krow { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }
        #karma .kglyph { font-size: 11px; width: 13px; text-align: center; }
        #karma .ktrack { flex: 1; height: 5px; border-radius: 3px; background: rgba(10,12,20,0.75);
          border: 1px solid rgba(160,180,210,0.25); overflow: hidden; }
        #karma .kfill { height: 100%; width: 0%; transition: width 0.4s ease-out; }
        #karma .sin .kglyph { color: #ff8a6a; }
        #karma .sin .kfill { background: linear-gradient(180deg, #ff9a7a, #b8321c); }
        #karma .good .kglyph { color: #8ae4c0; }
        #karma .good .kfill { background: linear-gradient(180deg, #9fe8c8, #2a9f78); }
        #karma .kstanding { color: #ff9a7a; font-size: 10px; letter-spacing: 3px; min-height: 12px;
          text-shadow: 0 0 10px rgba(200,60,40,0.6); }
        #karma.outlawed .kstanding { color: #ff6a4a; animation: fpulse 1.6s ease-in-out infinite; }
      </style>
      <div id="title">veilspire</div>
      <div id="helpbtn" title="Controls">?</div>
      <div id="crosshair"></div>
      <div id="bars">
        <div class="bar" id="hp"><div class="fill"></div></div>
        <div class="bar" id="mp"><div class="fill"></div></div>
        <div class="bar" id="ult"><div class="fill"></div><div class="ready">T — VEILBREAK</div></div>
      </div>
      <div id="counterflash">PARRY</div>
      <div id="spells">
        <div class="slot" id="slot-bolt"><div class="glyph">✦</div><div class="key">LMB / Z</div></div>
        <div class="slot" id="slot-ward"><div class="glyph">◈</div><div class="key">RMB / X</div></div>
        <div class="slot" id="slot-push"><div class="glyph">≋</div><div class="key">E</div></div>
        <div class="slot" id="slot-ember"><div class="glyph">❋</div><div class="key">R</div></div>
        <div class="slot" id="slot-frost"><div class="glyph">❆</div><div class="key">C</div></div>
        <div class="slot" id="slot-lev"><div class="glyph">⌖</div><div class="key">V</div></div>
        <div class="slot karma-slot" id="slot-oath"><div class="glyph">✸</div><div class="key">B</div></div>
        <div class="slot karma-slot" id="slot-tithe"><div class="glyph">⚱</div><div class="key">N</div></div>
      </div>
      <div id="lockon">◇</div>
      <div id="target"><div class="tname"></div>
        <div class="ttrack"><div class="tfill"></div></div>
        <div class="tstate"></div></div>
      <div id="levelbadge">LV 1</div>
      <div id="karma">
        <div class="krow sin"><div class="kglyph">✦</div>
          <div class="ktrack"><div class="kfill"></div></div></div>
        <div class="krow good"><div class="kglyph">❖</div>
          <div class="ktrack"><div class="kfill"></div></div></div>
        <div class="kstanding"></div>
      </div>
      <div id="banner"><div class="btitle"></div><div class="bsub"></div></div>
      <div id="xpfloat"></div>
      <div id="bossbar"><div class="bname">THE HOLLOW WARDEN</div>
        <div class="btrack"><div class="bfill"></div></div>
        <div class="bphase"></div></div>
      <div id="finisher">F — END IT</div>
      <div id="bubbles"></div>
      <div id="toast"></div>
      <div id="prompt"></div>
      <div id="vignette"></div>
      <div id="clock">17:12</div>
      <div id="shards"><span class="glyph">◆</span><span class="count">0 / 0</span></div>
      <div id="flightbadge">✦ FLIGHT</div>
      <div id="hint">Click to enter &nbsp;·&nbsp; WASD / arrow keys move · Shift sprint · Space jump · Q dodge · G fly<br/>
        <b>Z</b> or LMB bolt · <b>X</b> or RMB ward · E push · R ember · C frost · V levitate<br/>
        Tab lock-on · F interact · I character · 1/2 potions · <b>T</b> Veilbreak<br/>
        <b>B</b> Oathlight (kept clean) · <b>N</b> Bloodtithe (earned in blood)<br/>
        Ward at the last instant to <b>parry</b> and reflect · mouse look (camera auto-follows)</div>
    `;
    container.appendChild(el);
    this.hpFill = el.querySelector('#hp .fill');
    this.mpFill = el.querySelector('#mp .fill');
    this.ultBar = el.querySelector('#ult');
    this.ultFill = el.querySelector('#ult .fill');
    this.counterFlash = el.querySelector('#counterflash');
    this._counterTimer = 0;
    this.clock = el.querySelector('#clock');
    this.hint = el.querySelector('#hint');
    this.vignette = el.querySelector('#vignette');
    this.slotPush = el.querySelector('#slot-push');
    this.slotEmber = el.querySelector('#slot-ember');
    this.slotFrost = el.querySelector('#slot-frost');
    this.slotOath = el.querySelector('#slot-oath');
    this.slotTithe = el.querySelector('#slot-tithe');
    this.lockonEl = el.querySelector('#lockon');
    this.targetEl = el.querySelector('#target');
    this.targetName = el.querySelector('#target .tname');
    this.targetFill = el.querySelector('#target .tfill');
    this.targetState = el.querySelector('#target .tstate');
    this.karmaEl = el.querySelector('#karma');
    this.karmaSin = el.querySelector('#karma .sin .kfill');
    this.karmaGood = el.querySelector('#karma .good .kfill');
    this.karmaStanding = el.querySelector('#karma .kstanding');
    this.karma = null; // wired in main
    this._targetPos = new THREE.Vector3();
    this._platePos = new THREE.Vector3();
    this.shardCount = el.querySelector('#shards .count');
    this.flightBadge = el.querySelector('#flightbadge');
    this.collectibles = null; // wired in main
    this.progression = null;
    this.levelBadge = el.querySelector('#levelbadge');
    this.bannerEl = el.querySelector('#banner');
    this.bannerTitle = el.querySelector('#banner .btitle');
    this.bannerSub = el.querySelector('#banner .bsub');
    this.xpFloat = el.querySelector('#xpfloat');
    this.toastEl = el.querySelector('#toast');
    this.promptEl = el.querySelector('#prompt');
    this.bossBar = el.querySelector('#bossbar');
    this.bossFill = el.querySelector('#bossbar .bfill');
    this.bossPhase = el.querySelector('#bossbar .bphase');
    this.finisherEl = el.querySelector('#finisher');
    this.boss = null; // wired in main
    this.bubblesEl = el.querySelector('#bubbles');
    this.npcs = null;
    this._bubblePool = [];
    this.camera = null; // wired in main for reticle projection

    this.player.onDamaged = () => { this._vignetteTimer = 0.5; };

    // The controls sheet is a toggle on the '?' button rather than something
    // that fades away on its own — once it is gone you need a way back to it.
    // It still opens on first load and steps aside as soon as you start
    // playing, so the first thing on screen is not a wall of key bindings.
    this.helpBtn = el.querySelector('#helpbtn');
    this._helpOpen = true;
    this.helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHelp();
    });
    this._applyHelp();

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement && this._helpOpen && !this._helpPinned) {
        setTimeout(() => { if (!this._helpPinned) this.toggleHelp(false); }, 3500);
      }
    });
  }

  // force: true/false to set explicitly, omitted to flip
  toggleHelp(force) {
    this._helpOpen = force ?? !this._helpOpen;
    if (force === undefined) this._helpPinned = true; // the player asked for it
    this._applyHelp();
    return this._helpOpen;
  }

  _applyHelp() {
    this.hint.style.opacity = this._helpOpen ? '1' : '0';
    this.hint.style.display = this._helpOpen ? 'block' : 'none';
    this.helpBtn.classList.toggle('on', this._helpOpen);
  }

  banner(title, sub = '') {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerEl.style.opacity = '1';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { this.bannerEl.style.opacity = '0'; }, 2600);
  }

  // Project NPC speech bubbles to screen space, reusing a small element pool
  updateBubbles() {
    if (!this.npcs || !this.camera) return;
    const list = this.npcs.activeBubbles();
    while (this._bubblePool.length < list.length) {
      const d = document.createElement('div');
      d.className = 'bub';
      this.bubblesEl.appendChild(d);
      this._bubblePool.push(d);
    }
    for (let i = 0; i < this._bubblePool.length; i++) {
      const el = this._bubblePool[i];
      const b = list[i];
      if (!b) { el.style.display = 'none'; continue; }
      const v = b.pos.clone().project(this.camera);
      // Hide when behind the camera or far off-screen
      if (v.z > 1 || Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
      el.style.opacity = Math.min(1, b.timer).toFixed(2);
      if (el.textContent !== b.text) el.textContent = b.text;
    }
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toastEl.style.opacity = '0'; }, 2200);
  }

  setPrompt(text) {
    this.promptEl.style.display = text ? 'block' : 'none';
    if (text) this.promptEl.textContent = text;
  }

  floatXp(amount) {
    this.xpFloat.textContent = `+${amount} XP`;
    this.xpFloat.style.transition = 'none';
    this.xpFloat.style.bottom = '200px';
    this.xpFloat.style.opacity = '1';
    requestAnimationFrame(() => {
      this.xpFloat.style.transition = 'opacity 0.9s, bottom 1.2s';
      this.xpFloat.style.bottom = '250px';
      this.xpFloat.style.opacity = '0';
    });
  }

  update(dt = 1 / 60) {
    this.hpFill.style.width = `${(this.player.health / this.player.maxHealth) * 100}%`;
    this.mpFill.style.width = `${(this.player.mana / this.player.maxMana) * 100}%`;
    const t = this.sky.timeOfDay;
    const hh = Math.floor(t);
    const mm = Math.floor((t - hh) * 60);
    this.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

    if (this.spells) {
      const frac = this.spells.ult / this.spells.ultMax;
      this.ultFill.style.width = `${frac * 100}%`;
      this.ultBar.classList.toggle('ready', frac >= 1 && this.spells.ultActive <= 0);
    }
    if (this._counterTimer > 0) {
      this._counterTimer -= dt;
      this.counterFlash.style.opacity = Math.min(1, this._counterTimer * 2.2);
    } else {
      this.counterFlash.style.opacity = 0;
    }

    if (this._vignetteTimer > 0) {
      this._vignetteTimer -= dt;
      this.vignette.style.opacity = Math.min(1, this._vignetteTimer * 2.5);
    } else {
      this.vignette.style.opacity = 0;
    }
    if (this.collectibles) {
      this.shardCount.textContent = `${this.collectibles.collected} / ${this.collectibles.total}`;
    }
    this.updateBubbles();

    const b = this.boss;
    const bossActive = b && !b.removed && b.state !== 'dormant';
    this.bossBar.style.display = bossActive ? 'block' : 'none';
    if (bossActive) {
      this.bossFill.style.width = `${b.healthFrac * 100}%`;
      this.bossBar.classList.toggle('phase2', b.phase === 2);
      this.bossPhase.textContent = b.finisherReady ? 'BROKEN'
        : b.phase === 2 ? 'ENRAGED — SECOND PHASE' : '';
    }
    this.finisherEl.style.display =
      b && b.finisherReady && !b.finisherPlaying && !b.dead ? 'block' : 'none';

    if (this.progression) {
      const p = this.progression;
      this.levelBadge.textContent = p.points > 0 ? `LV ${p.level}  ·  ${p.points} ✦` : `LV ${p.level}`;
    }
    this.flightBadge.style.opacity = this.player.flying ? '0.9' : '0';

    if (this.spells) {
      this.slotPush.classList.toggle('cooling', this.spells.pushCooldown > 0);
      this.slotEmber.classList.toggle('cooling', this.spells.emberCooldown > 0);
      this.slotFrost.classList.toggle('cooling', this.spells.frostCooldown > 0);
      // A karma slot appears the moment the run qualifies for it. They are
      // mutually exclusive in practice: taking the dark path costs the purity
      // the bright one is measured by.
      const k = this.spells.karma;
      this.slotOath.style.display = k && !k.outlawed && k.purity > 0.55 ? 'flex' : 'none';
      this.slotTithe.style.display = k && k.sin01 >= 0.33 ? 'flex' : 'none';
      this.slotOath.classList.toggle('cooling',
        this.spells.oathCooldown > 0 || !this.spells.oathlightReady);
      this.slotTithe.classList.toggle('cooling', this.spells.tetheCooldown > 0);

      // Lock-on reticle projected over the target, with a health plate above
      // it — without one every fight but the boss is fought blind.
      const t = this.spells.lockTarget;
      const onScreen = t && !t.dead && this.camera && this._projectTarget(t);
      this.lockonEl.style.display = onScreen ? 'block' : 'none';
      // The boss carries its own banner; a second bar would just be noise
      const plate = onScreen && !t.isBoss;
      this.targetEl.style.display = plate ? 'block' : 'none';
      if (onScreen) {
        const v = this._targetPos;
        this.lockonEl.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
        this.lockonEl.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
      }
      if (plate) this._drawTargetPlate(t);
    }

    // Standing only appears once there is something to answer for
    const k = this.karma;
    if (k) {
      const show = k.infamy > 0.5 || k.virtue > 0.5;
      this.karmaEl.style.display = show ? 'block' : 'none';
      if (show) {
        this.karmaSin.style.width = `${k.infamy01 * 100}%`;
        this.karmaGood.style.width = `${k.virtue01 * 100}%`;
        this.karmaEl.classList.toggle('outlawed', k.outlawed);
        this.karmaStanding.textContent = k.tier.label;
      }
    }
  }

  // Projects the target into NDC in _targetPos. False when it is behind us.
  _projectTarget(t) {
    this._targetPos.copy(t.position).project(this.camera);
    return this._targetPos.z < 1;
  }

  _drawTargetPlate(t) {
    const el = this.targetEl;
    // Anchor in world space, above the head, so the plate keeps its distance
    // from the target as you close in rather than drifting across it
    const v = this._platePos.copy(t.position);
    v.y += t.isGolem ? 4.0 : 1.15;
    v.project(this.camera);
    el.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
    const frac = Math.max(0, Math.min(1, t.hp / (t.maxHp || 1)));
    this.targetFill.style.width = `${frac * 100}%`;
    if (this._targetRef !== t) {
      this._targetRef = t;
      this.targetName.textContent = t.displayName ?? (t.isGolem ? 'STONE GOLEM' : 'WISP FIEND');
    }
    const burning = t.burnTimer > 0;
    const frozen = t.frozenTimer > 0;
    el.classList.toggle('burning', burning && !frozen);
    el.classList.toggle('frozen', frozen);
    // Frost matters most: it is what strips a golem's armour
    this.targetState.textContent = frozen ? 'FROZEN'
      : burning ? 'BURNING'
      : t.staggerTimer > 0 ? 'STAGGERED' : '';
  }
}
