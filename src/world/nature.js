// Nature and field pieces, built from the map's prop descriptors (their colliders come from src/shared/map.js):
// giant trees (a trunk with buttress roots and bark ridges that never stands outside its collider, tapering limbs
// that rise a little and fork at the end, surface roots, one canopy mass built from leafy clumps and shaded as a
// whole), cliffs (displaced rock blocks with grass tops), rock outcrops, fallen logs, rusty chain-link fences, the
// training posts, the memorial stone, a target, and light shafts through the forest canopy.
import * as THREE from 'three';
import { mulberry32 } from '../shared/rng.js';
import { treeRadius } from '../shared/map.js';
import { M, boxUV } from './batch.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** A grid geometry (rings x segments, the last column repeats the first), indexed, normals computed. */
function gridGeometry(rings, seg, pos) {
  const idx = [];
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertex colours from a function of world position and normal. */
function paintVerts(g, f) {
  const p = g.attributes.position, n = g.attributes.normal, c = new Float32Array(p.count * 3);
  const out = [1, 1, 1];
  for (let i = 0; i < p.count; i++) {
    f(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), out);
    c[i * 3] = out[0];
    c[i * 3 + 1] = out[1];
    c[i * 3 + 2] = out[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/**
 * A tube along a centreline: pts [[x, y, z]...], rad(i) per point, seg sides, squash: vertical scale of the section
 * (roots are flat). The first ring is closed off by the trunk it starts in, the last tapers to a point.
 */
function tube(pts, rad, seg, squash = 1) {
  const pos = [];
  for (let j = 0; j < pts.length; j++) {
    const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
    _t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    _s.crossVectors(_t, UP).normalize();
    _u.crossVectors(_s, _t).normalize();
    const r = rad(j);
    for (let i = 0; i <= seg; i++) {
      const th = -(i / seg) * TAU, cu = Math.cos(th) * r * squash, cs = Math.sin(th) * r; // winding: faces point out
      pos.push(pts[j][0] + _u.x * cu + _s.x * cs, pts[j][1] + _u.y * cu + _s.y * cs, pts[j][2] + _u.z * cu + _s.z * cs);
    }
  }
  return gridGeometry(pts.length, seg, pos);
}

/**
 * The trunk: rings from below the ground into the canopy. Its radius is the collider's (treeRadius) at the buttress
 * roots' ridges and less between them and in the bark's grooves: nothing drawn stands outside the collider.
 */
function trunkGeometry(t, map, rng) {
  const [ty0, tr0, ty1, tr1] = t.trunk;
  const rt = (y) => tr0 + ((tr1 - tr0) * (y - ty0)) / (ty1 - ty0);
  let yb = t.g;
  for (let k = 0; k < 8; k++) yb = Math.min(yb, map.world.terrain(t.x + Math.cos((k / 8) * TAU) * t.r * 1.7, t.z + Math.sin((k / 8) * TAU) * t.r * 1.7));
  yb -= 0.5;
  const ys = [];
  for (let y = yb; y < t.flare[2] + 0.3; y += 0.3) ys.push(y);
  for (let y = t.flare[2] + 0.3; y < t.crown - 1; y += 1.1) ys.push(y);
  ys.push(t.crown - 1);
  const nf = 5 + Math.floor(rng() * 3), fins = [];
  for (let k = 0; k < nf; k++) fins.push((k / nf) * TAU + (rng() - 0.5) * 0.7);
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU];
  const seg = 36, pos = [];
  for (const y of ys) {
    const env = treeRadius(t, y), core = Math.min(env, rt(y));
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      let fin = 0;
      for (const f of fins) fin = Math.max(fin, Math.exp(-((wrapA(a - f) / 0.32) ** 2)));
      // buttresses reach the collider's cone; between them the trunk sinks back toward its core
      let r = core + (env - core) * (0.28 + 0.72 * fin);
      // bark ridges (vertical, slowly twisting) and broad lumps: only ever inward
      r *= 1 - 0.055 * (0.5 + 0.5 * Math.sin(a * 13 + y * 0.12 + ph[0])) - 0.035 * (0.5 + 0.5 * Math.sin(a * 5 - y * 0.23 + ph[1])) - 0.02 * (0.5 + 0.5 * Math.sin(a * 3 + y * 0.5 + ph[2]));
      pos.push(t.x + Math.cos(a) * r, y, t.z + Math.sin(a) * r);
    }
  }
  const g = gridGeometry(ys.length, seg, pos);
  // darker, mossy foot; a hint of moss on the north side higher up
  return paintVerts(g, (x, y, z, nx, ny, nz, o) => {
    const h = y - t.g;
    const foot = 1 - smooth(-0.2, 3.2, h);
    const north = Math.max(0, -nz) * (1 - smooth(4, 12, h)) * 0.35;
    const moss = Math.min(1, foot * 0.75 + north);
    const dark = 0.72 + 0.28 * smooth(-0.5, 2.5, h);
    o[0] = dark * (1 - moss * 0.28);
    o[1] = dark * (1 + moss * 0.1);
    o[2] = dark * (1 - moss * 0.45);
  });
}

/** Moss on whatever faces up (the top of a limb, a root's back), darker underneath. */
function limbColour(x, y, z, nx, ny, nz, o) {
  const moss = smooth(0.35, 0.85, ny) * 0.8;
  const under = 0.78 + 0.22 * smooth(-0.8, 0.2, ny);
  o[0] = under * (1 - moss * 0.3);
  o[1] = under * (1 + moss * 0.12);
  o[2] = under * (1 - moss * 0.5);
}

/**
 * A branch: starts inside the trunk (a collar swelling under it), tapers from w to w/2 along the walkable part (its
 * top IS the collider's sloped top), then its tip thins out and curls up past the collider's end. Returns the tip
 * and a couple of fork points for twigs and leaves.
 */
function branchGeometry(t, b, rng) {
  const L = b.len, ext = 1.6 + rng() * 0.4, curl = 0.3 + rng() * 0.2;
  const rad0 = (s) => (b.w / 2) * (1 - 0.5 * Math.max(0, Math.min(1, s / L)));
  const collar = (s) => 1 + 0.5 * Math.max(0, 1 - (s + 0.4) / 1.4) ** 2;
  const side = [-b.dz, b.dx], wob = rng() * TAU;
  const s0 = -Math.min(b.rb - 0.25, 1.4);
  const pts = [], rads = [];
  const n = 16;
  for (let j = 0; j <= n; j++) {
    const s = s0 + ((L + ext - s0) * j) / n;
    let r, cy;
    if (s <= L) {
      r = rad0(s) * collar(s);
      cy = b.y + (b.rise * s) / L - rad0(s) * 0.97 - (r - rad0(s)); // the top stays on the collider; the collar swells below
    } else {
      const u = (s - L) / ext;
      r = rad0(L) * (1 - u * 0.85);
      cy = b.y + b.rise + (b.rise / L) * (s - L) + curl * ext * u * u - r * 0.97;
    }
    // a slight sideways wander along the limb (well inside the collider's half width)
    const lat = Math.sin(s * 0.9 + wob) * 0.08 * smooth(0, 1.5, s);
    pts.push([t.x + b.dx * (b.rb + s) + side[0] * lat, cy, t.z + b.dz * (b.rb + s) + side[1] * lat]);
    rads.push(r);
  }
  const g = paintVerts(tube(pts, (j) => rads[j], 14), limbColour);
  const at = (s) => {
    const j = Math.max(0, Math.min(n, Math.round(((s - s0) / (L + ext - s0)) * n)));
    return { p: pts[j], r: rads[j] };
  };
  return { g, tip: pts[n], at };
}

/** A twig forking off a limb: thin, rising, curving; visual only (you run through it). */
function twigGeometry(from, dir, len, r0, rng) {
  const pts = [];
  const n = 6, up = 0.45 + rng() * 0.35, droop = 0.25;
  for (let j = 0; j <= n; j++) {
    const u = j / n;
    pts.push([from[0] + dir[0] * len * u, from[1] + len * (up * u - droop * u * u), from[2] + dir[1] * len * u]);
  }
  return { g: paintVerts(tube(pts, (j) => r0 * (1 - (j / n) * 0.8), 7), limbColour), tip: pts[n] };
}

/** A surface root: a flattened tube snaking out over the ground from a buttress, sinking into it at the end. */
function rootGeometry(t, map, a, rng) {
  const pts = [], n = 7, r0 = t.r * (0.16 + rng() * 0.06), len = t.r * (0.9 + rng() * 0.7);
  const bend = (rng() - 0.5) * 0.6;
  for (let j = 0; j <= n; j++) {
    const u = j / n, aa = a + bend * u, d = t.r * 1.35 + len * u;
    const x = t.x + Math.cos(aa) * d, z = t.z + Math.sin(aa) * d;
    pts.push([x, map.world.terrain(x, z) + r0 * 0.25 * (1 - u) - 0.05 * u, z]);
  }
  return paintVerts(tube(pts, (j) => r0 * (1 - (j / n) * 0.75), 8, 0.55), limbColour);
}

/**
 * One leafy clump: a noisy sphere with a scalloped (leaf-cluster) silhouette. Its normals lean toward the whole
 * canopy's (centre C, radii R, Rv): every clump of a tree shades as one soft mass, the anime-foliage look.
 * Vertex colours darken the canopy's underside and inside (cheap ambient occlusion).
 */
function foliage(cx, cy, cz, r, rng, detail, C, tint, flat = 0.82) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, n = g.attributes.normal;
  const f = [rng() * 10, rng() * 10, rng() * 10, rng() * 10];
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const l = Math.hypot(x, y, z);
    const nx = x / l, ny = y / l, nz = z / l;
    const scallop = Math.abs(Math.sin(nx * 7 + f[3]) * Math.sin(ny * 7 + f[0]) * Math.sin(nz * 7 + f[1]));
    const k = 1 + 0.14 * Math.sin(nx * 5 + f[0]) * Math.sin(ny * 4 + f[1]) + 0.08 * Math.sin(nz * 9 + f[2]) + 0.1 * scallop - (ny < -0.25 ? (-ny - 0.25) * 0.4 : 0);
    const wx = cx + x * k, wy = cy + y * k * flat, wz = cz + z * k;
    p.setXYZ(i, wx, wy, wz);
    // the canopy's normal here (an ellipsoid round C) blended with the clump's own
    let ex = (wx - C.x) / C.R, ey = (wy - C.y) / C.Rv, ez = (wz - C.z) / C.R;
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el;
    ey /= el;
    ez /= el;
    const bx = nx * 0.45 + ex * 0.55, by = ny * 0.45 + ey * 0.55, bz = nz * 0.45 + ez * 0.55;
    const bl = Math.hypot(bx, by, bz);
    n.setXYZ(i, bx / bl, by / bl, bz / bl);
    // occlusion: the underside and the inside of the mass are darker (and a little cooler)
    const out = Math.min(1, el);
    const ao = 0.5 + 0.3 * smooth(-0.9, 0.6, ey) + 0.2 * smooth(0.45, 1, out);
    col[i * 3] = ao * tint[0] * (0.9 + 0.1 * ao);
    col[i * 3 + 1] = ao * tint[1];
    col[i * 3 + 2] = ao * tint[2] * (1.12 - 0.12 * ao);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Old-style blob (the woodland along the boundary walls): soft sphere normals, no canopy. */
function clump(cx, cy, cz, r, rng, detail = 3) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, n = g.attributes.normal;
  const f = [rng() * 10, rng() * 10, rng() * 10];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const l = Math.hypot(x, y, z);
    const nx = x / l, ny = y / l, nz = z / l;
    const k = 1 + 0.16 * Math.sin(nx * 5 + f[0]) * Math.sin(ny * 4 + f[1]) + 0.1 * Math.sin(nz * 9 + f[2]) - (ny < -0.3 ? (-ny - 0.3) * 0.35 : 0);
    p.setXYZ(i, cx + x * k, cy + y * k * 0.82, cz + z * k);
    n.setXYZ(i, nx, ny, nz);
  }
  return g;
}

