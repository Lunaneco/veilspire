// A small node-graph dialogue system. Nodes carry text and choices; choices
// can be gated on world state and can fire effects (flags, rewards, quests).
// The runner keeps no UI of its own — DialoguePanel renders whatever it emits.

export class DialogueRunner {
  constructor(ctx) {
    this.ctx = ctx;        // { worldState, inventory, progression, quests, hud, equipment }
    this.tree = null;
    this.nodeId = null;
    this.onNode = null;    // (node, choices) => void
    this.onEnd = null;
  }

  get active() { return this.nodeId !== null; }

  start(tree, entry = 'start') {
    this.tree = tree;
    this.goto(this.resolveEntry(entry));
  }

  // An entry may be a function that picks a node from world state
  resolveEntry(entry) {
    return typeof entry === 'function' ? entry(this.ctx) : entry;
  }

  visibleChoices(node) {
    return (node.choices ?? []).filter((c) => !c.when || c.when(this.ctx));
  }

  goto(id) {
    const node = this.tree?.[id];
    if (!node) { this.end(); return; }
    this.nodeId = id;
    node.onEnter?.(this.ctx);
    const choices = this.visibleChoices(node);
    this.onNode?.(node, choices);
    // A node with no choices is terminal once acknowledged
    if (!choices.length) this._terminal = true;
    else this._terminal = false;
  }

  choose(index) {
    const node = this.tree?.[this.nodeId];
    if (!node) return;
    const choices = this.visibleChoices(node);
    const c = choices[index];
    if (!c) return;
    c.effect?.(this.ctx);
    if (c.next) this.goto(c.next);
    else this.end();
  }

  end() {
    this.nodeId = null;
    this.tree = null;
    this.onEnd?.();
  }
}

