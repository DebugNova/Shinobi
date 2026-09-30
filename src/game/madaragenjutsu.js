// Madara's Sharingan Genjutsu (X; data: src/shared/madara.js sharinganGenjutsu, clips mad_genjutsu* in
// src/char/madaramoves.js, visuals src/gfx/madaravisionfx.js). Cast like Itachi's Tsukuyomi: the head lowered, raised
// at `gaze` (phase n:1 with his eyes and facing); the server takes the cone then and sends the daze (REACT.daze, 3 s)
// to every screen, the caster's included (never predicted). Here: the local cast; his Eternal Mangekyō on every screen
// (the eyes blazing, the eye thrown out before him, the flare); the capture and the mark over every victim; and the
// victim's own screen leaving the fight for his vision (madaravision.js).
import * as THREE from 'three';
import { ST } from '../shared/config.js';
import { charOf } from '../shared/characters.js';
import { REACT } from '../shared/combat.js';
import { r3 } from '../shared/madarakit.js';
import { EyeMarks } from '../gfx/itachifx.js';
import { SealFx } from '../gfx/tsukuyomifx.js';
import { MADARA_EYE_GLSL } from '../gfx/madaravisionfx.js';
import { MadaraVision } from './madaravision.js';

const F = 1 / 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const turn = (yaw, to, rate, dt) => yaw + clamp(wrap(to - yaw), -rate * dt, rate * dt);
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const QUALITY = { low: 0.4, medium: 0.7, high: 1, ultra: 1.3 };
const CLIPS = new Set(['mad_genjutsu', 'mad_genjutsu_air']);
export const GENJUTSU_HIT = 'sharinganGenjutsu:main';
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _n = new THREE.Vector3();

/** X: the head lowers, then his eyes meet theirs at `gaze` (phase n:1 with the eyes and facing: the server decides). */
class GenjutsuAction {
  constructor(K, ctrl) {
    const g = K.game;
    this.K = K;
    this.jutsu = true;
    this.owns = true;
    this.netState = ST.jutsu;
    this.m = 'sharinganGenjutsu';
    this.D = ctrl.C.jutsu.sharinganGenjutsu;
    this.t = 0;
    this.inst = K.J.nextInst();
    this.air = !ctrl.grounded;
    this.target = g.combat.aimTarget(ctrl, this.D.range + 2);
    this.done = false;
    // in the air he hangs through it, like his other casts
    if (this.air) {
      this.physicsOpts = { ...ctrl.opts, gravity: ctrl.opts.gravity * 0.15, fallMul: 1 };
      ctrl.body.vy = Math.max(0, ctrl.body.vy * 0.2);
    }
    ctrl.sprint = false;
    g.net.act('jutsu', { m: this.m, i: this.inst, f: this.air ? 1 : 0, tg: this.target?.id, at: Math.round(g.net.serverNow()) });
    g.audio?.handsign?.();
    g.lastFight = performance.now();
  }

  anim() {
    return { clip: this.air ? 'mad_genjutsu_air' : 'mad_genjutsu', t: this.t, key: `mgen${this.inst}` };
  }

  step(ctrl, input, dt) {
    const b = ctrl.body;
    this.t += dt;
    b.vx *= 0.8;
    b.vz *= 0.8;
    if (this.air && b.vy > 0) b.vy *= 0.85;
    // until the gaze he turns to the target (or where the camera looks)
    if (!this.done) {
      const T = this.target && !this.target.dead && (this.K.J.targetPos(this.target.id, _w) || this.target);
      const want = T ? Math.atan2(-(T.x - b.x), -(T.z - b.z)) : this.K.game.cam.yaw;
      ctrl.yaw = ctrl.moveYaw = turn(ctrl.yaw, want, 11, dt);
    }
    if (!this.done && this.t >= this.D.gaze * F) {
      this.done = true;
      this.K.gaze(ctrl, this);
    }
    return this.t < this.D.total * F;
  }
}

export const GENJUTSU_CAST = { ok: () => true, start: (J, ctrl) => new GenjutsuAction(J.madara.gen, ctrl) };

export class MadaraGenjutsu {
  constructor(J) {
    this.J = J;
    this.game = J.game;
    const s = this.game.scene;
    this.marks = new EyeMarks(s, MADARA_EYE_GLSL); // his Eternal Mangekyō: in his eyes through the cast, the mark over a victim
    this.seal = new SealFx(s, { glsl: MADARA_EYE_GLSL, fn: 'madaraSeal' }); // the eye thrown before him, the capture
    this.vision = new MadaraVision(this); // the victim's own screen (madaravision.js)
    this.dazed = new Map(); // victim id -> { t0, until (server ms), self: the local fighter }
    this.per = new Map(); // Madara fighter -> { key, last (clip frame) }
    this.time = 0;
  }

  quality() {
    return QUALITY[this.game.preset] ?? 1;
  }

  /** His eyes (world): the midpoint, and each eye (Itachi's kit holds the helper: C.eyes from the head bone). */
  eyes(f, C, out, outL, outR) {
    return this.J.itachi.eyes(f, C, out, outL, outR);
  }

