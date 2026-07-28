import { TALENTS } from '../systems/Progression.js';
import { ITEMS, RECIPES } from '../systems/Inventory.js';

// 'I' opens the character sheet: level, XP, talent trees, shard tally.
// Clicking an unlocked node spends a point and immediately changes gameplay.

export class CharacterPanel {
  constructor(container, progression, player, collectibles, input, inventory = null) {
    this.prog = progression;
    this.player = player;
    this.collectibles = collectibles;
    this.input = input;
    this.inventory = inventory;
    this.open = false;

    const el = document.createElement('div');
    el.innerHTML = `
      <style>
        #charpanel { position: absolute; inset: 0; display: none; align-items: center;
          justify-content: center; background: rgba(4,7,14,0.72); font-family: Georgia, serif;
          pointer-events: auto; backdrop-filter: blur(3px); }
        #charsheet { width: min(860px, 92vw); max-height: 86vh; overflow-y: auto;
          background: linear-gradient(180deg, rgba(18,24,38,0.97), rgba(11,15,25,0.97));
          border: 1px solid rgba(190,210,235,0.35); border-radius: 16px; padding: 26px 30px;
          color: #dce8f5; box-shadow: 0 20px 70px rgba(0,0,0,0.7); }
        #charsheet h2 { font-size: 20px; letter-spacing: 7px; font-variant: small-caps;
          color: #e8f0fa; margin-bottom: 4px; font-weight: normal; }
        .subline { font-size: 13px; color: #8fa6c4; letter-spacing: 1px; margin-bottom: 16px; }
        .xpwrap { height: 10px; border-radius: 6px; background: rgba(10,14,24,0.8);
          border: 1px solid rgba(190,210,235,0.3); overflow: hidden; margin-bottom: 6px; }
        .xpwrap .fill { height: 100%; background: linear-gradient(180deg,#9fd8ff,#3f7fd0); }
        .pts { color: #ffd27a; font-size: 14px; letter-spacing: 1px; margin: 12px 0 16px; }
        .trees { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .tree { background: rgba(255,255,255,0.03); border: 1px solid rgba(190,210,235,0.18);
          border-radius: 12px; padding: 14px; }
        .tree h3 { font-size: 13px; letter-spacing: 3px; color: #c9a24a; margin-bottom: 10px;
          font-weight: normal; }
        .node { border: 1px solid rgba(190,210,235,0.22); border-radius: 9px; padding: 9px 11px;
          margin-bottom: 9px; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
        .node:hover { background: rgba(90,130,190,0.22); border-color: rgba(190,220,255,0.5); }
        .node.maxed { opacity: 0.55; cursor: default; border-color: rgba(160,220,160,0.4); }
        .node.locked { opacity: 0.4; cursor: default; }
        .node .nm { font-size: 13.5px; color: #eaf2fb; display: flex;
          justify-content: space-between; align-items: baseline; gap: 10px; }
        .node .nm > span:first-child { flex: 1; }
        .node .ds { font-size: 11.5px; color: #93a8c4; margin-top: 3px; line-height: 1.45; }
        .node .rk { color: #ffd27a; font-size: 12px; white-space: nowrap; }
        .footer { margin-top: 18px; font-size: 12px; color: #7f93ad; letter-spacing: 1px;
          display: flex; justify-content: space-between; }
        .sechead { font-size: 12px; letter-spacing: 5px; color: #c9a24a; font-weight: normal;
          font-variant: small-caps; margin: 20px 0 10px; }
        .bag { display: flex; flex-wrap: wrap; gap: 9px; }
        .bag .it { display: flex; align-items: center; gap: 7px; padding: 7px 12px;
          border: 1px solid rgba(190,210,235,0.22); border-radius: 9px; font-size: 12.5px;
          background: rgba(255,255,255,0.03); }
        .bag .it .n { color: #ffd27a; }
        .bag .empty { color: #6f819a; font-size: 12.5px; font-style: italic; }
        .brews { display: flex; flex-wrap: wrap; gap: 9px; }
        .brew { padding: 8px 13px; border-radius: 9px; font-size: 12.5px; cursor: pointer;
          border: 1px solid rgba(190,210,235,0.25); background: rgba(90,130,190,0.16); }
        .brew:hover { background: rgba(90,130,190,0.34); }
        .brew.cant { opacity: 0.4; cursor: default; background: rgba(255,255,255,0.02); }
        .brew .req { color: #93a8c4; font-size: 11px; margin-top: 3px; }
      </style>
      <div id="charpanel"><div id="charsheet">
        <h2>character</h2>
        <div class="subline" id="cs-sub"></div>
        <div class="xpwrap"><div class="fill" id="cs-xp"></div></div>
        <div class="pts" id="cs-pts"></div>
        <div class="trees" id="cs-trees"></div>
        <h3 class="sechead">satchel</h3>
        <div class="bag" id="cs-bag"></div>
        <h3 class="sechead">brewing</h3>
        <div class="brews" id="cs-brews"></div>
        <div class="footer"><span id="cs-shards"></span><span>I / Esc — close</span></div>
      </div></div>
    `;
    container.appendChild(el);
    this.panel = el.querySelector('#charpanel');
    this.sub = el.querySelector('#cs-sub');
    this.xpFill = el.querySelector('#cs-xp');
    this.ptsEl = el.querySelector('#cs-pts');
    this.treesEl = el.querySelector('#cs-trees');
    this.shardsEl = el.querySelector('#cs-shards');
    this.bagEl = el.querySelector('#cs-bag');
    this.brewsEl = el.querySelector('#cs-brews');

    this.buildTrees();
  }

