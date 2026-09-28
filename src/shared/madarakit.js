// Madara's area jutsu as deterministic geometry, shared by every client (drawing, the caster's hit detection) and the
// server (hit validation): the same payload (origin, direction, instance seed, time) and the same map give the same
// shape everywhere, so a wave, a stake line or a meteor lands in the same place on every screen. Pure JS (no three.js).
// Times: seconds since the effect phase (n:1, `at1` in server-clock ms). Payload numbers are rounded to mm (r3) by
// the caster BEFORE it builds its own shape, exactly as the server relays them.
import { charOf } from './characters.js';
import { mulberry32 } from './rng.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
export const r3 = (v) => Math.round(v * 1000) / 1000;
const _g = {}, _o = {};

// ---------------------------------------------------------------- Great Fire Annihilation

const STEP = 0.5; // metres between the lanes' ground samples

/**
 * The first thing along a horizontal ray (from x, y, z along dx, dz, up to len) that stops a rolling wall of fire:
 * a thin post or sign (under 0.5 m across) is flowed round, anything whose top is within 1.2 m of the flame's base
 * (a fence, a low wall, a crate) is rolled over. Returns the distance (len when nothing stops it); out gets the hit's
 * normal. The same answer on every client and the server (the map's colliders are deterministic).
 */
function fireBlock(world, x, y, z, dx, dz, len, out) {
  let from = 0;
  for (let k = 0; k < 4; k++) {
    const t = world.raycast(x + dx * from, y + 0.7, z + dz * from, dx, 0, dz, len - from, out);
    if (t >= len - from) return len;
    const S = out.shape;
    if (!S) return from + t; // the terrain itself (a cliff)
    const thin = S.k === 1 ? Math.max(S.r, S.r1 ?? S.r) < 0.25 : Math.min(S.hx, S.hz) < 0.15 && Math.max(S.hx, S.hz) < 0.3;
    const low = S.y1 - y < 1.2;
    if (!thin && !low) return from + t;
    from += t + 0.05; // past it, keep going
    if (from >= len) return len;
  }
  return len;
}

/** The front's distance along the wave (m) at t seconds: fast at the mouth, easing out at the end. */
export function fireFront(W, t) {
  const x = clamp(t / W.time, 0, 1);
  return W.length * (1 - (1 - x) * (1 - x));
}
/** The torrent's tail: fire expelled at the end of the exhale travels the same curve. */
export const fireTail = (J, t) => fireFront(J.wave, t - J.exhale / 60);
/** The wave's width at distance s. */
export const fireWidth = (W, s) => W.w0 + (W.w1 - W.w0) * Math.pow(clamp(s / W.length, 0, 1), 0.8);

/**
 * The wave's footprint: `lanes` rays across its width (fraction f from -1 = right edge to +1 = left), each marched
 * along the ground from the origin in 0.5 m steps: it rolls over bumps and ledges up to 1 m, pours down drops, and
 * stops at anything in the way (walls, trunks, cliffs: a ray at knee height). o = [x, y, z(, jet)] the start point on
 * the ground, d = [dx, dy, dz] the direction (horizontal part used).
 */
export function fireShape(world, J, o, d) {
  const W = J.wave;
  let dx = d[0], dz = d[2];
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  const nx = dz, nz = -dx; // the wave's left
  const N = Math.ceil(W.length / STEP) + 1;
  const lanes = [];
  for (let k = 0; k < W.lanes; k++) {
    const f = (k / (W.lanes - 1)) * 2 - 1;
    const ys = new Float32Array(N);
    let y = o[1], px = o[0] + nx * f * W.w0 * 0.5, pz = o[2] + nz * f * W.w0 * 0.5, len = W.length, hit = null;
    ys[0] = y;
    for (let i = 1; i < N; i++) {
      const s = i * STEP, half = fireWidth(W, s) * 0.5;
      const x = o[0] + dx * s + nx * f * half, z = o[2] + dz * s + nz * f * half;
      const ex = x - px, ez = z - pz, el = Math.hypot(ex, ez);
      const t = fireBlock(world, px, y, pz, ex / el, ez / el, el, _o);
      if (t < el) {
        len = (i - 1) * STEP + STEP * (t / el);
        hit = { x: px + (ex / el) * t, y, z: pz + (ez / el) * t, nx: _o.nx, nz: _o.nz };
        ys.fill(y, i);
        break;
      }
      y = world.ground(x, z, y + 1.0, _g).y;
      ys[i] = y;
      px = x;
      pz = z;
    }
    lanes.push({ f, len, ys, hit });
  }
  // the burning field: where the bulk of the wave comes to rest (the median lane's end: one trunk in the middle
  // doesn't move it), 8 x 6 m
  const endS = Math.max(W.w0, lanes.map((L) => L.len).sort((a, b) => a - b)[(W.lanes - 1) >> 1]);
  const F = J.field;
  return { o: [o[0], o[1], o[2]], jet: o[3] || 0, dx, dz, nx, nz, lanes, N, field: { s0: Math.max(0, endS - F.d), s1: endS } };
}

