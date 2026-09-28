// Hurtboxes and hitboxes: capsules on the *drawn* skeleton (what you see is what can be hit), rebuilt every frame
// after the fighter's pose is applied. Attack hitboxes are capsules between two bones, extended past the second
// (fist, foot), swept from last frame's position to this one so fast strikes never pass through a target.
import * as THREE from 'three';
import { BI } from '../char/rig.js';

const _gz = new THREE.Vector3(), _gk = new THREE.Vector3();
/**
 * Something held in a fist (the scroll of the Scroll Rush): its segment along the fist's grip axis, in character space,
 * from a rig after fk(). In the normalized hand frame the thumb side is +Z, so a gripped object runs along the hand's
 * +Z through the fist (between the wrist and the middle knuckle, a little to the palm side). The hitbox (Combat.hitboxAt)
 * and the drawn prop (movefx) both come from here. box: { grip: hand bone name, len: past the thumb, back: past the
 * little finger } (metres).
 */
export function gripSegment(rig, box, outA, outB) {
  const hb = BI[box.grip], W = rig.W[hb], mp = BI[box.grip.replace('Hand', 'MiddleProximal')];
  if (mp !== undefined && rig.has[mp]) _gk.fromArray(rig.off, mp * 3).multiplyScalar(0.7);
  else _gk.set(box.grip.startsWith('left') ? 0.07 : -0.07, 0, 0);
  _gk.y -= 0.025;
  _gk.applyQuaternion(W).add(rig.P[hb]);
  _gz.set(0, 0, 1).applyQuaternion(W);
  outA.copy(_gk).addScaledVector(_gz, -box.back);
  outB.copy(_gk).addScaledVector(_gz, box.len);
}

// [bone a, bone b, radius, part]
const CAPS = [
  ['hips', 'upperChest', 0.17, 'body'],
  ['upperChest', 'neck', 0.15, 'body'],
  ['leftUpperArm', 'leftLowerArm', 0.065, 'limb'],
  ['leftLowerArm', 'leftHand', 0.055, 'limb'],
  ['rightUpperArm', 'rightLowerArm', 0.065, 'limb'],
  ['rightLowerArm', 'rightHand', 0.055, 'limb'],
  ['leftUpperLeg', 'leftLowerLeg', 0.09, 'limb'],
  ['leftLowerLeg', 'leftFoot', 0.07, 'limb'],
  ['rightUpperLeg', 'rightLowerLeg', 0.09, 'limb'],
  ['rightLowerLeg', 'rightFoot', 0.07, 'limb'],
];
const HEAD_R = 0.13;

export class Hurtbox {
  constructor(vrm) {
    const H = vrm.humanoid;
    const node = (n) => H.getRawBoneNode(n) || H.getNormalizedBoneNode(n);
    this.nodes = {};
    for (const [a, b] of CAPS) {
      this.nodes[a] ||= node(a) || node(a === 'upperChest' ? 'chest' : a);
      this.nodes[b] ||= node(b) || node(b === 'upperChest' ? 'chest' : b);
    }
    this.nodes.head = node('head');
    this.caps = CAPS.map(([a, b, r, part]) => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), r, part, na: a, nb: b }));
    this.caps.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: HEAD_R, part: 'head', na: 'head', nb: 'head' });
    this.center = new THREE.Vector3();
    this.valid = false;
  }

  update() {
    for (const c of this.caps) {
      if (c.part === 'head') {
        this.nodes.head.getWorldPosition(c.a);
        c.a.y += 0.07;
        c.b.copy(c.a);
        c.b.y += 0.04;
        continue;
      }
      this.nodes[c.na].getWorldPosition(c.a);
      this.nodes[c.nb].getWorldPosition(c.b);
    }
    this.center.copy(this.caps[0].a).add(this.caps[0].b).multiplyScalar(0.5);
    this.valid = true;
  }
}

/** A simple standing capsule (the training dummy). */
export class PostHurtbox {
  constructor(x, y, z) {
    this.caps = [{ a: new THREE.Vector3(x, y + 0.2, z), b: new THREE.Vector3(x, y + 1.45, z), r: 0.3, part: 'body' }];
    this.center = new THREE.Vector3(x, y + 0.9, z);
    this.valid = true;
  }

  update() {}
}

const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();

/** Closest points between segments p1-q1 and p2-q2. Writes c1, c2; returns the squared distance. */
export function segSeg(p1, q1, p2, q2, c1, c2) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) {
    c1.copy(p1);
    c2.copy(p2);
    return c1.distanceToSquared(c2);
  }
  if (a <= 1e-9) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = _d1.dot(_d2), den = a * e - b * b;
      s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  c1.copy(p1).addScaledVector(_d1, s);
  c2.copy(p2).addScaledVector(_d2, t);
  return c1.distanceToSquared(c2);
}

const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();

/**
 * A swept hitbox capsule (a0-b0 last frame, a1-b1 now, radius r) against a hurtbox. Tested at `steps` interpolated
 * positions. Returns the contact point (written to out) or null.
 */
export function sweptHit(a0, b0, a1, b1, r, hb, out, steps = 4) {
  let best = Infinity;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    _pa.lerpVectors(a0, a1, k);
    _pb.lerpVectors(b0, b1, k);
    for (const c of hb.caps) {
      const d2 = segSeg(_pa, _pb, c.a, c.b, _c1, _c2);
      const R = r + c.r;
      if (d2 <= R * R && d2 < best) {
        best = d2;
        out.copy(_c1).add(_c2).multiplyScalar(0.5);
        out.part = c.part;
      }
    }
    if (best < Infinity) return out;
  }
  return null;
}
