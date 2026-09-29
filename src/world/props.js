// The small props across the map, from map.js's `prop` / `torii` / `wires` descriptors (their colliders come from
// there): barrels, stone lanterns, benches, a hand cart, a tea stall under a red parasol, utility poles and the
// wires strung between them, nobori banners, stumps, straw training dummies, targets on stands, a weapons rack, log
// piles, cherry trees in blossom, bamboo clumps, boulders, the forest shrine and the torii gates. Almost everything
// is flat-coloured (the palette material: one draw) or uses the arena's shared textured materials; small parts are
// distance-culled (`far`).
import * as THREE from 'three';
import { mulberry32 } from '../shared/rng.js';
import { M, boxUV } from './batch.js';
import { tint, paintBy } from './palette.js';
import { SIGN_TEXTS } from './village.js';
import { foliage } from './nature.js';

const TAU = Math.PI * 2;
const FAR = null; // (see village.js: clutter merges into the main batches)
const VERMILION = '#c8372d';

/** Frame of a prop: its position on the ground and yaw (radians, three's sense: local +x -> (cos, -sin)). */
const frame = (p) => new THREE.Matrix4().makeRotationY(p.yaw || 0).setPosition(p.x, p.g, p.z);

/** A barrel's bulging stave body (lathe). */
function barrelBody(r, h) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(r * (0.86 + 0.14 * Math.sin(t * Math.PI)), t * h));
  }
  return new THREE.LatheGeometry(pts, 14);
}

