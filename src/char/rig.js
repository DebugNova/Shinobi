// The humanoid rig in VRM *normalized* space: every bone's rest rotation is identity, the character faces +Z, its
// left is +X, up is +Y (VRM 1.0). Poses are flat arrays (one quaternion per bone + the hips position), so blending,
// inertialization and IK work on plain numbers with no scene-graph traffic. A Rig reads the bone lengths of one VRM;
// clips are model independent (rotations only; the hips height is a fraction of the rest hips height).
import * as THREE from 'three';

export const BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'jaw', 'leftEye', 'rightEye',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
];
for (const s of ['left', 'right']) {
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    const seg = f === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    for (const g of seg) BONES.push(`${s}${f}${g}`);
  }
}
export const NB = BONES.length;
export const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
// canonical parents (the nearest humanoid ancestor); a model without an optional bone (upperChest, toes...) re-parents
export const PARENT_NAME = {
  spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck', jaw: 'head', leftEye: 'head', rightEye: 'head',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
  leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
};
for (const s of ['left', 'right']) {
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    const seg = f === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    seg.forEach((g, i) => (PARENT_NAME[`${s}${f}${g}`] = i ? `${s}${f}${seg[i - 1]}` : `${s}Hand`));
  }
}
export const LOWER = new Set(['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes']);

/** A pose: one quaternion per bone (x, y, z, w) and the hips position (character space, metres). */
export class Pose {
  constructor() {
    this.q = new Float32Array(NB * 4);
    this.h = new Float32Array(3);
    this.identity();
  }

  identity() {
    this.q.fill(0);
    for (let i = 0; i < NB; i++) this.q[i * 4 + 3] = 1;
    this.h.fill(0);
    return this;
  }

  copy(p) {
    this.q.set(p.q);
    this.h.set(p.h);
    return this;
  }

  /** this = lerp(this, p, w) per bone (nlerp, shortest arc). mask: optional Uint8Array (1 = blend this bone). */
  blend(p, w, mask = null, hips = true) {
    if (w <= 0) return this;
    const a = this.q, b = p.q;
    for (let i = 0; i < NB; i++) {
      if (mask && !mask[i]) continue;
      const o = i * 4;
      let bx = b[o], by = b[o + 1], bz = b[o + 2], bw = b[o + 3];
      if (a[o] * bx + a[o + 1] * by + a[o + 2] * bz + a[o + 3] * bw < 0) {
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
      }
      const x = a[o] + (bx - a[o]) * w, y = a[o + 1] + (by - a[o + 1]) * w, z = a[o + 2] + (bz - a[o + 2]) * w, ww = a[o + 3] + (bw - a[o + 3]) * w;
      const l = 1 / Math.sqrt(x * x + y * y + z * z + ww * ww);
      a[o] = x * l;
      a[o + 1] = y * l;
      a[o + 2] = z * l;
      a[o + 3] = ww * l;
    }
    if (hips) for (let k = 0; k < 3; k++) this.h[k] += (p.h[k] - this.h[k]) * w;
    return this;
  }

  /** Multiplies bone i's rotation by q on the right (local offset). */
  rotate(i, qx, qy, qz, qw) {
    const a = this.q, o = i * 4;
    const x = a[o], y = a[o + 1], z = a[o + 2], w = a[o + 3];
    a[o] = x * qw + w * qx + y * qz - z * qy;
    a[o + 1] = y * qw + w * qy + z * qx - x * qz;
    a[o + 2] = z * qw + w * qz + x * qy - y * qx;
    a[o + 3] = w * qw - x * qx - y * qy - z * qz;
  }

  /** Pre-multiplies bone i's rotation by q (rotation in the parent's frame). */
  prerotate(i, qx, qy, qz, qw) {
    const a = this.q, o = i * 4;
    const x = a[o], y = a[o + 1], z = a[o + 2], w = a[o + 3];
    a[o] = qw * x + qx * w + qy * z - qz * y;
    a[o + 1] = qw * y + qy * w + qz * x - qx * z;
    a[o + 2] = qw * z + qz * w + qx * y - qy * x;
    a[o + 3] = qw * w - qx * x - qy * y - qz * z;
  }

  get(i, out) {
    const o = i * 4;
    return out.set(this.q[o], this.q[o + 1], this.q[o + 2], this.q[o + 3]);
  }

