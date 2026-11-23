const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', Space: 'jump', KeyW: 'jump', KeyZ: 'jump',
  ArrowDown: 'down', KeyS: 'down',
  KeyJ: 'attack', KeyX: 'attack',
  KeyK: 'dash', KeyC: 'dash',
  ShiftLeft: 'dash',
};

export class Input {
  constructor() {
    this.state = { left: false, right: false, jump: false, down: false, attack: false, dash: false };
    this.edge = { jump: false, attack: false, dash: false };
    this._prev = { jump: false, attack: false, dash: false };
    this.touch = { left: false, right: false, jump: false, attack: false, dash: false };
    globalThis.addEventListener?.('keydown', (e) => {
      const k = MAP[e.code];
      if (k) { if (!this.state[k]) this.edge[k] = true; this.state[k] = true; e.preventDefault(); }
      if (e.code === 'KeyM') this.onMute?.();
    });
    globalThis.addEventListener?.('keyup', (e) => {
      const k = MAP[e.code];
      if (k) { this.state[k] = false; e.preventDefault(); }
    });
    globalThis.addEventListener?.('blur', () => this.reset());
  }

  reset() {
    for (const k of Object.keys(this.state)) this.state[k] = false;
    for (const k of Object.keys(this.touch)) this.touch[k] = false;
  }

  /** Called once per simulation tick — returns an immutable-ish input snapshot. */
  poll() {
    const s = {
      left: this.state.left || this.touch.left,
      right: this.state.right || this.touch.right,
      jump: this.edge.jump || (this.touch.jump && !this._prevTouchJump),
      attack: this.edge.attack || (this.touch.attack && !this._prevTouchAttack),
      dash: this.edge.dash || (this.touch.dash && !this._prevTouchDash),
      down: this.state.down,
    };
    this.edge.jump = this.edge.attack = this.edge.dash = false;
    this._prevTouchJump = this.touch.jump;
    this._prevTouchAttack = this.touch.attack;
    this._prevTouchDash = this.touch.dash;
    return s;
  }

  bindTouch(root) {
    const add = (sel, key) => {
      for (const el of root.querySelectorAll(sel)) {
        const on = (e) => { e.preventDefault(); this.touch[key] = true; };
        const off = (e) => { e.preventDefault(); this.touch[key] = false; };
        el.addEventListener('touchstart', on, { passive: false });
        el.addEventListener('touchend', off, { passive: false });
        el.addEventListener('touchcancel', off, { passive: false });
        el.addEventListener('mousedown', on);
        el.addEventListener('mouseup', off);
        el.addEventListener('mouseleave', off);
      }
    };
    add('[data-touch="left"]', 'left');
    add('[data-touch="right"]', 'right');
    add('[data-touch="jump"]', 'jump');
    add('[data-touch="attack"]', 'attack');
    add('[data-touch="dash"]', 'dash');
  }
}