  buildTrees() {
    this.nodeEls = {};
    this.treesEl.innerHTML = '';
    for (const tree of Object.values(TALENTS)) {
      const t = document.createElement('div');
      t.className = 'tree';
      const h = document.createElement('h3');
      h.textContent = `${tree.glyph}  ${tree.label}`;
      t.appendChild(h);
      for (const node of tree.nodes) {
        const n = document.createElement('div');
        n.className = 'node';
        n.innerHTML = `<div class="nm"><span>${node.name}</span><span class="rk"></span></div>
                       <div class="ds">${node.desc}</div>`;
        n.onclick = () => {
          if (this.prog.spend(node.id)) this.refresh();
        };
        t.appendChild(n);
        this.nodeEls[node.id] = n;
      }
      this.treesEl.appendChild(t);
    }
  }

  refresh() {
    const p = this.prog;
    this.sub.textContent =
      `LEVEL ${p.level}   ·   ${p.xp} / ${p.xpForNext()} XP   ·   ` +
      `${Math.round(this.player.maxHealth)} HP   ·   ${Math.round(this.player.maxMana)} MANA`;
    this.xpFill.style.width = `${(p.xp / p.xpForNext()) * 100}%`;
    this.ptsEl.textContent = p.points > 0
      ? `${p.points} talent point${p.points > 1 ? 's' : ''} available`
      : 'No talent points available — defeat foes and find shards to advance.';
    for (const tree of Object.values(TALENTS)) {
      for (const node of tree.nodes) {
        const el = this.nodeEls[node.id];
        const rank = p.rank(node.id);
        el.querySelector('.rk').textContent = `${rank} / ${node.max}`;
        el.classList.toggle('maxed', rank >= node.max);
        el.classList.toggle('locked', rank < node.max && p.points <= 0);
      }
    }
    // Collection tally: everything the valley has to be found in it
    const parts = [];
    if (this.collectibles) {
      parts.push(`Shards ${this.collectibles.collected}/${this.collectibles.total}`);
    }
    if (this.caches) parts.push(`Caches ${this.caches.found}/${this.caches.total}`);
    if (this.equipment) {
      const c = this.equipment.collection;
      parts.push(`Gear ${c.owned}/${c.total}`);
    }
    this.shardsEl.textContent = parts.join('  ·  ');
    this.refreshBag();
  }

  refreshBag() {
    const inv = this.inventory;
    if (!inv) return;
    const ids = Object.keys(inv.slots);
    this.bagEl.innerHTML = ids.length
      ? ids.map((id) => {
          const it = ITEMS[id];
          const clickable = it.kind === 'potion' ? ' data-use="' + id + '"' : '';
          return `<div class="it"${clickable} title="${it.desc}${it.kind === 'potion' ? ' — click to drink' : ''}">
            <span>${it.glyph}</span><span>${it.name}</span><span class="n">×${inv.count(id)}</span></div>`;
        }).join('')
      : '<div class="empty">Empty — gather reagents out in the valley.</div>';
    for (const el of this.bagEl.querySelectorAll('[data-use]')) {
      el.style.cursor = 'pointer';
      el.onclick = () => { inv.use(el.dataset.use); this.refresh(); };
    }

    this.brewsEl.innerHTML = RECIPES.map((r) => {
      const can = inv.canBrew(r);
      const req = Object.entries(r.needs)
        .map(([id, n]) => `${ITEMS[id].name} ×${n} (have ${inv.count(id)})`).join(' · ');
      return `<div class="brew${can ? '' : ' cant'}" data-brew="${r.id}">
        <div>${ITEMS[r.id].glyph} Brew ${r.name}</div><div class="req">${req}</div></div>`;
    }).join('');
    for (const el of this.brewsEl.querySelectorAll('[data-brew]')) {
      el.onclick = () => {
        const recipe = RECIPES.find((r) => r.id === el.dataset.brew);
        if (inv.brew(recipe)) this.refresh();
      };
    }
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.panel.style.display = this.open ? 'flex' : 'none';
    if (this.open) {
      this.refresh();
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  update() {
    if (this.input.wasPressed('KeyI')) this.toggle();
    else if (this.open && this.input.wasPressed('Escape')) this.toggle(false);
  }
}
