// Madara's jutsu kit (data: src/shared/madara.js, shared geometry: src/shared/madarakit.js, visuals:
// src/gfx/madarafx.js, clips: src/char/madaramoves.js). The local fighter's actions, the hit detection of his area
// jutsu (the caster detects, the server validates with the same geometry), the counter/reflect events, and everyone
// else's casts as visuals.
//   Q  Great Fire Annihilation   E  Wood Release: Cutting Technique   G  Uchiha Return   R  Tengai Shinsei
// Casts come in two phases: n:0 at the press (the server takes the cooldown / gauge, remotes start the pose), n:1
// when the effect becomes real (the torrent, the slam, the release) with everything that places it. An interrupted
// cast never sends n:1, so no screen shows an effect that didn't happen. World effects run on the server clock from
// n:1's time (`at1`), identical on every screen; a screen that hears of it late fast-forwards (nothing pops).
import * as THREE from 'three';
import { ST, FLAG } from '../shared/config.js';
import { charOf } from '../shared/characters.js';
import { mulberry32 } from '../shared/rng.js';
import { r3, fireShape, fireFront, fireTail, fireWidth, fireLane, firePoint, fireContains, fieldContains, fieldStart, stakeLine, woodContains, counterWindow, COUNTER_KIND, meteorShape, meteorAt } from '../shared/madarakit.js';
import { Billows, WaveDecal, FieldFlames, Stakes, CrackDecal, Debris, Gunbai, GUNBAI, gunbaiBack, WindBarrier, MeteorRock, MeteorMark } from '../gfx/madarafx.js';
import { Trail } from '../gfx/movefx.js';
import { toon } from '../gfx/toon.js';

const F = 1 / 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const turn = (yaw, to, rate, dt) => yaw + clamp(wrap(to - yaw), -rate * dt, rate * dt);
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const QUALITY = { low: 0.4, medium: 0.7, high: 1, ultra: 1.3 };
const COUNTER_CLIPS = new Set(['mad_counter', 'mad_counter_air']);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _p2 = new THREE.Vector3(), _p = {}, _l = {}, _gnd = {};

/** World position of a fighter's bone (drawn pose). */
function bonePos(fighter, name, out) {
  const n = fighter?.vrm.humanoid.getRawBoneNode(name);
  return n ? n.getWorldPosition(out) : null;
}

// ---------------------------------------------------------------- Great Fire Annihilation (Q)

class FireAction {
  constructor(K, ctrl) {
    const g = K.game;
    this.K = K;
    this.jutsu = true;
    this.owns = true;
    this.netState = ST.jutsu;
    this.D = ctrl.C.jutsu.fireAnnihilation;
    this.t = 0;
    this.inst = K.J.nextInst();
    this.air = !ctrl.grounded;
    this.target = g.combat.aimTarget(ctrl, 30);
    this.emitted = false;
    // in the air he hangs through the cast (the torrent pours down onto the ground ahead)
    if (this.air) {
      this.physicsOpts = { ...ctrl.opts, gravity: ctrl.opts.gravity * 0.15, fallMul: 1 };
      ctrl.body.vy = Math.max(0, ctrl.body.vy * 0.2);
    }
    ctrl.sprint = false;
    g.net.act('jutsu', { m: 'fireAnnihilation', i: this.inst, f: this.air ? 1 : 0, tg: this.target?.id });
    g.audio?.handsign?.();
    g.lastFight = performance.now();
  }

  anim() {
    return { clip: this.air ? 'mad_fire_air' : 'mad_fire', t: this.t, key: `mfire${this.inst}` };
  }

  step(ctrl, input, dt) {
    const b = ctrl.body, D = this.D;
    this.t += dt;
    b.vx *= 0.8;
    b.vz *= 0.8;
    if (this.air && b.vy > 0) b.vy *= 0.85;
    // aim: through the seal and the inhale he turns to the target (or where the camera looks)
    if (!this.emitted) {
      const T = this.target;
      const want = T ? Math.atan2(-(T.x - b.x), -(T.z - b.z)) : this.K.game.cam.yaw;
      ctrl.yaw = ctrl.moveYaw = turn(ctrl.yaw, want, 12, dt);
      if (Math.abs(this.t - D.seal * F) < dt * 0.5) this.K.game.audio?.inhale?.();
    }
    if (!this.emitted && this.t >= D.emit * F) {
      this.emitted = true;
      this.K.fireEmit(ctrl, this);
    }
    return this.t < D.total * F;
  }
}

// ---------------------------------------------------------------- the kit

// ---------------------------------------------------------------- Wood Release: Cutting Technique (E)

class WoodAction {
  constructor(K, ctrl) {
    const g = K.game;
    this.K = K;
    this.jutsu = true;
    this.owns = true;
    this.netState = ST.jutsu;
    this.D = ctrl.C.jutsu.woodCutting;
    this.t = 0;
    this.inst = K.J.nextInst();
    this.target = g.combat.aimTarget(ctrl, 30);
    this.emitted = false;
    // ground only: from the air he dives (falls fast, wound up) and slams on landing
    this.phase = ctrl.grounded ? 'slam' : 'dive';
    this.ct = 0; // time in the slam clip
    if (this.phase === 'dive') {
      this.physicsOpts = { ...ctrl.opts, gravity: ctrl.opts.gravity * 2.4, fallMul: 1, maxFall: this.D.dive.speed };
      ctrl.body.vy = Math.min(ctrl.body.vy, -3);
    }
    ctrl.sprint = false;
    g.net.act('jutsu', { m: 'woodCutting', i: this.inst, f: this.phase === 'dive' ? 1 : 0, tg: this.target?.id });
    g.lastFight = performance.now();
  }

  anim() {
    if (this.phase === 'dive') return { clip: 'mad_wood_dive', t: this.t, key: `mwood${this.inst}d` };
    return { clip: 'mad_wood', t: this.ct, key: `mwood${this.inst}` };
  }

  step(ctrl, input, dt) {
    const b = ctrl.body, D = this.D;
    this.t += dt;
    // aim at the target (or the camera's way) until the palm lands
    if (!this.emitted) {
      const T = this.target;
      const want = T ? Math.atan2(-(T.x - b.x), -(T.z - b.z)) : this.K.game.cam.yaw;
      ctrl.yaw = ctrl.moveYaw = turn(ctrl.yaw, want, 14, dt);
    }
    if (this.phase === 'dive') {
      b.vx *= 0.9;
      b.vz *= 0.9;
      if (ctrl.grounded) {
        // landed: straight into the slam, the wind-up already done in the air
        this.phase = 'slam';
        this.ct = 7 * F;
        this.physicsOpts = null;
        this.K.game.cam.addTrauma(0.2);
      } else return this.t < D.dive.max;
    }
    b.vx *= 0.7;
    b.vz *= 0.7;
    this.ct += dt;
    if (!this.emitted && this.ct >= D.slam * F) {
      this.emitted = true;
      this.K.woodEmit(ctrl, this);
    }
    return this.ct < D.total * F;
  }
}

// ---------------------------------------------------------------- Uchiha Return (G)

/**
 * The gunbai off his back, one spin, the wind barrier (timings in madara.js): the server raises the barrier at the
 * press and answers every hit inside it (its phase n:1: effects only, the clip plays on). He stays where he is; in
 * the air he hangs through it, like the fire. Through the spin he turns to face the target (lock-on, else the enemy
 * nearest the camera's centre, else where the camera looks): the turn hides inside the spin. No invulnerability flag
 * goes out in his states: attackers' screens must still send their hits (the server answers them; they read the
 * barrier from the relayed press: MadaraKit.countering).
 */
class CounterAction {
  constructor(K, ctrl) {
    const g = K.game;
    this.K = K;
    this.jutsu = true;
    this.owns = true;
    this.netState = ST.jutsu;
    this.D = ctrl.C.jutsu.uchihaReturn;
    this.t = 0;
    this.inst = K.J.nextInst();
    this.air = !ctrl.grounded;
    this.target = g.combat.aimTarget(ctrl, 30);
    if (this.air) {
      this.physicsOpts = { ...ctrl.opts, gravity: ctrl.opts.gravity * 0.15, fallMul: 1 };
      ctrl.body.vy = Math.max(0, ctrl.body.vy * 0.2);
    }
    ctrl.sprint = false;
    g.net.act('jutsu', { m: 'uchihaReturn', i: this.inst, f: this.air ? 1 : 0 });
    g.audio?.gunbaiUp?.();
    g.lastFight = performance.now();
  }

  anim() {
    return { clip: this.air ? 'mad_counter_air' : 'mad_counter', t: this.t, key: `mctr${this.inst}` };
  }

  step(ctrl, input, dt) {
    const b = ctrl.body, D = this.D;
    this.t += dt;
    b.vx *= 0.8;
    b.vz *= 0.8;
    if (this.air && b.vy > 0) b.vy *= 0.85;
    if (this.t >= D.spinFrom * F && this.t < D.spinTo * F) {
      const T = this.target && !this.target.dead && (this.K.J.targetPos(this.target.id, _w) || this.target);
      const want = T ? Math.atan2(-(T.x - b.x), -(T.z - b.z)) : this.K.game.cam.yaw;
      ctrl.yaw = ctrl.moveYaw = turn(ctrl.yaw, want, 14, dt);
    }
    return this.t < D.total * F;
  }
}

// ---------------------------------------------------------------- Tengai Shinsei (R)

/**
 * The ultimate: the arm raised to the sky (the target chosen at the press: lock-on or where he looks), released at
 * frame 30: the meteor appears high behind him and lands on the target's spot `delay` s later (the server applies the
 * impact). He moves freely from frame 45.
 */
