// Items, potions and brewing. Reagents drop from the world; potions are
// brewed from them and drunk with the number keys.

export const ITEMS = {
  emberCap: { name: 'Ember Cap', glyph: '🍄', kind: 'reagent', desc: 'A mushroom that smoulders faintly.' },
  frostLeaf: { name: 'Frost Leaf', glyph: '🍃', kind: 'reagent', desc: 'Cold to the touch, even in summer.' },
  aetherDust: { name: 'Aether Dust', glyph: '✨', kind: 'reagent', desc: 'Ground from a spent shard.' },
  healPotion: {
    name: 'Draught of Mending', glyph: '❤', kind: 'potion', desc: 'Restores 60 health.',
    use: (player) => { player.health = Math.min(player.maxHealth, player.health + 60); },
  },
  manaPotion: {
    name: 'Wellspring Tonic', glyph: '✦', kind: 'potion', desc: 'Restores 70 mana.',
    use: (player) => { player.mana = Math.min(player.maxMana, player.mana + 70); },
  },
};

// Brewing recipes: reagents in, potion out
export const RECIPES = [
  { id: 'healPotion', name: 'Draught of Mending', needs: { emberCap: 2, aetherDust: 1 } },
  { id: 'manaPotion', name: 'Wellspring Tonic', needs: { frostLeaf: 2, aetherDust: 1 } },
];

export class Inventory {
  constructor(player) {
    this.player = player;
    this.slots = {};
    this.crowns = 60; // a small purse to start
    this.onChange = null;
    this.onMessage = null;
  }

  addCrowns(n) {
    this.crowns += n;
    this.onMessage?.(`+${n} crowns`);
  }

  count(id) { return this.slots[id] ?? 0; }

  add(id, n = 1) {
    if (!ITEMS[id]) return;
    this.slots[id] = this.count(id) + n;
    this.onChange?.();
    this.onMessage?.(`${ITEMS[id].name} ×${n}`);
  }

  remove(id, n = 1) {
    if (this.count(id) < n) return false;
    this.slots[id] -= n;
    if (this.slots[id] <= 0) delete this.slots[id];
    this.onChange?.();
    return true;
  }

  canBrew(recipe) {
    return Object.entries(recipe.needs).every(([id, n]) => this.count(id) >= n);
  }

  brew(recipe) {
    if (!this.canBrew(recipe)) return false;
    for (const [id, n] of Object.entries(recipe.needs)) this.remove(id, n);
    this.add(recipe.id, 1);
    return true;
  }

  use(id) {
    const item = ITEMS[id];
    if (!item?.use || this.count(id) <= 0) return false;
    item.use(this.player);
    this.remove(id, 1);
    this.onMessage?.(`Drank ${item.name}`);
    return true;
  }

  // Ordered list of potions for the quick-use keys
  potions() {
    return Object.keys(this.slots).filter((id) => ITEMS[id]?.kind === 'potion');
  }
}
