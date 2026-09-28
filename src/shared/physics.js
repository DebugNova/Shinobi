// Kinematic body physics, shared by the client (the local fighter, knockback flights of every fighter) and the
// server (flight validation, spawn checks). One fixed step = SIM.dt. Deterministic: only + - * / sqrt, so Node
// and Chrome agree to the last bit given the same inputs (keep Math.sin/cos/atan2 out of here).
import { SIM } from './config.js';

const _pos = { x: 0, z: 0 };
const _hits = [];
const _g = {};

/**
 * A physics body: position (feet), velocity, ground contact.
 */
export function makeBody(x = 0, y = 0, z = 0) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0,
    ground: false, // standing on something this step
    gy: y, // ground height under the feet
    gnx: 0, gny: 1, gnz: 0, // ground normal
    surf: 0,
    shape: null, // shape stood on (null = terrain / water)
    stepUp: 0, // height climbed by a step-up this step (the renderer smooths it)
    contacts: 0, // sideways contacts this step (walls)
    cnx: 0, cnz: 0, // the strongest contact's normal
    cshape: null,
    landV: 0, // vertical speed at landing this step (0 = no landing)
    ceil: false,
  };
}

/**
 * Advances a body one step. opts: { r, h, step, gravity, fallMul, maxFall, snap, bounce, slopeLimitCos, noGravity }
 * - snap: when grounded, stick to ground up to this far below (walking down slopes and stairs)
 * - bounce: wall restitution (knockback flights), 0 = slide along walls
 */
export function stepBody(world, b, o, dt = SIM.dt) {
  const r = o.r, h = o.h, step = o.step ?? 0.45;
  const x0 = b.x, z0 = b.z;
  b.stepUp = 0;
  b.contacts = 0;
  b.landV = 0;
  b.ceil = false;
  b.cshape = null;
  // horizontal, in substeps so fast bodies (dashes, knockback) never tunnel through thin walls
  const hs = Math.sqrt(b.vx * b.vx + b.vz * b.vz) * dt;
  const n = hs > r * 0.7 ? Math.min(6, Math.ceil(hs / (r * 0.7))) : 1;
  const sdt = dt / n;
  let best = 0;
  for (let i = 0; i < n; i++) {
    _pos.x = b.x + b.vx * sdt;
    _pos.z = b.z + b.vz * sdt;
    const k = world.pushOut(_pos, r, b.y, b.y + h, b.ground || b.vy <= 0 ? step : 0.05, _hits);
    b.x = _pos.x;
    b.z = _pos.z;
    for (let j = 0; j < k; j++) {
      const c = _hits[j];
      const vn = b.vx * c.nx + b.vz * c.nz;
      if (vn < 0) {
        const f = 1 + (o.bounce || 0);
        b.vx -= vn * c.nx * f;
        b.vz -= vn * c.nz * f;
      }
      if (c.depth > best || !b.contacts) {
        best = c.depth;
        b.cnx = c.nx;
        b.cnz = c.nz;
        b.cshape = c.shape;
      }
      b.contacts++;
    }
  }

  // vertical
  const g = o.noGravity ? 0 : o.gravity ?? 26;
  if (b.ground && b.vy <= 0) {
    // stay on the ground: step up onto what is under us, or follow it down (snap)
    world.ground(b.x, b.z, b.y + step, _g, r * 0.35);
    const drop = b.y - _g.y;
    if (drop <= (o.snap ?? 0.5) && drop >= -step - 1e-6) {
      // a step up (a ledge, a stair) is smoothed by the renderer; ground rising along a slope is not a step: counting
      // it pulled the drawn fighter down every tick and eased it back up (a sawtooth: the fighter shook up every ramp)
      if (_g.y > b.y) {
        const hm = Math.sqrt((b.x - x0) * (b.x - x0) + (b.z - z0) * (b.z - z0));
        const tan = (nx, ny, nz) => Math.sqrt(nx * nx + nz * nz) / Math.max(ny, 0.2);
        if (_g.y - b.y > hm * Math.max(tan(b.gnx, b.gny, b.gnz), tan(_g.nx, _g.ny, _g.nz)) + 0.02) b.stepUp = _g.y - b.y;
      }
      b.y = _g.y;
      b.vy = 0;
      setGround(b, _g);
    } else {
      b.ground = false;
    }
  }
  if (!b.ground || b.vy > 0) {
    const mul = b.vy < 0 ? o.fallMul ?? 1 : 1;
    b.vy -= g * mul * dt;
    if (b.vy < -(o.maxFall ?? 40)) b.vy = -(o.maxFall ?? 40);
    const y0 = b.y;
    b.y += b.vy * dt;
    // ceiling: a shape's underside between the old and new head heights stops the rise
    if (b.vy > 0) {
      const c = world.ceiling(b.x, b.z, r, y0 + h - 0.05, b.y + h);
      if (c !== Infinity) {
        b.y = c - h - 1e-3;
        b.vy = 0;
        b.ceil = true;
      }
    }
    // landing: the highest surface we passed through this step. Falling, anything within a step above the feet counts
    // too: pushOut let us move over it sideways (the same step rule as walking), and on a slope rising under us the
    // surface at the new spot is above the old feet (we used to sink into roofs jumping uphill at them)
    world.ground(b.x, b.z, Math.max(y0, b.y) + (b.vy <= 0 ? step : 0), _g, r * 0.35);
    if (b.vy <= 0 && b.y <= _g.y) {
      b.landV = -b.vy;
      b.y = _g.y;
      b.vy = 0;
      b.ground = true;
      setGround(b, _g);
    } else {
      b.ground = false;
      b.gy = _g.y;
    }
  }
  // steep ground: slide off it
  if (b.ground && o.slopeLimitCos && b.gny < o.slopeLimitCos) {
    b.vx += b.gnx * 18 * dt;
    b.vz += b.gnz * 18 * dt;
  }
}

function setGround(b, g) {
  b.ground = true;
  b.gy = g.y;
  b.gnx = g.nx;
  b.gny = g.ny;
  b.gnz = g.nz;
  b.surf = g.surf;
  b.shape = g.shape;
}

/**
 * A knockback / launch flight, simulated identically on every client and on the server from the hit event:
 * start state (feet position, velocity), gravity, walls (bounce), landing. Advance with `advance(t)`.
 */
export class Flight {
  constructor(world, x, y, z, vx, vy, vz, o) {
    this.world = world;
    this.o = o; // { r, h, gravity, fallMul, bounce, friction }
    this.b = makeBody(x, y, z);
    this.b.vx = vx;
    this.b.vy = vy;
    this.b.vz = vz;
    this.b.ground = false;
    this.t = 0; // simulated seconds
    this.landedAt = -1; // seconds after start when it first touched the ground
    this.bounces = 0;
    this.wallAt = -1;
    this.x0 = x;
    this.y0 = y;
    this.z0 = z;
  }

  /** Simulates up to t seconds after the start (whole steps). */
  advance(t) {
    const b = this.b, o = this.o;
    while (this.t + SIM.dt <= t + 1e-9) {
      const wasGround = b.ground;
      stepBody(this.world, b, o);
      this.t += SIM.dt;
      if (b.contacts && this.wallAt < 0 && !b.ground) {
        this.wallAt = this.t;
        this.bounces++;
      }
      if (b.ground) {
        if (!wasGround && this.landedAt < 0) this.landedAt = this.t;
        // sliding along the ground after landing
        const f = Math.max(0, 1 - (o.friction ?? 9) * SIM.dt);
        b.vx *= f;
        b.vz *= f;
      }
    }
    return b;
  }
}
