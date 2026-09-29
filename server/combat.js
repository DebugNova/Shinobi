// Server side of combat: every fighter's recent history (for lag-compensated rewinds), action windows, reactions
// (deterministic flights), invulnerability, and the validation of a client's hit report. Results come from the
// shared rules (src/shared/combat.js) and move data, never from the client's numbers.
import { hitSpec, resolveHit, comboAfter, activeAt, reactionFlight, reactionTimes, koHit, keepDaze, REACT, AIRBORNE } from '../src/shared/combat.js';
import { charOf } from '../src/shared/characters.js';
import { NET, ST } from '../src/shared/config.js';
import { castEffect, checkArea, COUNTER_KIND } from '../src/shared/madarakit.js';

const HIST = 48; // ~1.6 s of 30 Hz states
const r3 = (v) => Math.round(v * 1000) / 1000;

export class Combat {
  constructor(world, clock, log) {
    this.world = world;
    this.now = clock; // () => server ms
    this.log = log;
  }

  /** Per-fighter combat state (called once when a fighter is created). */
  init(p) {
    p.hist = [];
    p.acts = new Map(); // instance -> { m, at (ms, server clock), k }
    p.dashAt = -1e9;
    p.subAt = -1e9;
    p.react = null;
    p.combo = null;
    p.hitDone = new Map(); // `${attacker}:${instance}:${tick}` -> ms
    p.hitsAt = [];
    p.guard = false;
    p.counter = null; // Madara's wind barrier (Uchiha Return): { m, i, at, w: [start, end] ms, nr, last } (index.js)
    p.escape = null; // Itachi's Crow Clone Escape: [start, end] ms, invulnerable (index.js)
    p.cine = null; // Itachi's Amaterasu: [the press, its cinematic's end] ms, invulnerable (index.js)
    p.burn = null; // Amaterasu burning on this fighter: { att, i, left, next, k, every } (index.js)
  }

  /** Records a state (feet position etc.) at server time `at`. */
  record(p, at) {
    const s = p.s;
    let e = p.hist.length >= HIST ? p.hist.shift() : {};
    e.at = at;
    e.x = s[0];
    e.y = s[1];
    e.z = s[2];
    e.yaw = s[6];
    e.st = s[7];
    p.hist.push(e);
  }

  /** Where a fighter was at server time t (ms): its deterministic flight during a reaction, else its history. */
  posAt(p, t, out = {}) {
    const r = p.react;
    if (r && t >= r.t0 - r.hs * 16.67 && t <= r.end) return this.reactPos(r, t, out);
    const h = p.hist;
    if (!h.length) {
      out.x = p.s[0];
      out.y = p.s[1];
      out.z = p.s[2];
      out.yaw = p.s[6];
      return out;
    }
    if (t <= h[0].at) return Object.assign(out, { x: h[0].x, y: h[0].y, z: h[0].z, yaw: h[0].yaw });
    for (let i = h.length - 1; i >= 1; i--) {
      const a = h[i - 1], b = h[i];
      if (t >= a.at) {
        const k = Math.min(1, (t - a.at) / Math.max(1, b.at - a.at));
        out.x = a.x + (b.x - a.x) * k;
        out.y = a.y + (b.y - a.y) * k;
        out.z = a.z + (b.z - a.z) * k;
        out.yaw = k < 0.5 ? a.yaw : b.yaw;
        return out;
      }
    }
    const l = h[h.length - 1];
    return Object.assign(out, { x: l.x, y: l.y, z: l.z, yaw: l.yaw });
  }

  reactPos(r, t, out) {
    if (!r.flight) return Object.assign(out, { x: r.p[0], y: r.p[1], z: r.p[2], yaw: r.yaw });
    const s = Math.max(0, (t - r.t0) / 1000);
    // flights only simulate forward: asking for an earlier time starts over from the hit
    if (s < r.flight.t - 1e-9) r.flight = reactionFlight(this.world, r.ch, r.react, r.p, r.kb);
    const b = r.flight.advance(s);
    out.x = b.x;
    out.y = b.y;
    out.z = b.z;
    out.yaw = r.yaw;
    return out;
  }

