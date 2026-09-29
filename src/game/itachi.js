// Itachi's jutsu kit (data: src/shared/itachi.js, shared geometry: src/shared/itachikit.js, visuals:
// src/gfx/itachifx.js + Madara's fire billows, clips: src/char/itachimoves.js). The local fighter's actions, the
// fireballs (the caster detects their hits, the server validates them like any projectile), and everyone's casts as
// visuals. The gazes (Tsukuyomi, Amaterasu) are decided by the server at the gaze's time (their hits arrive as hitr
// on every screen, the caster's included: never predicted), and so is the burning (server ticks).
//   Q  Phoenix Sage Fire   E  Tsukuyomi   G  Crow Clone Escape   R  Amaterasu
// Casts come in phases like Madara's: n:0 at the press (the server takes the cooldown / gauge, remotes start the
// pose), then n:1.. when the effect becomes real (a fireball leaves, the eyes meet, the body turns into crows).
import * as THREE from 'three';
import { ST, FLAG } from '../shared/config.js';
import { charOf } from '../shared/characters.js';
import { REACT } from '../shared/combat.js';
import { r3 } from '../shared/madarakit.js';
import { escapeSpot, shotDir } from '../shared/itachikit.js';
import { Billows } from '../gfx/madarafx.js';
import { EyeMarks, Crows, Feathers, InkStrokes } from '../gfx/itachifx.js';
import { SealFx } from '../gfx/tsukuyomifx.js';
import { TsukuyomiWorld } from './tsukuyomi.js';
import { AmaterasuCinema } from './amaterasu.js';
import { segSeg } from './hurtbox.js';
import { warpHidden } from '../gfx/movefx.js';

const F = 1 / 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const turn = (yaw, to, rate, dt) => yaw + clamp(wrap(to - yaw), -rate * dt, rate * dt);
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const QUALITY = { low: 0.4, medium: 0.7, high: 1, ultra: 1.3 };
const CAST_CLIPS = new Set(['ita_fire', 'ita_fire_air', 'ita_tsukuyomi', 'ita_tsukuyomi_air', 'ita_crow', 'ita_amaterasu', 'ita_amaterasu_air']);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _prev = new THREE.Vector3(), _dir = new THREE.Vector3(), _nrm = new THREE.Vector3(), _ink = new THREE.Vector3(), _gnd = {};
// the crow shift's ink: [half width (m), lean, life (s), height above the feet (m), alpha] per strand. The dash: one
// slim streak at the hips and a thin dry flick above it (the owner's reference: a single ragged stroke, not a mass of
// black; the first version, body-high strands + upright ink blots where he was, read as overdone). The escape's
// flight: bolder, it crosses 20 m.
const SHIFT_STRANDS = [[0.3, 0.45, 0.36, 0.8, 0.88], [0.09, -0.5, 0.26, 1.22, 0.8]];
const COMET_STRANDS = [[0.62, 0.5, 0.6, 1.0, 1], [0.4, -0.6, 0.5, 1.05, 1], [0.16, 0.2, 0.42, 1.5, 1]];
const INK = [0.03, 0.024, 0.06]; // ink puffs (normal-blended toon discs)
const AQUA = [0.35, 1.9, 1.6]; // chakra sparks (HDR: the bloom takes them)

/** World position of a fighter's bone (drawn pose). */
function bonePos(fighter, name, out) {
  const n = fighter?.vrm?.humanoid.getRawBoneNode(name);
  return n ? n.getWorldPosition(out) : null;
}

// ---------------------------------------------------------------- the casts (local fighter)

/** Shared by the casts: hang in the air through them (like Madara's), face the target (or the camera's way). */
class Cast {
  constructor(K, ctrl, m, range) {
    const g = K.game;
    this.K = K;
    this.jutsu = true;
    this.owns = true;
    this.netState = ST.jutsu;
    this.m = m;
    this.D = ctrl.C.jutsu[m];
    this.t = 0;
    this.inst = K.J.nextInst();
    this.air = !ctrl.grounded;
    this.target = range ? g.combat.aimTarget(ctrl, range) : null;
    if (this.air) {
      this.physicsOpts = { ...ctrl.opts, gravity: ctrl.opts.gravity * 0.15, fallMul: 1 };
      ctrl.body.vy = Math.max(0, ctrl.body.vy * 0.2);
    }
    ctrl.sprint = false;
    // (the press on the shared clock: Amaterasu's cinematic runs from it on every screen)
    this.at = Math.round(g.net.serverNow());
    g.net.act('jutsu', { m, i: this.inst, f: this.air ? 1 : 0, tg: this.target?.id, at: this.at });
    g.lastFight = performance.now();
  }

  /** Brakes, hangs, turns toward the target at `rate` rad/s (while `aim`). */
  hold(ctrl, dt, aim, rate) {
    const b = ctrl.body;
    b.vx *= 0.8;
    b.vz *= 0.8;
    if (this.air && b.vy > 0) b.vy *= 0.85;
    if (!aim) return;
    const T = this.target && !this.target.dead && (this.K.J.targetPos(this.target.id, _w) || this.target);
    const want = T ? Math.atan2(-(T.x - b.x), -(T.z - b.z)) : this.K.game.cam.yaw;
    ctrl.yaw = ctrl.moveYaw = turn(ctrl.yaw, want, rate, dt);
  }
}

/** Q: the Tiger seal, the fingers to the mouth, three fireballs one after another (each its own phase n = 1..3). */
class FireAction extends Cast {
  constructor(K, ctrl) {
    super(K, ctrl, 'phoenixFire', 40);
    this.shot = 0;
    K.game.audio?.handsign?.();
  }

  anim() {
    return { clip: this.air ? 'ita_fire_air' : 'ita_fire', t: this.t, key: `ifire${this.inst}` };
  }

  step(ctrl, input, dt) {
    const D = this.D;
    this.t += dt;
    this.hold(ctrl, dt, true, 10);
    if (Math.abs(this.t - (D.seal + 3) * F) < dt * 0.5) this.K.game.audio?.inhale?.();
    while (this.shot < D.shots.length && this.t >= D.shots[this.shot] * F) this.K.shoot(ctrl, this, this.shot++);
    return this.t < D.total * F;
  }
}

/** E: the eyes meet the enemies' at `gaze` (Tsukuyomi): phase n:1 with the eyes and facing. */
class GazeAction extends Cast {
  constructor(K, ctrl, m) {
    super(K, ctrl, m, ctrl.C.jutsu[m].range + 2);
    this.gazeF = this.D.gaze;
    this.done = false;
    K.game.audio?.handsign?.();
  }

  anim() {
    return { clip: this.air ? 'ita_tsukuyomi_air' : 'ita_tsukuyomi', t: this.t, key: `igaze${this.inst}` };
  }

  step(ctrl, input, dt) {
    this.t += dt;
    this.hold(ctrl, dt, !this.done, 11);
    if (!this.done && this.t >= this.gazeF * F) {
      this.done = true;
      this.K.gaze(ctrl, this);
    }
    return this.t < this.D.total * F;
  }
}

/**
 * R: Amaterasu. Its cinematic starts on every screen from the press (amaterasu.js); he turns to the target until the
 * pick (n:1: his eyes and facing: the server takes the cone and tells everyone who), then acts it out, untouchable
 * from the press to the cinematic's end (the server keeps the same window). In the air he hangs where he is.
 */
class AmaterasuAction extends Cast {
  constructor(K, ctrl) {
    super(K, ctrl, 'amaterasu', ctrl.C.jutsu.amaterasu.range + 2);
    ctrl.invulnUntil = (ctrl.t || K.game.net.serverNow() / 1000) + this.D.cinema[1] * F;
    if (this.air) {
      this.physicsOpts = { ...ctrl.opts, gravity: 0, fallMul: 1 };
      ctrl.body.vy = 0;
    }
    this.done = false;
    K.game.audio?.ult?.();
    K.cine.start(K.game.net.id, this.inst, this.at, ctrl.C.id);
  }

  anim() {
    return { clip: this.air ? 'ita_amaterasu_air' : 'ita_amaterasu', t: this.t, key: `igaze${this.inst}` };
  }

  step(ctrl, input, dt) {
    this.t += dt;
    this.hold(ctrl, dt, !this.done, 11);
    if (this.air) ctrl.body.vy = 0;
    if (!this.done && this.t >= this.D.pick * F) {
      this.done = true;
      this.K.gaze(ctrl, this);
    }
    return this.t < this.D.total * F;
  }
}

/**
 * G: the body bursts into crows at `vanish` and he is moved to the safest spot nearby (picked at the press; phase n:1
 * carries it to everyone), where the crows gather and he re-forms. Invulnerable from the press (FLAG.invuln in his
 * states; the server keeps the same window). The fighter is hidden from the vanish to the re-forming (updateItachi).
 */
class CrowAction extends Cast {
  constructor(K, ctrl) {
    super(K, ctrl, 'crowEscape', 0);
    ctrl.invulnUntil = (ctrl.t || K.game.net.serverNow() / 1000) + this.D.invuln;
    this.spot = K.pickSpot(ctrl, this.D);
    this.moved = false;
  }

