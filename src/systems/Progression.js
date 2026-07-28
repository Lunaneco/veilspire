// Character progression: XP, levels, and three talent trees whose nodes feed
// live multipliers read by combat and movement. Persisted to localStorage.

export const TALENTS = {
  attack: {
    label: 'EVOCATION',
    glyph: '✦',
    nodes: [
      { id: 'atk1', name: 'Sharpened Bolt', desc: 'Arc Bolt damage +20%', max: 3 },
      { id: 'atk2', name: 'Ember Reach', desc: 'Ember Burst radius +15%', max: 2 },
      { id: 'atk3', name: 'Deep Frost', desc: 'Freeze duration +0.8s', max: 2 },
    ],
  },
  ward: {
    label: 'ABJURATION',
    glyph: '◈',
    nodes: [
      { id: 'wrd1', name: 'Stone Skin', desc: 'Max health +20', max: 3 },
      { id: 'wrd2', name: 'Deep Well', desc: 'Mana regen +40%', max: 3 },
      { id: 'wrd3', name: 'Iron Ward', desc: 'Ward mana cost −30%', max: 2 },
    ],
  },
  explore: {
    label: 'WAYFARING',
    glyph: '❋',
    nodes: [
      { id: 'exp1', name: 'Swift Step', desc: 'Sprint speed +12%', max: 2 },
      { id: 'exp2', name: 'Updraft', desc: 'Flight speed +25%', max: 2 },
      { id: 'exp3', name: 'Shard Sense', desc: 'Shards grant +10 max mana', max: 2 },
    ],
  },
};

const SAVE_KEY = 'veilspire.progress.v1';

export class Progression {
  constructor(player) {
    this.player = player;
    this.level = 1;
    this.xp = 0;
    this.points = 0;
    this.ranks = {};
    for (const tree of Object.values(TALENTS)) {
      for (const n of tree.nodes) this.ranks[n.id] = 0;
    }
    this.onLevelUp = null;
    this.onXp = null;
    this.load();
    this.apply();
  }

  xpForNext() {
    return Math.round(80 * Math.pow(1.35, this.level - 1));
  }

  rank(id) { return this.ranks[id] ?? 0; }

  addXp(amount, reason = '') {
    this.xp += amount;
    let levelled = false;
    while (this.xp >= this.xpForNext()) {
      this.xp -= this.xpForNext();
      this.level++;
      this.points++;
      levelled = true;
    }
    this.onXp?.(amount, reason);
    if (levelled) {
      this.apply();
      this.onLevelUp?.(this.level);
    }
    this.save();
  }

  spend(id) {
    const node = this.findNode(id);
    if (!node || this.points <= 0 || this.ranks[id] >= node.max) return false;
    this.ranks[id]++;
    this.points--;
    this.apply();
    this.save();
    return true;
  }

  findNode(id) {
    for (const tree of Object.values(TALENTS)) {
      const n = tree.nodes.find((x) => x.id === id);
      if (n) return n;
    }
    return null;
  }

  // Recompute the multipliers gameplay systems read each frame
  apply() {
    const r = (id) => this.rank(id);
    this.mods = {
      boltDamage: 1 + 0.20 * r('atk1'),
      emberRadius: 1 + 0.15 * r('atk2'),
      freezeBonus: 0.8 * r('atk3'),
      bonusHealth: 20 * r('wrd1'),
      manaRegen: 1 + 0.40 * r('wrd2'),
      wardCost: 1 - 0.30 * r('wrd3'),
      sprintSpeed: 1 + 0.12 * r('exp1'),
      flightSpeed: 1 + 0.25 * r('exp2'),
      shardMana: 5 + 10 * r('exp3'),
      // Levels themselves grant a little baseline power
      levelHealth: (this.level - 1) * 6,
    };
    // Gear multiplies on top of talents
    const g = this.equipment?.mods;
    if (g) {
      this.mods.boltDamage *= g.boltDamage;
      this.mods.manaRegen *= g.manaRegen;
      this.mods.wardCost *= g.wardCost;
      this.mods.freezeBonus += g.freezeBonus;
    }
    const p = this.player;
    const newMax = 100 + this.mods.bonusHealth + this.mods.levelHealth;
    const delta = newMax - p.maxHealth;
    p.maxHealth = newMax;
    if (delta > 0) p.health = Math.min(newMax, p.health + delta);
    p.mods = this.mods;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        level: this.level, xp: this.xp, points: this.points, ranks: this.ranks,
      }));
    } catch { /* storage unavailable — progression stays in-memory */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.level = d.level ?? 1;
      this.xp = d.xp ?? 0;
      this.points = d.points ?? 0;
      Object.assign(this.ranks, d.ranks ?? {});
    } catch { /* corrupt save — start fresh */ }
  }

  reset() {
    this.level = 1; this.xp = 0; this.points = 0;
    for (const k of Object.keys(this.ranks)) this.ranks[k] = 0;
    this.apply();
    this.save();
  }
}