export function buildTrees(map, B, mat) {
  const rng = mulberry32(777);
  for (const t of map.trees) {
    B.add(mat.bark, trunkGeometry(t, map, rng));
    // surface roots continue a few of the buttresses out over the ground (low: feet pass over them)
    const nr = 4 + Math.floor(rng() * 3);
    for (let k = 0; k < nr; k++) B.add(mat.bark, rootGeometry(t, map, (k / nr) * TAU + rng() * 0.6, rng));
    // a tree's own leaf tint: some a little warmer, some cooler
    const warm = rng();
    const tint = [0.96 + warm * 0.1, 1, 0.9 - warm * 0.12];
    // the canopy: a flattened dome of clumps under the crown you can stand on
    const R = 4.4 + t.r * 0.9, Rv = 2.9;
    const C = { x: t.x, y: t.crown - 2.4, z: t.z, R, Rv };
    const put = (x, y, z, r, detail, flat) => B.add(mat.leaves, foliage(x, y, z, r, rng, detail, C, tint, flat));
    // the top: a wide low clump whose surface is the crown's floor, and a ring round its edge
    const rt = t.cr + 1.6;
    put(t.x, t.crown + 0.25 - rt * 0.6, t.z, rt, 3, 0.6);
    const ne = 5;
    for (let k = 0; k < ne; k++) {
      const a = (k / ne) * TAU + rng() * 0.5, d = t.cr * 0.95;
      const r = 1.7 + rng() * 0.5;
      put(t.x + Math.cos(a) * d, t.crown + 0.1 - r * 0.7, t.z + Math.sin(a) * d, r, 2, 0.8);
    }
    // the body: a ring of big clumps, a lower ring further out (the canopy's skirt), one filler inside
    const nm = 7;
    for (let k = 0; k < nm; k++) {
      const a = (k / nm) * TAU + rng() * 0.5, d = R * (0.55 + rng() * 0.12);
      put(t.x + Math.cos(a) * d, C.y + (rng() - 0.35) * 1.1, t.z + Math.sin(a) * d, 2.6 + rng() * 0.8, 3);
    }
    const nl = 6;
    for (let k = 0; k < nl; k++) {
      const a = ((k + 0.5) / nl) * TAU + rng() * 0.5, d = R * (0.78 + rng() * 0.12);
      put(t.x + Math.cos(a) * d, C.y - 1.5 - rng() * 0.6, t.z + Math.sin(a) * d, 1.9 + rng() * 0.6, 2);
    }
    put(t.x, C.y - 0.6, t.z, R * 0.55, 2);
    // branches: the limb, one or two twigs forking off its outer half, leaves at the tip and on the twigs
    for (const b of t.branches) {
      const { g, tip, at } = branchGeometry(t, b, rng);
      B.add(mat.bark, g);
      // leaves round the tip: a spray out past the walkable end and above it (never over where you stand)
      const ox = tip[0] + b.dx * 0.8, oz = tip[2] + b.dz * 0.8, oy = tip[1] + 1.2;
      const bc = { x: ox, y: oy, z: oz, R: 2.6, Rv: 1.9 };
      B.add(mat.leaves, foliage(ox, oy, oz, 1.5 + rng() * 0.35, rng, 3, bc, tint, 0.75));
      for (const sg of [-1, 1]) {
        if (rng() < 0.35) continue;
        const lx = ox - b.dz * sg * 1.1 + b.dx * 0.2, lz = oz + b.dx * sg * 1.1 + b.dz * 0.2;
        B.add(mat.leaves, foliage(lx, oy + 0.3 + rng() * 0.5, lz, 1.0 + rng() * 0.3, rng, 2, bc, tint, 0.75));
      }
      const nt = 1 + (rng() < 0.6 ? 1 : 0);
      for (let k = 0; k < nt; k++) {
        const s = b.len * (0.55 + rng() * 0.3);
        const f = at(s);
        const sg = k === 0 ? (rng() < 0.5 ? -1 : 1) : -1;
        const ang = Math.atan2(b.dz, b.dx) + sg * (0.6 + rng() * 0.4);
        const from = [f.p[0], f.p[1] + f.r * 0.3, f.p[2]];
        const tw = twigGeometry(from, [Math.cos(ang), Math.sin(ang)], 1.8 + rng() * 1.1, f.r * 0.42, rng);
        B.add(mat.bark, tw.g);
        const tc = { x: tw.tip[0], y: tw.tip[1] + 0.5, z: tw.tip[2], R: 1.8, Rv: 1.4 };
        B.add(mat.leaves, foliage(tw.tip[0], tw.tip[1] + 0.55, tw.tip[2], 1.05 + rng() * 0.4, rng, 2, tc, tint));
      }
    }
  }
}

