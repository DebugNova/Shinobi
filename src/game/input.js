// Input: keyboard + mouse (pointer lock) and gamepad (Xbox layout), hot-swappable. Buttons become named actions
// with press timestamps, so the fighter can buffer them (an attack pressed 120 ms before the current move ends
// still comes out). The controller asks `take(action, window)`; held states come from `held(action)`.

const KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'dash', ShiftRight: 'dash', KeyF: 'charge', Digit1: 'tool', KeyQ: 'jutsu1', KeyE: 'jutsu2', KeyG: 'jutsu3',
  KeyR: 'ult', KeyT: 'lock', Tab: 'score', KeyC: 'guard', KeyV: 'heavy',
};
const MOUSE = { 0: 'attack', 1: 'lock', 2: 'guard' };
// gamepad buttons (standard mapping)
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11 };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set(); // held actions (keyboard/mouse)
    this.padDown = new Set(); // held actions (gamepad)
    this.presses = new Map(); // action -> time of the last press (s, performance clock); consumed by take()
    this.downAt = new Map(); // action -> when it went down (not consumed: held durations)
    this.releases = new Map();
    this.lookX = 0; // accumulated look delta (radians-ish units, scaled by sensitivity at read)
    this.lookY = 0;
    this.wheel = 0;
    this.zoom = 0; // accumulated wheel in notches (+ = scroll down = zoom out), fractional for trackpads
    this.sens = 1;
    this.invertY = false;
    this.locked = false;
    this.enabled = false;
    this.device = 'kbm';
    this.onPause = null;
    this.onKey = null; // (code) => handled, for UI keys (F3, F4...)
    this.pad = { x: 0, y: 0, lx: 0, ly: 0, buttons: [] };
    this._padPrev = [];

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') return; // handled on keyup/pointerlockchange (browsers eat the first Esc)
      if (this.onKey?.(e.code, e)) return;
      const a = KEYS[e.code];
      if (!a || !this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.press(a);
      this.down.add(a);
      this.device = 'kbm';
    });
    addEventListener('keyup', (e) => {
      const a = KEYS[e.code];
      if (a) {
        this.down.delete(a);
        this.releases.set(a, now());
      }
      if (e.code === 'Escape' && this.enabled) this.onPause?.();
    });
    addEventListener('blur', () => {
      this.down.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) {
        this.lock();
        return;
      }
      const a = MOUSE[e.button];
      if (a) {
        this.press(a);
        this.down.add(a);
      }
      this.device = 'kbm';
    });
    addEventListener('mouseup', (e) => {
      const a = MOUSE[e.button];
      if (a) {
        this.down.delete(a);
        this.releases.set(a, now());
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Chrome occasionally reports a huge jump right after locking: ignore outliers
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
      // one mouse notch ~ 100 px (Chrome/Edge) or 3 lines (Firefox); trackpads send many small deltas
      const n = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : e.deltaY / 100;
      this.zoom += Math.max(-1.5, Math.min(1.5, n));
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      // losing the lock (Esc, alt-tab) opens the pause menu; not under automation (tests switch tabs)
      if (was && !this.locked && this.enabled && !navigator.webdriver) this.onPause?.();
    });
  }

  lock() {
    try {
      const r = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      // no unadjusted movement on this platform: plain lock (and swallow the no-gesture refusal of autojoin)
      r?.catch?.(() => this.canvas.requestPointerLock?.()?.catch?.(() => {}));
    } catch {
      /* headless */
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  press(a) {
    const t = now();
    this.presses.set(a, t);
    this.downAt.set(a, t);
  }

  /** Consumes a press of `a` made within the last `win` seconds. */
  take(a, win = 0.15) {
    const t = this.presses.get(a);
    if (t === undefined || now() - t > win) return false;
    this.presses.delete(a);
    return true;
  }

  /** A press within the window, without consuming it. */
  peek(a, win = 0.15) {
    const t = this.presses.get(a);
    return t !== undefined && now() - t <= win;
  }

  pressedAt(a) {
    return this.presses.get(a) ?? -1;
  }

  held(a) {
    return this.down.has(a) || this.padDown.has(a);
  }

  /** Seconds the action has been held (0 if not held). */
  heldFor(a) {
    if (!this.held(a)) return 0;
    const t = this.downAt.get(a);
    return t === undefined ? 0 : now() - t;
  }

  /** Movement intent in camera space: { x: right, y: forward }, length <= 1. */
  move(out) {
    let x = 0, y = 0;
    if (this.down.has('right')) x += 1;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('up')) y += 1;
    if (this.down.has('down')) y -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    // the stick wins when it is deflected
    if (Math.hypot(this.pad.lx, this.pad.ly) > 0.001) {
      x = this.pad.lx;
      y = -this.pad.ly;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  /** Look delta since the last call: [yaw, pitch] radians. */
  look(dt) {
    const k = 0.0022 * this.sens;
    let yaw = -this.lookX * k, pitch = -this.lookY * k * (this.invertY ? -1 : 1);
    this.lookX = this.lookY = 0;
    // right stick: rate-based with a response curve
    const rx = this.pad.x, ry = this.pad.y;
    if (rx || ry) {
      const m = Math.hypot(rx, ry);
      const c = Math.pow(m, 1.8) / (m || 1);
      yaw -= rx * c * 3.4 * this.sens * dt;
      pitch -= ry * c * 2.2 * this.sens * dt * (this.invertY ? -1 : 1);
    }
    return [yaw, pitch];
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  takeZoom() {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }

  /** Polls the first connected gamepad (call once per frame). */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') gp = gp || p;
    if (!gp) {
      this.pad.lx = this.pad.ly = this.pad.x = this.pad.y = 0;
      if (this.padDown.size) this.padDown.clear();
      return;
    }
    const dz = (v, d = 0.16) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
    // radial deadzone for the move stick
    let lx = gp.axes[0], ly = gp.axes[1];
    const lm = Math.hypot(lx, ly);
    if (lm < 0.18) lx = ly = 0;
    else {
      const k = Math.min(1, (lm - 0.18) / 0.78) / lm;
      lx *= k;
      ly *= k;
    }
    this.pad.lx = lx;
    this.pad.ly = ly;
    this.pad.x = dz(gp.axes[2]);
    this.pad.y = dz(gp.axes[3]);
    const b = gp.buttons.map((x) => x.pressed || x.value > 0.4);
    const prev = this._padPrev;
    const edge = (i) => b[i] && !prev[i];
    const set = (a, on) => (on ? this.padDown.add(a) : this.padDown.delete(a));
    const lt = b[PAD.LT], rt = b[PAD.RT];
    if (b.some(Boolean) || lx || ly) this.device = 'pad';
    // LT held turns the face buttons into tool / jutsu (X tool, Y Q, B E, A G); both triggers = ultimate
    if (lt && rt && (edge(PAD.LT) || edge(PAD.RT))) this.press('ult');
    if (lt) {
      if (edge(PAD.X)) this.press('tool');
      if (edge(PAD.Y)) this.press('jutsu1');
      if (edge(PAD.B)) this.press('jutsu2');
      if (edge(PAD.A)) this.press('jutsu3');
    } else {
      if (edge(PAD.A)) this.press('jump');
      if (edge(PAD.B)) this.press('dash');
      if (edge(PAD.X)) this.press('attack');
      if (edge(PAD.Y)) this.press('heavy');
    }
    set('jump', !lt && b[PAD.A]);
    set('dash', !lt && b[PAD.B]);
    set('attack', !lt && b[PAD.X]);
    set('guard', b[PAD.LB]);
    set('charge', rt && !lt);
    if (edge(PAD.RB) || edge(PAD.RS)) this.press('lock');
    set('score', b[PAD.BACK]);
    if (edge(PAD.START) && this.enabled) this.onPause?.();
    this._padPrev = b;
  }
}

function now() {
  return performance.now() / 1000;
}
