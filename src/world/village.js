// The village, from the map's house descriptors (colliders: src/shared/map.js). Two- and three-storey shops:
// plaster walls on a dark timber frame (corner posts, floor beams, a stone plinth), shoji windows, a shop front on the
// ground floor, striped awnings with a scalloped valance, tiled gable roofs with a ridge cap and gable boards, paper
// lanterns (emissive: they glow through the bloom), vertical sign boards; the ramen stand gets its red "ラーメン"
// sign and a noren curtain. Plus the stone stairs, retaining walls, the low wall, crates and the well.
import * as THREE from 'three';
import { mulberry32 } from '../shared/rng.js';
import { M, boxUV } from './batch.js';

const _b = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3();

/** Local-to-world matrix of a house (origin at the front-centre floor, +x along the front, +z out of the front). */
function houseFrame(h) {
  _x.set(h.lx[0], 0, h.lx[1]);
  _z.set(h.face[0], 0, h.face[1]);
  return new THREE.Matrix4().makeBasis(_x, _y, _z).setPosition(h.x, h.base, h.z);
}

const SIGNS = ['茶屋', '団子', '本屋', '武器', '薬', '宿', '木ノ葉', '忍者'];

export function buildVillage(map, B, mat, paint) {
  const rng = mulberry32(2024);
  const lanterns = [];
  let signI = 0;
  for (const h of map.houses) {
    const F = houseFrame(h);
    const put = (m, g, x, y, z, rx = 0, ry = 0, rz = 0) => B.add(m, g, F.clone().multiply(M(x, y, z, rx, ry, rz)));
    const W = h.W, D = h.D, H = h.eave - h.base, fz = D / 2; // the front face is at local z = D/2
    // walls (plaster), sunk into the ground a little
    put(mat.plaster, boxUV(W, H + 0.6, D, 1), 0, (H - 0.6) / 2, 0);
    // stone plinth and timber frame standing proud of the walls (never coplanar)
    put(mat.stone, boxUV(W + 0.08, 0.55, D + 0.08, 1.4), 0, 0.2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(mat.timber, boxUV(0.22, H, 0.22, 1), sx * (W / 2 - 0.08), H / 2, sz * (D / 2 - 0.08));
    for (let f = 1; f <= h.floors; f++) {
      const y = Math.min(H - 0.1, f * 3.1);
      put(mat.timber, boxUV(W + 0.06, 0.18, 0.08, 1), 0, y, fz + 0.02);
      put(mat.timber, boxUV(W + 0.06, 0.18, 0.08, 1), 0, y, -fz - 0.02);
      put(mat.timber, boxUV(0.08, 0.18, D + 0.06, 1), W / 2 + 0.02, y, 0);
      put(mat.timber, boxUV(0.08, 0.18, D + 0.06, 1), -W / 2 - 0.02, y, 0);
    }
    // mid posts on the front
    const bays = Math.max(2, Math.round(W / 2.6));
    for (let k = 1; k < bays; k++) put(mat.timber, boxUV(0.16, H, 0.06, 1), -W / 2 + (k * W) / bays, H / 2, fz + 0.03);
    // ground floor: a shop front (dark interior behind shoji and a counter) or sliding doors
    const shopW = W * 0.72;
    put(mat.interior, boxUV(shopW, 2.3, 0.04), 0, 1.35, fz + 0.025);
    if (h.shop === 'ramen') {
      // counter, noren curtain, the red sign
      put(mat.woodLight, boxUV(shopW, 0.9, 0.45, 1.5), 0, 0.45, fz + 0.28);
      const strips = 5;
      for (let k = 0; k < strips; k++) {
        const g = new THREE.PlaneGeometry(shopW / strips - 0.04, 0.7);
        put(mat.noren, g, -shopW / 2 + (k + 0.5) * (shopW / strips), 2.1, fz + 0.5);
      }
      put(mat.ramenSign, new THREE.PlaneGeometry(2.4, 0.8), 0, 3.35, fz + 0.62);
      put(mat.timber, boxUV(2.6, 0.95, 0.08), 0, 3.35, fz + 0.57);
    } else {
      const panels = 4;
      for (let k = 0; k < panels; k++) {
        if (k === 1 || k === 2) continue; // the open middle
        put(mat.shoji, new THREE.PlaneGeometry(shopW / panels - 0.05, 2.1), -shopW / 2 + (k + 0.5) * (shopW / panels), 1.25, fz + 0.06);
      }
      // a vertical sign board beside the door
      const sign = mat.signs[signI++ % mat.signs.length];
      put(mat.timber, boxUV(0.62, 1.8, 0.06), W / 2 - 0.55, 2.2, fz + 0.09);
      put(sign, new THREE.PlaneGeometry(0.5, 1.6), W / 2 - 0.55, 2.2, fz + 0.125);
    }
    // upper floors: shoji windows in timber frames, front and back
    for (let f = 1; f < h.floors; f++) {
      const y = f * 3.1 + 1.45;
      for (let k = 0; k < bays; k++) {
        const x = -W / 2 + (k + 0.5) * (W / bays);
        for (const side of [1, -1]) {
          put(mat.timber, boxUV(1.25, 1.15, 0.07), x, y, side * (fz + 0.04));
          put(mat.shoji, new THREE.PlaneGeometry(1.05, 0.95), x, y, side * (fz + 0.08), 0, side < 0 ? Math.PI : 0, 0);
        }
      }
    }
    // awning over the shop front: striped cloth sloping out, a scalloped valance, two poles
    if (h.awning) {
      const am = h.awning === 'red' ? mat.awnRed : mat.awnYellow;
      const aw = W * 0.86, depth = 1.5, drop = 0.45;
      const g = new THREE.PlaneGeometry(aw, Math.hypot(depth, drop));
      const u = g.attributes.uv;
      for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * aw * 1.1, u.getY(i));
      put(am, g, 0, 2.95 - drop / 2, fz + depth / 2, -Math.PI / 2 + Math.atan2(drop, depth), 0, 0);
      const v = new THREE.PlaneGeometry(aw, 0.28, 24, 1);
      const vp = v.attributes.position, vu = v.attributes.uv;
      for (let i = 0; i < vp.count; i++) {
        if (vp.getY(i) < 0) vp.setY(i, vp.getY(i) + Math.abs(Math.sin((vp.getX(i) / aw) * Math.PI * 12)) * 0.1);
        vu.setXY(i, vu.getX(i) * aw * 1.1, vu.getY(i) * 0.3);
      }
      put(am, v, 0, 2.95 - drop - 0.13, fz + depth + 0.005);
      for (const sx of [-1, 1]) put(mat.timber, new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), sx * (aw / 2 - 0.1), 1.25, fz + depth - 0.05);
    }
    // lanterns hanging at the front
    const nl = h.shop === 'ramen' ? 2 : rng() < 0.6 ? 1 : 0;
    for (let k = 0; k < nl; k++) {
      const lx = nl === 2 ? (k ? 1 : -1) * (shopW / 2 + 0.2) : -W / 2 + 0.9;
      const p = new THREE.Vector3(lx, 2.55, fz + 0.45).applyMatrix4(F);
      lanterns.push({ p, color: h.shop === 'ramen' || rng() < 0.6 ? 'red' : 'white' });
    }
    // roof: two tiled slopes following the collider, a ridge cap, gable boards
    const oh = h.oh, half = D / 2 + oh, rise = h.rise;
    for (const sg of [1, -1]) {
      const len = Math.hypot(half, rise);
      const g = boxUV(W + 2 * oh, 0.14, len, 1);
      const u = g.attributes.uv;
      for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 0.9, u.getY(i) * 0.9);
      const ang = Math.atan2(rise, half);
      put(mat.roof, g, 0, H + rise / 2 + 0.05, (sg * half) / 2, sg * ang, 0, 0);
      // eave board
      put(mat.timber, boxUV(W + 2 * oh, 0.22, 0.12), 0, H + 0.02, sg * (half - 0.02));
    }
    const ridge = new THREE.CylinderGeometry(0.16, 0.16, W + 2 * oh + 0.2, 10);
    ridge.rotateZ(Math.PI / 2);
    put(mat.roofRidge, ridge, 0, H + rise + 0.14, 0);
    for (const sx of [-1, 1]) {
      const tri = new THREE.BufferGeometry();
      const pz = D / 2;
      tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -pz, 0, 0, pz, 0, rise, 0], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, D, 0, D / 2, rise], 2));
      tri.computeVertexNormals();
      put(mat.plaster, tri, sx * (W / 2 + 0.005), H, 0, 0, sx > 0 ? Math.PI : 0, 0);
      put(mat.timber, boxUV(0.1, 0.16, Math.hypot(pz, rise) * 2 + 0.2), sx * (W / 2 + 0.06), H + rise / 2, 0);
    }
    // potted plants by the door
    if (rng() < 0.7) {
      const px = -W / 2 + 0.5 + rng() * 0.4;
      put(mat.pot, new THREE.CylinderGeometry(0.22, 0.17, 0.4, 10), px, 0.2, fz + 0.4);
      put(mat.bush, new THREE.IcosahedronGeometry(0.34, 1), px, 0.62, fz + 0.4);
    }
  }
  // stairs, walls, crates, well
  for (const p of map.props) {
    if (p.t === 'stairs') {
      // steps (walked on as one ramp: see map.js) with pale tread stones whose nosing overhangs the riser a little
      for (let i = 0; i < p.n; i++) {
        const top = p.rise * (i + 1), zf = p.z0 - i * p.run;
        B.add(mat.stoneWall, boxUV(p.w, top + 0.5, p.run + 0.02, 1.5), M(p.x, (top - 0.5) / 2 - 0.04, zf - p.run / 2));
        B.add(mat.stone, boxUV(p.w, 0.08, p.run + 0.06, 1.5), M(p.x, top - 0.04, zf - p.run / 2 + 0.03));
      }
      // the landing onto the terrace
      const zt = p.z0 - p.n * p.run, [, zl] = p.landing;
      B.add(mat.stoneWall, boxUV(p.w, p.top + 0.5, zt - zl, 1.5), M(p.x, (p.top - 0.5) / 2 - 0.04, (zt + zl) / 2));
      B.add(mat.stone, boxUV(p.w, 0.08, zt - zl + 0.06, 1.5), M(p.x, p.top - 0.04, (zt + zl) / 2 + 0.03));
      // balustrades: posts, and walls whose top follows the steps; a coping stone along every top
      const sloped = (w, d, y0, y1, sz) => {
        // a box from y0 up to a top sloping along z (y1 at its middle)
        const g = boxUV(w, 1, d, 1.2);
        const q = g.attributes.position;
        for (let i = 0; i < q.count; i++) q.setY(i, q.getY(i) > 0 ? y1 + sz * q.getZ(i) : y0);
        g.computeVertexNormals();
        return g;
      };
      for (const c of p.cheeks) {
        B.add(mat.stoneWall, sloped(c.hx * 2, c.hz * 2, -0.5, c.y1 - 0.1, c.sz), M(c.x, 0, c.z));
        B.add(mat.stone, sloped(c.hx * 2 + 0.1, c.hz * 2 + (c.post ? 0.1 : 0), c.y1 - 0.14, c.y1, c.sz), M(c.x, 0, c.z));
      }
    } else if (p.t === 'wall') {
      const s = p.s;
      const m = p.kind === 'retain' ? mat.stoneWall : mat.plaster;
      B.add(m, boxUV(s.hx * 2, s.y1 - s.y0 + 0.5, s.hz * 2, 0.8), M(s.x, (s.y1 + s.y0 - 0.5) / 2, s.z));
      if (p.kind === 'low') {
        const cap = boxUV(s.hx * 2 + 0.2, 0.14, s.hz * 2 + 0.1);
        B.add(mat.roof, cap, M(s.x, s.y1 + 0.07, s.z));
      }
    } else if (p.t === 'crate') {
      B.add(mat.crate, boxUV(p.s, p.s, p.s, 1.6), M(p.x, p.y + p.s / 2, p.z, 0, p.yaw, 0));
    } else if (p.t === 'well') {
      const ring = new THREE.CylinderGeometry(1.25, 1.3, 0.95, 20, 1, true);
      B.add(mat.stone, ring, M(p.x, p.y + 0.42, p.z));
      B.add(mat.stone, new THREE.TorusGeometry(1.25, 0.12, 6, 24).rotateX(Math.PI / 2), M(p.x, p.y + 0.9, p.z));
      B.add(mat.water, new THREE.CircleGeometry(1.15, 20).rotateX(-Math.PI / 2), M(p.x, p.y + 0.55, p.z));
      for (const sx of [-1, 1]) B.add(mat.timber, boxUV(0.14, 2.2, 0.14), M(p.x + sx * 1.05, p.y + 1.6, p.z));
      const beam = boxUV(2.5, 0.14, 0.14);
      B.add(mat.timber, beam, M(p.x, p.y + 2.65, p.z));
      const roof = boxUV(2.9, 0.08, 1.2);
      for (const sz of [-1, 1]) B.add(mat.roof, roof, M(p.x, p.y + 2.9, p.z + sz * 0.45, sz * 0.5, 0, 0));
    }
  }
  // strings of lanterns across the square (between house fronts)
  const strings = [[[30, -17], [30, 15]], [[45, -17], [45, 15]], [[58, -17], [58, 15]]];
  for (const [a, b] of strings) {
    const n = 7;
    for (let k = 1; k < n; k++) {
      const t = k / n, sag = Math.sin(t * Math.PI) * 1.1;
      lanterns.push({ p: new THREE.Vector3(a[0] + (b[0] - a[0]) * t, 5.4 - sag, a[1] + (b[1] - a[1]) * t), color: k % 2 ? 'red' : 'white', small: true });
    }
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, 5.75 - Math.sin(t * Math.PI) * 1.1, a[1] + (b[1] - a[1]) * t));
    }
    B.add(mat.rope, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.02, 4));
  }
  return lanterns;
}