  set(i, q) {
    const o = i * 4;
    this.q[o] = q.x;
    this.q[o + 1] = q.y;
    this.q[o + 2] = q.z;
    this.q[o + 3] = q.w;
  }
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

/**
 * One model's skeleton in normalized space: parents, rest offsets (bone i's position in its parent's frame), lengths.
 * Built from a loaded VRM (vrm.humanoid normalized rest pose) or from default proportions.
 */
export class Rig {
  constructor(vrm = null) {
    this.parent = new Int8Array(NB).fill(-1);
    this.has = new Uint8Array(NB);
    this.off = new Float32Array(NB * 3);
    if (vrm) this.fromVRM(vrm);
    else this.defaults();
    this.hipsY = this.off[1];
    // world (character space) FK buffers
    this.W = Array.from({ length: NB }, () => new THREE.Quaternion());
    this.P = Array.from({ length: NB }, () => new THREE.Vector3());
    const len = (a, b) => {
      const i = BI[b];
      return Math.hypot(this.off[i * 3], this.off[i * 3 + 1], this.off[i * 3 + 2]);
    };
    this.len = {
      upperArm: len('leftUpperArm', 'leftLowerArm'), lowerArm: len('leftLowerArm', 'leftHand'),
      upperLeg: len('leftUpperLeg', 'leftLowerLeg'), lowerLeg: len('leftLowerLeg', 'leftFoot'),
    };
    this.legLen = this.len.upperLeg + this.len.lowerLeg;
    this.armLen = this.len.upperArm + this.len.lowerArm;
    // rest height of the shoulder joint (keyed hand targets are placed relative to it: bodies differ in proportions)
    this.shoulderY = 0;
    for (let i = BI.leftUpperArm; i >= 0; i = i === 0 ? -1 : this.parent[i]) this.shoulderY += this.off[i * 3 + 1];
  }

  fromVRM(vrm) {
    const H = vrm.humanoid;
    const rest = H.normalizedRestPose;
    const nodes = BONES.map((b) => H.getNormalizedBoneNode(b));
    nodes.forEach((n, i) => (this.has[i] = n ? 1 : 0));
    this.nodes = nodes;
    // parents: the nearest humanoid ancestor that exists on this model
    for (let i = 0; i < NB; i++) {
      if (!this.has[i] || i === 0) continue;
      let p = PARENT_NAME[BONES[i]];
      while (p && !this.has[BI[p]]) p = PARENT_NAME[p];
      this.parent[i] = p ? BI[p] : 0;
    }
    // rest offsets: world rest positions of the normalized rig (rest rotations are identity, so parent-relative
    // offsets are plain differences of world positions)
    const world = new Map();
    for (let i = 0; i < NB; i++) {
      if (!this.has[i]) continue;
      const pos = rest[BONES[i]]?.position || nodes[i].position.toArray();
      const p = this.parent[i];
      const w = new THREE.Vector3().fromArray(pos);
      if (p >= 0 && i !== 0) w.add(world.get(p));
      world.set(i, w);
    }
    for (let i = 0; i < NB; i++) {
      if (!this.has[i]) continue;
      const w = world.get(i);
      const p = this.parent[i];
      const o = p >= 0 && i !== 0 ? w.clone().sub(world.get(p)) : w;
      this.off.set([o.x, o.y, o.z], i * 3);
    }
  }

  /** Generic anime proportions (only used when no model is loaded, e.g. tools). */
  defaults() {
    const D = {
      hips: [0, 0.9, 0], spine: [0, 0.08, 0], chest: [0, 0.11, 0], upperChest: [0, 0.11, 0], neck: [0, 0.12, 0], head: [0, 0.08, 0],
      leftUpperLeg: [0.08, -0.05, 0], leftLowerLeg: [0, -0.4, 0], leftFoot: [0, -0.39, 0], leftToes: [0, -0.05, 0.12],
      leftShoulder: [0.03, 0.08, 0], leftUpperArm: [0.08, 0, 0], leftLowerArm: [0.24, 0, 0], leftHand: [0.22, 0, 0],
    };
    for (let i = 0; i < NB; i++) {
      const b = BONES[i];
      const mirror = b.startsWith('right') ? 'left' + b.slice(5) : null;
      let o = D[b] || (mirror && D[mirror] ? [-D[mirror][0], D[mirror][1], D[mirror][2]] : null);
      if (!o) continue;
      this.has[i] = 1;
      this.off.set(o, i * 3);
      const p = PARENT_NAME[b];
      this.parent[i] = p ? BI[p] : -1;
    }
  }

  /** Forward kinematics of a pose: this.W (world rotations) and this.P (world positions), character space. */
  fk(pose) {
    const q = pose.q;
    for (let i = 0; i < NB; i++) {
      if (!this.has[i]) continue;
      const o = i * 4;
      _q.set(q[o], q[o + 1], q[o + 2], q[o + 3]);
      if (i === 0) {
        this.W[0].copy(_q);
        this.P[0].set(pose.h[0], pose.h[1], pose.h[2]);
        continue;
      }
      const p = this.parent[i];
      this.W[i].copy(this.W[p]).multiply(_q);
      this.P[i].fromArray(this.off, i * 3).applyQuaternion(this.W[p]).add(this.P[p]);
    }
  }

