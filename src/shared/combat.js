// Combat rules shared by the server (authoritative results) and the attacker's client (predicted feedback): the hit
// spec of every move, when it is active, and what a hit does (damage scaling, reaction, stun, knockback, hitstop).
// Given the same inputs both sides compute the same numbers, so a prediction is almost always right.
import { COMBO } from './naruto.js';
import { charOf } from './characters.js';
import { dsin, dcos } from './rng.js';
import { Flight } from './physics.js';

export const REACT = { none: 0, flinch: 1, stagger: 2, launch: 3, knockback: 4, spike: 5, guard: 6, guardBreak: 7, wobble: 8 };
export const REACT_NAME = Object.fromEntries(Object.entries(REACT).map(([k, v]) => [v, k]));
// reactions that throw the victim through the air (deterministic flight until landing, then knocked down)
export const AIRBORNE = new Set([REACT.launch, REACT.knockback, REACT.spike]);
// flight gravity per reaction: juggles float, spikes slam
export const FLIGHT_G = { [REACT.launch]: 17, [REACT.knockback]: 24, [REACT.spike]: 42 };

const F = 1 / 60;

/**
 * The hit spec of a hit id: 'L1'..'L5', 'A1'..'A4', 'H' (moves), 'shuriken', 'rasengan', 'rasengan:g' (grind tick),
 * 'clone' / 'clone:last' (shadow clone string), 'rsh' (Rasenshuriken impact), 'rsh:b' (its burst ticks).
 * Returns { dmg, react, stun, kb: [h, v], hitstop, reach, guardBreak, win: [start, end] seconds after the move
 * started (null = projectile/entity: validated by its own spawn), ticks }.
 */
export function hitSpec(charId, id) {
  const C = charOf(charId);
  const cache = (C._specs ||= {});
  if (cache[id]) return cache[id];
  let s = null;
  const mv = C.moves[id];
  if (mv) {
    s = { ...mv.hit, react: REACT[mv.hit.react], win: [mv.startup * F, (mv.startup + mv.active) * F], move: mv, cls: 'melee' };
  } else {
    const [base, part] = id.split(':');
    const J = C.jutsu[base === 'clone' ? 'clones' : base === 'rsh' ? 'rasenshuriken' : base];
    if (!J) return null;
    // data-driven jutsu (Madara's): `${jutsu}:${part}` -> J.hits[part] (cls, area, chip... come with it)
    if (J.hits) s = J.hits[part || 'main'] ? { ...J.hits[part || 'main'], win: null } : null;
    else if (base === 'shuriken') s = { ...J.hit, win: null };
    else if (base === 'rasengan' && part === 'g') s = { dmg: J.grind.dmg, react: 'flinch', stun: J.grind.stun, kb: [0, 0], hitstop: 2, reach: J.hit.reach, win: null, grind: true };
    else if (base === 'rasengan') s = { ...J.hit, win: null };
    else if (base === 'clone') s = { ...(part === 'last' ? J.last : J.hit), win: null };
    else if (base === 'rsh' && part === 'b') s = { dmg: J.burst.dmg, react: 'flinch', stun: J.burst.stun, kb: [0, 1.5], hitstop: 2, reach: J.hit.reach, win: null, guardBreak: true };
    else if (base === 'rsh') s = { ...J.hit, win: null };
    if (s) {
      s.react = REACT[s.react];
      // what Madara's wind barrier does with it (madarakit.js COUNTER_KIND): melee blown back, projectiles
      // reflected, ultimates and areas (fire, stakes, meteor: their cls comes with the data) deflected
      s.cls ||= base === 'shuriken' ? 'proj' : base === 'rsh' ? 'ult' : 'melee';
    }
  }
  cache[id] = s;
  return s;
}

/**
 * What a hit does. ctx: {
 *   ax, az, ayaw: attacker feet position and facing (yaw 0 = looking toward -z),
 *   vx, vz, vyaw: victim position and facing,
 *   air: victim is airborne (in a flight),
 *   combo: { n, start } hits so far in the victim's current combo and when it started (seconds), or null,
 *   t: hit time (seconds, server clock),
 *   guard: victim is guarding,
 *   dummy: victim is the training dummy (never moves)
 * }
 * Returns { dmg, react, stun (frames), hitstop (frames), kb: [x, y, z] (m/s), blocked, n (combo count incl. this) }.
 */