  anim() {
    return { clip: 'ita_crow', t: this.t, key: `icrow${this.inst}` };
  }

  step(ctrl, input, dt) {
    this.t += dt;
    this.hold(ctrl, dt, false);
    if (!this.moved && this.t >= this.D.vanish * F) {
      this.moved = true;
      this.K.vanish(ctrl, this);
    }
    return this.t < this.D.total * F;
  }
}

// jutsu id -> { ok(J, ctrl), start(J, ctrl) } (merged into jutsu.js's registry)
export const ITACHI_CASTS = {
  phoenixFire: { ok: () => true, start: (J, ctrl) => new FireAction(J.itachi, ctrl) },
  tsukuyomi: { ok: () => true, start: (J, ctrl) => new GazeAction(J.itachi, ctrl, 'tsukuyomi') },
  crowEscape: { ok: () => true, start: (J, ctrl) => new CrowAction(J.itachi, ctrl) },
  amaterasu: { ok: () => true, start: (J, ctrl) => new AmaterasuAction(J.itachi, ctrl) },
};

// ---------------------------------------------------------------- the kit

export class ItachiKit {
  constructor(J) {
    this.J = J;
    this.game = J.game;
    const s = this.game.scene;
    this.black = new Billows(s, false, true); // Amaterasu's flames (opaque, ink-outlined, the black ramp)
    this.marks = new EyeMarks(s); // Tsukuyomi's marks, the Mangekyō in his eyes
    this.crows = new Crows(s);
    this.feathers = new Feathers(s);
    this.seal = new SealFx(s); // Tsukuyomi's Mangekyō: the capture round a victim, the eye before him as he casts
    this.ink = new InkStrokes(s); // the crow shift's brush ink (his dash, the escape's flight)
    this.shifts = new Map(); // Itachi fighter -> { on, strands, px, pz, dx, dz }: his dash as ink (updateShift)
    this.comets = []; // the escape's ink flights (inkComet)
    this.world = new TsukuyomiWorld(this); // Tsukuyomi's world on its victim's own screen (tsukuyomi.js)
    this.cine = new AmaterasuCinema(this); // Amaterasu's cinematic, on every screen at once (amaterasu.js)
    this.balls = []; // fireballs in flight (see addBall)
    this.dazed = new Map(); // victim id -> { t0, until } (server ms): the Tsukuyomi mark
    this.burning = new Map(); // victim id -> { t0, last } (server ms, `last`: the last tick heard)
    this.per = new Map(); // Itachi fighter -> { key, last (clip frame), burst, arrived, dest, t }
    this.time = 0;
  }

  get fire() {
    return this.J.madara.billows;
  }

  get smoke() {
    return this.J.madara.smoke;
  }

  quality() {
    return QUALITY[this.game.preset] ?? 1;
  }

  /** 1 at the local fighter, fading to 0 at `range` metres. */
  nearness(p, range) {
    const me = this.game.player?.pos;
    return me ? clamp(1 - Math.hypot(me.x - p.x, me.z - p.z) / range, 0, 1) : 0;
  }

  /** Every object whose program must compile behind the loading screen (main.js warmShaders). */
  warm(on, p) {
    if (on) {
      const i = this.black.take();
      this.black.set(i, p.x, p.y, p.z, 0.5, 1, 0.2, 0.3, 0);
      this.black.update(0);
      this.warmBlack = i;
      this.marks.begin();
      this.marks.set(p.x, p.y + 1, p.z, 0.3, 1, 1, 0, 1);
      this.marks.set(p.x + 0.5, p.y + 1, p.z, 0.05, -1, 1, 0, 1);
      this.marks.end();
      this.crows.burst(p.x, p.y + 1, p.z, 1, 1, 0, 0.5);
      this.crows.update(0.01);
      this.feathers.puff(p.x, p.y + 1, p.z, 2);
      this.feathers.update(0.01);
      const S = this.ink.add(0.6, 0.5, 1);
      this.ink.push(S, p.x, p.y, p.z);
      this.ink.push(S, p.x + 1, p.y, p.z);
      this.ink.update(0.01);
      this.seal.begin();
      this.seal.set(p, 0.5, null, 0, { flash: 1, violet: 1, blades: 1, ring: 1, seal: 1, ink: 1 }, 0.5, 0, null, 1);
      this.seal.end();
      this.world.warm(true, p);
    } else {
      this.black.give(this.warmBlack);
      this.black.update(0);
      this.marks.begin();
      this.marks.end();
      this.crows.clear();
      this.ink.clear();
      this.seal.begin();
      this.seal.end();
      this.world.warm(false);
    }
  }

  // ---------------------------------------------------------------- where the eyes are

  /**
   * His eyes on the drawn face: the head bone plus the character's `eyes` offsets turned with the head (the
   * normalized head bone's frame: +z forward, +x his left). out = midpoint; outL/outR each eye (optional).
   */
  eyes(fighter, C, out, outL, outR) {
    const h = fighter?.vrm?.humanoid;
    const raw = h?.getRawBoneNode('head');
    if (!raw) return out.set(fighter.pos.x, fighter.pos.y + 1.55, fighter.pos.z);
    raw.getWorldPosition(out);
    const E = C.eyes || { up: 0.07, fwd: 0.085, apart: 0.032 };
    const nrm = h.getNormalizedBoneNode?.('head');
    if (nrm) nrm.getWorldQuaternion(_q);
    else _q.setFromAxisAngle(_u.set(0, 1, 0), fighter.yaw + Math.PI);
    // (the VRM faces +z in its own frame; the fighter's body turns it by pi: the normalized frame already has that)
    const up = _c1.set(0, 1, 0).applyQuaternion(_q), fw = _c2.set(0, 0, 1).applyQuaternion(_q);
    out.addScaledVector(up, E.up).addScaledVector(fw, E.fwd);
    if (outL || outR) {
      const left = _u.set(1, 0, 0).applyQuaternion(_q);
      if (outL) outL.copy(out).addScaledVector(left, E.apart);
      if (outR) outR.copy(out).addScaledVector(left, -E.apart);
    }
    return out;
  }

  // ---------------------------------------------------------------- Q: fireballs

  /** Fireball k leaves the mouth: toward the target's chest (or where the camera looks), turned by the shot's spread. */
  shoot(ctrl, a, k) {
    const g = this.game, me = g.player, D = a.D;
    const yaw = ctrl.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const head = bonePos(me, 'head', _v) || _v.set(ctrl.body.x, ctrl.body.y + 1.5, ctrl.body.z);
    const o = [head.x + fx * D.mouth, head.y - 0.02, head.z + fz * D.mouth].map(r3);
    const tp = a.target && !a.target.dead && this.J.targetPos(a.target.id, _w);
    let aim;
    if (tp) {
      const l = Math.hypot(tp.x - o[0], tp.y - o[1], tp.z - o[2]) || 1;
      aim = [(tp.x - o[0]) / l, (tp.y - o[1]) / l, (tp.z - o[2]) / l];
    } else {
      const cd = g.camera.getWorldDirection(_u);
      aim = [cd.x, clamp(cd.y, -0.35, 0.35), cd.z];
    }
    const d = shotDir(D, aim, k).map(r3);
    const at = Math.round(g.net.serverNow());
    g.net.act('jutsu', { m: 'phoenixFire', i: a.inst, n: k + 1, o, d, tg: a.target?.id, at });
    this.addBall({ owner: g.net.id, mine: true, inst: a.inst, k, o, d, tg: a.target?.id, at, C: ctrl.C, fighter: me });
  }

  /** A fireball on this screen (ours or a remote's), fast-forwarded to now when its news came late. */
  addBall(e) {
    const J = e.C.jutsu.phoenixFire, P = J.proj, q = this.quality();
    const b = {
      ...e, J, P, pos: new THREE.Vector3(...e.o), dir: new THREE.Vector3(...e.d).normalize(), speed: P.speed, t: 0, lost: false,
      last: e.k === J.shots.length - 1, core: [], hitSet: new Set(), spin: Math.random() * 6.283,
    };
    for (let n = 0; n < Math.max(3, Math.round(6 * q)); n++) b.core.push(this.fire.take());
    this.balls.push(b);
    // the breath of fire at the lips
    for (let n = 0; n < 6; n++) this.fire.puff(b.pos.x, b.pos.y, b.pos.z, b.dir.x * 4 + (Math.random() - 0.5) * 2, b.dir.y * 4 + Math.random(), b.dir.z * 4 + (Math.random() - 0.5) * 2, 0.22, 0.12, 0.4, 1, 0, 3);
    this.game.fx.emit(5, b.pos.x, b.pos.y, b.pos.z, 0, 0, 0, 0.1, 0.2, 0.55, 2.2, 1.0, 0.25, 0.8);
    this.game.audio?.fireball?.(b.pos);
    // (a remote's shot heard late: fly it forward, no hits, to where it is now)
    const late = e.mine ? 0 : clamp((this.game.net.serverNow() - e.at) / 1000, 0, 0.35);
    for (let s = 0; s < late - 1e-6; s += F) this.moveBall(b, Math.min(F, late - s), false);
    return b;
  }

