// Two gauges that remember how you have treated the people of the valley.
//
// Infamy (悪行) rises when you raise a wand against someone who never drew on
// you. Virtue (善行) rises from the work the valley actually wanted done —
// fiends cleared, quests finished, the ring relit. Virtue is not a separate
// score to admire: it is spent, slowly and automatically, burning infamy back
// down. Small cruelties can be worked off.
//
// Past OUTLAW_AT they cannot. Crossing that line latches `outlawed` and saves
// it: from then on the students and villagers draw on sight, for good. The
// point of the system is that there is a line, and that it is possible to
// cross it without meaning to and not be able to take it back.

const KEY = 'veilspire.karma.v1';
const OUTLAW_AT = 60;

// Ordered worst-last; `tier` returns the first one infamy falls under.
const TIERS = [
  { at: 20, name: 'clear', label: '' },
  { at: 40, name: 'suspect', label: 'WHISPERED ABOUT' },
  { at: OUTLAW_AT, name: 'feared', label: 'FEARED' },
  { at: Infinity, name: 'outlawed', label: 'OUTLAWED' },
];

export class Karma {
  constructor() {
    this.infamy = 0;
    this.virtue = 0;
    // The worst you have ever been, which atonement does not erase. Two
    // mutually exclusive spells hang off this: the bright one is strongest for
    // a run with no stain on it at all, so washing infamy off afterwards is
    // not the same as never having earned it.
    this.peakInfamy = 0;
    this.outlawed = false;
    this.onTierChange = null;
    this.onOutlawed = null;
    this.onChange = null;
    this._load();
    this._tier = this.tier.name;
  }

  get tier() {
    if (this.outlawed) return TIERS[TIERS.length - 1];
    return TIERS.find((t) => this.infamy < t.at);
  }

  get infamy01() { return Math.min(1, this.infamy / 100); }
  get virtue01() { return Math.min(1, this.virtue / 100); }

  // 1.0 only for a run that never hurt anyone; the first cruelty dents it
  // permanently and it never comes back.
  get purity() { return Math.max(0, 1 - this.peakInfamy / OUTLAW_AT); }
  // How far down the other road you have gone.
  get sin01() { return this.outlawed ? 1 : Math.min(1, this.peakInfamy / OUTLAW_AT); }
  // How close the next stroke of cruelty is to being unforgivable
  get toOutlaw01() { return this.outlawed ? 1 : Math.min(1, this.infamy / OUTLAW_AT); }

  // Hostility is the latched flag, never the live gauge: once the valley has
  // decided you are a danger, walking it back is not on the table.
  get hostile() { return this.outlawed; }

  sin(amount, reason = '') {
    if (this.outlawed) return;
    this.infamy = Math.min(100, this.infamy + amount);
    this.peakInfamy = Math.max(this.peakInfamy, this.infamy);
    this._settle(reason);
  }

  praise(amount, reason = '') {
    this.virtue = Math.min(100, this.virtue + amount);
    this._settle(reason);
  }

  // Oathlight is paid for in virtue: the light you spend is light you are no
  // longer carrying, so the bright path has a resource to manage too.
  spendVirtue(amount) {
    if (this.virtue < amount) return false;
    this.virtue -= amount;
    this._settle('spent');
    return true;
  }

  update(dt) {
    // Atonement: virtue is consumed to wear infamy down, so a run of good
    // work genuinely clears a bad afternoon — right up until it can't.
    if (!this.outlawed && this.virtue > 0 && this.infamy > 0) {
      const burn = Math.min(this.virtue, dt * 1.6);
      this.virtue -= burn;
      this.infamy = Math.max(0, this.infamy - burn * 0.8);
      this._settle();
    }
  }

  _settle(reason = '') {
    if (!this.outlawed && this.infamy >= OUTLAW_AT) {
      this.outlawed = true;
      this.onOutlawed?.(reason);
    }
    const t = this.tier.name;
    if (t !== this._tier) {
      const prev = this._tier;
      this._tier = t;
      this.onTierChange?.(this.tier, prev);
    }
    this.onChange?.(this);
    this._save();
  }

  _save() {
    // Throttled: _settle runs every frame while atoning
    this._saveTimer = (this._saveTimer ?? 0) + 1;
    if (this._saveTimer % 60 && !this.outlawed) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        infamy: this.infamy, virtue: this.virtue,
        peakInfamy: this.peakInfamy, outlawed: this.outlawed,
      }));
    } catch { /* private browsing — the gauges just won't persist */ }
  }

  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!raw) return;
      this.infamy = raw.infamy ?? 0;
      this.virtue = raw.virtue ?? 0;
      this.peakInfamy = raw.peakInfamy ?? this.infamy;
      this.outlawed = !!raw.outlawed;
    } catch { /* corrupt save — start clean */ }
  }

  reset() {
    this.infamy = 0;
    this.virtue = 0;
    this.peakInfamy = 0;
    this.outlawed = false;
    this._tier = this.tier.name;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    this.onChange?.(this);
  }
}