  /** Every program compiles behind the loading screen (main.js warmShaders). */
  warm(on, p) {
    this.marks.begin();
    this.seal.begin();
    if (on) {
      this.marks.set(p.x, p.y + 1, p.z, 0.3, 1, 1, 0, 1);
      this.marks.set(p.x + 0.5, p.y + 1, p.z, 0.05, -1, 1, 0, 1);
      this.seal.set(_v.set(p.x, p.y + 1, p.z), 0.8, null, 0, { flash: 1, seal: 1, ring: 1 }, 0.1, 0, {}, 0);
    }
    this.marks.end();
    this.seal.end();
  }

  // ---------------------------------------------------------------- the gaze

  /** The eyes meet theirs: phase n:1 with his eyes and his facing (the server decides whom it takes). */
  gaze(ctrl, a) {
    const g = this.game, yaw = ctrl.yaw;
    const e = this.eyes(g.player, ctrl.C, _v);
    const o = [e.x, e.y, e.z].map(r3), d = [-Math.sin(yaw), 0, -Math.cos(yaw)].map(r3);
    g.net.act('jutsu', { m: a.m, i: a.inst, n: 1, o, d, at: Math.round(g.net.serverNow()) });
  }

  /** The flare in his eyes as it takes hold (every screen, from the clip's frame): a flash, red streaks, a ground wave. */
  gazeFx(f, C) {
    const g = this.game, e = this.eyes(f, C, _v), q = this.quality();
    g.fx.emit(5, e.x, e.y, e.z, 0, 0, 0, 0.16, 0.04, 0.5, 2.8, 0.05, 0.14);
    g.fx.emit(1, e.x, e.y, e.z, 0, 0, 0, 0.24, 0.15, 1.3, 2.2, 0.03, 0.12);
    const gy = g.world.ground(f.pos.x, f.pos.z, f.pos.y + 0.3, {}).y;
    g.fx.emit(4, f.pos.x, gy + 0.05, f.pos.z, 0, 0, 0, 0.5, 0.4, 5.5, 1.4, 0.03, 0.12, 0.9);
    for (let n = 0; n < Math.round(12 * q); n++) {
      const a = f.yaw + (Math.random() - 0.5) * 1.2, s = 8 + Math.random() * 10;
      g.fx.emit(2, e.x, e.y, e.z, -Math.sin(a) * s, (Math.random() - 0.5) * 3, -Math.cos(a) * s, 0.25 + Math.random() * 0.2, 0.05, 0.02, 2.4, 0.05, 0.12);
    }
    g.audio?.genjutsu?.(f.pos, false);
    const near = this.J.itachi.nearness(f.pos, 20);
    if (near > 0) g.cam.addTrauma(0.18 * near);
  }

  // ---------------------------------------------------------------- the network

  /** A relayed cast on someone else's Madara (n:0: the pose; the gaze's n:1 is the server's business). */
  onRemote(m, r) {
    if (m.m !== 'sharinganGenjutsu') return false;
    const D = charOf(r.info.ch).jutsu.sharinganGenjutsu;
    if (!D) return true;
    if (!m.n) {
      r.act = { clip: m.f ? 'mad_genjutsu_air' : 'mad_genjutsu', sv: true, at: m.at, key: `mgen${m.i}`, dur: D.total * F, pause: 0 };
      this.game.audio?.handsign?.(r.fighter?.pos);
    }
    return true;
  }

  /** Every hit result (combat.onHitr): the daze and its mark, his vision on its victim's screen, a broken genjutsu. */
  onHitr(m) {
    const g = this.game, now = g.net.serverNow();
    if (String(m.m) === GENJUTSU_HIT) {
      // (the dummy only wobbles; it wears the mark for the genjutsu's length all the same)
      const until = m.dz || (m.v === 0 ? m.at + charOf('madara').jutsu.sharinganGenjutsu.hits.main.stun * (1000 / 60) : m.e);
      // (on its own screen the vision stands for it: no capture, no mark over its own head, not even after)
      this.dazed.set(m.v, { t0: now, until, self: m.v === g.net.id });
      if (m.v === g.net.id) this.vision.start(m.a, until);
      const B = this.J.itachi.body(m.v);
      if (B && m.v !== g.net.id) g.audio?.genjutsu?.(B.pos, false);
    } else if (m.r !== REACT.none && !m.dz) {
      // thrown out of it (a launch, a knockdown): the genjutsu breaks
      const D = this.dazed.get(m.v);
      if (D) D.until = Math.min(D.until, now);
      if (D && m.v === g.net.id) this.vision.breakAt(now);
    }
  }

  // ---------------------------------------------------------------- per frame

