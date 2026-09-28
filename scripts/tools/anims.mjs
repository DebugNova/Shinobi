// npm run anims: converts the Mixamo FBX downloads in mixamo/ into one compact clip library the game loads,
//   public/assets/anims/clips.json
// in VRM *normalized humanoid* space (three-vrm's normalized bones: every bone's rest rotation is identity), so any
// VRM plays the clips as they are, with no per-model retargeting. Conversion follows the official three-vrm
// "load Mixamo animation" example: normalized local = parentRestWorld * local * restWorld^-1, and the hips position
// is stored relative to the source rig's rest hips height (the game multiplies by the VRM's own hips height).
//
// Sources, in order: mixamo/<id>.fbx (see ASSETS.md for the names), then mixamo/base/armory-humanoid.json (ARMORY's
// ten mocap clips, the starter set). Clips downloaded "In Place" get their ground speed from the planted foot;
// each clip reports its length, measured speed and gait phase (phase 0 = left foot furthest ahead).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

globalThis.window = globalThis; // FBXLoader reads window for a couple of feature checks
const DIR = 'mixamo';
const BASE = 'mixamo/base/armory-humanoid.json';
const OUT = 'public/assets/anims/clips.json';
const FPS = 30;

// clip id -> loop / in place. File names are the ids (mixamo/<id>.fbx), see ASSETS.md.
const CLIPS = {
  fight_idle: { loop: true }, idle: { loop: true }, walk: { loop: true }, run: { loop: true }, sprint: { loop: true },
  run_start: {}, run_stop: {}, turn180: {}, strafe_l: { loop: true }, strafe_r: { loop: true }, run_back: { loop: true },
  jump: {}, fall: { loop: true }, land: {}, land_hard: {}, flip: {},
  dodge_l: {}, dodge_r: {}, dodge_back: {}, roll: {},
  jab: {}, cross: {}, hook: {}, uppercut: {}, knee: {}, spin_kick: {}, roundhouse: {}, axe_kick: {}, flying_kick: {}, kunai: {},
  block: { loop: true }, block_hit: {}, hit_head: {}, hit_body: {}, hit_left: {}, hit_right: {}, stagger: {},
  knock_back: { inPlace: false }, knockdown: { inPlace: false }, getup: {}, kipup: {}, ko: { inPlace: false },
  throw: {}, charge: { loop: true }, victory: {}, taunt: {},
};
// ARMORY's starter clips, renamed to ours (only those a ninja can use)
const BASE_MAP = { runRelaxed: 'run', walk: 'walk', idleRelaxed: 'idle', strafeR: 'strafe_r_walk', strafeL: 'strafe_l_walk', jumpDown: 'fall_pose', taunt: 'taunt', run: 'run_rifle' };