/** Cliff / rock-wall blocks: a subdivided box pushed outward with noise on its sides, and a grass cap on top. */
export function buildCliffs(map, B, mat) {
  const rng = mulberry32(991);
  for (const c of map.props) {
    if (c.t !== 'cliff') continue;
    const s = c.s;
    const w = s.hx * 2, d = s.hz * 2, h = s.y1 - s.y0;
    const g = new THREE.BoxGeometry(w, h, d, Math.max(2, Math.round(w / 0.9)), Math.max(2, Math.round(h / 0.9)), Math.max(2, Math.round(d / 0.9)));
    const p = g.attributes.position;
    const ph = [rng() * 10, rng() * 10];
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const top = y > h / 2 - 1e-3;
      // side faces bulge out (strata: stronger horizontal banding), the top stays flat to stand on
      const ex = Math.abs(x) > s.hx - 1e-3, ez = Math.abs(z) > s.hz - 1e-3;
      if (!top) {
        const strata = 0.5 + 0.5 * Math.sin((y + s.y0) * 1.7 + ph[0]);
        const bump = 0.18 * strata + 0.12 * Math.sin(x * 1.3 + z * 1.1 + ph[1]) * Math.sin(y * 2.1);
        if (ex) x += Math.sign(x) * bump;
        if (ez) z += Math.sign(z) * bump;
      }
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    const yaw = s.c !== undefined ? -Math.atan2(s.s2, s.c) : 0;
    B.add(mat.rock, g, M(s.x, (s.y0 + s.y1) / 2, s.z, 0, yaw, 0));
    // grass cap with a ragged lip
    if (!c.rim || h < 20) {
      const cap = boxUV(w + 0.3, 0.3, d + 0.3);
      B.add(mat.grassCap, cap, M(s.x, s.y1 + 0.02, s.z, 0, yaw, 0));
    }
    // the boundary walls: a line of woodland along the top (the horizon reads as forest, not a straight wall);
    // low-poly clumps, set back behind the edge (out of bounds, no colliders)
    if (c.rim) {
      let nx = -s.s2, nz = s.c;
      if (nx * s.x + nz * s.z < 0) (nx = -nx), (nz = -nz);
      const n = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) {
        const t = ((k + 0.5) / n - 0.5) * w, r = 3 + rng() * 2.2, back = 1.2 + rng() * 2.5;
        B.add(mat.leaves, clump(s.x + s.c * t + nx * back, s.y1 + r * 0.35 + rng() * 1.5, s.z + s.s2 * t + nz * back, r, rng, 2));
      }
    }
  }
}