  /** Is the fighter `id` dashing (or otherwise untouchable) right now on this screen? A dash shakes a fireball off. */
  dodging(id) {
    const g = this.game;
    if (id === g.net.id) {
      const c = g.ctrl;
      return c.st === ST.dash || (c.t || 0) < c.invulnUntil;
    }
    if (id === 0 || id === undefined || id === null) return false;
    const v = g.remotes.get(id)?.view;
    return !!v && (v.st === ST.dash || ((v.flags ?? 0) & FLAG.invuln) !== 0);
  }

  /** One step of a fireball: homing (a turn-rate limit), speeding up, walls. Returns false when it struck something. */
  moveBall(b, dt, live) {
    const g = this.game, P = b.P;
    b.t += dt;
    if (!b.lost && b.tg !== undefined && b.tg !== null && this.dodging(b.tg)) {
      // dodged: the lock is gone for good, it flies on straight
      b.lost = true;
      if (live) g.fx.emit(5, b.pos.x, b.pos.y, b.pos.z, 0, 0, 0, 0.1, 0.4, 1.1, 2.4, 1.0, 0.2);
    }
    const tp = !b.lost && this.J.targetPos(b.tg, _w);
    if (tp) {
      // an intercept course: the target's velocity (smoothed from its drawn motion; a teleport resets it) leads the
      // aim point by the time the ball needs to get there, so running doesn't shake it off, only a dash does
      if (b.tpx !== undefined && dt > 1e-4 && Math.hypot(tp.x - b.tpx, tp.z - b.tpz) < 2.5) {
        const k = 1 - Math.exp(-dt / 0.1);
        b.tvx += (clamp((tp.x - b.tpx) / dt, -20, 20) - b.tvx) * k;
        b.tvy += (clamp((tp.y - b.tpy) / dt, -20, 20) - b.tvy) * k;
        b.tvz += (clamp((tp.z - b.tpz) / dt, -20, 20) - b.tvz) * k;
      } else b.tvx = b.tvy = b.tvz = 0;
      b.tpx = tp.x;
      b.tpy = tp.y;
      b.tpz = tp.z;
      const lead = Math.min(0.8, tp.distanceTo(b.pos) / b.speed);
      tp.x += b.tvx * lead;
      tp.y += b.tvy * lead * 0.5;
      tp.z += b.tvz * lead;
      _dir.copy(tp).sub(b.pos);
      const l = _dir.length();
      if (l > 0.3) {
        _dir.divideScalar(l);
        const cos = clamp(b.dir.dot(_dir), -1, 1), ang = Math.acos(cos), max = P.turn * dt;
        if (ang > 1e-4) {
          // rotate the heading toward the target by at most `max` about their common normal
          _u.crossVectors(b.dir, _dir);
          if (_u.lengthSq() < 1e-10) _u.set(0, 1, 0);
          b.dir.applyAxisAngle(_u.normalize(), Math.min(ang, max)).normalize();
        }
      }
    }
    b.speed = P.speed + P.accel * b.t;
    const step = b.speed * dt;
    _prev.copy(b.pos);
    const hit = g.world.raycast(b.pos.x, b.pos.y, b.pos.z, b.dir.x, b.dir.y, b.dir.z, step + P.radius * 0.5);
    if (hit < step + P.radius * 0.5) {
      b.pos.addScaledVector(b.dir, Math.max(0, hit - P.radius * 0.3));
      return false;
    }
    b.pos.addScaledVector(b.dir, step);
    return true;
  }

  updateBalls(dt) {
    const g = this.game, q = this.quality(), B = this.fire, now = g.net.serverNow();
    let w = 0;
    for (const b of this.balls) {
      let alive = this.moveBall(b, dt, true) && b.t < b.P.life;
      // the caster's copy decides the hits: its swept path against the drawn hurtboxes
      if (alive && b.mine) {
        for (const t of g.combat.targets()) {
          if (b.hitSet.has(t.id) || !t.hurt?.valid) continue;
          if (!t.dummy && (t.entry.react?.invuln?.(now) || (t.entry.view?.flags ?? 0) & FLAG.invuln)) continue;
          let hitP = null;
          for (const c of t.hurt.caps) {
            if (segSeg(_prev, b.pos, c.a, c.b, _c1, _c2) <= (b.P.radius + c.r) ** 2) {
              hitP = _c2.clone();
              break;
            }
          }
          if (!hitP) continue;
          b.hitSet.add(t.id);
          g.combat.landHit({ id: b.last ? 'phoenixFire:last' : 'phoenixFire:shot', inst: b.inst, k: b.k, from: { x: b.pos.x, y: b.pos.y, z: b.pos.z } }, t, hitP);
          alive = false;
          break;
        }
      } else if (alive && !b.mine) {
        // another screen's fireball: it bursts on a body it reaches here too (the owner's screen decides the damage)
        for (const t of this.bodies()) {
          if (!t.hurt?.valid || t.id === b.owner) continue;
          if (t.hurt.caps.some((c) => segSeg(_prev, b.pos, c.a, c.b, _c1, _c2) <= (b.P.radius + c.r) ** 2)) {
            alive = false;
            break;
          }
        }
      }
      if (!alive) {
        this.explode(b);
        continue;
      }
      // the ball: a knot of fire blobs turning about its heading, swelling out of the mouth, stretched by its speed
      const grow = ss(0, 0.12, b.t), sp = b.speed;
      _u.set(0, 1, 0);
      const side = _c1.crossVectors(b.dir, _u);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const up = _c2.crossVectors(side, b.dir);
      b.spin += dt * 9;
      for (let n = 0; n < b.core.length; n++) {
        const a = b.spin + (n / b.core.length) * 6.283, rr = n === 0 ? 0 : 0.2;
        const x = b.pos.x + (side.x * Math.cos(a) + up.x * Math.sin(a)) * rr, y = b.pos.y + (side.y * Math.cos(a) + up.y * Math.sin(a)) * rr, z = b.pos.z + (side.z * Math.cos(a) + up.z * Math.sin(a)) * rr;
        B.set(b.core[n], x, y, z, (n === 0 ? 0.46 : 0.3) * grow, n === 0 ? 1 : 0.9, 0.04, n * 0.13 + b.inst * 0.001, 0, b.dir.x, b.dir.y, b.dir.z, 1 + Math.min(0.35, sp / 90));
      }
      // its tail: blobs shed behind it, cooling as they fall back; smoke off the top; embers
      for (let n = Math.round(dt * 70 * q + Math.random() * 0.8); n > 0; n--) {
        const j = () => (Math.random() - 0.5) * 0.3;
        B.puff(b.pos.x - b.dir.x * 0.3 + j(), b.pos.y - b.dir.y * 0.3 + j(), b.pos.z - b.dir.z * 0.3 + j(), b.dir.x * sp * 0.35 + j() * 3, b.dir.y * sp * 0.35 + j() * 3, b.dir.z * sp * 0.35 + j() * 3, 0.13 + Math.random() * 0.08, 0.3 * grow, 0.08, 0.9, 0, 5);
      }
      if (Math.random() < dt * 3.5 * q) this.smoke.puff(b.pos.x - b.dir.x, b.pos.y + 0.2, b.pos.z - b.dir.z, 0, 1.0, 0, 0.7, 0.18, 0.5, 0.3, 1, 1.5);
      if (Math.random() < dt * 14 * q) g.fx.embers(b.pos.x, b.pos.y, b.pos.z, 1, 0.4, 1.5);
      // (a faint warm halo: the toon-banded blobs and the bloom on their hot cores do the rest)
      if (Math.random() < dt * 20) g.fx.emit(5, b.pos.x, b.pos.y, b.pos.z, 0, 0, 0, 0.1, 0.5 * grow, 0.75 * grow, 1.4, 0.55, 0.12, 0.35);
      if (g.post.hazeOn) g.post.haze.add(b.pos.x, b.pos.y, b.pos.z, 1.1, 0.55);
      this.balls[w++] = b;
    }
    this.balls.length = w;
  }

  /** A fireball bursts: a ball of flame and smoke, embers, a shake up close. */
  explode(b) {
    const g = this.game, q = this.quality(), p = b.pos;
    for (const i of b.core) this.fire.give(i);
    b.core.length = 0;
    for (let n = 0; n < Math.round(18 * q) + 4; n++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u), sp = 3 + Math.random() * 5;
      this.fire.puff(p.x, p.y, p.z, Math.cos(a) * s * sp, u * sp * 0.7 + 1.5, Math.sin(a) * s * sp, 0.4 + Math.random() * 0.3, 0.3, 0.8 + Math.random() * 0.4, 1, 0, 3);
    }
    for (let n = 0; n < Math.round(4 * q) + 1; n++) this.smoke.puff(p.x + (Math.random() - 0.5), p.y + 0.3, p.z + (Math.random() - 0.5), (Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2, 0.9 + Math.random() * 0.4, 0.35, 1.0, 0.4, 1, 1.2);
    g.fx.impact(p, 2.5, [3.4, 1.5, 0.3]);
    g.fx.embers(p.x, p.y, p.z, Math.round(10 * q), 0.8, 3);
    const gy = g.world.ground(p.x, p.z, p.y + 0.3, _gnd).y;
    if (p.y - gy < 1.2) {
      g.fx.dust({ x: p.x, y: gy, z: p.z }, 6, 1.2, [0.4, 0.33, 0.27]);
      g.fx.emit(4, p.x, gy + 0.05, p.z, 0, 0, 0, 0.4, 0.3, 2.4, 1.6, 0.9, 0.35, 0.8);
    }
    g.audio?.fireBoom?.(p);
    const near = this.nearness(p, 14);
    if (near > 0) g.cam.addTrauma(0.22 * near);
  }

