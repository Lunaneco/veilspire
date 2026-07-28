import { GEAR } from '../systems/Equipment.js';
import { ITEMS } from '../systems/Inventory.js';

// Mirefall's trader. Sell surplus reagents, buy draughts and gear.
const STOCK = ['healPotion', 'manaPotion', 'emberCap', 'frostLeaf', 'aetherDust'];
const PRICES = { healPotion: 45, manaPotion: 45, emberCap: 12, frostLeaf: 12, aetherDust: 30 };
const SELL_RATE = 0.5;

export class ShopPanel {
  constructor(container, inventory, equipment, player) {
    this.inv = inventory;
    this.gear = equipment;
    this.player = player;
    this.open = false;

    const el = document.createElement('div');
    el.innerHTML = `
      <style>
        #shop { position: absolute; inset: 0; display: none; align-items: center;
          justify-content: center; background: rgba(4,7,14,0.74); font-family: Georgia, serif;
          backdrop-filter: blur(3px); }
        #shopsheet { width: min(820px, 92vw); max-height: 86vh; overflow-y: auto;
          background: linear-gradient(180deg, rgba(24,20,14,0.97), rgba(14,11,8,0.97));
          border: 1px solid rgba(210,180,130,0.4); border-radius: 16px; padding: 24px 28px;
          color: #ecdfc8; box-shadow: 0 20px 70px rgba(0,0,0,0.7); }
        #shopsheet h2 { font-size: 19px; letter-spacing: 6px; font-variant: small-caps;
          font-weight: normal; color: #f0e2c4; }
        #shopsheet .purse { color: #ffd27a; font-size: 14px; letter-spacing: 1px; margin: 4px 0 16px; }
        #shopsheet h3 { font-size: 12px; letter-spacing: 4px; color: #c9a24a; font-weight: normal;
          font-variant: small-caps; margin: 16px 0 9px; }
        .row { display: flex; flex-wrap: wrap; gap: 9px; }
        .card { border: 1px solid rgba(210,180,130,0.25); border-radius: 10px; padding: 9px 13px;
          background: rgba(255,255,255,0.03); cursor: pointer; min-width: 168px;
          transition: background 0.15s, border-color 0.15s; }
        .card:hover { background: rgba(190,150,90,0.22); border-color: rgba(230,200,150,0.55); }
        .card.no { opacity: 0.4; cursor: default; }
        .card.on { border-color: rgba(150,220,160,0.7); background: rgba(90,150,100,0.18); }
        .card .t { font-size: 13.5px; display: flex; justify-content: space-between; gap: 10px; }
        .card .p { color: #ffd27a; white-space: nowrap; }
        .card .d { font-size: 11.5px; color: #b8a68a; margin-top: 3px; line-height: 1.45; }
        #shopsheet .foot { margin-top: 18px; font-size: 12px; color: #9a8a70;
          display: flex; justify-content: space-between; letter-spacing: 1px; }
      </style>
      <div id="shop"><div id="shopsheet">
        <h2>bramwell&rsquo;s wares</h2>
        <div class="purse"></div>
        <h3>draughts &amp; reagents</h3><div class="row buy"></div>
        <h3>sell from satchel</h3><div class="row sell"></div>
        <h3>wands</h3><div class="row wands"></div>
        <h3>amulets</h3><div class="row amulets"></div>
        <h3>robes</h3><div class="row robes"></div>
        <div class="foot"><span>Click to buy, sell or equip</span><span>F / Esc — leave</span></div>
      </div></div>
    `;
    container.appendChild(el);
    this.panel = el.querySelector('#shop');
    this.purse = el.querySelector('.purse');
    this.buyRow = el.querySelector('.row.buy');
    this.sellRow = el.querySelector('.row.sell');
    this.rows = {
      wand: el.querySelector('.row.wands'),
      amulet: el.querySelector('.row.amulets'),
      robe: el.querySelector('.row.robes'),
    };
  }

  card(title, price, desc, cls, onClick) {
    const d = document.createElement('div');
    d.className = `card ${cls}`;
    d.innerHTML = `<div class="t"><span>${title}</span><span class="p">${price}</span></div>` +
      (desc ? `<div class="d">${desc}</div>` : '');
    if (!cls.includes('no')) d.onclick = onClick;
    return d;
  }

  refresh() {
    this.purse.textContent = `${this.inv.crowns} crowns`;

    this.buyRow.innerHTML = '';
    for (const id of STOCK) {
      const it = ITEMS[id];
      const price = PRICES[id];
      const afford = this.inv.crowns >= price;
      this.buyRow.appendChild(this.card(
        `${it.glyph} ${it.name}`, `${price}c`, it.desc, afford ? '' : 'no',
        () => { this.inv.crowns -= price; this.inv.add(id, 1); this.refresh(); }));
    }

    this.sellRow.innerHTML = '';
    const held = Object.keys(this.inv.slots);
    if (!held.length) {
      this.sellRow.innerHTML = '<div class="d" style="color:#9a8a70">Nothing to sell.</div>';
    }
    for (const id of held) {
      const it = ITEMS[id];
      const price = Math.round((PRICES[id] ?? 10) * SELL_RATE);
      this.sellRow.appendChild(this.card(
        `${it.glyph} ${it.name} ×${this.inv.count(id)}`, `+${price}c`, '', '',
        () => {
          if (this.inv.remove(id, 1)) { this.inv.crowns += price; this.refresh(); }
        }));
    }

    for (const slot of ['wand', 'amulet', 'robe']) {
      const row = this.rows[slot];
      row.innerHTML = '';
      for (const [id, g] of Object.entries(GEAR)) {
        if (g.slot !== slot) continue;
        const owned = this.gear.owns(id);
        // Found-only pieces are never stocked; they appear here once you have
        // one, so the shop doubles as the place you re-equip them
        if (g.found && !owned) continue;
        const equipped = this.gear.equipped[slot] === id;
        const afford = this.inv.crowns >= g.price;
        const cls = equipped ? 'on' : (owned || afford) ? '' : 'no';
        const label = equipped ? 'equipped' : owned ? 'equip' : `${g.price}c`;
        row.appendChild(this.card(g.name, label, g.desc, cls, () => {
          if (owned) this.gear.equip(id);
          else this.gear.buy(id, this.inv);
          this.refresh();
        }));
      }
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
}