export function buildRocks(map, B, mat) {
  const rng = mulberry32(313);
  for (const r of map.props) {
    if (r.t === 'rock') {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 + 0.15 * Math.sin(x * 4 + r.seed) * Math.sin(z * 3 + y * 2);
        // flat-ish bottom (sits in the ground), flatter top
        p.setXYZ(i, x * k, Math.max(-0.6, y) * (y > 0 ? 0.85 : 1), z * k);
      }
      g.computeVertexNormals();
      B.add(mat.rock, g, M(r.x, r.g + r.h * 0.45, r.z, 0, -Math.atan2(r.dz, r.dx), 0, r.s * 0.95, r.h * 0.62, r.s * 0.72));
    } else if (r.t === 'stone') {
      const g = new THREE.IcosahedronGeometry(1, 2);
      B.add(mat.stone, g, M(r.x, r.top - 0.18, r.z, 0, rng() * TAU, 0, r.r * 1.05, 0.3, r.r));
    }
  }
}

export function buildLogs(map, B, mat) {
  for (const l of map.props) {
    if (l.t !== 'log') continue;
    const g = new THREE.CylinderGeometry(l.r, l.r * 1.05, l.len, 14, 1, true);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * l.r * 6, uv.getY(i) * l.len * 0.4);
    g.rotateZ(Math.PI / 2);
    const yaw = -Math.atan2(l.dz, l.dx);
    B.add(mat.bark, g, M(l.x, l.y, l.z, 0, yaw, 0));
    // cut ends: pale wood
    for (const sgn of [-1, 1]) {
      const e = new THREE.CircleGeometry(l.r * 1.02, 14);
      e.rotateY(sgn * Math.PI / 2);
      e.translate(sgn * l.len / 2, 0, 0);
      B.add(mat.woodCut, e, M(l.x, l.y, l.z, 0, yaw, 0));
    }
  }
}

