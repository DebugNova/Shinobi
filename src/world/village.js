// The village, from the map's house descriptors (colliders: src/shared/map.js). Two- to four-storey shops: plaster
// walls (tinted per house) on a dark timber frame (corner posts, floor beams, a stone plinth, a wood wainscot round
// the ground floor), shoji windows with sills and little tiled lintels (flower boxes under some), a shop front on the
// ground floor (noren curtains or the ramen stand's counter), striped awnings or a small pent roof, tiled gable roofs
// in five colours with a ridge cap, end tiles and gable vents, hanging and upright sign boards, drainpipes, meter
// boxes, balconies on some tall houses, paper lanterns (emissive: they glow through the bloom). Flat-roofed blocks
// (the new south-east street) get a parapet, a water tank and a stair hut on the roof. Plus the stone stairs,
// retaining walls, the low wall, crates and the well.
import * as THREE from 'three';
import { mulberry32 } from '../shared/rng.js';
import { PAVED } from '../shared/map.js';
import { M, boxUV } from './batch.js';
import { tint, paintBy, lin } from './palette.js';

// roof colours (sRGB; the tiles texture is neutral): the old red-brown, slate blue, teal, vermilion, moss green
export const ROOF_COLORS = ['#6b3a33', '#3e5876', '#2f6d69', '#8a3326', '#4f6b3c'];
// plaster tints (multipliers on the warm off-white plaster): white, cream, grey-blue, peach, sage, lilac-grey
const WALL_TINTS = [[1, 1, 1], [1.0, 0.95, 0.86], [0.84, 0.9, 1.0], [1.0, 0.88, 0.8], [0.9, 0.97, 0.87], [0.95, 0.92, 0.99]];
export const SIGN_TEXTS = ['茶屋', '団子', '本屋', '武器', '薬', '宿', '木ノ葉', '忍具', '甘味', '酒', '焼肉', '花屋', '寿司', '呉服'];
export const NOREN = [['茶', '#2c4a3a'], ['湯', '#23305e'], ['団子', '#7a2a22'], ['酒', '#4a3524']];
const FLOWERS = ['#e8436b', '#f2d24b', '#f7f2ea', '#d9366a', '#9a5bd0'];

const _x = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3();

/** Local-to-world matrix of a house (origin at the front-centre floor, +x along the front, +z out of the front). */
function houseFrame(h) {
  _x.set(h.lx[0], 0, h.lx[1]);
  _z.set(h.face[0], 0, h.face[1]);
  return new THREE.Matrix4().makeBasis(_x, _y, _z).setPosition(h.x, h.base, h.z);
}

/** A plane showing sign i of the sign atlas (w x h metres). */
function signPlane(i, n, w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / n);
  return g;
}

/** A plane showing a strip [u0, u1] of noren design i (of n). */
function norenPlane(i, n, u0, u1, w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + (u1 - u0) * uv.getX(k), (i + uv.getY(k)) / n);
  return g;
}