/** A foliage ball for blossoms and bamboo leaves: lumpy, flattened, shaded dark underneath (vertex colours). */
function puff(r, rng, tintRGB, flat = 0.75) {
  const g = new THREE.IcosahedronGeometry(r, 2);
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  const f = [rng() * 10, rng() * 10, rng() * 10];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1;
    const k = 1 + 0.16 * Math.sin((x / l) * 6 + f[0]) * Math.sin((y / l) * 5 + f[1]) + 0.1 * Math.abs(Math.sin((z / l) * 8 + f[2]));
    p.setXYZ(i, x * k, y * k * flat, z * k);
    const ao = 0.62 + 0.38 * Math.min(1, Math.max(0, (y / l + 0.8) / 1.6));
    c.set([ao * tintRGB[0], ao * tintRGB[1], ao * tintRGB[2]], i * 3);
  }
  g.computeVertexNormals();
  // soft sphere normals: the puff shades as one mass
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / l, y / l, z / l);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** A torii: two pillars, the tie beam (nuki), the top beam (kasagi, black, its ends swept up) over a red shimaki. */
function buildTorii(B, mat, t) {
  const { x, z, g, H, half } = t;
  const alongX = t.along === 'x';
  const r = t.big ? 0.3 : 0.13;
  const P = (a, y, b) => (alongX ? [x + a, g + y, z + b] : [x + b, g + y, z + a]);
  const ry = alongX ? 0 : Math.PI / 2;
  for (const s of [-1, 1]) {
    const [px, py, pz] = P(s * half, H / 2, 0);
    B.add(mat.palette, tint(new THREE.CylinderGeometry(r * 0.9, r, H, 12), VERMILION), M(px, py, pz));
    const [bx, by, bz] = P(s * half, 0.15, 0);
    B.add(mat.palette, tint(new THREE.CylinderGeometry(r * 1.25, r * 1.35, 0.3, 12), '#2a2020'), M(bx, by, bz));
  }
  const span = half * 2 + (t.big ? 2.4 : 1.1);
  // kasagi: a box whose ends curve up
  const k = boxUV(span, t.big ? 0.42 : 0.2, t.big ? 0.62 : 0.3);
  const kp = k.attributes.position;
  for (let i = 0; i < kp.count; i++) {
    const u = kp.getX(i) / (span / 2);
    kp.setY(i, kp.getY(i) + u * u * u * u * (t.big ? 0.45 : 0.18));
  }
  k.computeVertexNormals();
  const [kx, ky, kz] = P(0, H + (t.big ? 0.24 : 0.12), 0);
  B.add(mat.palette, tint(k, '#2a2020'), M(kx, ky, kz, 0, ry, 0));
  const [sx, sy, sz] = P(0, H - (t.big ? 0.08 : 0.04), 0);
  B.add(mat.palette, tint(boxUV(span - 0.4, t.big ? 0.28 : 0.12, t.big ? 0.5 : 0.24), VERMILION), M(sx, sy, sz, 0, ry, 0));
  const [nx, ny, nz] = P(0, H - (t.big ? 1.03 : 0.55), 0);
  B.add(mat.palette, tint(boxUV(half * 2 + (t.big ? 0.8 : 0.4), t.big ? 0.25 : 0.12, t.big ? 0.3 : 0.14), VERMILION), M(nx, ny, nz, 0, ry, 0));
  if (t.big) {
    // the centre strut and its plaque
    const [cx, cy, cz] = P(0, H - 0.52, 0);
    B.add(mat.palette, tint(boxUV(0.3, 0.8, 0.3), VERMILION), M(cx, cy, cz, 0, ry, 0));
    B.add(mat.palette, tint(boxUV(0.9, 1.2, 0.08), '#2a2020'), M(cx, cy, cz, 0, ry, 0));
    // (the big gate spans the path along x: its plaque faces west and east)
    for (const s of [-1, 1]) B.add(mat.signAtlas, signPlaneI(6, 0.7, 1.0), M(cx + s * 0.05, cy, cz, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
  }
}

function signPlaneI(i, w, h) {
  const n = SIGN_TEXTS.length;
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / n);
  return g;
}

export function buildProps(map, B, mat) {
  const rng = mulberry32(3131);
  for (const t of map.props) if (t.t === 'torii') buildTorii(B, mat, t);
  // wires between the utility poles: two sagging lines per span
  for (const w of map.props) {
    if (w.t !== 'wires') continue;
    for (const [a, b] of w.poles) {
      const ga = map.world.terrain(a[0], a[1]), gb = map.world.terrain(b[0], b[1]);
      for (const off of [-0.55, 0.55]) {
        const pts = [];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), px = -dz / l, pz = dx / l;
        for (let k = 0; k <= 16; k++) {
          const t = k / 16;
          pts.push(new THREE.Vector3(a[0] + dx * t + px * off, ga + (gb - ga) * t + 6.95 - Math.sin(t * Math.PI) * 0.9, a[1] + dz * t + pz * off));
        }
        B.add(mat.palette, tint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.018, 3), '#2b2b30'));
      }
    }
  }
  for (const p of map.props) {
    if (p.t !== 'prop') continue;
    const F = frame(p);
    const put = (m, g, x, y, z, rx = 0, ry = 0, rz = 0, o) => B.add(m, g, F.clone().multiply(M(x, y, z, rx, ry, rz)), o);
    const pal = (g, c) => tint(g, c);
    switch (p.kind) {
      case 'barrel': {
        put(mat.woodLight, barrelBody(0.4, 1.0), 0, 0, 0);
        for (const y of [0.15, 0.85]) put(mat.palette, pal(new THREE.CylinderGeometry(0.39, 0.39, 0.06, 14, 1, true), '#3b3632'), 0, y, 0, 0, 0, 0, FAR);
        put(mat.palette, pal(new THREE.CircleGeometry(0.35, 14).rotateX(-Math.PI / 2), '#8a6545'), 0, 0.99, 0);
        break;
      }
      case 'lantern': {
        const s = p.small ? 0.75 : 1;
        const hex = (r0, r1, h, y) => put(mat.stone, new THREE.CylinderGeometry(r0 * s, r1 * s, h * s, 6), 0, y * s, 0);
        hex(0.36, 0.44, 0.22, 0.11);
        hex(0.13, 0.16, 0.8, 0.62);
        hex(0.36, 0.3, 0.14, 1.09);
        put(mat.stone, boxUV(0.44 * s, 0.4 * s, 0.44 * s), 0, 1.36 * s, 0);
        // the light box's paper windows glow faintly (the lantern material: blooms a little)
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) put(mat.lanternWhite, new THREE.PlaneGeometry(0.24 * s, 0.22 * s), Math.sin(a) * 0.225 * s, 1.36 * s, Math.cos(a) * 0.225 * s, 0, a, 0);
        put(mat.stone, new THREE.ConeGeometry(0.5 * s, 0.34 * s, 6), 0, 1.73 * s, 0);
        put(mat.stone, new THREE.SphereGeometry(0.08 * s, 8, 6), 0, 1.95 * s, 0);
        break;
      }
      case 'bench': {
        for (const z of [-0.12, 0.12]) put(mat.woodLight, boxUV(1.9, 0.07, 0.2, 1.5), 0, 0.45, z);
        for (const x of [-0.75, 0.75]) put(mat.timber, boxUV(0.12, 0.42, 0.42), x, 0.21, 0);
        break;
      }
      case 'cart': {
        put(mat.woodLight, boxUV(2.1, 0.12, 1.25, 1.5), 0, 0.72, 0);
        for (const z of [-0.6, 0.6]) put(mat.woodLight, boxUV(2.1, 0.3, 0.06, 1.5), 0, 0.93, z);
        for (const x of [-1.03, 1.03]) put(mat.woodLight, boxUV(0.06, 0.3, 1.25, 1.5), x, 0.93, 0);
        for (const z of [-0.72, 0.72]) {
          put(mat.timber, new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16).rotateX(Math.PI / 2), 0, 0.5, z);
          put(mat.palette, pal(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 8).rotateX(Math.PI / 2), '#2b2b30'), 0, 0.5, z, 0, 0, 0, FAR);
        }
        for (const z of [-0.45, 0.45]) put(mat.timber, boxUV(1.4, 0.07, 0.07), 1.7, 0.7, z, 0, 0, -0.12);
        // the load: rice sacks and a crate
        for (const [x, z] of [[-0.5, -0.25], [-0.45, 0.3], [0.1, 0]]) put(mat.palette, pal(new THREE.SphereGeometry(0.34, 10, 8).scale(1.1, 0.7, 0.85), '#d8c49a'), x, 1.0, z, 0, rng() * 3, 0);
        put(mat.crate, boxUV(0.6, 0.6, 0.6, 1.6), 0.6, 1.08, -0.2, 0, 0.3, 0);
        break;
      }
      case 'stall': {
        put(mat.woodLight, boxUV(1.75, 0.08, 0.95, 1.5), 0, 0.88, 0);
        put(mat.timber, boxUV(1.6, 0.8, 0.8, 1), 0, 0.42, 0);
        put(mat.palette, pal(boxUV(1.62, 0.3, 0.02), VERMILION), 0, 0.72, 0.41);
        // wares: dango skewers, tea cups, a kettle
        for (let k = 0; k < 5; k++) {
          const x = -0.6 + k * 0.3;
          put(mat.palette, pal(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 4).rotateZ(Math.PI / 2), '#d9c9a0'), x, 0.95, 0.15, 0, 0.3, 0, FAR);
          ['#f4b6c2', '#f7f2ea', '#8cc56a'].forEach((c, j) => put(mat.palette, pal(new THREE.SphereGeometry(0.04, 6, 4), c), x - 0.08 + j * 0.08, 0.96, 0.15 + j * 0.025, 0, 0, 0, FAR));
        }
        put(mat.palette, pal(new THREE.SphereGeometry(0.13, 10, 8), '#3b3632'), 0.55, 1.02, -0.2);
        // the red parasol (wagasa) on its pole, a bench beside the stall
        put(mat.timber, new THREE.CylinderGeometry(0.035, 0.035, 2.7, 6), -0.95, 1.35, -0.5);
        put(mat.palette, pal(new THREE.ConeGeometry(1.55, 0.55, 16), '#c2342b'), -0.95, 2.72, -0.5);
        put(mat.palette, pal(new THREE.ConeGeometry(0.4, 0.2, 16), '#f1e6c8'), -0.95, 3.02, -0.5);
        break;
      }
      case 'pole': {
        put(mat.palette, pal(new THREE.CylinderGeometry(0.12, 0.16, 7.6, 8), '#6d5a48'), 0, 3.3, 0);
        put(mat.palette, pal(boxUV(1.7, 0.12, 0.12), '#5a4a3c'), 0, 6.9, 0, 0, Math.PI / 2, 0);
        for (const z of [-0.55, 0, 0.55]) put(mat.palette, pal(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6), '#e8e4da'), 0, 7.05, z, 0, 0, 0, FAR);
        if (rng() < 0.5) put(mat.palette, pal(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 10), '#8d959b'), 0.3, 5.6, 0, 0, 0, 0, FAR);
        break;
      }
      case 'banner': {
        put(mat.palette, pal(new THREE.CylinderGeometry(0.035, 0.04, 4.2, 6), '#2a2020'), 0, 2.1, 0);
        put(mat.palette, pal(boxUV(0.7, 0.04, 0.04), '#2a2020'), 0.3, 4.05, 0);
        const i = [7, 8, 1, 12][p.color % 4];
        for (const s of [1, -1]) put(mat.signAtlas, signPlaneI(i, 0.62, 2.5), 0.34, 2.75, s * 0.012, 0, s > 0 ? 0 : Math.PI, 0);
        break;
      }
      case 'stump': {
        put(mat.bark, paintBy(new THREE.CylinderGeometry(0.52, 0.64, 0.75, 12), () => [0.9, 0.95, 0.85]), 0, 0.3, 0);
        put(mat.woodCut, new THREE.CircleGeometry(0.52, 12).rotateX(-Math.PI / 2), 0, 0.68, 0);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU + rng();
          put(mat.bark, paintBy(new THREE.CylinderGeometry(0.1, 0.16, 0.7, 6).rotateZ(Math.PI / 2 - 0.3), () => [0.85, 0.92, 0.8]), Math.cos(a) * 0.62, 0.05, Math.sin(a) * 0.62, 0, -a, 0);
        }
        break;
      }
      case 'dummy': {
        put(mat.woodLight, new THREE.CylinderGeometry(0.18, 0.21, 1.9, 10), 0, 0.8, 0);
        for (const y of [0.55, 0.85, 1.15]) put(mat.palette, pal(new THREE.CylinderGeometry(0.235, 0.235, 0.16, 12), '#d9c07a'), 0, y, 0);
        put(mat.woodLight, new THREE.CylinderGeometry(0.07, 0.07, 1.1, 8).rotateZ(Math.PI / 2), 0, 1.4, 0, 0, p.yaw, 0);
        put(mat.rope, new THREE.TorusGeometry(0.2, 0.03, 5, 12).rotateX(Math.PI / 2), 0, 1.45, 0, 0, 0, 0, FAR);
        break;
      }
      case 'targetStand': {
        for (const s of [-1, 1]) put(mat.timber, boxUV(0.09, 1.9, 0.09), s * 0.5, 0.9, 0, 0, 0, s * 0.18);
        put(mat.timber, boxUV(1.2, 0.08, 0.08), 0, 0.7, 0);
        for (const s of [1, -1]) put(mat.target, new THREE.CircleGeometry(0.55, 24), 0, 1.4, s * 0.06, 0, s > 0 ? 0 : Math.PI, 0);
        put(mat.woodLight, new THREE.CylinderGeometry(0.56, 0.56, 0.1, 24).rotateX(Math.PI / 2), 0, 1.4, 0);
        break;
      }
      case 'rack': {
        for (const s of [-1, 1]) put(mat.timber, boxUV(0.1, 1.7, 0.3), s * 0.85, 0.85, 0);
        for (const y of [0.35, 1.45]) put(mat.timber, boxUV(1.8, 0.08, 0.3), 0, y, 0);
        for (let k = 0; k < 5; k++) put(mat.woodLight, new THREE.CylinderGeometry(0.025, 0.025, 1.9, 5), -0.6 + k * 0.3, 0.95, 0.05, -0.12, 0, 0);
        for (const k of [0, 1]) {
          put(mat.palette, pal(boxUV(0.05, 0.9, 0.02), '#c9ced3'), -0.45 + k * 0.9, 1.0, -0.1, 0, 0, 0.08);
          put(mat.palette, pal(boxUV(0.06, 0.3, 0.04), '#2a2020'), -0.45 + k * 0.9 - 0.05, 0.45, -0.1, 0, 0, 0.08);
        }
        break;
      }
      case 'logpile': {
        const rows = [[-0.9, -0.3, 0.3, 0.9], [-0.6, 0, 0.6], [-0.3, 0.3]];
        rows.forEach((row, j) => row.forEach((x) => {
          put(mat.bark, paintBy(new THREE.CylinderGeometry(0.26, 0.26, 2.6, 10).rotateZ(Math.PI / 2), () => [0.95, 0.95, 0.9]), 0, 0.26 + j * 0.45, x);
          for (const s of [-1, 1]) put(mat.woodCut, new THREE.CircleGeometry(0.25, 10).rotateY((s * Math.PI) / 2), s * 1.31, 0.26 + j * 0.45, x);
        }));
        break;
      }
      case 'sakura': {
        // a leaning trunk forking into three limbs, a cloud of blossom puffs (pink, some paler), no leaves yet
        const lean = rng() * TAU;
        const tip = [Math.cos(lean) * 0.25, 3.0, Math.sin(lean) * 0.25]; // (inside its collider: r 0.32)
        const trunk = new THREE.CylinderGeometry(0.2, 0.3, 3.2, 10);
        put(mat.bark, trunk, tip[0] / 2, 1.5, tip[2] / 2, Math.sin(lean) * 0.08, 0, -Math.cos(lean) * 0.08);
        // the canopy: scalloped clumps shaded as one soft mass (nature.js foliage, in world space round C)
        const cx = p.x + tip[0], cz = p.z + tip[2], C = { x: cx, y: p.g + 4.6, z: cz, R: 3.2, Rv: 1.9 };
        const bt = rng() < 0.5 ? [1.12, 0.93, 0.98] : [1.05, 0.86, 0.94];
        for (let k = 0; k < 3; k++) {
          const a = lean + (k / 3) * TAU + rng() * 0.6, L = 1.6 + rng() * 0.6;
          const limb = new THREE.CylinderGeometry(0.08, 0.16, L, 7);
          limb.translate(0, L / 2, 0).rotateZ(-0.85).rotateY(-a);
          put(mat.bark, limb, tip[0], 2.9, tip[2]);
        }
        // many small clumps: a fluffy, scalloped cloud (a few big ones read as pink boulders)
        for (let k = 0; k < 13; k++) {
          const a = (k / 13) * TAU * 2 + rng() * 0.5, d = k < 7 ? 1.9 + rng() * 0.5 : 1.0 + rng() * 0.5, up = k < 7 ? -0.5 : 0.4;
          B.add(mat.blossom, foliage(cx + Math.cos(a) * d, C.y + up + (rng() - 0.4) * 0.6, cz + Math.sin(a) * d, 0.75 + rng() * 0.3, rng, 2, C, bt, 0.85));
        }
        B.add(mat.blossom, foliage(cx, C.y + 0.9, cz, 1.2, rng, 2, C, bt, 0.8));
        B.add(mat.blossom, foliage(cx, C.y - 0.2, cz, 1.4, rng, 2, C, bt, 0.7));
        // fallen petals: a pink disc on the ground
        put(mat.blossom, paintBy(new THREE.CircleGeometry(2.4, 18).rotateX(-Math.PI / 2), () => [1.1, 0.8, 0.88]), tip[0], 0.03, tip[2], 0, 0, 0, FAR);
        break;
      }
      case 'bamboo': {
        const n = 10 + Math.floor(rng() * 5);
        for (let k = 0; k < n; k++) {
          const a = rng() * TAU, d = rng() * 0.8, h = 5 + rng() * 3.5, r = 0.045 + rng() * 0.03;
          const x = Math.cos(a) * d, z = Math.sin(a) * d, tilt = (rng() - 0.5) * 0.12;
          const c = rng() < 0.3 ? '#8fae4a' : '#5f9a3a';
          put(mat.palette, pal(new THREE.CylinderGeometry(r * 0.8, r, h, 6), c), x, h / 2 - 0.2, z, tilt, 0, tilt);
          for (let y = 0.8; y < h - 0.5; y += 0.7 + rng() * 0.2) put(mat.palette, pal(new THREE.CylinderGeometry(r * 1.2, r * 1.2, 0.05, 6), '#c7d67f'), x + tilt * y, y - 0.2, z - tilt * y, 0, 0, 0, FAR);
          put(mat.leaves, puff(0.7 + rng() * 0.4, rng, [0.95, 1.05, 0.8], 0.6), x + tilt * h, h - 0.3, z - tilt * h);
        }
        break;
      }
      case 'boulder': {
        const g = new THREE.IcosahedronGeometry(1, 2);
        const q = g.attributes.position;
        for (let i = 0; i < q.count; i++) {
          const x = q.getX(i), y = q.getY(i), z = q.getZ(i);
          const k = 1 + 0.14 * Math.sin(x * 4 + p.x) * Math.sin(z * 3 + y * 2);
          q.setXYZ(i, x * k, Math.max(-0.5, y) * (y > 0 ? 0.9 : 1), z * k);
        }
        g.computeVertexNormals();
        paintBy(g, (x, y) => (y > 0.55 ? [0.75, 1.0, 0.55] : [1.2, 1.08, 0.94])); // moss on top
        B.add(mat.rock, g.clone().applyMatrix4(new THREE.Matrix4().makeScale(p.r * 0.98, p.h * 0.62, p.r * 0.98)), F.clone().multiply(M(0, p.h * 0.45, 0)));
        break;
      }
      case 'shrine': {
        put(mat.stone, boxUV(1.9, 0.4, 1.7, 1.2), 0, 0.2, 0);
        put(mat.woodLight, boxUV(1.4, 1.3, 1.2, 1.5), 0, 1.05, 0);
        put(mat.interior, boxUV(0.8, 0.9, 0.04), 0, 1.0, 0.62);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(mat.timber, boxUV(0.12, 1.4, 0.12), sx * 0.66, 1.05, sz * 0.56);
        for (const s of [-1, 1]) put(mat.roof, tint(boxUV(1.9, 0.07, 1.15, 0.9), '#4f7d6a'), 0, 2.02, s * 0.46, s * 0.55, 0, 0);
        put(mat.roofRidge, boxUV(1.95, 0.12, 0.14), 0, 2.3, 0);
        // the sacred rope with its white paper zigzags, an offering box
        put(mat.rope, new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6).rotateZ(Math.PI / 2), 0, 1.72, 0.66);
        for (const x of [-0.45, 0, 0.45]) put(mat.palette, pal(boxUV(0.12, 0.3, 0.01), '#f7f2ea'), x, 1.5, 0.68, 0, 0, 0, FAR);
        put(mat.woodLight, boxUV(0.7, 0.4, 0.4, 1.5), 0, 0.2, 1.2);
        break;
      }
    }
  }
}
