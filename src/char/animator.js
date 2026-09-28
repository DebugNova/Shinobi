// The character animator. Gameplay decides (the fighter's state and moves live in code, with frame data); the
// animator only makes it look right. Each frame it picks a pose source for the fighter's state (procedural gait,
// air, front flip, dash, landing squash, wall run, or an action clip retimed to its move's frame data), adds
// procedural layers (lean, look-at, hit flinch, breathing), and "dead blends" every switch: the outgoing pose keeps
// moving with its own angular velocity while it fades out, so a transition responds on the very frame the input
// arrives and still has no pop (Holden's dead blending, a cheap form of inertialization).
import * as THREE from 'three';
import { Pose, BONES, BI, NB, LOWER } from './rig.js';
import { Gait } from './gait.js';
import { setEuler, addEuler, preEuler, armAngles, legAngles, hand } from './posekit.js';
import { ST } from '../shared/config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (k, dt) => 1 - Math.exp(-k * dt);
// scratch objects for the procedural poses (no per-frame allocations)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _ea = new THREE.Euler();
const _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _arm = { down: 0, swing: 0, out: 0, elbow: 0, twist: 0 };

// upper-body bones (the idle clip and upper-body actions write these)
export const UPPER_MASK = new Uint8Array(NB);
BONES.forEach((b, i) => (UPPER_MASK[i] = LOWER.has(b) ? 0 : 1));

// blend time (s) for a switch from one pose source to another
function blendTime(from, to) {
  if (to.startsWith('act')) return from.startsWith('act') ? 0.07 : 0.06;
  if (to.startsWith('react')) return 0.05;
  if (from.startsWith('act') || from.startsWith('react')) return to === 'loco' ? 0.2 : 0.14;
  if (to === 'dash') return 0.05;
  if (from === 'dash') return 0.14;
  if (to === 'wall') return 0.12;
  if (from === 'wall') return 0.14;
  if (from === 'air' && to === 'loco') return 0.09;
  if (to === 'air') return 0.14;
  return 0.15;
}

/** Dead blending: extrapolate the outgoing pose with decaying velocity, cross-fade to the new source. */
class DeadBlend {
  constructor() {
    this.src = new Pose();
    this.w = new Float32Array(NB * 3); // angular velocity per bone (axis * rad/s, local)
    this.hv = new Float32Array(3);
    this.t = 0;
    this.T = 0;
    this.active = false;
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
  }

  start(prev, prev2, dt, T) {
    this.src.copy(prev);
    this.t = 0;
    this.T = T;
    this.active = T > 0;
    const q = this._q, q2 = this._q2;
    const inv = 1 / Math.max(dt, 1e-3);
    for (let i = 0; i < NB; i++) {
      // velocity = log(prev * prev2^-1) / dt
      prev.get(i, q);
      prev2.get(i, q2).invert();
      q.multiply(q2);
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      const s = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z);
      const ang = 2 * Math.atan2(s, q.w);
      const k = s > 1e-6 ? (ang / s) * inv : 0;
      // cap: a teleport or a snapped pose would otherwise fling the extrapolation
      const m = Math.min(1, 18 / Math.max(1e-6, ang * inv));
      this.w[i * 3] = q.x * k * m;
      this.w[i * 3 + 1] = q.y * k * m;
      this.w[i * 3 + 2] = q.z * k * m;
    }
    for (let k = 0; k < 3; k++) this.hv[k] = clamp((prev.h[k] - prev2.h[k]) * inv, -4, 4);
  }

  /** Blends `out` (the new source, already computed) with the extrapolated old pose, in place. */
  apply(dt, out) {
    if (!this.active) return;
    this.t += dt;
    const x = this.t / this.T;
    if (x >= 1) {
      this.active = false;
      return;
    }
    // extrapolate the old pose (velocity decays with a half-life of a third of the blend)
    const decay = Math.exp((-dt * 0.693) / Math.max(0.02, this.T * 0.33));
    const q = this._q, src = this.src;
    for (let i = 0; i < NB; i++) {
      const o = i * 3;
      const wx = this.w[o] * dt, wy = this.w[o + 1] * dt, wz = this.w[o + 2] * dt;
      const a = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (a > 1e-7) {
        const s = Math.sin(a / 2) / a;
        q.set(wx * s, wy * s, wz * s, Math.cos(a / 2));
        src.prerotate(i, q.x, q.y, q.z, q.w);
      }
      this.w[o] *= decay;
      this.w[o + 1] *= decay;
      this.w[o + 2] *= decay;
    }
    for (let k = 0; k < 3; k++) {
      src.h[k] += this.hv[k] * dt;
      this.hv[k] *= decay;
    }
    // smootherstep weight toward the new pose
    const w = x * x * x * (x * (x * 6 - 15) + 10);
    // out = lerp(src, out, w)  ->  tmp = src; tmp.blend(out, w)
    const tmp = (this._tmp ||= new Pose());
    tmp.copy(src).blend(out, w);
    out.copy(tmp);
  }
}