/** Ground height of lane k at distance s (the last sample past its end). */
function laneY(L, s) {
  const i = clamp(s / STEP, 0, L.ys.length - 1), i0 = Math.floor(i);
  return lerp(L.ys[i0], L.ys[Math.min(L.ys.length - 1, i0 + 1)], i - i0);
}

/** Lane-interpolated { len, y } at lateral fraction f (-1..1) and distance s. */
export function fireLane(shape, f, s, out = {}) {
  const n = shape.lanes.length, kf = ((clamp(f, -1, 1) + 1) / 2) * (n - 1), k0 = Math.min(n - 2, Math.floor(kf)), w = kf - k0;
  const A = shape.lanes[k0], B = shape.lanes[k0 + 1];
  out.len = lerp(A.len, B.len, w);
  out.y = lerp(laneY(A, s), laneY(B, s), w);
  return out;
}

/** A point on the wave's ground at distance s, lateral fraction f (world x, y, z). */
export function firePoint(shape, W, s, f, out = {}) {
  const half = fireWidth(W, s) * 0.5;
  fireLane(shape, f, s, out);
  out.x = shape.o[0] + shape.dx * s + shape.nx * f * half;
  out.z = shape.o[2] + shape.dz * s + shape.nz * f * half;
  return out;
}

const _l = {};
/**
 * Is a body (feet x, y, z, radius r) inside the torrent at t? `slack` (s) widens the time window (the server's
 * network tolerance). Returns { s, u } (distance along, lateral offset) or null.
 */
export function fireContains(shape, J, t, x, y, z, r, slack = 0) {
  const W = J.wave;
  if (t < -slack || t > W.time + J.exhale / 60 + slack) return null;
  const rx = x - shape.o[0], rz = z - shape.o[2];
  const s = rx * shape.dx + rz * shape.dz, u = rx * shape.nx + rz * shape.nz;
  if (s > fireFront(W, t + slack) + r || s < fireTail(J, t - slack) - r) return null;
  const half = fireWidth(W, s) * 0.5;
  if (Math.abs(u) > half + r) return null;
  fireLane(shape, u / half, s, _l);
  if (s > _l.len + r) return null;
  if (y - _l.y > W.height || y < _l.y - 1.5) return null;
  return { s, u };
}

/** The burning field: active from when the front comes to rest, for field.time seconds. */
export const fieldStart = (J) => J.wave.time;
export function fieldContains(shape, J, t, x, y, z, r, slack = 0) {
  const t0 = fieldStart(J);
  if (t < t0 - slack || t > t0 + J.field.time + slack) return false;
  const rx = x - shape.o[0], rz = z - shape.o[2];
  const s = rx * shape.dx + rz * shape.dz, u = rx * shape.nx + rz * shape.nz;
  if (s < shape.field.s0 - r || s > shape.field.s1 + r || Math.abs(u) > J.field.w * 0.5 + r) return false;
  const half = fireWidth(J.wave, s) * 0.5;
  fireLane(shape, u / half, s, _l);
  if (s > _l.len + r) return false;
  return y - _l.y < 1.2 && y > _l.y - 1.5;
}

// ---------------------------------------------------------------- Wood Release: Cutting Technique

/**
 * The stake line: from the palm's point o along d (horizontal), stakes every ~1 m (seeded by the cast's instance id:
 * the same on every screen) with sizes growing along the line, a lateral scatter widening with distance, each leaning
 * forward. The line follows the ground (ledges up to 1.2 m) and stops at walls (thin posts and low fences don't stop
 * it). Returns { o, dx, dz, nx, nz, len, ys (ground every 0.5 m), stakes: [{ x, y, z, s, h, r, pitch, roll, twist,
 * t (erupt, s after at1), v (variant) }] }.
 */
export function stakeLine(world, J, o, d, seed) {
  const L = J.line;
  let dx = d[0], dz = d[2];
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  const nx = dz, nz = -dx;
  const N = Math.ceil(L.length / STEP) + 1;
  const ys = new Float32Array(N);
  let y = o[1], px = o[0], pz = o[2], len = L.length;
  ys[0] = y;
  for (let i = 1; i < N; i++) {
    const x = o[0] + dx * i * STEP, z = o[2] + dz * i * STEP;
    const t = fireBlock(world, px, y - 0.2, pz, dx, dz, STEP, _o);
    const g = world.ground(x, z, y + 1.2, _g).y;
    if (t < STEP || g < y - 6) {
      len = (i - 1) * STEP + t * (t < STEP ? 1 : 0);
      ys.fill(y, i);
      break;
    }
    y = g;
    ys[i] = y;
    px = x;
    pz = z;
  }
  const rng = mulberry32((seed | 0) * 2654435761);
  const stakes = [];
  for (let s = 0.9 + rng() * 0.3; s <= len - 0.2; s += L.spacing * (0.75 + rng() * 0.5)) {
    const k = s / L.length;
    // a main stake, and now and then a smaller one beside it (the line reads as a thicket, not a fence)
    for (let m = 0; m < (rng() < 0.45 ? 2 : 1); m++) {
      const u = (rng() - 0.5) * 2 * (0.25 + k * 0.9) + (m ? (rng() < 0.5 ? -0.55 : 0.55) : 0);
      const ss = s + (m ? (rng() - 0.5) * 0.5 : 0);
      if (ss > len) continue;
      const h = (L.hMin + (L.hMax - L.hMin) * (0.3 + 0.7 * rng()) * (0.75 + 0.25 * k)) * (m ? 0.62 : 1);
      stakes.push({
        x: o[0] + dx * ss + nx * u, z: o[2] + dz * ss + nz * u, y: lineY(ys, ss) - 0.05, s: ss, u, h, r: h * (0.17 + rng() * 0.06),
        pitch: 8 + rng() * 14, roll: (rng() - 0.5) * 14 + u * 6, twist: rng() * 360, t: ss / L.speed, v: rng() < 0.5 ? 0 : 1,
      });
    }
  }
  return { o: [o[0], o[1], o[2]], dx, dz, nx, nz, len, ys, stakes };
}

