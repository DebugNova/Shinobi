// npm run rig -- <config.json>
// Turns an unrigged T-pose character (.glb, e.g. a Sketchfab download) into a VRM 1.0 the game loads like any
// VRoid model: a humanoid skeleton placed from the config's joint positions (fingers and thumbs found in the hand
// geometry), skin weights built for a T-pose, MToon (toon) materials with outlines, spring bones for hanging
// ribbons, and the source's credits in the VRM meta. Check the result with scripts/debug/modelview.mjs
// (bones, weights=<bone>, pose=run|kick|crouch|arms|punch) and in the game (F4 hurtboxes).
//
// Skin weights (all in the source's T-pose, model facing +z, its left = +x, y up):
//   torso: the spine chain by height; arms: the arm chain along x (shoulder, upper arm, elbow, wrist, fingers);
//   legs: the leg chain by height (hip, knee, ankle, toes along z); soft masks between the three (armpit, crotch).
//   Rules per mesh island (connected piece): `head` islands follow the head rigidly, `rigid` islands follow one bone,
//   `chains` (ribbons) get their own spring-bone joints, `skirt` islands below the waist follow the hips and both
//   thighs (never the shins: a long coat must not fold at the knees), `plates` (armour tassets over a coat) move
//   rigidly with the coat's weights at their centre, small islands (straps, buckles, cuffs) move rigidly with the
//   weights at their centre. A-pose models: `apose` lifts the arms into a T-pose first (see unpose()).
//
// For display figures (a head, a closed cloak and feet, no limbs under it: models/itachi.rig.json) there are more
// steps, all optional: `colors` repaints a source material, `shift` moves the source (feet to y = 0), `drop` leaves out hidden materials, `simplify`
// thins over-dense flat-coloured pieces (meshoptimizer), `reshape` pulls vertices in to an envelope (a cloak's fused
// sleeves), `parts` adds generated tubes (arms, hands, legs) weighted like any mesh, `islands.noArm` keeps a garment
// off the arm bones, and `atlas` merges every material into one textured MToon material and one primitive (flat
// colours become palette cells in the texture's free space): one draw per fighter instead of one per material.
import fs from 'fs';
import path from 'path';
import { readGlb, accessor, viewBytes, BinBuilder, writeGlb } from './glb.mjs';
import { decodePng, encodePng } from './png.mjs';

const cfgPath = process.argv[2];
if (!cfgPath) {
  console.log('usage: npm run rig -- <config.json>   (see models/naruto_sage.rig.json)');
  process.exit(1);
}
const cfgDir = path.dirname(path.resolve(cfgPath));
const C = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const src = readGlb(path.resolve(cfgDir, C.source));
const outFile = path.resolve(cfgDir, C.out);
// `colors`: { material: '#rrggbb' } replaces a source material's base colour (sRGB, as a paint picker shows it)
for (const [mi, hex] of Object.entries(C.colors || {})) {
  if (mi === '_') continue;
  const lin = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const pbr = (src.json.materials[+mi].pbrMetallicRoughness ||= {});
  pbr.baseColorFactor = [...lin, pbr.baseColorFactor?.[3] ?? 1];
}

// ------------------------------------------------------------------ math
const smooth = (a, b, x) => {
  // smoothstep from a to b (a > b gives a falling edge)
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function mat4(n) {
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz, xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2, wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0, (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, tx, ty, tz, 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

// ------------------------------------------------------------------ source geometry in world space
const S = C.scale ?? 1;
const prims = [];
const DROP = new Set(C.drop?.materials || []);
function visit(ni, parentM) {
  const n = src.json.nodes[ni];
  const NM = mul(parentM, mat4(n));
  // `shift` moves the positions only (children get the unshifted matrix, or they would move twice)
  const M = C.shift ? NM.map((v, k) => (k >= 12 && k < 15 ? v + C.shift[k - 12] : v)) : NM;
  if (n.mesh !== undefined) {
    for (const p of src.json.meshes[n.mesh].primitives) {
      if (DROP.has(p.material ?? 0)) continue; // `drop`: hidden pieces (under a closed collar...)
      const P = accessor(src, p.attributes.POSITION), N = p.attributes.NORMAL !== undefined ? accessor(src, p.attributes.NORMAL) : null;
      const UV = accessor(src, p.attributes.TEXCOORD_0);
      const I = p.indices !== undefined ? accessor(src, p.indices) : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
      // a mirroring transform (negative determinant, e.g. a node scaled -100) flips the triangles' winding once it is
      // baked into the positions: swap it back, or every face is inside out (MToon's outline hull covers the model).
      // With normals, each triangle is oriented by them instead (below).
      const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
      if (det < 0 && !N) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]];
      const pos = new Float32Array(P.length), nrm = new Float32Array(P.length);
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        pos[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
        pos[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
        pos[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
        if (N) {
          const a = N[i], b = N[i + 1], c = N[i + 2];
          let nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c;
          const l = Math.hypot(nx, ny, nz) || 1;
          nrm[i] = nx / l;
          nrm[i + 1] = ny / l;
          nrm[i + 2] = nz / l;
        }
      }
      // every triangle faces the way its vertex normals do: ripped game meshes (drawn double-sided) wind about half
      // their triangles backwards, and MToon's outline hull (back faces) then shows through as dark blotches
      if (N) for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const d = (uy * vz - uz * vy) * (nrm[a] + nrm[b] + nrm[c]) + (uz * vx - ux * vz) * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + (ux * vy - uy * vx) * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]);
        if (d < 0) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]];
      }
      prims.push({ material: p.material ?? 0, pos, nrm: N ? nrm : null, uv: UV, idx: I });
    }
  }
  for (const c of n.children || []) visit(c, NM);
}
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const ni of src.json.scenes[src.json.scene || 0].nodes) visit(ni, I4);
if (C.simplify) await simplify(C.simplify);

/**
 * `simplify`: [{ material, ratio, error? }]: the primitives of that material, welded by position (UVs and normals
 * are dropped: for flat colours only, e.g. toes modelled with thousands of triangles), reduced to about `ratio` of
 * their triangles by meshoptimizer (error: a fraction of the piece's size), unused vertices removed; smooth normals
 * are computed at write time.
 */