export function resolveHit(spec, ctx) {
  const out = { dmg: 0, react: spec.react, stun: spec.stun || 0, hitstop: spec.hitstop || 4, kb: [0, 0, 0], blocked: false, n: 1, dir: [0, 0] };
  // knockback direction: attacker -> victim on the ground plane (attacker's facing when they overlap)
  let dx = ctx.vx - ctx.ax, dz = ctx.vz - ctx.az;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l > 0.15) {
    dx /= l;
    dz /= l;
  } else {
    dx = -dsin(ctx.ayaw);
    dz = -dcos(ctx.ayaw);
  }
  out.dir = [dx, dz];
  // damage that falls off with the distance from the source (`c`: the meteor's impact point) to the victim
  let base = spec.dmg;
  if (spec.falloff) {
    const [r0, r1, d0, d1] = spec.falloff;
    base = d0 + (d1 - d0) * Math.min(1, Math.max(0, (l - r0) / (r1 - r0)));
  }
  // a damage-over-time tick (the burning field): damage only, no reaction, no combo, no scaling, never blocked
  if (spec.react === REACT.none) {
    out.dmg = Math.max(1, Math.round(base));
    out.stun = 0;
    out.hitstop = 0;
    out.n = 0;
    return out;
  }
  // guard: the attacker is in front of the victim (front 180 degrees)
  if (ctx.guard && !spec.unblockable) {
    const fx = -dsin(ctx.vyaw), fz = -dcos(ctx.vyaw);
    if (-(dx * fx + dz * fz) > 0) {
      if (spec.guardBreak) {
        out.react = REACT.guardBreak;
        out.stun = 60;
        out.dmg = Math.round(spec.dmg * 0.5);
        out.kb = [dx * 3, 0, dz * 3];
        out.hitstop = Math.max(out.hitstop, 8);
        out.n = 1;
        return out;
      }
      out.blocked = true;
      // chip: some jutsu wear through a guard
      if (spec.chip) out.dmg = Math.max(1, Math.round(base * spec.chip));
      out.react = REACT.guard;
      out.stun = 14;
      out.hitstop = Math.max(3, out.hitstop - 1);
      out.kb = [dx * 2.2, 0, dz * 2.2];
      out.n = 0;
      return out;
    }
  }
  if (ctx.dummy) {
    out.react = REACT.wobble;
    out.stun = 0;
  }
  // combo scaling: damage and hitstun shrink with every hit of one combo
  const n = ctx.combo ? ctx.combo.n : 0;
  out.n = n + 1;
  out.dmg = Math.max(1, Math.round(base * Math.max(COMBO.scaleFloor, 1 - COMBO.scalePer * n)));
  out.stun = Math.round(out.stun * Math.max(COMBO.stunFloor, 1 - COMBO.stunDecay * n));
  if (ctx.dummy) return out;
  let h = spec.kb[0], v = spec.kb[1];
  let react = spec.react;
  // an airborne victim stays in the air: light hits juggle
  if (ctx.air && (react === REACT.flinch || react === REACT.stagger)) {
    react = REACT.launch;
    h *= 0.5;
    v = Math.max(v, 5.2);
  }
  // anti-infinite: after too many hits or too long a combo, the next hit knocks the victim down (invulnerable get-up)
  if (ctx.combo && (out.n >= COMBO.maxHits || ctx.t - ctx.combo.start >= COMBO.maxTime) && !AIRBORNE.has(react)) {
    react = REACT.knockback;
    h = Math.max(h, 7);
    v = Math.max(v, 5);
  }
  out.react = react;
  out.kb = [dx * h, v, dz * h];
  return out;
}

// a KO'd fighter lies where it fell until it respawns (the respawn ends the reaction first)
export const KO_HOLD = 60000;

/**
 * A lethal hit (the server knows from the victim's HP, the attacker predicts it the same way): the victim is thrown
 * back and stays down. Every screen then plays the same deterministic KO flight. Mutates and returns res.
 */
export function koHit(res) {
  if (res.blocked) return res;
  res.ko = true;
  res.stun = 0;
  res.hitstop = Math.max(res.hitstop, 8);
  if (res.react === REACT.spike) return res; // already slams the victim down
  const h = Math.max(Math.sqrt(res.kb[0] * res.kb[0] + res.kb[2] * res.kb[2]), 6.5), v = Math.max(res.kb[1], 6);
  res.react = REACT.knockback;
  res.kb = [res.dir[0] * h, v, res.dir[1] * h];
  return res;
}

/**
 * The victim's combo after a hit (the server keeps one per victim; the attacker keeps its own guess).
 * `until` = when the victim's hitstun (or flight) ends: a hit before then continues the combo.
 */
export function comboAfter(combo, t, result, until) {
  if (result.blocked) return combo;
  const cont = combo && t <= combo.until + 0.05;
  return { n: cont ? combo.n + 1 : 1, start: cont ? combo.start : t, until };
}

/** Is a hit id's move active at `dt` seconds after the move started (with some network slack)? */
export function activeAt(spec, dt, slack = 0.06) {
  if (!spec.win) return true;
  return dt >= spec.win[0] - slack && dt <= spec.win[1] + slack + 0.05;
}

/** The deterministic flight of a reaction (feet start p, velocity kb). Same on every client and the server. */
export function reactionFlight(world, charId, react, p, kb) {
  const C = charOf(charId);
  const air = AIRBORNE.has(react);
  const f = new Flight(world, p[0], p[1], p[2], kb[0], kb[1], kb[2], {
    r: C.body.radius, h: C.body.height, gravity: air ? FLIGHT_G[react] : 26, fallMul: 1,
    bounce: air ? C.react.knockback.wallBounce : 0, friction: air ? 5 : 10, step: 0.3, snap: 0.6,
  });
  f.b.ground = !air;
  return f;
}

/**
 * When a reaction starting at t0 (ms, after hitstop) ends: { land, end } in ms (land = 0 for grounded reactions).
 * Airborne reactions fly until they land (at most 3 s), then the victim lies and gets up (invulnerable).
 */
export function reactionTimes(world, charId, react, p, kb, t0, stun, ko = false) {
  const C = charOf(charId);
  if (react === REACT.wobble) return { land: 0, end: t0 + 300 };
  if (!AIRBORNE.has(react)) return { land: 0, end: t0 + stun * (1000 / 60) };
  const f = reactionFlight(world, charId, react, p, kb);
  f.advance(3);
  const land = t0 + (f.landedAt > 0 ? f.landedAt : 3) * 1000;
  if (ko) return { land, end: land + KO_HOLD };
  return { land, end: land + (C.react.down.lie + C.react.down.getup) * (1000 / 60) };
}