class MeteorAction {
  constructor(K, ctrl) {
    const g = K.game;
    this.K = K;
    this.jutsu = true;
    this.owns = true;
    this.netState = ST.jutsu;
    this.D = ctrl.C.jutsu.tengaiShinsei;
    this.t = 0;
    this.inst = K.J.nextInst();
    this.air = !ctrl.grounded;
    this.target = g.combat.aimTarget(ctrl, this.D.range);
    this.emitted = false;
    if (this.air) {
      this.physicsOpts = { ...ctrl.opts, gravity: ctrl.opts.gravity * 0.15, fallMul: 1 };
      ctrl.body.vy = Math.max(0, ctrl.body.vy * 0.2);
    }
    ctrl.sprint = false;
    g.net.act('jutsu', { m: 'tengaiShinsei', i: this.inst, f: this.air ? 1 : 0, tg: this.target?.id });
    g.audio?.ult?.();
    g.lastFight = performance.now();
  }

  anim() {
    return { clip: this.air ? 'mad_meteor_air' : 'mad_meteor', t: this.t, key: `mmet${this.inst}` };
  }

  step(ctrl, input, dt) {
    const b = ctrl.body, D = this.D;
    this.t += dt;
    b.vx *= 0.8;
    b.vz *= 0.8;
    if (this.air && b.vy > 0) b.vy *= 0.85;
    if (!this.emitted) {
      const T = this.target;
      const want = T ? Math.atan2(-(T.x - b.x), -(T.z - b.z)) : this.K.game.cam.yaw;
      ctrl.yaw = ctrl.moveYaw = turn(ctrl.yaw, want, 10, dt);
      if (this.t >= D.release * F) {
        this.emitted = true;
        this.K.meteorEmit(ctrl, this);
      }
    }
    return this.t < D.total * F;
  }
}

// jutsu id -> { ok(J, ctrl), start(J, ctrl) } (merged into jutsu.js's registry)
export const MADARA_CASTS = {
  fireAnnihilation: { ok: () => true, start: (J, ctrl) => new FireAction(J.madara, ctrl) },
  woodCutting: { ok: () => true, start: (J, ctrl) => new WoodAction(J.madara, ctrl) },
  uchihaReturn: { ok: () => true, start: (J, ctrl) => new CounterAction(J.madara, ctrl) },
  tengaiShinsei: { ok: () => true, start: (J, ctrl) => new MeteorAction(J.madara, ctrl) },
};

export class MadaraKit {
  constructor(J) {
    this.J = J;
    this.game = J.game;
    const s = this.game.scene;
    this.billows = new Billows(s); // fire (opaque, outlined)
    this.smoke = new Billows(s, true); // smoke (soft, blended)
    this.decals = Array.from({ length: 4 }, () => new WaveDecal(s));
    this.tongues = new FieldFlames(s);
    this.fires = []; // live torrents (see startFire)
    // wood: stake lines (instanced, toon-shaded, shadowed), the crack, flying rocks and dirt
    this.stakes = new Stakes(s, toon({ vertexColors: true, hatch: 0.55, key: 'stake' }));
    this.cracks = Array.from({ length: 3 }, () => new CrackDecal(s));
    this.debris = new Debris(s, toon({ hatch: 0.4, key: 'debris' }));
    this.woods = []; // live stake lines (see startWood)
    // Uchiha Return: every Madara's gunbai (on his back, in his hand through the cast; made when he first appears:
    // shared geometry and material, nothing to compile), the wind barriers and the fan's wind trails (pools)
    this.gunbaiMat = toon({ map: J.game.gunbaiTex || null, hatch: 0.3, key: 'gunbai', side: THREE.DoubleSide, fade: false });
    this.gunbaiOf = new Map(); // fighter -> Gunbai
    this.forceGunbai = null; // debug: a weight (0 back .. 1 hand) for the local fighter's gunbai whatever the clip
    this.barriers = Array.from({ length: 4 }, () => new WindBarrier(s));
    this.fanTrails = Array.from({ length: 4 }, () => new Trail(s, 0.2));
    for (const T of this.fanTrails) T.mat.uniforms.uColor.value.set(0.75, 0.85, 1.0);
    this.uchiha = new Map(); // fighter -> { B: WindBarrier, T: Trail, key, gust, last (clip time), pulse }
    // the meteor: rocks (toon, outlined, shadowed; a heat shell), the marks on the ground (warning, then crater)
    this.rocks = Array.from({ length: 2 }, () => new MeteorRock(s, toon({ vertexColors: true, hatch: 0.6, key: 'meteor', fade: false })));
    this.marks = Array.from({ length: 2 }, () => new MeteorMark(s));
    this.meteors = []; // live meteors (see startMeteor)
    this.counterFx = []; // the barrier's answers, their effects waiting to leave the shell
    this.deflected = new Map(); // our attack instances a barrier deflected -> until (performance.now ms): not predicted
    this.reflects = []; // reflected shuriken on their way back
    this.skew = 0; // ms the effects' clock runs behind the server's (debug slow motion only)
    this.time = 0;
  }

  /** Every object whose program must compile behind the loading screen (main.js warmShaders). */
  warmObjects() {
    return [this.billows.mesh, this.smoke.mesh, ...this.decals.map((d) => d.mesh), this.tongues.mesh, ...this.stakes.lines.map((L) => L.mesh), ...this.cracks.map((c) => c.mesh), this.debris.mesh, ...this.barriers[0].group.children, this.fanTrails[0].mesh, this.rocks[0].rock, this.marks[0].mesh];
  }

  /** Warm-up state: one of everything visible (shader compile), then hidden again. */
  warm(on, p) {
    if (on) {
      for (const B of [this.billows, this.smoke]) {
        B.set(B.take(), p.x, p.y, p.z, 1, 1, 0, 0.3, 0);
        B.update(0);
      }
      this.tongues.set(0, p.x, p.y, p.z, 1, 0.6, 0.2);
      this.tongues.update(0);
      for (const d of this.decals) d.mesh.visible = true;
      for (const L of this.stakes.lines) {
        L.mesh.count = 1;
        L.mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
        L.mesh.visible = true;
      }
      for (const c of this.cracks) c.mesh.visible = true;
      this.debris.throw(p.x, p.y + 1, p.z, 0, 0, 0, 0.3, 0x886644, 0.1);
      this.debris.update(0, this.game.world);
      const R = this.rocks[0];
      R.rock.position.set(p.x, p.y + 6, p.z);
      R.rock.scale.setScalar(2);
      R.rock.visible = true;
      R.shellMat.uniforms.uHeat.value = 1;
      this.marks[0].place(p.x, p.y, p.z, 4, () => p.y);
      if (this.game.gunbaiTex !== undefined) {
        const G = (this.warmGunbai ||= new THREE.Mesh(new Gunbai(this.gunbaiMat).mesh.geometry, this.gunbaiMat));
        G.castShadow = true;
        G.position.set(p.x, p.y, p.z);
        this.game.scene.add(G);
      }
      const B = this.barriers[0];
      B.update(new THREE.Vector3(p.x, p.y, p.z), { t: 0.5, amt: 1, grow: 1, R: 1.6, shell: 1, wave: { k: 0.3, amt: 1, r: 2, h: 1.8, seed: 0 } }, 0);
      const T = this.fanTrails[0];
      T.push(_v.set(p.x, p.y, p.z), _w.set(p.x, p.y + 1, p.z), 0);
      T.push(_v.set(p.x + 1, p.y, p.z), _w.set(p.x + 1, p.y + 1, p.z), 0.01);
      T.update(0.02);
    } else {
      for (const B of [this.billows, this.smoke]) {
        for (let i = 0; i < 900; i++) B.aPos.array[i * 4 + 3] = 0;
        B.free = Array.from({ length: 900 }, (_, i) => 899 - i);
        B.hi = 0;
        B.dirty = true;
        B.update(0);
      }
      this.tongues.give([0]);
      for (const d of this.decals) d.mesh.visible = false;
      for (const L of this.stakes.lines) this.stakes.give(L);
      for (const c of this.cracks) c.mesh.visible = false;
      this.debris.list.length = 0;
      this.debris.update(0, this.game.world);
      this.rocks[0].rock.visible = false;
      this.marks[0].mesh.visible = false;
      this.marks[0].busy = false;
      this.warmGunbai?.removeFromParent();
      this.barriers[0].release();
      this.fanTrails[0].s.length = 0;
      this.fanTrails[0].update(1);
    }
  }

  /**
   * The effects' clock: the server clock, held back by whatever debug slow motion (__game.timeScale) took out, so film
   * strips slow the jutsu down with the fighters. In play (timeScale 1) it IS the server clock, stalls included.
   */
  now() {
    return this.game.net.serverNow() - this.skew;
  }

  quality() {
    return QUALITY[this.game.preset] ?? 1;
  }

  // ---------------------------------------------------------------- fire: cast

  /** The exhale: place the wave (rounded payload, as the server relays it) and tell everyone. */
  fireEmit(ctrl, a) {
    const g = this.game, b = ctrl.body, W = a.D.wave, yaw = ctrl.yaw;
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const gy = g.world.ground(b.x, b.z, b.y + 0.3, {}).y;
    let o;
    if (!a.air || b.y - gy < 1.2) o = [b.x, gy, b.z, 0];
    else {
      // from the air: the stream angles down; the rolling wall starts where it meets the ground
      const my = b.y + W.mouth, cp = Math.cos(W.airPitch), sp = Math.sin(W.airPitch);
      const t = g.world.raycast(b.x, my, b.z, dx * cp, -sp, dz * cp, 16);
      const hx = b.x + dx * cp * t, hz = b.z + dz * cp * t;
      const hy = g.world.ground(hx, hz, my - sp * t + 0.5, {}).y;
      o = [hx, hy, hz, my - hy];
    }
    o = o.map(r3);
    const d = [dx, 0, dz].map(r3);
    const at1 = Math.round(g.net.serverNow());
    g.net.act('jutsu', { m: 'fireAnnihilation', i: a.inst, n: 1, o, d, at: at1 });
    this.startFire({ owner: g.net.id, mine: true, inst: a.inst, at1, o, d, C: ctrl.C, fighter: g.player });
  }

