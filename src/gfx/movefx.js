// Effects of the M1 strings (naruto.js U1-U5, S1-S5; itachi.js I1-I6, R1-R5, IA1-IA5), on every fighter that plays
// one: the local player and remotes alike, driven only by the clip on screen and its time (v.act), so every client
// shows the same thing:
//   trails   a ribbon swept by the striking limb (or the scroll, the kunai) through its strike, fading in ~0.1 s
//   props    the scroll of the Scroll Rush (S2-S5), Itachi's kunai: in the right fist along its grip axis, exactly
//            where the hitbox is (hurtbox.js gripSegment)
//   events   one-shot bursts at clip frames: the wind palm's gust, chakra flashes, dust, the scroll's poofs, the
//            kunai's glint, and the slam's shockwave (or dust cloud) when the feet touch down after a dive
//   lines    speed lines off a diving body; spheres: the chakra sphere of a launcher's hit (hit.fx, from Combat)
//   hide     the frames a warp turns Itachi into crows (itachi.js draws them; nothing of the move shows)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BI, Pose } from '../char/rig.js';
import { gripSegment } from '../game/hurtbox.js';
import { toon } from './toon.js';

const F = 60;
// HDR colours (the bloom picks them up)
const WHITE = [2.0, 2.1, 2.4], ORANGE = [3.2, 1.45, 0.35], CHAKRA = [0.8, 2.0, 3.6], PAPER = [2.2, 1.9, 1.5], CRIMSON = [3.0, 0.32, 0.36];
// the scroll: its grip box (the hitbox of the scroll strikes uses the same numbers: naruto.js S2, S4, S5)
export const SCROLL = { grip: 'rightHand', len: 0.62, back: 0.14, r: 0.062 };
// Itachi's kunai: the same grip box as its hitbox (itachi.js KUNAI), drawn thin
export const KUNAI = { grip: 'rightHand', len: 0.5, back: 0.1, r: 0.03 };