  /** Is the fighter invulnerable at server time t (ms)? Dash start, substitution, knockdown/get-up, spawn protection. */
  invulnAt(p, t) {
    const C = charOf(p.ch);
    if (t < p.protectUntil) return 'spawn';
    if (t >= p.dashAt && t <= p.dashAt + C.move.dash.invuln * 1000) return 'dash';
    if (t >= p.subAt && t <= p.subAt + C.react.sub.invuln * 1000) return 'sub';
    if (p.escape && t >= p.escape[0] && t <= p.escape[1]) return 'crow';
    if (p.cine && t >= p.cine[0] && t <= p.cine[1]) return 'cinema'; // (his Amaterasu's cinematic: index.js)
    const r = p.react;
    if (r && r.land && t >= r.land && t <= r.end) return 'down';
    return null;
  }

  /**
   * In hitstun (or a flight) at t? Substitution is only allowed then. Every recent reaction counts: in a combo the
   * next hit replaces p.react before the victim's dash (sent on the previous hit) has arrived.
   */
  stunnedAt(p, t) {
    // a laggy victim hears about a light hit when most of its hitstun is over: 0.3 s of grace after it
    for (const w of p.stuns || []) if (t >= w[0] - 30 && t <= w[1] + 300) return true;
    return false;
  }

  /**
   * The victim's wind barrier that answers a hit of this spec at time `at` (ms), or null. It answers every class
   * (COUNTER_KIND), any number of times, for its whole window: nothing lands on him inside it.
   */
  counterFor(v, spec, at) {
    const c = v.counter;
    if (!c || !COUNTER_KIND[spec.cls]) return null;
    return at >= c.w[0] && at <= c.w[1] ? c : null;
  }

