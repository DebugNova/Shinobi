// Madara's genjutsu on its victim's own screen (his X, the reference shots: a face in shadow with the eyes blazing
// white, then nothing but the eyes). For the daze's 3 s the view leaves the fight:
//   the catch    red closes in from the edges and the world sinks into the dark
//   his face     cut, under the dark, to his face up close (a stand-in Madara where the real one stood, facing us),
//                graded violet-black; his eyes snap open, glowing white, the Sharingan turning; the camera creeps in
//   the vanish   the face dissolves into the dark from its edges in (embers along the front): only the eyes are left
//   the void     the eyes spread and grow to fill the dark, heartbeat ripples race out of them, the Sharingan burns into
//                his Eternal Mangekyō, eyes open one after another all round in the dark, watching
//   the exit     the lids snap shut; black; it opens from the middle back onto the arena, where you stand dazed
// Purely visual and local (the daze itself is the server's). The camera, the HUD and the grade (post.vision:
// madaravisionfx.js VisionEffect) are borrowed and given back; the real fighters are hidden while the camera is ours.
import * as THREE from 'three';
import { ST } from '../shared/config.js';
import { charOf } from '../shared/characters.js';
import { Fighter } from './fighter.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The timeline: seconds since the hit reached this screen (the exit is timed back from the end of the daze). */
export const VIS = {
  cut: 0.2, // the view cuts to his face (under the dark)
  dark: [0.02, 0.19], // the world sinking away
  faceIn: [0.24, 0.62], // his face coming up out of the dark
  open: [0.4, 0.52], // his eyes snapping open
  cam: [0.5, 0.3], // metres from his eyes: the camera creeping in over the face shot
  vanish: [1.2, 1.38], // the face dissolving into the dark (a flicker first)
  drift: [1.38, 2.15], // the eyes spreading out to fill the dark
  ems: [1.72, 2.12], // the Sharingan burning into his Eternal Mangekyō
  beats: [1.42, 1.9, 2.32], // heartbeats: a thump, ripples racing out of the eyes
  watch: 1.52, // the eyes in the dark start opening
  exit: 0.62, // s before the daze ends: the lids shut, the black opens onto the arena
  layout: { x: 0.31, y: 0.02, hw: 0.19 }, // where the eyes end up in the dark (screen heights)
  eyeW: 0.023, // half an eye's width on his face (m), painted larger than the model's own (the reference's eyes)
  fov: 30,
};

const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _fw = new THREE.Vector3(), _up = new THREE.Vector3();

export class MadaraVision {
  constructor(K) {
    this.K = K;
    this.game = K.game;
    this.S = null; // the vision on this screen (see start)
    this.focus = new THREE.Vector3(); // (the toon shading's focus while the camera is ours)
    this.hold = null; // debug (scripts/debug/mgenshots.mjs): the vision's clock held at this time (s), its daze `holdLen` s
    this.holdLen = 3;
  }

  get active() {
    return !!this.S;
  }