  /**
   * Every Madara, every frame, from the clip he is drawn in (v.act: identical on every screen): his Eternal Mangekyō
   * blazing through the cast, the eye thrown out before him as his eyes meet theirs, the flare at the gaze.
   */
  updateMadara() {
    const g = this.game, seen = (this._seen ||= new Set());
    seen.clear();
    const each = (f, C, local) => {
      if (!f || !C?.jutsu.sharinganGenjutsu) return;
      const act = f.view?.act;
      if (f.dead || !act || !CLIPS.has(act.clip)) return;
      seen.add(f);
      const D = C.jutsu.sharinganGenjutsu, fr = act.t * 60;
      let S = this.per.get(f);
      if (!S || S.key !== act.key) this.per.set(f, (S = { key: act.key, last: -1 }));
      const glow = 1.45 * ss(D.gaze - 6, D.gaze, fr) * (1 - ss(D.total - 8, D.total, fr));
      if (glow > 0.01 && f.root.visible && g.camera.position.distanceToSquared(f.pos) < 1600) {
        this.eyes(f, C, _v, _w, _u);
        for (const e of [_w, _u]) this.marks.set(e.x, e.y, e.z, 0.022, -1, clamp(glow, 0, 1), this.time * 3, glow);
      }
      // his Eternal Mangekyō thrown out before him as the eyes meet theirs, turning, gone as he lets go
      if (fr >= D.gaze - 8 && fr < D.total - 6 && f.root.visible) {
        const pop = ss(D.gaze - 8, D.gaze, fr), out = ss(D.gaze + 10, D.total - 6, fr);
        const w = (this._pw ||= { flash: 0, violet: 0, blades: 0, ring: 0, ink: 0 });
        w.seal = pop * (1 - out);
        w.ring = ss(D.gaze - 2, D.gaze + 2, fr) * (1 - ss(D.gaze + 2, D.gaze + 12, fr));
        const back = 1 + 2.2 * (pop - 1) ** 3 + 1.2 * (pop - 1) ** 2;
        const e = this.eyes(f, C, _v), fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
        e.x += fx * 1.1;
        e.z += fz * 1.1;
        const sc = (this._psc ||= {});
        sc.seal = 0.45 + 0.55 * back + 0.35 * out;
        this.seal.set(e, 0.75, _n.set(fx, 0, fz), 0, w, fr / 60, this.time * 2.2 + 3 * (1 - Math.exp(-(fr - D.gaze + 8) / 20)), sc, 0);
      }
      if (S.last < D.gaze && fr >= D.gaze) this.gazeFx(f, C);
      S.last = fr;
      // the caster's own screen pulses red as it takes hold
      if (local) g.post.genjutsu.amt = Math.max(g.post.genjutsu.amt, 0.25 * ss(D.gaze - 1, D.gaze + 1, fr) * (1 - ss(D.gaze + 1, D.gaze + 12, fr)));
    };
    each(g.player, g.ctrl?.C, true);
    for (const r of g.remotes.values()) each(r.fighter, charOf(r.info.ch), false);
    for (const f of this.per.keys()) if (!seen.has(f)) this.per.delete(f);
  }

  /**
   * Every dazed victim, on every screen but its own: the capture (a flash, his eye spinning up round the body, a red
   * ring), then his eye open over its head for the rest of the genjutsu, closing as it lets go.
   */
  updateDazed(now) {
    const g = this.game;
    for (const [id, D] of this.dazed) {
      const B = this.J.itachi.body(id);
      const age = (now - D.t0) / 1000, left = (D.until - now) / 1000;
      if (!B || left < -0.35 || (B.fighter && B.fighter.dead && left < 0)) {
        this.dazed.delete(id);
        continue;
      }
      if (D.self) continue;
      const alive = left > 0 ? 1 : ss(-0.35, 0, left);
      if (age < 1.3) {
        const w = (this._sw ||= {});
        w.flash = ss(0, 0.04, age) * (1 - ss(0.15, 0.4, age)) * alive;
        w.ring = ss(0.1, 0.22, age) * (1 - ss(0.5, 0.8, age)) * alive;
        w.seal = ss(0.08, 0.28, age) * (1 - ss(0.85, 1.3, age)) * alive;
        w.violet = w.blades = w.ink = 0;
        const sc = (this._ssc ||= {});
        const pop = ss(0.08, 0.4, age), back = 1 + 2.2 * (pop - 1) ** 3 + 1.2 * (pop - 1) ** 2;
        sc.seal = 0.5 + 0.5 * back;
        this.seal.set(_w.set(B.pos.x, B.pos.y + 1.0, B.pos.z), 0.7, null, 0.6, w, age, age * 2.4 + 3 * (1 - Math.exp(-age * 2.5)), sc, 0);
      }
      const open = ss(0.85, 1.1, age) * alive;
      if (open > 0.001) {
        const head = (B.fighter && B.fighter.vrm?.humanoid.getRawBoneNode('head')?.getWorldPosition(_v)) || _v.set(B.pos.x, B.pos.y + 1.75, B.pos.z);
        const bob = Math.sin(this.time * 2.4 + id) * 0.03;
        this.marks.set(head.x, head.y + 0.6 + bob, head.z, 0.34, open, 1, this.time * 1.3, 0.9 + 0.3 * Math.sin(this.time * 5));
      }
    }
  }

  update(dt) {
    this.time += dt;
    const now = this.game.net.serverNow();
    this.marks.begin();
    this.seal.begin();
    this.updateMadara();
    this.updateDazed(now);
    this.vision.update(dt, now);
    this.marks.end();
    this.seal.end();
  }
}