async function simplify(list) {
  const { MeshoptSimplifier: MS } = await import('../../node_modules/three/examples/jsm/libs/meshopt_simplifier.module.js');
  await MS.ready;
  for (const s of list) for (const p of prims) {
    if (p.material !== s.material) continue;
    // `maxY` (source units): only pieces entirely below it (a material shared by the face and the toes)
    if (s.maxY !== undefined && p.pos.some((v, i) => i % 3 === 1 && v > s.maxY)) continue;
    const n = p.pos.length / 3, key = new Map(), remap = new Uint32Array(n), pos = [];
    for (let i = 0; i < n; i++) {
      const k = `${p.pos[i * 3].toFixed(6)},${p.pos[i * 3 + 1].toFixed(6)},${p.pos[i * 3 + 2].toFixed(6)}`;
      if (!key.has(k)) {
        key.set(k, pos.length / 3);
        pos.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
      }
      remap[i] = key.get(k);
    }
    const idx = Uint32Array.from(p.idx, (i) => remap[i]);
    const target = Math.max(3, Math.floor((idx.length / 3) * s.ratio) * 3);
    const [out] = MS.simplify(idx, Float32Array.from(pos), 3, target, s.error ?? 0.02, []);
    // keep only the vertices the reduced triangles use
    const used = new Map(), P = [];
    const I = Uint32Array.from(out, (v) => {
      if (!used.has(v)) {
        used.set(v, P.length / 3);
        P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
      return used.get(v);
    });
    console.log(`simplify: material ${s.material} ${idx.length / 3} -> ${I.length / 3} triangles`);
    Object.assign(p, { pos: Float32Array.from(P), nrm: null, uv: new Float32Array((P.length / 3) * 2), idx: I });
  }
}
// feet on the ground, then the uniform scale
let minY = Infinity;
for (const p of prims) for (let i = 1; i < p.pos.length; i += 3) minY = Math.min(minY, p.pos[i]);
for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) {
  p.pos[i] *= S;
  p.pos[i + 1] = (p.pos[i + 1] - minY) * S;
  p.pos[i + 2] *= S;
}
// config coordinates are in the source's units (before the scale, feet at the source's height): convert
const J = (v) => [v[0] * S, (v[1] - minY) * S, v[2] * S];
const Jy = (y) => (y - minY) * S;
const L = (d) => d * S; // lengths
if (C.reshape) reshape(C.reshape);
if (C.parts) for (const part of C.parts) addPart(part);

/** Piecewise-linear interpolation in [[t, value], ...] (sorted by t, clamped at the ends). */
function interp(tab, t) {
  if (t <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (t <= tab[i][0]) {
      const [t0, a] = tab[i - 1], [t1, b] = tab[i];
      return a + ((b - a) * (t - t0)) / (t1 - t0);
    }
  }
  return tab[tab.length - 1][1];
}

/**
 * `reshape`: [{ materials, envelope: [[y, maxX], ...], soft }] (source units): vertices of those materials further
 * out than the envelope at their height are pulled in to it (what stays beyond is scaled by `soft`). Flattens the
 * sleeves a cloak modelled with the arms hanging inside has fused into its sides: generated arms replace them.
 */
function reshape(list) {
  for (const r of list) {
    const mats = new Set(r.materials);
    let moved = 0;
    for (const p of prims) {
      if (!mats.has(p.material)) continue;
      for (let i = 0; i < p.pos.length; i += 3) {
        const e = L(interp(r.envelope, p.pos[i + 1] / S + minY)), ax = Math.abs(p.pos[i]);
        if (ax <= e) continue;
        p.pos[i] = Math.sign(p.pos[i]) * (e + (ax - e) * (r.soft ?? 0));
        moved++;
      }
    }
    console.log(`reshape: ${moved} vertices pulled in`);
  }
}

/**
 * `parts`: generated tubes in source units, added like source primitives (islands, weights, materials):
 * { material, uv?: [u, v], rings: [[x, y, z, r1, r2?], ...], ref?: [x, y, z], sides?, caps?: [start, end], inside?,
 *   mirror? (default true: the same part on the right side, x -> -x) }. Each ring is an ellipse around the path
 * (r1 along `ref` projected off the path, r2 across); `inside` faces the surface inward (a sleeve's lining).
 */
function addPart(part) {
  const sides = part.sides ?? 12;
  for (const sx of part.mirror === false ? [1] : [1, -1]) {
    const R = part.rings.map((r) => ({ c: J([r[0] * sx, r[1], r[2]]), r1: L(r[3]), r2: L(r[4] ?? r[3]) }));
    const ref = part.ref || [0, 1, 0];
    const pos = [], nrm = [], idx = [];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const nz = (v) => {
      const l = Math.hypot(...v) || 1;
      return v.map((x) => x / l);
    };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const frames = R.map((r, i) => {
      const t = nz(sub(R[Math.min(i + 1, R.length - 1)].c, R[Math.max(i - 1, 0)].c));
      const u = nz(sub(ref, t.map((x) => x * dot(ref, t))));
      return { t, u, v: cross(t, u) };
    });
    const out = part.inside ? -1 : 1;
    R.forEach((r, i) => {
      const { u, v } = frames[i];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        pos.push(...[0, 1, 2].map((k) => r.c[k] + u[k] * ca * r.r1 + v[k] * sa * r.r2));
        nrm.push(...nz([0, 1, 2].map((k) => u[k] * (ca / r.r1) + v[k] * (sa / r.r2))).map((x) => x * out));
      }
    });
    // triangles face along their normal (outward, or inward for a lining)
    const tri = (a, b, c, want) => {
      const n = cross(sub(pos.slice(b * 3, b * 3 + 3), pos.slice(a * 3, a * 3 + 3)), sub(pos.slice(c * 3, c * 3 + 3), pos.slice(a * 3, a * 3 + 3)));
      idx.push(...(dot(n, want) >= 0 ? [a, b, c] : [a, c, b]));
    };
    for (let i = 0; i + 1 < R.length; i++) {
      for (let j = 0; j < sides; j++) {
        const a = i * sides + j, b = i * sides + ((j + 1) % sides), c = a + sides, d = b + sides;
        const w = nrm.slice(a * 3, a * 3 + 3);
        tri(a, b, d, w);
        tri(a, d, c, w);
      }
    }
    // caps: a fan with its own vertices (flat normal along the path)
    const caps = part.caps || [false, false];
    [0, R.length - 1].forEach((ri, e) => {
      if (!caps[e]) return;
      const dir = frames[ri].t.map((x) => (e ? x : -x)), base = pos.length / 3;
      for (let j = 0; j < sides; j++) {
        pos.push(...pos.slice((ri * sides + j) * 3, (ri * sides + j) * 3 + 3));
        nrm.push(...dir);
      }
      pos.push(...R[ri].c);
      nrm.push(...dir);
      for (let j = 0; j < sides; j++) tri(base + sides, base + j, base + ((j + 1) % sides), dir);
    });
    const n = pos.length / 3, uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) [uv[i * 2], uv[i * 2 + 1]] = part.uv || [0, 0];
    prims.push({ material: part.material, pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), uv, idx: Uint32Array.from(idx), generated: true });
  }
}

