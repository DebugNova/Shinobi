// Pose-building helpers on the normalized rig: Euler rotations for the spine chain, limbs set by direction + bend
// (forward kinematics) or by end position (IK, Rig.twoBone), finger curls. Used by the procedural gait, the
// authored keyframe clips and runtime layers (lean, look, flinch).
//
// Normalized space: rest rotations are identity; the model faces +Z, its left is +X, up is +Y.
//   spine chain: +X rotation bends forward, +Y twists toward the left, +Z leans to the right
//   arms rest along +-X (T-pose, palms down); elbows flex toward +Z; legs rest along -Y, knees flex toward -Z.
import * as THREE from 'three';
import { BI, basisRot } from './rig.js';

const D = Math.PI / 180;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _r = new THREE.Vector3(), _f = new THREE.Vector3(), _h = new THREE.Vector3(), _d = new THREE.Vector3(), _s = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** Sets bone `name` to an Euler rotation (degrees, order YXZ: twist, then bend, then side). */
export function setEuler(pose, name, x = 0, y = 0, z = 0) {
  const i = BI[name];
  _e.set(x * D, y * D, z * D, 'YXZ');
  pose.set(i, _q.setFromEuler(_e));
}

/** Multiplies bone `name` by an Euler rotation (degrees, YXZ) in its own frame. */
export function addEuler(pose, name, x = 0, y = 0, z = 0) {
  if (!x && !y && !z) return;
  const i = BI[name];
  _e.set(x * D, y * D, z * D, 'YXZ');
  _q.setFromEuler(_e);
  pose.rotate(i, _q.x, _q.y, _q.z, _q.w);
}

/** Pre-multiplies bone `name` by an Euler rotation (degrees, YXZ) in its parent's frame. */
export function preEuler(pose, name, x = 0, y = 0, z = 0) {
  if (!x && !y && !z) return;
  const i = BI[name];
  _e.set(x * D, y * D, z * D, 'YXZ');
  _q.setFromEuler(_e);
  pose.prerotate(i, _q.x, _q.y, _q.z, _q.w);
}

/**
 * A limb by forward kinematics. upper/lower: bone names; dir: where the upper bone points (in its parent's frame,
 * any length); side: the direction the lower bone swings to when the joint bends (parent frame); bend: joint angle
 * (degrees, 0 = straight); twist: roll of the lower bone about its own axis (degrees: turns the hand/foot).
 */
export function limbFK(rig, pose, upper, lower, end, dir, side, bend, twist = 0) {
  const a = BI[upper], b = BI[lower], c = BI[end];
  _r.fromArray(rig.off, b * 3).normalize();
  const flexRest = /Leg/.test(upper) ? _f.set(0, 0, -1) : _f.set(0, 0, 1);
  _d.copy(dir).normalize();
  _s.copy(side);
  basisRot(_r, flexRest, _d, _s, _q);
  pose.set(a, _q);
  // lower bone: twist about its own axis, then flex about the hinge (rest frame)
  const r2 = _d.fromArray(rig.off, c * 3).normalize();
  _h.crossVectors(_r, flexRest).normalize();
  _q.setFromAxisAngle(_h, bend * D);
  if (twist) _q.multiply(_q2.setFromAxisAngle(r2, twist * D));
  pose.set(b, _q);
}

/**
 * Arm by FK from intuitive angles (degrees): down = how far the arm drops from the T-pose (90 = hanging),
 * swing = forward (+) / back (-) about the shoulder, out = away from the body (+), elbow = bend, twist = forearm roll
 * (+ = palm turns forward... toward the body for a hanging arm), side 'left' | 'right'.
 */
export function armAngles(rig, pose, side, { down = 75, swing = 0, out = 0, elbow = 20, twist = 0, lift = 0 }) {
  const s = side === 'left' ? 1 : -1;
  // start from the T-pose direction, drop it, then swing forward/back about the side axis
  const dn = (down - out) * D;
  const sw = swing * D;
  // direction: in the frontal plane first (x = cos(dn) outward, y = -sin(dn)), then swing about X (forward)
  const x0 = Math.cos(dn) * s, y0 = -Math.sin(dn);
  const dir = _d.set(x0, y0 * Math.cos(sw), -y0 * Math.sin(sw));
  // elbow bends forward-and-up relative to the arm (lift raises the flex side toward up)
  const sideV = _s.set(0, lift * 0.01, 1).addScaledVector(dir, -(lift * 0.01 * dir.y + dir.z));
  limbFK(rig, pose, `${side}UpperArm`, `${side}LowerArm`, `${side}Hand`, dir.clone(), sideV.clone(), elbow, twist * s);
}

/**
 * Leg by FK: pitch = thigh forward (+) / back (-) from hanging, splay = outward (+), knee = bend (degrees).
 */
export function legAngles(rig, pose, side, { pitch = 0, splay = 0, knee = 0, twist = 0 }) {
  const s = side === 'left' ? 1 : -1;
  const p = pitch * D, sp = splay * D;
  const dir = _d.set(Math.sin(sp) * s, -Math.cos(p) * Math.cos(sp), Math.sin(p) * Math.cos(sp));
  const sideV = _s.set(0, 0, -1).addScaledVector(dir, -(-dir.z));
  limbFK(rig, pose, `${side}UpperLeg`, `${side}LowerLeg`, `${side}Foot`, dir.clone(), sideV.clone(), knee, twist * s);
}

/** Curls the fingers of one hand: 0 = open, 1 = fist. thumb: 0..1 separately. spread: degrees apart. */
export function hand(pose, side, curl = 0.6, thumb = null, spread = 0, each = null) {
  const s = side === 'left' ? -1 : 1; // curl toward the palm: -Z for the left hand, +Z for the right
  const fingers = ['Index', 'Middle', 'Ring', 'Little'];
  fingers.forEach((f, k) => {
    // each: per-finger curls [index, middle, ring, little] (hand signs: the Tiger's index + middle straight)
    const c = (each ? each[k] : curl) * (1 + k * 0.06);
    const sp = (k - 1.5) * spread;
    setEuler(pose, `${side}${f}Proximal`, 0, sp * -s, s * c * 85);
    setEuler(pose, `${side}${f}Intermediate`, 0, 0, s * c * 100);
    setEuler(pose, `${side}${f}Distal`, 0, 0, s * c * 70);
  });
  const t = thumb ?? curl;
  // the thumb folds across the palm (down and toward the fingers)
  setEuler(pose, `${side}ThumbMetacarpal`, t * 20, s * -t * 25, s * t * 25);
  setEuler(pose, `${side}ThumbProximal`, 0, s * -t * 30, s * t * 20);
  setEuler(pose, `${side}ThumbDistal`, 0, s * -t * 35, 0);
}

export const DEG = D;
export { X, Y, Z };