/** Paper lanterns: a lathe body (emissive, blooms), dark caps and a hanging cord. Instanced by colour. */
export function buildLanterns(list, mat) {
  const group = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push(new THREE.Vector2(0.05 + Math.sin(t * Math.PI) * 0.19, t * 0.5 - 0.25));
  }
  const body = new THREE.LatheGeometry(prof, 14);
  const cap = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10);
  const byColor = { red: [], white: [] };
  for (const l of list) byColor[l.color].push(l);
  for (const [c, arr] of Object.entries(byColor)) {
    if (!arr.length) continue;
    const bodies = new THREE.InstancedMesh(body, c === 'red' ? mat.lanternRed : mat.lanternWhite, arr.length);
    const caps = new THREE.InstancedMesh(cap, mat.timber, arr.length * 2);
    const m = new THREE.Matrix4();
    arr.forEach((l, i) => {
      const s = l.small ? 0.8 : 1.2;
      bodies.setMatrixAt(i, m.makeScale(s, s, s).setPosition(l.p));
      caps.setMatrixAt(i * 2, m.makeScale(s, s, s).setPosition(l.p.x, l.p.y + 0.26 * s, l.p.z));
      caps.setMatrixAt(i * 2 + 1, m.makeScale(s, s, s).setPosition(l.p.x, l.p.y - 0.26 * s, l.p.z));
    });
    group.add(bodies, caps);
  }
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  return group;
}
