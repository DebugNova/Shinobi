// Summary of a .glb for rigging work: credits, nodes (transforms), meshes (triangles, bounds per primitive),
// materials and images; with `islands`, every connected piece in world space (y from the lowest vertex, like the
// rig configs use: source units, feet at 0 only if the source's are).
// usage: node scripts/debug/glbinfo.mjs <file.glb> [islands] [minTris]
import { readGlb, accessor } from '../tools/glb.mjs';

const [file, mode, minTrisArg] = process.argv.slice(2);
const g = readGlb(file);
const j = g.json;
const r3 = (v) => v.map((x) => +x.toFixed(3));
console.log('asset', JSON.stringify(j.asset));
console.log(`nodes ${j.nodes.length}, meshes ${j.meshes?.length || 0}, skins ${j.skins?.length || 0}, animations ${j.animations?.length || 0}, materials ${j.materials?.length || 0}, images ${j.images?.length || 0}`);
if (mode !== 'islands') {
  j.nodes.forEach((n, i) => console.log(`node ${i} ${n.name || ''} mesh=${n.mesh ?? '-'} skin=${n.skin ?? '-'} children=${JSON.stringify(n.children || [])} ${n.matrix ? 'M=' + r3(n.matrix) : ''} ${n.translation ? 'T=' + r3(n.translation) : ''} ${n.rotation ? 'R=' + r3(n.rotation) : ''} ${n.scale ? 'S=' + r3(n.scale) : ''}`));
  (j.materials || []).forEach((m, i) => console.log(`material ${i} ${m.name} ${JSON.stringify({ ...m, name: undefined })}`));
  (j.images || []).forEach((im, i) => console.log(`image ${i} ${im.name || ''} ${im.mimeType} bytes ${j.bufferViews[im.bufferView]?.byteLength}`));
}

function mat4(n) {
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz, xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2, wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0, (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, tx, ty, tz, 1];
}
const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
};
const prims = [];
const visit = (ni, PM) => {
  const n = j.nodes[ni], M = mul(PM, mat4(n));
  if (n.mesh !== undefined) for (const p of j.meshes[n.mesh].primitives) {
    const P = accessor(g, p.attributes.POSITION), pos = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] = M[k] * P[i] + M[4 + k] * P[i + 1] + M[8 + k] * P[i + 2] + M[12 + k];
    prims.push({ mesh: n.mesh, material: p.material ?? 0, pos, idx: p.indices !== undefined ? accessor(g, p.indices) : Uint32Array.from({ length: P.length / 3 }, (_, i) => i) });
  }
  for (const c of n.children || []) visit(c, M);
};
for (const ni of j.scenes[j.scene || 0].nodes) visit(ni, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
let total = 0, minY = Infinity;
for (const p of prims) {
  total += p.idx.length / 3;
  for (let i = 1; i < p.pos.length; i += 3) minY = Math.min(minY, p.pos[i]);
}
console.log(`world: ${prims.length} primitives, ${total} triangles, lowest vertex y ${minY.toFixed(4)}`);
for (const [pi, p] of prims.entries()) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.pos[i + k]); max[k] = Math.max(max[k], p.pos[i + k]); }
  console.log(`prim ${pi} (mesh ${p.mesh}, mat ${p.material}) tris ${p.idx.length / 3} min ${r3(min)} max ${r3(max)}`);
}
if (mode === 'islands') {
  const minTris = +(minTrisArg || 0);
  for (const [pi, p] of prims.entries()) {
    const n = p.pos.length / 3, key = new Map(), weld = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(p.pos[i * 3] * 1e4)},${Math.round(p.pos[i * 3 + 1] * 1e4)},${Math.round(p.pos[i * 3 + 2] * 1e4)}`;
      if (!key.has(k)) key.set(k, i);
      weld[i] = key.get(k);
    }
    const par = Int32Array.from({ length: n }, (_, i) => i);
    const find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
    for (let t = 0; t < p.idx.length; t += 3) {
      const a = find(weld[p.idx[t]]);
      par[find(weld[p.idx[t + 1]])] = a;
      par[find(weld[p.idx[t + 2]])] = a;
    }
    const isl = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(weld[i]);
      if (!isl.has(r)) isl.set(r, { tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
      const is = isl.get(r);
      for (let k = 0; k < 3; k++) { is.min[k] = Math.min(is.min[k], p.pos[i * 3 + k]); is.max[k] = Math.max(is.max[k], p.pos[i * 3 + k]); }
    }
    for (let t = 0; t < p.idx.length; t += 3) isl.get(find(weld[p.idx[t]])).tris++;
    const list = [...isl.values()].filter((s) => s.tris >= minTris).sort((a, b) => b.tris - a.tris);
    console.log(`prim ${pi}: ${isl.size} islands (${list.length} with >= ${minTris} tris)`);
    for (const s of list) console.log(`  tris ${String(s.tris).padStart(5)}  min ${r3(s.min)}  max ${r3(s.max)}`);
  }
}
