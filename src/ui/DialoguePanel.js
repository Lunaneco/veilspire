// Renders whatever the DialogueRunner emits: speaker, line, and the choices
// that passed their conditions. Number keys pick options; Esc backs out.

export class DialoguePanel {
  constructor(container, runner, input) {
    this.runner = runner;
    this.input = input;

    const el = document.createElement('div');
    el.innerHTML = `
      <style>
        #dlg { position: absolute; left: 50%; bottom: 110px; transform: translateX(-50%);
          width: min(620px, 90vw); background: rgba(8,12,22,0.9);
          border: 1px solid rgba(190,210,235,0.35); border-radius: 12px; padding: 18px 22px;
          color: #dce8f5; font-family: Georgia, serif; display: none;
          box-shadow: 0 10px 46px rgba(0,0,0,0.65); }
        #dlg .sp { color: #c9a24a; font-size: 13px; letter-spacing: 2.5px; margin-bottom: 7px; }
        #dlg .tx { font-size: 15px; line-height: 1.7; margin-bottom: 14px; }
        #dlg .ch { display: flex; flex-direction: column; gap: 7px; }
        #dlg .op { padding: 9px 13px; border-radius: 8px; cursor: pointer; font-size: 14px;
          border: 1px solid rgba(190,210,235,0.3); background: rgba(40,60,90,0.32);
          transition: background 0.14s, border-color 0.14s; }
        #dlg .op:hover { background: rgba(75,110,165,0.5); border-color: rgba(200,225,255,0.6); }
        #dlg .op .k { color: #ffd27a; margin-right: 9px; }
        #dlg .hint { margin-top: 10px; font-size: 11.5px; color: #7f93ad; letter-spacing: 1px; }
      </style>
      <div id="dlg">
        <div class="sp"></div><div class="tx"></div><div class="ch"></div>
        <div class="hint">1–9 choose &nbsp;·&nbsp; Esc leave</div>
      </div>
    `;
    container.appendChild(el);
    this.el = el.querySelector('#dlg');
    this.spEl = el.querySelector('.sp');
    this.txEl = el.querySelector('.tx');
    this.chEl = el.querySelector('.ch');

    runner.onNode = (node, choices) => this.show(node, choices);
    runner.onEnd = () => { this.el.style.display = 'none'; };
  }

  show(node, choices) {
    this.el.style.display = 'block';
    this.spEl.textContent = node.speaker ?? '';
    this.txEl.textContent = node.text ?? '';
    this.chEl.innerHTML = '';
    this._count = choices.length;
    choices.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'op';
      d.innerHTML = `<span class="k">${i + 1}</span>${c.label}`;
      d.onclick = () => this.runner.choose(i);
      this.chEl.appendChild(d);
    });
    if (!choices.length) {
      const d = document.createElement('div');
      d.className = 'op';
      d.innerHTML = '<span class="k">1</span>Continue';
      d.onclick = () => this.runner.end();
      this.chEl.appendChild(d);
      this._count = 1;
      this._terminal = true;
    } else {
      this._terminal = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  update() {
    if (!this.runner.active) return;
    if (this.input.wasPressed('Escape')) { this.runner.end(); return; }
    for (let i = 0; i < Math.min(this._count ?? 0, 9); i++) {
      if (this.input.wasPressed(`Digit${i + 1}`)) {
        if (this._terminal) this.runner.end();
        else this.runner.choose(i);
        return;
      }
    }
  }
}