// per clip: trails [{ a, b (bones) | grip, ext, from, to (frames), color }], scroll / kunai: [from, to) frames in hand,
// ev: [[frame, kind]], slide: [from, to) frames of dust under a slide, slam: the landing shockwave after `slam` frames
// (slamKind 'cloud': a dust cloud), hide: [from, to) frames the body is crows (Itachi's warps: itachi.js draws the
// ink and crows, nothing of the move shows), lines: [from, to) frames of speed lines streaming off a dive
export const MOVE_FX = {
  u_lunge: { trails: [{ a: 'rightLowerArm', b: 'rightHand', ext: 0.1, from: 5, to: 12, color: WHITE }], ev: [[3, 'step'], [8, 'dust']] },
  u_switch: { trails: [{ a: 'leftLowerLeg', b: 'leftFoot', ext: 0.12, from: 6, to: 14, color: WHITE }], ev: [[6, 'dust']] },
  u_windpalm: { trails: [], ev: [[2, 'gather'], [7, 'slide'], [9, 'wind']] },
  u_flipkick: { trails: [{ a: 'rightLowerLeg', b: 'rightFoot', ext: 0.12, from: 9, to: 17, color: ORANGE }], ev: [[3, 'step'], [19, 'land']] },
  u_tornado: { trails: [{ a: 'rightLowerLeg', b: 'rightFoot', ext: 0.14, from: 10, to: 19, color: ORANGE }], ev: [[7, 'step'], [11, 'chakraFoot'], [22, 'land']] },
  r_slide: { trails: [{ a: 'rightLowerLeg', b: 'rightFoot', ext: 0.12, from: 5, to: 13, color: WHITE }], slide: [3, 15], ev: [[3, 'slideStart']] },
  r_draw: { trails: [{ grip: true, from: 7, to: 15, color: PAPER }], scroll: [5, 99], ev: [[5, 'scrollIn']] },
  r_throw: { trails: [], scroll: [0, 99], ev: [[9, 'grab']] },
  r_rise: { trails: [{ grip: true, from: 5, to: 14, color: CHAKRA }], scroll: [0, 99], ev: [[0, 'step']] },
  r_slam: { trails: [{ grip: true, from: 10, to: 19, color: ORANGE }], scroll: [0, 34], slam: 17, ev: [[34, 'scrollOut']] },

  // Itachi's strings (itachi.js ITACHI_MOVES, clips itachim1.js)
  it_backhand: { trails: [{ a: 'rightLowerArm', b: 'rightHand', ext: 0.1, from: 8, to: 17, color: WHITE }], ev: [[4, 'step']] },
  it_spinheel: { trails: [{ a: 'leftLowerLeg', b: 'leftFoot', ext: 0.14, from: 9, to: 20, color: WHITE }], ev: [[5, 'step'], [13, 'dust']] },
  it_kunaidraw: { trails: [{ grip: 'kunai', from: 8, to: 18, color: CRIMSON }], kunai: [5, 99], ev: [[5, 'glint'], [9, 'step']] },
  it_risingcut: { trails: [{ grip: 'kunai', from: 6, to: 17, color: CRIMSON }], kunai: [0, 99], ev: [[5, 'step']] },
  it_palmrise: { trails: [{ a: 'rightLowerArm', b: 'rightHand', ext: 0.12, from: 10, to: 19, color: WHITE }], ev: [[6, 'dust'], [11, 'palm'], [18, 'leap']] },
  it_crowdrop: { trails: [{ a: 'rightLowerLeg', b: 'rightFoot', ext: 0.14, from: 16, to: 26, color: ORANGE }], hide: [3, 11], lines: [25, 35], slam: 34, slamKind: 'cloud' },
  it_flykick: { trails: [{ a: 'rightLowerLeg', b: 'rightFoot', ext: 0.16, from: 8, to: 18, color: WHITE }], ev: [[4, 'step'], [23, 'land']] },
  it_airhook: { trails: [{ a: 'leftLowerLeg', b: 'leftFoot', ext: 0.14, from: 9, to: 19, color: WHITE }], ev: [[4, 'step'], [24, 'land']] },
  it_crossslash: { trails: [{ grip: 'kunai', from: 7, to: 16, color: CRIMSON }], kunai: [3, 99], ev: [[3, 'glint'], [8, 'step']] },
  it_crowflank: { trails: [{ a: 'rightUpperArm', b: 'rightLowerArm', ext: 0.14, from: 15, to: 23, color: WHITE }], kunai: [0, 99], hide: [3, 11], ev: [[15, 'dust']] },
  it_crescent: { trails: [{ grip: 'kunai', from: 10, to: 23, color: CRIMSON }], kunai: [0, 42], ev: [[6, 'step'], [15, 'dust']] },
  it_air_snap: { trails: [{ a: 'rightLowerLeg', b: 'rightFoot', ext: 0.12, from: 5, to: 14, color: WHITE }] },
  it_air_slash: { trails: [{ grip: 'kunai', from: 6, to: 18, color: CRIMSON }], kunai: [2, 99], ev: [[2, 'glint']] },
  it_air_heel: { trails: [{ a: 'leftLowerLeg', b: 'leftFoot', ext: 0.12, from: 6, to: 17, color: WHITE }], kunai: [0, 99] },
  it_air_ambush: { trails: [{ a: 'rightLowerArm', b: 'rightHand', ext: 0.1, from: 14, to: 22, color: WHITE }], kunai: [0, 99], hide: [3, 11] },
  it_air_drop: { trails: [{ a: 'rightLowerArm', b: 'rightHand', ext: 0.16, from: 13, to: 22, color: ORANGE }], lines: [21, 31], slam: 30, slamKind: 'cloud' },

  // Naruto's jutsu (narutomoves.js): the Rush's clones' strikes (contact at 6), the finisher's heel (hidden in smoke
  // 6-16: naruto.js draws the vanishing), its dive and landing
  cr_punch: { trails: [{ a: 'rightLowerArm', b: 'rightHand', ext: 0.1, from: 3, to: 10, color: WHITE }] },
  cr_kick: { trails: [{ a: 'rightLowerLeg', b: 'rightFoot', ext: 0.14, from: 3, to: 11, color: ORANGE }] },
  cr_knee: { trails: [{ a: 'rightUpperLeg', b: 'rightLowerLeg', ext: 0.06, from: 3, to: 10, color: WHITE }] },
  cr_launch: { trails: [{ a: 'rightLowerLeg', b: 'rightFoot', ext: 0.14, from: 3, to: 12, color: CHAKRA }], ev: [[3, 'dust']] },
  nr_drop: { trails: [{ a: 'rightLowerLeg', b: 'rightFoot', ext: 0.16, from: 30, to: 40, color: ORANGE }], hide: [6, 16], ev: [[4, 'leap']], lines: [37, 44], slam: 44 },
};

/** Is the body of a fighter drawing `clip` at frame `fr` crows (hidden) right now? (itachi.js) */
export function warpHidden(clip, fr) {
  const h = MOVE_FX[clip]?.hide;
  return !!h && fr >= h[0] && fr < h[1];
}

const TRAIL_LIFE = 0.11; // s a sample stays visible
const TRAIL_MAX = 48; // samples kept
const SUB = 3; // Catmull-Rom points per sample gap (smooth arcs at 60 fps too)