export class Animator {
  constructor(rig, vrm, lib) {
    this.rig = rig;
    this.vrm = vrm;
    this.lib = lib;
    this.nodes = BONES.map((b) => vrm.humanoid.getNormalizedBoneNode(b));
    this.pose = new Pose();
    this.prev = new Pose();
    this.prev2 = new Pose();
    this.upper = new Pose();
    this.gait = new Gait(rig);
    this.dead = new DeadBlend();
    this.key = 'loco';
    this.lastDt = 1 / 60;
    this.t = 0;
    // mocap idle only when it is a real Mixamo download (the ARMORY soldier idle slouches); else the gait's stance
    this.idleClip = lib.get('fight_idle') || (lib.get('idle')?.src?.endsWith('.fbx') ? lib.get('idle') : null);
    this.landSquash = 0;
    this.landVel = 0;
    this.flip = 0;
    this.airBlend = 0;
    this.action = null; // { clip, t, map(t) -> clip time, mask, key }
    this.look = null; // world point to look at (lock-on target)
    this.flinch = 0;
    this.fightW = 0;
    this.flinchDir = 0;
    this.hipsOffsetY = 0; // foot IK pelvis drop (smoothed)
    this.onStep = null;
    this.gait.onStep = (side, speed) => this.onStep?.(side, speed);
    this.prev.copy(this.pose);
    this.prev2.copy(this.pose);
  }

  /** Teleports / respawns: no blend, feet planted. */
  snap() {
    this.gait.plant();
    this.dead.active = false;
    this.key = 'loco';
  }

  /**
   * v (the fighter view): { st, stT, speed, vf, vl (local velocity: forward, left), vy, yawRate, sprint, ground,
   * flipT, landT, landV, hardLand, dashLocal: [x, z] (dash direction in the local frame), dashT, wallSpeed, wallDir,
   * crouch }
   */
  update(dt, v) {
    this.t += dt;
    const key = this.sourceKey(v);
    if (key !== this.key) {
      this.dead.start(this.prev, this.prev2, this.lastDt, blendTime(this.key, key));
      if (key === 'loco' && (this.key === 'air' || this.key === 'wall' || this.key === 'dash')) this.gait.land(Math.hypot(v.vf, v.vl));
      if (key === 'loco' && this.key.startsWith('act')) this.gait.plant();
      if (key === 'air') {
        // a jump off the ground pushes off first (legs extend, toes point, arms swing up), then tucks
        this.airT = 0;
        this.jumpPush = (this.key === 'loco' || this.key === 'land') && v.vy > 3 ? 1 : 0;
      }
      this.key = key;
    }
    const pose = this.pose;
    pose.identity();
    switch (key) {
      case 'air':
        this.airPose(dt, pose, v);
        break;
      case 'dash':
        this.dashPose(dt, pose, v);
        break;
      case 'wall':
        this.wallPose(dt, pose, v);
        break;
      default:
        if (key.startsWith('act')) this.actionPose(dt, pose, v);
        else this.locoPose(dt, pose, v);
    }
    this.layers(dt, pose, v);
    this.debugPose?.(pose, this.rig, v);
    this.dead.apply(dt, pose);
    this.prev2.copy(this.prev);
    this.prev.copy(pose);
    this.lastDt = dt;
  }

  sourceKey(v) {
    if (v.act && this.lib.has(v.act.clip)) return `act:${v.act.key || v.act.clip}`;
    switch (v.st) {
      case ST.air:
        // running off a small step: a brief fall (not a jump) stays in the gait; switching to the air pose and back
        // replanted both feet on landing (a pop)
        return v.vy < 1 && (v.stT ?? 1) < 0.18 && !(v.flipT >= 0) ? 'loco' : 'air';
      case ST.dash:
        return 'dash';
      case ST.wall:
        return 'wall';
      default:
        return 'loco';
    }
  }