  /** A torrent on this screen (ours or a remote's): its shape from the payload, its visuals, (ours) its hits. */
  startFire(e) {
    const g = this.game, J = e.C.jutsu.fireAnnihilation;
    const shape = fireShape(g.world, J, e.o, e.d);
    const decal = this.decals.find((x) => !x.busy) || this.decals[0];
    decal.place(shape, J.wave, firePoint);
    const q = this.quality();
    const f = {
      ...e, J, W: J.wave, shape, decal, rng: mulberry32(e.inst * 7919 + 13), frng: mulberry32(e.inst * 104729 + 7),
      skew0: this.skew, rate: 330 * q, born: 0, blobs: [], victims: new Map(), fieldTick: 0, splashed: new Set(), tongues: null, roar: false, t: 0,
    };
    this.fires.push(f);
    g.audio?.fireRoar?.(e.fighter ? e.fighter.pos : { x: e.o[0], y: e.o[1], z: e.o[2] });
    // a flash of heat on screen for those near it
    this.fireFlash = Math.max(this.fireFlash || 0, this.nearness(e.o, 30));
  }

  /** 1 at the local fighter, fading to 0 at `range` metres. */
  nearness(p, range) {
    const me = this.game.player?.pos;
    if (!me) return 0;
    return clamp(1 - Math.hypot(me.x - p[0], me.z - p[2]) / range, 0, 1);
  }

  // ---------------------------------------------------------------- fire: every frame

  updateFire(f, dt) {
    const g = this.game, W = f.W, J = f.J, sh = f.shape, B = this.billows;
    // (skew0: only slow motion from the cast on holds it back; the cast's own time is on the server clock)
    const t = (this.now() + f.skew0 - f.at1) / 1000;
    f.t = t;
    const exhale = J.exhale * F;
    // the mouth: the caster's drawn head (the stream starts there), else above the origin
    const hp = bonePos(f.fighter, 'head', _v);
    const mouth = hp ? { x: hp.x + sh.dx * 0.16, y: hp.y + 0.02, z: hp.z + sh.dz * 0.16 } : { x: sh.o[0], y: sh.o[1] + 1.45, z: sh.o[2] };
    const jetLen = f.o[3] > 0 ? Math.hypot(mouth.x - sh.o[0], mouth.y - sh.o[1], mouth.z - sh.o[2]) : 0;

    // blobs are born on a fixed schedule over the exhale (a late start spawns the ones already due: fast-forward)
    const total = Math.floor(f.rate * exhale);
    while (f.born < total && f.born / f.rate <= t) {
      const r = f.rng;
      const lat = r() * 2 - 1;
      f.blobs.push({ i: B.take(), tb: f.born / f.rate, f: Math.sign(lat) * Math.pow(Math.abs(lat), 0.8), h: r(), m: 0.8 + r() * 0.5, linger: 0.35 + r() * 0.55, seed: r(), shed: r() });
      f.born++;
    }
    // the torrent's blobs: each rides the same curve as the front from its birth, rolls over the ground of its lane,
    // splashes up and sideways where its lane hits a wall, then lingers, rises and burns out
    let w = 0;
    for (let k = 0; k < f.blobs.length; k++) {
      const b = f.blobs[k];
      const tau = t - b.tb;
      const sRaw = fireFront(W, tau);
      fireLane(sh, b.f, sRaw, _l);
      const s = Math.min(sRaw, Math.max(0, _l.len - 0.3));
      const excess = Math.max(0, sRaw - _l.len);
      const la = Math.max(0, tau - W.time) / b.linger;
      if (la >= 1) {
        B.give(b.i);
        continue;
      }
      // (the stream leaves the mouth narrow and fans out to the wave's width over the first metres)
      firePoint(sh, W, s, b.f * (0.3 + 0.7 * ss(0, 3.5, s)), _p);
      // blobs swell as they roll (a wall ~3 m tall at the end), stacked by their height seed
      let r = (0.36 + 0.105 * s) * b.m * (1 + 0.2 * la + excess * 0.12);
      r = Math.min(r, 2.6);
      let x = _p.x, y = _p.y + r * (0.45 + b.h * 0.95) + la * 0.8 + excess * 0.45, z = _p.z;
      // splash: slide along the wall, out toward the lane's side
      if (excess > 0) {
        const side = b.f === 0 ? 1 : Math.sign(b.f);
        x += sh.nx * side * excess * 0.55;
        z += sh.nz * side * excess * 0.55;
      }
      // out of the mouth (a cast on the ground): a small blob at the lips growing as it drops to the ground. From
      // the air the jet is its own stream (below) and the wall starts where it lands, in step with the hits.
      const jk = jetLen > 0 ? 1 : ss(0, 2.2, s + 0.2);
      if (jk < 1) {
        const mx = mouth.x + sh.dx * s, my = mouth.y, mz = mouth.z + sh.dz * s;
        x = mx + (x - mx) * jk;
        y = my + (y - my) * jk;
        z = mz + (z - mz) * jk;
        r *= 0.35 + 0.65 * jk;
      }
      // it stays fire while it burns out (eroding away), the smoke is separate puffs above it
      const heat = (1 - 0.35 * Math.min(1, tau / W.time)) * (1 - la * 0.45);
      // speed stretch along the wave (the front's speed at this blob's age)
      const spd = tau < W.time ? (2 * W.length / W.time) * (1 - tau / W.time) : 0;
      B.set(b.i, x, y, z, r, heat, Math.min(1, la * 1.35), b.seed, 0, sh.dx, 0, sh.dz, 1 + Math.min(0.75, spd / 55));
      // dark smoke rolls off the top of the torrent
      if (s > 3 && b.shed > 0.8 && Math.random() < dt * (la > 0 ? 2.5 : 1.1)) this.smoke.puff(x, y + r * 0.7, z, (Math.random() - 0.5) * 1.2, 1.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2, 1.6 + Math.random() * 0.9, r * 0.7, r * 1.8, 0.45, 1);
      if (Math.random() < dt * 3.5 * this.quality()) g.fx.embers(x, y, z, 1, r, 2.5);
      f.blobs[w++] = b;
    }
    f.blobs.length = w;
    // the air cast's jet: a thick stream of fast blobs from the mouth down to where the wall starts
    if (jetLen > 0 && t >= 0 && t < exhale) {
      const jx = (sh.o[0] - mouth.x) / jetLen, jy = (sh.o[1] + 0.4 - mouth.y) / jetLen, jz = (sh.o[2] - mouth.z) / jetLen, sp = 42;
      for (let n = Math.round(dt * 90 * this.quality() + Math.random() * 0.8); n > 0; n--) {
        const k = Math.random() * 0.25;
        B.puff(mouth.x + jx * k, mouth.y + jy * k, mouth.z + jz * k, jx * sp + (Math.random() - 0.5) * 2, jy * sp, jz * sp + (Math.random() - 0.5) * 2, jetLen / sp, 0.3, 0.55 + jetLen * 0.06, 1.45, 0, 0);
      }
    }
    // walls: once the front reaches a lane's obstacle, a burst of fire climbs and spreads along it
    const front = fireFront(W, t);
    for (let k = 0; k < sh.lanes.length; k++) {
      const L = sh.lanes[k];
      if (!L.hit || f.splashed.has(k) || front < L.len) continue;
      f.splashed.add(k);
      const tx = -L.hit.nz, tz = L.hit.nx;
      for (let n = 0; n < 5; n++) {
        const side = n % 2 ? 1 : -1, sp = 3 + Math.random() * 4;
        B.puff(L.hit.x + L.hit.nx * 0.4, L.hit.y + 0.8 + Math.random() * 1.2, L.hit.z + L.hit.nz * 0.4, tx * side * sp + L.hit.nx * 1.5, 2 + Math.random() * 3, tz * side * sp + L.hit.nz * 1.5, 0.6 + Math.random() * 0.4, 0.7, 1.6, 1, 0, 2.5);
      }
      g.audio?.crackle?.({ x: L.hit.x, y: L.hit.y + 1, z: L.hit.z }, 5, 0.25);
    }
    // the burning field where the wall of fire comes to rest
    const fs = fieldStart(J), fe = fs + J.field.time;
    const env = t < fs ? 0 : t < fs + 0.25 ? (t - fs) / 0.25 : t > fe - 0.9 ? Math.max(0, (fe - t) / 0.9) : 1;
    if (t >= fs && t < fe) {
      if (!f.tongues) {
        f.tongues = this.tongues.take(Math.round(76 * this.quality()));
        f.tongueSpec = f.tongues.map(() => {
          const r = f.frng;
          return { s: sh.field.s0 + r() * (sh.field.s1 - sh.field.s0), u: (r() * 2 - 1) * J.field.w * 0.5, h: 0.45 + r() * 1.0, w: 0.55 + r() * 0.5, seed: r() };
        });
      }
      for (let k = 0; k < f.tongues.length; k++) {
        const T = f.tongueSpec[k];
        const half = fireWidth(W, T.s) * 0.5;
        fireLane(sh, T.u / half, T.s, _l);
        const x = sh.o[0] + sh.dx * T.s + sh.nx * T.u, z = sh.o[2] + sh.dz * T.s + sh.nz * T.u;
        const ok = T.s <= _l.len && Math.abs(T.u) <= half;
        const flick = 0.85 + 0.15 * Math.sin(this.time * 9 + T.seed * 50);
        this.tongues.set(f.tongues[k], x, _l.y - 0.05, z, ok ? T.h * env * flick : 0, T.w, T.seed);
        if (ok && Math.random() < dt * 0.25 * this.quality()) this.smoke.puff(x, _l.y + T.h * 0.9, z, 0, 1, 0, 1.6, 0.5, 1.3, 0.3, 1);
        if (ok && Math.random() < dt * 1.0 * this.quality()) g.fx.embers(x, _l.y + 0.4, z, 1, 0.4, 2);
      }
      if (Math.random() < dt * 1.5) g.audio?.crackle?.({ x: sh.o[0] + sh.dx * sh.field.s1, y: sh.o[1] + 1, z: sh.o[2] + sh.dz * sh.field.s1 }, 3, 0.12);
    } else if (f.tongues && t >= fe) {
      this.tongues.give(f.tongues);
      f.tongues = null;
    }
    // the footprint: glow under the fire, then scorch
    const fieldHalf = Math.min(1, (J.field.w * 0.5) / (fireWidth(W, sh.field.s1) * 0.5));
    f.decal.update(front, fireTail(J, t), t, _w.set(sh.field.s0, sh.field.s1, fieldHalf), env, this.time);
    // heat haze over the torrent's front and the field
    const hz = this.game.post.haze;
    if (t < W.time + exhale) {
      firePoint(sh, W, Math.max(0, front - 2.5), 0, _p);
      hz.add(_p.x, _p.y + 1.6, _p.z, fireWidth(W, front) * 0.6 + 1.5, 0.9);
    } else if (env > 0) {
      firePoint(sh, W, (sh.field.s0 + sh.field.s1) / 2, 0, _p);
      hz.add(_p.x, _p.y + 1.4, _p.z, 6, 0.7 * env);
    }
    // a rumble for whoever stands near the torrent
    if (t < W.time + exhale) {
      firePoint(sh, W, front, 0, _p);
      const me = g.player?.pos;
      if (me) g.cam.addTrauma(dt * 1.6 * clamp(1 - Math.hypot(me.x - _p.x, me.z - _p.z) / 14, 0, 1));
    }
    if (f.mine) this.fireHits(f, t);
    // done once the decal has faded (the scorch outlives the fire)
    return f.decal.busy || f.blobs.length > 0 || !!f.tongues;
  }