// ---------------------------------------------------------------------------
// Professor Maelis. Branches on what the player has actually done, and offers
// a second commission with a real choice about how to approach it.
export const MAELIS_TREE = {
  start: {
    speaker: 'PROFESSOR MAELIS',
    text: 'You walk quietly for someone who has been out past the wards. ' +
      'Speak plainly — what brings you to my gate?',
    choices: [
      { label: 'What are the wisps, really?', next: 'wisps' },
      {
        label: 'Is there work for me?',
        next: 'cullOffer',
        when: (c) => !c.worldState.has('questAccepted'),
      },
      {
        label: 'The wisps are thinned, as you asked.',
        next: 'cullDone',
        when: (c) => c.quests?.state === 'done' && !c.worldState.has('questDone'),
      },
      {
        label: 'You mentioned older work.',
        next: 'ringOffer',
        when: (c) => c.worldState.has('questDone') && !c.worldState.has('ringQuest'),
      },
      {
        label: 'The ring stones woke. I was there.',
        next: 'ringDone',
        when: (c) => c.worldState.has('ringAwakened') && !c.worldState.has('ringReported'),
      },
      {
        label: 'The Warden is dead.',
        next: 'wardenDead',
        when: (c) => c.worldState.has('bossFelled') && !c.worldState.has('wardenReported'),
      },
      { label: 'Nothing. Good day, Professor.', next: null },
    ],
  },

  cullOffer: {
    speaker: 'PROFESSOR MAELIS',
    text: 'Always. Corrupted wisps gather at the forest\'s edge — remnants of ' +
      'something older than this academy. Thin their number, five at least, ' +
      'and come back to me.',
    choices: [
      {
        label: 'I\'ll handle it.',
        next: 'cullAccept',
        effect: (c) => {
          c.worldState.set('questAccepted');
          if (c.quests) c.quests.state = 'active';
        },
      },
      { label: 'Find someone else.', next: null },
    ],
  },
  cullAccept: {
    speaker: 'PROFESSOR MAELIS',
    text: 'Good. Mind your ward — they strike from range, and they are patient.',
    choices: [{ label: 'Understood.', next: null }],
  },
  cullDone: {
    speaker: 'PROFESSOR MAELIS',
    text: 'The treeline is quiet again. You have a steadier hand than your ' +
      'record suggests. Your reserves should run deeper now — take it.',
    onEnter: (c) => {
      c.worldState.set('questDone');
      if (c.quests) c.quests.state = 'rewarded';
      c.player.maxMana += 25;
      c.player.mana = c.player.maxMana;
      c.inventory.addCrowns(120);
      c.progression.addXp(150, 'quest');
    },
    choices: [{ label: 'Thank you, Professor.', next: null }],
  },

  wisps: {
    speaker: 'PROFESSOR MAELIS',
    text: 'Residue. When a binding fails it leaves a hunger behind, and hunger ' +
      'finds a shape. The academy has been patching these wards for four hundred years.',
    choices: [
      { label: 'Patching? Not mending?', next: 'wispsTruth' },
      { label: 'I see. Thank you.', next: 'start' },
    ],
  },
  wispsTruth: {
    speaker: 'PROFESSOR MAELIS',
    text: 'Mending would mean knowing what was bound. The records for that year ' +
      'were burned — deliberately, I think. So: patching.',
    choices: [{ label: 'Unsettling.', next: 'start' }],
  },

  ringOffer: {
    speaker: 'PROFESSOR MAELIS',
    text: 'West of here, past the old treeline, there is a ring of standing stones ' +
      'the maps refuse to name. Something under it has begun to stir. ' +
      'I would have it looked at — carefully, or quickly. Your choice decides the risk.',
    choices: [
      {
        label: 'Carefully. I will study it first. (Safer, less reward)',
        next: 'ringAcceptCareful',
        effect: (c) => {
          c.worldState.set('ringQuest');
          c.worldState.ringApproach = 'careful';
        },
      },
      {
        label: 'Quickly. I will force it open. (Riskier, better reward)',
        next: 'ringAcceptBold',
        effect: (c) => {
          c.worldState.set('ringQuest');
          c.worldState.ringApproach = 'bold';
        },
      },
      { label: 'Not yet. Give me time.', next: null },
    ],
  },
  ringAcceptCareful: {
    speaker: 'PROFESSOR MAELIS',
    text: 'Sensible. Light the four braziers in sequence and let the stone answer ' +
      'in its own time. Take this — you will want the reserves.',
    onEnter: (c) => {
      c.inventory.add('manaPotion', 2);
      c.progression.addXp(60, 'dialogue');
    },
    choices: [{ label: 'I will report back.', next: null }],
  },
  ringAcceptBold: {
    speaker: 'PROFESSOR MAELIS',
    text: 'Reckless. I would have said the same at your age. Burn all four at once ' +
      'if you must — but do not be standing on the disc when it opens. ' +
      'Coin, then, since you will not take caution.',
    onEnter: (c) => {
      c.inventory.addCrowns(150);
      c.progression.addXp(60, 'dialogue');
    },
    choices: [{ label: 'Understood.', next: null }],
  },

  ringDone: {
    speaker: 'PROFESSOR MAELIS',
    text: 'You opened it. I felt the shift from the tower — every candle in the ' +
      'hall guttered at once. What did you find beneath the disc?',
    onEnter: (c) => c.worldState.set('ringReported'),
    choices: [
      {
        label: 'A lore stone. It is still glowing.',
        next: 'ringReward',
        effect: (c) => { c.worldState.ringHonest = true; },
      },
      {
        label: 'Nothing worth carrying back.',
        next: 'ringRewardLie',
        effect: (c) => { c.worldState.ringHonest = false; },
      },
    ],
  },
  ringReward: {
    speaker: 'PROFESSOR MAELIS',
    text: 'Then the records were not all burned. Bring it to me when you can bear ' +
      'to part with it. Until then — you have earned the academy\'s trust, and its purse.',
    onEnter: (c) => {
      c.inventory.addCrowns(300);
      c.progression.addXp(220, 'quest');
    },
    choices: [{ label: 'Thank you, Professor.', next: null }],
  },
  ringRewardLie: {
    speaker: 'PROFESSOR MAELIS',
    text: 'Hm. You are a poor liar, but you are our poor liar. Keep whatever you ' +
      'found. I will settle for knowing the seal held.',
    onEnter: (c) => {
      c.inventory.addCrowns(120);
      c.progression.addXp(160, 'quest');
    },
    choices: [{ label: 'Good day, Professor.', next: null }],
  },

  wardenDead: {
    speaker: 'PROFESSOR MAELIS',
    text: 'The Warden. Older than these walls, and you brought it down in an evening. ' +
      'I am not certain whether to award you marks or to be afraid of you.',
    onEnter: (c) => {
      c.worldState.set('wardenReported');
      c.inventory.addCrowns(400);
      c.progression.addXp(300, 'quest');
    },
    choices: [
      { label: 'It attacked first.', next: 'wardenAfter' },
      { label: 'Be afraid. It is safer.', next: 'wardenAfter' },
    ],
  },
  wardenAfter: {
    speaker: 'PROFESSOR MAELIS',
    text: 'Then we are agreed on the important part. Rest. The valley will keep ' +
      'its remaining secrets until morning.',
    choices: [{ label: 'Goodnight, Professor.', next: null }],
  },
};
