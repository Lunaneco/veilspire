// Wands, amulets and robes. Wands and amulets feed the same mods pipeline the
// talent tree uses; robes are cosmetic but genuinely restyle the character.

export const GEAR = {
  // --- wands: spell damage ---
  wandAsh: { slot: 'wand', name: 'Ashwood Wand', price: 0, desc: 'Academy issue.', boltDamage: 1.0 },
  wandElm: { slot: 'wand', name: 'Elm Wand', price: 140, desc: 'Arc Bolt damage +15%.', boltDamage: 1.15 },
  wandYew: { slot: 'wand', name: 'Yew Wand', price: 380, desc: 'Arc Bolt damage +35%.', boltDamage: 1.35 },
  wandVeil: {
    slot: 'wand', name: 'Veilwood Wand', price: 900,
    desc: 'Arc Bolt damage +60%, freeze +0.5s.', boltDamage: 1.6, freezeBonus: 0.5,
  },
  // --- amulets: mana and ward ---
  amuletNone: { slot: 'amulet', name: 'No Amulet', price: 0, desc: '' },
  amuletBrass: { slot: 'amulet', name: 'Brass Sigil', price: 120, desc: 'Mana regen +25%.', manaRegen: 1.25 },
  amuletTide: { slot: 'amulet', name: 'Tidestone', price: 320, desc: 'Ward cost −25%.', wardCost: 0.75 },
  amuletAether: {
    slot: 'amulet', name: 'Aether Locket', price: 780,
    desc: 'Mana regen +40%, ward cost −20%.', manaRegen: 1.4, wardCost: 0.8,
  },
  // --- robes: cosmetic ---
  robeNavy: { slot: 'robe', name: 'Navy Robes', price: 0, desc: 'Academy blue.', robe: 0x27314f, trim: 0xb08a3e },
  robeCrimson: { slot: 'robe', name: 'Crimson Robes', price: 90, desc: 'Deep red with gold.', robe: 0x54202a, trim: 0xd0a95a },
  robeMoss: { slot: 'robe', name: 'Moss Robes', price: 90, desc: 'Forest green with copper.', robe: 0x24402e, trim: 0xb07a3a },
  robeAsh: { slot: 'robe', name: 'Ashen Robes', price: 220, desc: 'Storm grey with silver.', robe: 0x33363d, trim: 0xc0c6cf },
  robeVoid: { slot: 'robe', name: 'Voidsilk Robes', price: 640, desc: 'Black shot with violet.', robe: 0x1c1626, trim: 0x8a5ad0 },

  // --- found only: no price, never stocked. These exist to make the map
  // worth searching, so they are strictly better than anything on the shelf
  // and can only come out of a cache or off a body.
  wandHollow: {
    slot: 'wand', name: 'Hollowbough Wand', found: true,
    desc: 'Cut from the Warden. Arc Bolt +75%, freeze +0.8s.',
    boltDamage: 1.75, freezeBonus: 0.8,
  },
  amuletEmber: {
    slot: 'amulet', name: 'Emberglass Charm', found: true,
    desc: 'Warm to hold. Mana regen +55%.', manaRegen: 1.55,
  },
  amuletWarden: {
    slot: 'amulet', name: "Warden's Knot", found: true,
    desc: 'Ward cost −40%, mana regen +15%.', wardCost: 0.6, manaRegen: 1.15,
  },
  robeStorm: {
    slot: 'robe', name: 'Stormweave Robes', found: true,
    desc: 'Slate shot through with lightning.', robe: 0x1e2836, trim: 0x7ec8e8,
  },
  robeThorn: {
    slot: 'robe', name: 'Thornwood Robes', found: true,
    desc: 'Bramble-dyed, still smells of the deep wood.', robe: 0x2a2118, trim: 0x9a7a3a,
  },
};

const SAVE_KEY = 'veilspire.gear.v1';

export class Equipment {
  constructor(player) {
    this.player = player;
    this.owned = new Set(['wandAsh', 'amuletNone', 'robeNavy']);
    this.equipped = { wand: 'wandAsh', amulet: 'amuletNone', robe: 'robeNavy' };
    this.onRobeChange = null;
    this.onFound = null;
    this.load();
  }

  owns(id) { return this.owned.has(id); }

  buy(id, inventory) {
    const g = GEAR[id];
    if (!g || this.owns(id) || inventory.crowns < g.price) return false;
    inventory.crowns -= g.price;
    this.owned.add(id);
    this.equip(id);
    this.save();
    return true;
  }

  // Gear that comes out of the world rather than off a shelf. Returns false
  // for a duplicate so the caller can pay out something else instead.
  grant(id) {
    if (!GEAR[id] || this.owns(id)) return false;
    this.owned.add(id);
    this.save();
    this.onFound?.(GEAR[id], id);
    return true;
  }

  // Collection progress, for the character sheet
  get collection() {
    const ids = Object.keys(GEAR);
    return { owned: ids.filter((id) => this.owns(id)).length, total: ids.length };
  }

  equip(id) {
    const g = GEAR[id];
    if (!g || !this.owns(id)) return false;
    this.equipped[g.slot] = id;
    if (g.slot === 'robe') this.onRobeChange?.(g);
    this.save();
    return true;
  }

  // Multipliers contributed by gear, merged into player.mods by Progression
  get mods() {
    const out = { boltDamage: 1, manaRegen: 1, wardCost: 1, freezeBonus: 0 };
    for (const id of Object.values(this.equipped)) {
      const g = GEAR[id];
      if (!g) continue;
      if (g.boltDamage) out.boltDamage *= g.boltDamage;
      if (g.manaRegen) out.manaRegen *= g.manaRegen;
      if (g.wardCost) out.wardCost *= g.wardCost;
      if (g.freezeBonus) out.freezeBonus += g.freezeBonus;
    }
    return out;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        owned: [...this.owned], equipped: this.equipped,
      }));
    } catch { /* storage unavailable */ }
  }

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
      if (!d) return;
      this.owned = new Set(d.owned ?? [...this.owned]);
      Object.assign(this.equipped, d.equipped ?? {});
    } catch { /* corrupt save */ }
  }
}