  // ---------------------------------------------------------------- E / R: the gaze

  /** The eyes meet theirs: phase n:1 with his eyes and his facing (the server decides who it takes). */
  gaze(ctrl, a) {
    const g = this.game, yaw = ctrl.yaw;
    const e = this.eyes(g.player, ctrl.C, _v);
    const o = [e.x, e.y, e.z].map(r3), d = [-Math.sin(yaw), 0, -Math.cos(yaw)].map(r3);
    g.net.act('jutsu', { m: a.m, i: a.inst, n: 1, o, d, at: Math.round(g.net.serverNow()) });
  }

  /** The flare in his eyes as a gaze takes hold (every screen, from the clip's frame). */
  gazeFx(f, C, m) {
    const g = this.game, e = this.eyes(f, C, _v), q = this.quality();
    const ama = m === 'amaterasu';
    g.fx.emit(5, e.x, e.y, e.z, 0, 0, 0, 0.15, 0.04, ama ? 0.35 : 0.45, ama ? 1.6 : 3.0, 0.06, ama ? 0.2 : 0.1);
    g.fx.emit(1, e.x, e.y, e.z, 0, 0, 0, 0.24, 0.15, ama ? 0.9 : 1.2, ama ? 1.2 : 2.4, 0.03, ama ? 0.2 : 0.08);
    const gy = g.world.ground(f.pos.x, f.pos.z, f.pos.y + 0.3, _gnd).y;
    // a wave of red chakra rolling out along the ground in front of him
    g.fx.emit(4, f.pos.x, gy + 0.05, f.pos.z, 0, 0, 0, 0.55, 0.4, m === 'amaterasu' ? 9 : 6, 1.6, 0.04, 0.08, 0.9);
    for (let n = 0; n < Math.round(14 * q); n++) {
      const a = f.yaw + (Math.random() - 0.5) * 1.3, s = 8 + Math.random() * 10;
      g.fx.emit(2, e.x, e.y, e.z, -Math.sin(a) * s, (Math.random() - 0.5) * 3, -Math.cos(a) * s, 0.25 + Math.random() * 0.2, 0.05, 0.02, 2.6, 0.06, 0.08);
    }
    if (m === 'amaterasu') g.audio?.amaterasuFocus?.(f.pos);
    else g.audio?.genjutsu?.(f.pos, false);
    const near = this.nearness(f.pos, 20);
    if (near > 0) g.cam.addTrauma(0.2 * near);
  }

  // ---------------------------------------------------------------- G: the crows

  /** The safest spot for the escape (itachikit.js escapeSpot): away from every enemy, out of their sight if it can. */
  pickSpot(ctrl, D) {
    const g = this.game, b = ctrl.body, enemies = [];
    for (const r of g.remotes.values()) if (r.fighter && !r.fighter.dead) enemies.push({ x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z });
    // (null: nowhere free round him; he re-forms where he stands)
    return escapeSpot(g.world, D, [b.x, b.y, b.z], enemies);
  }

