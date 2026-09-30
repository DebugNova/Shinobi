// Naruto's jutsu kit, Jiraiya training era (data: src/shared/naruto.js, clips: src/char/narutomoves.js, visuals:
// src/gfx/narutofx.js + fx.js). The local fighter's casts, and everyone's as visuals:
//   Q  Shadow Clone Jutsu   the cross seal, four clones burst out round him and fight on their own for 9 s. The
//                           caster's client runs them (the fighters' physics, their own M1 strings) and streams their
//                           states ('cs', like a fighter's); every other screen draws them from that stream. They
//                           can be hit: the server keeps their HP ('ch' per hit, n:2 when one is gone).
//   E  Rasengan             hold to charge (a clone shapes the sphere in his palm), the mouse aims, release: a dash;
//                           contact = the blast (hitstop, the victim thrown back). n:0 press, n:1 release, n:2 end.
//   G  Shadow Clone         a clone takes his place; a hit inside the window is caught (the server decides: n:2 to
//      Substitution        everyone), he re-forms behind the attacker, who is staggered; else he re-forms a few
//                           metres away (n:1, his spot).
//   X  Shadow Clone Rush    three clones burst out beside him and charge the target (every screen runs them from the
//                           press on the server clock and his spot then, homing on the target as it draws it, turning
//                           slowly: a dash sideways shakes them); two strike, the third launches; he drops out of the
//                           sky on it (the NR move) if the launch landed. He holds the seal: hit him and they burst.
// Clone bodies are pooled VRM instances with their Fighter kept (Bodies): taking one is a scene.add, never a parse.
import * as THREE from 'three';
import { ST, FLAG, SIM } from '../shared/config.js';
import { charOf, DEFAULT_CHARACTER } from '../shared/characters.js';
import { makeBody, stepBody } from '../shared/physics.js';
import { RemoteMotion } from './remote.js';
import { Fighter } from './fighter.js';
import { AttackAction } from './combat.js';
import { segSeg } from './hurtbox.js';
import { Afterimages, RasenganBlasts } from '../gfx/narutofx.js';

const F = 1 / 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const turn = (yaw, to, rate, dt) => yaw + clamp(wrap(to - yaw), -rate * dt, rate * dt);
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const r3 = (v) => Math.round(v * 1000) / 1000;
const QUALITY = { low: 0.45, medium: 0.7, high: 1, ultra: 1.25 };
// HDR colours (the bloom takes what is over 1)
const BLUE = [0.55, 1.5, 3.2], PALE = [1.6, 2.2, 2.8], WARM = [2.2, 1.55, 0.8], WHITE = [2.1, 2.1, 2.2];
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _p = new THREE.Vector3(), _g = {}, _g2 = { x: 0, z: 0 };
// every clip of the kit (a Naruto-kit fighter drawn in one of them has its effects run: updateFighter)
const KIT_CLIPS = new Set(['kb_seal', 'ras_charge', 'ras_dash', 'ras_hit', 'ras_whiff', 'nr_rush', 'nr_drop', 'cd_seal', 'cd_appear']);
// the finisher's frames hidden in smoke (the warp: naruto.js NR)
const NR_HIDE = [6, 16];

function bonePos(f, name, out) {
  const n = f?.vrm?.humanoid.getRawBoneNode(name);
  return n ? n.getWorldPosition(out) : out.copy(f.pos).setY(f.pos.y + 1.1);
}

// ---------------------------------------------------------------- clone bodies

/** Pooled clone bodies per character: a parsed VRM with its Fighter (and hurtbox) kept; taking one adds it to the scene. */
class Bodies {
  constructor(K) {
    this.K = K;
    this.by = new Map(); // character id -> [{ vrm, f, busy, since, user }]
  }

  async warm(n) {
    const g = this.K.game;
    for (const [id, e] of g.chars) {
      if (!e.C.jutsu.shadowClones && !e.C.jutsu.clones) continue; // (a kit without clones needs no clone bodies)
      const list = [];
      for (let i = 0; i < n; i++) {
        const vrm = await e.model.parse();
        vrm.taken = true;
        const f = new Fighter({ id: `clone-${id}-${i}`, name: '', slot: 0, local: false, vrm, rig: e.model.rig, lib: e.lib, world: g.world, scene: g.scene });
        f.noRing = true; // a clone is not a player: no ring under it
        // (several at once: drawn like a mid-distance fighter, the screen-space outline gives their silhouette)
        f.lodMin = 1;
        g.combat.attach(f);
        f.root.removeFromParent();
        f.ring.removeFromParent();
        list.push({ vrm, f, busy: false, since: 0, user: null, ch: id });
      }
      this.by.set(id, list);
      this.K.ghosts.prepare(e.model, list[0].vrm);
    }
  }

  /** A free body of the character (else the oldest in use gives its body up: its user bursts it first). */
  take(ch, user) {
    const list = this.by.get(ch) || this.by.get(DEFAULT_CHARACTER) || [...this.by.values()][0];
    if (!list?.length) return null;
    let e = list.find((x) => !x.busy);
    if (!e) {
      e = list.reduce((a, b) => (a.since < b.since ? a : b));
      e.user?.lose?.(e);
    }
    e.busy = true;
    e.since = performance.now();
    e.user = user;
    const g = this.K.game;
    g.scene.add(e.f.root);
    e.f.root.visible = true;
    e.f.visible = true;
    e.f.dead = false;
    e.f.flashT = 0;
    return e;
  }

  give(e) {
    if (!e || !e.busy) return;
    e.busy = false;
    e.user = null;
    e.f.root.removeFromParent();
  }

  /** Every body in use (shadow casters, Tsukuyomi hiding them). */
  *active() {
    for (const list of this.by.values()) for (const e of list) if (e.busy) yield e;
  }
}

// ---------------------------------------------------------------- the casts (local fighter)

/** Shared by the casts: hang in the air through them, face a target (or the camera's way). */
class Cast {
  constructor(K, ctrl, m, extra = {}) {
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
    if (this.air) {
      this.physicsOpts = { ...ctrl.opts, gravity: ctrl.opts.gravity * 0.15, fallMul: 1 };
      ctrl.body.vy = Math.max(0, ctrl.body.vy * 0.2);
    }
    ctrl.sprint = false;
    this.at = Math.round(g.net.serverNow());
    g.net.act('jutsu', { m, i: this.inst, f: this.air ? 1 : 0, at: this.at, ...extra });
    g.lastFight = performance.now();
  }

  hold(ctrl, dt, yawTo = null, rate = 12) {
    const b = ctrl.body;
    b.vx *= 0.8;
    b.vz *= 0.8;
    if (this.air && b.vy > 0) b.vy *= 0.85;
    if (yawTo !== null) ctrl.yaw = ctrl.moveYaw = turn(ctrl.yaw, yawTo, rate, dt);
  }
}

/** Q: the cross seal; the clones burst out one after another (the first pop sends every spot: n:1). */
class SealAction extends Cast {
  constructor(K, ctrl) {
    super(K, ctrl, 'shadowClones');
    this.popped = 0;
    K.game.audio?.handsign?.();
  }

  anim() {
    return { clip: 'kb_seal', t: this.t, key: `kbs${this.inst}` };
  }

  step(ctrl, input, dt) {
    const D = this.D;
    this.t += dt;
    this.hold(ctrl, dt);
    while (this.popped < D.pop.length && this.t >= D.pop[this.popped] * F) {
      if (!this.popped) this.K.spawnOwn(ctrl, this);
      this.K.popOwn(this.popped++);
    }
    return this.t < D.total * F;
  }
}

/**
 * E: the Rasengan. charge (held; the mouse aims) -> dash (homing, contact = the blast) -> impact (braced through the
 * hitstop) or whiff (a skid). The contact is found on the drawn hurtboxes every frame (NarutoKit.detectRasengan).
 */
class RasenganAction extends Cast {
  constructor(K, ctrl, slot) {
    super(K, ctrl, 'rasengan');
    this.slot = slot;
    this.phase = 'charge';
    this.big = false;
    this.target = null;
    this.stop = 0;
    this.phT = 0;
    K.game.audio?.rasengan?.();
  }

  anim() {
    const g = this.K.game;
    // (between sim ticks the clip moves on with the frame, like the attacks)
    const t = this.phT + (this.stop > 0 ? 0 : (g.alpha || 0) * F);
    if (this.phase === 'charge') return { clip: 'ras_charge', t, key: `rasc${this.inst}` };
    if (this.phase === 'dash') return { clip: 'ras_dash', t, key: `rasd${this.inst}` };
    if (this.phase === 'impact') return { clip: 'ras_hit', t: this.phT, key: `rash${this.inst}` };
    return { clip: 'ras_whiff', t, key: `rasw${this.inst}` };
  }

  /** The sphere's size on screen (1 = a Rasengan, 1.45 = the Big Rasengan). */
  get sphere() {
    const D = this.D;
    if (this.phase === 'charge') return chargeSize(D, this.phT);
    const s = this.big ? 1.45 : 1;
    if (this.phase === 'dash') return s;
    if (this.phase === 'impact') return s * (1 - ss(D.impact * F, (D.impact + 5) * F, this.phT));
    return s * (1 - ss(0, 0.2, this.phT));
  }

  step(ctrl, input, dt) {
    const b = ctrl.body, D = this.D, K = this.K;
    this.t += dt;
    if (this.stop > 0) {
      // the blast's hitstop: everything holds
      this.stop -= dt;
      b.vx = b.vz = b.vy = 0;
      return true;
    }
    this.phT += dt;
    const f = this.phT / F;
    if (this.phase === 'charge') {
      this.hold(ctrl, dt);
      // aim: toward where the camera looks, pulled onto an enemy near that line (or the lock-on target)
      this.target = K.rasenganTarget(ctrl, D);
      const want = this.target ? Math.atan2(-(this.target.x - b.x), -(this.target.z - b.z)) : K.game.cam.yaw;
      ctrl.yaw = ctrl.moveYaw = turn(ctrl.yaw, want, D.aim.rate, dt);
      if ((f >= D.charge.min && !input.held(this.slot)) || f >= D.charge.max) this.release(ctrl, f >= D.charge.full);
      return true;
    }
    if (this.phase === 'dash') {
      // homing on the target's drawn position at a limited turn rate, only while it stays in front and in range
      const T = this.target && K.liveTarget(this.target);
      if (T && K.dashTracks(ctrl, T, D)) {
        const want = Math.atan2(-(T.x - b.x), -(T.z - b.z));
        ctrl.yaw = ctrl.moveYaw = turn(ctrl.yaw, want, D.dash.turn, dt);
      }
      const sp = D.dash.speed * (1 - 0.25 * ss(0.7, 1, this.phT / D.dash.time));
      b.vx = -Math.sin(ctrl.yaw) * sp;
      b.vz = -Math.cos(ctrl.yaw) * sp;
      if (b.vy > 0) b.vy = 0;
      // a wall stops it (a whiff)
      if (this.phT > 3 * F && b.contacts > 0 && b.cnx * b.vx + b.cnz * b.vz < -0.6 * sp) this.end(ctrl, false);
      else if (this.phT >= D.dash.time) this.end(ctrl, false);
      return true;
    }
    if (this.phase === 'impact') {
      b.vx = b.vz = 0;
      if (this.air) b.vy = 0;
      return this.phT < (D.impact + D.recovery) * F;
    }
    // whiff: a skid to a stop
    const k = Math.max(0, 1 - dt * 9);
    b.vx *= k;
    b.vz *= k;
    return this.phT < D.whiff * F;
  }

