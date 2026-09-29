// Client combat. The local fighter's combat states are Actions owned by the Controller (fixed 60 Hz steps):
//   AttackAction  a move from the frame data: its own travel (tracks a target within range), hover in the air, leaps
//                 and dives, combo chains with counted buffered presses, hold-for-heavy, dash/jump cancels once it
//                 has hit, hitstop. M1 on the ground picks a string: standing (U1-U5) or on the move (S1-S5).
//   GuardAction, ChargeAction, ReactAction (hitstun, flights, knockdown, get-up, substitution, tech roll, KO).
// Combat (the manager) starts actions from input, detects hits with swept bone capsules on the drawn poses, gives
// predicted feedback at once (hitstop, burst, sound, the victim's reaction) and reconciles with the server's `hitr`.
// Remote fighters' reactions are deterministic flights from the hit event (shared physics), drawn at the present.
import * as THREE from 'three';
import { ST, FLAG, SIM } from '../shared/config.js';
import { charOf } from '../shared/characters.js';
import { hitSpec, resolveHit, comboAfter, reactionFlight, reactionTimes, koHit, keepDaze, KO_HOLD, REACT, AIRBORNE } from '../shared/combat.js';
import { COMBO } from '../shared/naruto.js';
import { Hurtbox, PostHurtbox, sweptHit, gripSegment } from './hurtbox.js';
import { BI } from '../char/rig.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
const F = 1 / 60;
// hits the server applies itself (no client detects them, so the attacker's screen never predicted them)
const SERVER_HIT = /^(uchihaReturn|tengaiShinsei|tsukuyomi|amaterasu):/;
const TURN = 40; // rad/s an attack turns toward its target (180 degrees in under 5 ticks)
let instSeq = Math.floor(Math.random() * 1000) * 1000;

// ---------------------------------------------------------------- actions (local fighter)

export class AttackAction {
  constructor(game, ctrl, id, target) {
    this.game = game;
    this.id = id;
    this.M = ctrl.C.moves[id];
    this.owns = true;
    this.netState = ST.attack;
    this.t = 0;
    this.stop = 0; // hitstop remaining (s)
    this.hit = false;
    this.hitSet = new Set();
    this.inst = ++instSeq;
    this.air = this.M.kind === 'air' || !!this.M.air;
    this.total = (this.M.startup + this.M.active + this.M.recovery) * F;
    this.queued = null;
    this.target = target;
    const b = ctrl.body, S = this.M.step;
    // step-in: toward the target (tracking) or straight ahead
    let dx = -Math.sin(ctrl.yaw), dz = -Math.cos(ctrl.yaw), dist = S.d, dy = 0;
    const tr = S.track;
    if (target) {
      const tx = target.x - b.x, tz = target.z - b.z, d = Math.hypot(tx, tz);
      if (d > 0.1) {
        dx = tx / d;
        dz = tz / d;
      }
      dist = clamp(d - tr.gap, 0, tr.max);
      if (tr.vertical && this.air) dy = clamp(target.y - b.y, -1.5, 1.5);
    }
    this.dir = [dx, dz];
    // the travel: from frame `from` for `f` frames, the speed going from k[0] to k[1] times the mean
    this.stepFrom = (S.from || 0) * F;
    this.stepT = (S.f ?? this.M.startup + 2) * F;
    this.stepK = S.k || [1.6, 0.4];
    this.stepV = dist / this.stepT;
    this.vy = dy / this.stepT;
    // turn to the target fast but not in one tick (a one-tick turn pops the whole body on screen)
    this.yawTo = Math.atan2(-dx, -dz);
    ctrl.yaw += clamp(wrap(this.yawTo - ctrl.yaw), -TURN * F, TURN * F);
    ctrl.moveYaw = this.yawTo;
    ctrl.sprint = false;
    ctrl.runT = 0;
    const hover = this.M.hover ?? 1;
    this.physicsOpts = this.air ? { ...ctrl.opts, gravity: ctrl.opts.gravity * hover, fallMul: 1 } : ctrl.opts;
    if (this.air) b.vy = Math.max(0, b.vy * 0.2) + this.vy;
    // a leap: off the ground, aimed to meet an airborne target at the contact frame
    const L = this.M.leap;
    if (L && ctrl.grounded) {
      const g = ctrl.opts.gravity * L.g, tc = this.M.startup * F;
      let vy = L.vy;
      if (L.aim && target && target.y - b.y > 0.5) vy = clamp((target.y - b.y + 0.2 + 0.5 * g * tc * tc) / tc, 9, 16);
      b.vy = vy;
      b.ground = false;
      this.physicsOpts = { ...ctrl.opts, gravity: g, fallMul: 1 };
      this.leapt = true;
    }
    if (this.air || this.leapt) ctrl.airCombo = true;
    game.net.act('atk', { m: id, i: this.inst, tg: target?.id ?? undefined });
    game.audio?.whoosh?.(this.M.weight);
  }

  get frame() {
    return this.t / F;
  }

  get active() {
    const f = this.frame;
    return f >= this.M.startup && f < this.M.startup + this.M.active;
  }

  anim() {
    // drawn between sim ticks the clip moves on with the frame (at 144 Hz a strike stepped in 60 Hz jumps otherwise)
    const t = this.stop > 0 || this.held ? this.t : Math.min(this.total, this.t + (this.game.alpha || 0) * F);
    return { clip: this.M.anim, t, key: this.id };
  }

