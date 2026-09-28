// Hand-keyed animation: key poses described the way an animator thinks (hand and foot positions in the fighter's
// own frame, reached with IK, plus spine/head angles and the hips offset), eased between keys and baked into the same
// Clip format as the mocap library. Moves are keyed in frames (60 Hz) on their frame data, so a move's contact frame
// is its first active frame by construction.
//
// Pose spec (every field optional; missing ones fall back to the clip's `base` spec, then to the fighting stance):
//   h: [dx, dy, dz]         hips offset from the standing hips position (m)
//   hips, spine, chest, upperChest, neck, head: [x, y, z]   Euler degrees (YXZ): x bends forward, y twists left, z leans right
//   rot, tilt, roll: the whole body turned about the vertical (spins), the side axis (+ = forward flips) and the
//        forward axis (cartwheels), degrees, pivoting at the hips; limb targets turn with `rot` only
//   lh, rh: { p: [x, y, z], pole: [x, y, z], fist: 0..1, open: 0..1, wrist: [x, y, z],   hand targets (IK) in the
//        fingers: [index, middle, ring, little] curls (hand signs) }                     fighter frame
//        or { fk: { down, swing, out, elbow, twist }, fist }            arm by angles (see posekit.armAngles)
//   lf, rf: { p: [x, y, z], pole: [x, y, z], pitch: deg, yaw: deg }      ankle targets (IK)
// Fighter frame: origin at the feet, +z forward, +x the fighter's LEFT, +y up, metres for the stand-in's body (hips
// 0.908 m, shoulders 1.274 m, arm 0.435 m). The hips offset and feet scale with the model's hips height; hands keep
// their place relative to the shoulders (scaled by arm length), so a body with shorter legs or a longer torso still
// guards at the chin and punches at head height.
import * as THREE from 'three';
import { Pose, BI, NB } from './rig.js';
import { Clip } from './clips.js';
import { setEuler, armAngles, hand } from './posekit.js';

const REF_HIPS = 0.908, REF_SHOULDER = 1.2742, REF_ARM = 0.4345;
const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const FLEX_ARM = new THREE.Vector3(0, 0, 1), FLEX_LEG = new THREE.Vector3(0, 0, -1);

// easing between keys: 'lin', 'in' (accelerate), 'out' (decelerate), 'io' (smooth), 'snap' (very fast out: strikes)
const EASE = {
  lin: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  io: (t) => t * t * (3 - 2 * t),
  snap: (t) => 1 - Math.pow(1 - t, 3.2),
  hold: () => 0,
};

/** The fighting stance: sideways-ish, left foot forward, fists up. Everything else is written relative to it. */
export const STANCE = {
  h: [0, -0.06, 0],
  hips: [4, -22, 0],
  spine: [4, 8, 0],
  chest: [4, 8, 0],
  upperChest: [0, 4, 0],
  neck: [-4, 4, 0],
  head: [-4, 6, 0],
  lh: { p: [0.13, 1.28, 0.3], pole: [1, -1, -0.4], fist: 0.9 },
  rh: { p: [-0.08, 1.2, 0.18], pole: [-1, -1, -0.5], fist: 0.9 },
  lf: { p: [0.16, 0, 0.2], pole: [0.3, 0, 1], yaw: -10 },
  rf: { p: [-0.16, 0, -0.2], pole: [0, 0, 1], yaw: 25 },
};

function merge(base, spec) {
  const o = { ...base };
  for (const k in spec) {
    const v = spec[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) o[k] = { ...base[k], ...v };
    else o[k] = v;
  }
  return o;
}

/**
 * Writes a pose spec into `pose` for `rig`. H0 = the standing hips height (gait) for this rig.
 */