  release(ctrl, big) {
    const g = this.K.game, b = ctrl.body;
    this.big = big;
    this.phase = 'dash';
    this.phT = 0;
    this.physicsOpts = { ...ctrl.opts, gravity: ctrl.opts.gravity * 0.4 };
    // nothing aimed at: take the enemy nearest his facing within the dash's cone and range
    if (!this.target) this.target = this.K.dashTarget(ctrl, this.D);
    const d = [-Math.sin(ctrl.yaw), 0, -Math.cos(ctrl.yaw)];
    g.net.act('jutsu', { m: 'rasengan', i: this.inst, n: 1, f: big ? 1 : 0, o: [b.x, b.y, b.z].map(r3), d: d.map(r3), tg: this.target?.id, at: Math.round(g.net.serverNow()) });
    g.fx.dust(b, 8, 1.3);
    g.audio?.dash?.(g.player.pos);
  }

  /** The dash ends: into the blast (hit) or a skid. Everyone hears which (n:2). */
  end(ctrl, hit, hitstop = 0) {
    const g = this.K.game;
    this.phase = hit ? 'impact' : 'whiff';
    this.phT = 0;
    this.stop = hit ? hitstop * F : 0;
    this.physicsOpts = null;
    g.net.act('jutsu', { m: 'rasengan', i: this.inst, n: 2, f: hit ? 1 : 0, at: Math.round(g.net.serverNow()) });
  }
}

/** The sphere's size through the charge (the same on every screen from the clip's time). */
function chargeSize(D, t) {
  const f = t / F;
  if (f < D.charge.min) return 0.15 + 0.85 * ss(2, D.charge.min, f);
  return 1 + 0.45 * ss(D.charge.min, D.charge.full, f);
}

/**
 * X: Shadow Clone Rush. The seal while the clones charge (NarutoKit.updateRushes), then, if their launch landed, the
 * finisher (the NR move) takes over; with nothing launched he lets the seal go once they are done.
 */
class RushAction extends Cast {
  constructor(K, ctrl, target) {
    const b = ctrl.body;
    const yaw = Math.atan2(-(target.x - b.x), -(target.z - b.z));
    super(K, ctrl, 'clones', { tg: target.id, o: [b.x, b.y, b.z, yaw].map(r3) });
    this.target = target;
    ctrl.yaw = ctrl.moveYaw = yaw;
    this.R = K.rushStart(K.game.net.id, this.inst, this.at, target.id, [b.x, b.y, b.z, yaw].map(r3), ctrl.C, true);
    this.R.action = this;
    this.endT = 0;
    K.game.audio?.handsign?.();
  }

  anim() {
    return { clip: 'nr_rush', t: this.t, key: `nrr${this.inst}` };
  }

  step(ctrl, input, dt) {
    const D = this.D, b = ctrl.body, R = this.R;
    this.t += dt;
    const T = this.K.liveTarget(this.target);
    this.hold(ctrl, dt, T ? Math.atan2(-(T.x - b.x), -(T.z - b.z)) : null, 10);
    // the launch landed on our screen: he drops out of the sky on it
    if (R.launchT && !R.broken && T && this.t >= R.launchT + D.finisher) {
      this.replace = new AttackAction(this.K.game, ctrl, 'NR', T);
      return false;
    }
    // nothing launched and every clone done (a whiff, the target gone): the seal let go
    if (R.broken || (R.over && !R.launchT)) {
      if (!this.endT) this.endT = this.t;
      return this.t < this.endT + 0.18;
    }
    return this.t < D.total;
  }
}

/**
 * G: the substitution. At `vanish` he is gone in smoke and a clone stands in his place (NarutoKit.decoys). A caught hit
 * (the server's n:2) moves him behind the attacker (onCaught); otherwise he re-forms at his own spot at `reform` (n:1).
 * Invulnerable for `invuln` s, but the flag only goes up after the window (hits in it must reach the server: gotcha 48).
 */
class DefenseAction extends Cast {
  constructor(K, ctrl) {
    super(K, ctrl, 'cloneDefense');
    const t = ctrl.t || K.game.net.serverNow() / 1000;
    ctrl.invulnFrom = t + this.D.window * F;
    ctrl.invulnUntil = t + this.D.invuln;
    if (this.air) {
      this.physicsOpts = { ...ctrl.opts, gravity: 0, fallMul: 1 };
      ctrl.body.vy = 0;
    }
    this.gone = false;
    this.back = false; // re-formed (caught or not)
    this.caught = false;
    this.reT = 0;
    this.d = K.decoyStart(K.game.net.id, this.inst, this.at, ctrl.C, true);
    K.game.audio?.handsign?.();
  }

  anim() {
    if (this.back) return { clip: 'cd_appear', t: this.t - this.reT, key: `cda${this.inst}` };
    return { clip: 'cd_seal', t: this.t, key: `cds${this.inst}` };
  }

  step(ctrl, input, dt) {
    const D = this.D;
    this.t += dt;
    const b = ctrl.body;
    b.vx *= 0.7;
    b.vz *= 0.7;
    if (this.air || !ctrl.grounded) b.vy = Math.min(0, b.vy);
    if (!this.back && this.t >= D.reform * F) this.K.reformOwn(ctrl, this, input);
    return this.t < (this.back ? this.reT + 16 * F : D.total * F);
  }
}

// jutsu id -> { ok(J, ctrl), start(J, ctrl, slot) } (merged into jutsu.js's registry)
export const NARUTO_CASTS = {
  shadowClones: { ok: () => true, start: (J, ctrl) => new SealAction(J.naruto, ctrl) },
  rasengan: { ok: () => true, start: (J, ctrl, slot) => new RasenganAction(J.naruto, ctrl, slot) },
  cloneDefense: { ok: () => true, start: (J, ctrl) => new DefenseAction(J.naruto, ctrl) },
  // (the Rush needs someone to charge: nothing spent without a target)
  clones: {
    ok: (J, ctrl) => !!J.naruto.rushTarget(ctrl),
    why: 'No target',
    start: (J, ctrl) => new RushAction(J.naruto, ctrl, J.naruto.rushTarget(ctrl)),
  },
};

// ---------------------------------------------------------------- the kit

export class NarutoKit {
  constructor(J) {
    this.J = J;
    this.game = J.game;
    const s = this.game.scene;
    this.bodies = new Bodies(this);
    this.ghosts = new Afterimages(s);
    this.blasts = new RasenganBlasts(s);
    this.own = null; // our shadow clones: { inst, list: [clone], sendT }
    this.remote = new Map(); // `${owner}:${slot}` -> a remote shadow clone (drawn from its caster's stream)
    this.rushes = []; // Shadow Clone Rush timelines (every screen)
    this.decoys = []; // Shadow Clone Substitution: the clone in his place (every screen)
    this.helpers = new Map(); // fighter -> the clone shaping its Rasengan
    this.per = new Map(); // fighter -> { key, last (clip frame), ghostT, hidden }
    this.wakes = []; // a blasted victim's spiral wake: { f, t }
    this.lastVictim = null; // { id, at } (our clones go for whoever we hit last)
    this.gapUntil = new Map(); // target id -> kit time until which no clone of ours starts a string on it
    this.time = 0;
  }

  quality() {
    return QUALITY[this.game.preset] ?? 1;
  }

  // ---------------------------------------------------------------- helpers

  /** A target entry by id as drawn now (fighters and the dummy; never a clone), or null. */
  liveTarget(T) {
    if (!T) return null;
    for (const t of this.game.combat.targets()) if (t.id === T.id && !t.clone) return t;
    return null;
  }

  /** The feet of fighter `id` as drawn on this screen (us, a remote, the dummy), or null. */
  feet(id, out) {
    const g = this.game;
    if (id === g.net.id) return g.player && !g.player.dead ? out.copy(g.player.pos) : null;
    if (id === 0) return g.dummy ? out.copy(g.dummy.pos) : null;
    const f = g.remotes.get(id)?.fighter;
    return f && !f.dead ? out.copy(f.pos) : null;
  }

  /** The fighter drawn for id (ours, a remote's, the dummy's root is not a Fighter: null). */
  fighterOf(id) {
    const g = this.game;
    if (id === g.net.id) return g.player;
    return g.remotes.get(id)?.fighter || null;
  }

  modelOf(ch) {
    return this.game.charModel(ch).model;
  }