  /**
   * The caster's hits: a victim the torrent touches takes `ticks` flinch ticks every `tickEvery` frames, then the
   * last one knocks it back (each re-checks it is still inside: a substitution escapes). The field ticks on a fixed
   * schedule. `c` = the torrent's axis point behind the victim: the push follows the fire (gotcha 15).
   */
  fireHits(f, t) {
    const g = this.game, J = f.J, sh = f.shape, now = g.net.serverNow();
    const yaw = Math.atan2(-sh.dx, -sh.dz);
    for (const tg of g.combat.targets()) {
      if (!tg.hurt?.valid) continue;
      const inv = !tg.dummy && (tg.entry.react?.invuln?.(now) || (tg.entry.view?.flags ?? 0) & FLAG.invuln);
      let v = f.victims.get(tg.id);
      if (!v) {
        if (inv || !fireContains(sh, J, t, tg.x, tg.y, tg.z, 0.34)) continue;
        v = { k: 0, next: t };
        f.victims.set(tg.id, v);
      }
      while (v.k <= J.ticks && t >= v.next) {
        const h = fireContains(sh, J, t, tg.x, tg.y, tg.z, 0.34 + 0.9);
        if (!h || inv) {
          v.k = 99; // it got out (substitution, invulnerable): the sequence ends
          break;
        }
        const last = v.k === J.ticks, cs = Math.max(0, h.s - 1.2);
        const from = { x: sh.o[0] + sh.dx * cs, y: tg.y, z: sh.o[2] + sh.dz * cs, yaw };
        g.combat.landHit({ id: last ? 'fireAnnihilation:last' : 'fireAnnihilation:tick', inst: f.inst, k: v.k, from }, tg, new THREE.Vector3(tg.x, tg.y + 1.1, tg.z));
        v.k++;
        v.next += J.tickEvery * F;
      }
    }
    // the field: a tick for everyone standing in it, every `field.every` frames while it burns
    const fs = fieldStart(J);
    while (f.fieldTick * J.field.every * F <= J.field.time && t >= fs + f.fieldTick * J.field.every * F) {
      const j = f.fieldTick++;
      if (t - (fs + j * J.field.every * F) > 0.25) continue; // (a stalled frame skipped it: never send stale ticks)
      for (const tg of g.combat.targets()) {
        if (!tg.hurt?.valid) continue;
        if (!tg.dummy && (tg.entry.react?.invuln?.(now) || (tg.entry.view?.flags ?? 0) & FLAG.invuln)) continue;
        if (!fieldContains(sh, J, t, tg.x, tg.y, tg.z, 0.34)) continue;
        g.combat.landHit({ id: 'fireAnnihilation:field', inst: f.inst, k: 10 + j, from: { x: tg.x, y: tg.y, z: tg.z, yaw } }, tg, new THREE.Vector3(tg.x, tg.y + 0.6, tg.z));
      }
    }
  }

  /** Debug (scripts/test/madara.mjs): a torrent as this screen places it, and its front at server time T (ms). */
  debugFire(inst, T) {
    const f = this.fires.find((x) => x.inst === inst);
    if (!f) return null;
    const t = (T - f.at1) / 1000, o = {};
    firePoint(f.shape, f.W, fireFront(f.W, t), 0, o);
    return {
      at1: f.at1, o: f.shape.o, d: [f.shape.dx, f.shape.dz], lanes: f.shape.lanes.map((L) => +L.len.toFixed(3)), front: [o.x, o.y, o.z],
      tongues: f.tongues ? f.tongues.slice(0, 4).map((i) => [...this.tongues.aPos.array.slice(i * 4, i * 4 + 3)]) : null,
      decal: [...f.decal.pos.slice(0, 3), ...f.decal.pos.slice(-3)],
    };
  }

  // ---------------------------------------------------------------- wood: cast

  /** The palm hits the ground: place the stake line (rounded payload, as the server relays it) and tell everyone. */
  woodEmit(ctrl, a) {
    const g = this.game, b = ctrl.body, yaw = ctrl.yaw;
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const px = b.x + dx * 0.5, pz = b.z + dz * 0.5;
    const o = [px, g.world.ground(px, pz, b.y + 0.6, {}).y, pz].map(r3);
    const d = [dx, 0, dz].map(r3);
    const at1 = Math.round(g.net.serverNow());
    g.net.act('jutsu', { m: 'woodCutting', i: a.inst, n: 1, o, d, at: at1 });
    this.startWood({ owner: g.net.id, mine: true, inst: a.inst, at1, o, d, C: ctrl.C, fighter: g.player });
  }

  /** A stake line on this screen (ours or a remote's): its layout from the payload + seed, its visuals, (ours) hits. */
  startWood(e) {
    const g = this.game, J = e.C.jutsu.woodCutting;
    const line = stakeLine(g.world, J, e.o, e.d, e.inst);
    const L = this.stakes.take();
    const crack = this.cracks.find((c) => !c.busy) || this.cracks[0];
    crack.place(line, e.inst);
    L.mesh.count = line.stakes.length;
    L.mesh.visible = true;
    L.sphere.center.set(line.o[0] + line.dx * line.len * 0.5, line.o[1] + 1.2, line.o[2] + line.dz * line.len * 0.5);
    L.sphere.radius = line.len * 0.5 + 3;
    const w = { ...e, J, line, L, crack, skew0: this.skew, up: new Uint8Array(line.stakes.length), down: new Uint8Array(line.stakes.length), victims: new Set(), yaw: Math.atan2(-line.dx, -line.dz) };
    this.woods.push(w);
    // the slam: a thump, a shockwave of dust round the palm
    const p = { x: e.o[0], y: e.o[1], z: e.o[2] };
    g.fx.dust(p, 10, 1.6, [0.55, 0.45, 0.33]);
    g.fx.emit(4, p.x, p.y + 0.05, p.z, 0, 0, 0, 0.45, 0.2, 2.6, 0.75, 0.62, 0.46, 0.9);
    g.audio?.woodSlam?.(p);
    const near = this.nearness(e.o, 16);
    if (near > 0) g.cam.addTrauma(0.25 * near);
  }

  // ---------------------------------------------------------------- wood: every frame