  step(ctrl, input, dt) {
    const b = ctrl.body, M = this.M;
    ctrl.yaw += clamp(wrap(this.yawTo - ctrl.yaw), -TURN * dt, TURN * dt);
    // input is buffered for the whole move; the next hit comes out at its cancel frame
    // every press counts (up to 2 ahead): five presses are five hits even when they come faster than the moves
    if (input.take('attack', 0.3)) {
      this.more = Math.min(2, (this.more || 0) + (this.queued === 'light' ? 1 : 0));
      this.queued = 'light';
    }
    if (input.take('heavy', 0.3) && !this.air) this.queued = 'heavy';
    if (!this.air && M.kind === 'light' && input.held('attack') && input.heldFor('attack') >= 0.35 && !this.heldHeavy) {
      this.heldHeavy = true;
      this.queued = 'heavy';
    }
    if (this.stop > 0) {
      this.stop -= dt;
      b.vx = b.vz = 0;
      if (this.air) b.vy = 0;
      else if (this.leapt && !ctrl.grounded) {
        // a leap hangs through the hitstop and carries on rising after it
        this.vyHeld ??= b.vy;
        b.vy = 0;
      }
      return true;
    }
    if (this.vyHeld !== undefined) {
      b.vy = this.vyHeld;
      this.vyHeld = undefined;
    }
    this.t += dt;
    this.held = false;
    const D = M.dive;
    if (D && this.t >= D.at * F) {
      if (!this.dived) {
        this.dived = true;
        if (!ctrl.grounded) b.vy = D.vy;
      }
      // the clip waits at the landing frame until the feet touch down; an early landing catches up at double speed
      const land = D.land * F;
      if (ctrl.grounded) {
        if (this.t < land) this.t = Math.min(land, this.t + dt);
      } else if (this.t > land && (this.hold = (this.hold || 0) + dt) < 0.6) {
        this.t = land;
        this.held = true;
      }
    }
    const f = this.frame;
    // root motion from the data (the move's own travel profile)
    const st = this.t - this.stepFrom;
    if (st >= 0 && st < this.stepT) {
      const k = this.stepK[0] + (this.stepK[1] - this.stepK[0]) * (st / this.stepT);
      b.vx = this.dir[0] * this.stepV * k;
      b.vz = this.dir[1] * this.stepV * k;
      if (this.air) b.vy = this.vy * k;
    } else {
      const s = Math.max(0, 1 - dt * 14);
      b.vx *= s;
      b.vz *= s;
      if (this.air && b.vy > 0) b.vy *= s;
    }
    // chains
    if (this.queued && f >= M.cancel) {
      const next = this.queued === 'heavy' ? (M.kind === 'light' && ctrl.grounded ? 'H' : null) : M.next;
      if (next && (next !== 'H' || ctrl.grounded)) {
        this.replace = new AttackAction(this.game, ctrl, next, this.game.combat.findTarget(ctrl, ctrl.C.moves[next].step.track.range));
        if (this.queued === 'light' && this.more) {
          this.replace.queued = 'light';
          this.replace.more = this.more - 1;
        }
        return false;
      }
    }
    // cancels once the move has hit: dash, jump (juggle follow-ups), jutsu
    if (this.hit && f >= M.hitCancel) {
      if (input.peek('dash', 0.2) || input.peek('jutsu1', 0.2) || input.peek('jutsu2', 0.2) || (ctrl.C.kit.jutsu3 && input.peek('jutsu3', 0.2)) || input.peek('tool', 0.2)) return false;
      if (input.peek('jump', 0.2) && ctrl.grounded) return false;
    }
    if (this.t >= this.total) {
      if (!ctrl.grounded) ctrl.setState(ST.air);
      return false;
    }
    return true;
  }

  onHit(hitstop) {
    this.hit = true;
    this.stop = Math.max(this.stop, hitstop * F);
  }
}

export class GuardAction {
  constructor(game) {
    this.game = game;
    this.owns = true;
    this.netState = ST.guard;
    this.t = 0;
    this.stun = 0;
    game.net.act('guard', { on: 1 });
    this.physicsOpts = null;
  }

  anim() {
    return this.stun > 0 ? { clip: 'guard_hit', t: 14 * F - this.stun, key: 'guard_hit' } : { clip: 'guard', t: this.t, key: 'guard' };
  }

  step(ctrl, input, dt) {
    this.t += dt;
    const b = ctrl.body;
    b.vx *= Math.max(0, 1 - dt * 12);
    b.vz *= Math.max(0, 1 - dt * 12);
    if (this.stun > 0) {
      this.stun -= dt;
      return true;
    }
    // face the lock-on target while guarding
    if (ctrl.lockTarget) ctrl.yaw = Math.atan2(-(ctrl.lockTarget.x - b.x), -(ctrl.lockTarget.z - b.z));
    if (!input.held('guard') || !ctrl.grounded) {
      this.game.net.act('guard', { on: 0 });
      return false;
    }
    return true;
  }
}

export class ChargeAction {
  constructor(game) {
    this.game = game;
    this.owns = true;
    this.netState = ST.charge;
    this.t = 0;
    game.net.act('charge', { on: 1 });
  }

  anim() {
    return { clip: 'charge', t: this.t, key: 'charge' };
  }

  step(ctrl, input, dt) {
    this.t += dt;
    const b = ctrl.body;
    b.vx *= Math.max(0, 1 - dt * 14);
    b.vz *= Math.max(0, 1 - dt * 14);
    ctrl.chakra = Math.min(ctrl.C.stats.chakra, ctrl.chakra + ctrl.C.stats.chakraCharge * dt);
    if (!input.held('charge') || !ctrl.grounded) {
      this.game.net.act('charge', { on: 0 });
      return false;
    }
    return true;
  }
}

/**
 * The local fighter hit by someone: its position follows the deterministic flight from the server's hit event;
 * input is locked except substitution (dash in hitstun) and the tech roll (dash on landing).
 */
