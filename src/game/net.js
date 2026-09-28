// WebSocket client: join handshake, clock sync (ping/pong, lowest-latency samples trusted most), 30 Hz state upload,
// immediate action events, adaptive interpolation delay from the measured age of incoming snapshots, reconnect with a
// session token (the server keeps a dropped player's name, colour and score for a few seconds).
import { NET } from '../shared/config.js';

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.handlers = {};
    this.offset = 0; // serverTime ≈ performance.now() + offset
    this.rtt = 0;
    this._bestRtt = Infinity;
    this._pingTimer = null;
    this.joined = false;
    this.wantJoin = null;
    this.retry = 0;
    this.seq = 0; // our state sequence: the server drops states from before its latest teleport of us
    this.interp = NET.interpMin; // ms remotes are drawn behind the server clock
    this.ages = new Float32Array(90); // ring of snapshot ages (ms) at arrival
    this.nAge = 0;
    this.stats = { sent: 0, recv: 0, bytesIn: 0, bytesOut: 0, late: 0, snaps: 0, stalls: 0 };
    try {
      this.token = sessionStorage.getItem('shinobi.token') || Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('shinobi.token', this.token);
    } catch {
      this.token = Math.random().toString(36).slice(2);
    }
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
  }

  emit(type, data) {
    for (const fn of this.handlers[type] || []) fn(data);
  }

  get url() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  serverNow() {
    return performance.now() + this.offset;
  }

  /** The server time remotes are drawn at. */
  renderTime() {
    return this.serverNow() - this.interp;
  }

  join(name, ch, pw) {
    this.wantJoin = pw ? { name, ch, pw } : { name, ch };
    return new Promise((resolve, reject) => {
      this._resolveJoin = resolve;
      this._rejectJoin = reject;
      this.open();
    });
  }

  open() {
    if (this.ws && this.ws.readyState <= 1) {
      this.ws.onclose = null;
      this.ws.close();
    }
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this._bestRtt = Infinity;
      this.ping();
      clearInterval(this._pingTimer);
      // fast pings for the first seconds (clock sync converges), then every second
      let n = 0;
      this._pingTimer = setInterval(() => {
        this.ping();
        if (++n === 10) {
          clearInterval(this._pingTimer);
          this._pingTimer = setInterval(() => this.ping(), 1000);
        }
      }, 150);
      if (this.wantJoin) this.send({ t: 'join', ...this.wantJoin, token: this.token });
    };
    ws.onmessage = (e) => {
      this.stats.bytesIn += e.data.length;
      this.stats.recv++;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handle(m);
    };
    ws.onclose = () => {
      clearInterval(this._pingTimer);
      const was = this.joined;
      this.joined = false;
      if (this._rejectJoin && !was && this.retry >= 3) {
        this._rejectJoin(new Error('Could not reach the game server.'));
        this._rejectJoin = null;
        return;
      }
      if (!this.wantJoin) return;
      this.emit('disconnected');
      this.retry++;
      setTimeout(() => this.wantJoin && this.open(), Math.min(4000, 400 * this.retry));
    };
    ws.onerror = () => {};
  }

  leave() {
    this.wantJoin = null;
    this.joined = false;
    clearInterval(this._pingTimer);
    this.ws?.close();
  }

  send(msg) {
    if (this.ws?.readyState !== 1) return;
    const s = JSON.stringify(msg);
    this.stats.bytesOut += s.length;
    this.stats.sent++;
    this.ws.send(s);
  }

  ping() {
    this.send({ t: 'ping', c: performance.now(), r: Math.round(this.rtt) });
  }

  handle(m) {
    switch (m.t) {
      case 'pong': {
        const now = performance.now();
        const rtt = now - m.c;
        this.rtt = this.rtt ? this.rtt * 0.85 + rtt * 0.15 : rtt;
        const est = m.s + rtt / 2 - now;
        // the lowest-latency samples have the least queueing noise
        if (rtt <= this._bestRtt * 1.25 + 2) {
          this._bestRtt = Math.min(this._bestRtt, rtt);
          this.offset = this.offset ? this.offset * 0.75 + est * 0.25 : est;
        }
        // slowly forget the best (routes change)
        this._bestRtt *= 1.002;
        break;
      }
      case 'welcome':
        this.id = m.id;
        this.seq = m.you.seq;
        this.joined = true;
        if (!this.offset) this.offset = m.st - performance.now();
        this.emit('welcome', m);
        if (this._resolveJoin) {
          this._resolveJoin(m);
          this._resolveJoin = null;
          this._rejectJoin = null;
        } else this.emit('rejoined', m);
        break;
      case 'full':
        this.wantJoin = null;
        this._rejectJoin?.(new Error(`The arena is full (${m.max} ninja).`));
        this._rejectJoin = null;
        break;
      case 'locked': {
        // a password-locked character and a wrong (or no) password: back to the title screen
        const reject = this._rejectJoin;
        this._rejectJoin = null;
        this.leave();
        reject?.(Object.assign(new Error(m.pw ? 'Wrong password.' : 'This ninja needs a password.'), { locked: m.ch }));
        break;
      }
      case 'snap':
        this.measure(m);
        this.emit('snap', m);
        break;
      default:
        this.emit(m.t, m);
    }
  }

  /**
   * Adaptive interpolation delay: remotes are drawn far enough behind the server clock that a state is usually
   * already here. The age of the newest state in each snapshot at arrival = downlink latency + queueing; the delay
   * follows its 80th percentile plus a margin, within 70-120 ms. Later packets (loss retransmits, a slow downlink)
   * are covered by a short extrapolation, and RemoteMotion smooths the correction when the real data arrives.
   */
  measure(m) {
    const now = this.serverNow();
    // stalls: snapshots come every ~33 ms; a gap over 100 ms is a lost segment being resent (TCP never drops, it
    // delays everything behind it) or a stalled connection: the F3 overlay's packet-loss indicator
    const at = performance.now();
    if (this.lastSnapAt && at - this.lastSnapAt > 100) this.stats.stalls++;
    this.lastSnapAt = at;
    let newest = 0;
    for (const p of m.ps) if (p[0] !== this.id && p[11] > newest) newest = p[11];
    if (!newest) return;
    const age = now - newest;
    if (age < -50 || age > 2000) return;
    this.ages[this.nAge++ % this.ages.length] = age;
    this.stats.snaps++;
    if (this.nAge % 15 === 0) {
      const n = Math.min(this.nAge, this.ages.length);
      const s = Array.from(this.ages.subarray(0, n)).sort((a, b) => a - b);
      const p80 = s[Math.floor(n * 0.8)];
      const want = Math.max(NET.interpMin, Math.min(NET.interpMax, p80 + 10));
      // move gradually: a sudden jump would make remotes stutter
      this.interp += (want - this.interp) * 0.35;
    }
  }

  /** Uploads our state (called at NET.sendRate from the fixed-step loop). */
  sendState(s) {
    if (!this.joined) return;
    const out = new Array(10);
    for (let i = 0; i < 10; i++) out[i] = i < 7 ? Math.round(s[i] * 1000) / 1000 : s[i];
    this.send({ t: 's', s: out, n: this.seq });
  }

  /** An action event, sent immediately (at = the action's start on the server clock). */
  act(k, o = {}) {
    if (!this.joined) return;
    this.send({ t: 'a', k, at: Math.round(this.serverNow()), ...o });
  }
}

export async function fetchStatus() {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    return await r.json();
  } catch {
    return null;
  }
}
