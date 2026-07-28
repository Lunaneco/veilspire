// What the valley remembers about the player. NPC dialogue reads these flags,
// so the world comments on what you have actually done.

export class WorldState {
  constructor() {
    this.flags = {
      questAccepted: false,
      questDone: false,
      ringAwakened: false,
      bossFelled: false,
      chestLooted: false,
    };
    this.shardsFound = 0;
    this.wispsSlain = 0;
  }

  set(flag, value = true) { this.flags[flag] = value; }
  has(flag) { return !!this.flags[flag]; }

  // A short label for the player's current standing, used to pick greetings
  get standing() {
    if (this.flags.bossFelled) return 'hero';
    if (this.flags.ringAwakened || this.flags.questDone) return 'known';
    if (this.wispsSlain > 0) return 'noticed';
    return 'stranger';
  }
}