export function buildFences(map, B, mat) {
  for (const f of map.props) {
    if (f.t !== 'fence') continue;
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), yaw = -Math.atan2(f.z1 - f.z0, f.x1 - f.x0);
    const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
    const gy = map.world.terrain(cx, cz);
    const mesh = new THREE.PlaneGeometry(len, f.h - 0.1);
    const uv = mesh.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 1.4, uv.getY(i) * (f.h - 0.1) * 1.4);
    B.add(mat.chain, mesh, M(cx, gy + f.h / 2, cz, 0, yaw, 0));
    const n = Math.max(2, Math.round(len / 2.4) + 1);
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1), x = f.x0 + (f.x1 - f.x0) * t, z = f.z0 + (f.z1 - f.z0) * t;
      B.add(mat.rust, new THREE.CylinderGeometry(0.045, 0.05, f.h + 0.5, 8), M(x, map.world.terrain(x, z) + (f.h + 0.5) / 2 - 0.4, z));
    }
    const rail = new THREE.CylinderGeometry(0.03, 0.03, len, 6);
    rail.rotateZ(Math.PI / 2);
    B.add(mat.rust, rail, M(cx, gy + f.h, cz, 0, yaw, 0));
  }
}

export function buildField(map, B, mat) {
  for (const p of map.props) {
    if (p.t === 'post') {
      B.add(mat.woodLight, new THREE.CylinderGeometry(0.22, 0.25, 2.2, 14), M(p.x, p.g + 0.6, p.z));
      for (const y of [0.9, 1.25]) B.add(mat.rope, new THREE.TorusGeometry(0.245, 0.035, 6, 18).rotateX(Math.PI / 2), M(p.x, p.g + y, p.z));
    } else if (p.t === 'memorial') {
      const g = boxUV(2.8, 2.9, 0.9, 0.8);
      B.add(mat.memorial, g, M(p.x, p.g + 1.25, p.z, 0, p.yaw, 0));
      B.add(mat.stone, boxUV(3.4, 0.4, 1.4), M(p.x, p.g + 0.05, p.z, 0, p.yaw, 0));
    } else if (p.t === 'target' && p.tree >= 0) {
      const t = map.trees[p.tree];
      // on the side of the trunk that faces the field (east)
      const g = new THREE.CircleGeometry(0.5, 24);
      g.rotateY(Math.PI / 2);
      B.add(mat.target, g, M(t.x + treeRadius(t, t.g + p.y) * 0.96 + 0.04, t.g + p.y, t.z));
    }
  }
}