export function buildVillage(map, B, mat, paint) {
  const rng = mulberry32(2024);
  const lanterns = [];
  let signI = 0;
  const NS = SIGN_TEXTS.length, NN = NOREN.length;
  // (small clutter merges into the main batches: a distance-culled draw per cell cost more CPU than its triangles
  // cost the GPU; only the wildflowers are culled, flora.js)
  const FAR = null;
  for (const h of map.houses) {
    const F = houseFrame(h);
    const put = (m, g, x, y, z, rx = 0, ry = 0, rz = 0, o) => B.add(m, g, F.clone().multiply(M(x, y, z, rx, ry, rz)), o);
    const W = h.W, D = h.D, H = h.eave - h.base, fz = D / 2; // the front face is at local z = D/2
    const wt = WALL_TINTS[(h.variant * 5 + 1) % WALL_TINTS.length];
    const roofC = ROOF_COLORS[h.variant % ROOF_COLORS.length];
    const plaster = (g) => paintBy(g, () => wt);
    // walls (plaster), sunk into the ground a little
    put(mat.plaster, plaster(boxUV(W, H + 0.6, D, 1)), 0, (H - 0.6) / 2, 0);
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
    // a dark wood wainscot round the ground floor's sides and back (the front is the shop)
    put(mat.timber, boxUV(W - 0.3, 0.95, 0.04, 1), 0, 0.95, -fz - 0.03);
    for (const sx of [-1, 1]) put(mat.timber, boxUV(0.04, 0.95, D - 0.3, 1), sx * (W / 2 + 0.03), 0.95, 0);
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
      // noren strips across the open middle (a design per house, three strips)
      const nw = shopW / 2, nd = h.variant % NN;
      for (let k = 0; k < 3; k++) put(mat.norenAtlas, norenPlane(nd, NN, k / 3 + 0.01, (k + 1) / 3 - 0.01, nw / 3 - 0.04, 0.75), -nw / 2 + (k + 0.5) * (nw / 3), 2.02, fz + 0.12);
      put(mat.timber, new THREE.CylinderGeometry(0.03, 0.03, nw + 0.2, 5).rotateZ(Math.PI / 2), 0, 2.42, fz + 0.12);
      // a vertical sign board beside the door
      put(mat.timber, boxUV(0.62, 1.8, 0.06), W / 2 - 0.55, 2.2, fz + 0.09);
      put(mat.signAtlas, signPlane(signI++ % NS, NS, 0.5, 1.6), W / 2 - 0.55, 2.2, fz + 0.125);
    }
    // upper floors: shoji windows in timber frames, front and back, with a sill and a little tiled lintel roof;
    // flower boxes under some front windows; side windows on the gable ends
    for (let f = 1; f < h.floors; f++) {
      const y = f * 3.1 + 1.45;
      for (let k = 0; k < bays; k++) {
        const x = -W / 2 + (k + 0.5) * (W / bays);
        for (const side of [1, -1]) {
          const z0 = side * fz;
          put(mat.timber, boxUV(1.25, 1.15, 0.07), x, y, z0 + side * 0.04);
          put(mat.shoji, new THREE.PlaneGeometry(1.05, 0.95), x, y, z0 + side * 0.08, 0, side < 0 ? Math.PI : 0, 0);
          put(mat.timber, boxUV(1.4, 0.07, 0.2), x, y - 0.62, z0 + side * 0.1, 0, 0, 0, FAR);
          put(mat.roof, tint(boxUV(1.5, 0.05, 0.36), roofC), x, y + 0.7, z0 + side * 0.17, side * 0.3, 0, 0, FAR);
          if (side > 0 && rng() < 0.35) {
            // a flower box: a planter and a few blooms
            put(mat.palette, tint(boxUV(1.1, 0.2, 0.22), '#6b4a32'), x, y - 0.78, z0 + 0.2, 0, 0, 0, FAR);
            const fc = FLOWERS[Math.floor(rng() * FLOWERS.length)];
            for (let b = 0; b < 5; b++) put(mat.palette, tint(new THREE.IcosahedronGeometry(0.1 + rng() * 0.05, 0), b % 2 ? fc : '#4d8a34'), x - 0.45 + b * 0.22, y - 0.62 + rng() * 0.06, z0 + 0.2 + (rng() - 0.5) * 0.08, 0, 0, 0, FAR);
          }
        }
      }
      if (D >= 7) {
        for (const sx of [-1, 1]) {
          for (const zz of D >= 9 ? [-D / 4, D / 4] : [0]) {
            put(mat.timber, boxUV(0.07, 1.15, 1.25), sx * (W / 2 + 0.04), y, zz);
            put(mat.shoji, new THREE.PlaneGeometry(1.05, 0.95), sx * (W / 2 + 0.08), y, zz, 0, (sx * Math.PI) / 2, 0);
            put(mat.roof, tint(boxUV(0.36, 0.05, 1.5), roofC), sx * (W / 2 + 0.17), y + 0.7, zz, 0, 0, -sx * 0.3, FAR);
          }
        }
      }
    }
    // a balcony along the second floor of some tall houses (a slab, posts and a rail)
    if (h.floors >= 3 && h.variant % 2 === 0) {
      const y = 3.1, bw = W * 0.8;
      put(mat.woodLight, boxUV(bw, 0.12, 0.7, 1.5), 0, y + 0.06, fz + 0.35);
      put(mat.timber, boxUV(bw, 0.08, 0.08), 0, y + 1.0, fz + 0.68);
      put(mat.timber, boxUV(bw, 0.06, 0.06), 0, y + 0.55, fz + 0.68);
      const np = Math.round(bw / 0.9);
      for (let k = 0; k <= np; k++) put(mat.timber, boxUV(0.07, 1.0, 0.07), -bw / 2 + (k * bw) / np, y + 0.5, fz + 0.68, 0, 0, 0, FAR);
    }
    // awning over the shop front: striped cloth sloping out, a scalloped valance, two poles; or a small tiled pent
    // roof. The back always gets a pent roof over the ground floor.
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
    for (const side of h.awning ? [-1] : [1, -1]) {
      put(mat.roof, tint(boxUV(W + 0.3, 0.08, 0.85, 0.9), roofC), 0, 3.28, side * (fz + 0.4), side * 0.36, 0, 0);
      put(mat.timber, boxUV(W + 0.3, 0.1, 0.1), 0, 3.12, side * (fz + 0.8));
      for (let k = 0; k <= bays; k++) put(mat.timber, boxUV(0.08, 0.08, 0.8), -W / 2 + (k * W) / bays, 3.1, side * (fz + 0.4), 0, 0, 0, FAR);
    }
    // a hanging sign board sticking out at the upper front corner (both faces painted), on a bracket
    if (rng() < 0.6) {
      const sx = rng() < 0.5 ? 1 : -1, x = sx * (W / 2 - 0.35), y = 3.1 + 1.7, i = signI++ % NS;
      put(mat.timber, boxUV(0.07, 1.9, 0.7), x, y, fz + 0.45);
      for (const s of [1, -1]) put(mat.signAtlas, signPlane(i, NS, 0.56, 1.72), x + s * 0.04, y, fz + 0.45, 0, (s * Math.PI) / 2, 0);
      put(mat.timber, boxUV(0.06, 0.06, 0.95), x, y + 1.0, fz + 0.45);
    }
    // a drainpipe down one front corner, a meter box on a side wall
    const dx = (h.variant % 2 ? 1 : -1) * (W / 2 - 0.02);
    put(mat.palette, tint(new THREE.CylinderGeometry(0.06, 0.06, H + 0.3, 6), '#5d6670'), dx, (H + 0.3) / 2 - 0.3, fz + 0.14, 0, 0, 0, FAR);
    put(mat.palette, tint(boxUV(0.2, 0.45, 0.38), '#9aa3a8'), -dx - Math.sign(dx) * 0.12, 1.7, fz - 1.2, 0, 0, 0, FAR);
    // lanterns hanging at the front
    const nl = h.shop === 'ramen' ? 2 : rng() < 0.6 ? 1 : 0;
    for (let k = 0; k < nl; k++) {
      const lx = nl === 2 ? (k ? 1 : -1) * (shopW / 2 + 0.2) : -W / 2 + 0.9;
      const p = new THREE.Vector3(lx, 2.55, fz + 0.45).applyMatrix4(F);
      lanterns.push({ p, color: h.shop === 'ramen' || rng() < 0.6 ? 'red' : 'white' });
    }
    // roof: two tiled slopes following the collider, a ridge cap with end tiles, gable boards and vents
    const oh = h.oh, half = D / 2 + oh, rise = h.rise;
    for (const sg of [1, -1]) {
      const len = Math.hypot(half, rise);
      const g = boxUV(W + 2 * oh, 0.14, len, 1);
      const u = g.attributes.uv;
      for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 0.9, u.getY(i) * 0.9);
      const ang = Math.atan2(rise, half);
      put(mat.roof, tint(g, roofC), 0, H + rise / 2 + 0.05, (sg * half) / 2, sg * ang, 0, 0);
      // eave board
      put(mat.timber, boxUV(W + 2 * oh, 0.22, 0.12), 0, H + 0.02, sg * (half - 0.02));
    }
    const ridge = new THREE.CylinderGeometry(0.16, 0.16, W + 2 * oh + 0.2, 10);
    ridge.rotateZ(Math.PI / 2);
    put(mat.roofRidge, ridge, 0, H + rise + 0.14, 0);
    for (const sx of [-1, 1]) {
      // the ridge's end tiles (onigawara): a raised block with a rounded crest
      put(mat.roofRidge, boxUV(0.2, 0.42, 0.36), sx * (W / 2 + oh + 0.12), H + rise + 0.3, 0);
      put(mat.roofRidge, new THREE.CylinderGeometry(0.18, 0.18, 0.2, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), sx * (W / 2 + oh + 0.12), H + rise + 0.5, 0);
      const tri = new THREE.BufferGeometry();
      const pz = D / 2;
      tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -pz, 0, 0, pz, 0, rise, 0], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, D, 0, D / 2, rise], 2));
      tri.computeVertexNormals();
      put(mat.plaster, plaster(tri), sx * (W / 2 + 0.005), H, 0, 0, sx > 0 ? Math.PI : 0, 0);
      put(mat.timber, boxUV(0.1, 0.16, Math.hypot(pz, rise) * 2 + 0.2), sx * (W / 2 + 0.06), H + rise / 2, 0);
      // a slatted vent under the gable's peak
      put(mat.interior, boxUV(0.03, 0.4, 0.7), sx * (W / 2 + 0.02), H + rise * 0.42, 0);
      for (let k = -1; k <= 1; k++) put(mat.timber, boxUV(0.05, 0.44, 0.05), sx * (W / 2 + 0.04), H + rise * 0.42, k * 0.2, 0, 0, 0, FAR);
    }
    // potted plants by the door
    if (rng() < 0.7) {
      const px = -W / 2 + 0.5 + rng() * 0.4;
      put(mat.pot, new THREE.CylinderGeometry(0.22, 0.17, 0.4, 10), px, 0.2, fz + 0.4);
      put(mat.bush, new THREE.IcosahedronGeometry(0.34, 1), px, 0.62, fz + 0.4);
    }
  }
  buildBlocks(map, B, mat, lanterns);
  // flagstones on the paved streets: a sheet following the ground 3.5 cm above it (on the heightfield's own 1 m grid,
  // so it bends where the ground does), the stone texture in world space
  for (const [x0, z0, x1, z1] of PAVED) {
    const nx = Math.ceil(x1 - x0), nz = Math.ceil(z1 - z0);
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz).rotateX(-Math.PI / 2);
    const q = g.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const x = (x0 + x1) / 2 + q.getX(i), z = (z0 + z1) / 2 + q.getZ(i);
      q.setXYZ(i, x, map.world.terrain(x, z) + 0.035, z);
    }
    g.computeVertexNormals();
    B.add(mat.stone, g);
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
        B.add(mat.roof, tint(cap, ROOF_COLORS[0]), M(s.x, s.y1 + 0.07, s.z));
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
      const roof = tint(boxUV(2.9, 0.08, 1.2), ROOF_COLORS[0]);
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

