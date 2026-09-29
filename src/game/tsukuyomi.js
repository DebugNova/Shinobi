// Tsukuyomi's world on its victim's own screen (Itachi's E). For the genjutsu's length the view leaves the fight:
// the Mangekyō spins up over the arena and its pupil swallows the view; it opens again on the victim bound to a T
// cross where it stood, Itachi watching; the world dims, a white fog rolls in and swallows the arena, then everything
// turns negative (a blood-brown sky, the ground white, light and dark swapped) while katanas fly in and stab, over
// and over, ink bursting off every one; the eye closes it and the fight comes back. Purely visual and local (the
// daze itself is the server's): the real fighters are hidden, two stand-ins (the victim's own body, the caster's) act
// it out, and the camera, the fog, the HUD and the grade are borrowed and given back.
import * as THREE from 'three';
import { ST } from '../shared/config.js';
import { charOf } from '../shared/characters.js';
import { SUN_DIR } from '../world/sky.js';
import { Fighter } from './fighter.js';
import { Stage, Swords, Ink } from '../gfx/tsukuyomifx.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, k) => a + (b - a) * k;

/**
 * The timeline, seconds since the hit reached this screen (the exit is timed back from the end of the daze).
 * The layout is in the stage's frame: the victim at the origin facing -z, x mirrored (mx) to the side with a view.
 */
export const TSU = {
  eyeIn: 0.6, // the Mangekyō spins up over the arena; its pupil has swallowed the view by here (the stage switches on)
  reveal: [0.66, 1.08], // a hole opens in the black onto the stage
  dim: [1.25, 1.75], // colour and light drain away
  ghost: [1.3, 1.6, 2.05, 2.35], // the ink pinwheel hangs over the victim (in, full, out, gone)
  fog: [1.95, 2.45], // the fog thickens; the arena is gone behind it by the end
  neg: 2.85, // the negative world snaps in (under a flash)
  exit: 0.5, // s before the daze ends: the eye closes it
  // katana volleys: [time, count] (the first come in through the dim, the rest in the negative world)
  volleys: [[1.5, 2], [1.78, 3], [2.12, 3], [2.45, 3], [2.9, 4], [3.12, 3], [3.32, 3], [3.52, 4], [3.72, 3], [3.92, 4], [4.12, 3], [4.3, 3]],
  L: {
    lift: 0.28, // the victim hangs this far off the ground
    itachi: [-3.9, 2.7], // the stand-in Itachi (x, z), facing the cross
    cam: [[0.8, 1.56, -4.75], [0.6, 1.44, -3.8]], // the camera dollies in over the whole thing
    look: [[-1.35, 1.22, 1.25], [-1.1, 1.2, 0.95]],
    fov: [48, 44],
  },
};

// where the katanas go in (bone, the bone toward which its middle lies, weight)
const TARGETS = [
  ['chest', 'upperChest', 3], ['upperChest', 'neck', 2], ['spine', 'chest', 2.5], ['hips', 'spine', 1],
  ['leftUpperArm', 'leftLowerArm', 1], ['rightUpperArm', 'rightLowerArm', 1], ['leftLowerArm', 'leftHand', 0.5], ['rightLowerArm', 'rightHand', 0.5],
  ['leftUpperLeg', 'leftLowerLeg', 1.1], ['rightUpperLeg', 'rightLowerLeg', 1.1], ['leftLowerLeg', 'leftFoot', 0.5], ['rightLowerLeg', 'rightFoot', 0.5],
];
const TW = TARGETS.reduce((s, t) => s + t[2], 0);
// the katanas are drawn a size up (a 1 m sword across a 4 m shot read as a thin line); BLADE: the tip from the
// sword's origin, GRIP: the pommel behind it (tsukuyomifx.js katanaGeometry)
const SWORD = 1.4, BLADE = 0.72 * SWORD, GRIP = 0.29 * SWORD;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0), SIZE = new THREE.Vector3(SWORD, SWORD, SWORD);
const _q2 = new THREE.Quaternion(), _m3 = new THREE.Matrix4(), _c = new THREE.Color();