// ------------------------------------------------------------------ islands (connected pieces, welded by position)
for (const [pi, p] of prims.entries()) {
  const n = p.pos.length / 3, key = new Map(), weld = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(p.pos[i * 3] * 1e4)},${Math.round(p.pos[i * 3 + 1] * 1e4)},${Math.round(p.pos[i * 3 + 2] * 1e4)}`;
    if (!key.has(k)) key.set(k, i);
    weld[i] = key.get(k);
  }
  const par = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a) => {
    while (par[a] !== a) a = par[a] = par[par[a]];
    return a;
  };
  for (let t = 0; t < p.idx.length; t += 3) {
    const a = find(weld[p.idx[t]]);
    par[find(weld[p.idx[t + 1]])] = a;
    par[find(weld[p.idx[t + 2]])] = a;
  }
  const byRoot = new Map();
  p.island = new Int32Array(n);
  p.islands = [];
  for (let i = 0; i < n; i++) {
    const r = find(weld[i]);
    if (!byRoot.has(r)) {
      byRoot.set(r, p.islands.length);
      p.islands.push({ prim: pi, material: p.material, verts: [], tris: 0 });
    }
    p.island[i] = byRoot.get(r);
    p.islands[byRoot.get(r)].verts.push(i);
  }
  for (let t = 0; t < p.idx.length; t += 3) p.islands[p.island[p.idx[t]]].tris++;
}
const bounds = () => {
  for (const p of prims) for (const is of p.islands) {
    is.min = [Infinity, Infinity, Infinity];
    is.max = [-Infinity, -Infinity, -Infinity];
    is.c = [0, 0, 0];
    for (const i of is.verts) for (let k = 0; k < 3; k++) {
      const v = p.pos[i * 3 + k];
      is.min[k] = Math.min(is.min[k], v);
      is.max[k] = Math.max(is.max[k], v);
      is.c[k] += v;
    }
    is.c = is.c.map((v) => v / is.verts.length);
  }
};
bounds();
if (C.apose) unpose(C.apose);
const islands = prims.flatMap((p) => p.islands);

/**
 * A-pose -> T-pose (config `apose`): the arms of the chosen materials are lifted about the shoulder until the upper
 * arm lies along x, then the forearm about the elbow, before anything else is measured or weighted (the rest of the
 * config is in the T-posed model: write `apose` first, run with TPOSE=<file.glb> to get the T-posed mesh, measure
 * it). A vertex turns by (membership x angle), membership measured in the lifted frame (outside `x`, above `under`
 * below the arm's axis), so the armpit and shoulder bend softly instead of tearing; islands up to `rigidTris`
 * triangles (armour plates, buckles) turn rigidly with the membership of their centre; islands matched by `keep`
 * selectors (bounds before the lift) never move. Past the elbow "below" is measured from the forearm (`underFore`).
 */
function unpose(A) {
  const [S0, E0, W0] = [J(A.shoulder), J(A.elbow), J(A.wrist)];
  const X0 = A.x.map(L), U0 = A.under.map(L), EB = L(A.elbowBand ?? 0.03);
  const mats = new Set(A.materials ?? prims.map((p) => p.material));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // rotation taking unit direction d onto +x: axis + angle (Rodrigues)
  const toX = (d) => ({ axis: norm(cross(d, [1, 0, 0])), angle: Math.acos(Math.max(-1, Math.min(1, d[0]))) });
  const rot = (v, { axis: k, angle }, f) => {
    const a = angle * f, c = Math.cos(a), s = Math.sin(a), kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2], kx = cross(k, v);
    return [0, 1, 2].map((i) => v[i] * c + kx[i] * s + k[i] * kv * (1 - c));
  };
  const R1 = toX(norm(sub(E0, S0)));
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const E1 = add(S0, rot(sub(E0, S0), R1, 1)), W1 = add(S0, rot(sub(W0, S0), R1, 1));
  const R2 = toX(norm(sub(W1, E1)));
  // one side's transform of a point (left side coordinates, x > 0): [position, rotation pieces] for normals too
  const UF = (A.underFore || [A.under[0] - 0.04, A.under[1] - 0.04]).map(L);
  const lift = (v) => {
    const q = add(S0, rot(sub(v, S0), R1, 1));
    const b = smooth(E1[0] - EB, E1[0] + EB, q[0]);
    // "below the arm" is measured from the upper arm's line, and past the elbow from the forearm's (the forearm and
    // the hand hang lower than the upper arm's line; the torso is far below both)
    const q2 = add(E1, rot(sub(q, E1), R2, 1));
    const under = q[1] - S0[1] + (q2[1] - q[1]) * b;
    const a = smooth(X0[0], X0[1], q[0]) * smooth(U0[0] + (UF[0] - U0[0]) * b, U0[1] + (UF[1] - U0[1]) * b, under);
    return { a, b };
  };
  const apply = (v, m, isNormal) => {
    // v: left-side coordinates. m = { a, b } memberships
    let w = isNormal ? rot(v, R1, m.a) : add(S0, rot(sub(v, S0), R1, m.a));
    if (m.a * m.b > 0) {
      const e = add(S0, rot(sub(E0, S0), R1, m.a)); // the elbow where this vertex's partial lift puts it
      w = isNormal ? rot(w, R2, m.a * m.b) : add(e, rot(sub(w, e), R2, m.a * m.b));
    }
    return w;
  };
  let moved = 0;
  for (const p of prims) {
    if (!mats.has(p.material)) continue;
    for (const is of p.islands) {
      if ((A.keep || []).some((s) => matches(is, s))) continue; // `keep`: never lifted (props floating near the arm)
      // a rigid island turns as one piece with its centre's side (vertices past x = 0 included)
      const rigid = is.tris <= (A.rigidTris ?? 0), csx = is.c[0] >= 0 ? 1 : -1;
      for (const i of is.verts) {
        const o = i * 3, sx = rigid ? csx : p.pos[o] >= 0 ? 1 : -1;
        const src = rigid ? is.c : [p.pos[o], p.pos[o + 1], p.pos[o + 2]];
        const m = lift([src[0] * sx, src[1], src[2]]);
        if (m.a <= 1e-5) continue;
        moved++;
        const v = apply([p.pos[o] * sx, p.pos[o + 1], p.pos[o + 2]], m, false);
        [p.pos[o], p.pos[o + 1], p.pos[o + 2]] = [v[0] * sx, v[1], v[2]];
        if (p.nrm) {
          const nv = apply([p.nrm[o] * sx, p.nrm[o + 1], p.nrm[o + 2]], m, true);
          [p.nrm[o], p.nrm[o + 1], p.nrm[o + 2]] = [nv[0] * sx, nv[1], nv[2]];
        }
      }
    }
  }
  bounds();
  const d = (r) => ((r.angle * 180) / Math.PI).toFixed(1);
  console.log(`apose: arms lifted ${d(R1)} deg at the shoulder, ${d(R2)} deg more at the elbow; ${moved} vertices moved`);
  console.log(`  T-posed (source units): elbow ${[E1[0] / S, E1[1] / S + minY, E1[2] / S].map((v) => v.toFixed(3))}, wrist ${[W1[0] / S, W1[1] / S + minY, W1[2] / S].map((v) => v.toFixed(3))} (after R2: wrist on the elbow's line)`);
  if (process.env.TPOSE) {
    writeTposed(path.resolve(process.env.TPOSE));
    process.exit(0);
  }
}