  /**
   * A client's hit report. msg: { v: victim id, m: hit id, i: instance, k: tick, at: hit time (ms, server clock),
   * vt: the time the attacker's screen showed the victim at, p: [x, y, z] victim position seen, a: [x, y, z, yaw]
   * attacker }. Returns { ok, why }. ctx: { players, dummy, phase, allowed }.
   */
  validate(att, msg, ctx) {
    const t = this.now();
    const v = msg.v === 0 ? ctx.dummy : ctx.players.get(msg.v);
    if (!v || v === att) return { ok: false, why: 'victim' };
    if (!att.alive || !v.alive || !ctx.allowed) return { ok: false, why: 'alive' };
    const spec = hitSpec(att.ch, String(msg.m));
    // (the barrier's blow, gust and reflection are the server's own hits: a client never reports them)
    if (!spec || spec.server) return { ok: false, why: 'move' };
    const at = Number(msg.at), vt = Number(msg.vt);
    if (!Number.isFinite(at) || !Number.isFinite(vt)) return { ok: false, why: 'time' };
    // the report can't be from the future, or older than the rewind cap plus the interpolation delay
    if (at > t + 50 || t - at > NET.rewindCap + NET.interpMax + 250) return { ok: false, why: 'late' };
    if (at - vt > NET.interpMax + 80 || vt > at + 20) return { ok: false, why: 'view' };
    // rate limit
    att.hitsAt = att.hitsAt.filter((x) => t - x < 1000);
    if (att.hitsAt.length >= 24) return { ok: false, why: 'rate' };
    // the move instance must exist and be active at the hit time
    const inst = att.acts.get(msg.i);
    const base = String(msg.m).split(':')[0];
    if (!inst) return { ok: false, why: 'instance' };
    if (inst.m !== msg.m && !(inst.k === 'jutsu' && inst.m === base) && !(base === 'clone' && inst.m === 'clones') && !(base === 'rsh' && inst.m === 'rasenshuriken')) return { ok: false, why: 'mismatch' };
    if (spec.win && !activeAt(spec, (at - inst.at) / 1000, 0.08)) return { ok: false, why: 'window' };
    // a homing shot (Itachi's fireballs, spec.dodge) is shaken off by a dash or a substitution while it flies: the
    // victim's own timing on the server clock decides (at 200 ms the attacker's screen sees the dash too late to drop
    // the lock itself, and would hit where the victim was)
    if (spec.dodge) {
      const ph = inst.phases?.[(msg.k | 0) + 1], dt = charOf(v.ch).move.dash.time * 1000;
      if (ph && ((v.dashAt + dt > ph.at && v.dashAt <= at) || (v.subAt > ph.at && v.subAt <= at))) return { ok: false, why: 'dodged' };
    }
    const key = `${att.id}:${msg.i}:${msg.k | 0}:${v.id}`;
    if (v.hitDone.has(key)) return { ok: false, why: 'dup' };
    // invulnerability at the hit time: a dodge that started before the hit wins
    const inv = this.invulnAt(v, at);
    if (inv) return { ok: false, why: `invuln:${inv}` };
    // geometry: the victim where the attacker saw it vs where the server's history had it at that view time
    const rew = this.posAt(v, Math.max(vt, t - NET.rewindCap - NET.interpMax), {});
    const p = Array.isArray(msg.p) && msg.p.length >= 3 && msg.p.every(Number.isFinite) ? msg.p : [rew.x, rew.y, rew.z];
    const tol = 1.4 + (v.dummy ? 0 : 0.4);
    if (Math.hypot(p[0] - rew.x, p[1] - rew.y, p[2] - rew.z) > tol) return { ok: false, why: 'far-from-history', rew };
    const a = Array.isArray(msg.a) && msg.a.length >= 4 && msg.a.every(Number.isFinite) ? msg.a : null;
    const ap = this.posAt(att, at, {});
    const ax = a ? a[0] : ap.x, ay = a ? a[1] : ap.y, az = a ? a[2] : ap.z, ayaw = a ? a[3] : ap.yaw;
    if (a && Math.hypot(a[0] - ap.x, a[2] - ap.z) > 2.5 + (t - at) * 0.012) return { ok: false, why: 'attacker-pos' };
    // a clone or projectile hit comes from its own position (must be near the caster's reach)
    const c = !spec.win && Array.isArray(msg.c) && msg.c.length >= 4 && msg.c.every(Number.isFinite) ? msg.c : null;
    if (spec.area) {
      // an area jutsu (fire, stakes, meteor): the victim must be inside the effect at the hit time, measured with the
      // same geometry the caster used (placed on this server from the cast's payload)
      if (!c) return { ok: false, why: 'source' };
      const why = checkArea(this.world, spec, inst, at, p, c, msg.k | 0);
      if (why) return { ok: false, why };
      if (spec.los && !this.world.clear(c[0], c[1] + 1.5, c[2], p[0], p[1] + 1.0, p[2])) return { ok: false, why: 'wall' };
    } else {
      if (c && Math.hypot(c[0] - ax, c[2] - az) > spec.reach + 4) return { ok: false, why: 'source' };
      const reach = spec.reach + 1.0;
      if (Math.hypot(p[0] - (c ? c[0] : ax), (p[1] - (c ? c[1] : ay)) * 0.7, p[2] - (c ? c[2] : az)) > (c ? 5.5 : reach)) return { ok: false, why: 'reach' };
    }
    // line of sight from the attacker's chest to the victim's chest (no hits through walls)
    if (spec.win && !this.world.clear(ax, ay + 1.1, az, p[0], p[1] + 1.0, p[2])) return { ok: false, why: 'wall' };
    return { ok: true, v, spec, at, p, rw: [r3(rew.x), r3(rew.y), r3(rew.z)], ax: c ? c[0] : ax, ay: c ? c[1] : ay, az: c ? c[2] : az, ayaw: c ? c[3] : ayaw, key };
  }