export class TsukuyomiWorld {
  constructor(K) {
    this.K = K;
    this.game = K.game;
    const s = this.game.scene;
    this.stage = new Stage(s);
    this.swords = new Swords(s, SUN_DIR, this.stage.uNeg);
    this.ink = new Ink(s, this.stage.uNeg);
    this.S = null; // the genjutsu running on this screen (see start)
    this.cam = false; // the camera is ours this frame (main.js asks late())
    this.focus = new THREE.Vector3();
    this.list = [];
  }

  get active() {
    return !!this.S;
  }

  /** Every program compiles behind the loading screen (ItachiKit.warm). */
  warm(on, p) {
    const st = this.stage;
    if (on) {
      st.place(p.x, p.y - 1, p.z, 0, 1.3, SUN_DIR);
      st.show(true);
      st.world(true);
      for (const m of [st.post, st.bar, ...st.ropes.flatMap((g) => g.children)]) m.castShadow = false;
      _m.makeTranslation(p.x + 0.5, p.y, p.z);
      this.swords.draw([{ m: _m, tail: new THREE.Vector3(p.x - 2, p.y, p.z), head: new THREE.Vector3(p.x, p.y, p.z), trail: 1 }]);
      this.ink.mesh.visible = true;
      for (let k = 0; k < 3; k++) this.ink.add(k, p.x, p.y, p.z, 0, 1, 0, 1, 0.3, p.y - 5);
      this.ink.update(0.01);
    } else {
      st.show(false);
      st.world(false);
      this.swords.draw([]);
      this.ink.clear();
      this.ink.update(0);
      this.ink.mesh.visible = false;
    }
  }

  /** The local fighter was caught (tsukuyomi:main on us): by `casterId`, until `until` (server ms). */
  start(casterId, until) {
    const g = this.game;
    if (this.S) {
      if (this.S.exitT === null) this.S.until = Math.max(this.S.until, until);
      return;
    }
    if (!g.player || !g.ctrl || g.ctrl.dead) return;
    this.S = {
      t: 0, until, casterId, on: false, exitT: null, exitDur: 0.5, spin: 0, trauma: 0, jolt: new THREE.Vector3(), vol: 0, swords: [],
      arenaHidden: false, fog0: null, sounds: {}, lastStab: -1, shadowGen: 0,
    };
    g.audio?.tsukuyomi?.('in');
    g.hud?.cinema?.(true);
  }

  /** Thrown out of it (a launch, a knockdown): the genjutsu breaks now. */
  breakAt(now) {
    if (this.S && this.S.exitT === null) this.S.until = Math.min(this.S.until, now);
  }

  /** Ends it at once, everything given back (leaving the arena, a respawn). */
  abort() {
    if (!this.S) return;
    this.switchOff();
    this.S = null;
    this.game.hud?.cinema?.(false);
  }

  // ---------------------------------------------------------------- the stage switching on and off