/**
 * Flat-roofed blocks and round towers (map.js `block` props: the south-east street): a facade of windows in
 * timber-framed bays (the backdrop town's texture, full size here), floor bands, a stone base, a parapet round the
 * walkable roof, a water tank on legs and a stair hut (their colliders come from map.js), signs, pipes and lanterns.
 */
function buildBlocks(map, B, mat, lanterns) {
  for (const b of map.props) {
    if (b.t !== 'block') continue;
    const wall = WALL_TINTS[b.variant % WALL_TINTS.length];
    const floorBand = (g) => tint(g, '#6b5a4a');
    if (b.round) {
      const H = b.top - b.base;
      const g = new THREE.CylinderGeometry(b.r, b.r, H, 28, 1, true);
      const uv = g.attributes.uv, p = g.attributes.position;
      const bays = Math.max(3, Math.round((Math.PI * 2 * b.r) / 4));
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * bays, (p.getY(i) + H / 2) / 3.1);
      B.add(mat.facade, paintBy(g, () => wall), M(b.x, b.base + H / 2, b.z));
      B.add(mat.stone, new THREE.CylinderGeometry(b.r + 0.08, b.r + 0.12, 0.6, 28), M(b.x, b.base + 0.25, b.z));
      for (let f = 1; f < b.floors; f++) B.add(mat.palette, floorBand(new THREE.CylinderGeometry(b.r + 0.1, b.r + 0.1, 0.2, 28, 1, true)), M(b.x, b.base + f * 3.1, b.z));
      B.add(mat.stone, new THREE.CylinderGeometry(b.r + 0.12, b.r + 0.12, 0.2, 28), M(b.x, b.top + 0.1, b.z));
      // the parapet ring (its collider: map.js): a closed profile turned round (outer wall, coping, inner wall)
      const prof = [[b.r + 0.12, 0], [b.r + 0.12, 0.72], [b.r - 0.36, 0.72], [b.r - 0.36, 0]].map(([r, y]) => new THREE.Vector2(r, y));
      B.add(mat.plaster, paintBy(new THREE.LatheGeometry(prof, 28), () => wall), M(b.x, b.top + 0.08, b.z));
    } else {
      const H = b.top - b.base;
      // facade box: u = metres / 4 along each face, v = metres / 3.1 up
      const g = boxUV(b.w, H, b.d, 1);
      const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const along = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i);
        uv.setXY(i, (along + 20) / 4, (p.getY(i) + H / 2) / 3.1);
      }
      B.add(mat.facade, paintBy(g, () => wall), M(b.x, b.base + H / 2, b.z, 0, b.yaw, 0));
      B.add(mat.stone, boxUV(b.w + 0.1, 0.6, b.d + 0.1, 1.2), M(b.x, b.base + 0.25, b.z, 0, b.yaw, 0));
      for (let f = 1; f < b.floors; f++) B.add(mat.palette, floorBand(boxUV(b.w + 0.14, 0.2, b.d + 0.14)), M(b.x, b.base + f * 3.1, b.z, 0, b.yaw, 0));
      // roof slab + parapet (colliders: map.js)
      B.add(mat.stone, boxUV(b.w + 0.2, 0.25, b.d + 0.2, 0.8), M(b.x, b.top + 0.1, b.z, 0, b.yaw, 0));
      for (const pp of b.parapets) B.add(mat.plaster, paintBy(boxUV(pp.hx * 2, pp.h, pp.hz * 2, 1), () => wall), M(pp.x, b.top + pp.h / 2, pp.z, 0, b.yaw, 0));
      for (const pp of b.parapets) B.add(mat.stone, boxUV(pp.hx * 2 + 0.06, 0.08, pp.hz * 2 + 0.06, 1), M(pp.x, b.top + pp.h + 0.04, pp.z, 0, b.yaw, 0));
      // a big upright sign on the street face
      if (b.sign != null) {
        const [fx, fz] = b.face;
        const sx = b.x + fx * (b.fd + 0.12) + b.lx[0] * (b.w / 2 - 0.9) * 0.9, sz = b.z + fz * (b.fd + 0.12) + b.lx[1] * (b.w / 2 - 0.9) * 0.9;
        const ry = Math.atan2(fx, fz);
        B.add(mat.timber, boxUV(1.3, 4.4, 0.12), M(sx, b.base + 3.1 + 2.6, sz, 0, ry, 0));
        B.add(mat.signAtlas, signPlane(b.sign % SIGN_TEXTS.length, SIGN_TEXTS.length, 1.1, 4.1), M(sx + fx * 0.07, b.base + 3.1 + 2.6, sz + fz * 0.07, 0, ry, 0));
      }
      // shop front on the ground floor: dark glass behind an awning strip
      {
        const [fx, fz] = b.face, ry = Math.atan2(fx, fz);
        B.add(mat.interior, boxUV(b.fw * 0.7, 2.2, 0.04), M(b.x + fx * (b.fd + 0.03), b.base + 1.35, b.z + fz * (b.fd + 0.03), 0, ry, 0));
        B.add(b.variant % 2 ? mat.awnRed : mat.awnYellow, new THREE.PlaneGeometry(b.fw * 0.78, 1.3).rotateX(-Math.PI / 2 + 0.3), M(b.x + fx * (b.fd + 0.6), b.base + 2.8, b.z + fz * (b.fd + 0.6), 0, ry, 0));
        lanterns.push({ p: new THREE.Vector3(b.x + fx * (b.fd + 0.4) - b.lx[0] * b.fw * 0.42, b.base + 2.5, b.z + fz * (b.fd + 0.4) - b.lx[1] * b.fw * 0.42), color: 'red' });
      }
      // a pipe down a corner
      B.add(mat.palette, tint(new THREE.CylinderGeometry(0.08, 0.08, H, 6), '#5d6670'), M(b.x + b.lx[0] * (b.w / 2 - 0.1) + b.face[0] * (b.fd + 0.12), b.base + H / 2, b.z + b.lx[1] * (b.w / 2 - 0.1) + b.face[1] * (b.fd + 0.12)));
    }
    // roof clutter: the water tank on legs, the stair hut
    if (b.tank) {
      const t = b.tank;
      B.add(mat.palette, tint(new THREE.CylinderGeometry(t.r, t.r, t.h, 16), '#9fb3c4'), M(t.x, t.y0 + t.legs + t.h / 2, t.z));
      B.add(mat.palette, tint(new THREE.ConeGeometry(t.r + 0.05, 0.45, 16), '#6f7c89'), M(t.x, t.y0 + t.legs + t.h + 0.22, t.z));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        B.add(mat.palette, tint(boxUV(0.12, t.legs, 0.12), '#4a4a50'), M(t.x + Math.cos(a) * t.r * 0.75, t.y0 + t.legs / 2, t.z + Math.sin(a) * t.r * 0.75));
      }
      B.add(mat.palette, tint(new THREE.CylinderGeometry(t.r + 0.02, t.r + 0.02, 0.12, 16, 1, true), '#6f7c89'), M(t.x, t.y0 + t.legs + t.h * 0.3, t.z));
    }
    if (b.hut) {
      const u = b.hut;
      B.add(mat.plaster, paintBy(boxUV(u.hx * 2, u.h, u.hz * 2, 1), () => wall), M(u.x, u.y0 + u.h / 2, u.z));
      B.add(mat.stone, boxUV(u.hx * 2 + 0.2, 0.14, u.hz * 2 + 0.2, 1), M(u.x, u.y0 + u.h + 0.07, u.z));
      B.add(mat.interior, boxUV(0.9, 1.9, 0.04), M(u.x, u.y0 + 0.95, u.z + u.hz + 0.02));
    }
  }
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

export { lin };