  /**
   * Applies a validated hit: damage, reaction (deterministic flight from p), combo state, victim seq bump.
   * Returns the broadcast message.
   */
  apply(att, val, msg) {
    const { v, spec, at, p, ax, az, ayaw } = val;
    const t = this.now();
    if (!val.srv) att.hitsAt.push(t); // (the server's own hits, burns included, don't count against the client's rate)
    v.hitDone.set(val.key, t);
    const air = !!(v.react && v.react.flight && AIRBORNE.has(v.react.react) && at < (v.react.land || v.react.end));
    const res = resolveHit(spec, {
      ax, az, ayaw,
      vx: p[0], vz: p[2], vyaw: v.s[6],
      air,
      combo: v.combo,
      t: at / 1000,
      // guarding, unless the hit lands inside a real reaction (a guard's own block stun keeps the guard up; the
      // victim's client predicts it that way too. `!v.react` alone ignored a guard until the old reaction was pruned
      // 2 s after it ended, and every hit of a string after the first went through a guard)
      guard: v.guard && !(v.react && at <= v.react.end && v.react.react !== REACT.guard),
      dummy: !!v.dummy,
    });
    // the hit that KOs: a knockdown the victim doesn't get up from (same rule as the attacker's prediction)
    if (!v.dummy && !res.blocked && v.hp - res.dmg <= 0) koHit(res);
    // a damage-only tick (the burning field): the victim keeps moving; no reaction, no teleport (seq), no combo
    if (res.react === REACT.none) {
      return { t: 'hitr', a: att.id, v: v.id, m: msg.m, i: msg.i, k: msg.k | 0, at: Math.round(at), t0: Math.round(at), d: res.dmg, r: REACT.none, st: 0, hs: 0, p: [r3(p[0]), r3(p[1]), r3(p[2])], kb: [0, 0, 0], l: 0, e: Math.round(at), n: 0, b: 0, sq: v.seq, rw: val.rw, res };
    }
    const hs = res.hitstop;
    const t0 = at + hs * (1000 / 60); // the reaction (and flight) starts after hitstop
    const p0 = [r3(p[0]), r3(p[1]), r3(p[2])];
    const kb = res.kb.map(r3);
    const { land, end } = reactionTimes(this.world, v.ch, res.react, p0, kb, t0, res.stun, !!res.ko);
    // (Tsukuyomi: a hit that doesn't throw a dazed victim leaves it dazed to the genjutsu's end: keepDaze)
    const prev = v.react;
    const dz = keepDaze({ end }, res.react, prev && !prev.ko && at <= prev.end ? prev.dz : 0, at, !!res.ko);
    const r = { react: res.react, ch: v.ch, t0, hs, p: p0, kb, yaw: v.s[6], land, end: dz.end, att: att.id, flight: null, ko: !!res.ko, dz: dz.dz || 0 };
    if (res.react !== REACT.wobble) r.flight = reactionFlight(this.world, v.ch, res.react, p0, kb);
    if (res.react === REACT.daze) v.combo = null; // (the genjutsu opens no combo: the hits in it start one)
    else if (!res.blocked) {
      v.combo = comboAfter(v.combo, at / 1000, res, (r.land || r.end) / 1000);
      res.n = v.combo.n;
    }
    // a flinch replaces the victim's movement too: the victim's own states from before it are stale
    v.react = r;
    // (a hit that lands came before the barrier rose: his screen's reaction ends the cast, so the barrier goes too;
    // inside the window nothing lands)
    if (v.counter) v.counter = null;
    // (substitution: out of a hit's own stun, never out of the genjutsu itself)
    if (res.react !== REACT.guard && res.react !== REACT.wobble && res.react !== REACT.daze) {
      (v.stuns ||= []).push([t0 - hs * (1000 / 60), r.land || end]);
      if (v.stuns.length > 6) v.stuns.shift();
    }
    v.seq++;
    return {
      t: 'hitr',
      a: att.id,
      v: v.id,
      m: msg.m,
      i: msg.i,
      k: msg.k | 0,
      at: Math.round(at),
      t0: Math.round(t0 * 10) / 10,
      d: res.dmg,
      r: res.react,
      st: res.stun,
      hs,
      p: p0,
      kb,
      l: Math.round(r.land),
      e: Math.round(r.end),
      n: res.n,
      b: res.blocked ? 1 : 0,
      ...(res.ko ? { ko: 1 } : {}),
      ...(r.dz ? { dz: Math.round(r.dz) } : {}),
      sq: v.seq,
      rw: val.rw, // where the server's rewound history had the victim (F4 draws it in yellow)
      res,
    };
  }

  /**
   * A later phase of a phased cast (Madara's kit): the effect's payload (relayed `out`: o, d, n, at) is placed once,
   * from the shared geometry, and kept on the act for validating its hits.
   */
  castPhase(p, act, out) {
    act.phases ||= {};
    act.phases[out.n] = { at: out.at, o: out.o, d: out.d, tg: out.tg };
    const fx = castEffect(this.world, act.m, out, p);
    if (fx) act.fx = fx;
  }

  /** Drops old bookkeeping. */
  prune(p, t) {
    for (const [i, a] of p.acts) if (t - a.at > (a.life || 4000)) p.acts.delete(i);
    for (const [k, at] of p.hitDone) if (t - at > 4000) p.hitDone.delete(k);
    if (p.react && t > p.react.end + 2000) p.react = null;
    if (p.combo && t / 1000 > p.combo.until + 1.5) p.combo = null;
    if (p.counter && t > p.counter.w[1] + 1000) p.counter = null;
  }
}

export { ST };
