// A remote fighter's motion: the 30 Hz state stream (stamped with server time when it arrived there) interpolated
// with Hermite curves (positions + the velocities the owner sends, so arcs and turns stay round between samples)
// at the adaptive delay behind the synced clock, with a short extrapolation when a packet is late. It also derives
// what the animator needs from the stream: landings, the double-jump flip, dash direction, wall-run normal.
import { NET, ST, FLAG } from '../shared/config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const wrap = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
const _wall = {};

export class RemoteMotion {
  constructor(world) {
    this.world = world;
    this.buf = []; // { t, s: [10] }
    this.cur = new Float64Array(10);
    this.prevSt = ST.loco;
    this.prevFl = 0;
    this.prevVy = 0;
    this.flipT = -1;
    this.landT = 9;
    this.landV = 0;
    this.hardLand = false;
    this.yawRate = 0;
    this.lastYaw = null;
    this.late = 0; // ms we are past the newest sample (extrapolating)
    this.pool = [];
    // visual error smoothing: when fresh data corrects an extrapolation, the drawn position eases over instead of snapping
    this.off = [0, 0, 0];
    this.drawn = null;
    this.rawPrev = null;
  }

  push(t, s) {
    const b = this.buf;
    const last = b[b.length - 1];
    if (last && t <= last.t) {
      if (t === last.t) return;
      b.length = 0; // clock went backwards (server restart)
    }
    const e = this.pool.pop() || { t: 0, s: new Float64Array(10) };
    e.t = t;
    for (let i = 0; i < 10; i++) e.s[i] = s[i];
    b.push(e);
    while (b.length > 40) this.pool.push(b.shift());
  }

  /** Drops the buffer (teleports): the next samples start fresh. */
  clear() {
    for (const e of this.buf) this.pool.push(e);
    this.buf.length = 0;
  }

  /** Samples the stream at server time t into this.cur. Returns false with no data. */
  sample(t) {
    const b = this.buf, c = this.cur;
    if (!b.length) return false;
    if (t <= b[0].t) {
      c.set(b[0].s);
      this.late = 0;
      return true;
    }
    for (let i = b.length - 1; i >= 1; i--) {
      const p0 = b[i - 1], p1 = b[i];
      if (t < p0.t) continue;
      if (t > p1.t) break;
      const T = Math.max(1, p1.t - p0.t);
      const k = (t - p0.t) / T;
      const dts = T / 1000;
      // Hermite on position with the sent velocities (when the stream jumped, e.g. a teleport, plain lerp)
      const jump = Math.hypot(p1.s[0] - p0.s[0], p1.s[2] - p0.s[2]) > 6;
      const k2 = k * k, k3 = k2 * k;
      const h00 = 2 * k3 - 3 * k2 + 1, h10 = k3 - 2 * k2 + k, h01 = -2 * k3 + 3 * k2, h11 = k3 - k2;
      for (let a = 0; a < 3; a++) {
        const x0 = p0.s[a], x1 = p1.s[a];
        c[a] = jump ? x0 + (x1 - x0) * k : h00 * x0 + h10 * dts * p0.s[a + 3] + h01 * x1 + h11 * dts * p1.s[a + 3];
        c[a + 3] = p0.s[a + 3] + (p1.s[a + 3] - p0.s[a + 3]) * k;
      }
      c[6] = p0.s[6] + wrap(p1.s[6] - p0.s[6]) * k;
      const src = k < 0.5 ? p0 : p1;
      c[7] = src.s[7];
      c[8] = src.s[8] + (t - src.t);
      c[9] = src.s[9];
      this.late = 0;
      return true;
    }
    // past the newest sample: extrapolate along its velocity for a moment, then hold
    const l = b[b.length - 1];
    const over = Math.min(t - l.t, NET.extrapolate) / 1000;
    this.late = t - l.t;
    for (let a = 0; a < 3; a++) {
      c[a] = l.s[a] + l.s[a + 3] * over - (a === 1 && l.s[4] ? 0 : 0);
      c[a + 3] = l.s[a + 3];
    }
    // don't extrapolate through the ground
    c[6] = l.s[6];
    c[7] = l.s[7];
    c[8] = l.s[8] + (t - l.t);
    c[9] = l.s[9];
    return true;
  }