// Mixamo bone -> VRM humanoid bone
const MAP = {
  Hips: 'hips', Spine: 'spine', Spine1: 'chest', Spine2: 'upperChest', Neck: 'neck', Head: 'head',
  LeftShoulder: 'leftShoulder', LeftArm: 'leftUpperArm', LeftForeArm: 'leftLowerArm', LeftHand: 'leftHand',
  RightShoulder: 'rightShoulder', RightArm: 'rightUpperArm', RightForeArm: 'rightLowerArm', RightHand: 'rightHand',
  LeftUpLeg: 'leftUpperLeg', LeftLeg: 'leftLowerLeg', LeftFoot: 'leftFoot', LeftToeBase: 'leftToes',
  RightUpLeg: 'rightUpperLeg', RightLeg: 'rightLowerLeg', RightFoot: 'rightFoot', RightToeBase: 'rightToes',
};
for (const side of ['Left', 'Right']) {
  const s = side.toLowerCase();
  const fingers = { Thumb: ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'], Index: ['IndexProximal', 'IndexIntermediate', 'IndexDistal'], Middle: ['MiddleProximal', 'MiddleIntermediate', 'MiddleDistal'], Ring: ['RingProximal', 'RingIntermediate', 'RingDistal'], Pinky: ['LittleProximal', 'LittleIntermediate', 'LittleDistal'] };
  for (const [f, names] of Object.entries(fingers)) names.forEach((n, i) => (MAP[`${side}Hand${f}${i + 1}`] = `${s}${n}`));
}
const vrmName = (mixamo) => MAP[mixamo.replace(/^mixamorig:?/, '')] || null;

const r4 = (x) => Math.round(x * 1e4) / 1e4;

// ---------------------------------------------------------------- a source rig: rest pose + per-frame local rotations

/** A rig description: bones [{ name (mixamo, no prefix), parent, p, q }] in metres. */
class Rig {
  constructor(bones) {
    this.bones = bones;
    this.index = new Map(bones.map((b, i) => [b.name, i]));
    // rest world rotations and positions (root = identity)
    this.RW = [];
    this.PW = [];
    bones.forEach((b, i) => {
      const q = new THREE.Quaternion().fromArray(b.q);
      const p = new THREE.Vector3().fromArray(b.p);
      if (b.parent >= 0) {
        this.RW[i] = this.RW[b.parent].clone().multiply(q);
        this.PW[i] = p.applyQuaternion(this.RW[b.parent]).add(this.PW[b.parent]);
      } else {
        this.RW[i] = q;
        this.PW[i] = p;
      }
    });
    this.hipsY = this.PW[this.index.get('Hips')].y;
  }

  /** World positions of a frame (local rotations q[i], hips position) for foot measurements. */
  fk(q, hips) {
    const W = [], P = [];
    this.bones.forEach((b, i) => {
      if (b.parent < 0) {
        W[i] = q[i].clone();
        P[i] = hips.clone();
      } else {
        W[i] = W[b.parent].clone().multiply(q[i]);
        P[i] = new THREE.Vector3().fromArray(b.p).applyQuaternion(W[b.parent]).add(P[b.parent]);
      }
    });
    return P;
  }
}

// ---------------------------------------------------------------- readers

function readBase() {
  if (!fs.existsSync(BASE)) return { rig: null, clips: {} };
  const j = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  const rig = new Rig(j.bones.map((b) => ({ name: b.name.replace(/^mixamorig/, ''), parent: b.parent, p: b.p, q: b.q })));
  const clips = {};
  for (const [src, id] of Object.entries(BASE_MAP)) {
    const c = j.clips[src];
    if (!c) continue;
    const frames = [];
    for (let f = 0; f < c.n; f++) {
      const q = rig.bones.map((b) => {
        const v = c.q[`mixamorig${b.name}`];
        if (!v) return new THREE.Quaternion().fromArray(b.q);
        const o = v.length === 4 ? 0 : f * 4;
        return new THREE.Quaternion(v[o], v[o + 1], v[o + 2], v[o + 3]);
      });
      frames.push({ q, hips: new THREE.Vector3(c.hips[f * 3], c.hips[f * 3 + 1], c.hips[f * 3 + 2]) });
    }
    clips[id] = { rig, frames, loop: c.loop, src: `ARMORY ${c.src}`, speed: c.speed, dir: c.dir, phase0: c.phase0, inPlace: true };
  }
  return { rig, clips };
}

function readFBX(file) {
  const buf = fs.readFileSync(file);
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const bones = [];
  obj.traverse((o) => o.isBone && bones.push(o));
  // FBX from Mixamo is in centimetres
  const rig = new Rig(bones.map((b) => ({ name: b.name.replace(/^mixamorig:?/, ''), parent: bones.indexOf(b.parent), p: b.position.toArray().map((x) => x * 0.01), q: b.quaternion.toArray() })));
  const clip = obj.animations.find((a) => a.name === 'mixamo.com') || obj.animations[0];
  if (!clip) throw new Error('no animation');
  const mixer = new THREE.AnimationMixer(obj);
  const act = mixer.clipAction(clip);
  act.setLoop(THREE.LoopOnce); // hold the last frame: a looping action wraps setTime(duration) back to frame 0
  act.clampWhenFinished = true;
  act.play();
  const n = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const hipsBone = bones.find((b) => /Hips$/.test(b.name));
  const frames = [];
  for (let i = 0; i < n; i++) {
    mixer.setTime(Math.min(clip.duration, i / FPS));
    frames.push({ q: bones.map((b) => b.quaternion.clone()), hips: hipsBone.position.clone().multiplyScalar(0.01) });
  }
  return { rig, frames };
}

// ---------------------------------------------------------------- measure + convert

function convert(id, cfg, rig, frames, meta = {}) {
  const n = frames.length;
  const dur = (n - 1) / FPS;
  const L = rig.index.get('LeftFoot'), R = rig.index.get('RightFoot');
  const feet = frames.map((fr) => {
    const P = rig.fk(fr.q, fr.hips);
    return { lf: P[L], rf: P[R] };
  });
  const h0 = frames[0].hips, h1 = frames[n - 1].hips;
  const travel = new THREE.Vector3(h1.x - h0.x, 0, h1.z - h0.z);
  let speed = meta.speed ?? travel.length() / dur;
  let dir = meta.dir ?? (speed > 0.05 ? [travel.x / travel.length(), travel.z / travel.length()] : [0, 0]);
  if (meta.speed === undefined && speed <= 0.05 && cfg.loop) {
    // "In Place": the planted (lowest) foot slides backward under the body at the ground speed
    const v = new THREE.Vector3();
    let m = 0;
    const low = Math.min(...feet.map((f) => Math.min(f.lf.y, f.rf.y)));
    for (let i = 1; i < n; i++) {
      for (const k of ['lf', 'rf']) {
        const a = feet[i - 1][k], b = feet[i][k];
        if (Math.max(a.y, b.y) > low + 0.03) continue;
        v.x -= (b.x - a.x) * FPS;
        v.z -= (b.z - a.z) * FPS;
        m++;
      }
    }
    if (m) v.divideScalar(m);
    speed = Math.hypot(v.x, v.z);
    dir = speed > 0.05 ? [v.x / speed, v.z / speed] : [0, 0];
  }
  const inPlace = cfg.inPlace !== false;
  if (inPlace && !meta.inPlace) {
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      frames[i].hips = frames[i].hips.clone();
      frames[i].hips.x -= h0.x + travel.x * k;
      frames[i].hips.z -= h0.z + travel.z * k;
      for (const p of [feet[i].lf, feet[i].rf]) {
        p.x -= h0.x + travel.x * k;
        p.z -= h0.z + travel.z * k;
      }
    }
  }
  let phase0 = meta.phase0 ?? 0;
  if (meta.phase0 === undefined && speed > 0.05) {
    let best = -1e9;
    feet.forEach((f, i) => {
      const s = (f.lf.x - f.rf.x) * dir[0] + (f.lf.z - f.rf.z) * dir[1];
      if (s > best) {
        best = s;
        phase0 = i / (n - 1);
      }
    });
  }
  // lowest foot height over the clip (relative to the hips rest height): the game plants it on the ground
  const footLow = Math.min(...feet.map((f) => Math.min(f.lf.y, f.rf.y)));

  // rotations into normalized space: parentRestWorld * local * restWorld^-1
  const q = {};
  const tmp = new THREE.Quaternion();
  rig.bones.forEach((b, i) => {
    const vn = vrmName(b.name);
    if (!vn) return;
    const P = b.parent >= 0 ? rig.RW[b.parent] : new THREE.Quaternion();
    const Ri = rig.RW[i].clone().invert();
    const arr = [];
    let moving = false, first = null;
    for (const fr of frames) {
      tmp.copy(P).multiply(fr.q[i]).multiply(Ri);
      if (tmp.w < 0) tmp.set(-tmp.x, -tmp.y, -tmp.z, -tmp.w); // keep one hemisphere so keys interpolate the short way
      if (first && tmp.dot(first) < 0) tmp.set(-tmp.x, -tmp.y, -tmp.z, -tmp.w);
      if (!first) first = tmp.clone();
      else if (tmp.angleTo(first) > 1e-3) moving = true;
      arr.push(r4(tmp.x), r4(tmp.y), r4(tmp.z), r4(tmp.w));
    }
    q[vn] = moving ? arr : arr.slice(0, 4);
  });
  // hips position, as a fraction of the source rig's rest hips height
  const h = [];
  for (const fr of frames) h.push(r4(fr.hips.x / rig.hipsY), r4(fr.hips.y / rig.hipsY), r4(fr.hips.z / rig.hipsY));
  return {
    clip: { src: meta.src || id, loop: !!cfg.loop, dur: r4(dur), n, hy: r4(rig.hipsY), speed: r4(speed), dir: dir.map(r4), phase0: r4(phase0), foot: r4(footLow / rig.hipsY), q, h },
    line: `  ${id.padEnd(14)} ${(meta.src || id).padEnd(28)} ${dur.toFixed(2)}s  ${speed.toFixed(2)} m/s  phase0 ${phase0.toFixed(2)}${cfg.loop ? '  loop' : ''}`,
  };
}