  /** FK of the chain from the hips to bone i only (cheaper: IK needs a limb's root frame). */
  fkTo(pose, i) {
    const chain = [];
    for (let b = i; b >= 0; b = b === 0 ? -1 : this.parent[b]) chain.push(b);
    for (let k = chain.length - 1; k >= 0; k--) {
      const b = chain[k], o = b * 4;
      _q.set(pose.q[o], pose.q[o + 1], pose.q[o + 2], pose.q[o + 3]);
      if (b === 0) {
        this.W[0].copy(_q);
        this.P[0].set(pose.h[0], pose.h[1], pose.h[2]);
      } else {
        const p = this.parent[b];
        this.W[b].copy(this.W[p]).multiply(_q);
        this.P[b].fromArray(this.off, b * 3).applyQuaternion(this.W[p]).add(this.P[p]);
      }
    }
  }

  /**
   * Two-bone IK: sets bones a (upper) and b (lower) of `pose` so that c (the end: hand or foot) reaches `target`
   * (character space), with the middle joint pointing toward `pole` (a direction). `flex` is the direction (rest
   * frame) the lower bone swings to when the joint bends: +Z for elbows (T-pose, palms down), -Z for knees.
   * Built basis to basis (aim + bend plane), so the limb never candy-wraps. `soft` keeps it off full extension.
   * Returns target distance / limb length (> 1 = out of reach).
   */
  twoBone(pose, a, b, c, target, pole, flex, soft = 0.015) {
    const pa = this.parent[a];
    this.fkTo(pose, a);
    const A = _A.copy(this.P[a]);
    const Wp = _Wp.copy(pa >= 0 ? this.W[pa] : _q3.identity());
    const l1 = Math.hypot(this.off[b * 3], this.off[b * 3 + 1], this.off[b * 3 + 2]);
    const l2 = Math.hypot(this.off[c * 3], this.off[c * 3 + 1], this.off[c * 3 + 2]);
    const toT = _v.copy(target).sub(A);
    let d = toT.length();
    const ratio = d / (l1 + l2);
    // soft IK: the last few centimetres of reach are approached exponentially, so a limb never locks straight and
    // then snaps back into a bend (a hard clamp made the knee freeze at full extension before touchdown and jump)
    const Lr = l1 + l2, sw = Lr * 0.03, ds = Lr * (1 - soft) - sw;
    if (d > ds) d = ds + sw * (1 - Math.exp(-(d - ds) / sw));
    d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
    const dir = toT.normalize();
    // the joint moves toward the pole, perpendicular to the limb line
    const pl = _v2.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (pl.lengthSq() < 1e-8) pl.set(0, 0, 1).addScaledVector(dir, -dir.z);
    pl.normalize();
    const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const E = _v3.copy(A).addScaledVector(dir, cosA * l1).addScaledVector(pl, sinA * l1);
    const T = _v4.copy(A).addScaledVector(dir, d);
    const u = _u.copy(E).sub(A).normalize();
    const f = _f.copy(T).sub(E).normalize();
    // Both bones turn about one hinge axis: the normal of the plane through the limb line and the pole. (Aligning the
    // rest "flex" direction with the bend side instead degenerates when the joint folds so far that the upper bone
    // is perpendicular to the limb line; with a shin longer than the thigh the sprint's heel kick passes through that
    // and the thigh twisted 180 degrees in one frame, knee cap backwards for half the stride.)
    const r1 = _r1.fromArray(this.off, b * 3).normalize();
    const r2 = _r2.fromArray(this.off, c * 3).normalize();
    const hr = _h0.crossVectors(r1, flex).normalize();
    const h = _h1.crossVectors(pl, dir).normalize();
    basisRot(r1, hr, u, h, _R1);
    basisRot(r2, hr, f, h, _R2);
    // local rotations: q_a = Wp^-1 R1, q_b = R1^-1 R2
    pose.set(a, _q.copy(Wp).invert().multiply(_R1));
    pose.set(b, _q2.copy(_R1).invert().multiply(_R2));
    return ratio;
  }
}

const _A = new THREE.Vector3(), _Wp = new THREE.Quaternion(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _s = new THREE.Vector3();
const _r1 = new THREE.Vector3(), _r2 = new THREE.Vector3(), _h0 = new THREE.Vector3(), _h1 = new THREE.Vector3();
const _R1 = new THREE.Quaternion(), _R2 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4();
const _a0 = new THREE.Vector3(), _b0 = new THREE.Vector3(), _c0 = new THREE.Vector3(), _a1 = new THREE.Vector3(), _b1 = new THREE.Vector3(), _c1 = new THREE.Vector3();

/** The rotation taking the frame (a0, b0) to (a1, b1) (b's are orthogonalized against a's). Writes out. */
export function basisRot(a0, b0, a1, b1, out) {
  _a0.copy(a0).normalize();
  _b0.copy(b0).addScaledVector(_a0, -b0.dot(_a0)).normalize();
  _c0.crossVectors(_a0, _b0);
  _a1.copy(a1).normalize();
  _b1.copy(b1).addScaledVector(_a1, -b1.dot(_a1)).normalize();
  _c1.crossVectors(_a1, _b1);
  _m0.makeBasis(_a0, _b0, _c0).transpose();
  _m1.makeBasis(_a1, _b1, _c1).multiply(_m0);
  return out.setFromRotationMatrix(_m1);
}