export class ReactAction {
  constructor(game, ctrl, h) {
    this.game = game;
    this.owns = true;
    this.h = h; // { r, t0, p, kb, st, land, end, hs, a }
    this.flight = reactionFlight(game.world, ctrl.C.id, h.r, h.p, h.kb);
    this.t = 0;
    this.pick = Math.random() < 0.5 ? 'hit_head' : 'hit_body';
    const b = ctrl.body;
    // face the attacker (knockback flies away from them)
    const kl = Math.hypot(h.kb[0], h.kb[2]);
    if (kl > 0.5) ctrl.yaw = Math.atan2(h.kb[0], h.kb[2]);
    else if (h.ax !== undefined) ctrl.yaw = Math.atan2(-(h.ax - b.x), -(h.az - b.z));
    this.physicsOpts = null;
    this.noPhysics = true; // the flight places the fighter (the tech roll moves it itself)
    this.tech = null;
    this.subbed = false;
    // news of a hit arrives late at high ping: the reaction still shows (and can be substituted) for 0.25 s
    this.minEnd = game.net.serverNow() + 250;
  }

  get netState() {
    const n = this.game.net.serverNow();
    const h = this.h;
    if (this.tech) return ST.getup;
    if (h.r === REACT.guard) return ST.guard;
    if (AIRBORNE.has(h.r)) return n < h.land ? ST.flight : h.ko || n < h.end - this.C_getup ? ST.down : ST.getup;
    return ST.hit;
  }

  anim() {
    const n = this.game.net.serverNow(), h = this.h;
    const s = Math.max(0, (n - h.t0) / 1000);
    if (this.tech) return { clip: 'tech', t: this.tech.t, key: 'tech' };
    if (h.r === REACT.guard) return { clip: 'guard_hit', t: s + 3 * F, key: 'guard_hit' };
    if (AIRBORNE.has(h.r)) {
      if (n < h.land) return { clip: 'fly', t: s, key: 'fly' };
      const gu = 34 * F * 1000;
      if (h.ko || n < h.end - gu) return { clip: 'lie', t: (n - h.land) / 1000, key: 'lie' };
      return { clip: 'getup', t: (n - (h.end - gu)) / 1000, key: 'getup' };
    }
    const clip = h.r === REACT.stagger || h.r === REACT.guardBreak ? 'stagger' : this.pick;
    // hitstop shows the impact frame; the reaction stretches to the stun time
    const dur = Math.max(0.2, h.st * F);
    // a genjutsu (Tsukuyomi): the dazed loop, after a hit's own flinch when one lands inside it
    if (h.dz && (h.r === REACT.daze || s > dur + 3 * F)) return { clip: 'dazed', t: (n / 1000) % 600, key: 'dazed' };
    return { clip, t: s + 3 * F, dur, key: `react${h.n || 0}` };
  }

  step(ctrl, input, dt) {
    const g = this.game, h = this.h, b = ctrl.body;
    this.C_getup = 34 * F * 1000;
    const n = g.net.serverNow();
    this.t += dt;
    if (this.tech) {
      // the tech roll: a quick roll back, then control returns
      this.tech.t += dt;
      const k = Math.min(1, this.tech.t / 0.4);
      b.vx = this.tech.dx * 6 * (1 - k);
      b.vz = this.tech.dz * 6 * (1 - k);
      ctrl.physics(dt);
      return this.tech.t < 0.4;
    }
    // (inside a genjutsu only a hit's own stun can be substituted out of, never the daze itself)
    const stunEnd = h.r === REACT.daze ? -1e9 : h.land || (h.dz ? h.t0 + h.st * (1000 / 60) : h.end);
    const inStun = n <= Math.max(stunEnd + 280, h.r === REACT.daze ? -1e9 : this.minEnd) && h.r !== REACT.guard && !h.ko;
    // substitution: dash while stunned (and a pip left)
    if (inStun && !this.subbed && g.gauge.sp > 0 && input.take('dash', 0.15)) {
      this.subbed = true;
      g.combat.substitute(this);
      return false;
    }
    // tech roll: dash as you land
    if (h.land && !h.ko && n >= h.land - 80 && n <= h.land + 250 && input.take('dash', 0.2)) {
      const fx = Math.sin(ctrl.yaw), fz = Math.cos(ctrl.yaw); // backward
      this.tech = { t: 0, dx: fx, dz: fz };
      g.net.act('tech');
      g.fx.dust(b, 6, 1);
      return true;
    }
    // follow the deterministic flight exactly
    const s = Math.max(0, (n - h.t0) / 1000);
    const fb = this.flight.advance(s);
    b.x = fb.x;
    b.y = fb.y;
    b.z = fb.z;
    b.vx = fb.vx;
    b.vy = fb.vy;
    b.vz = fb.vz;
    b.ground = fb.ground;
    if (n >= Math.max(h.end, this.minEnd)) {
      b.vx = b.vz = b.vy = 0;
      ctrl.setState(b.ground ? ST.loco : ST.air);
      return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------- the manager

const _aim = new THREE.Vector3();
const _a0 = new THREE.Vector3(), _b0 = new THREE.Vector3(), _a1 = new THREE.Vector3(), _b1 = new THREE.Vector3(), _hit = new THREE.Vector3(), _v = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
    this.prevBox = null; // last frame's hitbox capsule of the local attack (for sweeping)
    this.combo = { n: 0, t: 0 }; // the local attacker's combo counter (HUD)
    this.remoteCombos = new Map(); // victim id -> combo guess (predictions)
    this.pending = new Map(); // `${instance}:${victim}` -> predicted reaction
    this.stats = { predicted: 0, confirmed: 0, corrected: 0, sent: 0, rejected: 0 };
    this.log = null; // debug: an array to push hit records into
  }

  /** Hurtboxes for a fighter (called when a Fighter is created). */
  attach(fighter) {
    fighter.hurt = new Hurtbox(fighter.vrm);
  }

  // ---- targets (the dummy, remotes)

  targets() {
    const g = this.game, out = (this._targets ||= []);
    out.length = 0;
    for (const r of g.remotes.values()) {
      if (!r.fighter || r.fighter.dead || r.react?.ko) continue;
      out.push({ id: r.info.id, x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, hurt: r.fighter.hurt, entry: r });
    }
    const d = g.dummy;
    if (d) out.push({ id: 0, x: d.pos.x, y: d.pos.y, z: d.pos.z, hurt: d.hurt, entry: d, dummy: true });
    return out;
  }

  /** The best target in front of the fighter within `range` (the lock-on target first). */
  findTarget(ctrl, range) {
    const b = ctrl.body;
    if (ctrl.lockTarget && !ctrl.lockTarget.dead) {
      const L = ctrl.lockTarget;
      if (Math.hypot(L.x - b.x, L.z - b.z) < range + 1) return L;
    }
    let best = null, bs = Infinity;
    const fx = -Math.sin(ctrl.yaw), fz = -Math.cos(ctrl.yaw);
    const wx = ctrl.wish > 0.3 ? ctrl.wishX : fx, wz = ctrl.wish > 0.3 ? ctrl.wishZ : fz;
    for (const t of this.targets()) {
      const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(t.y - b.y) > 2.5) continue;
      const facing = d > 0.1 ? (dx * wx + dz * wz) / d : 1;
      if (facing < -0.2) continue;
      const score = d - facing * 1.5;
      if (score < bs) {
        bs = score;
        best = t;
      }
    }
    return best;
  }