  /**
   * Corrections without snaps: the raw sample should continue the previous one along the velocity; a jump beyond that
   * (the extrapolation guessed wrong) becomes an offset that decays over ~80 ms. Teleports (> 4 m) snap.
   */
  smooth(c, dt) {
    const o = this.off, r = this.rawPrev;
    if (r) {
      let jx = c[0] - (r[0] + r[3] * dt), jy = c[1] - (r[1] + r[4] * dt), jz = c[2] - (r[2] + r[5] * dt);
      const j = Math.hypot(jx, jy, jz);
      if (j > 4) o[0] = o[1] = o[2] = 0;
      else if (j > 0.03) {
        o[0] -= jx;
        o[1] -= jy;
        o[2] -= jz;
      }
    } else this.rawPrev = new Float64Array(6);
    const k = Math.exp(-dt / 0.08);
    for (let i = 0; i < 3; i++) {
      o[i] *= k;
      this.rawPrev[i] = c[i];
      this.rawPrev[i + 3] = c[i + 3];
    }
  }

  /**
   * Fills the animator view from the stream at server time t. dt: frame time (s). Returns the view or null.
   */
  view(t, dt, v) {
    if (!this.sample(t)) return null;
    const c = this.cur;
    this.smooth(c, dt);
    v.x = c[0] + this.off[0];
    v.y = c[1] + this.off[1];
    v.z = c[2] + this.off[2];
    v.yaw = c[6];
    const st = c[7], fl = c[9];
    // derived events
    if (this.lastYaw !== null) this.yawRate += (wrap(c[6] - this.lastYaw) / Math.max(dt, 1e-3) - this.yawRate) * clamp(dt * 14, 0, 1);
    this.lastYaw = c[6];
    if ((fl & FLAG.doubleJumped) && !(this.prevFl & FLAG.doubleJumped) && st === ST.air) this.flipT = 0;
    else if (this.flipT >= 0) this.flipT += dt;
    if (!(fl & FLAG.doubleJumped)) this.flipT = -1;
    this.landT += dt;
    if ((st === ST.loco || st === ST.land) && (this.prevSt === ST.air || this.prevSt === ST.dash)) {
      this.landT = 0;
      this.landV = -this.prevVy;
      this.hardLand = st === ST.land;
    }
    this.prevSt = st;
    this.prevFl = fl;
    this.prevVy = c[4];
    const s = Math.sin(c[6]), co = Math.cos(c[6]);
    // local velocity: forward = (-sin, -cos), left = (-cos, sin)
    v.vf = -c[3] * s - c[5] * co;
    v.vl = -c[3] * co + c[5] * s;
    v.vy = c[4];
    v.speed = Math.hypot(c[3], c[5]);
    v.yawRate = this.yawRate;
    v.st = st;
    v.stT = c[8] / 1000;
    v.sprint = !!(fl & FLAG.sprint);
    v.skid = fl & FLAG.skid ? 1 : 0;
    v.ground = st === ST.loco || st === ST.land;
    v.flipT = this.flipT;
    v.landT = this.landT;
    v.landV = this.landV;
    v.hardLand = this.hardLand;
    v.stepUp = 0;
    if (st === ST.dash) {
      const sp = Math.hypot(c[3], c[5]) || 1;
      const dx = c[3] / sp, dz = c[5] / sp;
      const lf = -dx * s - dz * co, ll = -dx * co + dz * s;
      v.dashLocal = [ll, lf];
      v.dashBack = lf < -0.7;
      v.dashT = v.stT;
      v.dashAir = c[1] - this.world.ground(c[0], c[2], c[1] + 0.3, _wall).y > 0.3;
    }
    if (st === ST.wall) {
      const w = this.world.wall(c[0], c[1] + 0.9, c[2], 0.34, 0.9, _wall) || this.world.wall(c[0], c[1] + 0.2, c[2], 0.34, 0.9, _wall);
      v.wall = w ? { nx: w.nx, nz: w.nz } : v.wall;
      const sp = Math.hypot(c[3], c[4], c[5]);
      if (w && sp > 0.5) {
        const tx = -w.nz, tz = w.nx;
        v.wallDir = [(c[3] * tx + c[5] * tz) / sp, c[4] / sp];
        v.wallSpeed = sp;
      } else v.wallSpeed = 0;
    } else v.wall = null;
    return v;
  }
}