  updateWood(w, dt) {
    const g = this.game, J = w.J, Ln = J.line, line = w.line, m = w.L ? w.L.mesh : null; // (null: the stakes are gone)
    const t = (this.now() + w.skew0 - w.at1) / 1000;
    const front = Math.min(line.len, Math.max(0, t * Ln.speed));
    const M = (this._m ||= new THREE.Matrix4()), Q = (this._q ||= new THREE.Quaternion()), E = (this._e ||= new THREE.Euler()), S = (this._s ||= new THREE.Vector3()), Pv = (this._pv ||= new THREE.Vector3());
    let standing = 0;
    for (let k = 0; k < line.stakes.length; k++) {
      const st = line.stakes[k];
      const te = t - st.t, ts = te - Ln.hold;
      let sc = 0, yoff = 0, jx = 0, jz = 0;
      if (te >= 0) {
        if (!w.up[k]) {
          w.up[k] = 1;
          // erupting: earth bursts round it, rocks and clods fly
          g.fx.dust({ x: st.x, y: st.y, z: st.z }, 3, 0.9, [0.5, 0.4, 0.3]);
          const n = Math.round((1 + Math.random() * 2) * this.quality());
          for (let q = 0; q < n; q++) {
            const a = Math.random() * 6.283, sp = 1.5 + Math.random() * 3;
            this.debris.throw(st.x, st.y + 0.15, st.z, Math.cos(a) * sp, 4 + Math.random() * 5, Math.sin(a) * sp, 0.05 + Math.random() * 0.1, Math.random() < 0.5 ? 0x5e4631 : 0x7a7064, 1.4 + Math.random());
          }
          if (k % 3 === 0) g.audio?.woodCrack?.({ x: st.x, y: st.y, z: st.z });
        }
        // scale 0 -> 1.1 -> 1 over ~6 frames (an overshoot: they punch up out of the ground)
        const x = Math.min(1, te / 0.1);
        sc = x >= 1 ? 1 : 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;
        if (ts > 0) {
          const kk = Math.min(1, ts / Ln.sink);
          if (!w.down[k]) {
            w.down[k] = 1;
            // splitting and crumbling as it sinks: splinters, a puff of dust
            for (let q = 0; q < 4; q++) {
              const a = Math.random() * 6.283, sp = 2 + Math.random() * 3;
              g.fx.emit(2, st.x, st.y + st.h * (0.3 + Math.random() * 0.6), st.z, Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp, 0.35 + Math.random() * 0.3, 0.05, 0.02, 0.8, 0.62, 0.4);
            }
            if (Math.random() < 0.5 * this.quality()) this.debris.throw(st.x, st.y + st.h * 0.6, st.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, st.r * 0.8, 0xc9a878, 1.2);
            g.fx.dust({ x: st.x, y: st.y, z: st.z }, 2, 0.7, [0.52, 0.42, 0.32]);
          }
          yoff = -st.h * 1.05 * kk ** 1.6;
          jx = (Math.random() - 0.5) * 0.04 * (1 - kk);
          jz = (Math.random() - 0.5) * 0.04 * (1 - kk);
          if (kk >= 1) sc = 0;
        }
      }
      if (sc > 0) standing++;
      // stand up out of the ground, lean forward along the line, a little sideways, turned about its own axis
      E.set((-st.pitch * Math.PI) / 180, w.yaw, (st.roll * Math.PI) / 180, 'YXZ');
      Q.setFromEuler(E);
      Q.multiply((this._q2 ||= new THREE.Quaternion()).setFromAxisAngle((this._up ||= new THREE.Vector3(0, 1, 0)), (st.twist * Math.PI) / 180));
      S.set(st.r * (0.55 + 0.45 * Math.min(1, sc)), st.h * sc + 1e-4, st.r * (0.55 + 0.45 * Math.min(1, sc)));
      if (!m) continue;
      M.compose(Pv.set(st.x + jx, st.y + yoff, st.z + jz), Q, S);
      m.setMatrixAt(k, M);
    }
    if (m) m.instanceMatrix.needsUpdate = true;
    // the crack races a little ahead of the stakes, then fades once they are gone
    const tEnd = line.len / Ln.speed + Ln.hold + Ln.sink;
    w.crack.mat.uniforms.uFront.value = Math.min(line.len, front + 1.2);
    w.crack.mat.uniforms.uFade.value = t < tEnd ? 1 : Math.max(0, 1 - (t - tEnd) / 2.5);
    // a rumble for whoever stands near the front while it runs
    if (t < line.len / Ln.speed) {
      const me = g.player?.pos;
      if (me) {
        const fx = line.o[0] + line.dx * front, fz = line.o[2] + line.dz * front;
        g.cam.addTrauma(dt * 1.4 * clamp(1 - Math.hypot(me.x - fx, me.z - fz) / 10, 0, 1));
      }
    }
    if (w.mine) this.woodHits(w, t);
    // the stakes are all down: their mesh goes back to the pool (the crack still fades)
    if (w.L && t > tEnd && standing === 0) {
      this.stakes.give(w.L);
      w.L = null;
    }
    if (t > tEnd + 2.5) {
      w.crack.mesh.visible = false;
      w.crack.busy = false;
      return false;
    }
    return true;
  }

  /** The caster's hits: one per victim, when the front passes it inside the line (a launch: a juggle starter). */
  woodHits(w, t) {
    const g = this.game, J = w.J, line = w.line, now = g.net.serverNow();
    for (const tg of g.combat.targets()) {
      if (w.victims.has(tg.id) || !tg.hurt?.valid) continue;
      if (!tg.dummy && (tg.entry.react?.invuln?.(now) || (tg.entry.view?.flags ?? 0) & FLAG.invuln)) continue;
      const h = woodContains(line, J, t, tg.x, tg.y, tg.z, 0.34);
      if (!h) continue;
      w.victims.add(tg.id);
      // c: the line just behind the victim (it's thrown up and along the line, away from Madara)
      const cs = Math.max(0, h.s - 0.8);
      const from = { x: line.o[0] + line.dx * cs, y: tg.y, z: line.o[2] + line.dz * cs, yaw: w.yaw };
      g.combat.landHit({ id: 'woodCutting:main', inst: w.inst, k: 0, from }, tg, new THREE.Vector3(tg.x, tg.y + 0.9, tg.z));
    }
  }