  /**
   * The target of an aimed jutsu or tool (clones, shuriken, Rasenshuriken): the lock-on target, else the enemy
   * nearest the centre of the camera's view (within ~32 degrees; one behind cover counts less), else the melee pick
   * in front of the fighter. Looking at someone is enough to aim at them.
   */
  aimTarget(ctrl, range) {
    const g = this.game, b = ctrl.body;
    const L = ctrl.lockTarget;
    if (L && !L.dead && Math.hypot(L.x - b.x, L.z - b.z) < range + 1) return L;
    const cam = g.camera, fwd = cam.getWorldDirection(_aim), cp = cam.position;
    let best = null, bs = Infinity;
    for (const t of this.targets()) {
      const d = Math.hypot(t.x - b.x, t.z - b.z);
      if (d > range) continue;
      const dx = t.x - cp.x, dy = t.y + 1 - cp.y, dz = t.z - cp.z, l = Math.hypot(dx, dy, dz) || 1;
      const cos = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / l;
      if (cos < 0.85) continue;
      let score = (1 - cos) * 60 + d * 0.03;
      if (!g.world.clear(b.x, b.y + 1.2, b.z, t.x, t.y + 1, t.z)) score += 4;
      if (score < bs) {
        bs = score;
        best = t;
      }
    }
    return best || this.findTarget(ctrl, Math.min(range, 12));
  }

  // ---- input -> actions (called inside the controller's fixed step)

  preStep(ctrl, input) {
    const g = this.game;
    if (ctrl.dead) return;
    const act = ctrl.action;
    if (act && (act instanceof AttackAction || act instanceof ReactAction || act.jutsu)) return;
    if (g.jutsu?.preStep(ctrl, input)) return;
    if (ctrl.st === ST.wall || ctrl.st === ST.dash) {
      // attacks out of a dash are allowed (a dash attack is just the first hit, sooner)
      if (ctrl.st === ST.wall) return;
    }
    const air = !ctrl.grounded;
    if (input.take('heavy', 0.12) && !air) return this.startAttack(ctrl, 'H');
    if (input.take('attack', 0.15)) {
      if (air) {
        if (ctrl.airCombo) return;
        ctrl.airCombo = true;
        return this.startAttack(ctrl, 'A1');
      }
      // two strings: from a standstill or a walk, and on the move (running, sprinting, out of a dash)
      const Lt = ctrl.C.light;
      const moving = ctrl.st === ST.dash || ctrl.speed >= Lt.movingSpeed;
      return this.startAttack(ctrl, moving ? Lt.moving : Lt.stand);
    }
    if (act) return;
    if (!air && input.held('guard') && ctrl.st !== ST.dash) {
      ctrl.action = new GuardAction(g);
      return;
    }
    if (!air && input.held('charge') && ctrl.st !== ST.dash) {
      ctrl.action = new ChargeAction(g);
    }
  }

  startAttack(ctrl, id) {
    if (ctrl.action instanceof GuardAction || ctrl.action instanceof ChargeAction) ctrl.action.step(ctrl, { held: () => false, take: () => false, peek: () => false }, 0);
    if (ctrl.st === ST.dash) ctrl.setState(ctrl.grounded ? ST.loco : ST.air);
    ctrl.action = new AttackAction(this.game, ctrl, id, this.findTarget(ctrl, ctrl.C.moves[id].step.track.range));
    this.prevBox = null;
  }

  // ---- hit detection (every render frame, after the fighters have their poses)