  /**
   * A shadow clone's burst of smoke (appearing or gone): the cloud cluster (fx.poof: toon balls bursting out, then
   * breaking up), a flat shock ring at the feet, a flash, a few white speed lines. `light`: five small balls and the
   * flash only (the Rush's clones come and go near the fight: full clouds buried it).
   */
  poof(p, scale = 1, sound = true, light = false) {
    const fx = this.game.fx, q = this.quality();
    if (light) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * 6.283 + Math.random() * 0.6, sp = (1.4 + Math.random() * 0.7) * scale;
        fx.emit(7, p.x + Math.cos(a) * 0.12, p.y + (0.5 + Math.random() * 0.6) * scale, p.z + Math.sin(a) * 0.12, Math.cos(a) * sp, 0.5, Math.sin(a) * sp, 0.3 + Math.random() * 0.1, 0.18 * scale, 0.46 * scale, 0.88, 0.88, 0.9);
      }
      fx.emit(5, p.x, p.y + 0.9, p.z, 0, 0, 0, 0.07, 0.2, 0.7 * scale, 1.2, 1.2, 1.3);
      if (sound) this.game.audio?.poof?.(p);
      return;
    }
    fx.poof(p, scale);
    fx.emit(5, p.x, p.y + 0.9 * scale, p.z, 0, 0, 0, 0.08, 0.3 * scale, 0.8 * scale, 1.2, 1.2, 1.3);
    fx.emit(4, p.x, p.y + 0.04, p.z, 0, 0, 0, 0.32, 0.25 * scale, 1.5 * scale, 1.0, 1.0, 1.0, 0.75);
    // (not HDR: streaks flying at the camera are seen end on, as dots, and bloomed into soft white balls)
    for (let k = 0, n = Math.round(4 * q); k < n; k++) {
      const a = Math.random() * 6.283, sp = 7 + Math.random() * 4;
      fx.emit(2, p.x, p.y + (0.5 + Math.random() * 0.8) * scale, p.z, Math.cos(a) * sp, 1 + Math.random() * 2, Math.sin(a) * sp, 0.1, 0.045, 0.02, 0.9, 0.9, 0.95);
    }
    if (sound) this.game.audio?.poof?.(p);
  }

  /** The seal's smoke: a ring of cloud rolling out along the ground round him, a shock ring, a warm flash. */
  sealBurst(f) {
    const fx = this.game.fx, p = f.pos;
    const gy = this.game.world.ground(p.x, p.z, p.y + 0.5, _g).y;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * 6.283 + Math.random() * 0.3, sp = 2.6 + Math.random();
      fx.emit(7, p.x + Math.cos(a) * 0.4, gy + 0.15 + Math.random() * 0.25, p.z + Math.sin(a) * 0.4, Math.cos(a) * sp, 0.2 + Math.random() * 0.3, Math.sin(a) * sp, 0.42 + Math.random() * 0.12, 0.16, 0.42, 0.86, 0.86, 0.88);
    }
    fx.emit(4, p.x, gy + 0.04, p.z, 0, 0, 0, 0.4, 0.3, 1.9, 1.0, 0.98, 0.9, 0.7);
    fx.emit(5, p.x, p.y + 1.1, p.z, 0, 0, 0, 0.1, 0.2, 0.8, 1.8, 1.7, 1.4);
    this.game.audio?.poof?.(p);
  }

  // ---------------------------------------------------------------- Q: Shadow Clone Jutsu (ours: simulated here)

  /** Where the clones appear: a ring round him (two ahead at the flanks, two behind), out of walls, on the ground. */
  spawnOwn(ctrl, a) {
    const g = this.game, b = ctrl.body, D = a.D, CL = D.clone;
    this.clearOwn(true);
    const air = !ctrl.grounded;
    const spots = [];
    for (let k = 0; k < CL.count; k++) {
      const ang = ctrl.yaw + [0.95, -0.95, Math.PI, 2.35][k % 4];
      const pos = { x: b.x - Math.sin(ang) * CL.ring, z: b.z - Math.cos(ang) * CL.ring };
      g.world.pushOut(pos, ctrl.opts.r, b.y, b.y + ctrl.opts.h, 0.45, null);
      let y = b.y;
      if (!air) {
        const gy = g.world.ground(pos.x, pos.z, b.y + 1, _g).y;
        if (Math.abs(gy - b.y) < 1.5) y = gy;
      }
      spots.push([k, r3(pos.x), r3(y), r3(pos.z), r3(ctrl.yaw)]);
    }
    this.own = { inst: a.inst, list: [], sendT: 0, spots, C: ctrl.C, opts: ctrl.opts };
    g.net.act('jutsu', { m: 'shadowClones', i: a.inst, n: 1, c: spots, at: Math.round(g.net.serverNow()) });
  }

  /** Clone k of ours bursts out of the smoke at its spot. */
  popOwn(k) {
    const O = this.own, g = this.game;
    if (!O) return;
    const s = O.spots[k];
    if (!s) return;
    const CL = O.C.jutsu.shadowClones.clone;
    const c = {
      slot: s[0], e: null, b: makeBody(s[1], s[2], s[3]), yaw: s[4], yawRate: 0, t: 0, life: O.C.jutsu.shadowClones.life, hp: CL.hp,
      state: 'spawn', stateT: 0, tgt: null, pickT: 0, move: 0, moveT: 0, hitK: 0, stunT: 0, restT: 0, clip: 'cr_ready', clipT: 0, clipN: 1,
      view: {}, airT: 0, landT: 9, landV: 0, hardLand: false, jumps: 0, flipT: -1, stepUp: 0, gone: false, hitDone: new Set(),
      lose: (e) => this.goneOwn(c, 'stolen', true),
    };
    c.b.ground = g.world.ground(s[1], s[3], s[2] + 0.3, _g).y > s[2] - 0.2;
    c.e = this.bodies.take(O.C.id, c);
    if (!c.e) return;
    c.f = c.e.f;
    c.f.snap(s[1], s[2], s[3], s[4]);
    O.list.push(c);
    this.poof({ x: s[1], y: s[2], z: s[3] }, 0.72, k === 0);
    this.ghosts.spawn(this.modelOf(O.C.id), c.f, WARM, 0.18, 0.35);
  }

  /** One of ours is gone: a burst of smoke; `tell`: the server hears it (its own reasons come from it). */
  goneOwn(c, why, tell) {
    if (c.gone) return;
    c.gone = true;
    const g = this.game;
    this.poof({ x: c.b.x, y: c.b.y, z: c.b.z }, 0.95);
    this.bodies.give(c.e);
    if (tell && this.own) g.net.act('jutsu', { m: 'shadowClones', i: this.own.inst, n: 2, s: c.slot, at: Math.round(g.net.serverNow()) });
  }

  /** All of ours gone (a new cast, a KO, a respawn). */
  clearOwn(tell = false) {
    if (!this.own) return;
    for (const c of this.own.list) this.goneOwn(c, 'clear', tell);
    this.own = null;
  }

  /**
   * Whom a clone goes for: our lock-on target, else whoever we hit last (3 s), else the nearest enemy within `range`
   * of us (the clones extend our combos: they pile onto what we fight).
   */
  pickFor(c, CL) {
    const g = this.game, me = g.ctrl.body;
    const ok = (t) => t && !t.clone && Math.hypot(t.x - me.x, t.z - me.z) <= CL.range && Math.abs(t.y - me.y) < 8;
    const L = g.ctrl.lockTarget;
    if (L && !L.dead) {
      const t = this.liveTarget(L);
      if (ok(t)) return t.id;
    }
    if (this.lastVictim && performance.now() - this.lastVictim.at < 3000) {
      const t = this.liveTarget(this.lastVictim);
      if (ok(t)) return t.id;
    }
    let best = null, bd = Infinity;
    for (const t of g.combat.targets()) {
      if (!ok(t)) continue;
      const d = Math.hypot(t.x - c.b.x, t.z - c.b.z) + (t.dummy ? 6 : 0); // (players before the training dummy)
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best ? best.id : null;
  }

  updateOwn(dt) {
    const O = this.own, g = this.game;
    if (!O) return;
    const C = O.C, CL = C.jutsu.shadowClones.clone;
    for (const c of O.list) {
      if (c.gone) continue;
      c.t += dt;
      if (c.t >= c.life) {
        this.goneOwn(c, 'life', true);
        continue;
      }
      for (let left = dt; left > 1e-6 && !c.gone; left -= SIM.dt) this.stepOwn(c, Math.min(SIM.dt, left), C, CL);
      if (c.gone) continue;
      const b = c.b, v = c.view;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      Object.assign(v, {
        x: b.x, y: b.y, z: b.z, yaw: c.yaw, vf: -b.vx * s - b.vz * co, vl: -b.vx * co + b.vz * s, vy: b.vy, speed: Math.hypot(b.vx, b.vz),
        yawRate: c.yawRate || 0, st: b.ground ? ST.loco : ST.air, stT: b.ground ? c.t : c.airT, sprint: b.ground && Math.hypot(b.vx, b.vz) > 9, skid: 0,
        ground: b.ground, flipT: c.flipT, landT: c.landT, landV: c.landV, hardLand: c.hardLand, wall: null, stepUp: c.stepUp, combat: true,
      });
      c.stepUp = 0;
      v.act = c.clip ? { clip: c.clip, t: c.clipT, key: `oc${c.slot}${c.clipN}`, dur: c.clipDur } : null;
      c.f.update(dt, v);
    }
    O.list = O.list.filter((c) => !c.gone);
    // the stream: every clone's state, 20 times a second
    O.sendT += dt;
    if (O.sendT >= 0.05 && O.list.length) {
      O.sendT = 0;
      const rows = O.list.map((c) => {
        const b = c.b;
        let fl = 0;
        if (b.ground && Math.hypot(b.vx, b.vz) > 9) fl |= FLAG.sprint;
        if (c.jumps >= 2) fl |= FLAG.doubleJumped;
        return [c.slot, r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz), r3(c.yaw), b.ground ? ST.loco : ST.air, Math.round((b.ground ? c.t : c.airT) * 1000), fl, c.clip ? `${c.clip}#${c.clipN}` : '', Math.round(c.clipT * 1000)];
      });
      g.net.send({ t: 'cs', i: O.inst, c: rows });
    }
  }

  setClip(c, clip, dur = 0) {
    c.clip = clip;
    c.clipT = 0;
    c.clipDur = dur;
    c.clipN++;
  }

  /** One fixed step of one of our clones: the fighters' body physics, a small fight AI. */
  stepOwn(c, dt, C, CL) {
    const g = this.game, b = c.b, me = g.ctrl.body;
    c.stateT += dt;
    if (c.clip) c.clipT += dt;
    // a target to fight: picked a few times a second (and at once when we land a hit on someone new)
    c.pickT -= dt;
    const lv = this.lastVictim;
    if (c.pickT <= 0 || (lv && lv.at > (c.pickedAt || 0))) {
      c.tgt = this.pickFor(c, CL);
      c.pickT = 0.25;
      c.pickedAt = performance.now();
    }
    let T = c.tgt !== null ? this.liveTarget({ id: c.tgt }) : null;
    // (a clone never strays far from him)
    if (T && Math.hypot(b.x - me.x, b.z - me.z) > CL.leash) T = null;
    let d = 99, dy = 0, dx = 0, dz = 0;
    if (T) {
      d = Math.hypot(T.x - b.x, T.z - b.z);
      dy = T.y - b.y;
      if (d > 0.05) {
        dx = (T.x - b.x) / d;
        dz = (T.z - b.z) / d;
      }
    }
    const yaw0 = c.yaw;
    let opts = g.ctrl.opts;
    const brake = (k) => {
      const s = Math.max(0, 1 - dt * k);
      b.vx *= s;
      b.vz *= s;
    };
    switch (c.state) {
      case 'spawn':
        brake(12);
        if (c.stateT >= 0.22) this.toState(c, 'seek');
        break;
      case 'hit':
        brake(7);
        if (c.stateT >= CL.stun) this.toState(c, 'rest', 0.15);
        break;
      case 'rest':
        brake(10);
        if (T) c.yaw = turn(c.yaw, Math.atan2(-dx, -dz), 14, dt);
        if (c.stateT >= c.restT) this.toState(c, 'seek');
        break;
      case 'seek': {
        if (c.clip) this.setClip(c, '');
        if (!T) {
          // no enemy near: formation round him (behind, to the sides), walking in when close
          const a = g.ctrl.yaw + [2.3, -2.3, 2.8, -2.8][c.slot % 4];
          const hx = me.x - Math.sin(a) * 2.2, hz = me.z - Math.cos(a) * 2.2;
          const hd = Math.hypot(hx - b.x, hz - b.z);
          const sp = hd < 0.4 ? 0 : Math.min(CL.speed, hd * 3.5);
          this.steer(c, hd > 0.01 ? (hx - b.x) / hd : 0, hd > 0.01 ? (hz - b.z) / hd : 0, sp, dt);
          if (sp > 0.5) c.yaw = turn(c.yaw, Math.atan2(-(hx - b.x), -(hz - b.z)), 12, dt);
          else c.yaw = turn(c.yaw, g.ctrl.yaw, 6, dt);
          break;
        }
        // run at it, coming in a little from the side (the clones spread round the target)
        const side = c.slot % 2 ? -1 : 1, k = 0.35 * clamp((d - 1.5) / 4, 0, 1);
        let ex = dx - dz * side * k, ez = dz + dx * side * k;
        const el = Math.hypot(ex, ez) || 1;
        ex /= el;
        ez /= el;
        c.yaw = turn(c.yaw, Math.atan2(-ex, -ez), 16, dt);
        const sp = b.ground ? CL.speed : Math.min(CL.speed, Math.max(3, (d - 0.6) * 4));
        this.steer(c, ex, ez, d < 1.2 ? Math.max(0, (d - 0.8) * 8) : sp, dt);
        // jumps: up to a target above, over something in the way; a flip for the second
        const wallAhead = b.ground && b.contacts > 0 && b.cnx * ex + b.cnz * ez < -0.5 && Math.hypot(b.vx, b.vz) < CL.speed * 0.5;
        if (b.ground && ((dy > 0.9 && d < 6) || wallAhead)) {
          this.cloneJump(c, Math.sqrt(2 * opts.gravity * (Math.max(dy, 1.2) + 0.5)));
          if (!wallAhead) {
            const hs = Math.min(CL.speed, Math.max(3, (d - 0.7) / ((b.vy / opts.gravity) * 1.3)));
            b.vx = ex * hs;
            b.vz = ez * hs;
          }
        } else if (!b.ground && c.jumps === 1 && b.vy < 1 && dy > 0.8 && d < 5) {
          this.cloneJump(c, 9);
          c.flipT = 0;
        }
        // the pack: at most CL.pack strike one target at once; the rest circle it, waiting their turn
        let busy = 0;
        for (const o of this.own.list) if (o !== c && !o.gone && o.state === 'attack' && o.tgt === c.tgt) busy++;
        if ((busy >= CL.pack || this.time < (this.gapUntil.get(c.tgt) || 0)) && d < CL.stalk + 1.2) {
          const ox = b.x - T.x, oz = b.z - T.z, ol = Math.hypot(ox, oz) || 1, sd = c.slot % 2 ? 1 : -1;
          // a point on the ring round it, sliding round a little (the stalk)
          const sx = T.x + (ox / ol) * CL.stalk - (oz / ol) * sd * 0.8, sz = T.z + (oz / ol) * CL.stalk + (ox / ol) * sd * 0.8;
          const sdd = Math.hypot(sx - b.x, sz - b.z);
          this.steer(c, sdd > 0.01 ? (sx - b.x) / sdd : 0, sdd > 0.01 ? (sz - b.z) / sdd : 0, Math.min(5, sdd * 5), dt);
          c.yaw = turn(c.yaw, Math.atan2(-dx, -dz), 14, dt);
          break;
        }
        if (d < 1.15 && Math.abs(dy) < 1.4) {
          this.toState(c, 'attack');
          this.startMove(c, C, CL);
        }
        break;
      }
      case 'attack': {
        const id = CL.string[c.move], M = C.moves[id];
        if (T) c.yaw = turn(c.yaw, Math.atan2(-dx, -dz), 24, dt);
        // a short step in with each strike, braking otherwise
        if (T && d > 0.78 && d < 2.6 && c.moveT < (M.startup + 2) * F) {
          const sp = Math.min(7, (d - 0.78) * 10);
          b.vx = dx * sp;
          b.vz = dz * sp;
        } else brake(14);
        if (!b.ground) {
          opts = c.hover ||= { ...g.ctrl.opts, gravity: g.ctrl.opts.gravity * 0.3, fallMul: 1 };
          if (b.vy > 0) b.vy *= Math.max(0, 1 - dt * 10);
        }
        c.moveT += dt;
        const f = c.moveT / F;
        if (f >= M.startup && !c.hitDone.has(c.move)) {
          c.hitDone.add(c.move);
          this.ownHit(c, id, T);
        }
        const last = c.move >= CL.string.length - 1;
        if (!last && f >= M.cancel + 2) {
          c.move++;
          this.startMove(c, C, CL);
          // (it got away between two strikes: chase it again, the string carries on where it was)
          if (T && (d > 2.4 || Math.abs(dy) > 1.8)) this.toState(c, 'seek');
        } else if (last && f >= M.startup + M.active + M.recovery * 0.6) {
          c.move = 0;
          c.hitDone.clear();
          this.gapUntil.set(c.tgt, this.time + CL.gap);
          this.toState(c, 'rest', CL.rest);
          this.setClip(c, '');
        }
        break;
      }
    }
    // clones don't stand inside each other, him, or their target
    for (const o of this.own.list) if (o !== c && !o.gone) this.separate(b, o.b.x, o.b.z, o.b.y, 0.62, dt);
    this.separate(b, me.x, me.z, me.y, 0.66, dt);
    if (T) this.separate(b, T.x, T.z, T.y, 0.68, dt);
    c.yawRate = wrap(c.yaw - yaw0) / dt;
    const was = b.ground;
    stepBody(g.world, b, opts, dt);
    c.stepUp += b.stepUp;
    if (c.flipT >= 0) c.flipT = c.flipT + dt > 0.5 ? -1 : c.flipT + dt;
    if (b.ground) {
      if (!was) {
        c.landT = 0;
        c.landV = b.landV;
        c.hardLand = b.landV > C.move.hardLand;
        c.jumps = 0;
        c.flipT = -1;
        g.fx.dust(b, 4, 0.8);
      } else c.landT += dt;
    } else {
      c.airT = was ? 0 : c.airT + dt;
      if (was && c.jumps === 0) c.jumps = 1;
    }
    // out of the world (fell off the map): gone
    if (b.y < -20) this.goneOwn(c, 'fell', true);
  }

  toState(c, s, restT = 0) {
    c.state = s;
    c.stateT = 0;
    c.restT = restT;
  }

  startMove(c, C, CL) {
    const M = C.moves[CL.string[c.move]];
    c.moveT = 0;
    this.setClip(c, M.anim);
  }

  steer(c, dx, dz, sp, dt) {
    const b = c.b;
    const wx = dx * sp - b.vx, wz = dz * sp - b.vz, wl = Math.hypot(wx, wz), a = (b.ground ? 110 : 40) * dt;
    if (wl > a) {
      b.vx += (wx / wl) * a;
      b.vz += (wz / wl) * a;
    } else {
      b.vx += wx;
      b.vz += wz;
    }
  }

  separate(b, x, z, y, min, dt) {
    if (Math.abs(b.y - y) > 1.5) return;
    const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
    if (d >= min || d < 1e-4) return;
    const pen = min - d, push = Math.min(pen, 6 * dt + Math.max(0, pen - 0.25));
    b.x += (dx / d) * push;
    b.z += (dz / d) * push;
  }

  cloneJump(c, vy) {
    const b = c.b;
    b.vy = clamp(vy, 7, 16);
    b.ground = false;
    c.jumps++;
    c.airT = 0;
    if (c.jumps === 1) this.game.fx.dust(b, 5, 1);
  }

  /** A clone's strike lands (its move's contact frame): the nearest enemy in reach, its own target first. */
  ownHit(c, id, T) {
    const g = this.game, b = c.b, now = g.net.serverNow();
    let pick = null;
    for (const t of g.combat.targets()) {
      if (t.clone || Math.hypot(t.x - b.x, t.z - b.z) > 1.9 || Math.abs(t.y - b.y) > 1.5) continue;
      if (!t.dummy && (t.entry.react?.invuln?.(now) || (t.entry.view?.flags ?? 0) & FLAG.invuln)) continue;
      if (!pick || t.id === T?.id) pick = t;
    }
    if (!pick) return;
    g.combat.landHit({ id: `shadowClones:${id}`, inst: this.own.inst, k: c.slot * 1000 + ++c.hitK, cs: c.slot, from: { x: b.x, y: b.y, z: b.z, yaw: c.yaw } }, pick, _v.set(pick.x, pick.y + 1.1, pick.z).clone());
  }

  // ---------------------------------------------------------------- Q: everyone else's (drawn from the stream)

  /** A remote caster's clones appear (n:1, c: spots): each pops at its own frame after the first. */
  remoteSpawn(m) {
    const C = this.J.ownerC(m.id), D = C.jutsu.shadowClones;
    const ch = this.game.remotes.get(m.id)?.info.ch;
    for (const [key, rc] of this.remote) if (rc.owner === m.id) this.remoteGone(key, rc, false);
    for (const s of m.c || []) {
      const k = s[0], key = `${m.id}:${k}`;
      const rc = {
        owner: m.id, slot: k, inst: m.i, ch: ch || C.id, e: null, f: null, motion: new RemoteMotion(this.game.world), view: {}, samples: [],
        hp: D.clone.hp, max: D.clone.hp, popAt: m.at + ((D.pop[k] ?? D.pop[0]) - D.pop[0]) * F * 1000, shown: false, gone: false,
        lose: () => this.remoteGone(key, rc, true),
      };
      rc.e = this.bodies.take(rc.ch, rc);
      if (!rc.e) continue;
      rc.f = rc.e.f;
      rc.f.root.visible = rc.f.visible = false;
      rc.motion.push(m.at - 1, [s[1], s[2], s[3], 0, 0, 0, s[4], ST.loco, 0, 0]);
      rc.f.snap(s[1], s[2], s[3], s[4]);
      rc.entry = { view: rc.view, react: null, info: { id: m.id, ch: rc.ch, hp: rc.hp }, fighter: rc.f, clone: true };
      this.remote.set(key, rc);
    }
  }

  onCloneStates(m) {
    for (const row of m.c || []) {
      const rc = this.remote.get(`${m.id}:${row[0]}`);
      if (!rc || rc.gone || rc.inst !== m.i) continue;
      rc.motion.push(m.at, row.slice(1, 11));
      const [clip, n] = String(row[11] || '').split('#');
      rc.samples.push({ t: m.at, clip, n: n | 0, ms: row[12] });
      if (rc.samples.length > 40) rc.samples.shift();
    }
  }

  remoteGone(key, rc, puff = true) {
    if (rc.gone) return;
    rc.gone = true;
    if (puff && rc.shown && rc.f) this.poof({ x: rc.f.pos.x, y: rc.f.pos.y, z: rc.f.pos.z }, 0.95);
    this.bodies.give(rc.e);
    this.remote.delete(key);
  }

  updateRemote(dt) {
    const g = this.game, rt = g.net.renderTime(), now = g.net.serverNow();
    for (const [key, rc] of this.remote) {
      if (!rc.shown) {
        if (now < rc.popAt) continue;
        rc.shown = true;
        rc.f.root.visible = rc.f.visible = true;
        const s = rc.motion.buf[0]?.s;
        if (s) this.poof({ x: s[0], y: s[1], z: s[2] }, 0.72, !rc.slot);
      }
      const v = rc.motion.view(rt, dt, rc.view);
      if (!v) continue;
      // the clip on its caster's screen at the render time: the newest sample at or before it
      let S = null;
      for (let i = rc.samples.length - 1; i >= 0; i--) {
        if (rc.samples[i].t <= rt) {
          S = rc.samples[i];
          break;
        }
      }
      v.act = S && S.clip ? { clip: S.clip, t: (S.ms + (rt - S.t)) / 1000, key: `rc${rc.slot}${S.n}`, dur: S.clip.startsWith('hit_') ? 0.35 : 0 } : null;
      v.combat = true;
      v.flags = 0;
      rc.f.update(dt, v);
      // (its caster went away without a word: the clone goes too)
      if (!g.remotes.has(rc.owner)) this.remoteGone(key, rc, true);
    }
  }

  /** Hittable shadow clones of others (Combat.targets): the owner's id plus the clone's slot (vc). */
  cloneTargets(out) {
    for (const rc of this.remote.values()) {
      if (!rc.shown || rc.gone || !rc.f?.hurt) continue;
      rc.entry.info.hp = rc.hp;
      out.push({ id: rc.owner, vc: rc.slot, key: `${rc.owner}c${rc.slot}`, clone: rc, x: rc.f.pos.x, y: rc.f.pos.y, z: rc.f.pos.z, hurt: rc.f.hurt, entry: rc.entry });
    }
  }

  /** Remote shadow clones push fighters apart like fighters do (main.js `others`). */
  pushers(out) {
    for (const rc of this.remote.values()) if (rc.shown && !rc.gone) out.push({ x: rc.f.pos.x, y: rc.f.pos.y, z: rc.f.pos.z, r: 0.34 });
  }

  /** A hit on a shadow clone ('ch', every screen): HP, the flinch (its caster's clone reels), a burst for bystanders. */
  onCloneHit(m) {
    const g = this.game;
    if (m.o === g.net.id) {
      const c = this.own?.list.find((x) => x.slot === m.s && !x.gone);
      if (!c) return;
      c.hp = m.hp;
      c.f.flash();
      this.toState(c, 'hit');
      c.move = 0;
      c.hitDone.clear();
      this.setClip(c, Math.random() < 0.5 ? 'hit_body' : 'hit_head', g.ctrl.C.jutsu.shadowClones.clone.stun);
      c.clipT = 3 * F; // (from the reaction's impact frame, like a fighter's)
      c.b.vx = m.kb[0];
      c.b.vz = m.kb[1];
      if (m.a !== g.net.id) g.combat.feedback(c.f.hurt?.center || c.f.pos, { react: 1 }, { hitstop: m.hs }, false);
      return;
    }
    const rc = this.remote.get(`${m.o}:${m.s}`);
    if (!rc) return;
    rc.hp = m.hp;
    rc.f?.flash();
    if (m.a !== g.net.id && rc.f) g.combat.feedback(rc.f.hurt?.center || rc.f.pos, { react: 1 }, { hitstop: m.hs }, false);
  }

  /** A shadow clone gone (n:2 from the server or its caster): its burst of smoke on every screen. */
  onCloneGone(m) {
    const g = this.game;
    if (m.id === g.net.id) {
      const c = this.own?.list.find((x) => x.slot === m.s && !x.gone);
      if (c) this.goneOwn(c, m.why || 'server', false);
      return;
    }
    const key = `${m.id}:${m.s}`, rc = this.remote.get(key);
    if (rc) this.remoteGone(key, rc, true);
  }

  // ---------------------------------------------------------------- E: Rasengan

  /**
   * The Rasengan's target while charging: the lock-on target; else the enemy nearest the camera's line within the
   * aim cone and range (no clones: aimed jutsu go for fighters).
   */
  rasenganTarget(ctrl, D) {
    const g = this.game, b = ctrl.body;
    const L = ctrl.lockTarget;
    if (L && !L.dead && Math.hypot(L.x - b.x, L.z - b.z) < D.aim.range + 1) return this.liveTarget(L) || L;
    const cy = g.cam.yaw, fx = -Math.sin(cy), fz = -Math.cos(cy), cos = Math.cos((D.aim.cone * Math.PI) / 180);
    let best = null, bs = Infinity;
    for (const t of g.combat.targets()) {
      if (t.clone) continue;
      const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
      if (d > D.aim.range || d < 0.1 || Math.abs(t.y - b.y) > 3) continue;
      const c = (dx * fx + dz * fz) / d;
      if (c < cos) continue;
      const s = (1 - c) * 30 + d * 0.1;
      if (s < bs) {
        bs = s;
        best = t;
      }
    }
    return best;
  }

  /** The dash homes on T only while T is within `dash.cone` degrees of his facing and `dash.range` m (the limit). */
  dashTracks(ctrl, T, D) {
    const b = ctrl.body, dx = T.x - b.x, dz = T.z - b.z, d = Math.hypot(dx, dz);
    if (d > D.dash.range || Math.abs(T.y - b.y) > 4) return false;
    if (d < 0.1) return true;
    return (dx * -Math.sin(ctrl.yaw) + dz * -Math.cos(ctrl.yaw)) / d >= Math.cos((D.dash.cone * Math.PI) / 180);
  }

  /** A target for a dash released with nothing aimed at: the fighter nearest his facing inside the tracking limit. */
  dashTarget(ctrl, D) {
    const b = ctrl.body, fx = -Math.sin(ctrl.yaw), fz = -Math.cos(ctrl.yaw);
    let best = null, bs = Infinity;
    for (const t of this.game.combat.targets()) {
      if (t.clone || !this.dashTracks(ctrl, t, D)) continue;
      const d = Math.hypot(t.x - b.x, t.z - b.z), c = d < 0.1 ? 1 : ((t.x - b.x) * fx + (t.z - b.z) * fz) / d;
      const s = (1 - c) * 30 + d * 0.1;
      if (s < bs) {
        bs = s;
        best = t;
      }
    }
    return best;
  }

  /** The dash's contact: the sphere before his chest swept since the last frame against every drawn hurtbox. */
  detectRasengan(a) {
    const g = this.game, ctrl = g.ctrl, b = ctrl.body;
    if (a.phase !== 'dash' || a.stop > 0) {
      a.prevC = null;
      return;
    }
    const box = a.big ? a.D.big.box : a.D.hit.box, L = box.local;
    const fx = -Math.sin(ctrl.yaw), fz = -Math.cos(ctrl.yaw);
    _c1.set(b.x + fx * L[2] - fz * L[0], b.y + L[1], b.z + fz * L[2] + fx * L[0]);
    const prev = a.prevC || _c1.clone();
    const now = g.net.serverNow();
    for (const t of g.combat.targets()) {
      if (!t.hurt?.valid) continue;
      if (!t.dummy && (t.entry.react?.invuln?.(now) || (t.entry.view?.flags ?? 0) & FLAG.invuln)) continue;
      let hit = null;
      for (const c of t.hurt.caps) {
        if (segSeg(prev, _c1, c.a, c.b, _w, _c2) <= (box.r + c.r) ** 2) {
          hit = _c2.clone();
          break;
        }
      }
      if (!hit) continue;
      // no hits through walls
      if (!g.world.clear(b.x, b.y + 1.1, b.z, hit.x, hit.y, hit.z)) continue;
      let hs = a.D.hit.hitstop;
      g.combat.landHit({ id: a.big ? 'rasengan:big' : 'rasengan', inst: a.inst, k: 0, onHit: (h) => (hs = h) }, t, hit.lerp(_c1, 0.5));
      a.end(ctrl, true, hs);
      a.prevC = null;
      return;
    }
    a.prevC = (a.prevC || new THREE.Vector3()).copy(_c1);
  }

  /** The blast (Combat.feedback, spec.fx): on the attacker's prediction, on bystanders' screens, on the victim's own. */
  blast(p, kb, big) {
    const g = this.game, fx = g.fx, q = this.quality();
    const dir = _w.set(kb?.[0] || 0, (kb?.[1] || 0) * 0.3, kb?.[2] || 0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    this.blasts.fire(p, dir, big);
    const s = big ? 1.35 : 1;
    fx.impact(p, 4, [1.2, 2.6, 4.2]);
    fx.emit(5, p.x, p.y, p.z, 0, 0, 0, 0.1, 0.3 * s, 1.3 * s, 1.0, 1.7, 2.6);
    // wind streaks driven through along the push, and flung out round it
    for (let k = 0; k < Math.round(30 * q * s); k++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, sq = Math.sqrt(1 - u * u);
      const along = 0.6 + Math.random() * 0.6, sp = 14 + Math.random() * 12;
      const vx = dir.x * along + Math.cos(a) * sq * 0.8, vy = dir.y * along + u * 0.6, vz = dir.z * along + Math.sin(a) * sq * 0.8;
      fx.emit(2, p.x, p.y, p.z, vx * sp, vy * sp + 1, vz * sp, 0.16 + Math.random() * 0.12, 0.07, 0.03, PALE[0], PALE[1], PALE[2]);
    }
    // pale blue cloud balls torn off along the push (fx kind 7; grey flat puffs here read as flying rocks)
    for (let k = 0; k < Math.round(4 * q * s); k++) {
      const sp = 5 + k * 1.6, o = (Math.random() - 0.5) * 0.7;
      fx.emit(7, p.x + o * dir.z, p.y + (Math.random() - 0.5) * 0.4, p.z - o * dir.x, dir.x * sp, 0.3 + Math.random() * 0.6, dir.z * sp, 0.3 + Math.random() * 0.12, 0.12, 0.36 * s, 0.62, 0.74, 0.88);
    }
    const gy = g.world.ground(p.x, p.z, p.y + 0.3, _g).y;
    if (p.y - gy < 2.2) {
      fx.ripple({ x: p.x, y: gy, z: p.z }, 2.4 * s);
      fx.dust({ x: p.x, y: gy, z: p.z }, 8, 1.6 * s, [0.8, 0.78, 0.74]);
    }
    g.audio?.rasenganBlast?.(p, big);
    // the camera up close: a hard shake
    const near = g.player ? clamp(1 - g.player.pos.distanceTo(p) / 22, 0, 1) : 0;
    if (near > 0) g.cam.addTrauma((big ? 0.62 : 0.5) * near);
    // the victim (the fighter at the blast) trails a spiral wake while it flies
    let best = null, bd = 1.6;
    const each = (f) => {
      if (!f) return;
      const d = Math.hypot(f.pos.x - p.x, f.pos.y + 1 - p.y, f.pos.z - p.z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    };
    each(g.player);
    for (const r of g.remotes.values()) each(r.fighter);
    if (best) this.wakes.push({ f: best, t: 0, big });
  }

  updateWakes(dt) {
    const fx = this.game.fx, q = this.quality();
    for (const w of this.wakes) {
      w.t += dt;
      const p = w.f.pos;
      for (let n = Math.round(dt * 90 * q); n > 0; n--) {
        const a = w.t * 30 + Math.random() * 6.283, r = 0.35 + Math.random() * 0.2;
        fx.emit(2, p.x + Math.cos(a) * r, p.y + 0.9 + Math.sin(a) * r, p.z + Math.sin(a) * r * 0.5, -Math.sin(a) * 5, Math.cos(a) * 5, Math.cos(a) * 3, 0.14, 0.05, 0.02, BLUE[0], BLUE[1], BLUE[2]);
      }
    }
    this.wakes = this.wakes.filter((w) => w.t < (w.big ? 0.6 : 0.45));
  }

  // ---------------------------------------------------------------- X: Shadow Clone Rush (every screen)

  /** The Rush's target: the lock-on target, else the enemy nearest the camera's line (Combat.aimTarget), in range. */
  rushTarget(ctrl) {
    const t = this.game.combat.aimTarget(ctrl, ctrl.C.jutsu.clones.range);
    return t && !t.clone ? t : null;
  }

  /** A Rush (at: its press on the server clock, o: the caster's feet and facing then [x, y, z, yaw]). */
  rushStart(owner, inst, at, tg, o, C, mine) {
    const D = C.jutsu.clones;
    const clones = D.strikes.map((S, k) => ({ S, k, e: null, f: null, done: false, sent: false, ghostT: 0, view: {}, x: 0, y: 0, z: 0, yaw: 0, sp: 0, ph: 'wait', simT: 0, st: 0, yawRate: 0 }));
    const R = { owner, inst, at, tg, o, C, D, mine, clones, launchT: 0, broken: false, over: false, last: null, ch: C.id, action: null };
    this.rushes.push(R);
    return R;
  }

  rushEnd(R, puff) {
    for (const c of R.clones) {
      if (c.e && !c.done) {
        if (puff) this.poof({ x: c.f.pos.x, y: c.f.pos.y, z: c.f.pos.z }, 0.8, false, true);
        this.bodies.give(c.e);
      }
      c.done = true;
    }
    R.over = true;
    // (a remote caster's seal: let go soon after, unless the finisher's attack takes over)
    if (!R.mine && !R.launchT) {
      const r = this.game.remotes.get(R.owner), t = (this.game.net.serverNow() - R.at) / 1000;
      if (r?.act?.key === `nrr${R.inst}`) r.act.dur = Math.min(r.act.dur, t + 0.25);
    }
  }

  /** Has the caster been hit since the press (his seal broken: the clones burst)? */
  rushStruck(R) {
    const g = this.game;
    if (R.mine) return !R.launchT && g.ctrl.action !== R.action;
    const r = g.remotes.get(R.owner);
    return !!(r?.react && r.react.t0 >= R.at && !R.launchT);
  }

  updateRushes(dt) {
    const g = this.game, now = g.net.serverNow();
    for (const R of this.rushes) {
      if (R.over) continue;
      const t = (now - R.at) / 1000, D = R.D;
      if (t < D.appear) continue;
      const T = this.feet(R.tg, _p);
      // gone, it got away in one frame (a substitution), or he was hit in the seal: the clones burst
      if (!T || (R.last && Math.hypot(T.x - R.last.x, T.z - R.last.z) > 3) || this.rushStruck(R)) {
        R.broken = true;
        this.rushEnd(R, true);
        continue;
      }
      R.last = (R.last || new THREE.Vector3()).copy(T);
      const gyT = g.world.ground(T.x, T.z, T.y + 0.5, _g).y, airborne = T.y - gyT > 0.5;
      let live = 0;
      for (const c of R.clones) {
        if (c.done) continue;
        live++;
        if (!c.e && !this.rushAppear(R, c, T)) continue;
        // the clone's own sim in fixed steps up to now (a screen that heard of the press late catches up)
        const yaw0 = c.yaw;
        while (!c.done && c.simT + F <= t) this.rushStep(R, c, T, c.simT + F, airborne);
        if (c.done) continue;
        c.yawRate = dt > 0 ? wrap(c.yaw - yaw0) / dt : 0;
        this.rushDraw(R, c, t, dt);
      }
      if (!live || t > D.life) this.rushEnd(R, false);
    }
    this.rushes = this.rushes.filter((R) => !R.over);
  }

  /** Clone c bursts out of the smoke beside the caster (`from`: [left, forward] in his frame at the press). */
  rushAppear(R, c, T) {
    const g = this.game, S = c.S, D = R.D, o = R.o;
    c.e = this.bodies.take(R.ch, { lose: () => ((c.done = true), (c.e = null)) });
    if (!c.e) {
      c.done = true;
      return false;
    }
    c.f = c.e.f;
    const ly = o[3], lx = -Math.cos(ly), lz = Math.sin(ly), fx = -Math.sin(ly), fz = -Math.cos(ly);
    const pos = _g2;
    pos.x = o[0] + lx * S.from[0] + fx * S.from[1];
    pos.z = o[2] + lz * S.from[0] + fz * S.from[1];
    g.world.pushOut(pos, 0.3, o[1], o[1] + 1.6, 0.45, null);
    const gy = g.world.ground(pos.x, pos.z, o[1] + 1.2, _g).y;
    c.x = pos.x;
    c.z = pos.z;
    c.y = Math.abs(gy - o[1]) < 1.5 ? gy : o[1];
    // facing out along its first heading: the flankers `fan` degrees off the line to the target (a pincer)
    c.yaw = Math.atan2(-(T.x - c.x), -(T.z - c.z)) + (S.side * D.fan * Math.PI) / 180;
    c.ph = 'ready';
    c.simT = D.appear;
    c.f.snap(c.x, c.y, c.z, c.yaw);
    this.poof({ x: c.x, y: c.y, z: c.z }, 0.72, c.k === 0, true);
    this.ghosts.spawn(this.modelOf(R.ch), c.f, WARM, 0.16, 0.3);
    return true;
  }

  /** One fixed step of a Rush clone to timeline time t: crouched, charging (homing, turn-limited), striking. */
  rushStep(R, c, T, t, airborne) {
    const g = this.game, S = c.S, D = R.D;
    c.simT = t;
    const dx = T.x - c.x, dz = T.z - c.z, d = Math.hypot(dx, dz), dy = T.y - c.y;
    if (c.ph === 'ready') {
      if (t < S.go) return;
      c.ph = 'run';
      c.sp = D.speed0;
      g.fx.dust({ x: c.x, y: c.y, z: c.z }, 4, 1.1);
    }
    if (c.ph === 'run') {
      if (d <= D.reach && Math.abs(dy) < 2.2) {
        c.ph = 'strike';
        c.st = t;
      } else if (t - S.go > D.chase || (t - S.go > 0.15 && d > 0.3 && (dx * -Math.sin(c.yaw) + dz * -Math.cos(c.yaw)) / d < -0.2)) {
        // it never got there, or ran past it (a dash sideways): gone in smoke
        this.poof({ x: c.x, y: c.y, z: c.z }, 0.7, false, true);
        this.bodies.give(c.e);
        c.done = true;
        return;
      } else {
        c.yaw = turn(c.yaw, Math.atan2(-dx, -dz), D.turn, F);
        c.sp = Math.min(D.speed, c.sp + D.accel * F);
        // (slowing into the strike: no overshoot past the target)
        const sp = Math.min(c.sp, Math.max(4, (d - D.reach * 0.8) * 18));
        const pos = _g2;
        pos.x = c.x - Math.sin(c.yaw) * sp * F;
        pos.z = c.z - Math.cos(c.yaw) * sp * F;
        g.world.pushOut(pos, 0.3, c.y, c.y + 1.6, 0.45, null);
        const gy = g.world.ground(pos.x, pos.z, c.y + 1.0, _g).y;
        c.x = pos.x;
        c.z = pos.z;
        if (Math.abs(gy - c.y) < 1.2) c.y = gy;
        return;
      }
    }
    // the strike: faces the target, a last step in to its reach, lifted to an airborne one by the contact
    const f = (t - c.st) / F;
    c.yaw = turn(c.yaw, Math.atan2(-dx, -dz), 20, F);
    if (f <= D.contact && d > 0.78) {
      const step = Math.min(d - 0.78, 10 * F);
      c.x += (dx / d) * step;
      c.z += (dz / d) * step;
    }
    const gy = g.world.ground(c.x, c.z, c.y + 1.0, _g).y;
    if (airborne) c.y = gy + (T.y - gy) * ss(0, D.contact, f);
    else if (Math.abs(gy - c.y) < 1.2) c.y = gy;
    if (R.mine && !c.sent && f >= D.contact) {
      c.sent = true;
      this.rushHit(R, c, S, t);
    }
    if (f >= D.contact + D.gone * 60) {
      this.poof({ x: c.x, y: c.y, z: c.z }, 0.7, false, true);
      this.bodies.give(c.e);
      c.done = true;
    }
  }

  /** A Rush clone as drawn this frame: crouched ready, the ninja sprint (the gait), its strike clip; afterimages on the charge. */
  rushDraw(R, c, t, dt) {
    const v = c.view, run = c.ph === 'run';
    Object.assign(v, {
      x: c.x, y: c.y, z: c.z, yaw: c.yaw, vf: run ? c.sp : 0, vl: 0, vy: 0, speed: run ? c.sp : 0, yawRate: run ? c.yawRate : 0, st: ST.loco, stT: t,
      sprint: run && c.sp > 9, skid: 0, ground: true, flipT: -1, landT: 9, landV: 0, hardLand: false, wall: null, stepUp: 0, combat: !run,
    });
    if (c.ph === 'ready') v.act = { clip: 'cr_ready', t: t - R.D.appear, key: `cr${R.inst}${c.k}r` };
    else if (c.ph === 'strike') v.act = { clip: c.S.clip, t: t - c.st, key: `cr${R.inst}${c.k}${c.S.clip}` };
    else v.act = null;
    c.f.update(dt, v);
    if (run && c.sp > 11) {
      c.ghostT -= dt;
      if (c.ghostT <= 0) {
        c.ghostT = 0.07;
        this.ghosts.spawn(this.modelOf(R.ch), c.f, WARM, 0.14, 0.18);
      }
      if (Math.random() < dt * 14) this.game.fx.dust({ x: c.x, y: c.y, z: c.z }, 1, 0.6);
    }
  }

  rushHit(R, c, S, t) {
    const g = this.game, now = g.net.serverNow(), D = R.D;
    const tg = g.combat.targets().find((x) => x.id === R.tg && !x.clone);
    if (!tg) return;
    // (a dodge on our screen: the strike goes through smoke)
    if (!tg.dummy && (tg.entry.react?.invuln?.(now) || (tg.entry.view?.flags ?? 0) & FLAG.invuln)) return;
    if (Math.hypot(tg.x - c.x, tg.z - c.z) > D.strikeReach || Math.abs(tg.y - c.y) > 2) return;
    const launch = S.part === 'launch';
    g.combat.landHit({ id: `clones:${S.part}`, inst: R.inst, k: c.k, from: { x: c.x, y: c.y, z: c.z, yaw: c.yaw }, onHit: launch ? () => (R.launchT = t) : null }, tg, _v.set(tg.x, tg.y + (launch ? 0.8 : 1.1), tg.z).clone());
  }

  /** Madara's barrier answered a clone of `owner`'s near o (his n:1 with cl): the Rush's nearest clone is dispelled. */
  dispel(owner, o) {
    let best = null, bd = 3;
    for (const R of this.rushes) {
      if (R.owner !== owner) continue;
      for (const c of R.clones) {
        if (c.done || !c.f) continue;
        const d = Math.hypot(c.f.pos.x - o[0], c.f.pos.z - o[2]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    }
    if (!best) return;
    this.poof({ x: best.f.pos.x, y: best.f.pos.y, z: best.f.pos.z }, 0.9);
    this.bodies.give(best.e);
    best.done = true;
  }

  // ---------------------------------------------------------------- G: Shadow Clone Substitution (every screen)

  /** The clone in his place (appears at `vanish`, where he is drawn then); he is hidden until he re-forms. */
  decoyStart(owner, inst, at, C, mine) {
    const D = C.jutsu.cloneDefense;
    const d = { owner, inst, at, C, D, mine, e: null, f: null, shown: false, hideOwner: false, back: false, struckAt: 0, over: false, view: {}, ch: C.id };
    this.decoys = this.decoys.filter((x) => {
      if (x.owner !== owner) return true;
      this.decoyEnd(x, false);
      return false;
    });
    this.decoys.push(d);
    return d;
  }

  decoyEnd(d, puff) {
    if (d.e) {
      if (puff) this.poof({ x: d.f.pos.x, y: d.f.pos.y, z: d.f.pos.z }, 1);
      this.bodies.give(d.e);
      d.e = null;
    }
    d.over = true;
    d.hideOwner = false;
  }

  /** Is `e` (a target entry: a remote fighter) inside its substitution's window at `at`? (Combat.landHit: no prediction.) */
  decoying(id, at) {
    for (const d of this.decoys) if (d.owner === id && !d.over && at >= d.at && at <= d.at + d.D.window * F * 1000) return d;
    return null;
  }

  /** The clone in his place takes a hit (a predicted catch on the attacker's screen, the server's n:2 everywhere). */
  decoyStruck(d, p = null) {
    if (!d || d.struckAt) return;
    d.struckAt = this.game.net.serverNow();
    const f = d.f || this.fighterOf(d.owner);
    const q = p || (f ? _v.set(f.pos.x, f.pos.y + 1.1, f.pos.z) : null);
    if (q) this.game.fx.impact(q, 2);
    d.f?.flash();
  }

  updateDecoys(dt) {
    const g = this.game, now = g.net.serverNow();
    for (const d of this.decoys) {
      if (d.over) continue;
      const t = (now - d.at) / 1000, D = d.D;
      const owner = this.fighterOf(d.owner);
      if (!d.shown && t >= D.vanish * F) {
        d.shown = true;
        d.hideOwner = true;
        const src = owner || null;
        if (src) {
          d.e = this.bodies.take(d.ch, { lose: () => ((d.e = null), (d.f = null)) });
          if (d.e) {
            d.f = d.e.f;
            d.f.snap(src.pos.x, src.pos.y, src.pos.z, src.yaw);
            d.pos = [src.pos.x, src.pos.y, src.pos.z, src.yaw];
          }
          this.poof({ x: src.pos.x, y: src.pos.y, z: src.pos.z }, 1.05);
        }
      }
      // (he never came back on this screen: show him after a while where he is)
      if (d.hideOwner && t > (D.reform + 40) * F) d.hideOwner = false;
      if (d.f && d.pos) {
        const v = d.view;
        Object.assign(v, { x: d.pos[0], y: d.pos[1], z: d.pos[2], yaw: d.pos[3], vf: 0, vl: 0, vy: 0, speed: 0, yawRate: 0, st: ST.loco, stT: t, sprint: false, skid: 0, ground: true, flipT: -1, landT: 9, landV: 0, hardLand: false, wall: null, stepUp: 0, combat: true });
        const st = d.struckAt ? (now - d.struckAt) / 1000 : -1;
        v.act = st >= 0 ? { clip: 'hit_body', t: st + 3 * F, dur: 0.3, key: `cdh${d.inst}` } : { clip: 'cd_decoy', t, key: `cdd${d.inst}` };
        d.f.update(dt, v);
        // struck: it reels a moment and bursts; else it stands its time and bursts
        if ((st >= 0.14) || t >= D.decoy) {
          this.poof({ x: d.pos[0], y: d.pos[1], z: d.pos[2] }, 1);
          this.bodies.give(d.e);
          d.e = null;
          d.f = null;
        }
      }
      if (!d.e && d.shown && !d.hideOwner) d.over = true;
      if (t > 3) this.decoyEnd(d, false);
    }
    this.decoys = this.decoys.filter((d) => !d.over);
  }

  /** Our own re-forming at `reform` (nothing caught yet): a spot `dist` m the way we steer, else away from enemies. */
  reformOwn(ctrl, a, input) {
    const g = this.game, b = ctrl.body, D = a.D;
    const spot = this.evadeSpot(ctrl, D, input);
    g.net.act('jutsu', { m: 'cloneDefense', i: a.inst, n: 1, o: spot.map(r3), at: Math.round(g.net.serverNow()) });
    // face the nearest enemy from there
    let yaw = ctrl.yaw, best = 1e9;
    for (const t of g.combat.targets()) {
      if (t.clone || t.dummy) continue;
      const d = Math.hypot(t.x - spot[0], t.z - spot[2]);
      if (d < best) {
        best = d;
        yaw = Math.atan2(-(t.x - spot[0]), -(t.z - spot[2]));
      }
    }
    this.moveSelf(ctrl, a, spot, yaw);
  }

  /** Where he re-forms uncaught: `dist` m along the stick (camera-relative), else away from the nearest enemy, else back. */
  evadeSpot(ctrl, D, input) {
    const g = this.game, b = ctrl.body;
    let dx = ctrl.wish > 0.3 ? ctrl.wishX : 0, dz = ctrl.wish > 0.3 ? ctrl.wishZ : 0;
    if (!dx && !dz) {
      let best = null, bd = 14;
      for (const t of g.combat.targets()) {
        if (t.clone || t.dummy) continue;
        const d = Math.hypot(t.x - b.x, t.z - b.z);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      if (best && bd > 0.1) {
        dx = (b.x - best.x) / bd;
        dz = (b.z - best.z) / bd;
      } else {
        dx = Math.sin(ctrl.yaw);
        dz = Math.cos(ctrl.yaw);
      }
    }
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // the farthest free spot along that line (a wall in the way: shorter), on the ground there
    for (const k of [1, 0.75, 0.5, 0.3]) {
      const dist = D.dist * k;
      const hit = g.world.raycast(b.x, b.y + 1.0, b.z, dx, 0, dz, dist + 0.5);
      if (hit < dist + 0.5) continue;
      const x = b.x + dx * dist, z = b.z + dz * dist;
      const y = g.world.ground(x, z, b.y + 2, _g).y;
      if (Math.abs(y - b.y) > 3 || g.world.solidAt(x, z, y + 0.15, y + 1.6, 0.05)) continue;
      return [x, y, z];
    }
    return [b.x, b.y, b.z];
  }

  /** Our body to a spot (re-forming): out of the smoke there, shown, the action's appear pose. */
  moveSelf(ctrl, a, spot, yaw) {
    const g = this.game, b = ctrl.body;
    ctrl.prevX = b.x = spot[0];
    ctrl.prevY = b.y = spot[1];
    ctrl.prevZ = b.z = spot[2];
    b.vx = b.vy = b.vz = 0;
    b.ground = true;
    ctrl.prevYaw = ctrl.yaw = ctrl.moveYaw = yaw;
    ctrl.wall = null;
    ctrl.vault = null;
    g.visOff = [0, 0, 0];
    g.player.snap(spot[0], spot[1], spot[2], yaw);
    this.poof({ x: spot[0], y: spot[1], z: spot[2] }, 1);
    if (a) {
      a.back = true;
      a.reT = a.t;
      a.physicsOpts = null;
    }
    const d = this.decoys.find((x) => x.owner === g.net.id && !x.over);
    if (d) d.hideOwner = false;
  }

  // ---------------------------------------------------------------- per fighter (every Naruto-kit fighter, every frame)

  /**
   * From the clip each Naruto-kit fighter is drawn in (v.act: the same on every screen): the Rasengan in the palm (and
   * the clone shaping it), its dash's afterimages and wind, the seals' smoke, the finisher's vanishing, the
   * substitution's hidden body.
   */
  updateFighter(f, C, local, dt, sphere, big) {
    const g = this.game, q = this.quality();
    if (!f || !C?.jutsu.cloneDefense) return;
    const act = !f.dead ? f.view?.act : null, on = !!act && KIT_CLIPS.has(act.clip);
    const fr = on ? act.t * 60 : -1, clip = on ? act.clip : '';
    let S = this.per.get(f);
    if (!S) this.per.set(f, (S = { key: null, last: -1, ghostT: 0 }));
    if (on && act.key !== S.key) {
      S.key = act.key;
      S.last = -1;
    }
    const hit = (x) => on && S.last < x && fr >= x;
    // the Rasengan: its size from our action (local) or the clip's time (remotes)
    let size = sphere;
    if (!local) {
      const D = C.jutsu.rasengan;
      if (clip === 'ras_charge') size = chargeSize(D, act.t);
      else if (clip === 'ras_dash') size = big ? 1.45 : 1;
      else if (clip === 'ras_hit') size = (big ? 1.45 : 1) * (1 - ss(D.impact, D.impact + 5, fr));
      else if (clip === 'ras_whiff') size = (big ? 1.45 : 1) * (1 - ss(0, 12, fr));
      else size = 0;
    }
    const e = this.J.fxFor(f), hand = bonePos(f, 'rightHand', _c1);
    // (the sphere sits over the palm)
    const sp = _c2.copy(hand).add(_w.set(0, 0.06 + 0.05 * Math.max(0, size - 1), 0));
    // (RasenganFX at 1 is a 0.3 m shell: about a head across at 0.55; the Big Rasengan 1.45 times that)
    e.ras?.update(dt, size > 0.01 ? sp : f.pos, size * 0.55);
    if (size > 0.01 && f.root.visible) {
      if (clip === 'ras_charge') {
        // chakra drawn in, spiralling into the palm; wind puffs; the big one crackles
        for (let n = Math.round(dt * 55 * q); n > 0; n--) {
          const a = Math.random() * 6.283, u = Math.random() * 2 - 1, r = 0.55 + Math.random() * 0.35, sq = Math.sqrt(1 - u * u);
          const ox = Math.cos(a) * sq * r, oy = u * r * 0.7, oz = Math.sin(a) * sq * r;
          g.fx.emit(2, sp.x + ox, sp.y + oy, sp.z + oz, -ox * 5 - oz * 3, -oy * 5, -oz * 5 + ox * 3, 0.14, 0.035, 0.015, BLUE[0], BLUE[1], BLUE[2]);
        }
        if (Math.random() < dt * 5 * q) g.fx.emit(0, sp.x, sp.y, sp.z, (Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2, 0.4, 0.12, 0.5, 0.82, 0.92, 1.0, 0.6);
        if (size > 1.3 && Math.random() < dt * 9) g.fx.emit(5, sp.x + (Math.random() - 0.5) * 0.3, sp.y + (Math.random() - 0.5) * 0.3, sp.z + (Math.random() - 0.5) * 0.3, 0, 0, 0, 0.06, 0.05, 0.2, 2.0, 2.8, 3.6);
        if (hit(4)) g.fx.dust({ x: f.pos.x, y: f.pos.y, z: f.pos.z }, 6, 0.9, [0.8, 0.86, 0.92]);
      } else if (clip === 'ras_dash') {
        // the dash: afterimages behind him, wind torn off the sphere, dust off the feet
        S.ghostT -= dt;
        if (S.ghostT <= 0) {
          S.ghostT = 0.034;
          this.ghosts.spawn(this.modelOf(C.id), f, BLUE, 0.22, 0.4);
        }
        const fx0 = -Math.sin(f.yaw), fz0 = -Math.cos(f.yaw);
        for (let n = Math.round(dt * 70 * q); n > 0; n--) {
          const o = (Math.random() - 0.5) * 0.5;
          g.fx.emit(2, sp.x - fz0 * o, sp.y + (Math.random() - 0.5) * 0.4, sp.z + fx0 * o, -fx0 * 16, (Math.random() - 0.5) * 2, -fz0 * 16, 0.12, 0.05, 0.02, PALE[0], PALE[1], PALE[2]);
        }
        if (Math.random() < dt * 22) g.fx.dust({ x: f.pos.x, y: f.pos.y, z: f.pos.z }, 1, 0.7);
      }
    }
    // the clone shaping the Rasengan (Jiraiya-era Naruto can't hold its shape alone): beside the sphere, facing it
    this.updateHelper(f, C, clip === 'ras_charge' && fr >= 4 && f.root.visible, sp, dt);
    // the seals' smoke
    if (clip === 'kb_seal' && hit(C.jutsu.shadowClones.seal)) this.sealBurst(f);
    if (clip === 'nr_rush' && hit(5)) this.sealBurst(f);
    // the finisher: gone in smoke, re-formed over the victim
    let hidden = false;
    if (clip === 'nr_drop') {
      if (hit(NR_HIDE[0])) {
        this.ghosts.spawn(this.modelOf(C.id), f, WARM, 0.22, 0.45);
        this.poof({ x: f.pos.x, y: f.pos.y, z: f.pos.z }, 0.7);
      }
      if (hit(NR_HIDE[1])) this.poof({ x: f.pos.x, y: f.pos.y - 0.4, z: f.pos.z }, 0.75);
      hidden = fr >= NR_HIDE[0] && fr < NR_HIDE[1];
    }
    if (on) S.last = fr;
    // the substitution: hidden from the vanish until he re-forms
    for (const d of this.decoys) if (d.hideOwner && this.fighterOf(d.owner) === f) hidden = true;
    f.root.visible = !hidden;
    f.visible = !hidden;
  }

  updateHelper(f, C, on, sp, dt) {
    let H = this.helpers.get(f);
    if (!on) {
      if (H) {
        if (H.e?.busy && H.e.user === H) {
          this.poof({ x: H.e.f.pos.x, y: H.e.f.pos.y, z: H.e.f.pos.z }, 0.85, false);
          this.bodies.give(H.e);
        }
        this.helpers.delete(f);
      }
      return;
    }
    const R = [Math.cos(f.yaw), -Math.sin(f.yaw)], Fw = [-Math.sin(f.yaw), -Math.cos(f.yaw)];
    // it stands before him on the far side of the sphere (a little to his right), facing it: the ball between them
    let ox = R[0] * 0.25 + Fw[0], oz = R[1] * 0.25 + Fw[1];
    const ol = Math.hypot(ox, oz);
    ox /= ol;
    oz /= ol;
    const x = sp.x + ox * 0.5, z = sp.z + oz * 0.5, yaw = Math.atan2(ox, oz);
    if (!H) {
      H = { e: null, view: {}, t: 0, lose: () => (H.e = null) };
      H.e = this.bodies.take(C.id, H);
      this.helpers.set(f, H);
      if (H.e) {
        H.e.f.snap(x, f.pos.y, z, yaw);
        this.poof({ x, y: f.pos.y, z }, 0.8);
      }
    }
    if (!H.e) return;
    H.t += dt;
    const v = H.view;
    Object.assign(v, { x, y: f.pos.y, z, yaw, vf: 0, vl: 0, vy: 0, speed: 0, yawRate: 0, st: ST.loco, stT: H.t, sprint: false, skid: 0, ground: true, flipT: -1, landT: 9, landV: 0, hardLand: false, wall: null, stepUp: 0, combat: true });
    v.act = { clip: 'ras_helper', t: H.t, key: 'rhelp' };
    H.e.f.update(dt, v);
  }

  // ---------------------------------------------------------------- the network

  /** A relayed cast / event of Naruto's kit on someone else's fighter. Returns true when handled. */
  onRemote(m, r) {
    if (!NARUTO_CASTS[m.m]) return false;
    const g = this.game, C = charOf(r.info.ch), D = C.jutsu[m.m];
    if (!D) return true;
    const f = r.fighter;
    if (m.m === 'shadowClones') {
      if (!m.n) {
        r.act = { clip: 'kb_seal', sv: true, at: m.at, key: `kbs${m.i}`, dur: D.total * F, pause: 0 };
        g.audio?.handsign?.(f?.pos);
      } else if (m.n === 1) this.remoteSpawn(m);
      else if (m.n === 2) this.onCloneGone(m);
    } else if (m.m === 'rasengan') {
      if (!m.n) {
        r.act = { clip: 'ras_charge', sv: true, at: m.at, key: `rasc${m.i}`, dur: (D.charge.max + 4) * F, pause: 0 };
        r.rasBig = false;
        g.audio?.rasengan?.(f?.pos);
      } else if (m.n === 1) {
        r.rasBig = !!m.f;
        r.act = { clip: 'ras_dash', sv: true, at: m.at, key: `rasd${m.i}`, dur: D.dash.time + 0.2, pause: 0 };
        if (f) g.fx.dust(f.pos, 8, 1.3);
      } else if (m.n === 2) {
        r.act = m.f ? { clip: 'ras_hit', sv: true, at: m.at, key: `rash${m.i}`, dur: (D.impact + D.recovery + 10) * F, pause: 0 } : { clip: 'ras_whiff', sv: true, at: m.at, key: `rasw${m.i}`, dur: D.whiff * F, pause: 0 };
      }
    } else if (m.m === 'clones') {
      if (!m.n) {
        r.act = { clip: 'nr_rush', sv: true, at: m.at, key: `nrr${m.i}`, dur: D.total, pause: 0 };
        if (m.tg !== undefined && m.o?.length === 4) this.rushStart(m.id, m.i, m.at, m.tg, m.o, C, false);
        g.audio?.handsign?.(f?.pos);
      }
    } else if (m.m === 'cloneDefense') {
      if (!m.n) {
        r.act = { clip: 'cd_seal', sv: true, at: m.at, key: `cds${m.i}`, dur: D.total * F, pause: 0 };
        this.decoyStart(m.id, m.i, m.at, C, false);
        g.audio?.handsign?.(f?.pos);
      } else if (m.n === 1 && m.o) this.remoteReform(r, m, null);
      else if (m.n === 2) {
        const d = this.decoys.find((x) => x.owner === m.id && x.inst === m.i && !x.over);
        this.decoyStruck(d);
        if (m.f && m.o) this.remoteReform(r, m, m.yaw);
      }
    }
    return true;
  }

  /** A remote Naruto re-forms at o (his own spot, or behind his attacker): out of the smoke there, the stream restarts. */
  remoteReform(r, m, yaw) {
    const g = this.game, f = r.fighter;
    if (!f) return;
    const y = yaw ?? f.yaw;
    r.react = null;
    r.motion.clear();
    r.motion.push(g.net.renderTime() - 1, [m.o[0], m.o[1], m.o[2], 0, 0, 0, y, ST.jutsu, 0, 0]);
    f.snap(m.o[0], m.o[1], m.o[2], y);
    r.act = { clip: 'cd_appear', sv: true, at: g.net.serverNow(), key: `cda${m.i}`, dur: 16 * F, pause: 0 };
    this.poof({ x: m.o[0], y: m.o[1], z: m.o[2] }, 1);
    const d = this.decoys.find((x) => x.owner === m.id && !x.over);
    if (d) d.hideOwner = false;
  }

  /** Our own cast's phase coming back from the server: a clone gone (n:2), the substitution's catch (n:2). */
  onOwn(m) {
    const g = this.game;
    if (m.m === 'shadowClones' && m.n === 2) this.onCloneGone(m);
    else if (m.m === 'cloneDefense' && m.n === 2) {
      const d = this.decoys.find((x) => x.owner === g.net.id && x.inst === m.i && !x.over);
      this.decoyStruck(d);
      if (!m.f || !m.o) return;
      // caught: he re-forms behind the attacker (a server teleport: the new state sequence)
      if (m.sq !== undefined) g.net.seq = m.sq;
      const ctrl = g.ctrl, a = ctrl.action;
      if (a instanceof DefenseAction && a.inst === m.i) {
        a.caught = true;
        this.moveSelf(ctrl, a, m.o, m.yaw);
      } else if (!ctrl.dead) {
        ctrl.teleportTo(m.o, m.yaw);
        this.moveSelf(ctrl, null, m.o, m.yaw);
      }
      g.audio?.poof?.();
    }
  }

  /** The server refused one of our casts (a spot, a cooldown): the action stops, a hidden body shows. */
  onDeny(m) {
    if (m.k !== 'jutsu' || !NARUTO_CASTS[m.m]) return;
    const g = this.game, a = g.ctrl?.action;
    if (a && a.inst === m.i && a.K === this && !(a instanceof DefenseAction && m.n === 1)) g.ctrl.action = null;
    if (m.m === 'shadowClones' && !m.n) this.clearOwn(false);
    if (m.m === 'cloneDefense') for (const d of this.decoys) if (d.owner === g.net.id && d.inst === m.i) d.hideOwner = false;
    if (m.m === 'clones') for (const R of this.rushes) if (R.mine && R.inst === m.i) this.rushEnd(R, true);
  }

  /** A fighter KO'd, respawned or gone: its clones, its Rush, its decoy go with it. */
  dropOwner(id) {
    const g = this.game;
    if (id === g.net.id) this.clearOwn(false);
    for (const [key, rc] of this.remote) if (rc.owner === id) this.remoteGone(key, rc, true);
    for (const R of this.rushes) if (R.owner === id || R.tg === id) this.rushEnd(R, true);
    for (const d of this.decoys) if (d.owner === id) this.decoyEnd(d, true);
    const f = this.fighterOf(id);
    if (f) this.updateHelper(f, null, false, null, 0);
  }

  /** Every clone body on screen (shadow casters, Tsukuyomi hiding them): { f, gone }. */
  drawables() {
    const out = (this._draw ||= []);
    out.length = 0;
    for (const e of this.bodies.active()) out.push({ f: e.f, gone: false });
    return out;
  }

  /** Every clone fighter drawn this frame (MoveFX gives them their M1 trails). */
  *fighters() {
    for (const e of this.bodies.active()) if (e.f.root.visible) yield e.f;
  }

  // ---------------------------------------------------------------- warm-up

  warm(on, p) {
    // every pooled clone body drawn once (its buffers uploaded now: 4 bodies first seen at a Rush's start was a 150 ms hitch)
    let k = 0;
    for (const list of this.bodies.by.values()) {
      for (const e of list) {
        if (on) {
          this.game.scene.add(e.f.root);
          e.f.snap((p?.x || 0) + (k % 6) * 0.9, p?.y || 0, (p?.z || 0) + 2 + Math.floor(k / 6) * 0.9, 0);
          k++;
        } else e.f.root.removeFromParent();
      }
    }
    const objs = [...this.ghosts.warmObjects(), ...this.blasts.warmObjects()];
    for (const o of objs) {
      o.visible = on;
      if (!o.isSkinnedMesh) o.position.set(p?.x || 0, p?.y || 0, p?.z || 0);
    }
    if (on) for (const T of this.ghosts.templates.values()) T.ghosts[0].mat.uniforms.uAlpha.value = 0.5;
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    const g = this.game;
    this.time += dt;
    const ctrl = g.ctrl, a = ctrl?.action;
    if (a instanceof RasenganAction) this.detectRasengan(a);
    // every Naruto-kit fighter: the Rasengan, the helper, the seals, the hidden bodies
    const local = a instanceof RasenganAction ? a : null;
    this.updateFighter(g.player, ctrl?.C, true, dt, local ? local.sphere : 0, local?.big);
    for (const r of g.remotes.values()) {
      const C = charOf(r.info.ch);
      if (!r.fighter) continue;
      if (C.jutsu.cloneDefense) this.updateFighter(r.fighter, C, false, dt, 0, r.rasBig);
      else this.J.fxFor(r.fighter).ras?.update(dt, r.fighter.pos, 0);
    }
    if (!ctrl?.C.jutsu.cloneDefense && g.player) this.J.fxFor(g.player).ras?.update(dt, g.player.pos, 0);
    for (const f of this.per.keys()) if (f !== g.player && ![...g.remotes.values()].some((r) => r.fighter === f)) this.per.delete(f);
    for (const f of [...this.helpers.keys()]) if (f !== g.player && ![...g.remotes.values()].some((r) => r.fighter === f)) this.updateHelper(f, null, false, null, 0);
    this.updateOwn(dt);
    this.updateRemote(dt);
    this.updateRushes(dt);
    this.updateDecoys(dt);
    this.updateWakes(dt);
    this.ghosts.update(dt);
    this.blasts.update(dt);
  }
}