/** The T-posed mesh as a plain GLB in source units (feet at the source's height) for measuring the config. */
function writeTposed(file) {
  const bb = new BinBuilder();
  const json = { asset: { version: '2.0', generator: 'shinobi rig.mjs (T-posed)' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Body', mesh: 0 }], meshes: [{ primitives: [] }], materials: JSON.parse(JSON.stringify(src.json.materials)), textures: JSON.parse(JSON.stringify(src.json.textures || [])), images: [], samplers: src.json.samplers ? JSON.parse(JSON.stringify(src.json.samplers)) : [{}] };
  for (const im of src.json.images || []) json.images.push({ bufferView: bb.view(viewBytes(src, im.bufferView)), mimeType: im.mimeType });
  for (const p of prims) {
    const pos = Float32Array.from(p.pos, (v, i) => (i % 3 === 1 ? v / S + minY : v / S));
    json.meshes[0].primitives.push({ attributes: { POSITION: bb.accessor(pos, 'VEC3', { target: 34962, minmax: true }), ...(p.nrm ? { NORMAL: bb.accessor(p.nrm, 'VEC3', { target: 34962 }) } : {}), TEXCOORD_0: bb.accessor(Float32Array.from(p.uv), 'VEC2', { target: 34962 }) }, indices: bb.accessor(Uint32Array.from(p.idx), 'SCALAR', { target: 34963 }), material: p.material });
  }
  const bin = bb.buffer();
  json.buffers = [{ byteLength: bin.length }];
  json.bufferViews = bb.bufferViews;
  json.accessors = bb.accessors;
  writeGlb(file, json, bin);
  console.log(`T-posed mesh written to ${file}`);
}

/** Does an island match a selector? Bounds are in source units. */
function matches(is, sel) {
  if (sel.material !== undefined && is.material !== sel.material) return false;
  if (sel.minTris !== undefined && is.tris < sel.minTris) return false;
  if (sel.maxTris !== undefined && is.tris > sel.maxTris) return false;
  const b = (k, v) => (k === 1 ? Jy(v) : v * S);
  if (sel.minX !== undefined && is.min[0] < b(0, sel.minX)) return false;
  if (sel.maxX !== undefined && is.max[0] > b(0, sel.maxX)) return false;
  if (sel.minY !== undefined && is.min[1] < b(1, sel.minY)) return false;
  if (sel.maxY !== undefined && is.max[1] > b(1, sel.maxY)) return false;
  if (sel.minZ !== undefined && is.min[2] < b(2, sel.minZ)) return false;
  if (sel.maxZ !== undefined && is.max[2] > b(2, sel.maxZ)) return false;
  return true;
}

// ------------------------------------------------------------------ skeleton
const B = C.bones;
const bones = []; // { name, human, pos: [x,y,z] world, parent }
const boneIdx = new Map();
function bone(name, pos, parent, human = name) {
  boneIdx.set(name, bones.length);
  bones.push({ name, human, pos, parent: parent === null ? -1 : boneIdx.get(parent) });
}
const mirror = (v) => [-v[0], v[1], v[2]];
bone('hips', J(B.hips), null);
bone('spine', J(B.spine), 'hips');
bone('chest', J(B.chest), 'spine');
bone('upperChest', J(B.upperChest), 'chest');
bone('neck', J(B.neck), 'upperChest');
bone('head', J(B.head), 'neck');
const H = {}; // hand geometry per side (fingers found in the mesh)
for (const side of ['left', 'right']) {
  const m = side === 'left' ? (v) => v : mirror;
  bone(`${side}Shoulder`, J(m(B.shoulder)), 'upperChest');
  bone(`${side}UpperArm`, J(m(B.upperArm)), `${side}Shoulder`);
  bone(`${side}LowerArm`, J(m(B.lowerArm)), `${side}UpperArm`);
  bone(`${side}Hand`, J(m(B.hand)), `${side}LowerArm`);
  H[side] = findFingers(side);
  const T = H[side].thumb;
  bone(`${side}ThumbMetacarpal`, T.joints[0], `${side}Hand`);
  bone(`${side}ThumbProximal`, T.joints[1], `${side}ThumbMetacarpal`);
  bone(`${side}ThumbDistal`, T.joints[2], `${side}ThumbProximal`);
  for (const f of H[side].fingers) {
    bone(`${side}${f.name}Proximal`, f.joints[0], `${side}Hand`);
    bone(`${side}${f.name}Intermediate`, f.joints[1], `${side}${f.name}Proximal`);
    bone(`${side}${f.name}Distal`, f.joints[2], `${side}${f.name}Intermediate`);
  }
  bone(`${side}UpperLeg`, J(m(B.upperLeg)), 'hips');
  bone(`${side}LowerLeg`, J(m(B.lowerLeg)), `${side}UpperLeg`);
  bone(`${side}Foot`, J(m(B.foot)), `${side}LowerLeg`);
  bone(`${side}Toes`, J(m(B.toes)), `${side}Foot`);
}
// ribbon chains (spring bones): joints evenly spaced along the configured points
const chains = [];
for (const ch of C.chains || []) {
  const names = [];
  ch.points.forEach((p, i) => {
    const name = `${ch.name}_${i}`;
    bone(name, J(p), i ? names[i - 1] : ch.parent, null);
    names.push(name);
  });
  chains.push({ ...ch, names });
}

/**
 * The fingers of one hand, from the geometry: knuckle line x (config), four finger bands clustered by z just past
 * the knuckles, each finger's centre line to its tip; the thumb from the config's base to the hand's most forward
 * vertex. Returns world-space joints.
 */
function findFingers(side) {
  const sx = side === 'left' ? 1 : -1;
  const wristX = J(B.hand)[0], kx = L(B.knuckleX), zEdge = L(B.thumbZ);
  // hand vertices past the wrist, not counting pieces the config gives to other bones (hair, weapons, props held
  // near the hands: `head`, `rigid` and `fingerSkip` selectors)
  const R = C.islands || {}, skip = [...(R.head || []), ...(R.rigid || []).map((r) => r.select), ...(R.fingerSkip || [])];
  const pts = [];
  for (const p of prims) {
    const off = p.islands.map((is) => skip.some((s) => matches(is, s)));
    for (let i = 0; i < p.pos.length; i += 3) if (p.pos[i] * sx > wristX && !off[p.island[i / 3]]) pts.push([p.pos[i] * sx, p.pos[i + 1], p.pos[i + 2]]);
  }
  // thumb: base from the config, tip = the most forward hand vertex
  const base = J(B.thumbBase);
  let tip = pts[0];
  for (const v of pts) if (v[2] > tip[2]) tip = v;
  if (B.thumbTip) tip = J(B.thumbTip); // a thumb along x: its most forward vertex is its base

  const tj = [0, 0.4, 0.72].map((t) => [base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t]);
  // finger bands: the config's finger centres (little..index), else the z of the vertices just past the knuckles
  // (not the thumb) in 4 clusters (1-D k-means; low-poly fingers can fool it: check the report)
  const band = pts.filter((v) => v[0] > kx + L(0.01) && v[0] < kx + L(0.06) && v[2] < zEdge);
  const zs = band.map((v) => v[2]).sort((a, b) => a - b);
  let cz = [0.125, 0.375, 0.625, 0.875].map((q) => zs[Math.floor(q * (zs.length - 1))]);
  if (B.fingerZ) cz = B.fingerZ.map(L);
  else for (let it = 0; it < 30; it++) {
    const acc = cz.map(() => [0, 0]);
    for (const z of zs) {
      let k = 0;
      for (let j = 1; j < 4; j++) if (Math.abs(z - cz[j]) < Math.abs(z - cz[k])) k = j;
      acc[k][0] += z;
      acc[k][1]++;
    }
    cz = acc.map(([s, n], k) => (n ? s / n : cz[k]));
  }
  cz.sort((a, b) => a - b);
  // z ascending = the back of the hand's width first: little, ring, middle, index (the thumb is at +z)
  const names = ['Little', 'Ring', 'Middle', 'Index'];
  const fingers = cz.map((z0, k) => {
    const lo = k ? (cz[k - 1] + z0) / 2 : -Infinity, hi = k < 3 ? (cz[k + 1] + z0) / 2 : zEdge;
    const vs = pts.filter((v) => v[0] > kx && v[2] >= lo && v[2] < hi);
    let t = vs[0];
    for (const v of vs) if (v[0] > t[0]) t = v;
    const near = vs.filter((v) => v[0] < kx + L(0.02));
    const y0 = near.reduce((s, v) => s + v[1], 0) / Math.max(1, near.length);
    const k0 = [kx, y0, z0], len = t[0] - kx;
    const at = (f) => [k0[0] + len * f, k0[1] + (t[1] - k0[1]) * f, k0[2] + (t[2] - k0[2]) * f];
    return { name: names[k], z: z0, lo, hi, joints: [k0, at(0.45), at(0.74)], tip: t, len };
  });
  const toWorld = (v) => [v[0] * sx, v[1], v[2]];
  return {
    kx, zEdge, wristX,
    thumb: { joints: tj.map(toWorld), base, tip, len: Math.hypot(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]) },
    fingers: fingers.map((f) => ({ ...f, joints: f.joints.map(toWorld) })),
  };
}

// ------------------------------------------------------------------ weights
const Y = Object.fromEntries(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'].map((b) => [b, J(B[b])[1]]));
const X = { upperArm: J(B.upperArm)[0], lowerArm: J(B.lowerArm)[0], hand: J(B.hand)[0] };
const LY = { knee: J(B.lowerLeg)[1], ankle: J(B.foot)[1], toesZ: J(B.toes)[2] };
const M = C.masks; // mask edges in source units
const my = (v) => Jy(v), mx = (v) => L(v);

/** Partition of unity along a chain: joints [[bone, at, halfWidth], ...] (the first one's `at` is ignored). */
function chain(u, joints, out, w) {
  let prev = 1;
  for (let i = 1; i <= joints.length; i++) {
    const s = i < joints.length ? smooth(joints[i][1] - joints[i][2], joints[i][1] + joints[i][2], u) : 0;
    const wi = (prev - s) * w;
    if (wi > 1e-5) out.set(joints[i - 1][0], (out.get(joints[i - 1][0]) || 0) + wi);
    prev = s;
  }
}

function torsoW(y, out, w) {
  chain(y, [['hips'], ['spine', Y.spine, L(0.04)], ['chest', Y.chest, L(0.05)], ['upperChest', Y.upperChest, L(0.05)], ['neck', Y.neck, L(0.03)], ['head', Y.head, L(0.02)]], out, w);
}

function handW(side, ax, y, z, out, w) {
  const h = H[side];
  // thumb: in front of the palm's index edge, or (bones.thumbRadius) within that radius of the thumb's line: a thumb
  // that runs along x under the index finger overlaps it in z and only the distance tells them apart
  const b = h.thumb.base, t = h.thumb.tip, dx = t[0] - b[0], dy = t[1] - b[1], dz = t[2] - b[2], l2 = dx * dx + dy * dy + dz * dz;
  const u = ((ax - b[0]) * dx + (y - b[1]) * dy + (z - b[2]) * dz) / l2;
  let T;
  if (B.thumbRadius) {
    const c = clamp01(u), r = L(B.thumbRadius);
    T = smooth(r + L(0.006), r - L(0.004), Math.hypot(b[0] + dx * c - ax, b[1] + dy * c - y, b[2] + dz * c - z));
  } else T = smooth(h.zEdge - L(0.005), h.zEdge + L(0.007), z);
  if (T > 0) {
    chain(u, [[`${side}ThumbMetacarpal`], [`${side}ThumbProximal`, 0.4, 0.07], [`${side}ThumbDistal`, 0.72, 0.06]], out, w * T);
  }
  const rest = w * (1 - T);
  if (rest <= 1e-5) return;
  // past the knuckles: the finger whose band holds z (palm vertices near the knuckles share between the two nearest)
  const fs = h.fingers;
  const fw = smooth(h.kx - L(0.009), h.kx + L(0.006), ax);
  if (rest * (1 - fw) > 1e-5) out.set(`${side}Hand`, (out.get(`${side}Hand`) || 0) + rest * (1 - fw));
  if (fw <= 0) return;
  let k = 0;
  for (let j = 1; j < 4; j++) if (Math.abs(z - fs[j].z) < Math.abs(z - fs[k].z)) k = j;
  const shares = [[k, 1]];
  if (ax < h.kx + L(0.004)) {
    const j = z > fs[k].z ? Math.min(3, k + 1) : Math.max(0, k - 1);
    if (j !== k) {
      const a = Math.abs(z - fs[k].z), b = Math.abs(z - fs[j].z), s = b / (a + b);
      shares[0][1] = s;
      shares.push([j, 1 - s]);
    }
  }
  for (const [fi, s] of shares) {
    const f = fs[fi], n = `${side}${f.name}`;
    chain(ax, [[`${n}Proximal`], [`${n}Intermediate`, f.joints[1][0] * (side === 'left' ? 1 : -1), L(0.005)], [`${n}Distal`, f.joints[2][0] * (side === 'left' ? 1 : -1), L(0.004)]], out, rest * fw * s);
  }
}

function armW(side, ax, y, z, out, w) {
  const tmp = new Map();
  chain(ax, [[`${side}Shoulder`], [`${side}UpperArm`, X.upperArm, L(0.04)], [`${side}LowerArm`, X.lowerArm, L(0.045)], [`${side}Hand`, X.hand, L(0.013)]], tmp, 1);
  for (const [b, v] of tmp) {
    if (b === `${side}Hand`) handW(side, ax, y, z, out, w * v);
    else out.set(b, (out.get(b) || 0) + w * v);
  }
}

function legW(side, y, z, out, w) {
  const tmp = new Map();
  chain(y, [[`${side}Foot`], [`${side}LowerLeg`, LY.ankle, L(0.025)], [`${side}UpperLeg`, LY.knee, L(0.05)]], tmp, 1);
  for (const [b, v] of tmp) {
    if (b === `${side}Foot`) {
      const t = smooth(LY.toesZ - L(0.02), LY.toesZ + L(0.012), z) * smooth(LY.ankle, LY.ankle - L(0.04), y);
      if (t > 0) out.set(`${side}Toes`, (out.get(`${side}Toes`) || 0) + w * v * t);
      if (t < 1) out.set(b, (out.get(b) || 0) + w * v * (1 - t));
    } else out.set(b, (out.get(b) || 0) + w * v);
  }
}

/** The weights of a point (world, scaled). skirt: the island is a long coat/skirt; noArm: never on the arm bones. */
function weigh(x, y, z, skirt, noArm) {
  const out = new Map(), ax = Math.abs(x);
  const side = x >= 0 ? 'left' : 'right';
  // arm mask: outside the shoulders and above the armpit (further out, lower: a wide sleeve hangs below the arm)
  const mA = noArm ? 0 : smooth(mx(M.armX[0]), mx(M.armX[1]), ax) * Math.max(smooth(my(M.armpitY[0]), my(M.armpitY[1]), y), smooth(mx(M.sleeveX[0]), mx(M.sleeveX[1]), ax) * smooth(my(M.sleeveY[0]), my(M.sleeveY[1]), y));
  // leg mask: below the crotch
  let mL = Math.min(smooth(my(M.crotchY[0]), my(M.crotchY[1]), y), 1 - mA);
  if (skirt) {
    // a coat below the waist: hips at the waist, more and more thigh toward the hem, split softly between the legs
    const k = Math.min(1 - mA, (M.skirtMax ?? 0.75) * Math.pow(clamp01((my(M.waistY) - y) / (my(M.waistY) - LY.knee)), M.skirtPow ?? 1));
    const sL = smooth(-mx(M.skirtSplit), mx(M.skirtSplit), x);
    if (k > 0) {
      out.set('leftUpperLeg', (out.get('leftUpperLeg') || 0) + k * sL);
      out.set('rightUpperLeg', (out.get('rightUpperLeg') || 0) + k * (1 - sL));
    }
    if (1 - mA - k > 1e-5) torsoW(y, out, 1 - mA - k);
    if (mA > 1e-5) armW(side, ax, y, z, out, mA);
    return out;
  }
  const mT = 1 - mA - mL;
  if (mT > 1e-5) torsoW(y, out, mT);
  if (mA > 1e-5) armW(side, ax, y, z, out, mA);
  if (mL > 1e-5) {
    const sL = smooth(-mx(0.015), mx(0.015), x);
    if (sL > 0) legW('left', y, z, out, mL * sL);
    if (sL < 1) legW('right', y, z, out, mL * (1 - sL));
  }
  return out;
}

// island rules
const rules = C.islands || {};
for (const is of islands) {
  if ((rules.head || []).some((s) => matches(is, s))) is.rule = { bone: 'head' };
  for (const r of rules.rigid || []) if (!is.rule && matches(is, r.select)) is.rule = { bone: r.bone };
  if (!is.rule && (rules.plates || []).some((s) => matches(is, s))) is.rule = { plate: true };
  for (const ch of chains) if (!is.rule && matches(is, ch.select)) is.rule = { chain: ch };
  if (!is.rule && (rules.skirt || []).some((s) => matches(is, s))) is.skirt = true;
  if ((rules.noArm || []).some((s) => matches(is, s))) is.noArm = true;
  if (!is.rule && !is.skirt && is.tris <= (rules.smallTris ?? 0) && Math.max(is.max[0] - is.min[0], is.max[1] - is.min[1], is.max[2] - is.min[2]) < L(rules.smallSize ?? 0.3)) is.rule = { small: true };
}

function chainW(ch, x, y, z) {
  // along the ribbon (points top to bottom): nearest segment parameter, blended across joints
  const P = ch.names.map((n) => bones[boneIdx.get(n)].pos);
  const out = new Map();
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    const t = clamp01(((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / l2);
    const q = [a[0] + d[0] * t - x, a[1] + d[1] * t - y, a[2] + d[2] * t - z], dd = q[0] ** 2 + q[1] ** 2 + q[2] ** 2;
    if (dd < best) [best, bi, bt] = [dd, i, t];
  }
  // segment i follows joint i (it swings about the segment's top); the very top blends with the chain's parent
  const u = bi + bt;
  const js = [[ch.parent], ...ch.names.slice(0, -1).map((n, i) => [n, i ? i : 0.1, i ? 0.25 : 0.1])];
  chain(u, js, out, 1);
  return out;
}

const weightsOf = (p, i, is) => {
  const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
  if (is.rule?.bone) return new Map([[is.rule.bone, 1]]);
  if (is.rule?.plate) return (is.cw ||= weigh(is.c[0], is.c[1], is.c[2], true, is.noArm));
  if (is.rule?.chain) {
    // `front`: [z, z] (source units): the chain fades into its parent toward the front (bangs stay on the head)
    const ch = is.rule.chain, w = chainW(ch, x, y, z);
    if (!ch.front) return w;
    const f = smooth(L(ch.front[0]), L(ch.front[1]), z);
    for (const [b, v] of w) w.set(b, v * f);
    w.set(ch.parent, (w.get(ch.parent) || 0) + 1 - f);
    return w;
  }
  if (is.rule?.small) return (is.cw ||= weigh(is.c[0], is.c[1], is.c[2], false, is.noArm));
  return weigh(x, y, z, is.skirt, is.noArm);
};

let maxInf = 0, pruned = 0;
for (const p of prims) {
  const n = p.pos.length / 3;
  p.joints = new Uint16Array(n * 4);
  p.weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const is = p.islands[p.island[i]];
    const w = [...weightsOf(p, i, is)].filter(([, v]) => v > 1e-4).sort((a, b) => b[1] - a[1]);
    maxInf = Math.max(maxInf, w.length);
    if (w.length > 4) pruned++;
    const top = w.slice(0, 4), sum = top.reduce((s, [, v]) => s + v, 0);
    top.forEach(([b, v], k) => {
      if (!boneIdx.has(b)) throw new Error(`no bone ${b}`);
      p.joints[i * 4 + k] = boneIdx.get(b);
      p.weights[i * 4 + k] = v / sum;
    });
  }
}

// ------------------------------------------------------------------ write the VRM
const bb = new BinBuilder();
const json = {
  asset: { version: '2.0', generator: 'shinobi rig.mjs' },
  extensionsUsed: ['KHR_materials_unlit', 'VRMC_materials_mtoon', 'VRMC_springBone', 'VRMC_vrm'],
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [],
  meshes: [],
  skins: [],
  materials: [],
  textures: [],
  images: [],
  samplers: src.json.samplers ? JSON.parse(JSON.stringify(src.json.samplers)) : [{}],
};
// node 0 = Root; bones follow (translation relative to the parent, no rotation: rest pose = T-pose, identity)
json.nodes.push({ name: 'Root', children: [] });
const nodeOf = (bi) => bi + 1;
bones.forEach((b) => {
  const pp = b.parent >= 0 ? bones[b.parent].pos : [0, 0, 0];
  json.nodes.push({ name: b.name, translation: b.pos.map((v, k) => +(v - pp[k]).toFixed(6)) });
});
bones.forEach((b, i) => {
  if (b.parent >= 0) (json.nodes[nodeOf(b.parent)].children ||= []).push(nodeOf(i));
  else json.nodes[0].children.push(nodeOf(i));
});
// materials: MToon with the look of the game's other fighters
const MT = C.mtoon || {};
function mtoon(name, m, tex, baseColor) {
  const o = MT[name] || {};
  const shade = o.shade || MT.shade || [0.78, 0.62, 0.66];
  return {
    name,
    alphaMode: m.alphaMode || 'OPAQUE',
    ...(m.alphaCutoff !== undefined ? { alphaCutoff: m.alphaCutoff } : {}),
    doubleSided: !!m.doubleSided,
    pbrMetallicRoughness: { baseColorFactor: baseColor, ...(tex !== undefined ? { baseColorTexture: { index: tex, texCoord: 0 } } : {}), metallicFactor: 0, roughnessFactor: 1 },
    extensions: {
      KHR_materials_unlit: {},
      VRMC_materials_mtoon: {
        specVersion: '1.0',
        transparentWithZWrite: false,
        renderQueueOffsetNumber: 0,
        shadeColorFactor: shade,
        ...(tex !== undefined ? { shadeMultiplyTexture: { index: tex, texCoord: 0 } } : {}),
        shadingShiftFactor: o.shift ?? MT.shift ?? -0.05,
        shadingToonyFactor: o.toony ?? MT.toony ?? 0.9,
        giEqualizationFactor: 0.9,
        parametricRimColorFactor: [0, 0, 0],
        rimLightingMixFactor: 1,
        parametricRimFresnelPowerFactor: 5,
        parametricRimLiftFactor: 0,
        outlineWidthMode: o.outline === false ? 'none' : 'worldCoordinates',
        outlineWidthFactor: 0.0008,
        outlineColorFactor: [0.06, 0.009, 0.014],
        outlineLightingMixFactor: 1,
        uvAnimationScrollXSpeedFactor: 0,
        uvAnimationScrollYSpeedFactor: 0,
        uvAnimationRotationSpeedFactor: 0,
      },
    },
  };
}
const ARRAY = 34962, ELEMENT = 34963;
const primitive = (p, material) => {
  const nrm = p.nrm || computeNormals(p);
  const n = p.pos.length / 3;
  const idx = n < 65536 ? Uint16Array.from(p.idx) : Uint32Array.from(p.idx);
  return {
    attributes: {
      POSITION: bb.accessor(p.pos, 'VEC3', { target: ARRAY, minmax: true }),
      NORMAL: bb.accessor(nrm, 'VEC3', { target: ARRAY }),
      TEXCOORD_0: bb.accessor(Float32Array.from(p.uv), 'VEC2', { target: ARRAY }),
      JOINTS_0: bb.accessor(p.joints, 'VEC4', { target: ARRAY }),
      WEIGHTS_0: bb.accessor(p.weights, 'VEC4', { target: ARRAY }),
    },
    indices: bb.accessor(idx, 'SCALAR', { target: ELEMENT }),
    material,
  };
};
let primitives;
if (C.atlas) primitives = [primitive(atlas(C.atlas), 0)];
else {
  // images + textures (as in the source)
  for (const im of src.json.images) json.images.push({ bufferView: bb.view(viewBytes(src, im.bufferView)), mimeType: im.mimeType, name: im.name });
  for (const t of src.json.textures) json.textures.push({ sampler: t.sampler ?? 0, source: t.source });
  for (const [mi, m] of src.json.materials.entries()) {
    const tex = m.pbrMetallicRoughness?.baseColorTexture?.index;
    json.materials.push(mtoon(m.name || `mat${mi}`, m, tex, m.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1]));
  }
  // one skinned mesh, a primitive per source primitive
  primitives = prims.map((p) => primitive(p, p.material));
}

/**
 * `atlas`: { image, cells: [x, y, columns], size, flat?: { material: asMaterial }, name }: one material, one
 * primitive. Primitives textured with `image` keep their UVs; every other material's colour (baseColorFactor, or
 * that of `flat[material]`: a textured piece drawn in another material's plain colour) is painted into a size x size
 * cell of that image's free space (checked empty) and its vertices sample the cell's centre. Returns the merged
 * primitive (json gets the image, texture and material).
 */
function atlas(A) {
  const mats = src.json.materials, size = A.size ?? 32, [x0, y0, cols] = A.cells;
  const texImage = (m) => {
    const t = m.pbrMetallicRoughness?.baseColorTexture?.index;
    return t === undefined ? undefined : src.json.textures[t].source;
  };
  const img = decodePng(viewBytes(src, src.json.images[A.image].bufferView));
  const toSrgb = (c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
  const cells = new Map();
  for (const p of prims) {
    const m = mats[p.material] || {};
    if (!p.generated && texImage(m) === A.image) continue;
    const cm = mats[A.flat?.[p.material] ?? p.material];
    if (texImage(cm) !== undefined && texImage(cm) !== A.image && A.flat?.[p.material] === undefined) throw new Error(`atlas: material ${p.material} has another texture: map it in atlas.flat`);
    const rgb = (cm.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1]).slice(0, 3).map(toSrgb), key = rgb.join(',');
    if (!cells.has(key)) {
      const k = cells.size, cx = x0 + (k % cols) * size, cy = y0 + Math.floor(k / cols) * size;
      if (cy + size > img.height) throw new Error('atlas: no room for the palette');
      for (let y = cy; y < cy + size; y++) for (let x = cx; x < cx + size; x++) {
        const o = (y * img.width + x) * 4;
        if (img.data[o] + img.data[o + 1] + img.data[o + 2] > 24) throw new Error(`atlas: cell ${k} at ${cx},${cy} is not empty`);
        img.data.set([...rgb, 255], o);
      }
      cells.set(key, [(cx + size / 2) / img.width, (cy + size / 2) / img.height]);
    }
    const [u, v] = cells.get(key);
    p.uv = new Float32Array(p.pos.length / 3 * 2).map((_, i) => (i % 2 ? v : u));
  }
  json.images.push({ bufferView: bb.view(encodePng(img)), mimeType: 'image/png', name: A.name || 'atlas' });
  json.textures.push({ sampler: 0, source: 0 });
  json.materials.push(mtoon(A.name || 'Body', { doubleSided: true }, 0, [1, 1, 1, 1]));
  console.log(`atlas: ${prims.length} primitives, ${cells.size} palette colours -> one material`);
  // one primitive: every attribute concatenated, indices offset
  const cat = (T, get, w) => {
    const out = new T(prims.reduce((s, p) => s + (p.pos.length / 3) * w, 0));
    let o = 0;
    for (const p of prims) {
      const a = get(p);
      out.set(a, o);
      o += a.length;
    }
    return out;
  };
  let base = 0;
  const idx = new Uint32Array(prims.reduce((s, p) => s + p.idx.length, 0));
  let o = 0;
  for (const p of prims) {
    for (const i of p.idx) idx[o++] = i + base;
    base += p.pos.length / 3;
  }
  return { pos: cat(Float32Array, (p) => p.pos, 3), nrm: cat(Float32Array, (p) => p.nrm || computeNormals(p), 3), uv: cat(Float32Array, (p) => p.uv, 2), joints: cat(Uint16Array, (p) => p.joints, 4), weights: cat(Float32Array, (p) => p.weights, 4), idx };
}
json.meshes.push({ name: 'Body', primitives });
const meshNode = json.nodes.length;
json.nodes.push({ name: 'Body', mesh: 0, skin: 0 });
json.nodes[0].children.push(meshNode);
const ibm = new Float32Array(bones.length * 16);
bones.forEach((b, i) => {
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.pos[0], -b.pos[1], -b.pos[2], 1], i * 16);
});
json.skins.push({ name: 'Armature', skeleton: nodeOf(0), joints: bones.map((_, i) => nodeOf(i)), inverseBindMatrices: bb.accessor(ibm, 'MAT4') });