  /**
   * Hit detection for the local fighter's attack, once per drawn frame. The hitbox capsule is taken from the move's
   * own clip (the one being drawn) at every half frame of the active window that passed since the last check, and
   * swept between consecutive samples, so a 3-frame jab hits the same at 20 fps and at 144 fps. Victims are tested
   * on their drawn hurtboxes (what you see is what can be hit).
   */
  detect() {
    const g = this.game, ctrl = g.ctrl, act = ctrl?.action;
    if (!(act instanceof AttackAction) || g.player.dead) {
      this.prevBox = null;
      return;
    }
    const M = act.M, box = M.hit.box, f = act.frame;
    const lo = M.startup, hi = M.startup + M.active;
    if (!this.prevBox || this.prevBox.inst !== act.inst) this.prevBox = { inst: act.inst, f: -1, a: new THREE.Vector3(), b: new THREE.Vector3(), has: false };
    const B = this.prevBox;
    const from = Math.max(lo, B.f), to = Math.min(hi, f);
    if (to <= from && !(f >= lo && f < hi && !B.has)) {
      B.f = Math.max(B.f, f);
      return;
    }
    B.f = f;
    const targets = this.targets().filter((t) => {
      if (act.hitSet.has(t.id) || !t.hurt?.valid) return false;
      if (!t.dummy && (t.entry.react?.invuln?.(g.net.serverNow()) || (t.entry.view?.flags ?? 0) & FLAG.invuln)) return false;
      return Math.hypot(t.x - ctrl.body.x, t.z - ctrl.body.z) < 4.5;
    });
    for (let k = from; k <= Math.max(from, to) + 1e-6; k += 0.5) {
      this.hitboxAt(act, Math.min(k, hi - 0.01), _a1, _b1);
      if (!B.has) {
        _a0.copy(_a1);
        _b0.copy(_b1);
      } else {
        _a0.copy(B.a);
        _b0.copy(B.b);
      }
      B.a.copy(_a1);
      B.b.copy(_b1);
      B.has = true;
      for (const t of targets) {
        if (act.hitSet.has(t.id)) continue;
        const p = sweptHit(_a0, _b0, _a1, _b1, box.r, t.hurt, _hit);
        if (!p) continue;
        // no hits through walls
        const b = ctrl.body;
        if (!g.world.clear(b.x, b.y + 1.1, b.z, p.x, p.y, p.z)) continue;
        act.hitSet.add(t.id);
        this.landHit({ id: act.id, inst: act.inst, k: 0, onHit: (hs) => act.onHit(hs) }, t, p.clone());
      }
    }
    g.debug?.hitbox?.(_a1, _b1, box.r);
  }

  /** The move's hitbox capsule at a frame, from its clip (character space -> world through the drawn root). */
  hitboxAt(act, frame, outA, outB) {
    const me = this.game.player, anim = me.anim, rig = anim.rig;
    const clip = anim.lib.get(act.M.anim);
    const pose = (this._pose ||= anim.pose.constructor ? new anim.pose.constructor() : null);
    clip.sample(frame / 60, pose, rig.hipsY);
    rig.fk(pose);
    const m = me.vrm.scene.matrixWorld;
    if (act.M.hit.box.grip) {
      // a held weapon (the scroll): along the fist's grip axis, exactly where the prop is drawn
      gripSegment(rig, act.M.hit.box, outA, outB);
      outA.applyMatrix4(m);
      outB.applyMatrix4(m);
      return;
    }
    const [ba, bb] = act.M.hit.box.cap;
    outA.copy(rig.P[BI[ba]]).applyMatrix4(m);
    outB.copy(rig.P[BI[bb]]).applyMatrix4(m);
    _v.subVectors(outB, outA).normalize();
    outB.addScaledVector(_v, act.M.hit.box.ext || 0);
  }

  /**
   * A hit on our screen: tell the server, and feel it right now (predicted). h: { id (hit id), inst, k (tick),
   * onHit(hitstop) } — melee moves, jutsu ticks, projectiles and clones all come through here.
   */
  landHit(act, t, point) {
    const g = this.game, n = g.net, ctrl = g.ctrl, b = ctrl.body;
    const at = n.serverNow();
    // (inside an ultimate's cinematic nothing lands: the server refuses it the same way)
    if (g.jutsu?.itachi.cine.frozen(at)) return;
    const e = t.entry;
    const inReact = !t.dummy && e.react && at < e.react.end;
    const vt = t.dummy || inReact ? at : n.renderTime();
    this.stats.sent++;
    this.log?.push({ m: act.id, v: t.id, at: Math.round(at), d: Math.hypot(t.x - b.x, t.z - b.z).toFixed(2) });
    // the hit's source (a clone, a projectile): the knockback pushes away from it, not from the caster
    const src = act.from ? [act.from.x, act.from.y, act.from.z, act.from.yaw ?? ctrl.yaw].map((v) => Math.round(v * 1000) / 1000) : null;
    n.send({ t: 'hit', v: t.id, m: act.id, i: act.inst, k: act.k || 0, at: Math.round(at), vt: Math.round(vt), p: [t.x, t.y, t.z].map((v) => Math.round(v * 1000) / 1000), a: [b.x, b.y, b.z, ctrl.yaw].map((v) => Math.round(v * 1000) / 1000), ...(src ? { c: src } : {}) });
    // prediction with the same rules the server uses
    const spec = hitSpec(ctrl.C.id, act.id);
    // Madara's wind barrier will answer it (the server decides; its n:1 brings the answer's effects): no predicted
    // flinch to undo, just sparks where it struck
    if (!t.dummy && g.jutsu?.madara.countering(e, at, spec, act.inst)) {
      g.fx.block(point);
      g.audio?.impact?.(point, 1, true);
      return;
    }
    const guard = !t.dummy && e.view?.st === ST.guard;
    const combo = t.dummy ? g.dummy.combo : this.remoteCombos.get(t.id);
    const sx = src ? src[0] : b.x, sz = src ? src[2] : b.z, syaw = src ? src[3] : ctrl.yaw;
    const res = resolveHit(spec, {
      ax: sx, az: sz, ayaw: syaw, vx: t.x, vz: t.z, vyaw: e.view?.yaw ?? 0,
      air: !!(inReact && AIRBORNE.has(e.react.r) && at < (e.react.land || e.react.end)),
      combo: combo && at / 1000 <= combo.until + 0.05 ? combo : null, t: at / 1000, guard, dummy: !!t.dummy,
    });
    // the KO blow: the server applies the same rule from the victim's HP (a stale guess is corrected by its hitr)
    if (!t.dummy && !res.blocked && (e.info.hp ?? Infinity) - res.dmg <= 0) koHit(res);
    act.onHit?.(res.hitstop);
    this.feedback(point, res, spec, true);
    // a damage-only tick (burning ground): the victim just flashes, nothing to predict
    if (res.react === REACT.none) {
      if (t.dummy) g.dummy.hit(res, at);
      else e.fighter?.flash();
      return;
    }
    // our combo counter
    if (!res.blocked) {
      this.combo.n = at - this.combo.t < 1400 ? this.combo.n + 1 : 1;
      this.combo.t = at;
      g.hud.combo?.(this.combo.n);
    }
    // the victim reacts now on our screen (the server's hitr will confirm or correct it)
    if (!t.dummy) {
      const h = { a: g.net.id, v: t.id, r: res.react, t0: at + res.hitstop * (1000 / 60), p: [t.x, t.y, t.z], kb: res.kb, st: res.stun, hs: res.hitstop, n: res.n, ko: !!res.ko, predicted: true, key: `${act.inst}:${t.id}:${act.k || 0}` };
      Object.assign(h, reactionTimes(g.world, e.info.ch, h.r, h.p, h.kb, h.t0, h.st, h.ko));
      // (inside a Tsukuyomi a hit that doesn't throw the victim leaves it dazed to the end: the server's rule)
      const pr = e.react;
      keepDaze(h, h.r, pr && !pr.ko && at <= pr.end ? pr.dz : 0, at, h.ko);
      this.remoteCombos.set(t.id, comboAfter(combo, at / 1000, res, (h.land || h.end) / 1000));
      this.startRemoteReaction(e, h);
    } else g.dummy.hit(res, at);
  }