  /** Builds the stage where the victim stands (under the black: nothing of this is seen being set up). */
  switchOn() {
    const g = this.game, S = this.S, me = g.player, L = TSU.L;
    S.on = true;
    const px = me.pos.x, py = me.pos.y, pz = me.pos.z;
    const gy = g.world.ground(px, pz, py + 0.3, {}).y;
    // (caught in the air: the cross stands in the air)
    const y0 = py - gy < 1.2 ? gy : py;
    S.y0 = y0;
    // the stand-in Itachi toward the real one; the camera on whichever side (and angle) has a clear view
    const caster = g.remotes.get(S.casterId)?.fighter;
    let best = null;
    for (const mx of [1, -1]) {
      const base = caster && Math.hypot(caster.pos.x - px, caster.pos.z - pz) > 0.5
        ? Math.atan2(caster.pos.x - px, caster.pos.z - pz) - Math.atan2(mx * L.itachi[0], L.itachi[1])
        : me.yaw;
      for (const dy of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4]) {
        const yaw = base + dy, score = this.viewScore(px, y0, pz, yaw, mx);
        if (!best || score > best.score) best = { yaw, mx, score };
        if (score >= 1) break;
      }
      if (best.score >= 1) break;
    }
    S.yaw = best.yaw;
    S.mx = best.mx;
    S.o = new THREE.Vector3(px, y0, pz);
    // the stand-ins: the victim's own body and the caster's (bodies from the model pools: warmed with room for them)
    const myCh = g.me?.ch || g.ctrl.C.id, itCh = g.remotes.get(S.casterId)?.info.ch || 'itachi';
    S.victim = this.body(myCh, 'tsu-victim');
    S.itachi = this.body(itCh, 'tsu-itachi');
    S.itachiC = charOf(itCh);
    S.view = { v: this.view(), i: this.view() };
    // pose the victim once, then put the crossbar at its wrists
    this.pose(0);
    let barY = 1.3 + L.lift;
    const h = S.victim?.f.vrm.humanoid;
    if (h) {
      const a = h.getRawBoneNode('leftHand')?.getWorldPosition(_v), b = h.getRawBoneNode('rightHand')?.getWorldPosition(_w);
      if (a && b) barY = (a.y + b.y) / 2 - y0 - 0.015;
    }
    this.stage.place(px, y0, pz, S.yaw, barY, SUN_DIR);
    this.stage.show(true);
    this.stage.world(false);
    this.ink.clear();
    this.ink.mesh.visible = true;
    g.hud?.cinema?.(true);
  }

  /** How well the camera sees the stage turned by yaw: 1 = a clear view of the cross and Itachi, less when blocked. */
  viewScore(px, y0, pz, yaw, mx) {
    const g = this.game, W = g.world, L = TSU.L;
    const at = (l, out) => out.set(mx * l[0], l[1], l[2]).applyAxisAngle(Y, yaw).add(_u.set(px, y0, pz));
    const cam = at(L.cam[0], new THREE.Vector3()), cam1 = at(L.cam[1], new THREE.Vector3());
    const cross = new THREE.Vector3(px, y0 + 1.3, pz);
    const it = at([L.itachi[0], 1.5, L.itachi[1]], new THREE.Vector3());
    let s = 1;
    if (!W.clear(cross.x, cross.y, cross.z, cam.x, cam.y, cam.z)) s -= 0.5;
    if (!W.clear(cross.x, cross.y, cross.z, cam1.x, cam1.y, cam1.z)) s -= 0.2;
    if (!W.clear(it.x, it.y, it.z, cam.x, cam.y, cam.z)) s -= 0.2;
    if (W.solidAt(cam.x, cam.z, cam.y - 0.3, cam.y + 0.3, 0.2)) s -= 0.6;
    if (W.ground(cam.x, cam.z, cam.y + 2, {}).y > cam.y - 0.4) s -= 0.4;
    return s;
  }

  /** A stand-in fighter from the character's model pool (null when the pool is empty: that body is left out). */
  body(ch, id) {
    const g = this.game, e = g.charModel(ch), vrm = e.model.pool.find((v) => !v.taken);
    if (!vrm) return null;
    vrm.taken = true;
    const f = new Fighter({ id, name: '', slot: 0, local: false, vrm, rig: e.model.rig, lib: e.lib, world: g.world, scene: g.scene });
    f.noRing = true;
    return { f, e };
  }

  view() {
    return {
      x: 0, y: 0, z: 0, yaw: 0, vf: 0, vl: 0, vy: 0, speed: 0, yawRate: 0, st: ST.jutsu, stT: 0, sprint: false, skid: 0, ground: true,
      flipT: -1, landT: 9, landV: 0, hardLand: false, wall: null, stepUp: 0, combat: false, act: { clip: '', t: 0, key: '' },
    };
  }

  /** Gives everything back: the real fighters, the arena, the sky, the fog, the HUD; the stand-ins go home. */
  switchOff() {
    const g = this.game, S = this.S;
    if (!S?.on) return;
    S.on = false;
    this.cam = false;
    for (const B of [S.victim, S.itachi]) {
      if (!B) continue;
      B.f.dispose();
      B.e.model.give(B.f.vrm);
    }
    S.victim = S.itachi = null;
    this.stage.show(false);
    this.stage.world(false);
    this.swords.draw([]);
    // (the ink's buffers and the negative uniform are only touched while the stage runs: settle them now)
    this.ink.clear();
    this.ink.update(0);
    this.ink.mesh.visible = false;
    this.stage.update(0, 0, 0);
    this.showArena(true);
    if (S.fog0 && g.scene.fog) {
      g.scene.fog.near = S.fog0.near;
      g.scene.fog.far = S.fog0.far;
      g.scene.fog.color.copy(S.fog0.color);
    }
    S.fog0 = null;
    const show = (f) => f && (f.root.visible = f.visible !== false);
    show(g.player);
    for (const r of g.remotes.values()) show(r.fighter);
    for (const c of g.jutsu.clones) if (!c.gone) c.f.root.visible = true;
    if (g.dummy) g.dummy.root.visible = true;
    g.hud?.cinema?.(false);
  }

  /** The arena (and its sky) hidden behind the fog, or back. */
  showArena(on) {
    const g = this.game, S = this.S;
    if (!on === S.arenaHidden) return;
    S.arenaHidden = !on;
    g.arena.visible = on;
    if (g.sky?.dome) g.sky.dome.visible = on;
    this.stage.world(!on);
    // (the ink outline's reach pulled in: the crease where the stage's ground meets its sky drew a line round the horizon)
    const far = g.post.outline.uniforms.get('uFar');
    if (!on) {
      S.outFar = far.value;
      far.value = 24;
    } else if (S.outFar) far.value = S.outFar;
    // (a static shadow redraw while the arena was hidden would have drawn it without the arena: draw it again)
    if (on && g.shadows.gen !== S.shadowGen) g.shadows.invalidate();
    if (!on) S.shadowGen = g.shadows.gen;
  }

  // ---------------------------------------------------------------- per frame

  /** Once per frame from the kit's update (after every fighter has been updated). */
  update(dt, now) {
    const S = this.S, g = this.game;
    if (!S) return;
    if (g.state !== 'playing' || !g.player) return this.abort();
    S.t += dt;
    const left = (S.until - now) / 1000;
    if (S.exitT === null && (left < TSU.exit || g.ctrl?.dead)) {
      S.exitT = S.t;
      S.exitDur = clamp(left, 0.28, TSU.exit);
      if (S.on) g.audio?.tsukuyomi?.('out');
    }
    const t = S.t, gen = g.post.genjutsu;
    // the eye's turn: whirling as it opens, settling
    S.spin += dt * (2.2 + 9 * Math.exp(-(S.exitT !== null ? t - S.exitT : t) * 2.4));
    if (S.exitT === null && !S.on && t >= TSU.eyeIn) this.switchOn();
    if (S.exitT !== null) {
      const d = S.exitDur / TSU.exit, u = t - S.exitT;
      if (!S.on && S.exitT < TSU.eyeIn) {
        // (it ended before the world opened: the eye just lets go)
        gen.amt = 0.9 * ss(0, 0.3, S.exitT) * (1 - ss(0, 0.4, u));
        gen.eye = ss(0, 0.12, S.exitT) * (1 - ss(0, 0.25, u));
        gen.eyeS = 0.12 + 0.95 * (1 - (1 - clamp(S.exitT / 0.55, 0, 1)) ** 3);
        gen.eyeR = S.spin;
        if (u > 0.45) {
          this.S = null;
          g.hud?.cinema?.(false);
        }
        return;
      }
      if (S.on && u >= 0.32 * d) this.switchOff();
      if (S.on) this.grade(t, gen);
      const eyeS = 0.2 + 0.85 * ss(0, 0.3 * d, u);
      if (u < 0.32 * d) {
        gen.eye = ss(0, 0.1 * d, u);
        gen.eyeS = eyeS;
        gen.eyeR = S.spin;
        if (u > 0.16 * d) gen.cover = [0, lerp(0.13 * eyeS, 1.3, ss(0.16 * d, 0.32 * d, u))];
      } else {
        gen.cover = [1.3 * ss(0.32 * d, 0.52 * d, u) ** 0.8, 1.35];
        gen.amt = 0.9 * (1 - ss(0.32 * d, 0.95 * d, u));
        if (u > 0.95 * d) {
          this.S = null;
          return;
        }
      }
      if (!S.on) return;
    } else if (!S.on) {
      // the Mangekyō spinning up over the arena as it reddens, its pupil opening over everything
      gen.amt = 0.9 * ss(0, 0.3, t);
      gen.eye = ss(0, 0.12, t);
      gen.eyeS = 0.12 + 0.95 * (1 - (1 - clamp(t / 0.55, 0, 1)) ** 3);
      gen.eyeR = S.spin;
      if (t > 0.36) gen.cover = [0, lerp(0.13 * gen.eyeS, 1.3, ss(0.36, TSU.eyeIn, t))];
      return;
    } else {
      // the black opening onto the stage
      const [r0, r1] = TSU.reveal;
      if (t < r1) gen.cover = [1.3 * ss(r0, r1, t) ** 0.8, 1.35];
      this.grade(t, gen);
    }
    this.act(dt, t);
  }

  /** The grade and the fog for time t (the victim's own screen). */
  grade(t, gen) {
    const g = this.game, S = this.S, fog = g.scene.fog;
    const [d0, d1] = TSU.dim, [f0, f1] = TSU.fog, N = TSU.neg;
    // (the fog closes in first, the colour goes after it: greyed before the fog, the grass read as black on white)
    gen.dim = ss(d0, d1, t) * (1 - ss(f1 - 0.2, f1 + 0.1, t));
    gen.mono = ss(f1 - 0.2, f1 + 0.1, t) * (1 - ss(N, N + 0.2, t));
    gen.neg = ss(N - 0.04, N + 0.1, t);
    gen.flash = 0.7 * ss(N - 0.08, N - 0.02, t) * (1 - ss(N, N + 0.22, t));
    const fk = ss(f0 - 0.1, f1 - 0.15, t), nk = ss(N, N + 0.25, t);
    S.fk = fk;
    if (fog) {
      S.fog0 ||= { near: fog.near, far: fog.far, color: fog.color.clone() };
      const F0 = S.fog0;
      // thickening (far eased in log space: a steady closing in), then the negative world's (its own negative:
      // light grey = the dark red it becomes)
      let near = lerp(F0.near, 0.4, fk), far = Math.exp(lerp(Math.log(F0.far), Math.log(8.5), fk));
      near = lerp(near, 12, nk);
      far = lerp(far, 46, nk);
      fog.near = near;
      fog.far = far;
      fog.color.copy(F0.color).lerp(_c.setRGB(0.69, 0.69, 0.69), ss(f0, f0 + 0.35, t)).lerp(_c.setRGB(0.53, 0.53, 0.53), nk);
    }
    if (fk > 0.97 && !S.arenaHidden) this.showArena(false);
    for (const [k, at] of [['dim', d0], ['fog', f0], ['neg', N - 0.05]]) {
      if (t >= at && !S.sounds[k]) {
        S.sounds[k] = true;
        g.audio?.tsukuyomi?.(k);
      }
    }
  }

  /** The stand-ins, the swords, the ink, the seal over the victim, the camera. */
  act(dt, t) {
    const g = this.game, S = this.S, L = TSU.L;
    this.stage.update(dt, g.post.genjutsu.neg, S.fk || 0);
    this.ink.update(dt);
    this.pose(dt);
    const V = S.victim?.f, I = S.itachi?.f;
    // rope at the wrists and round the ankles
    if (V) {
      const h = V.vrm.humanoid;
      const wl = h.getRawBoneNode('leftHand')?.getWorldPosition(_v), wr = h.getRawBoneNode('rightHand')?.getWorldPosition(_w);
      const fl = h.getRawBoneNode('leftFoot')?.getWorldPosition(_u);
      const ank = fl && h.getRawBoneNode('rightFoot')?.getWorldPosition(new THREE.Vector3()).add(fl).multiplyScalar(0.5).setY(fl.y + 0.03);
      this.stage.bind(wl, wr, ank);
    }
    // the violet sphere over it as the world opens, then the ink pinwheel as it dims
    if (V) {
      const c = V.vrm.humanoid.getRawBoneNode('chest')?.getWorldPosition(_v) || _v.copy(V.pos).setY(V.pos.y + 1.2);
      const [g0, g1, g2, g3] = TSU.ghost, r0 = TSU.reveal[0];
      const violet = ss(r0, r0 + 0.2, t) * (1 - ss(1.35, 1.75, t)), ink = ss(g0, g1, t) * (1 - ss(g2, g3, t));
      if (violet + ink > 0.001) this.K.seal.set(c, 0.98, null, 0.35, { violet, ink }, t, t * 1.3, { ink: 1.25 }, 0.85);
    }
    // his eyes: the Mangekyō, burning
    if (I) {
      this.K.eyes(I, S.itachiC, _v, _w, _u);
      for (const e of [_w, _u]) this.K.marks.set(e.x, e.y, e.z, 0.024, -1, 1, t * 3, 1.3);
    }
    this.updateSwords(dt, t);
    // the camera: a slow dolly in, a breath of handheld drift, the stabs shaking it
    S.trauma = Math.max(0, S.trauma - dt * 1.6);
    const k = ss(TSU.reveal[0], 4.6, t);
    const at = (a, b, out) => out.set(S.mx * lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)).applyAxisAngle(Y, S.yaw).add(S.o);
    const pos = at(L.cam[0], L.cam[1], (S.camPos ||= new THREE.Vector3()));
    const look = at(L.look[0], L.look[1], (S.camLook ||= new THREE.Vector3()));
    const sh = S.trauma * S.trauma * 0.07;
    pos.x += Math.sin(t * 1.3) * 0.012 + (Math.random() - 0.5) * sh;
    pos.y += Math.sin(t * 1.7 + 1) * 0.01 + (Math.random() - 0.5) * sh;
    look.x += (Math.random() - 0.5) * sh * 0.5;
    look.y += (Math.random() - 0.5) * sh * 0.5;
    S.fov = lerp(L.fov[0], L.fov[1], k);
    S.roll = -0.035 * S.mx * ss(TSU.neg, TSU.neg + 0.6, t);
    this.focus.copy(S.o).setY(S.o.y + 1.2);
    this.cam = true;
  }

  /** The stand-ins' poses (the victim on the cross, jolted by the stabs; Itachi before it). */
  pose(dt) {
    const S = this.S, g = this.game, L = TSU.L;
    S.jolt.multiplyScalar(Math.exp(-dt * 12));
    const V = S.victim, I = S.itachi, vv = S.view.v, iv = S.view.i;
    if (V) {
      _v.set(0, L.lift, 0).applyAxisAngle(Y, S.yaw).add(S.o).add(S.jolt);
      Object.assign(vv, { x: _v.x, y: _v.y, z: _v.z, yaw: S.yaw, stT: S.t });
      vv.act.clip = 'tsu_bound';
      vv.act.key = 'tsu_bound';
      vv.act.t = S.t;
      if (!V.placed) {
        // (straight into the pose: no blend in from wherever the pooled body was)
        V.placed = true;
        V.f.snap(vv.x, vv.y, vv.z, vv.yaw);
        V.f.update(0.3, vv);
      }
      V.f.update(dt, vv);
    }
    if (I) {
      _v.set(S.mx * L.itachi[0], 0, L.itachi[1]).applyAxisAngle(Y, S.yaw).add(S.o);
      // on the real ground while the arena shows, on the stage's once it is gone
      if (!S.arenaHidden) _v.y = g.world.ground(_v.x, _v.z, S.o.y + 1.5, {}).y;
      const yaw = Math.atan2(-(S.o.x - _v.x), -(S.o.z - _v.z));
      Object.assign(iv, { x: _v.x, y: _v.y, z: _v.z, yaw, stT: S.t });
      iv.act.clip = 'tsu_watch';
      iv.act.key = 'tsu_watch';
      iv.act.t = S.t;
      if (!I.placed) {
        I.placed = true;
        I.f.snap(iv.x, iv.y, iv.z, iv.yaw);
        I.f.update(0.3, iv);
      }
      I.f.update(dt, iv);
    }
  }

  // ---------------------------------------------------------------- the katanas

  volley(n) {
    const S = this.S, V = S.victim?.f;
    if (!V) return;
    const h = V.vrm.humanoid;
    for (let k = 0; k < n; k++) {
      let r = Math.random() * TW, T = TARGETS[0];
      for (const x of TARGETS) if ((r -= x[2]) <= 0) {
        T = x;
        break;
      }
      const bone = h.getRawBoneNode(T[0]), next = h.getRawBoneNode(T[1]);
      if (!bone) continue;
      // from Itachi's side, from above and in front: they streak across the view into the body
      // (spread wide: stuck in the body they bristle out at every angle, not in a row)
      const dir = new THREE.Vector3(-S.mx * (0.4 + 0.6 * Math.random()), -0.2 + 0.95 * Math.random(), -0.85 + 1.2 * Math.random()).normalize().applyAxisAngle(Y, S.yaw);
      const s = {
        bone, next, at: 0.3 + Math.random() * 0.5, off: new THREE.Vector3((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1),
        fly: dir.clone().negate(), dist: 7 + Math.random() * 3.5, speed: 30 + Math.random() * 9, t: -(k * 0.075 + Math.random() * 0.035),
        roll: Math.random() * Math.PI * 2, pen: 0.26 + Math.random() * 0.18, stuck: false, rel: new THREE.Matrix4(), stuckT: 0, m: new THREE.Matrix4(),
        tail: new THREE.Vector3(), head: new THREE.Vector3(), trail: 0,
      };
      S.swords.push(s);
    }
    // (a cap: the oldest stuck ones make room)
    while (S.swords.length > 46) {
      const i = S.swords.findIndex((x) => x.stuck);
      S.swords.splice(i < 0 ? 0 : i, 1);
    }
  }

  /** Where a sword is aimed now (the point on its bone, the body moves a little). */
  aim(s, out) {
    s.bone.getWorldPosition(out);
    if (s.next) out.lerp(s.next.getWorldPosition(_u), s.at);
    return out.add(s.off);
  }

  updateSwords(dt, t) {
    const S = this.S, V = S.victim?.f;
    while (S.vol < TSU.volleys.length && t >= TSU.volleys[S.vol][0] && S.exitT === null) this.volley(TSU.volleys[S.vol++][1]);
    const list = this.list;
    list.length = 0;
    for (const s of S.swords) {
      s.t += dt;
      if (s.t < 0) continue;
      if (!s.stuck) {
        const target = this.aim(s, _v);
        // the tip: along the line in from its start (re-aimed at the moving body: it can't miss)
        const travel = s.t * s.speed, left = s.dist - travel;
        const tip = _w.copy(target).addScaledVector(s.fly, -Math.max(left, -s.pen));
        _q.setFromUnitVectors(Z, s.fly).multiply(_q2.setFromAxisAngle(Z, s.roll));
        s.m.compose(_u.copy(tip).addScaledVector(s.fly, -BLADE), _q, SIZE);
        s.head.copy(tip).addScaledVector(s.fly, -BLADE - GRIP);
        s.tail.copy(s.head).addScaledVector(s.fly, -Math.min(travel, 3.4));
        s.trail = 1;
        if (left <= -s.pen) this.stab(s, tip, V);
      } else {
        // stuck: riding its bone, quivering from the blow
        s.stuckT += dt;
        const q = 0.09 * Math.exp(-s.stuckT * 7) * Math.sin(s.stuckT * 48);
        _m.makeTranslation(0, 0, 0.72).multiply(_m2.makeRotationAxis(X, q)).multiply(_m3.makeTranslation(0, 0, -0.72));
        s.m.multiplyMatrices(s.bone.matrixWorld, s.rel).multiply(_m);
        s.trail = Math.max(0, 1 - s.stuckT / 0.12);
        s.tail.lerp(s.head, 1 - s.trail);
      }
      list.push(s);
    }
    this.swords.draw(list);
  }

  /** A sword goes in: it stays on its bone; ink bursts, drops fly and stain the ground; the body jerks; the view shakes. */
  stab(s, tip, V) {
    const S = this.S, g = this.game;
    s.stuck = true;
    s.stuckT = 0;
    s.rel.copy(s.bone.matrixWorld).invert().multiply(s.m);
    // ink only in the negative world (through the dim and the fog the blades go in clean)
    const neg = S.t > TSU.neg - 0.05;
    const I = this.ink;
    // (the splatter bursts out on the far side, where the blade came through)
    if (neg && Math.random() < 0.75) I.add(0, tip.x + s.fly.x * 0.12, tip.y + s.fly.y * 0.12, tip.z + s.fly.z * 0.12, 0, 0, 0, 0.45 + Math.random() * 0.2, 0.22 + Math.random() * 0.2);
    for (let k = 0; k < (neg ? 4 : 0); k++) {
      const sp = 1.5 + Math.random() * 3;
      I.add(1, tip.x, tip.y, tip.z, s.fly.x * sp + (Math.random() - 0.5) * 2.2, s.fly.y * sp + 0.8 + Math.random() * 1.8, s.fly.z * sp + (Math.random() - 0.5) * 2.2, 0.8 + Math.random() * 0.4, 0.018 + Math.random() * 0.03, S.y0 + 0.02);
    }
    for (let k = 0; k < (neg ? 1 : 0); k++) {
      const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.9;
      I.add(2, tip.x - s.fly.x * 0.6 + Math.cos(a) * r, S.y0 + 0.02 + k * 0.002, tip.z - s.fly.z * 0.6 + Math.sin(a) * r, 0, 0, 0, 60, 0.12 + Math.random() * 0.3);
    }
    if (V) {
      V.anim.flinch = 1;
      V.anim.flinchDir = Math.random() < 0.5 ? -1 : 1;
      S.jolt.addScaledVector(s.fly, 0.035);
    }
    S.trauma = Math.min(1, S.trauma + 0.32);
    if (S.t - S.lastStab > 0.045) {
      S.lastStab = S.t;
      g.audio?.tsuSword?.();
    }
  }

  // ---------------------------------------------------------------- the frame (main.js)

  /**
   * After the game camera's update: while the stage is up, the view is ours (the cinematic camera) and the real
   * fighters stay hidden. Returns true when it took the camera.
   */
  late(camera) {
    const S = this.S, g = this.game;
    if (!S?.on || !this.cam) return false;
    camera.position.copy(S.camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(S.camLook);
    if (S.roll) camera.rotateZ(S.roll);
    if (camera.fov !== S.fov) {
      camera.fov = S.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    const hide = (f) => {
      if (!f) return;
      f.root.visible = false;
      f.ring.visible = false;
    };
    hide(g.player);
    for (const r of g.remotes.values()) hide(r.fighter);
    for (const c of g.jutsu.clones) if (!c.gone) c.f.root.visible = false;
    if (g.dummy) g.dummy.root.visible = false;
    return true;
  }

  /** Shadow casters while the stage stands in the arena (main.js shadowCasters). */
  casters(add) {
    const S = this.S;
    if (!S?.on || S.arenaHidden) return;
    this.stage.casters(add);
    for (const B of [S.victim, S.itachi]) if (B) add(B.f.root, B.f.pos.x, B.f.pos.y + 1, B.f.pos.z, 1.7);
  }
}