  /** The body bursts into crows: phase n:1 with the spot (everyone moves him there), crows scatter and gather. */
  vanish(ctrl, a) {
    const g = this.game, b = ctrl.body, D = a.D, f = g.player;
    const from = new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z);
    const to = a.spot || [b.x, b.y, b.z];
    const at1 = Math.round(g.net.serverNow());
    g.net.act('jutsu', { m: 'crowEscape', i: a.inst, n: 1, o: to.map(r3), at: at1 });
    const S = this.stateOf(f, `icrow${a.inst}`);
    this.crowBurst(f, from, S);
    // he re-forms facing the nearest enemy (else the way he faced)
    let yaw = ctrl.yaw, best = 1e9;
    for (const r of g.remotes.values()) {
      if (!r.fighter || r.fighter.dead) continue;
      const d = Math.hypot(r.fighter.pos.x - to[0], r.fighter.pos.z - to[2]);
      if (d < best) {
        best = d;
        yaw = Math.atan2(-(r.fighter.pos.x - to[0]), -(r.fighter.pos.z - to[2]));
      }
    }
    // (moved here, not with ctrl.teleportTo: that would end this action)
    ctrl.prevX = b.x = to[0];
    ctrl.prevY = b.y = to[1];
    ctrl.prevZ = b.z = to[2];
    b.vx = b.vy = b.vz = 0;
    b.ground = true;
    a.physicsOpts = null;
    ctrl.prevYaw = ctrl.yaw = ctrl.moveYaw = yaw;
    ctrl.wall = null;
    ctrl.vault = null;
    g.visOff = [0, 0, 0];
    f.snap(to[0], to[1], to[2], yaw);
    this.crowGather(f, from, to, at1 + (D.form - D.vanish) * F * 1000, S);
  }

  /** Per-fighter state for its current cast (keyed by the clip key). */
  stateOf(f, key) {
    let S = this.per.get(f);
    if (!S || S.key !== key) this.per.set(f, (S = { key, last: -1, burst: false, arrived: false, dest: null, formAt: 0, shown: false }));
    return S;
  }

  /** Crows burst out of the body in every direction; feathers and a puff of dark smoke where it stood. */
  crowBurst(f, from, S) {
    if (S.burst) return;
    S.burst = true;
    const g = this.game, q = this.quality();
    const n = Math.round(34 * q) + 6;
    for (let k = 0; k < n; k++) {
      const h = 0.2 + Math.random() * 1.5, a = Math.random() * 6.283, sp = 3.5 + Math.random() * 5;
      this.flyOff(from.x + Math.cos(a) * 0.2, from.y + h, from.z + Math.sin(a) * 0.2, Math.cos(a) * sp, 1 + Math.random() * 5 + (h - 0.8) * 2, Math.sin(a) * sp, 1.1 + Math.random() * 1.3);
    }
    this.feathers.puff(from.x, from.y + 1.0, from.z, Math.round(26 * q) + 4, 0.8, 4);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * 6.283;
      g.fx.emit(0, from.x + Math.cos(a) * 0.3, from.y + 0.5 + Math.random() * 1.1, from.z + Math.sin(a) * 0.3, Math.cos(a) * 1.4, 0.6, Math.sin(a) * 1.4, 0.6 + Math.random() * 0.3, 0.4, 1.1, 0.11, 0.1, 0.13);
    }
    g.fx.emit(5, from.x, from.y + 1.1, from.z, 0, 0, 0, 0.12, 0.4, 1.4, 0.7, 0.05, 0.08);
    this.inkSplash(from, 0, 0, 1.25);
    g.audio?.crows?.(from);
  }

  /** Crows fly in to the spot from round it (some from where he vanished) and arrive as he re-forms at formAt (server ms). */
  crowGather(f, from, to, formAt, S) {
    const q = this.quality(), dur = clamp((formAt - this.game.net.serverNow()) / 1000, 0.12, 0.6);
    S.arrived = true;
    S.dest = to;
    S.formAt = formAt;
    // the ink streaks across to the spot, arriving with the crows (the same frame clock as theirs)
    this.inkComet(from, to, dur);
    const n = Math.round(16 * q) + 4;
    for (let k = 0; k < n; k++) {
      let sx, sy, sz;
      if (k < n * 0.35) {
        // from where he vanished, streaking across
        sx = from.x + (Math.random() - 0.5) * 2;
        sy = from.y + 0.8 + Math.random() * 1.5;
        sz = from.z + (Math.random() - 0.5) * 2;
      } else {
        const a = Math.random() * 6.283, r = 2.5 + Math.random() * 2.5;
        sx = to[0] + Math.cos(a) * r;
        sy = to[1] + 1 + Math.random() * 2.5;
        sz = to[2] + Math.sin(a) * r;
      }
      const tx = to[0] + (Math.random() - 0.5) * 0.4, ty = to[1] + 0.3 + Math.random() * 1.3, tz = to[2] + (Math.random() - 0.5) * 0.4;
      const cx = (sx + tx) / 2 + (Math.random() - 0.5) * 3, cy = Math.max(sy, ty) + 1 + Math.random() * 1.5, cz = (sz + tz) / 2 + (Math.random() - 0.5) * 3;
      this.crows.gather(sx, sy, sz, cx, cy, cz, tx, ty, tz, dur * (0.8 + Math.random() * 0.2), (x, y, z) => Math.random() < 0.5 && this.feathers.puff(x, y, z, 1, 0.1, 1));
    }
  }

  /** He re-forms: a last flurry of feathers and a dark puff round the body. */
  formFx(f) {
    const g = this.game, p = f.pos, q = this.quality();
    this.feathers.puff(p.x, p.y + 1.0, p.z, Math.round(16 * q) + 2, 0.7, 3);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * 6.283;
      g.fx.emit(0, p.x + Math.cos(a) * 0.45, p.y + 0.3 + Math.random() * 1.2, p.z + Math.sin(a) * 0.45, Math.cos(a) * 2.2, 0.4, Math.sin(a) * 2.2, 0.3, 0.2, 0.5, 0.1, 0.09, 0.12);
    }
    this.inkForm(p, 1.2);
    g.audio?.crowForm?.(p);
  }

  // ---------------------------------------------------------------- the crow shift: ink

  /**
   * Ink thrown off where he left (a dash, the escape, a substitution): dark ink puffs flung back from the way he went
   * (dx, dz: unit, or 0 for every way), aqua chakra wisps licking up, a cold flash. k: size.
   */
  inkSplash(p, dx, dz, k, ink = 1) {
    const g = this.game, q = this.quality();
    for (let n = Math.round((8 * k * q + 2) * ink); n > 0; n--) {
      const a = Math.random() * 6.283, sp = (1.2 + Math.random() * 2.4) * k, h = 0.25 + Math.random() * 1.35;
      g.fx.emit(0, p.x + Math.cos(a) * 0.25, p.y + h, p.z + Math.sin(a) * 0.25, Math.cos(a) * sp - dx * 1.2 * k, 0.6 + Math.random() * 1.4, Math.sin(a) * sp - dz * 1.2 * k, 0.3 + Math.random() * 0.25, 0.25 * k, (0.4 + Math.random() * 0.3) * k, INK[0], INK[1], INK[2]);
    }
    this.wisps(p.x, p.y, p.z, Math.round(7 * k * q) + 2, 0.45 * k);
    g.fx.emit(5, p.x, p.y + 1.0, p.z, 0, 0, 0, 0.12, 0.2 * k, 0.75 * k, 0.15, 0.6, 0.55);
  }

  /** He takes shape out of the ink: dark puffs drawn in round the body, shrinking into it; then aqua licks and a flash. */
  inkForm(p, k, ink = 1) {
    const g = this.game, q = this.quality();
    const n = Math.round((9 * k * q + 3) * ink);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + Math.random() * 0.5, r = (0.55 + Math.random() * 0.35) * k, h = 0.2 + Math.random() * 1.45;
      // (a puff travels vel * (1 - e^-4t) / 4: ~vel / 6 in its quarter second: from r out, drawn to the body's middle)
      g.fx.emit(0, p.x + Math.cos(a) * r, p.y + h, p.z + Math.sin(a) * r, -Math.cos(a) * r * 5, (1.0 - h) * 4, -Math.sin(a) * r * 5, 0.22 + Math.random() * 0.08, (0.42 + Math.random() * 0.2) * k, 0.06, INK[0], INK[1], INK[2]);
    }
    this.feathers.puff(p.x, p.y + 1.0, p.z, Math.round(8 * k * q) + 2, 0.6, 2.4);
    this.wisps(p.x, p.y, p.z, Math.round(5 * k * q) + 1, 0.35 * k);
    g.fx.emit(5, p.x, p.y + 1.0, p.z, 0, 0, 0, 0.16, 0.15 * k, 0.6 * k, 0.15, 0.6, 0.55);
  }

  /** Aqua chakra licking up round (x, y, z) (the feet), within `r` metres: flickering sparks that rise and wander. */
  wisps(x, y, z, n, r) {
    const fx = this.game.fx;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, rr = r * Math.sqrt(Math.random()), h = 0.15 + Math.random() * 1.5;
      fx.emit(6, x + Math.cos(a) * rr, y + h, z + Math.sin(a) * rr, Math.cos(a) * 1.2, 1.5 + Math.random() * 2, Math.sin(a) * 1.2, 0.35 + Math.random() * 0.35, 0.09 + Math.random() * 0.06, 0.03, AQUA[0], AQUA[1], AQUA[2]);
    }
  }

  /** A crow thrown off (x, y, z) at v, never toward this screen's camera (up close one filled the view); s: its size. */
  flyOff(x, y, z, vx, vy, vz, life, s = 1) {
    const cam = this.game.camera.position;
    let tx = cam.x - x, tz = cam.z - z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const d = vx * tx + vz * tz;
    if (d > 0) {
      vx -= 1.6 * d * tx;
      vz -= 1.6 * d * tz;
    }
    const c = this.crows.burst(x, y, z, vx, vy, vz, life, (px, py, pz) => Math.random() < 0.3 && this.feathers.puff(px, py, pz, 1, 0.1, 0.8));
    if (c) c.s *= s;
  }

  /**
   * What the ink sheds as it goes, over `dist` metres of the brush's path ending at p (the feet) heading (dx, dz):
   * dark puffs, aqua wisps, white speed lines along the way, feathers.
   */
  inkWake(p, dx, dz, dist, k = 1, ink = 1) {
    const g = this.game, q = this.quality() * k;
    const count = (perM) => Math.floor(dist * perM * q + Math.random());
    for (let n = count(1.4 * ink); n > 0; n--) {
      const b = Math.random() * dist;
      g.fx.emit(0, p.x - dx * b + (Math.random() - 0.5) * 0.5, p.y + 0.3 + Math.random() * 1.3, p.z - dz * b + (Math.random() - 0.5) * 0.5, -dx * 1.5 + (Math.random() - 0.5), 0.4 + Math.random() * 0.8, -dz * 1.5 + (Math.random() - 0.5), 0.3 + Math.random() * 0.2, 0.15, 0.3 + Math.random() * 0.2, INK[0], INK[1], INK[2]);
    }
    for (let n = count(1.4); n > 0; n--) {
      const b = Math.random() * dist;
      this.wisps(p.x - dx * b, p.y, p.z - dz * b, 1, 0.4);
    }
    for (let n = count(2); n > 0; n--) {
      const b = Math.random() * dist, sp = 10 + Math.random() * 8;
      g.fx.emit(2, p.x - dx * b + (Math.random() - 0.5) * 0.9, p.y + 0.2 + Math.random() * 1.6, p.z - dz * b + (Math.random() - 0.5) * 0.9, dx * sp, 0.6, dz * sp, 0.1 + Math.random() * 0.06, 0.05, 0.02, 1.8, 1.9, 2.1);
    }
    if (dist * 1.6 * q > Math.random()) this.feathers.puff(p.x - dx * dist * 0.5, p.y + 1.0, p.z - dz * dist * 0.5, Math.max(1, count(1.6)), 0.6, 1.6);
  }

  /** The crow shift, every frame, for one Itachi: while his view says dash he is ink (returns true: hidden). */
  updateShift(f, C, dt, quiet, warp = false) {
    const dashing = !!C.crowShift && !f.dead && (f.view?.st === ST.dash || warp);
    let sh = this.shifts.get(f);
    if (!dashing) {
      if (sh?.on) this.shiftEnd(f, sh, quiet);
      return false;
    }
    if (!sh) this.shifts.set(f, (sh = { on: false, strands: [], px: 0, pz: 0, dx: 0, dz: -1 }));
    if (!sh.on) this.shiftStart(f, sh, quiet, warp);
    else this.shiftStep(f, sh, quiet);
    return true;
  }

  /** The dash begins: crows scatter where he stood, ink splashes back, the brush starts at his body. */
  shiftStart(f, sh, quiet, warp = false) {
    const p = f.pos, v = f.view, g = this.game, q = this.quality();
    sh.on = true;
    sh.px = p.x;
    sh.pz = p.z;
    // the way he goes: the view's velocity (forward (-sin, -cos) * vf + left (-cos, sin) * vl), else his facing
    const s = Math.sin(v.yaw ?? f.yaw), c = Math.cos(v.yaw ?? f.yaw);
    let dx = -s * (v.vf || 0) - c * (v.vl || 0), dz = -c * (v.vf || 0) + s * (v.vl || 0);
    const l = Math.hypot(dx, dz);
    if (l > 0.5) {
      dx /= l;
      dz /= l;
    } else {
      dx = -s;
      dz = -c;
    }
    sh.dx = dx;
    sh.dz = dz;
    sh.strands.length = 0;
    if (quiet) return;
    for (const [hw, lean, life, dy, alpha] of SHIFT_STRANDS) {
      const S = this.ink.add(hw, lean, life, alpha);
      if (!S) continue;
      S.dy = dy;
      sh.strands.push(S);
      this.ink.push(S, p.x, p.y + dy, p.z);
    }
    // crows burst off the spot, out to the sides and up (flyOff keeps them off the camera)
    const side = Math.atan2(dx, -dz);
    for (let n = Math.round(6 * q) + 3; n > 0; n--) {
      const a = side + (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 1.6, sp = 2 + Math.random() * 2.5, h = 0.4 + Math.random() * 1.2;
      this.flyOff(p.x + Math.cos(a) * 0.2, p.y + h, p.z + Math.sin(a) * 0.2, Math.cos(a) * sp, 4 + Math.random() * 3.5, Math.sin(a) * sp, 0.75 + Math.random() * 0.6, 0.65);
    }
    this.feathers.puff(p.x, p.y + 1.0, p.z, Math.round(12 * q) + 3, 0.7, 3.2);
    this.inkSplash(p, dx, dz, 0.7, 0.3);
    // an M1 warp (the combo goes on elsewhere): the body bursts into a flock where it hung (the reference's cloud of
    // crows and feathers), out to the sides and up, never at the camera
    if (warp) {
      for (let n = Math.round(10 * q) + 4; n > 0; n--) {
        const a = Math.random() * 6.283, sp = 2.5 + Math.random() * 3.5, h = 0.3 + Math.random() * 1.4;
        this.flyOff(p.x + Math.cos(a) * 0.25, p.y + h, p.z + Math.sin(a) * 0.25, Math.cos(a) * sp, 2.5 + Math.random() * 4, Math.sin(a) * sp, 0.8 + Math.random() * 0.7, 0.75);
      }
      this.feathers.puff(p.x, p.y + 1.0, p.z, Math.round(14 * q) + 4, 0.9, 3.6);
    }
    g.audio?.crowShift?.(f === g.player ? null : p);
  }

  /** The brush follows his drawn body; the ink sheds what it passes. */
  shiftStep(f, sh, quiet) {
    const p = f.pos;
    const mx = p.x - sh.px, mz = p.z - sh.pz, d = Math.hypot(mx, mz);
    sh.px = p.x;
    sh.pz = p.z;
    if (quiet) return;
    if (d > 1e-3) {
      sh.dx = mx / d;
      sh.dz = mz / d;
    }
    for (const S of sh.strands) this.ink.push(S, p.x, p.y + S.dy, p.z);
    // (a jump in the stream, e.g. a correction, isn't a stretch of path)
    if (d < 1.5) this.inkWake(p, sh.dx, sh.dz, d, 0.85, 0.15);
  }

  /** The dash ends: the brush lifts (the ink dries out behind him) and he takes shape at its head. */
  shiftEnd(f, sh, quiet) {
    sh.on = false;
    for (const S of sh.strands) this.ink.release(S);
    sh.strands.length = 0;
    if (!quiet && !f.dead) this.inkForm(f.pos, 0.7, 0.35);
  }

  /** Where the escape's ink is at eased progress e: along the line, lifted into an arc (the body's middle at both ends). */
  cometAt(C, e, out) {
    const [x0, y0, z0] = C.from, [x1, y1, z1] = C.to;
    return out.set(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e + Math.sin(Math.PI * e) * C.arc, z0 + (z1 - z0) * e);
  }

  /** Crow Clone Escape's flight: ink streaking from where he vanished (a Vector3) to the spot ([x, y, z]) in `dur` s. */
  inkComet(from, to, dur) {
    if (this.world.S?.on) return;
    const d = Math.hypot(to[0] - from.x, to[2] - from.z);
    const C = { from: [from.x, from.y, from.z], to: [to[0], to[1], to[2]], t: 0, dur: Math.max(dur, 0.06), e: 0, arc: Math.min(3, 0.6 + d * 0.1), len: Math.hypot(d, to[1] - from.y), strands: [] };
    for (const [hw, lean, life, dy, alpha] of COMET_STRANDS) {
      const S = this.ink.add(hw, lean, life, alpha);
      if (!S) continue;
      S.dy = dy;
      C.strands.push(S);
      this.ink.push(S, from.x, from.y + dy, from.z);
    }
    this.comets.push(C);
  }

  updateComets(dt) {
    let w = 0;
    for (const C of this.comets) {
      const k = clamp((C.t += dt) / C.dur, 0, 1);
      // (fast off the mark, easing into the spot as the crows arrive)
      const e1 = 1 - (1 - k) ** 2.4, e0 = C.e;
      if (e1 > e0) {
        // sub-steps half a metre apart: a smooth arc at any frame rate, each point timed where the brush passed it
        const steps = Math.max(1, Math.ceil(((e1 - e0) * C.len) / 0.5));
        for (let j = 1; j <= steps; j++) {
          const e = e0 + ((e1 - e0) * j) / steps, t = this.ink.time - (1 - j / steps) * dt;
          const P = this.cometAt(C, e, _ink);
          for (const S of C.strands) this.ink.push(S, P.x, P.y + S.dy, P.z, t);
        }
        const P = this.cometAt(C, e1, _ink), dx = C.to[0] - C.from[0], dz = C.to[2] - C.from[2], l = Math.hypot(dx, dz) || 1;
        this.inkWake(P, dx / l, dz / l, (e1 - e0) * C.len, 0.6);
        C.e = e1;
      }
      if (k >= 1) {
        for (const S of C.strands) this.ink.release(S);
        continue;
      }
      this.comets[w++] = C;
    }
    this.comets.length = w;
  }

  /** A substitution by a fighter with the crow shift: crows and ink burst where he stood, ink gathers where he appears. */
  onSub(C, from, to) {
    if (!C?.crowShift || this.world.S?.on) return;
    const q = this.quality();
    for (let n = Math.round(12 * q) + 4; n > 0; n--) {
      const a = Math.random() * 6.283, sp = 3 + Math.random() * 4.5, h = 0.3 + Math.random() * 1.4;
      this.flyOff(from.x + Math.cos(a) * 0.2, from.y + h, from.z + Math.sin(a) * 0.2, Math.cos(a) * sp, 1.5 + Math.random() * 4, Math.sin(a) * sp, 0.9 + Math.random() * 0.8);
    }
    this.feathers.puff(from.x, from.y + 1.0, from.z, Math.round(16 * q) + 4, 0.8, 3.5);
    this.inkSplash(from, 0, 0, 1);
    this.inkForm(to, 0.8);
  }

  // ---------------------------------------------------------------- the victims: marks and flames

  /** A body on this screen by fighter id: { pos, hurt, fighter (null for the dummy) } or null. */
  body(id) {
    const g = this.game;
    if (id === g.net.id) return g.player ? { id, pos: g.player.pos, hurt: g.player.hurt, fighter: g.player } : null;
    if (id === 0) return g.dummy ? { id, pos: g.dummy.pos, hurt: g.dummy.hurt, fighter: null } : null;
    const f = g.remotes.get(id)?.fighter;
    return f ? { id, pos: f.pos, hurt: f.hurt, fighter: f } : null;
  }

  /** Every body on this screen (for other screens' fireballs to burst on). */
  bodies() {
    const out = (this._bodies ||= []);
    out.length = 0;
    const g = this.game;
    if (g.player && !g.ctrl?.dead) out.push({ id: g.net.id, hurt: g.player.hurt });
    for (const [id, r] of g.remotes) if (r.fighter && !r.fighter.dead) out.push({ id, hurt: r.fighter.hurt });
    if (g.dummy) out.push({ id: 0, hurt: g.dummy.hurt });
    return out;
  }

  /** Every hit result (combat.onHitr calls this first): the Tsukuyomi mark, the black flames, a broken genjutsu. */
  onHitr(m) {
    const g = this.game, now = g.net.serverNow(), id = String(m.m);
    if (id === 'tsukuyomi:main') {
      // (the dummy only wobbles; it wears the mark for the genjutsu's length all the same)
      const until = m.dz || (m.v === 0 ? m.at + charOf('itachi').jutsu.tsukuyomi.hits.main.stun * (1000 / 60) : m.e);
      this.dazed.set(m.v, { t0: now, until });
      // (its own screen leaves the fight for the genjutsu's world)
      if (m.v === g.net.id) this.world.start(m.a, until);
      const B = this.body(m.v);
      if (B) {
        g.audio?.genjutsu?.(B.pos, m.v === g.net.id);
        g.fx.emit(5, B.pos.x, B.pos.y + 1.6, B.pos.z, 0, 0, 0, 0.3, 0.2, 1.4, 2.6, 0.05, 0.08);
      }
    } else if (m.r !== REACT.none && !m.dz) {
      // thrown out of it (a launch, a knockdown): the genjutsu breaks
      const D = this.dazed.get(m.v);
      if (D) D.until = Math.min(D.until, now);
      if (D && m.v === g.net.id) this.world.breakAt(now);
    }
    if (id === 'amaterasu:ignite') {
      // (the cinematic already lit it at the focus on this screen: the hit just brings the damage)
      const b = this.burning.get(m.v);
      if (b?.lit && now - b.lit < 3000) b.last = now;
      else {
        this.burning.set(m.v, { t0: now, last: now });
        this.igniteFx(m.v);
      }
    } else if (id === 'amaterasu:burn') {
      const b = this.burning.get(m.v);
      if (b) b.last = now;
      else this.burning.set(m.v, { t0: now, last: now });
    }
  }

  /**
   * The cinematic's flames take hold (every screen at the focus, server clock): black fire blooms on the side of the
   * body facing him and spreads over it (updateBurning); the server's hitr brings the damage a moment later.
   */
  latch(id, from) {
    const now = this.game.net.serverNow(), B = this.body(id);
    if (!B) return;
    const c = B.hurt?.center || _v.set(B.pos.x, B.pos.y + 1, B.pos.z);
    const dx = from.x - c.x, dz = from.z - c.z, l = Math.hypot(dx, dz) || 1;
    const o = new THREE.Vector3(c.x + (dx / l) * 0.22, c.y + 0.25, c.z + (dz / l) * 0.22);
    this.burning.set(id, { t0: now, last: now, lit: now, latch: o });
    this.igniteFx(id, o, 1.5);
  }

  igniteFx(id, at = null, k = 1) {
    const g = this.game, B = this.body(id), q = this.quality() * k;
    if (!B) return;
    const c = at || B.hurt?.center || _v.set(B.pos.x, B.pos.y + 1, B.pos.z);
    for (let n = 0; n < Math.round(24 * q) + 4; n++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u), sp = 2 + Math.random() * 4;
      this.black.puff(c.x, c.y, c.z, Math.cos(a) * s * sp, u * sp * 0.6 + 2, Math.sin(a) * s * sp, 0.35 + Math.random() * 0.25, 0.16, 0.3 + Math.random() * 0.15, 1, 0, 3);
    }
    g.fx.emit(5, c.x, c.y, c.z, 0, 0, 0, 0.25, 0.4, 2.2, 0.9, 0.03, 0.3);
    g.fx.emit(4, B.pos.x, B.pos.y + 0.05, B.pos.z, 0, 0, 0, 0.5, 0.3, 3.2, 0.5, 0.02, 0.2, 0.9);
    g.audio?.amaterasu?.(B.pos);
    if (id === g.net.id) g.cam.addTrauma(0.45);
  }

  /**
   * Every dazed victim, on every screen: the capture (a white flash sphere tearing wind off it, a violet sphere, three
   * black blades sweeping in, a red ring tearing into ink, then the whole Mangekyō turning over the body), then the
   * mark over its head for the rest of the genjutsu. The local victim's own screen is the world's (tsukuyomi.js).
   */
  updateDazed(now) {
    const g = this.game, inWorld = this.world.S?.on;
    for (const [id, D] of this.dazed) {
      const B = this.body(id);
      const age = (now - D.t0) / 1000, left = (D.until - now) / 1000;
      if (!B || left < -0.35 || (B.fighter && B.fighter.dead && left < 0)) {
        this.dazed.delete(id);
        continue;
      }
      if (id === g.net.id && inWorld) continue;
      const alive = left > 0 ? 1 : ss(-0.35, 0, left);
      // the capture, round the body's middle
      if (age < 2.7) {
        const c = _w.set(B.pos.x, B.pos.y + 1.0, B.pos.z);
        const w = (this._sw ||= {});
        w.flash = ss(0, 0.04, age) * (1 - ss(0.2, 0.45, age));
        w.violet = ss(0.12, 0.3, age) * (1 - ss(0.95, 1.35, age));
        w.blades = ss(0.42, 0.6, age) * (1 - ss(1.2, 1.5, age));
        w.ring = ss(0.78, 0.95, age) * (1 - ss(1.35, 1.65, age));
        w.seal = ss(1.1, 1.28, age) * (1 - ss(2.2, 2.6, age));
        w.ink = 0;
        for (const k of ['flash', 'violet', 'blades', 'ring', 'seal']) w[k] *= alive;
        const sc = (this._ssc ||= {});
        const pop = ss(1.1, 1.45, age), back = 1 + 2.2 * (pop - 1) ** 3 + 1.2 * (pop - 1) ** 2; // (ease out, overshooting)
        sc.seal = 0.55 + 0.45 * back + 0.18 * ss(2.2, 2.6, age);
        sc.blades = 1.7 - 0.65 * ss(0.42, 1.3, age);
        sc.ink = 1;
        const spin = age * 2.2 + 3 * (1 - Math.exp(-age * 2.5));
        this.seal.set(c, 1.05, null, 0.6, w, age, spin, sc, 0.45);
      }
      // then an eye opens over the head, its pinwheel turning; it closes as the genjutsu lets go
      const open = ss(2.2, 2.5, age) * alive;
      if (open > 0.001) {
        const head = (B.fighter && bonePos(B.fighter, 'head', _v)) || _v.set(B.pos.x, B.pos.y + 1.75, B.pos.z);
        const bob = Math.sin(this.time * 2.4 + id) * 0.03;
        this.marks.set(head.x, head.y + 0.62 + bob, head.z, 0.4 * (0.85 + 0.15 * ss(2.2, 2.4, age)), open, 1, this.time * 1.3, 0.9 + 0.3 * Math.sin(this.time * 5));
      }
      // red threads of chakra winding round the head now and then
      if (left > 0 && age > 1.2 && Math.random() < 0.35) {
        const head = (B.fighter && bonePos(B.fighter, 'head', _v)) || _v.set(B.pos.x, B.pos.y + 1.75, B.pos.z);
        const a = Math.random() * 6.283;
        g.fx.emit(2, head.x + Math.cos(a) * 0.35, head.y + 0.1, head.z + Math.sin(a) * 0.35, -Math.sin(a) * 1.5, 0.8, Math.cos(a) * 1.5, 0.35, 0.03, 0.01, 2.2, 0.05, 0.06);
      }
    }
  }

  /** Black flames licking off every burning body (its hurtbox capsules), smoke rising, the crackle. */
  updateBurning(now, dt) {
    const g = this.game, q = this.quality();
    for (const [id, b] of this.burning) {
      const B = this.body(id);
      const on = B && now - b.last < 550;
      g.audio?.blackFire?.(`ama${id}`, !!on, B?.pos);
      if (!on) {
        // (kept a while: the crackle's loop needs its fade-out frames before it can stop)
        if (now - b.last > 4000) this.burning.delete(id);
        continue;
      }
      const caps = B.hurt?.caps;
      if (!caps?.length) continue;
      // (a fading start and end: the ignition swells them in; latched by the cinematic they spread out over the body
      // from where his gaze met it, ~3 m/s)
      const age = (now - b.t0) / 1000;
      const k = b.latch ? ss(0, 0.12, age) * 1.3 : ss(0, 0.3, age);
      const reach = b.latch ? 0.12 + age * 3 : 1e9;
      for (let n = Math.floor(dt * 80 * q * k + Math.random()); n > 0; n--) {
        const c = caps[(Math.random() * caps.length) | 0], t = Math.random();
        const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u), rr = c.r * (0.5 + Math.random() * 0.6);
        const x = c.a.x + (c.b.x - c.a.x) * t + Math.cos(a) * s * rr, y = c.a.y + (c.b.y - c.a.y) * t + u * rr, z = c.a.z + (c.b.z - c.a.z) * t + Math.sin(a) * s * rr;
        if (reach < 3 && Math.hypot(x - b.latch.x, y - b.latch.y, z - b.latch.z) > reach) continue;
        this.black.puff(x, y, z, (Math.random() - 0.5) * 0.6, 3.2 + Math.random() * 3.2, (Math.random() - 0.5) * 0.6, 0.22 + Math.random() * 0.22, 0.09 + Math.random() * 0.06, 0.05 + Math.random() * 0.1, 1, 0, 3);
      }
      // taller tongues off the shoulders and head, a pool of it round the feet
      if (Math.random() < dt * 10 * q) {
        const c = caps[caps.length - 1];
        this.black.puff(c.a.x + (Math.random() - 0.5) * 0.3, c.a.y + 0.1, c.a.z + (Math.random() - 0.5) * 0.3, 0, 5.5, 0, 0.38, 0.16, 0.06, 1, 0, 2);
      }
      if (Math.random() < dt * 12 * q) {
        const a = Math.random() * 6.283, r = 0.25 + Math.random() * 0.25;
        this.black.puff(B.pos.x + Math.cos(a) * r, B.pos.y + 0.08, B.pos.z + Math.sin(a) * r, Math.cos(a) * 0.5, 2.4, Math.sin(a) * 0.5, 0.35, 0.16, 0.05, 1, 0, 3);
      }
      if (Math.random() < dt * 3 * q) this.smoke.puff(B.pos.x, B.pos.y + 1.8, B.pos.z, (Math.random() - 0.5) * 0.4, 1.4, (Math.random() - 0.5) * 0.4, 1.8, 0.3, 1.0, 0, 1, 1.5);
      if (g.post.hazeOn) g.post.haze.add(B.pos.x, B.pos.y + 1.1, B.pos.z, 1.3, 0.5);
    }
  }

  // ---------------------------------------------------------------- every Itachi on screen

  /**
   * Every Itachi, every frame, from the clip he is drawn in (v.act: identical on every screen): the Sharingan in his
   * eyes (the Mangekyō through a gaze), the gaze's flare, hidden while he is crows (and re-formed when they arrive),
   * the Amaterasu focus darkening the view round him.
   */
  updateItachi(dt) {
    const g = this.game, now = g.net.serverNow(), seen = (this._seen ||= new Set());
    // (inside Tsukuyomi's world on this screen the arena is gone: no ink or crows in it)
    const quiet = !!this.world.S?.on;
    seen.clear();
    const each = (f, C, local) => {
      if (!f || !C?.jutsu.crowEscape) return;
      seen.add(f);
      // his dash, and the warps of his M1 strings: ink and crows instead of a body (the crow shift)
      const act = f.view?.act, on = !f.dead && !!act && CAST_CLIPS.has(act.clip);
      const warp = !f.dead && !!act && warpHidden(act.clip, act.t * 60);
      const shifting = this.updateShift(f, C, dt, quiet, warp);
      const fr = on ? act.t * 60 : -1, clip = on ? act.clip.replace('_air', '') : '';
      const S = on ? this.stateOf(f, act.key) : this.per.get(f);
      const hit = (x) => S && S.last < x && fr >= x;
      // the eyes: the Mangekyō blazing through the gazes only (the model has its own Sharingan; an idle faint mark
      // over it read as translucent eyeballs in front of his face)
      let glow = 0, mangekyo = false;
      if (clip === 'ita_tsukuyomi') {
        glow = 1.45 * ss(12, 18, fr) * (1 - ss(36, 44, fr));
        mangekyo = fr >= 12;
      } else if (clip === 'ita_amaterasu') {
        // (the cinematic shows the eyes waking in close-up; back in the arena they blaze as the flames take)
        glow = 1.65 * ss(246, 262, fr) * (1 - ss(292, 312, fr));
        mangekyo = fr >= 246;
      }
      // hidden while he is crows: from the vanish until they have gathered at the spot and the re-forming frame
      let hidden = false;
      if (clip === 'ita_crow') {
        const D = C.jutsu.crowEscape;
        if (fr >= D.vanish) {
          if (!S.burst) this.crowBurst(f, f.pos, S);
          hidden = !S.arrived || fr < D.form || now < S.formAt - 20;
          // (its teleport never came: show him after a while where he is)
          if (!S.arrived && fr > D.form + 40) hidden = false;
          if (!hidden && !S.shown) {
            S.shown = true;
            this.formFx(f);
          }
        }
      }
      hidden ||= shifting;
      f.root.visible = !hidden;
      f.visible = !hidden;
      if (glow > 0.01 && !hidden && !f.dead && LODnear(f, g.camera)) {
        this.eyes(f, C, _v, _c1, _c2);
        const size = mangekyo ? 0.022 : 0.016;
        for (const e of [_c1, _c2]) this.marks.set(e.x, e.y, e.z, size, -1, clamp(glow, 0, 1), this.time * (mangekyo ? 3 : 1.2), glow);
      }
      // Tsukuyomi: the Mangekyō thrown out before him as the eyes meet theirs, a great eye turning between them
      if (clip === 'ita_tsukuyomi' && fr >= 10 && fr < 41 && !hidden && !f.dead) {
        const pop = ss(10, 18, fr), out = ss(30, 40, fr);
        const w = (this._pw ||= { flash: 0, violet: 0, blades: 0, ring: 0, ink: 0 });
        w.seal = pop * (1 - out);
        const back = 1 + 2.2 * (pop - 1) ** 3 + 1.2 * (pop - 1) ** 2;
        const e = this.eyes(f, C, _v), fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
        e.x += fx * 1.1;
        e.z += fz * 1.1;
        const sc = (this._psc ||= {});
        sc.seal = 0.45 + 0.55 * back + 0.35 * out;
        this.seal.set(e, 0.9, _nrm.set(fx, 0, fz), 0, w, fr / 60, this.time * 2.4 + 3 * (1 - Math.exp(-(fr - 10) / 20)), sc, 0);
      }
      if (on) {
        if (clip === 'ita_tsukuyomi' && hit(C.jutsu.tsukuyomi.gaze)) this.gazeFx(f, C, 'tsukuyomi');
        if (clip === 'ita_amaterasu' && hit(C.jutsu.amaterasu.focus)) this.gazeFx(f, C, 'amaterasu');
        S.last = fr;
      }
      // the caster's own screen pulses red as Tsukuyomi takes hold (Amaterasu's grades are its cinematic's)
      if (local && clip === 'ita_tsukuyomi') g.post.genjutsu.amt = Math.max(g.post.genjutsu.amt, 0.28 * ss(17, 19, fr) * (1 - ss(19, 30, fr)));
    };
    each(g.player, g.ctrl?.C, true);
    for (const r of g.remotes.values()) each(r.fighter, charOf(r.info.ch), false);
    for (const f of this.per.keys()) if (!seen.has(f)) this.per.delete(f);
    for (const [f, sh] of this.shifts) {
      if (seen.has(f)) continue;
      // (gone from the arena mid-dash: the brush lifts)
      for (const S of sh.strands) this.ink.release(S);
      this.shifts.delete(f);
    }
  }

  // ---------------------------------------------------------------- the network

  /** A relayed cast / event of Itachi's kit on someone else's fighter. Returns true when handled. */
  onRemote(m, r) {
    if (!ITACHI_CASTS[m.m]) return false;
    const g = this.game, C = charOf(r.info.ch), D = C.jutsu[m.m];
    if (!D) return true;
    if (m.m === 'phoenixFire') {
      if (!m.n) r.act = { clip: m.f ? 'ita_fire_air' : 'ita_fire', sv: true, at: m.at, key: `ifire${m.i}`, dur: D.total * F, pause: 0 };
      else if (m.o && m.d) this.addBall({ owner: m.id, mine: false, inst: m.i, k: m.n - 1, o: m.o, d: m.d, tg: m.tg, at: m.at, C, fighter: r.fighter });
      if (!m.n) g.audio?.handsign?.(r.fighter?.pos);
    } else if (m.m === 'tsukuyomi' || m.m === 'amaterasu') {
      const clip = m.m === 'tsukuyomi' ? 'ita_tsukuyomi' : 'ita_amaterasu';
      if (!m.n) {
        r.act = { clip: m.f ? `${clip}_air` : clip, sv: true, at: m.at, key: `igaze${m.i}`, dur: D.total * F, pause: 0 };
        if (m.m === 'amaterasu') {
          g.audio?.ult?.(r.fighter?.pos);
          // (every screen films it from the press, on the server clock)
          if (D.cinema) this.cine.start(m.id, m.i, m.at, r.info.ch);
        }
      } else if (m.m === 'amaterasu' && m.n === 1) this.cine.pick(m);
    } else if (m.m === 'crowEscape') {
      if (!m.n) {
        r.act = { clip: 'ita_crow', sv: true, at: m.at, key: `icrow${m.i}`, dur: D.total * F, pause: 0 };
      } else if (m.o && r.fighter) {
        // the teleport: he bursts where he was drawn (if the clip hadn't got there yet) and is moved to the spot
        const f = r.fighter, S = this.stateOf(f, `icrow${m.i}`);
        const from = new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z);
        this.crowBurst(f, from, S);
        let yaw = f.yaw;
        const me = g.player?.pos;
        if (me) yaw = Math.atan2(-(me.x - m.o[0]), -(me.z - m.o[2]));
        r.react = null;
        r.motion.clear();
        r.motion.push(g.net.renderTime() - 1, [m.o[0], m.o[1], m.o[2], 0, 0, 0, yaw, ST.jutsu, 0, 0]);
        f.snap(m.o[0], m.o[1], m.o[2], yaw);
        // (heard of late, past the re-forming frame: the crows still get a quarter second to gather)
        const at0 = r.act?.key === `icrow${m.i}` ? r.act.at : m.at - D.vanish * F * 1000;
        this.crowGather(f, from, m.o, Math.max(at0 + D.form * F * 1000, g.net.serverNow() + 250), S);
      }
    }
    return true;
  }

  /** Our own cast's phase coming back from the server (the crow teleport: already done here; Amaterasu's pick: who burns). */
  onOwn(m) {
    if (m.m === 'amaterasu' && m.n === 1) this.cine.pick(m);
  }

  /** The server refused one of our casts: the action stops (a hidden body shows again). */
  onDeny(m) {
    if (m.k !== 'jutsu' || !ITACHI_CASTS[m.m]) return;
    const g = this.game, a = g.ctrl?.action;
    if (a && a.inst === m.i && a.K === this) g.ctrl.action = null;
    // (a refused Amaterasu: another's cinematic was playing, or no gauge; ours never starts)
    if (this.cine.S?.id === g.net.id && this.cine.S.inst === m.i) this.cine.end();
    if (g.player) {
      g.player.root.visible = true;
      g.player.visible = true;
    }
    for (const b of this.balls) if (b.mine && b.inst === m.i) b.t = 1e9;
  }

  /** Debug (scripts/test/itachi.mjs): the fireballs of a cast as this screen has them. */
  debugBalls(inst) {
    return this.balls.filter((b) => b.inst === inst).map((b) => ({ k: b.k, pos: b.pos.toArray(), lost: b.lost, t: b.t, tg: b.tg }));
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    this.time += dt;
    const now = this.game.net.serverNow();
    this.marks.begin();
    this.seal.begin();
    this.updateBalls(dt);
    this.updateItachi(dt);
    this.updateDazed(now);
    this.world.update(dt, now);
    this.cine.update(dt, now);
    this.updateBurning(now, dt);
    this.marks.end();
    this.seal.end();
    this.updateComets(dt);
    this.ink.update(dt);
    this.crows.update(dt);
    this.feathers.update(dt);
    this.black.update(dt, this.game.sky?.sun?.position);
  }
}

/** Is the fighter close enough to the camera for the tiny glows in its eyes to show (and matter)? */
function LODnear(f, cam) {
  return !cam || cam.position.distanceToSquared(f.pos) < 40 * 40;
}