  /** The local fighter was caught (sharinganGenjutsu:main on us): by `casterId`, until `until` (server ms). */
  start(casterId, until) {
    const g = this.game;
    if (this.S) {
      if (this.S.exitT === null) this.S.until = Math.max(this.S.until, until);
      return;
    }
    if (!g.player || !g.ctrl || g.ctrl.dead) return;
    this.S = {
      t: 0, until, casterId, on: false, cam: false, exitT: null, exitDur: VIS.exit, spin: 0, open: 0, body: null, C: null,
      pa: [-VIS.layout.x, VIS.layout.y], pb: [VIS.layout.x, VIS.layout.y], hw: VIS.layout.hw, roll: 0, beat: -1, sounds: {},
      camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), view: null, faced: false,
    };
    g.audio?.madaraVision?.('in');
    g.hud?.cinema?.(true);
  }

  /** Thrown out of it (a launch, a knockdown): it breaks now. */
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

  // ---------------------------------------------------------------- the stand-in

  /** Under the dark: a stand-in Madara where the real one stands, facing us; the camera becomes ours. */
  switchOn() {
    const g = this.game, S = this.S, me = g.player;
    S.on = true;
    S.cam = true;
    const r = g.remotes.get(S.casterId), caster = r?.fighter;
    const ch = r?.info.ch || 'madara';
    S.C = charOf(ch);
    // (the caster gone, or no body to spare: the eyes alone, in the dark)
    if (!caster || caster.dead) return;
    const e = g.charModel(ch), vrm = e.model.pool.find((v) => !v.taken);
    if (!vrm) return;
    vrm.taken = true;
    const f = new Fighter({ id: 'mgj-madara', name: '', slot: 0, local: false, vrm, rig: e.model.rig, lib: e.lib, world: g.world, scene: g.scene });
    f.noRing = true;
    S.body = { f, e };
    const yaw = Math.atan2(-(me.pos.x - caster.pos.x), -(me.pos.z - caster.pos.z));
    S.view = {
      x: caster.pos.x, y: caster.pos.y, z: caster.pos.z, yaw, vf: 0, vl: 0, vy: 0, speed: 0, yawRate: 0, st: ST.jutsu, stT: 0, sprint: false, skid: 0,
      ground: true, flipT: -1, landT: 9, landV: 0, hardLand: false, wall: null, stepUp: 0, combat: false, act: { clip: 'mgj_stare', t: 0, key: 'mgj_stare' },
    };
    // (straight into the pose: no blend in from wherever the pooled body was)
    f.snap(S.view.x, S.view.y, S.view.z, yaw);
    f.update(0.3, S.view);
  }

  /** Gives everything back: the real fighters, the camera; the stand-in goes home. */
  switchOff() {
    const g = this.game, S = this.S;
    if (!S?.on) return;
    S.on = false;
    S.cam = false;
    if (S.body) {
      S.body.f.dispose();
      S.body.e.model.give(S.body.f.vrm);
      S.body = null;
    }
    const show = (f) => f && (f.root.visible = f.visible !== false);
    show(g.player);
    for (const r of g.remotes.values()) show(r.fighter);
    for (const c of g.jutsu.clones) if (!c.gone) c.f.root.visible = true;
    if (g.dummy) g.dummy.root.visible = true;
  }

  // ---------------------------------------------------------------- per frame

  /** Once per frame from the kit's update: the timeline, the stand-in's pose, this frame's grade. */
  update(dt, now) {
    const S = this.S, g = this.game;
    if (!S) return;
    if (g.state !== 'playing' || !g.player) return this.abort();
    if (this.hold !== null) S.t = this.hold;
    else S.t += dt;
    const t = S.t, left = this.hold !== null ? this.holdLen - this.hold : (S.until - now) / 1000;
    if (S.exitT === null && (left < VIS.exit || g.ctrl?.dead)) {
      S.exitT = t;
      S.exitDur = clamp(left, 0.3, VIS.exit);
      S.open0 = S.open;
      g.audio?.madaraVision?.('shut');
    }
    if (S.exitT === null && !S.on && t >= VIS.cut) this.switchOn();
    const V = g.post.vision, hasFace = !!S.body;
    V.on = true;
    // the Sharingan turning, faster and faster through the void
    S.spin += dt * (1.1 + 5.5 * ss(1.3, 2.2, t));
    V.shake[0] = V.shake[1] = 0;
    if (S.exitT === null) {
      V.red = ss(0, 0.07, t) * (1 - ss(0.16, 0.34, t));
      V.dark = ss(VIS.dark[0], VIS.dark[1], t);
      // (a black flicker, then the face burns away from its edges in)
      const [v0, v1] = VIS.vanish;
      V.face = [1 - ss(v0 + 0.05, v1, t), hasFace ? ss(VIS.faceIn[0], VIS.faceIn[1], t) : 0];
      V.cover = [t > v0 && t < v0 + 0.05 ? 0.85 : 0, 0, 0];
      S.open = hasFace ? ss(VIS.open[0], VIS.open[1], t) : ss(0.3, 0.44, t);
      const flare = ss(v0, v1, t) * (1 - ss(v1, v1 + 0.45, t));
      V.glow = 0.75 * S.open + 0.9 * flare + 0.35 * this.beatEnv(t);
      V.eyes = [S.open, ss(VIS.ems[0], VIS.ems[1], t), S.spin, t > 0.25 ? 1 : 0];
      V.watch = [ss(VIS.watch, VIS.watch + 0.25, t), t - VIS.watch];
      const ages = VIS.beats.map((b) => t - b).filter((a) => a >= 0);
      V.ripple = [ages.at(-1) ?? -1, ages.at(-2) ?? -1, 0.4];
      const be = this.beatEnv(t);
      V.shake[0] = (Math.random() - 0.5) * 0.006 * be;
      V.shake[1] = (Math.random() - 0.5) * 0.006 * be;
      // sounds on the timeline (each once)
      for (const [k, at] of [['open', hasFace ? VIS.open[0] : 0.3], ['vanish', v0], ...VIS.beats.map((b, i) => [`beat${i}`, b])]) {
        if (t >= at && !S.sounds[k]) {
          S.sounds[k] = true;
          g.audio?.madaraVision?.(k.startsWith('beat') ? 'beat' : k);
        }
      }
    } else {
      // the exit (d s, ending with the daze): the lids snap shut, black, it opens from the middle back onto the arena
      // (the camera given back under the black)
      const d = S.exitDur, u = t - S.exitT;
      S.open = S.open0 * (1 - ss(0, 0.16 * d, u));
      if (S.on && u >= 0.24 * d) {
        this.switchOff();
        g.audio?.madaraVision?.('out');
      }
      V.dark = S.on ? 1 : 0;
      V.face = [S.on && t < VIS.vanish[0] ? 1 : 0, hasFace ? 1 : 0];
      V.eyes = [S.open, ss(VIS.ems[0], VIS.ems[1], S.exitT), S.spin, S.open > 0.01 ? 1 : 0];
      V.glow = 0.75 * S.open;
      V.watch = [(1 - ss(0, 0.16 * d, u)) * ss(VIS.watch, VIS.watch + 0.25, S.exitT), S.exitT - VIS.watch];
      V.ripple = [-1, -1, 0];
      const hole = u < 0.28 * d ? 0 : 1.6 * (1 - (1 - ss(0.28 * d, d, u)) ** 2);
      V.cover = [ss(0.08 * d, 0.22 * d, u) * (1 - ss(0.85 * d, d, u)), hole, 1 - ss(0.6 * d, d, u)];
      V.red = 0.3 * ss(0.28 * d, 0.45 * d, u) * (1 - ss(0.45 * d, d, u));
      if (u >= d) {
        this.S = null;
        g.hud?.cinema?.(false);
        return;
      }
    }
    // the stand-in, posed
    if (S.body) {
      const v = S.view;
      v.act.t = t;
      v.stT = t;
      S.body.f.update(dt, v);
    }
  }

  /** How hard the heart is beating now (0..1: a double thump at each beat). */
  beatEnv(t) {
    let e = 0;
    for (const b of VIS.beats) {
      const x = t - b;
      if (x >= 0 && x < 0.5) e = Math.max(e, Math.exp(-x * 14) + 0.6 * Math.exp(-Math.max(0, x - 0.16) * 14) * (x > 0.16 ? 1 : 0));
    }
    return Math.min(1, e);
  }

  // ---------------------------------------------------------------- the frame (main.js)

  /**
   * After the game camera's update: while the stand-in is up the camera films his face (the real fighters hidden);
   * every frame of the vision, the eyes' places on screen for the post effect. Returns true when it took the camera.
   */
  late(camera) {
    const S = this.S, g = this.game;
    if (!S) return false;
    const V = g.post.vision, L = VIS.layout;
    let took = false;
    if (S.on && S.cam) {
      took = true;
      const t = S.t;
      if (S.body) {
        const f = S.body.f, C = S.C;
        const mid = this.K.eyes(f, C, _v, _a, _b);
        // the head's frame (its normalized bone: +z the way the face looks)
        f.vrm.humanoid.getNormalizedBoneNode('head').getWorldQuaternion(_q);
        _fw.set(0, 0, 1).applyQuaternion(_q);
        _up.set(0, 1, 0).applyQuaternion(_q);
        const k = ss(VIS.faceIn[0], VIS.drift[1], t);
        const dist = lerp(VIS.cam[0], VIS.cam[1], 1 - (1 - k) ** 2);
        // a little below his eyes, looking up at them (the reference: a face lowered, the eyes raised at you), a
        // breath of handheld drift
        S.camPos.copy(mid).addScaledVector(_fw, dist).addScaledVector(_up, -0.08 * dist);
        S.camPos.x += Math.sin(t * 1.3) * 0.004;
        S.camPos.y += Math.sin(t * 1.7 + 1) * 0.003;
        S.camLook.copy(mid).addScaledVector(_up, -0.012);
        this.focus.copy(mid);
        camera.position.copy(S.camPos);
        camera.up.set(0, 1, 0);
        camera.lookAt(S.camLook);
        if (camera.fov !== VIS.fov) {
          camera.fov = VIS.fov;
          camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld();
        // his eyes on screen, while the face is there: then they drift out of those places into the layout
        if (t < VIS.vanish[1] + 0.02) {
          const pa = this.toScreen(_a, camera), pb = this.toScreen(_b, camera);
          const [l, r] = pa[0] <= pb[0] ? [pa, pb] : [pb, pa];
          S.pa = [l[0], l[1]];
          S.pb = [r[0], r[1]];
          S.roll = Math.atan2(r[1] - l[1], r[0] - l[0]);
          S.hw = VIS.eyeW / (2 * mid.distanceTo(camera.position) * Math.tan((VIS.fov * Math.PI) / 360));
        }
        V.iso = mid.distanceTo(camera.position);
      } else {
        this.focus.copy(g.player.pos).setY(g.player.pos.y + 1.2);
      }
      const hide = (f) => {
        if (!f) return;
        f.root.visible = false;
        f.ring.visible = false;
      };
      hide(g.player);
      for (const r of g.remotes.values()) hide(r.fighter);
      for (const c of g.jutsu.clones) if (!c.gone) c.f.root.visible = false;
      if (g.dummy) g.dummy.root.visible = false;
      if (S.body) S.body.f.root.visible = true;
    }
    // the eyes: where his face had them, spreading into the layout through the void
    const k = S.body ? ss(VIS.drift[0], VIS.drift[1], S.exitT ?? S.t) : 1;
    const e = (1 - k) ** 1.2;
    V.eyeA = [lerp(-L.x, S.pa[0], e), lerp(L.y, S.pa[1], e), lerp(L.hw, S.hw, e), S.roll * e];
    V.eyeB = [lerp(L.x, S.pb[0], e), lerp(L.y, S.pb[1], e), lerp(L.hw, S.hw, e), S.roll * e];
    return took;
  }

  /** A world point -> screen heights from the screen's centre (+y up). */
  toScreen(p, camera) {
    _u.copy(p).project(camera);
    return [_u.x * 0.5 * camera.aspect, _u.y * 0.5];
  }
}