export function buildPose(rig, pose, spec, H0) {
  const k = rig.hipsY / REF_HIPS;
  pose.identity();
  // `rot`: the whole pose turned about the vertical (spins), `tilt`: about the side axis (flips, lying down)
  const rot = ((spec.rot || 0) * Math.PI) / 180, cr = Math.cos(rot), sr = Math.sin(rot);
  const R = (a) => [a[0] * cr + a[2] * sr, a[1], -a[0] * sr + a[2] * cr];
  const h = R(spec.h || [0, 0, 0]);
  pose.h[0] = h[0] * k;
  pose.h[1] = H0 + h[1] * k;
  pose.h[2] = h[2] * k;
  for (const b of ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head']) {
    const r = spec[b];
    if (r) setEuler(pose, b, r[0], r[1], r[2]);
  }
  if (rot) {
    _q.setFromAxisAngle(_v.set(0, 1, 0), rot);
    pose.prerotate(BI.hips, _q.x, _q.y, _q.z, _q.w);
  }
  if (spec.tilt) {
    _q.setFromAxisAngle(_v.set(1, 0, 0), (spec.tilt * Math.PI) / 180);
    pose.prerotate(BI.hips, _q.x, _q.y, _q.z, _q.w);
  }
  // `roll`: about the forward axis (cartwheels; + rolls toward the fighter's right)
  if (spec.roll) {
    _q.setFromAxisAngle(_v.set(0, 0, 1), (spec.roll * Math.PI) / 180);
    pose.prerotate(BI.hips, _q.x, _q.y, _q.z, _q.w);
  }
  const rs = (L) => (rot && L ? { ...L, p: L.p && R(L.p), pole: L.pole && R(L.pole), yaw: (L.yaw || 0) + (spec.rot || 0) } : L);
  spec = { ...spec, lf: rs(spec.lf), rf: rs(spec.rf), lh: rs(spec.lh), rh: rs(spec.rh) };
  // legs first (they hang from the hips), then arms (from the chest)
  for (const [key, side] of [['lf', 'left'], ['rf', 'right']]) {
    const L = spec[key];
    if (!L) continue;
    _p.set(L.p[0] * k, L.p[1] * k, L.p[2] * k);
    // the spec gives the contact point; the ankle sits above it (pitching the foot raises it around the toes)
    const ankle = 0.1 * k;
    _p.y += ankle;
    _v.set(...(L.pole || [0, 0, 1]));
    rig.twoBone(pose, BI[`${side}UpperLeg`], BI[`${side}LowerLeg`], BI[`${side}Foot`], _p, _v, FLEX_LEG);
    // foot orientation in the fighter frame (flat by default)
    const lo = BI[`${side}LowerLeg`];
    rig.fkTo(pose, lo);
    _e.set(((L.pitch || 0) * Math.PI) / 180, ((L.yaw || 0) * Math.PI) / 180, 0, 'YXZ');
    _q.setFromEuler(_e);
    pose.set(BI[`${side}Foot`], rig.W[lo].clone().invert().multiply(_q));
    if (L.toes) setEuler(pose, `${side}Toes`, L.toes, 0, 0);
  }
  for (const [key, side] of [['lh', 'left'], ['rh', 'right']]) {
    const A = spec[key];
    if (!A) continue;
    if (A.fk) armAngles(rig, pose, side, A.fk);
    else if (A.p) {
      // relative to the shoulders where the hips offset puts them (the stand-in's and this body's), scaled by arm length
      const kA = rig.armLen / REF_ARM;
      const sh = pose.h[1] + rig.shoulderY - rig.hipsY, shRef = pose.h[1] / k + REF_SHOULDER - REF_HIPS;
      _p.set(h[0] * k + (A.p[0] - h[0]) * kA, sh + (A.p[1] - shRef) * kA, h[2] * k + (A.p[2] - h[2]) * kA);
      _v.set(...(A.pole || [side === 'left' ? 1 : -1, -1, -0.5]));
      rig.twoBone(pose, BI[`${side}UpperArm`], BI[`${side}LowerArm`], BI[`${side}Hand`], _p, _v, FLEX_ARM);
      if (A.wrist) setEuler(pose, `${side}Hand`, A.wrist[0], A.wrist[1], A.wrist[2]);
    }
    hand(pose, side, A.open !== undefined ? 1 - A.open : A.fist ?? 0.85, A.thumb ?? (A.open !== undefined ? 0.2 : 0.7), A.spread || 0, A.fingers || null);
  }
  return pose;
}

/**
 * Bakes a keyed clip. def: { base: spec (defaults for every key), keys: [[frame, spec, ease], ...], loop, fps: 60 }
 * Returns a Clip (sampled at 60 fps).
 */
export function bakeClip(rig, id, def, H0) {
  const base = merge(STANCE, def.base || {});
  const keys = def.keys.map(([f, spec, ease]) => ({ f, pose: buildPose(rig, new Pose(), merge(base, spec || {}), H0), ease: EASE[ease || 'io'] }));
  const last = keys[keys.length - 1].f;
  const n = last + 1;
  const tracks = new Map();
  for (let b = 0; b < NB; b++) if (rig.has[b]) tracks.set(b, new Float32Array(n * 4));
  const hips = new Float32Array(n * 3);
  const tmp = new Pose();
  for (let f = 0; f < n; f++) {
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].f <= f) i++;
    const a = keys[i], b = keys[Math.min(keys.length - 1, i + 1)];
    const t = b.f > a.f ? Math.max(0, Math.min(1, (f - a.f) / (b.f - a.f))) : 0;
    tmp.copy(a.pose).blend(b.pose, b.ease(t));
    for (const [bi, arr] of tracks) arr.set(tmp.q.subarray(bi * 4, bi * 4 + 4), f * 4);
    hips[f * 3] = tmp.h[0] / rig.hipsY;
    hips[f * 3 + 1] = tmp.h[1] / rig.hipsY;
    hips[f * 3 + 2] = tmp.h[2] / rig.hipsY;
  }
  return new Clip({ id, dur: last / 60, n, fps: 60, tracks, hips, loop: !!def.loop, speed: 0, hy: rig.hipsY, authored: true });
}

export { merge, EASE };
