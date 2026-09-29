// Ground life that has no collider (you run through it, like the grass): patches of wildflowers in the grass,
// bushes round the giant trees' feet, along the cliffs and by the walls. Flowers are tiny and many, so they are
// merged into the palette material's batch; bushes are leaf clumps in the canopy material.
import * as THREE from 'three';
import { mulberry32, fbm } from '../shared/rng.js';
import { SURF } from '../shared/config.js';
import { WATER_Y } from '../shared/map.js';
import { lin } from './palette.js';
import { foliage } from './nature.js';

const FLOWER_COLORS = ['#f7f2ea', '#f2d24b', '#e8436b', '#9a5bd0', '#f39a3c', '#6fa8ef'];

/** Is (x, z) open grass: no dirt, no collider, not water, inside the arena. */
function grassy(map, x, z, g) {
  const D = map._dirt;
  const di = Math.round((x - D.x0) / D.step), dj = Math.round((z - D.x0) / D.step);
  if (D.data[dj * D.n + di] > 0.3) return false;
  map.world.ground(x, z, 80, g);
  const ty = map.world.terrain(x, z);
  return !g.shape && g.surf !== SURF.water && ty > WATER_Y + 0.15;
}

/** One flower: a three-petal star round a centre (flat, facing up, a little tilted), on a short stem; world space. */
function flower(x, y, z, s, petal, rng, pos, col, idx) {
  const base = pos.length / 3;
  const tilt = (rng() - 0.5) * 0.5, rot = rng() * 6.283;
  const P = (px, py, pz) => {
    // tilt about x, then turn
    const cy = Math.cos(tilt), sy = Math.sin(tilt);
    const qy = py * cy - pz * sy, qz = py * sy + pz * cy;
    const c = Math.cos(rot), sn = Math.sin(rot);
    pos.push(x + px * c - qz * sn, y + qy, z + px * sn + qz * c);
  };
  const h = 0.16 + rng() * 0.12;
  // stem: a thin upright triangle
  P(-0.008 * s, 0, 0);
  P(0.008 * s, 0, 0);
  P(0, h, 0);
  const green = lin('#3f7d2c');
  col.push(...green, ...green, ...green);
  idx.push(base, base + 1, base + 2);
  // centre + five petal tips
  const c0 = pos.length / 3;
  P(0, h + 0.01, 0);
  col.push(...lin('#f2c230'));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * 6.283, r = (k % 2 ? 0.03 : 0.09) * s;
    P(Math.cos(a) * r, h, Math.sin(a) * r);
    col.push(...petal);
  }
  for (let k = 0; k < 6; k++) idx.push(c0, c0 + 1 + ((k + 1) % 6), c0 + 1 + k);
}

export function buildFlora(map, B, mat) {
  const rng = mulberry32(5150);
  const g = {};
  // wildflower patches: a colour (or two) per patch, clumped round its centre
  const pos = [], col = [], idx = [];
  let patches = 0;
  for (let tries = 0; tries < 2500 && patches < 150; tries++) {
    const x = -69 + rng() * 138, z = -45 + rng() * 114;
    if (!grassy(map, x, z, g) || fbm(x * 0.06, z * 0.06, 2, 33) < -0.1) continue;
    patches++;
    const c1 = lin(FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]), c2 = lin(FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]);
    const n = 12 + Math.floor(rng() * 16), R = 0.8 + rng() * 1.6;
    for (let k = 0; k < n; k++) {
      const a = rng() * 6.283, d = Math.sqrt(rng()) * R, fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
      if (!grassy(map, fx, fz, g)) continue;
      flower(fx, map.world.terrain(fx, fz) - 0.01, fz, 1.3 + rng() * 0.6, rng() < 0.75 ? c1 : c2, rng, pos, col, idx);
    }
  }
  // one piece in the palette batch: ~35k triangles cost the GPU less than the draws of distance-culled cells
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  gg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  gg.setIndex(idx);
  const ng = gg.toNonIndexed();
  // flowers face up whatever their triangles say (lit like the grass under them)
  const nn = new Float32Array(ng.attributes.position.count * 3);
  for (let i = 1; i < nn.length; i += 3) nn[i] = 1;
  ng.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  B.add(mat.palette, ng);
  // bushes: round the giant trees' feet (outside the root flare), along the foot of the cliffs and walls
  const bush = (x, z, r) => {
    const y = map.world.terrain(x, z);
    const C = { x, y: y + r * 0.3, z, R: r * 1.4, Rv: r };
    const t = rng() < 0.5 ? [0.95, 1.05, 0.9] : [1.05, 1.02, 0.82];
    B.add(mat.leaves, foliage(x, y + r * 0.35, z, r, rng, 2, C, t, 0.7));
    if (rng() < 0.6) B.add(mat.leaves, foliage(x + (rng() - 0.5) * r, y + r * 0.25, z + (rng() - 0.5) * r, r * 0.7, rng, 1, C, t, 0.7));
  };
  for (const t of map.trees) {
    const n = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < n; k++) {
      const a = rng() * 6.283, d = t.r * 1.75 + 0.6 + rng() * 1.2;
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (grassy(map, x, z, g)) bush(x, z, 0.55 + rng() * 0.35);
    }
  }
  for (const c of map.props) {
    if (c.t !== 'cliff' || c.rim || c.notch) continue;
    // along the exposed south face of the ledge and ridge rows
    const s = c.s;
    for (let k = 0; k < 2; k++) {
      if (rng() < 0.45) continue;
      const x = s.x + (rng() - 0.5) * s.hx * 1.8, z = s.z + s.hz + 0.7 + rng() * 0.6;
      if (grassy(map, x, z, g)) bush(x, z, 0.5 + rng() * 0.45);
    }
  }
}