  /** Debug (scripts/test/madara.mjs): a stake line as this screen places it: layout + the first stakes' transforms. */
  debugWood(inst) {
    const w = this.woods.find((x) => x.inst === inst);
    if (!w) return null;
    const out = { at1: w.at1, o: w.line.o, len: +w.line.len.toFixed(3), n: w.line.stakes.length, stakes: w.line.stakes.slice(0, 6).map((s) => [s.x, s.y, s.z, s.h]) };
    if (w.L) {
      const M = new THREE.Matrix4(), p = new THREE.Vector3();
      out.drawn = [];
      for (let k = 0; k < Math.min(6, w.line.stakes.length); k++) {
        w.L.mesh.getMatrixAt(k, M);
        p.setFromMatrixPosition(M);
        out.drawn.push([p.x, p.y, p.z]);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- the meteor

  /** The release: where it lands (the target's spot, else where the camera points, else ahead), told to everyone. */
  meteorEmit(ctrl, a) {
    const g = this.game, b = ctrl.body, D = a.D, T = a.target;
    let px, py, pz;
    if (T && Math.hypot(T.x - b.x, T.z - b.z) <= D.range) {
      px = T.x;
      py = T.y;
      pz = T.z;
    } else {
      const cam = g.camera, dir = cam.getWorldDirection(_v), cp = cam.position, far = D.range + 20;
      const t = g.world.raycast(cp.x, cp.y, cp.z, dir.x, dir.y, dir.z, far);
      const hx = cp.x + dir.x * t, hz = cp.z + dir.z * t;
      if (t < far && Math.hypot(hx - b.x, hz - b.z) <= D.range) {
        px = hx;
        py = cp.y + dir.y * t;
        pz = hz;
      } else {
        px = b.x - Math.sin(ctrl.yaw) * 25;
        py = b.y;
        pz = b.z - Math.cos(ctrl.yaw) * 25;
      }
    }
    py = g.world.ground(px, pz, py + 2, {}).y;
    let dx = px - b.x, dz = pz - b.z;
    const l = Math.hypot(dx, dz);
    if (l < 1) {
      dx = -Math.sin(ctrl.yaw);
      dz = -Math.cos(ctrl.yaw);
    } else {
      dx /= l;
      dz /= l;
    }
    const o = [px, py, pz].map(r3), d = [dx, 0, dz].map(r3);
    const at1 = Math.round(g.net.serverNow());
    g.net.act('jutsu', { m: 'tengaiShinsei', i: a.inst, n: 1, o, d, at: at1 });
    this.startMeteor({ owner: g.net.id, mine: true, inst: a.inst, at1, o, d, C: ctrl.C, fighter: g.player });
  }

  /** A meteor on this screen (ours or a remote's): its path from the payload, the rock, the mark on the ground. */
  startMeteor(e) {
    const g = this.game, J = e.C.jutsu.tengaiShinsei;
    const sh = meteorShape(g.world, J, e.o, e.d);
    const R = this.rocks.find((x) => !x.busy) || this.rocks[0];
    const mark = this.marks.find((x) => !x.busy) || this.marks[0];
    R.busy = true;
    mark.place(sh.o[0], sh.o[1], sh.o[2], J.outer + 1.5, (x, z, y) => g.world.ground(x, z, y + 3, _gnd).y);
    const U = mark.mat.uniforms;
    U.uCore.value = J.core;
    U.uOuter.value = J.outer;
    U.uShadow.value = J.meteor.radius;
    U.uAge.value = -1;
    U.uFade.value = 1;
    const rng = mulberry32(e.inst * 31 + 5);
    const m = { ...e, J, sh, R, mark, skew0: this.skew, spin: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), landed: false, prev: null };
    this.meteors.push(m);
    g.audio?.meteorFall?.({ x: sh.o[0], y: sh.o[1], z: sh.o[2] }, J.delay);
  }

  updateMeteor(m, dt) {
    const g = this.game, J = m.J, sh = m.sh, R = m.R, rad = J.meteor.radius, q = this.quality();
    const t = (this.now() + m.skew0 - m.at1) / 1000;
    const U = m.mark.mat.uniforms;
    U.uTime.value = this.time;
    if (t < J.delay) {
      const k = clamp(t / J.delay, 0, 1);
      const c = meteorAt(sh, J, Math.max(0, t), _p);
      R.rock.visible = true;
      R.rock.position.set(c.x, c.y, c.z);
      R.rock.scale.setScalar(rad);
      R.rock.quaternion.setFromAxisAngle(m.spin, t * 0.8);
      R.shellMat.uniforms.uDir.value.fromArray(sh.dir);
      R.shellMat.uniforms.uHeat.value = 0.4 + 0.6 * k;
      R.shellMat.uniforms.uTime.value = this.time;
      R.sphere.center.set(c.x, c.y, c.z);
      R.sphere.radius = rad * 1.25;
      // the trail: fire boiling off the leading face, black smoke streaming behind (left in the air as it moves on)
      const vx = m.prev ? (c.x - m.prev[0]) / Math.max(dt, 1e-3) : 0, vy = m.prev ? (c.y - m.prev[1]) / Math.max(dt, 1e-3) : 0, vz = m.prev ? (c.z - m.prev[2]) / Math.max(dt, 1e-3) : 0;
      m.prev = [c.x, c.y, c.z];
      const [fx, fy, fz] = sh.dir;
      // (flames lick round the silhouette from the leading edge: the rock itself stays in view)
      for (let n = Math.round(dt * 30 * q + Math.random() * 0.8); n > 0; n--) {
        const a = Math.random() * 6.283, ux = Math.abs(fy) < 0.9 ? 0 : 1, uy = 1 - ux;
        // a unit vector across the fall (u) and its partner (w = dir x u)
        const cu = fy * 0 + ux, ex = cu - fx * (fx * ux + fy * uy), ey = uy - fy * (fx * ux + fy * uy), ez = -fz * (fx * ux + fy * uy), el = Math.hypot(ex, ey, ez);
        const Ux = ex / el, Uy = ey / el, Uz = ez / el, Wx = fy * Uz - fz * Uy, Wy = fz * Ux - fx * Uz, Wz = fx * Uy - fy * Ux;
        const s = rad * 0.95, k2 = Math.random() * 0.5;
        const px = c.x + (Ux * Math.cos(a) + Wx * Math.sin(a)) * s + fx * rad * (0.4 - k2), py = c.y + (Uy * Math.cos(a) + Wy * Math.sin(a)) * s + fy * rad * (0.4 - k2), pz = c.z + (Uz * Math.cos(a) + Wz * Math.sin(a)) * s + fz * rad * (0.4 - k2);
        this.billows.puff(px, py, pz, vx * 0.55, vy * 0.55, vz * 0.55, 0.25 + Math.random() * 0.2, rad * 0.12, rad * 0.3, 1, 0, 1);
      }
      for (let n = Math.round(dt * 20 * q + Math.random() * 0.8); n > 0; n--) {
        const rx = (Math.random() - 0.5) * 1.6, ry = (Math.random() - 0.5) * 1.6, rz = (Math.random() - 0.5) * 1.6;
        this.smoke.puff(c.x + (-fx * 0.6 + rx) * rad, c.y + (-fy * 0.6 + ry) * rad, c.z + (-fz * 0.6 + rz) * rad, vx * 0.04, vy * 0.04, vz * 0.04, 2.6 + Math.random() * 1.2, rad * 0.5, rad * 1.1, 0.35, 1, 0.6);
      }
      if (Math.random() < dt * 12 * q) g.fx.embers(c.x, c.y, c.z, 2, rad, 2);
      U.uK.value = k;
      // the ground trembles and the light dims as it comes
      const near = this.nearness(sh.o, 45);
      if (near > 0) {
        g.cam.addTrauma(dt * 1.1 * near * k * k);
        g.post.grade.bright -= 0.06 * near * k;
      }
      return true;
    }
    if (!m.landed) {
      m.landed = true;
      R.rock.visible = false;
      R.busy = false;
      this.meteorLand(m, t - J.delay);
    }
    // the crater: the cracks glow and cool, the scorch fades after ~8 s
    const age = t - J.delay;
    U.uAge.value = age;
    U.uFade.value = 1 - ss(6, 9, age);
    if (age < 4) this.game.post.haze.add(sh.o[0], sh.o[1] + 1.2, sh.o[2], J.core * 1.5, 0.9 * Math.exp(-age * 0.6));
    if (age < 3 && Math.random() < dt * 6 * q) this.smoke.puff(sh.o[0] + (Math.random() - 0.5) * J.core * 1.5, sh.o[1] + 0.5, sh.o[2] + (Math.random() - 0.5) * J.core * 1.5, 0, 1.5, 0, 2.5, 0.8, 2.2, 0.4, 1, 0.8);
    if (age < 9) return true;
    m.mark.mesh.visible = false;
    m.mark.busy = false;
    return false;
  }

  /** The impact: a fireball rolling out along the ground, a smoke column, rocks flying, the shockwave. */
  meteorLand(m, late) {
    const g = this.game, J = m.J, o = m.sh.o, q = this.quality(), P = { x: o[0], y: o[1], z: o[2] };
    if (late > 1) return; // (heard of it long after: only the crater)
    // (tuned at a 10 m ring and a 5 m rock; the smoke grows slower than the fire: the fireball stays the main event,
    // and the blended column's overdraw stays near what it was)
    const S = J.outer / 10, K = J.meteor.radius / 5, KS = Math.sqrt(K);
    // the fireball rolls out to the ring's edge: blob speed and life scale with S, blob size with K
    for (let k = 0; k < Math.round(52 * q); k++) {
      const a = Math.random() * 6.283, sp = (9 + Math.random() * 16) * S;
      this.billows.puff(o[0] + Math.cos(a) * 1.5 * K, o[1] + 0.5 + Math.random() * 2 * K, o[2] + Math.sin(a) * 1.5 * K, Math.cos(a) * sp, 1 + Math.random() * 5, Math.sin(a) * sp, 0.9 + Math.random() * 0.6, 1.2 * K, (3 + Math.random() * 1.5) * K, 1, 0, 2.5);
    }
    for (let k = 0; k < Math.round(14 * q); k++) {
      this.billows.puff(o[0] + (Math.random() - 0.5) * 4 * K, o[1] + 1 + Math.random() * 3 * K, o[2] + (Math.random() - 0.5) * 4 * K, (Math.random() - 0.5) * 6, 4 + Math.random() * 6, (Math.random() - 0.5) * 6, 1.2 + Math.random() * 0.6, 2.5 * K, 5 * K, 1, 0, 1.5);
    }
    for (let k = 0; k < Math.round(24 * q); k++) {
      this.smoke.puff(o[0] + (Math.random() - 0.5) * 8 * S, o[1] + 1 + Math.random() * 4 * K, o[2] + (Math.random() - 0.5) * 8 * S, (Math.random() - 0.5) * 3, 5 + Math.random() * 7, (Math.random() - 0.5) * 3, 3.5 + Math.random() * 1.5, 2.5 * KS, 6.5 * KS, 0.5, 1, 0.8);
    }
    for (let k = 0; k < Math.round(34 * q); k++) {
      const a = Math.random() * 6.283, sp = (8 + Math.random() * 10) * S;
      this.debris.throw(o[0] + Math.cos(a) * K, o[1] + 1, o[2] + Math.sin(a) * K, Math.cos(a) * sp, 8 + Math.random() * 10, Math.sin(a) * sp, (0.25 + Math.random() * 0.7) * Math.sqrt(K), Math.random() < 0.6 ? 0x3b3230 : 0x5e4631, 3 + Math.random() * 2);
    }
    g.fx.dust(P, 30, 7 * S, [0.55, 0.45, 0.35]);
    g.fx.ripple(P, 14 * S);
    g.fx.impact({ x: o[0], y: o[1] + 2 * K, z: o[2] }, Math.min(5, 4 * K), [3.5, 1.6, 0.4]);
    g.audio?.meteorImpact?.(P);
    const near = this.nearness(o, 70);
    if (near > 0) g.cam.addTrauma(Math.pow(near, 0.7));
    this.fireFlash = Math.max(this.fireFlash || 0, near * 2);
  }

  killMeteor(m) {
    m.R.rock.visible = false;
    m.R.busy = false;
    m.mark.mesh.visible = false;
    m.mark.busy = false;
    m.dead = true;
  }

  /** Debug (scripts/test/madara.mjs): a meteor as this screen has it: its path, and the rock at server time T. */
  debugMeteor(inst, T) {
    const m = this.meteors.find((x) => x.inst === inst);
    if (!m) return null;
    const c = meteorAt(m.sh, m.J, (T - m.at1) / 1000, {});
    return { at1: m.at1, o: m.sh.o, start: m.sh.start, rock: [c.x, c.y, c.z], drawn: m.R.rock.visible ? m.R.rock.position.toArray() : null };
  }

  // ---------------------------------------------------------------- Uchiha Return

  /**
   * The attacker's side: is this remote (entry `e`) inside its wind barrier at `at`? Then the hit is sent but not
   * predicted (the server answers it; a flinch shown now would be undone). Every class of hit counts.
   */
  countering(e, at, spec, inst) {
    if (inst !== undefined && (this.deflected.get(inst) || 0) > performance.now()) return true;
    const c = e?.counter;
    return !!(c && spec && COUNTER_KIND[spec.cls] && at >= c.w[0] && at <= c.w[1]);
  }

  /** Our own barrier answered a hit (the server's phase n:1, sent to us too). */
  onOwn(m) {
    if (m.m !== 'uchihaReturn' || m.n !== 1) return;
    this.queueCounter(this.game.player, m, this.game.ctrl.C);
  }

  /** An answer's effects when it leaves the shell (a message that comes later plays them at once). */
  queueCounter(fighter, m, C) {
    const D = C.jutsu.uchihaReturn;
    this.counterFx.push({ fighter, m, due: m.at + D.answer * F * 1000, R: D.radius });
    // a shadow clone that struck the barrier is dispelled (its caster's copies stop hitting)
    if (m.cl) {
      let best = null, bd = 3;
      for (const c of this.J.clones) {
        const d = c.gone || c.owner !== m.tg ? Infinity : Math.hypot(c.x - m.o[0], c.z - m.o[2]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best) this.J.poofClone(best);
    }
  }

  /** The fan's face in the world (the middle of the paddle), else in front of the chest. */
  fanPoint(fighter, out) {
    const G = this.gunbaiOf.get(fighter);
    if (G?.fighter === fighter && G.w > 0.5) return G.point(0, 0.4, 0, out);
    return fighter ? out.set(fighter.pos.x - Math.sin(fighter.yaw) * 0.5, fighter.pos.y + 1.2, fighter.pos.z - Math.cos(fighter.yaw) * 0.5) : null;
  }

  playCounter(e) {
    const g = this.game, m = e.m, f = e.fighter;
    if (!f) return;
    // where it struck: on the wind shell, toward the threat
    const c = _p2.set(f.pos.x, f.pos.y + 1.1, f.pos.z);
    let dx = m.o[0] - c.x, dy = clamp(m.o[1] + 1 - c.y, -0.6, 0.6), dz = m.o[2] - c.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    const p = new THREE.Vector3(c.x + dx * e.R * 0.95, c.y + dy * e.R * 0.6, c.z + dz * e.R * 0.95);
    this.uchiha.get(f)?.B?.hit(dx, dy, dz);
    const near = this.nearness([p.x, p.y, p.z], 20), q = this.quality();
    // every answer: a white flash on the shell, sparks, a clang off the wind
    g.fx.block(p);
    g.fx.impact(p, 1.4, [2.2, 2.6, 3.2]);
    g.fx.emit(4, f.pos.x, f.pos.y + 0.05, f.pos.z, 0, 0, 0, 0.35, 0.4, e.R * 1.4, 1.2, 1.35, 1.5, 0.8);
    g.audio?.gunbaiClang?.(p, m.f);
    if (m.f === 1) {
      // the blow: a blast of wind off the shell at him
      for (let k = 0; k < Math.round(28 * q); k++) {
        const s = 9 + Math.random() * 11, sx = (Math.random() - 0.5) * 0.9, sy = (Math.random() - 0.3) * 0.5;
        g.fx.emit(2, p.x + (Math.random() - 0.5) * 0.6, p.y - 0.4 + Math.random() * 0.9, p.z + (Math.random() - 0.5) * 0.6, (dx + dz * sx) * s, sy * s, (dz - dx * sx) * s, 0.25 + Math.random() * 0.2, 0.09, 0.02, 1.5, 1.6, 1.7, 0.7);
      }
      for (let k = 0; k < 4; k++) g.fx.emit(0, p.x + dx * k * 0.5, p.y - 0.2, p.z + dz * k * 0.5, dx * 4, 0.3, dz * 4, 0.4, 0.3, 0.9, 0.92, 0.95, 1, 0.6);
      if (near > 0) g.cam.addTrauma(0.35 * near);
    } else if (m.f === 2) {
      // the reflection: the shuriken flies back to its thrower, arriving when the server's hit lands
      const mesh = this.J.shuriken.find((x) => !x.visible);
      if (mesh && m.e) {
        mesh.visible = true;
        this.reflects.push({ mesh, from: p.clone(), tg: m.tg, t0: e.due, t1: m.e, pos: p.clone() });
      }
      if (near > 0) g.cam.addTrauma(0.15 * near);
    } else {
      // deflected (an ultimate, a torrent, stakes, a meteor): the wind throws it aside in a fan of streaks
      for (let k = 0; k < Math.round(34 * q); k++) {
        const a = Math.random() * 6.283, b = (Math.random() - 0.3) * 1.6, s = 6 + Math.random() * 8;
        let vx = Math.cos(a) * Math.cos(b), vz = Math.sin(a) * Math.cos(b);
        if (vx * dx + vz * dz < 0) {
          vx = -vx;
          vz = -vz;
        }
        g.fx.emit(2, p.x, p.y, p.z, vx * s, Math.sin(b) * s, vz * s, 0.3 + Math.random() * 0.25, 0.09, 0.02, 1.5, 1.8, 2.2);
      }
      g.fx.emit(5, p.x, p.y, p.z, 0, 0, 0, 0.14, 0.5, 1.6, 1.6, 1.8, 2.2);
      if (near > 0) g.cam.addTrauma(0.4 * near);
    }
  }

  updateCounters(dt) {
    const g = this.game, now = this.now();
    let w = 0;
    for (const e of this.counterFx) {
      if (now >= e.due) this.playCounter(e);
      else this.counterFx[w++] = e;
    }
    this.counterFx.length = w;
    // reflected shuriken: from the shell to the thrower's drawn chest, on the server's schedule
    w = 0;
    for (const r of this.reflects) {
      const k = clamp((now - r.t0) / Math.max(1, r.t1 - r.t0), 0, 1);
      const tp = this.J.targetPos(r.tg, _w) || r.pos;
      const prev = _v.copy(r.pos);
      r.pos.copy(r.from).lerp(tp, k);
      r.mesh.position.copy(r.pos);
      r.mesh.rotation.y -= dt * 45;
      if (Math.random() < 0.8) g.fx.emit(2, r.pos.x, r.pos.y, r.pos.z, (prev.x - r.pos.x) * 3, (prev.y - r.pos.y) * 3, (prev.z - r.pos.z) * 3, 0.14, 0.035, 0.01, 2.2, 0.6, 0.5);
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      this.reflects[w++] = r;
    }
    this.reflects.length = w;
  }

  /** Moving shadow casters of the kit this frame (main.js shadowCasters). */
  casters(add) {
    for (const w of this.woods) if (w.L && w.L.mesh.visible) add(w.L.mesh, w.L.sphere.center.x, w.L.sphere.center.y, w.L.sphere.center.z, w.L.sphere.radius);
    for (const m of this.meteors) if (!m.landed && m.R.rock.visible) add(m.R.rock, m.R.sphere.center.x, m.R.sphere.center.y, m.R.sphere.center.z, m.R.sphere.radius);
  }

  /**
   * The server refused one of our casts (its cooldown / gauge disagrees): the cast never happened for anyone else,
   * so it doesn't here either (the action stops, an effect already placed is taken back).
   */
  onDeny(m) {
    if (m.k !== 'jutsu' || !MADARA_CASTS[m.m]) return;
    const g = this.game, a = g.ctrl?.action;
    if (a && a.inst === m.i && a.K === this) g.ctrl.action = null;
    for (const f of this.fires) if (f.mine && f.inst === m.i) this.killFire(f);
    for (const w of this.woods) if (w.mine && w.inst === m.i) this.killWood(w);
    for (const x of this.meteors) if (x.mine && x.inst === m.i) this.killMeteor(x);
  }

  killWood(w) {
    if (w.L) this.stakes.give(w.L);
    w.L = null;
    w.crack.mesh.visible = false;
    w.crack.busy = false;
    w.dead = true;
  }

  /** Removes a torrent at once (blobs, field flames, footprint). */
  killFire(f) {
    for (const b of f.blobs) this.billows.give(b.i);
    f.blobs.length = 0;
    if (f.tongues) this.tongues.give(f.tongues);
    f.tongues = null;
    f.decal.mesh.visible = false;
    f.decal.busy = false;
    f.victims.clear();
    f.dead = true;
  }

  // ---------------------------------------------------------------- remote casts

  /** A relayed cast / event of Madara's kit on someone else's fighter. Returns true when handled. */
  onRemote(m, r) {
    if (!MADARA_CASTS[m.m]) return false;
    const g = this.game, C = charOf(r.info.ch);
    if (m.m === 'fireAnnihilation') {
      const D = C.jutsu.fireAnnihilation;
      if (!m.n) r.act = { clip: m.f ? 'mad_fire_air' : 'mad_fire', sv: true, at: m.at, key: `mfire${m.i}`, dur: D.total * F, pause: 0 };
      else if (m.n === 1 && m.o && m.d) this.startFire({ owner: m.id, mine: false, inst: m.i, at1: m.at, o: m.o, d: m.d, C, fighter: r.fighter });
      if (!m.n) g.audio?.handsign?.(r.fighter?.pos);
    } else if (m.m === 'woodCutting') {
      const D = C.jutsu.woodCutting;
      // cast on the ground: the whole clip from the press; from the air: the dive until the slam (n:1) restarts it
      if (!m.n) r.act = m.f ? { clip: 'mad_wood_dive', sv: true, at: m.at, key: `mwood${m.i}d`, dur: D.dive.max, pause: 0 } : { clip: 'mad_wood', sv: true, at: m.at, key: `mwood${m.i}`, dur: D.total * F, pause: 0 };
      else if (m.n === 1 && m.o && m.d) {
        if (r.act?.clip === 'mad_wood_dive') r.act = { clip: 'mad_wood', sv: true, at: m.at - D.slam * F * 1000, key: `mwood${m.i}`, dur: D.total * F, pause: 0 };
        this.startWood({ owner: m.id, mine: false, inst: m.i, at1: m.at, o: m.o, d: m.d, C, fighter: r.fighter });
      }
    } else if (m.m === 'tengaiShinsei') {
      const D = C.jutsu.tengaiShinsei;
      if (!m.n) {
        r.act = { clip: m.f ? 'mad_meteor_air' : 'mad_meteor', sv: true, at: m.at, key: `mmet${m.i}`, dur: D.total * F, pause: 0 };
        g.audio?.ult?.(r.fighter?.pos);
      } else if (m.n === 1 && m.o && m.d) this.startMeteor({ owner: m.id, mine: false, inst: m.i, at1: m.at, o: m.o, d: m.d, C, fighter: r.fighter });
    } else if (m.m === 'uchihaReturn') {
      const D = C.jutsu.uchihaReturn;
      if (!m.n) {
        // the barrier (the attacker's screen reads its window: countering(), no prediction on it)
        r.counter = { i: m.i, w: counterWindow(D, m.at) };
        r.act = { clip: m.f ? 'mad_counter_air' : 'mad_counter', sv: true, at: m.at, key: `mctr${m.i}`, dur: D.total * F, pause: 0 };
        g.audio?.gunbaiUp?.(r.fighter?.pos);
      } else if (m.n === 1 && m.o) {
        // an answer: effects only, the clip plays on. Ours was deflected: its later hits won't land either (server)
        if (m.tg === g.net.id && m.ai !== undefined) this.deflected.set(m.ai, performance.now() + 3000);
        this.queueCounter(r.fighter, m, C);
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- Uchiha Return on screen

  /** Debug: where the gunbai rides (GUNBAI.back: { p, up, face }) and where the fist holds it (grip, m). */
  debugGunbai(back, grip) {
    if (back) gunbaiBack({ ...GUNBAI.back, ...back });
    if (grip !== undefined) GUNBAI.grip = grip;
    return { back: GUNBAI.back, grip: GUNBAI.grip };
  }

  /**
   * Every Madara on screen, every frame, from the clip he is drawn in and its time (v.act: identical on every
   * screen): the gunbai (on his back; in his fist from the grab to the release), the fan's wind trail through the
   * draw, the spin and the return, the barrier (swirl, shell, the gust's wave and the pulses after it), the wind
   * round his feet, the sounds. A cast cut short (a hit before the barrier rose) puts the fan back in a puff.
   */
  updateUchiha(dt) {
    const g = this.game, seen = (this._seen ||= new Set()), q = this.quality();
    seen.clear();
    const each = (f, C, local) => {
      if (!f || !C?.jutsu.uchihaReturn || this.game.gunbaiTex === undefined) return;
      seen.add(f);
      const D = C.jutsu.uchihaReturn;
      let G = this.gunbaiOf.get(f);
      if (!G) this.gunbaiOf.set(f, (G = new Gunbai(this.gunbaiMat)));
      G.attach(f);
      const act = f.view?.act, on = !f.dead && !!act && COUNTER_CLIPS.has(act.clip);
      const fr = on ? act.t * 60 : -1;
      let S = this.uchiha.get(f);
      if (on && (!S || S.key !== act.key)) {
        if (!S) this.uchiha.set(f, (S = { B: null, T: null, key: '', last: -1, amt: 0, grow: 0.5, seed: 0 }));
        S.key = act.key;
        S.last = -1;
        S.seed = Math.random() * 10;
      }
      // the fan: in the hand from the grab to the release; the fist holds it just as it rides on his back at both
      // (madaramoves.js), so the hand-over is short and centred on the frame the hand closes / opens
      let w = 0;
      if (on) w = ss(D.grab - 1, D.grab + 1, fr) * (1 - ss(D.release - 3, D.release, fr));
      else if (G.w > 0.05) {
        // cut short with the fan out: it goes back in a puff of smoke
        g.fx.poof(G.point(0, 0, 0, _v).setY(_v.y - 0.8), 0.45);
        g.audio?.poof?.(_v);
      }
      if (local && this.forceGunbai !== null) w = this.forceGunbai;
      G.place(w);
      if (!S) return;
      // the barrier's strength and size over the cast: a small swirl round his feet through the draw, full at the
      // gust (with an overshoot), held to the end of the window, then it spreads out and fades
      let amt = 0, grow = 1, shell = 0;
      if (on) {
        amt = fr < D.spinFrom ? 0.35 * ss(0, D.spinFrom, fr) : fr < D.barrier ? 0.35 + 0.65 * ss(D.spinFrom, D.gustAt, fr) : 1 - ss(D.barrier, D.release + 2, fr);
        grow = fr < D.gustAt ? 0.5 + 0.5 * ss(0, D.gustAt, fr) + 0.12 * ss(D.spinFrom, D.gustAt, fr) : 1.12 - 0.12 * ss(D.gustAt, D.gustAt + 10, fr) + 0.3 * ss(D.barrier, D.release + 2, fr);
        shell = ss(D.gustAt - 2, D.gustAt + 4, fr);
        S.amt = amt;
        S.grow = grow;
      } else {
        // cut short (or the clip ended): whatever is left spreads out and fades fast
        S.amt = amt = Math.max(0, S.amt - dt * 5);
        S.grow = grow = S.grow + dt * 1.5;
        shell = 1;
      }
      // the wave: the gust's burst, then a small pulse every half second while the barrier holds
      let wave = null;
      const R = D.radius;
      if (on && fr >= D.gustAt && fr < D.gustAt + 21) {
        const k = (fr - D.gustAt) / 21;
        wave = { k, amt: 1, r: 0.6 + (D.gust.radius + 0.3) * (1 - (1 - k) ** 2.2), h: 2.3 - k * 0.5, seed: S.seed };
      } else if (on && fr >= D.gustAt + 16 && fr < D.barrier) {
        const k = ((fr - D.gustAt - 16) % 30) / 24;
        if (k < 1) wave = { k, amt: 0.5, r: R * 0.55 + R * 0.9 * (1 - (1 - k) ** 2), h: 2.0, seed: S.seed + Math.floor((fr - D.gustAt - 16) / 30) };
      }
      const live = amt > 0.005 || wave;
      if (live && !S.B) S.B = this.barriers.find((b) => !b.owner);
      if (S.B) {
        S.B.owner = f;
        S.B.update(f.pos, { t: this.time + S.seed, amt, grow, R, shell, wave }, dt);
        if (!live) {
          S.B.release();
          S.B = null;
        }
      }
      // the fan's wind trail (the middle of the paddle to its top) while it sweeps
      const sweep = on && ((fr >= D.grab + 2 && fr < D.spinTo + 2) || (fr >= D.barrier && fr < D.release));
      if (sweep && !S.T) {
        S.T = this.fanTrails.find((T) => !T.owner);
        if (S.T) S.T.owner = f;
      }
      if (S.T) {
        if (sweep) S.T.push(G.point(0, 0.3, 0, _v), G.point(0, 0.78, 0, _w), this.time);
        if (!S.T.update(this.time) && !sweep) {
          S.T.owner = null;
          S.T = null;
        }
      }
      // events on the clip's frames (each once per cast; a late start fires what it skipped)
      const hit = (x) => S.last < x && fr >= x;
      if (on) {
        if (hit(D.grab)) g.audio?.gunbaiDraw?.(f.pos);
        if (hit(D.spinFrom)) g.audio?.whoosh?.(2, f.pos);
        if (hit(D.gustAt)) this.gustFx(f, D, q);
        if (hit(D.barrier + 4)) g.audio?.whoosh?.(1, f.pos);
        if (hit(D.release)) g.audio?.gunbaiUp?.(f.pos);
        S.last = fr;
      }
      // the wind round him while it holds: dust and grass torn up at his feet, streaks racing round
      if (amt > 0.3) this.windFx(f, amt * grow * R, amt, q, dt);
      g.audio?.gunbaiWind?.(`gunbai${f.id}`, amt > 0.3, f.pos);
      if (!on && amt <= 0.005 && !S.B && !S.T) this.uchiha.delete(f);
      // (a strong local barrier also bends the air: the heat-haze pass, High/Ultra)
      if (amt > 0.3 && g.post.hazeOn) g.post.haze.add(f.pos.x, f.pos.y + 1.1, f.pos.z, R * 1.7 * grow, 0.25 * amt);
    };
    each(g.player, g.ctrl?.C, true);
    for (const r of g.remotes.values()) each(r.fighter, charOf(r.info.ch), false);
    // a fighter that left gives its fan and effects back
    for (const [f, G] of this.gunbaiOf) {
      if (seen.has(f)) continue;
      G.detach();
      this.gunbaiOf.delete(f);
      const S = this.uchiha.get(f);
      if (S?.B) S.B.release();
      if (S?.T) S.T.owner = null;
      this.uchiha.delete(f);
    }
  }

  /** The gust bursts out of the spin: a ring of dust racing out, a flash of wind, a shake up close. */
  gustFx(f, D, q) {
    const g = this.game, p = f.pos, gy = g.world.ground(p.x, p.z, p.y + 0.3, _gnd).y, onGround = p.y - gy < 0.8;
    const n = Math.round(22 * q);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283 + Math.random() * 0.2, s = 7 + Math.random() * 4;
      if (onGround) g.fx.emit(3, p.x + Math.cos(a) * 0.6, gy + 0.1, p.z + Math.sin(a) * 0.6, Math.cos(a) * s, 0.4 + Math.random() * 0.8, Math.sin(a) * s, 0.4 + Math.random() * 0.2, 0.12, 0.42, 0.6, 0.53, 0.43, 0.5);
      g.fx.emit(2, p.x + Math.cos(a) * 0.8, p.y + 0.3 + Math.random() * 1.6, p.z + Math.sin(a) * 0.8, Math.cos(a) * s * 1.6, 0.5, Math.sin(a) * s * 1.6, 0.22 + Math.random() * 0.12, 0.08, 0.02, 1.4, 1.55, 1.7, 0.8);
    }
    if (onGround) g.fx.emit(4, p.x, gy + 0.04, p.z, 0, 0, 0, 0.45, 0.6, (D.gust.radius + 0.5) * 1.2, 1.15, 1.25, 1.35, 0.9);
    g.fx.emit(5, p.x, p.y + 1.1, p.z, 0, 0, 0, 0.1, 0.5, 1.3, 1.0, 1.2, 1.4, 0.35);
    g.audio?.gunbaiGust?.(p);
    const near = this.nearness([p.x, p.y, p.z], 18);
    if (near > 0) g.cam.addTrauma(0.3 * near);
  }

  /** The wind holding round him (per frame, scaled by the preset): dust and bits of grass whirled up at his feet. */
  windFx(f, r, amt, q, dt) {
    const g = this.game, p = f.pos, fx = g.fx;
    const gy = g.world.ground(p.x, p.z, p.y + 0.3, _gnd).y, onGround = p.y - gy < 0.8;
    const rate = 22 * q * amt * dt;
    for (let n = Math.floor(rate + Math.random()); n > 0; n--) {
      const a = Math.random() * 6.283, rr = r * (0.75 + Math.random() * 0.35), s = 7 + Math.random() * 5;
      // (a left turn: the tangent of a falling angle)
      const tx = Math.sin(a), tz = -Math.cos(a);
      const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
      if (onGround) {
        const leaf = Math.random() < 0.35;
        fx.emit(3, x, gy + 0.08, z, tx * s * 0.5 - Math.cos(a), 0.8 + Math.random() * 1.2, tz * s * 0.5 - Math.sin(a), 0.5 + Math.random() * 0.3, leaf ? 0.04 : 0.08, leaf ? 0.06 : 0.26, leaf ? 0.3 : 0.6, leaf ? 0.55 : 0.53, leaf ? 0.18 : 0.43, 0.5);
      }
    }
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    this.time += dt;
    const pn = performance.now(), real = this.lastPn ? (pn - this.lastPn) / 1000 : dt;
    this.lastPn = pn;
    if (this.game.timeScale !== 1) this.skew += Math.max(0, real - dt) * 1000;
    let w = 0;
    for (const f of this.fires) if (!f.dead && this.updateFire(f, dt)) this.fires[w++] = f;
    this.fires.length = w;
    w = 0;
    for (const x of this.woods) if (!x.dead && this.updateWood(x, dt)) this.woods[w++] = x;
    this.woods.length = w;
    w = 0;
    for (const x of this.meteors) if (!x.dead && this.updateMeteor(x, dt)) this.meteors[w++] = x;
    this.meteors.length = w;
    this.debris.update(dt, this.game.world);
    // the heat flash of a torrent near you (an exposure kick that settles)
    if (this.fireFlash > 0) {
      this.game.post.grade.bright += this.fireFlash * 0.07;
      this.fireFlash = Math.max(0, this.fireFlash - dt * 1.6);
    }
    this.updateCounters(dt);
    this.updateUchiha(dt);
    this.billows.update(dt, this.game.sky?.sun?.position);
    this.smoke.update(dt, this.game.sky?.sun?.position);
    this.tongues.update(this.time);
  }
}