  // ---------------------------------------------------------------- sources

  locoPose(dt, pose, v) {
    const g = this.gait;
    // landing squash (hips drop and recover; deeper and slower after a hard landing)
    if (v.landT < 0.02 && v.landV > 0) {
      this.landVel = -clamp(v.landV * 0.35, 1.2, v.hardLand ? 7 : 4.5);
    }
    // a spring pulls the squash back to 0
    const k = v.hardLand && v.landT < 0.3 ? 60 : 170, c = v.hardLand && v.landT < 0.3 ? 9 : 22;
    this.landVel += (-k * this.landSquash - c * this.landVel) * dt;
    this.landSquash = clamp(this.landSquash + this.landVel * dt, -0.32, 0.05);
    g.update(dt, pose, { vx: v.gvl ?? v.vl, vz: v.gvf ?? v.vf, yawRate: v.gyr ?? v.yawRate, sprint: v.sprint, skid: v.skid, crouch: -this.landSquash / 0.35 * 0.35 });
    // idle upper body from the mocap idle (breathing, weight shifts), faded out as the gait takes over
    const idleW = 1 - g.moving;
    if (this.idleClip && idleW > 0.01) {
      this.idleClip.sample(this.t, this.upper, this.rig.hipsY);
      pose.blend(this.upper, idleW * 0.85, UPPER_MASK, false);
      // keep the gait's own head/neck (look-at works on them) mixed in
    }
    // fighting stance over the idle when in a fight (locked on or just fought)
    this.fightW += ((v.combat ? 1 : 0) * idleW - this.fightW) * damp(6, dt);
    const stance = this.lib.get('stance');
    if (stance && this.fightW > 0.01) {
      stance.sample(this.t, this.upper, this.rig.hipsY);
      pose.blend(this.upper, this.fightW, UPPER_MASK, false);
    }
    // ninja run: arms swept back, body forward
    g.ninjaRun(pose, this.rig, g.ninja, this.t);
    // squash bends the body forward a little
    if (this.landSquash < -0.01) addEuler(pose, 'spine', -this.landSquash * 60, 0, 0);
  }