// VRM: humanoid, meta (credits from the source), spring bones
const extra = src.json.asset?.extras || {};
const humanBones = {};
bones.forEach((b, i) => b.human && (humanBones[b.human] = { node: nodeOf(i) }));
json.extensions = {
  VRMC_vrm: {
    specVersion: '1.0',
    meta: {
      name: C.name || extra.title || 'Character',
      version: '1',
      authors: [C.author || extra.author || 'unknown'],
      copyrightInformation: `${extra.title || C.name} by ${extra.author || C.author}${extra.license ? `, ${extra.license}` : ''}${extra.source ? ` (${extra.source})` : ''}. Rigged for SHINOBI ARENA.`,
      licenseUrl: 'https://vrm.dev/licenses/1.0/',
      otherLicenseUrl: C.licenseUrl || (extra.license?.match(/\((http[^)]+)\)/)?.[1] ?? ''),
      avatarPermission: 'everyone',
      allowExcessivelyViolentUsage: true,
      allowExcessivelySexualUsage: false,
      commercialUsage: 'personalNonProfit',
      allowPoliticalOrReligiousUsage: false,
      allowAntisocialOrHateUsage: false,
      creditNotation: 'required',
      allowRedistribution: true,
      modification: 'allowModificationRedistribution',
    },
    humanoid: { humanBones },
  },
};
if (chains.length) {
  const colliders = (C.colliders || []).map((c) => ({ node: nodeOf(boneIdx.get(c.bone)), shape: c.capsule ? { capsule: { offset: c.offset.map(L), radius: L(c.radius), tail: c.capsule.map(L) } } : { sphere: { offset: c.offset.map(L), radius: L(c.radius) } } }));
  json.extensions.VRMC_springBone = {
    specVersion: '1.0',
    colliders,
    colliderGroups: colliders.length ? [{ name: 'body', colliders: colliders.map((_, i) => i) }] : [],
    springs: chains.map((ch) => ({
      name: ch.name,
      joints: ch.names.map((n) => ({ node: nodeOf(boneIdx.get(n)), hitRadius: L(ch.hitRadius ?? 0.02), stiffness: ch.stiffness ?? 1, gravityPower: ch.gravity ?? 0.4, gravityDir: [0, -1, 0], dragForce: ch.drag ?? 0.4 })),
      ...(colliders.length ? { colliderGroups: [0] } : {}),
    })),
  };
}
json.buffers = [{ byteLength: 0 }];
const bin = bb.buffer();
json.buffers[0].byteLength = bin.length;
json.bufferViews = bb.bufferViews;
json.accessors = bb.accessors;
fs.mkdirSync(path.dirname(outFile), { recursive: true });
writeGlb(outFile, json, bin);