  /** Burst, sparks, flash, shake, sound. */
  feedback(point, res, spec, mine) {
    const g = this.game;
    if (res.react === REACT.none) {
      // a burn tick: a few embers (Amaterasu's: crimson), no burst, no shake
      g.fx.impact(point, 0.3, spec.black ? [0.9, 0.04, 0.3] : [3.2, 1.2, 0.25]);
      return;
    }
    const w = Math.min(4, 1 + (spec.hitstop || 4) / 3 - 1 + (AIRBORNE.has(res.react) ? 1 : 0));
    if (res.blocked) g.fx.block(point);
    else g.fx.impact(point, w);
    if (mine) g.cam.addTrauma(res.blocked ? 0.12 : 0.1 + w * 0.07);
    g.audio?.impact?.(point, w, res.blocked);
  }

  // ---- reactions of remote fighters (predicted or from the server)

  startRemoteReaction(e, h) {
    const g = this.game;
    e.counter = null; // (a hit that lands ends Madara's barrier cast, as on the server: it came before the barrier)
    const prev = e.react;
    // the server confirming our own prediction: same start point and push, so the flight is unchanged
    // a confirmed KO is final (nothing replaces the fall)
    if (prev && prev.ko && !prev.predicted && !h.ko) return;
    if (prev && prev.predicted && prev.key === h.key && !h.predicted) {
      const same = Math.hypot(prev.p[0] - h.p[0], prev.p[1] - h.p[1], prev.p[2] - h.p[2]) < 0.02 && Math.hypot(prev.kb[0] - h.kb[0], prev.kb[1] - h.kb[1], prev.kb[2] - h.kb[2]) < 0.05 && prev.r === h.r && !!prev.ko === !!h.ko;
      if (same) {
        Object.assign(prev, { predicted: false, land: h.land, end: h.end, n: h.n });
        this.stats.confirmed++;
        return;
      }
      this.stats.corrected++;
    }
    if (h.predicted) this.stats.predicted++;
    // a late confirmation of an older hit must not replace a newer predicted one (the next hit of the combo):
    // its own confirmation follows
    if (!h.predicted && prev && prev.predicted && prev.t0 > h.t0) {
      this.stats.late = (this.stats.late || 0) + 1;
      return;
    }
    const f = e.fighter;
    const r = {
      ...h,
      flight: h.r === REACT.wobble ? null : reactionFlight(g.world, e.info.ch, h.r, h.p, h.kb),
      pick: Math.random() < 0.5 ? 'hit_head' : 'hit_body',
      off: f ? [f.pos.x - h.p[0], f.pos.y - h.p[1], f.pos.z - h.p[2]] : [0, 0, 0],
      invuln: (t) => r.land && t >= r.land && t <= r.end,
    };
    // a small jump between what was drawn and the hit's start point eases over (never snaps)
    if (Math.hypot(...r.off) > 3) r.off = [0, 0, 0];
    e.react = r;
    // (Amaterasu's ignition doesn't flash white: its black flames are the feedback)
    if (!/^amaterasu:/.test(String(h.m ?? ''))) f?.flash();
  }