/** Soft shafts of light slanting down through the forest canopy (additive, no depth write). */
/**
 * Light shafts through the forest canopy: one mesh, one draw. Each shaft is a quad along the sun direction that turns
 * about its own axis to face the camera (a flat plane seen edge-on became a hard line, like a scratch), fades out when
 * seen end-on, near the camera, at its ends and across its width, and breathes slowly.
 */
export function buildShafts(map, sunDir) {
  const rng = mulberry32(55);
  const base = [], corner = [], size = [], idx = [];
  let n = 0;
  for (const t of map.trees) {
    if (t.x > -8 || rng() < 0.3) continue;
    for (let k = 0; k < 2; k++) {
      const x = t.x + (rng() - 0.5) * 12, z = t.z + (rng() - 0.5) * 12, y = t.g - 0.6;
      const w = 2.2 + rng() * 2.4, h = 16 + rng() * 6, ph = rng() * 6.28;
      for (const [cx, cy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
        base.push(x, y, z);
        corner.push(cx, cy);
        size.push(w, h, ph);
      }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
  g.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('size', new THREE.Float32BufferAttribute(size, 3));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAxis: { value: new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z).normalize() } },
    vertexShader: /* glsl */ `
      attribute vec2 corner; attribute vec3 size; uniform vec3 uAxis; uniform float uTime;
      varying vec2 vUv; varying float vFade;
      void main() {
        vec3 p = position + uAxis * corner.y * size.y;
        vec3 toCam = cameraPosition - p;
        vec3 side = normalize(cross(uAxis, toCam));
        p += side * corner.x * size.x * 0.5;
        vUv = vec2(corner.x * 0.5 + 0.5, corner.y);
        vec3 v = normalize(cameraPosition - p);
        float endOn = abs(dot(v, uAxis));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vFade = smoothstep(3.0, 12.0, -mv.z) * (1.0 - smoothstep(0.6, 0.95, endOn)) * (0.75 + 0.25 * sin(uTime * 0.5 + size.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `varying vec2 vUv; varying float vFade;
      void main() {
        float x = (vUv.x - 0.5) * 2.0;
        float a = exp(-x * x * 3.0) * smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.78) * a * 0.12 * vFade, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = 4;
  m.userData.mat = mat;
  return m;
}

/**
 * Leaves drifting down through the forest: one instanced draw, animated entirely in the vertex shader. Each leaf
 * falls through a 40 x 16 x 40 m box that wraps around the camera (constant density wherever you are), fluttering
 * and spinning; a mask on world x keeps them over the forest (west of the river), and they fade near the camera.
 */
export function buildLeaves(count = 420) {
  const g = new THREE.PlaneGeometry(0.18, 0.11);
  const seeds = new Float32Array(count * 4);
  const rng = mulberry32(77);
  for (let i = 0; i < count * 4; i++) seeds[i] = rng();
  g.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, ...THREE.UniformsLib.fog },
    vertexShader: /* glsl */ `
      attribute vec4 seed; uniform float uTime; varying float vA; varying vec2 vUv; varying float vTone;
      #include <fog_pars_vertex>
      void main() {
        vec3 box = vec3(32.0, 14.0, 32.0);
        float t = uTime * (0.08 + seed.w * 0.05) + seed.y;
        vec3 p = vec3(seed.x, 1.0 - fract(t), seed.z) * box;
        // wrap round the camera (x, z) and hang the column from ~12 m above it
        p.xz = mod(p.xz - cameraPosition.xz + box.xz * 0.5, box.xz) + cameraPosition.xz - box.xz * 0.5;
        p.y += cameraPosition.y - 4.0;
        float ph = uTime * (1.3 + seed.w) + seed.x * 40.0;
        p.x += sin(ph) * 0.6;
        p.z += cos(ph * 0.8) * 0.4;
        // spin and flutter
        float a = ph * 1.7, b = sin(ph * 2.3) * 1.2;
        vec3 q = position;
        q.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * q.xy;
        q.yz = mat2(cos(b), -sin(b), sin(b), cos(b)) * q.yz;
        vec4 mvPosition = viewMatrix * vec4(p + q, 1.0);
        float forest = 1.0 - smoothstep(-14.0, -6.0, p.x);
        vA = forest * smoothstep(3.5, 8.0, -mvPosition.z) * smoothstep(0.0, 0.08, fract(t)) * (1.0 - smoothstep(0.9, 1.0, fract(t)));
        vUv = uv;
        vTone = seed.w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying vec2 vUv; varying float vTone;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        // a leaf: pointed ellipse
        if (vA < 0.02 || c.x * c.x + c.y * c.y * (1.6 + c.x * c.x * 2.0) > 1.0) discard;
        vec3 col = mix(vec3(0.4, 0.58, 0.18), vec3(0.74, 0.6, 0.24), step(0.75, vTone));
        col *= 0.85 + 0.15 * (1.0 - abs(c.y) * 2.0);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
    side: THREE.DoubleSide,
    fog: true,
  });
  const m = new THREE.InstancedMesh(g, mat, count);
  m.frustumCulled = false;
  m.userData.mat = mat;
  return m;
}