const trailVert = /* glsl */ `
  attribute float aA; varying float vA; varying float vT;
  void main() { vA = aA; vT = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const trailFrag = /* glsl */ `
  uniform vec3 uColor; varying float vA; varying float vT;
  void main() {
    // brightest along the leading edge (the fist, the foot, the scroll's end), soft toward the limb
    float a = vA * smoothstep(0.0, 0.55, vT);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, a);
  }`;

/** A ribbon swept between two moving points (a limb, a prop), fading over `life` s (also Madara's gunbai: madarafx.js). */
export class Trail {
  constructor(scene, life = TRAIL_LIFE) {
    this.life = life;
    const n = TRAIL_MAX * SUB * 2;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) uv[i * 2 + 1] = i % 2; // 0 at the base, 1 at the tip
    const idx = [];
    for (let i = 0; i < TRAIL_MAX * SUB - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) } },
      vertexShader: trailVert, fragmentShader: trailFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.s = []; // samples { a: Vector3, b: Vector3, t }
    this.owner = null;
  }

  push(a, b, t) {
    const s = this.s.length >= TRAIL_MAX ? this.s.shift() : { a: new THREE.Vector3(), b: new THREE.Vector3(), t: 0 };
    s.a.copy(a);
    s.b.copy(b);
    s.t = t;
    this.s.push(s);
  }

  /** Drops old samples and rebuilds the ribbon. Returns false once it has faded out. */
  update(now) {
    const s = this.s;
    while (s.length && now - s[0].t > this.life) s.shift();
    if (s.length < 2) {
      this.mesh.visible = false;
      this.geo.setDrawRange(0, 0);
      return s.length > 0;
    }
    const P = this.pos, A = this.alpha;
    let k = 0;
    const cr = (p0, p1, p2, p3, u, o) => {
      const u2 = u * u, u3 = u2 * u;
      for (const c of ['x', 'y', 'z']) o[c] = 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u3);
    };
    const _a = this._a ||= new THREE.Vector3(), _b = this._b ||= new THREE.Vector3();
    for (let i = 0; i < s.length - 1; i++) {
      const s0 = s[Math.max(0, i - 1)], s1 = s[i], s2 = s[i + 1], s3 = s[Math.min(s.length - 1, i + 2)];
      const steps = i === s.length - 2 ? SUB + 1 : SUB;
      for (let j = 0; j < steps; j++) {
        const u = j / SUB;
        cr(s0.a, s1.a, s2.a, s3.a, u, _a);
        cr(s0.b, s1.b, s2.b, s3.b, u, _b);
        const age = (now - (s1.t + (s2.t - s1.t) * u)) / this.life;
        const al = Math.max(0, 1 - age) ** 1.6;
        P[k * 6] = _a.x; P[k * 6 + 1] = _a.y; P[k * 6 + 2] = _a.z;
        P[k * 6 + 3] = _b.x; P[k * 6 + 4] = _b.y; P[k * 6 + 5] = _b.z;
        A[k * 2] = al * 0.35;
        A[k * 2 + 1] = al;
        k++;
      }
    }
    const g = this.geo;
    // vertices are in world space (the shader warm-up moves every effect to the spawn point)
    this.mesh.position.set(0, 0, 0);
    g.attributes.position.needsUpdate = true;
    g.attributes.aA.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, (k - 1) * 6));
    this.mesh.visible = k > 1;
    return true;
  }
}

/** The scroll prop: a red scroll with a paper band and dark wooden knobs, along +y, centred. One merged mesh. */
function scrollMesh() {
  const L = SCROLL.len + SCROLL.back, R = SCROLL.r;
  const part = (geo, hex) => {
    const c = new THREE.Color(hex), n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo.index ? geo.toNonIndexed() : geo;
  };
  const body = part(new THREE.CylinderGeometry(R, R, L * 0.8, 16, 1), 0xb3262c);
  const band = part(new THREE.CylinderGeometry(R * 1.04, R * 1.04, L * 0.26, 16, 1, true), 0xeee0bf);
  const k1 = part(new THREE.CylinderGeometry(R * 0.55, R * 0.7, L * 0.1, 10), 0x3a2517);
  k1.translate(0, L * 0.45, 0);
  const k2 = part(new THREE.CylinderGeometry(R * 0.7, R * 0.55, L * 0.1, 10), 0x3a2517);
  k2.translate(0, -L * 0.45, 0);
  for (const g of [body, band, k1, k2]) g.deleteAttribute('uv');
  const geo = mergeGeometries([body, band, k1, k2]);
  const m = new THREE.Mesh(geo, propMaterial());
  m.castShadow = false;
  m.visible = false;
  return m;
}

// one toon material for every prop (vertex colours): one shader program
let _propMat = null;
const propMaterial = () => (_propMat ||= toon({ vertexColors: true, hatch: 0.4, fade: false, key: 'scroll' }));

/** vertex-coloured, non-indexed, no uvs (to merge) */
function tint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo.index ? geo.toNonIndexed() : geo;
}

/**
 * Itachi's kunai along +y, centred on the grip box (back end at -L/2, tip at +L/2): a ring pommel, a cloth-wrapped
 * handle through the fist, a leaf-shaped blade with a diamond section (a lathe of 4 sides, flattened), dark steel
 * with a pale edge band so it reads against the cloak.
 */
function kunaiMesh() {
  const L = KUNAI.len + KUNAI.back, y0 = -L / 2, hand = y0 + KUNAI.back;
  const ring = tint(new THREE.TorusGeometry(0.024, 0.006, 6, 14), 0x2a2a30);
  ring.translate(0, y0 - 0.018, 0);
  const grip = tint(new THREE.CylinderGeometry(0.013, 0.015, 0.2, 8, 1), 0x1a1a22);
  grip.translate(0, hand + 0.0, 0);
  const prof = [[0.012, 0], [0.034, 0.05], [0.03, 0.19], [0.016, 0.3], [0.0, 0.4]].map(([r, y]) => new THREE.Vector2(r, y));
  const blade = new THREE.LatheGeometry(prof, 4);
  blade.scale(1, 1, 0.28);
  const edge = tint(blade.clone().scale(1.08, 0.985, 0.5).translate(0, 0.004, 0), 0xd8dde4);
  const steel = tint(blade, 0x4a4f58);
  for (const g of [edge, steel]) g.translate(0, hand + 0.1, 0);
  for (const g of [ring, grip]) g.deleteAttribute('uv');
  for (const g of [ring, grip, edge, steel]) g.deleteAttribute('normal');
  const geo = mergeGeometries([ring, grip, edge, steel]);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, propMaterial());
  m.castShadow = false;
  m.visible = false;
  return m;
}

// the props in hand, by MOVE_FX key: the grip box they follow, the mesh, what their going away looks like
const PROPS = {
  scroll: { box: SCROLL, mesh: scrollMesh, pool: 8, out: 'puff' },
  kunai: { box: KUNAI, mesh: kunaiMesh, pool: 8, out: 'glint' },
};

const sphereVert = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const sphereFrag = /* glsl */ `
  uniform float uAge; varying vec3 vN; varying vec3 vV;
  void main() {
    // a shell of chakra: a bright rim (fresnel), a faint milky body, fading as it swells
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(f, 2.2);
    float a = (0.1 + rim * 1.5) * pow(1.0 - uAge, 1.5);
    if (a < 0.004) discard;
    gl_FragColor = vec4(vec3(2.3, 2.35, 2.5) * a, a);
  }`;
const SPHERE_LIFE = 0.32;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _g = {};

export class MoveFX {
  constructor(game) {
    this.game = game;
    const s = game.scene;
    this.trails = Array.from({ length: 10 }, () => new Trail(s));
    // prop meshes by kind (a pool each: every fighter on screen may hold one)
    this.props = {};
    for (const [kind, D] of Object.entries(PROPS)) {
      this.props[kind] = Array.from({ length: D.pool }, () => {
        const m = D.mesh();
        s.add(m);
        return m;
      });
    }
    // chakra sphere bursts (a launcher's or a finisher's impact: hit.fx 'sphere')
    const sg = new THREE.IcosahedronGeometry(1, 3);
    this.spheres = Array.from({ length: 4 }, () => {
      const m = new THREE.Mesh(sg, new THREE.ShaderMaterial({
        uniforms: { uAge: { value: 0 } }, vertexShader: sphereVert, fragmentShader: sphereFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.frustumCulled = false;
      m.renderOrder = 7;
      m.visible = false;
      m.userData.t = -1;
      s.add(m);
      return m;
    });
    this.by = new Map(); // fighter -> { key, t, fired: Set, trails: Map(spec -> Trail), props: { kind: mesh }, slamDone }
    this.time = 0;
    this.pose = new Pose();
  }

  /** Every object visible for the shader warm-up (main.js warmShaders), hidden after. */
  warmObjects() {
    return [...this.trails.map((t) => t.mesh), ...Object.values(this.props).flat(), ...this.spheres];
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    const seen = (this._seen ||= new Set());
    seen.clear();
    const each = (f) => {
      if (!f) return;
      seen.add(f);
      this.fighter(f, dt);
    };
    each(g.player);
    for (const r of g.remotes.values()) each(r.fighter);
    // (Naruto's clones strike with his moves: their trails too)
    if (g.jutsu) for (const f of g.jutsu.naruto.fighters()) each(f);
    // fighters that left: give their objects back
    for (const [f, e] of this.by) if (!seen.has(f)) this.release(f, e);
    for (const tr of this.trails) if (tr.owner && !tr.update(this.time)) tr.owner = null;
    for (const m of this.spheres) {
      if (m.userData.t < 0) continue;
      const k = (this.time - m.userData.t) / SPHERE_LIFE;
      if (k >= 1) {
        m.userData.t = -1;
        m.visible = false;
        continue;
      }
      // swells fast, then eases out as it fades
      m.scale.setScalar(m.userData.r * (0.3 + 1.0 * (1 - (1 - k) ** 3)));
      m.material.uniforms.uAge.value = k;
      m.visible = true;
    }
  }

  release(f, e) {
    for (const kind in e.props) this.hideProp(e, kind, null);
    for (const tr of e.trails.values()) tr.owner = tr.owner === f ? 'fading' : tr.owner;
    this.by.delete(f);
  }

  fighter(f, dt) {
    let e = this.by.get(f);
    const act = !f.dead ? f.view?.act : null;
    const D = act && MOVE_FX[act.clip];
    if (!e) {
      if (!D) return;
      e = { key: null, t: 0, fired: new Set(), trails: new Map(), props: {}, slamDone: false };
      this.by.set(f, e);
    }
    if (!D || f.visible === false && !D.hide) {
      // the string ended (or broke): props vanish in a puff (the kunai with a glint), trails fade on their own
      for (const kind in e.props) this.hideProp(e, kind, f);
      e.key = null;
      for (const tr of e.trails.values()) if (tr.owner === f) tr.owner = 'fading';
      e.trails.clear();
      return;
    }
    const frame = act.t * F;
    // a new move (or the same one restarted): its events fire again
    if (act.key !== e.key || frame < e.t - 0.5) {
      e.key = act.key;
      e.fired.clear();
      e.slamDone = false;
      for (const tr of e.trails.values()) if (tr.owner === f) tr.owner = 'fading';
      e.trails.clear();
    }
    e.t = frame;
    // his body is crows (a warp): nothing of the move shows, the prop goes quietly (it comes back when he re-forms)
    if (f.visible === false || (D.hide && frame >= D.hide[0] && frame < D.hide[1])) {
      for (const kind in e.props) this.hideProp(e, kind, null);
      return;
    }
    // bones of the drawn pose, in world space (the pose + the fighter's drawn transform)
    this.fk(f);
    // events (fired once each; a remote that learns of a move late skips what is long past)
    for (const [fr, kind] of D.ev || []) {
      const id = `${fr}${kind}`;
      if (frame >= fr && !e.fired.has(id)) {
        e.fired.add(id);
        if (frame - fr < 6) this.event(kind, f);
      }
    }
    // props in hand
    for (const kind in PROPS) {
      const on = D[kind] && frame >= D[kind][0] && frame < D[kind][1];
      if (on) {
        if (!e.props[kind]) {
          const m = this.props[kind].find((x) => !x.userData.owner) || null;
          if (m) m.userData.owner = f;
          e.props[kind] = m;
        }
        if (e.props[kind]) this.placeProp(f, e.props[kind], PROPS[kind].box);
      } else if (e.props[kind]) this.hideProp(e, kind, f);
    }
    // trails
    for (const T of D.trails) {
      if (frame < T.from || frame > T.to) continue;
      let tr = e.trails.get(T);
      if (!tr) {
        tr = this.trails.find((x) => !x.owner) || null;
        if (!tr) continue;
        tr.owner = f;
        tr.s.length = 0;
        tr.mat.uniforms.uColor.value.set(...T.color);
        e.trails.set(T, tr);
      }
      if (T.grip) this.gripWorld(T.grip === 'kunai' ? KUNAI : SCROLL, _a, _b);
      else {
        this.boneWorld(f, T.a, _a);
        this.boneWorld(f, T.b, _b);
        _c.subVectors(_b, _a).normalize();
        _b.addScaledVector(_c, T.ext || 0);
      }
      tr.push(_a, _b, this.time);
    }
    // continuous dust under a slide
    if (D.slide && frame >= D.slide[0] && frame < D.slide[1] && Math.random() < dt * 40) {
      const gy = f.world.ground(f.pos.x, f.pos.z, f.pos.y + 0.5, _g).y;
      this.game.fx.dust({ x: f.pos.x, y: gy, z: f.pos.z }, 1, 0.8);
    }
    // speed lines streaming up off a dive (the body plunging: white streaks left behind above it)
    if (D.lines && frame >= D.lines[0] && frame < D.lines[1] && !e.slamDone) {
      const fx = this.game.fx, p = f.pos;
      for (let n = Math.floor(dt * 110 + Math.random()); n > 0; n--) {
        const a = Math.random() * 6.283, r = 0.3 + Math.random() * 0.6;
        fx.emit(2, p.x + Math.cos(a) * r, p.y + 0.4 + Math.random() * 1.6, p.z + Math.sin(a) * r, 0, 16 + Math.random() * 10, 0, 0.09 + Math.random() * 0.05, 0.05, 0.02, 1.9, 1.95, 2.1);
      }
    }
    // the slam: when the feet reach the ground after the dive
    if (D.slam !== undefined && !e.slamDone && frame >= D.slam) {
      const gy = f.world.ground(f.pos.x, f.pos.z, f.pos.y + 0.5, _g).y;
      if (f.pos.y - gy < 0.12) {
        e.slamDone = true;
        this.event(D.slamKind || 'slam', f);
      }
    }
  }

  // ---------------------------------------------------------------- the drawn skeleton

  fk(f) {
    const anim = f.anim, p = this.pose;
    p.copy(anim.pose);
    p.h[1] += anim.hipsOffsetY || 0;
    anim.rig.fk(p);
    this.rig = anim.rig;
    this.m = f.vrm.scene.matrixWorld;
  }

  boneWorld(f, name, out) {
    return out.copy(this.rig.P[BI[name]]).applyMatrix4(this.m);
  }

  gripWorld(box, outA, outB) {
    gripSegment(this.rig, box, outA, outB);
    outA.applyMatrix4(this.m);
    outB.applyMatrix4(this.m);
  }

  placeProp(f, m, box) {
    this.gripWorld(box, _a, _b);
    m.position.addVectors(_a, _b).multiplyScalar(0.5);
    _c.subVectors(_b, _a).normalize();
    m.quaternion.setFromUnitVectors(_up, _c);
    m.visible = true;
  }

  /** A prop goes away: in a puff (the scroll) or a glint (the kunai tucked away), silently when `f` is null. */
  hideProp(e, kind, f) {
    const m = e.props[kind];
    delete e.props[kind];
    if (!m) return;
    if (f && m.visible) {
      if (PROPS[kind].out === 'glint') this.glint(m.position);
      else {
        this.puff(m.position);
        this.game.audio?.poof?.(m.position);
      }
    }
    m.visible = false;
    m.userData.owner = null;
  }

  /** A chakra sphere bursting round an impact (hit.fx 'sphere'), with white speed lines flung out of it. */
  sphere(p, r = 1.15) {
    const m = this.spheres.find((x) => x.userData.t < 0) || this.spheres.reduce((a, b) => (a.userData.t < b.userData.t ? a : b));
    m.position.set(p.x, p.y, p.z);
    m.userData.t = this.time;
    m.userData.r = r;
    m.scale.setScalar(r * 0.3);
    m.material.uniforms.uAge.value = 0;
    m.visible = true;
    const fx = this.game.fx;
    fx.emit(5, p.x, p.y, p.z, 0, 0, 0, 0.12, 0.4, 1.5, 2.2, 2.2, 2.4);
    for (let k = 0; k < 18; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * 6.283, sq = Math.sqrt(1 - u * u), sp = 14 + Math.random() * 10;
      fx.emit(2, p.x + Math.cos(th) * sq * 0.5, p.y + u * 0.5, p.z + Math.sin(th) * sq * 0.5, Math.cos(th) * sq * sp, u * sp * 0.6, Math.sin(th) * sq * sp, 0.14 + Math.random() * 0.08, 0.07, 0.03, 2.2, 2.25, 2.4);
    }
  }

  /** A cold flash of steel (the kunai drawn or tucked away). */
  glint(p) {
    const fx = this.game.fx;
    fx.emit(5, p.x, p.y, p.z, 0, 0, 0, 0.1, 0.06, 0.34, 2.6, 2.6, 2.9);
    for (let k = 0; k < 4; k++) {
      const th = Math.random() * 6.283, sp = 2.5 + Math.random() * 2;
      fx.emit(2, p.x, p.y, p.z, Math.cos(th) * sp, 1 + Math.random() * 2, Math.sin(th) * sp, 0.12, 0.03, 0.015, 2.4, 2.5, 2.8);
    }
    this.game.audio?.kunai?.(p);
  }

  // ---------------------------------------------------------------- one-shot bursts

  /** A small quick puff of smoke where the scroll appears or vanishes (the jutsu poof is too big for a prop). */
  puff(p) {
    const fx = this.game.fx;
    for (let k = 0; k < 6; k++) {
      const th = (k / 6) * 6.283 + Math.random(), sp = 1.1 + Math.random() * 0.6;
      fx.emit(0, p.x + Math.cos(th) * 0.08, p.y + (Math.random() - 0.5) * 0.15, p.z + Math.sin(th) * 0.08, Math.cos(th) * sp, 0.4 + Math.random() * 0.5, Math.sin(th) * sp, 0.26 + Math.random() * 0.1, 0.1, 0.3, 0.97, 0.97, 0.99);
    }
    fx.emit(5, p.x, p.y, p.z, 0, 0, 0, 0.08, 0.1, 0.35, 2.0, 2.0, 2.0);
  }


  event(kind, f) {
    const g = this.game, fx = g.fx, au = g.audio;
    const yaw = f.yaw, fx0 = -Math.sin(yaw), fz0 = -Math.cos(yaw); // facing
    const gy = f.world.ground(f.pos.x, f.pos.z, f.pos.y + 0.5, _g).y;
    const feet = { x: f.pos.x, y: gy, z: f.pos.z };
    switch (kind) {
      case 'step':
        fx.dust(feet, 3, 0.6);
        break;
      case 'dust':
        fx.dust(feet, 4, 0.8);
        break;
      case 'land':
        fx.dust(feet, 6, 1.1);
        au?.land?.(f.pos, 9);
        break;
      case 'slideStart':
        fx.dust(feet, 6, 1.2);
        au?.dash?.(f.pos);
        break;
      case 'slide':
        fx.dust(feet, 5, 1.0, [0.8, 0.86, 0.9]);
        break;
      case 'gather': {
        // chakra gathers between the palms at the right hip
        this.boneWorld(f, 'rightHand', _a);
        this.boneWorld(f, 'leftHand', _b);
        _a.add(_b).multiplyScalar(0.5);
        fx.emit(5, _a.x, _a.y, _a.z, 0, 0, 0, 0.12, 0.08, 0.26, 0.9, 2.0, 3.4);
        for (let k = 0; k < 8; k++) {
          const th = Math.random() * 6.283, r = 0.35;
          fx.emit(2, _a.x + Math.cos(th) * r, _a.y + (Math.random() - 0.5) * 0.3, _a.z + Math.sin(th) * r, -Math.cos(th) * 3, 0.6, -Math.sin(th) * 3, 0.14, 0.035, 0.02, 1.0, 2.2, 3.6);
        }
        break;
      }
      case 'wind': {
        // wind release: a burst at the palms and a gust of streaks and pale puffs driving forward
        this.boneWorld(f, 'rightHand', _a);
        this.boneWorld(f, 'leftHand', _b);
        _a.add(_b).multiplyScalar(0.5).addScaledVector(_c.set(fx0, 0, fz0), 0.15);
        fx.impact(_a, 2, [1.1, 2.4, 3.6]);
        fx.emit(5, _a.x, _a.y, _a.z, 0, 0, 0, 0.12, 0.3, 1.1, 1.2, 2.2, 3.4);
        for (let k = 0; k < 22; k++) {
          const sp = 12 + Math.random() * 12, ox = (Math.random() - 0.5) * 0.6, oy = (Math.random() - 0.5) * 0.7;
          // spread sideways (perpendicular to the facing) and up/down
          const sx = -fz0 * ox, sz = fx0 * ox;
          fx.emit(2, _a.x + sx, _a.y + oy, _a.z + sz, fx0 * sp + sx * 4, oy * 3 + 1.5, fz0 * sp + sz * 4, 0.2 + Math.random() * 0.12, 0.06, 0.03, 1.3, 2.3, 3.4);
        }
        for (let k = 0; k < 6; k++) {
          const sp = 4 + k * 1.3, ox = (Math.random() - 0.5) * 0.5;
          fx.emit(0, _a.x - fz0 * ox, _a.y + (Math.random() - 0.5) * 0.3, _a.z + fx0 * ox, fx0 * sp * 3, 0.3, fz0 * sp * 3, 0.35 + k * 0.03, 0.15, 0.55, 0.82, 0.92, 1.0, 0.8);
        }
        fx.ripple({ x: _a.x + fx0 * 0.6, y: gy, z: _a.z + fz0 * 0.6 }, 1.4);
        au?.dash?.(_a);
        break;
      }
      case 'chakraFoot': {
        this.boneWorld(f, 'rightFoot', _a);
        fx.emit(5, _a.x, _a.y, _a.z, 0, 0, 0, 0.1, 0.12, 0.42, 3.2, 1.6, 0.5);
        for (let k = 0; k < 10; k++) {
          const th = Math.random() * 6.283, sp = 2 + Math.random() * 3;
          fx.emit(2, _a.x, _a.y, _a.z, Math.cos(th) * sp, 1 + Math.random() * 2, Math.sin(th) * sp, 0.18, 0.04, 0.02, 3.4, 1.8, 0.5);
        }
        break;
      }
      case 'scrollIn': {
        // the scroll comes off the back in a puff of smoke
        this.boneWorld(f, 'rightHand', _a);
        this.puff(_a);
        fx.emit(5, _a.x, _a.y, _a.z, 0, 0, 0, 0.1, 0.1, 0.4, 2.2, 2.0, 1.8);
        au?.poof?.(_a);
        break;
      }
      case 'scrollOut':
        break; // the scroll's own hide (the interval ends) makes the puff
      case 'grab': {
        this.boneWorld(f, 'leftHand', _a);
        fx.emit(5, _a.x, _a.y, _a.z, 0, 0, 0, 0.1, 0.2, 0.6, 2.4, 2.4, 2.6);
        break;
      }
      case 'palm': {
        // chakra gathering white on the rising palm (the sphere bursts from it on the hit: hit.fx)
        this.boneWorld(f, 'rightHand', _a);
        fx.emit(5, _a.x, _a.y, _a.z, 0, 0, 0, 0.14, 0.1, 0.34, 2.0, 2.1, 2.4);
        for (let k = 0; k < 7; k++) {
          const th = Math.random() * 6.283, r = 0.3;
          fx.emit(2, _a.x + Math.cos(th) * r, _a.y + (Math.random() - 0.5) * 0.3, _a.z + Math.sin(th) * r, -Math.cos(th) * 3, 0.8, -Math.sin(th) * 3, 0.12, 0.035, 0.02, 2.0, 2.1, 2.4);
        }
        break;
      }
      case 'leap':
        fx.dust(feet, 6, 1.0);
        fx.ripple(feet, 0.9);
        au?.jump?.(f.pos);
        break;
      case 'cloud': {
        // the dive's landing: a dome of dust billowing up round him (the reference's cloud), a ground ring, grit
        // thrown out low, a flash where the blow meets the ground, the camera shaken up close
        for (let k = 0; k < 16; k++) {
          const th = (k / 16) * 6.283 + Math.random() * 0.3, r = 0.3 + Math.random() * 0.5, sp = 2.2 + Math.random() * 2.2;
          fx.emit(0, feet.x + Math.cos(th) * r, feet.y + 0.15 + Math.random() * 0.5, feet.z + Math.sin(th) * r, Math.cos(th) * sp, 0.8 + Math.random() * 1.6, Math.sin(th) * sp, 0.9 + Math.random() * 0.5, 0.45, 1.2 + Math.random() * 0.5, 0.86, 0.8, 0.7);
        }
        for (let k = 0; k < 6; k++) {
          const th = Math.random() * 6.283;
          fx.emit(0, feet.x + Math.cos(th) * 0.2, feet.y + 0.6 + Math.random() * 0.8, feet.z + Math.sin(th) * 0.2, Math.cos(th) * 0.8, 1.6 + Math.random(), Math.sin(th) * 0.8, 1.1 + Math.random() * 0.4, 0.6, 1.5, 0.9, 0.85, 0.76);
        }
        for (let k = 0; k < 14; k++) {
          const th = Math.random() * 6.283, sp = 4 + Math.random() * 4;
          fx.emit(3, feet.x, feet.y + 0.1, feet.z, Math.cos(th) * sp, 0.5 + Math.random() * 1.5, Math.sin(th) * sp, 0.4 + Math.random() * 0.2, 0.08, 0.2, 0.5, 0.44, 0.36);
        }
        fx.ripple(feet, 2.8);
        fx.ripple({ x: feet.x, y: feet.y + 0.02, z: feet.z }, 1.7);
        fx.emit(5, feet.x + fx0 * 0.5, feet.y + 0.3, feet.z + fz0 * 0.5, 0, 0, 0, 0.12, 0.3, 1.3, 3.0, 1.7, 0.7);
        au?.land?.(f.pos, 14);
        if (g.player && g.camera) {
          const d = g.camera.position.distanceTo(f.pos);
          if (d < 16) g.cam?.addTrauma?.(f === g.player ? 0.34 : 0.2 * (1 - d / 16));
        }
        break;
      }
      case 'slam': {
        // the scroll hits the ground: a shockwave ring, a dust ring, a flash, a boom, the camera shakes up close
        fx.ripple(feet, 2.6);
        fx.ripple({ x: feet.x, y: feet.y + 0.02, z: feet.z }, 1.6);
        for (let k = 0; k < 14; k++) {
          const th = (k / 14) * 6.283, sp = 3 + Math.random() * 2;
          fx.emit(3, feet.x + Math.cos(th) * 0.3, feet.y + 0.1, feet.z + Math.sin(th) * 0.3, Math.cos(th) * sp, 0.4 + Math.random() * 0.5, Math.sin(th) * sp, 0.55 + Math.random() * 0.2, 0.2, 0.7, 0.78, 0.7, 0.58);
        }
        fx.emit(5, feet.x + fx0 * 0.6, feet.y + 0.3, feet.z + fz0 * 0.6, 0, 0, 0, 0.12, 0.3, 1.2, 3.0, 1.6, 0.6);
        au?.land?.(f.pos, 14);
        if (g.player && g.camera) {
          const d = g.camera.position.distanceTo(f.pos);
          if (d < 14) g.cam?.addTrauma?.(f === g.player ? 0.3 : 0.18 * (1 - d / 14));
        }
        break;
      }
    }
  }
}
