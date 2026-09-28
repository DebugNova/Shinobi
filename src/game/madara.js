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
import { r3, fireShape, fireFront, fireTail, fireWidth, fireLane, firePoint, fireContains, fieldContains, fieldStart, stakeLine, woodContains } from '../shared/madarakit.js';
import { Billows, WaveDecal, FieldFlames, Stakes, CrackDecal, Debris, Gunbai } from '../gfx/madarafx.js';
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
const COUNTER_CLIPS = new Set(['mad_counter', 'mad_counter_air', 'mad_counter_swing', 'mad_block']);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _p = {}, _l = {};

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

// jutsu id -> { ok(J, ctrl), start(J, ctrl) } (merged into jutsu.js's registry)
export const MADARA_CASTS = {
  fireAnnihilation: { ok: () => true, start: (J, ctrl) => new FireAction(J.madara, ctrl) },
  woodCutting: { ok: () => true, start: (J, ctrl) => new WoodAction(J.madara, ctrl) },
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
    // the gunbai: one per fighter that holds it (a pool: a full room of Madaras)
    this.gunbaiPool = Array.from({ length: 7 }, () => new Gunbai(s, toon));
    this.gunbaiOf = new Map(); // fighter -> Gunbai
    this.forceGunbai = false; // debug: hold it in the local fighter's hand whatever the clip
    this.skew = 0; // ms the effects' clock runs behind the server's (debug slow motion only)
    this.time = 0;
  }

  /** Every object whose program must compile behind the loading screen (main.js warmShaders). */
  warmObjects() {
    return [this.billows.mesh, this.smoke.mesh, ...this.decals.map((d) => d.mesh), this.tongues.mesh, ...this.stakes.lines.map((L) => L.mesh), ...this.cracks.map((c) => c.mesh), this.debris.mesh, this.gunbaiPool[0].group, this.gunbaiPool[0].chain];
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
      const G = this.gunbaiPool[0];
      this.game.scene.add(G.group);
      G.group.position.set(p.x, p.y, p.z);
      G.group.visible = G.chain.visible = true;
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
      const G = this.gunbaiPool[0];
      G.group.removeFromParent();
      G.group.position.set(0, 0, 0);
      G.group.visible = G.chain.visible = false;
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
      skew0: this.skew, rate: 220 * q, born: 0, blobs: [], victims: new Map(), fieldTick: 0, splashed: new Set(), tongues: null, roar: false, t: 0,
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
      firePoint(sh, W, s, b.f * (0.25 + 0.75 * ss(0, 5, s)), _p);
      // blobs swell as they roll (a wall ~2.5-3 m tall at the end), stacked by their height seed
      let r = (0.32 + 0.095 * s) * b.m * (1 + 0.2 * la + excess * 0.12);
      r = Math.min(r, 2.4);
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
      if (s > 3 && b.shed > 0.72 && Math.random() < dt * (la > 0 ? 2.5 : 1.1)) this.smoke.puff(x, y + r * 0.7, z, (Math.random() - 0.5) * 1.2, 1.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2, 1.6 + Math.random() * 0.9, r * 0.7, r * 1.8, 0.45, 1);
      if (Math.random() < dt * 5 * this.quality()) g.fx.embers(x, y, z, 1, r, 2.5);
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
        f.tongues = this.tongues.take(Math.round(52 * this.quality()));
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
        if (ok && Math.random() < dt * 0.35 * this.quality()) this.smoke.puff(x, _l.y + T.h * 0.9, z, 0, 1, 0, 1.6, 0.5, 1.3, 0.3, 1);
        if (ok && Math.random() < dt * 1.5 * this.quality()) g.fx.embers(x, _l.y + 0.4, z, 1, 0.4, 2);
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
      hz.add(_p.x, _p.y + 1.4, _p.z, 4.5, 0.7 * env);
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

  /** Moving shadow casters of the kit this frame (main.js shadowCasters). */
  casters(add) {
    for (const w of this.woods) if (w.L && w.L.mesh.visible) add(w.L.mesh, w.L.sphere.center.x, w.L.sphere.center.y, w.L.sphere.center.z, w.L.sphere.radius);
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
    }
    return true;
  }

  // ---------------------------------------------------------------- the gunbai in hand

  /** Every fighter drawn in a counter clip holds the fan (it appears and vanishes in a puff of smoke). */
  updateGunbais(dt) {
    const g = this.game, seen = (this._seen ||= new Set());
    seen.clear();
    const want = (f, on) => {
      if (!f) return;
      let G = this.gunbaiOf.get(f);
      if (on && !G) {
        G = this.gunbaiPool.find((x) => !x.owner);
        if (!G) return;
        G.owner = f;
        this.gunbaiOf.set(f, G);
      }
      if (!G) return;
      seen.add(f);
      if (on) G.attach(f);
      if (G.show(on)) {
        const p = bonePos(f, 'rightHand', _v);
        if (p) g.fx.poof({ x: p.x, y: p.y - 0.7, z: p.z }, 0.55);
      }
      G.update(dt);
      if (!on && !G.on) {
        G.detach();
        G.owner = null;
        this.gunbaiOf.delete(f);
      }
    };
    const holds = (f) => !!f?.view?.act && COUNTER_CLIPS.has(f.view.act.clip);
    want(g.player, holds(g.player) || this.forceGunbai);
    for (const r of g.remotes.values()) want(r.fighter, holds(r.fighter) && !r.fighter.dead);
    // a fighter that left (or was never drawn this frame) gives its fan back
    for (const [f, G] of this.gunbaiOf) {
      if (seen.has(f)) continue;
      G.detach();
      G.owner = null;
      this.gunbaiOf.delete(f);
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
    this.debris.update(dt, this.game.world);
    // the heat flash of a torrent near you (an exposure kick that settles)
    if (this.fireFlash > 0) {
      this.game.post.grade.bright += this.fireFlash * 0.07;
      this.fireFlash = Math.max(0, this.fireFlash - dt * 1.6);
    }
    this.updateGunbais(dt);
    this.billows.update(dt, this.game.sky?.sun?.position);
    this.smoke.update(dt, this.game.sky?.sun?.position);
    this.tongues.update(this.time);
  }
}