  airPose(dt, pose, v) {
    const rig = this.rig, g = this.gait;
    // rising vs falling, eased: a double jump flips the vertical speed in one tick (-1 to +9 m/s) and the legs and
    // arms snapped with it
    const riseT = ss(-3, 4, v.vy);
    this.rise = this.airT > 0 ? this.rise + (riseT - this.rise) * damp(14, dt) : riseT;
    const rise = this.rise;
    this.airT = (this.airT || 0) + dt;
    const push = (this.jumpPush || 0) * (1 - ss(0.03, 0.22, this.airT));
    const H = g.H0 * 0.97;
    pose.h[0] = 0;
    pose.h[1] = H + 0.03 * push;
    pose.h[2] = 0;
    const lean = lerp(6, 14, rise) + clamp(Math.hypot(v.vf, v.vl) * 0.8, 0, 8);
    setEuler(pose, 'hips', lean * 0.5, 0, 0);
    setEuler(pose, 'spine', lean * 0.3, 0, 0);
    setEuler(pose, 'chest', lerp(lerp(-4, 4, rise), -8, push), 0, 0);
    setEuler(pose, 'neck', -lean * 0.4, 0, 0);
    setEuler(pose, 'head', -lean * 0.3, 0, 0);
    // legs: rising = lead knee up, trail leg back; falling = both reach down for the ground
    const w = g.hipW;
    // (at push-off both legs hang extended under the hips, the right a little behind)
    const Lf = _v1.set(w * 0.9, lerp(lerp(0.14, 0.42, rise), 0.02, push) + g.ankleH, lerp(lerp(0.12, 0.3, rise), 0.02, push));
    const Rf = _v2.set(-w * 0.9, lerp(lerp(0.1, 0.24, rise), 0.05, push) + g.ankleH, lerp(lerp(-0.02, -0.28, rise), -0.1, push));
    const pole = _v3.set(0, 0.1, 1), flex = _v4.set(0, 0, -1);
    rig.twoBone(pose, BI.leftUpperLeg, BI.leftLowerLeg, BI.leftFoot, Lf, pole, flex);
    rig.twoBone(pose, BI.rightUpperLeg, BI.rightLowerLeg, BI.rightFoot, Rf, pole, flex);
    this.footFlat(pose, 'left', lerp(lerp(10, 25, rise), 55, push));
    this.footFlat(pose, 'right', lerp(lerp(15, 35, rise), 60, push));
    // arms: swung up and forward at push-off, up and back on the way up, out for balance on the way down
    const arm = (_arm.down = lerp(lerp(55, 45, rise), 30, push), (_arm.swing = lerp(lerp(10, -35, rise), 55, push)), (_arm.out = lerp(lerp(22, 8, rise), 12, push)), (_arm.elbow = lerp(lerp(35, 25, rise), 22, push)), (_arm.twist = 30), _arm);
    for (const side of ['left', 'right']) armAngles(rig, pose, side, arm);
    _v5.copy(Lf);
    _v6.copy(Rf);
    hand(pose, 'left', 0.3, 0.3);
    hand(pose, 'right', 0.3, 0.3);
    // double jump: a tucked front flip about the body's middle
    if (v.flipT >= 0 && v.flipT < 0.5) {
      const k = v.flipT / 0.46;
      const e = k < 1 ? k * k * (3 - 2 * k) : 1;
      const tuck = Math.sin(Math.min(1, k) * Math.PI);
      // the tuck blends in from the air pose over the first frames and back out at the end (applied at full weight
      // it snapped the legs and arms on the flip's first and last frame)
      const fw = ss(0, 0.07, v.flipT) * (1 - ss(0.42, 0.5, v.flipT));
      const Lt = _v1.set(w, lerp(0.42, 0.75, tuck), lerp(0.3, 0.32, tuck)).lerp(_v5, 1 - fw);
      const Rt = _v2.set(-w, lerp(0.24, 0.72, tuck), lerp(-0.2, 0.3, tuck)).lerp(_v6, 1 - fw);
      rig.twoBone(pose, BI.leftUpperLeg, BI.leftLowerLeg, BI.leftFoot, Lt, pole, flex);
      rig.twoBone(pose, BI.rightUpperLeg, BI.rightLowerLeg, BI.rightFoot, Rt, pole, flex);
      const fa = { down: lerp(arm.down, 70, fw), swing: lerp(arm.swing, 45 * tuck, fw), out: lerp(arm.out, 6, fw), elbow: lerp(arm.elbow, 70 * tuck + 20, fw), twist: lerp(30, 40, fw) };
      armAngles(rig, pose, 'left', fa);
      armAngles(rig, pose, 'right', fa);
      setEuler(pose, 'spine', lerp(lean * 0.3, 25 * tuck, fw), 0, 0);
      setEuler(pose, 'chest', lerp(lerp(lerp(-4, 4, rise), -8, push), 15 * tuck, fw), 0, 0);
      // rotate the whole body about the hips (a front flip turns the top forward: +X)
      preEuler(pose, 'hips', 360 * e, 0, 0);
      // lift the hips so the flip turns about the body's middle, not the hips joint
      pose.h[1] += 0.25 * tuck;
    }
  }

  footFlat(pose, side, pitch) {
    const rig = this.rig, lo = BI[`${side}LowerLeg`];
    rig.fkTo(pose, lo);
    const q = _qa.setFromEuler(_ea.set((pitch * Math.PI) / 180, 0, 0, 'YXZ'));
    // relative to the hips' facing (air poses tilt with the body)
    q.premultiply(rig.W[0]);
    pose.set(BI[`${side}Foot`], _qb.copy(rig.W[lo]).invert().multiply(q));
  }