/** Left/right mirror in normalized space (reflection x -> -x: (x, y, z, w) -> (x, -y, -z, w), left <-> right). */
function mirror(c) {
  const swap = (n) => (n.startsWith('left') ? 'right' + n.slice(4) : n.startsWith('right') ? 'left' + n.slice(5) : n);
  const q = {};
  for (const [n, arr] of Object.entries(c.q)) {
    const out = arr.slice();
    for (let i = 0; i < out.length; i += 4) {
      out[i + 1] = -out[i + 1];
      out[i + 2] = -out[i + 2];
    }
    q[swap(n)] = out;
  }
  const h = c.h.slice();
  for (let i = 0; i < h.length; i += 3) h[i] = -h[i];
  return { ...c, q, h, dir: [-c.dir[0], c.dir[1]], phase0: r4((c.phase0 + 0.5) % 1), src: `mirror of ${c.src}` };
}

// ---------------------------------------------------------------- main
const out = {};
const report = [];
const base = readBase();
for (const [id, c] of Object.entries(base.clips)) {
  const r = convert(id, { loop: c.loop }, c.rig, c.frames, c);
  out[id] = r.clip;
  report.push(r.line + '  (starter)');
}
let found = 0;
for (const [id, cfg] of Object.entries(CLIPS)) {
  const f = path.join(DIR, `${id}.fbx`);
  if (!fs.existsSync(f)) continue;
  try {
    const { rig, frames } = readFBX(f);
    const r = convert(id, cfg, rig, frames, { src: `${id}.fbx` });
    out[id] = r.clip;
    report.push(r.line);
    found++;
  } catch (e) {
    report.push(`  ${id.padEnd(14)} FAILED: ${e.message}`);
  }
}
// derived clips
if (out.strafe_r && !fs.existsSync(path.join(DIR, 'strafe_l.fbx')) && out.strafe_r.src.endsWith('.fbx')) {
  out.strafe_l = mirror(out.strafe_r);
  report.push('  strafe_l       mirror of strafe_r');
}
const unknown = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.fbx') && !CLIPS[f.slice(0, -4)]) : [];
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ fps: FPS, clips: out }));
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB): ${Object.keys(out).length} clips, ${found} from Mixamo FBX`);
console.log(report.join('\n'));
const missing = Object.keys(CLIPS).filter((id) => !out[id]);
if (missing.length) console.log(`\nnot downloaded yet (hand-keyed stand-ins are used): ${missing.join(', ')}`);
if (unknown.length) console.log(`\nunrecognised files in ${DIR}/ (rename them to the names in ASSETS.md): ${unknown.join(', ')}`);
