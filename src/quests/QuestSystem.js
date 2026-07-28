// First quest loop: talk to Professor Maelis at the gate (F to interact),
// accept "Cull the Corruption" (slay 5 wisp-fiends), track progress, reward.

export class QuestSystem {
  constructor(container, player, npcs, input) {
    this.player = player;
    this.npcs = npcs;
    this.input = input;
    this.state = 'none'; // none -> offered -> active -> done -> rewarded
    this.kills = 0;
    this.required = 5;
    this.dialogOpen = false;

    const el = document.createElement('div');
    el.innerHTML = `
      <style>
        #interact { position: absolute; left: 50%; bottom: 180px; transform: translateX(-50%);
          color: #e8f0fa; background: rgba(10,14,24,0.7); padding: 8px 18px; border-radius: 8px;
          font-family: Georgia, serif; font-size: 15px; border: 1px solid rgba(190,210,235,0.3);
          display: none; letter-spacing: 0.5px; }
        #dialog { position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%);
          width: 520px; background: rgba(8,12,22,0.88); border: 1px solid rgba(190,210,235,0.35);
          border-radius: 12px; padding: 18px 22px; color: #dce8f5; font-family: Georgia, serif;
          display: none; box-shadow: 0 8px 40px rgba(0,0,0,0.6); }
        #dialog .speaker { color: #c9a24a; font-size: 14px; letter-spacing: 2px; margin-bottom: 6px; }
        #dialog .text { font-size: 15px; line-height: 1.65; margin-bottom: 12px; }
        #dialog .choices { display: flex; gap: 10px; }
        #dialog .choice { flex: 1; text-align: center; padding: 8px 10px; border-radius: 8px;
          border: 1px solid rgba(190,210,235,0.35); cursor: pointer; font-size: 14px;
          background: rgba(40,60,90,0.35); }
        #dialog .choice:hover { background: rgba(70,100,150,0.5); }
        #tracker { position: absolute; top: 70px; left: 28px; color: #dce8f5;
          font-family: Georgia, serif; font-size: 14px; background: rgba(8,12,22,0.55);
          padding: 10px 16px; border-radius: 10px; border: 1px solid rgba(190,210,235,0.25);
          display: none; }
        #tracker .qname { color: #c9a24a; letter-spacing: 1px; margin-bottom: 4px; }
      </style>
      <div id="interact">F &nbsp;—&nbsp; Speak with Professor Maelis</div>
      <div id="dialog">
        <div class="speaker">PROFESSOR MAELIS</div>
        <div class="text"></div>
        <div class="choices"></div>
      </div>
      <div id="tracker"><div class="qname">CULL THE CORRUPTION</div><div class="prog"></div></div>
    `;
    container.appendChild(el);
    this.interactEl = el.querySelector('#interact');
    this.dialogEl = el.querySelector('#dialog');
    this.dialogText = el.querySelector('#dialog .text');
    this.dialogChoices = el.querySelector('#dialog .choices');
    this.trackerEl = el.querySelector('#tracker');
    this.trackerProg = el.querySelector('#tracker .prog');
  }

  onEnemyKilled() {
    if (this.state !== 'active') return;
    this.kills++;
    if (this.kills >= this.required) this.state = 'done';
  }

  openDialog(text, choices) {
    this.dialogOpen = true;
    this.dialogEl.style.display = 'block';
    this.dialogText.textContent = text;
    this.dialogChoices.innerHTML = '';
    for (const c of choices) {
      const b = document.createElement('div');
      b.className = 'choice';
      b.textContent = c.label;
      b.onclick = () => { this.closeDialog(); c.action(); };
      this.dialogChoices.appendChild(b);
    }
  }

  closeDialog() {
    this.dialogOpen = false;
    this.dialogEl.style.display = 'none';
  }

  talk() {
    if (this.state === 'none' || this.state === 'offered') {
      this.state = 'offered';
      this.openDialog(
        'The veil thins, apprentice. Corrupted wisps gather at the forest’s edge — ' +
        'remnants of something older than this academy. Will you thin their number before nightfall?',
        [
          { label: 'I’ll handle it. (Accept)', action: () => { this.state = 'active'; } },
          { label: 'Not yet. (Decline)', action: () => {} },
        ]);
    } else if (this.state === 'active') {
      this.openDialog(
        `The wisps still linger — ${this.required - this.kills} more must fall. ` +
        'Strike true, and mind your ward.',
        [{ label: 'Understood.', action: () => {} }]);
    } else if (this.state === 'done') {
      this.openDialog(
        'The air is clearer already. You show promise — take this: your reserves of mana run deeper now.',
        [{
          label: 'Thank you, Professor.',
          action: () => {
            this.state = 'rewarded';
            this.player.maxMana += 25;
            this.player.mana = this.player.maxMana;
            this.onReward?.(150);
          },
        }]);
    } else {
      this.openDialog('The academy rests easier tonight. Go — the towers hold more secrets than one evening can spend.',
        [{ label: 'Farewell.', action: () => {} }]);
    }
  }

  // Conversations now run through DialogueTree; this system only owns the
  // objective tracker, so its own prompt and dialog stay hidden.
  update() {
    this.interactEl.style.display = 'none';
    this.dialogEl.style.display = 'none';

    if (this.state === 'active') {
      this.trackerEl.style.display = 'block';
      this.trackerProg.textContent = `Corrupted wisps slain: ${this.kills} / ${this.required}`;
    } else if (this.state === 'done') {
      this.trackerEl.style.display = 'block';
      this.trackerProg.textContent = 'Return to Professor Maelis';
    } else {
      this.trackerEl.style.display = 'none';
    }
  }
}