function lineY(ys, s) {
  const i = clamp(s / STEP, 0, ys.length - 1), i0 = Math.floor(i);
  return lerp(ys[i0], ys[Math.min(ys.length - 1, i0 + 1)], i - i0);
}

/** Is a body (feet x, y, z, radius r) hit by the stakes at t (the front has passed it and they still stand)? */
export function woodContains(line, J, t, x, y, z, r, slack = 0) {
  const L = J.line;
  const rx = x - line.o[0], rz = z - line.o[2];
  const s = rx * line.dx + rz * line.dz, u = rx * line.nx + rz * line.nz;
  if (s < -r || s > line.len + r) return null;
  if (s > L.speed * (t + slack) + r) return null; // the front hasn't got there
  if (t - slack > Math.max(0, s) / L.speed + L.hold) return null; // they have gone down
  if (Math.abs(u) > L.width + 0.25 + (s / L.length) * 0.9 + r) return null; // the line's width (+ its scatter)
  const gy = lineY(line.ys, clamp(s, 0, line.len));
  if (y - gy > L.height || y < gy - 1.5) return null;
  return { s, u };
}

// ---------------------------------------------------------------- dispatch (server validation, remote placement)

/**
 * Places a cast's effect from its relayed phase payload (out: { m, n, at, o, d, i }). Returns { kind, at1, ... } or
 * null (a phase with nothing to place). caster: { ch } (the character id picks the data).
 */
export function castEffect(world, m, out, caster) {
  const J = charOf(caster.ch).jutsu[m];
  if (!J || out.n !== 1 || !out.o || !out.d) return null;
  if (m === 'fireAnnihilation') return { kind: 'fire', at1: out.at, shape: fireShape(world, J, out.o, out.d), J };
  if (m === 'woodCutting') return { kind: 'wood', at1: out.at, line: stakeLine(world, J, out.o, out.d, out.i), J };
  return null;
}

/**
 * Is the victim (feet p) inside the area of `inst` (the server's act: { m, at, phases, fx }) at hit time `at`, with
 * the hit's source point c and tick k? Returns null when it is, else the reason (hitx.why).
 */
export function checkArea(world, spec, inst, at, p, c, k = 0) {
  const fx = inst.fx;
  if (!fx) return 'area:none';
  const t = (at - fx.at1) / 1000, r = 0.34 + 0.9; // body radius + tolerance (the attacker saw a drawn hurtbox)
  if (spec.area === 'fire' && fx.kind === 'fire') {
    if (spec.kOnly !== undefined ? k !== spec.kOnly : k > spec.kMax) return 'area:tick';
    const h = fireContains(fx.shape, fx.J, t, p[0], p[1], p[2], r, 0.25);
    if (!h) return 'area:outside';
    // the push comes from the torrent behind the victim
    const cs = (c[0] - fx.shape.o[0]) * fx.shape.dx + (c[2] - fx.shape.o[2]) * fx.shape.dz;
    if (cs > h.s + 0.5 || cs < h.s - 4) return 'area:source';
    return null;
  }
  if (spec.area === 'field' && fx.kind === 'fire') {
    const j = k - 10, due = fieldStart(fx.J) + (j * fx.J.field.every) / 60;
    if (j < 0 || due > fieldStart(fx.J) + fx.J.field.time || Math.abs(t - due) > 0.35) return 'area:tick';
    return fieldContains(fx.shape, fx.J, t, p[0], p[1], p[2], r, 0.35) ? null : 'area:outside';
  }
  if (spec.area === 'wood' && fx.kind === 'wood') {
    const h = woodContains(fx.line, fx.J, t, p[0], p[1], p[2], r, 0.25);
    if (!h) return 'area:outside';
    // c: the stake that hit (on the line, near the victim)
    const cs = (c[0] - fx.line.o[0]) * fx.line.dx + (c[2] - fx.line.o[2]) * fx.line.dz;
    if (Math.abs(cs - h.s) > 3 || cs > fx.line.len + 1) return 'area:source';
    return null;
  }
  return 'area:kind';
}