// ------------------------------------------------------------------ report
const tris = prims.reduce((s, p) => s + p.idx.length / 3, 0);
const r3 = (v) => v.map((x) => x.toFixed(3)).join(', ');
console.log(`${path.relative(process.cwd(), outFile)}: ${bones.length} bones, ${tris} triangles, ${C.atlas ? `1 material (${prims.length} pieces)` : `${prims.length} materials`}, ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
console.log(`scale ${S}, height ${(Math.max(...prims.flatMap((p) => [...p.pos].filter((_, i) => i % 3 === 1)))).toFixed(3)} m, hips ${Y.hips.toFixed(3)} m, influences max ${maxInf}${pruned ? ` (${pruned} vertices pruned to 4)` : ''}`);
for (const side of ['left']) {
  const h = H[side];
  console.log(`${side} hand: knuckles x ${h.kx.toFixed(3)}, thumb ${r3(h.thumb.base)} -> ${r3(h.thumb.tip)}`);
  for (const f of h.fingers) console.log(`  ${f.name.padEnd(6)} z ${f.z.toFixed(3)}  len ${f.len.toFixed(3)}  knuckle ${r3(f.joints[0])}`);
}
const ruled = islands.filter((i) => i.rule || i.skirt);
console.log(`islands: ${islands.length} (${ruled.filter((i) => i.rule?.bone).length} rigid, ${ruled.filter((i) => i.rule?.chain).length} ribbon, ${ruled.filter((i) => i.skirt).length} skirt, ${ruled.filter((i) => i.rule?.plate).length} plates, ${ruled.filter((i) => i.rule?.small).length} small)`);
if (process.env.VERBOSE) for (const is of islands) console.log(`  mat ${is.material} tris ${String(is.tris).padStart(4)} ${is.rule?.bone ? `rigid:${is.rule.bone}` : is.rule?.chain ? `chain:${is.rule.chain.name}` : is.skirt ? 'skirt' : is.rule?.plate ? 'plate' : is.rule?.small ? 'small' : '-'}  min ${r3(is.min)} max ${r3(is.max)}`);

function computeNormals(p) {
  const n = new Float32Array(p.pos.length);
  for (let t = 0; t < p.idx.length; t += 3) {
    const [a, b, c] = [p.idx[t], p.idx[t + 1], p.idx[t + 2]];
    const ux = p.pos[b * 3] - p.pos[a * 3], uy = p.pos[b * 3 + 1] - p.pos[a * 3 + 1], uz = p.pos[b * 3 + 2] - p.pos[a * 3 + 2];
    const vx = p.pos[c * 3] - p.pos[a * 3], vy = p.pos[c * 3 + 1] - p.pos[a * 3 + 1], vz = p.pos[c * 3 + 2] - p.pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      n[v * 3] += nx;
      n[v * 3 + 1] += ny;
      n[v * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}