  /** Remote fighter view during a reaction (drawn at the present: juggles connect at any ping). */
  reactionView(e, dt, v) {
    const g = this.game, r = e.react, n = g.net.serverNow();
    if (!r) return false;
    if (n > r.end + 30) {
      // back to the stream: ease from where the reaction left the fighter
      const f = e.fighter;
      e.react = null;
      if (f) {
        e.motion.sample(g.net.renderTime());
        const c = e.motion.cur;
        e.motion.off[0] = f.pos.x - c[0];
        e.motion.off[1] = f.pos.y - c[1];
        e.motion.off[2] = f.pos.z - c[2];
      }
      return false;
    }
    const s = Math.max(0, (n - r.t0) / 1000);
    let x = r.p[0], y = r.p[1], z = r.p[2], vx = 0, vy = 0, vz = 0;
    if (r.flight) {
      if (s < r.flight.t - 1e-6) r.flight = reactionFlight(g.world, e.info.ch, r.r, r.p, r.kb);
      const b = r.flight.advance(s);
      x = b.x;
      y = b.y;
      z = b.z;
      vx = b.vx;
      vy = b.vy;
      vz = b.vz;
    }
    const k = Math.exp(-dt / 0.08);
    for (let i = 0; i < 3; i++) r.off[i] *= k;
    v.x = x + r.off[0];
    v.y = y + r.off[1];
    v.z = z + r.off[2];
    const kl = Math.hypot(r.kb[0], r.kb[2]);
    if (kl > 0.5) v.yaw = Math.atan2(r.kb[0], r.kb[2]);
    else if (v.yaw === undefined) v.yaw = 0;
    const sn = Math.sin(v.yaw), co = Math.cos(v.yaw);
    v.vf = -vx * sn - vz * co;
    v.vl = -vx * co + vz * sn;
    v.vy = vy;
    v.speed = Math.hypot(vx, vz);
    v.yawRate = 0;
    v.sprint = false;
    v.skid = 0;
    v.wall = null;
    v.stepUp = 0;
    v.flipT = -1;
    v.landT = 9;
    v.landV = 0;
    const gu = 34 * F * 1000;
    if (r.r === REACT.wobble) v.act = null;
    else if (r.r === REACT.guard) v.act = { clip: 'guard_hit', t: s + 3 * F, key: 'guard_hit' };
    else if (AIRBORNE.has(r.r)) {
      if (n < r.land) {
        v.act = { clip: 'fly', t: s, key: 'fly' };
        v.st = ST.flight;
      } else if (r.ko || n < r.end - gu) {
        v.act = { clip: 'lie', t: (n - r.land) / 1000, key: 'lie' };
        v.st = ST.down;
      } else {
        v.act = { clip: 'getup', t: (n - (r.end - gu)) / 1000, key: 'getup' };
        v.st = ST.getup;
      }
    } else {
      const dur = Math.max(0.2, r.st * F);
      if (r.dz && (r.r === REACT.daze || s > dur + 3 * F)) v.act = { clip: 'dazed', t: (n / 1000) % 600, key: 'dazed' };
      else v.act = { clip: r.r === REACT.stagger || r.r === REACT.guardBreak ? 'stagger' : r.pick, t: s + 3 * F, dur, key: `react${r.n || 0}` };
      v.st = ST.hit;
    }
    return true;
  }

  // ---- server messages

  onHitr(m) {
    const g = this.game;
    const h = { m: m.m, a: m.a, v: m.v, r: m.r, t0: m.t0, p: m.p, kb: m.kb, st: m.st, hs: m.hs, land: m.l, end: m.e, n: m.n, ko: !!m.ko, dz: m.dz || 0, key: `${m.i}:${m.v}:${m.k || 0}`, blocked: m.b };
    // Itachi's kit: the Tsukuyomi mark, the black flames (every victim, the dummy included)
    g.jutsu?.itachi.onHitr(m);
    const black = /^amaterasu:/.test(m.m);
    if (m.v === 0) {
      g.dummy?.confirm(m);
      // our own server-applied hits on the dummy (never predicted): the number and the burst now
      if (m.a === g.net.id && SERVER_HIT.test(m.m) && g.dummy) {
        g.dummy.hit({ dmg: m.d }, m.at);
        this.feedback(g.dummy.hurt.center, { blocked: !!m.b, react: m.r }, { hitstop: m.hs, black }, true);
      }
      return;
    }
    if (m.v === g.net.id) {
      // we were hit: the reaction takes over our fighter
      g.net.seq = m.sq;
      g.hp = m.hp;
      if (m.r === REACT.none) {
        // a burn tick: HP only, we keep control (Amaterasu's ticks don't flash: its flames are the feedback)
        if (!black) g.player.flash();
        g.hud.hurt?.(m.d, m.hp);
        g.fx.impact(g.player.hurt.center, 0.3, black ? [0.9, 0.04, 0.3] : [3.2, 1.2, 0.25]);
        return;
      }
      // a hit from before our substitution (it crossed our dash on the wire) only costs HP: the log took it
      if (this.subAt && m.at <= this.subAt + 30) {
        g.hud.hurt?.(m.d, m.hp);
        return;
      }
      const ctrl = g.ctrl;
      const att = g.remotes.get(m.a);
      if (att?.fighter) {
        h.ax = att.fighter.pos.x;
        h.az = att.fighter.pos.z;
      }
      if (ctrl.action instanceof GuardAction && m.r === REACT.guard) {
        ctrl.action.stun = 14 * F;
        // (some jutsu drain more of a guard's chakra: the fire torrent)
        ctrl.chakra = Math.max(0, ctrl.chakra - (hitSpec(att?.info.ch, String(m.m))?.guardChakra ?? 4));
      } else {
        if (ctrl.action?.netState === ST.guard && ctrl.action instanceof GuardAction) g.net.act('guard', { on: 0 });
        const V = g.view, old = V && V.x !== undefined ? [V.x, V.y, V.z] : [ctrl.body.x, ctrl.body.y, ctrl.body.z];
        ctrl.action = new ReactAction(g, ctrl, h);
        ctrl.sprint = false;
        // the drawn fighter eases from where it was drawn to where the flight is NOW: at high ping the news of a
        // launch arrives when the flight is already under way (easing only to its start point popped ~0.4 m)
        const fp = ctrl.action.flight.advance(Math.max(0, (g.net.serverNow() - h.t0) / 1000));
        g.visOff = [old[0] - fp.x, old[1] - fp.y, old[2] - fp.z];
        // the body goes there at once (the offset is relative to it; frames drawn before the next sim step would
        // otherwise add it to the old position)
        const b = ctrl.body;
        ctrl.prevX = b.x = fp.x;
        ctrl.prevY = b.y = fp.y;
        ctrl.prevZ = b.z = fp.z;
        if (Math.hypot(...g.visOff) > 3) g.visOff = [0, 0, 0];
      }
      if (!black) g.player.flash();
      // (light ticks: hitstop 2 gave a weight of 0, and an infinite pitch in audio.impact)
      const w = Math.max(0.3, Math.min(4, 1 + (m.hs - 4) / 2 + (AIRBORNE.has(m.r) ? 1 : 0)));
      g.cam.addTrauma(0.15 + w * 0.08);
      const hb = g.player.hurt.center;
      if (!att || att.fighter) {
        if (m.b) g.fx.block(hb);
        else g.fx.impact(hb, w);
      }
      g.audio?.impact?.(hb, w, !!m.b);
      g.hud.hurt?.(m.d, m.hp);
      return;
    }
    const e = g.remotes.get(m.v);
    if (!e) return;
    e.info.hp = m.hp;
    if (m.r === REACT.none) {
      // a burn tick: HP and a flash; the fighter keeps moving on its own stream
      if (!black) e.fighter?.flash();
      if (m.a !== g.net.id && e.fighter) this.feedback(e.fighter.hurt.center, { react: REACT.none }, { black }, false);
      else if (m.a === g.net.id && SERVER_HIT.test(m.m) && e.fighter) this.feedback(e.fighter.hurt.center, { react: REACT.none }, { black }, true);
      g.hud.hp?.(e);
      return;
    }
    // someone else's hit (or ours, confirmed): show it
    if (m.a !== g.net.id) {
      const p = e.fighter?.hurt?.center;
      if (p) this.feedback(p, { blocked: !!m.b, react: m.r }, { hitstop: m.hs }, false);
      // the attacker's own hitstop on their side
      const att = g.remotes.get(m.a);
      if (att) att.hitstopUntil = performance.now() + m.hs * (1000 / 60);
    } else {
      if (!m.b && m.n) this.combo.n = Math.max(this.combo.n, m.n);
      // our counter's blow / reflection, our meteor, our gazes: applied by the server, never predicted here
      const p = SERVER_HIT.test(m.m) && e.fighter?.hurt?.center;
      if (p) this.feedback(p, { blocked: !!m.b, react: m.r }, { hitstop: m.hs }, true);
    }
    this.startRemoteReaction(e, h);
    // (a genjutsu opens no combo: the next hit starts one, as on the server)
    if (m.r === REACT.daze) this.remoteCombos.delete(m.v);
    else this.remoteCombos.set(m.v, { n: m.n, start: this.remoteCombos.get(m.v)?.start ?? m.at / 1000, until: (m.l || m.e) / 1000 });
    g.hud.hp?.(e);
  }