  dashPose(dt, pose, v) {
    const rig = this.rig, g = this.gait;
    const [dx, dz] = v.dashLocal; // local direction (x = left, z = forward)
    const k = clamp(v.dashT / 0.28, 0, 1);
    const burst = Math.sin(Math.min(1, k * 1.3) * Math.PI * 0.5);
    const air = v.dashAir;
    pose.h[0] = 0;
    pose.h[1] = g.H0 * (air ? 0.95 : 0.82);
    pose.h[2] = 0;
    // lean into the dash direction (back steps lean back)
    const leanF = (v.dashBack ? -14 : 32 * dz) * burst;
    const leanS = -dx * 26 * burst; // +z roll leans right; dashing left (dx > 0) leans left
    setEuler(pose, 'hips', leanF * 0.5, 0, leanS * 0.5);
    setEuler(pose, 'spine', leanF * 0.3, 0, leanS * 0.3);
    setEuler(pose, 'chest', leanF * 0.2, 0, leanS * 0.2);
    setEuler(pose, 'neck', -leanF * 0.5, 0, -leanS * 0.4);
    setEuler(pose, 'head', -leanF * 0.3, 0, -leanS * 0.3);
    const w = g.hipW, pole = _v3.set(0, 0, 1), flex = _v4.set(0, 0, -1);
    // lunge: the lead foot toward the dash, the trailing leg stretched behind
    const lead = _v1.set(w + dx * 0.45, air ? 0.35 : 0.02, dz * 0.45);
    const trail = _v2.set(-w - dx * 0.5, air ? 0.25 : 0.06, -dz * 0.55);
    if (v.dashBack) {
      lead.set(w, 0.02, 0.25);
      trail.set(-w, 0.05, -0.5);
    }
    lead.y += g.ankleH;
    trail.y += g.ankleH;
    rig.twoBone(pose, BI.leftUpperLeg, BI.leftLowerLeg, BI.leftFoot, lead, pole, flex);
    rig.twoBone(pose, BI.rightUpperLeg, BI.rightLowerLeg, BI.rightFoot, trail, pole, flex);
    this.footFlat(pose, 'left', 0);
    this.footFlat(pose, 'right', 25);
    // arms swept back (the ninja dash), or forward on a back step
    for (const side of ['left', 'right']) {
      if (v.dashBack) armAngles(rig, pose, side, { down: 60, swing: 30, out: 20, elbow: 60, twist: 20 });
      else armAngles(rig, pose, side, { down: 86, swing: -48, out: 14, elbow: 6, twist: 80 });
      hand(pose, side, v.dashBack ? 0.6 : 0.1, 0.2, 4);
    }
  }

  wallPose(dt, pose, v) {
    const g = this.gait;
    // run on the wall as if it were the ground (the fighter's root is turned onto the wall plane)
    const sp = v.wallSpeed || 0;
    g.update(dt, pose, { vx: 0, vz: sp, yawRate: 0, sprint: true, crouch: 0 });
    g.ninjaRun(pose, this.rig, 1, this.t);
  }

  /**
   * An action clip at the time the gameplay says (v.act = { clip, t, dur?, upper?, key }): attacks, reactions,
   * guard, jutsu. `dur` stretches a clip to a gameplay duration (hitstun); `upper` plays it over the running legs.
   */
  actionPose(dt, pose, v) {
    const a = v.act, clip = this.lib.get(a.clip);
    let ct = a.t;
    if (a.dur && !clip.loop) ct = Math.min(clip.dur, (a.t / a.dur) * clip.dur);
    if (a.upper) {
      this.locoPose(dt, pose, v);
      clip.sample(ct, this.upper, this.rig.hipsY);
      pose.blend(this.upper, a.w ?? 1, UPPER_MASK, false);
      return;
    }
    pose.h[1] = this.rig.hipsY;
    clip.sample(ct, pose, this.rig.hipsY);
    // (the gait keeps its feet where they are: when the action ends it takes corrective steps if needed)
    this.gait.plant();
  }

  // ---------------------------------------------------------------- layers

  layers(dt, pose, v) {
    // hit flinch: a quick additive snap of the spine and head away from the hit
    if (this.flinch > 0) {
      const f = Math.sin(clamp(this.flinch, 0, 1) * Math.PI) * 14;
      addEuler(pose, 'spine', -f * 0.6, 0, this.flinchDir * f * 0.3);
      addEuler(pose, 'chest', -f * 0.5, 0, 0);
      addEuler(pose, 'neck', -f * 0.6, 0, 0);
      this.flinch -= dt * 4;
    }
  }

  // ---------------------------------------------------------------- output

  /** Writes the pose into the VRM's normalized bones (the VRM copies them to the raw skeleton in vrm.update). */
  apply() {
    const q = this.pose.q, nodes = this.nodes;
    for (let i = 0; i < NB; i++) {
      const n = nodes[i];
      if (!n) continue;
      const o = i * 4;
      n.quaternion.set(q[o], q[o + 1], q[o + 2], q[o + 3]);
    }
    const h = this.pose.h;
    nodes[0].position.set(h[0], h[1] + this.hipsOffsetY, h[2]);
  }
}

export { UPPER_MASK as UPPER };