  onHitx(m) {
    this.stats.rejected++;
    this.log?.push({ rejected: m.why, i: m.i });
    // the server rejected a hit we predicted: undo the victim's predicted reaction (it eases back to the stream)
    const e = this.game.remotes.get(m.v);
    if (e?.react?.predicted && e.react.key === `${m.i}:${m.v}:${m.k || 0}`) e.react.end = this.game.net.serverNow();
    if (this.game.debugHits) console.log('[shinobi] hit rejected:', m.why);
  }

  /**
   * A KO with no KO reaction on this screen (the killing hit crossed our substitution on the wire, or its hitr was
   * superseded): the fighter collapses backward where it stands instead of popping into the lying pose.
   * `e`: a remote entry, or null for the local fighter.
   */
  koCollapse(e) {
    const g = this.game, n = g.net.serverNow();
    if (e) {
      const f = e.fighter;
      if (!f || e.react?.ko) return;
      const p = [f.pos.x, f.pos.y, f.pos.z];
      const h = { r: REACT.knockback, t0: n, p, kb: [Math.sin(f.yaw) * 2.5, 4.5, Math.cos(f.yaw) * 2.5], st: 0, hs: 0, n: 0, ko: true, key: 'ko' };
      Object.assign(h, reactionTimes(g.world, e.info.ch, h.r, h.p, h.kb, h.t0, 0, true));
      this.startRemoteReaction(e, h);
      return;
    }
    const ctrl = g.ctrl, b = ctrl.body;
    if (ctrl.action?.h?.ko) return;
    const h = { r: REACT.knockback, t0: n, p: [b.x, b.y, b.z], kb: [Math.sin(ctrl.yaw) * 2.5, 4.5, Math.cos(ctrl.yaw) * 2.5], st: 0, hs: 0, n: 0, ko: true };
    Object.assign(h, reactionTimes(g.world, ctrl.C.id, h.r, h.p, h.kb, h.t0, 0, true));
    ctrl.action = new ReactAction(g, ctrl, h);
    ctrl.sprint = false;
  }

  /** Substitution: a log where we stood, a poof, and we reappear 6 m away (validated by the server). */
  substitute(react) {
    const g = this.game, ctrl = g.ctrl, b = ctrl.body;
    const h = react.h;
    let ax = h.ax ?? b.x + Math.sin(ctrl.yaw), az = h.az ?? b.z + Math.cos(ctrl.yaw);
    // away from the attacker, off to one side
    let dx = b.x - ax, dz = b.z - az;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const side = Math.random() < 0.5 ? 1 : -1;
    const tx = dx * 0.8 - dz * 0.6 * side, tz = dz * 0.8 + dx * 0.6 * side;
    let x = b.x + tx * 6, z = b.z + tz * 6;
    const pos = { x, z };
    g.world.pushOut(pos, ctrl.opts.r, b.y, b.y + ctrl.opts.h, 0.45, null);
    x = pos.x;
    z = pos.z;
    const y = g.world.ground(x, z, b.y + 2, {}).y;
    const from = { x: b.x, y: b.y, z: b.z };
    this.subAt = g.net.serverNow();
    g.logs?.spawn(from, ctrl.yaw);
    g.fx.poof(from, 1);
    g.net.act('sub', { p: [x, y, z].map((v) => Math.round(v * 1000) / 1000) });
    ctrl.teleportTo([x, y, z], Math.atan2(-(ax - x), -(az - z)));
    ctrl.invulnUntil = g.net.serverNow() / 1000 + 0.4;
    g.player.snap(x, y, z, ctrl.yaw);
    g.fx.poof({ x, y, z }, 0.8);
    g.jutsu.itachi.onSub(ctrl.C, from, { x, y, z }); // (Itachi's crow shift: crows and ink)
    g.audio?.poof?.();
  }
}

export { COMBO, SIM };
