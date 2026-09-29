// "Training Grounds": the arena layout. Built deterministically from a seed on every client and on the server:
// the terrain heightfield, every collider (boxes, cylinders) and a list of prop descriptors the client turns into
// meshes (src/world/). Colliders only come from here. Visual-only decoration (grass, bushes, lanterns, leaves) is
// placed by the client with its own RNG stream so it can never shift a collider.
//
// Axes: +x east, +z south (north = -z), y up. Playable area about 140 x 140 m: x, z in [-70, 70].
//   village (square, shops, ramen stand, stairs to an upper street) ...... east   x 18..70
//   forest training ground (giant climbable trees, branches, mounds) ...... west   x -70..-8
//   cliffs + ridge (rock ledges, a waterfall) ............................. north  z < -44
//   river (walkable water, stepping stones, a wooden bridge) .............. through the middle, north -> south
//   open training field (posts, memorial stone, targets) .................. south-west
import { CollisionWorld, box, cyl, BOX } from './collide.js';
import { SURF } from './config.js';
import { mulberry32, fbm, smoothstep, dsin, dcos } from './rng.js';

export const MAP_SEED = 20260927;
export const WATER_Y = -0.35;
export const BOUNDS = { minX: -71, maxX: 71, minZ: -69, maxZ: 71 };
const HF = { x0: -120, z0: -120, cell: 1, nx: 241, nz: 241 };

// River centreline (Catmull-Rom through these points), half width, bed depth
const RIVER = [[-4, -60], [-4, -44], [2, -26], [-3, -6], [4, 14], [0, 34], [6, 54], [8, 80]];
const RIVER_HW = 4.6;

const PLAZA = { x: 44, z: -1, hx: 17, hz: 13 };
const FIELD = { x: -26, z: 42, hx: 24, hz: 20 };
const TERRACE_Y = 4; // the upper street
/** Stone-paved streets (their surface id is stone: footsteps; the art lays flagstones on them): [x0, z0, x1, z1]. */
export const PAVED = [
  [27, -37.4, 72, -28.4], // the upper street
  [19.5, -2.4, 61.5, 2.4], // the square: the gate to the east houses
  [45.3, -17, 48.9, 15], // the square: the stairs to the south row
  [29, 41.5, 71, 46.8], // the south-east street
];
const paved = (x, z) => PAVED.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
/** The backdrop town's ground east of the rim (terraces rising eastward, a mountain wall at the heightfield's edge). */
export const CITY_Y = (x, z) => 2.5 + Math.floor(Math.min(Math.max(0, x - 76), 27) / 9) * 1.6 + fbm(x * 0.1, z * 0.1, 2, 47) * 0.15 + Math.max(0, x - 103) ** 1.5 * 0.42;
const LEDGE_Y = 5; // first cliff ledge
const RIDGE_Y = 11; // the ridge overlooking the arena

// ------------------------------------------------------------------ river geometry

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Dense polyline of the river centreline. */
export function riverLine(stepT = 0.05) {
  const pts = [];
  const P = RIVER;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let t = 0; t < 1 - 1e-9; t += stepT) pts.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
  }
  pts.push(P[P.length - 1].slice());
  return pts;
}
const LINE = riverLine(0.04);

/** Distance from (x, z) to the river centreline and the nearest point's index. */
export function riverDist(x, z) {
  let best = Infinity, bi = 0;
  for (let i = 0; i < LINE.length - 1; i++) {
    const [ax, az] = LINE[i], [bx, bz] = LINE[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - x, pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return { d: Math.sqrt(best), i: bi };
}

/** River centre x at a given z (the river runs north -> south, so z is monotonic). */
export function riverX(z) {
  for (let i = 0; i < LINE.length - 1; i++) {
    const [ax, az] = LINE[i], [bx, bz] = LINE[i + 1];
    if (z >= az && z <= bz) return ax + ((bx - ax) * (z - az)) / (bz - az || 1);
  }
  return LINE[LINE.length - 1][0];
}

// ------------------------------------------------------------------ the stream and its two falls
// A stream rises at the foot of the north rim, crosses the ridge, drops off the ridge cliff (the upper fall) into a
// pool on the ledge, runs across the ledge and falls off the ledge cliff (the lower fall) into the river's pool.
// Its channel is carved into the heightfield (a shallow bed: you wade through it; the surface id is water: splashes,
// ripples), and the cliff blocks under both falls are notched down to the bed so the water pours over a lip.
// [x, z, half width]
export const STREAM = [[-9.5, -68.5, 1.5], [-9, -64, 1.8], [-8, -60.5, 2], [-8, -57, 2.2], [-8, -54.4, 3.4], [-7.4, -52.4, 2.6], [-5.6, -50.6, 2.4], [-4, -48.5, 3.2], [-4, -46, 3.4]];
export const FALLS = [
  { x0: -10.6, x1: -5.4, row: 'ridge' }, // the upper fall: ridge -> ledge pool
  { x0: -7.5, x1: -0.5, row: 'ledge' }, // the lower fall: ledge -> river (the old waterfall's place)
];
export const STREAM_DEPTH = 0.3; // the bed below the ledge / ridge level; the water stands 0.05 over it

/** Distance to the stream's centreline and its half width there (Infinity when far from it). */
export function streamAt(x, z) {
  if (z > -45 || z < -70 || x < -16 || x > 2) return { d: Infinity, hw: 0 };
  let best = Infinity, hw = 0;
  for (let i = 0; i < STREAM.length - 1; i++) {
    const [ax, az, ah] = STREAM[i], [bx, bz, bh] = STREAM[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) {
      best = d;
      hw = ah + (bh - ah) * t;
    }
  }
  return { d: best, hw };
}

// ------------------------------------------------------------------ terrain

function boxMask(x, z, r, soft) {
  const dx = Math.max(0, Math.abs(x - r.x) - r.hx), dz = Math.max(0, Math.abs(z - r.z) - r.hz);
  return 1 - smoothstep(0, soft, Math.sqrt(dx * dx + dz * dz));
}

/** Terrain height before the river is carved (plateaus meet their cliff boxes, which hide the steps). */
function baseHeight(x, z) {
  // rolling ground
  let h = fbm(x * 0.035, z * 0.035, 3, 11) * 1.1 + fbm(x * 0.12, z * 0.12, 2, 5) * 0.25;
  // forest mounds (west)
  const west = smoothstep(-6, -16, x) * (1 - smoothstep(16, 24, z));
  h += Math.max(0, fbm(x * 0.07 + 3, z * 0.07 - 7, 3, 23)) * 3.2 * west;
  // flat places: the village square and the training field
  h = h + (0.05 - h) * boxMask(x, z, PLAZA, 6);
  h = h + (0.02 - h) * boxMask(x, z, FIELD, 8) * 0.92;
  // village streets east of the river: gentle
  const east = smoothstep(14, 22, x);
  h = h + (0.1 - h) * east * 0.85;
  // north: the upper street terrace (village), the first cliff ledge and the ridge
  h = Math.max(h, -0.15); // no stray puddles: only the river dips below the water line
  if (x >= 26 && z < -27.5) h = TERRACE_Y + fbm(x * 0.2, z * 0.2, 2, 3) * 0.05;
  if (z < -47.5 && x < 26) h = LEDGE_Y + fbm(x * 0.08, z * 0.08, 2, 9) * 0.35;
  if (z < -57.5) h = RIDGE_Y + fbm(x * 0.06, z * 0.06, 2, 13) * 0.6;
  // the stream's bed across the ridge and the ledge (shallow, flat, with soft banks)
  if (z < -45.5 && z > -70 && x < 26) {
    const { d, hw } = streamAt(x, z);
    if (d < hw + 1.2) {
      const bed = (z < -57.5 ? RIDGE_Y : LEDGE_Y) - STREAM_DEPTH;
      h = bed + (h - bed) * smoothstep(hw - 0.5, hw + 1.2, d);
    }
  }
  // backdrop outside the playable area (never reached: the rim walls; drawn only): forested hills rising to rocky
  // mountains in the north, and east of the village the rest of the town on low terraces (src/world/backdrop.js puts
  // its skyline there) with a mountain wall at the heightfield's far edge
  const out = Math.max(Math.max(0, -x - 72), Math.max(0, x - 72), Math.max(0, -z - 70), Math.max(0, z - 72));
  if (out > 0) {
    const ridged = 1 - Math.abs(fbm(x * 0.03, z * 0.03, 4, 43));
    let hill = h + out * 0.8 + fbm(x * 0.05, z * 0.05, 3, 41) * out * 0.35;
    if (z < -70) hill += ridged * ridged * Math.max(0, -z - 74) * 0.55; // the north: sharper, higher peaks
    const town = CITY_Y(x, z);
    const w = smoothstep(73, 79, x) * (1 - smoothstep(58, 74, Math.abs(z - 2)));
    h = hill + (town - hill) * w;
  }
  return h;
}

function heightAt(x, z) {
  let h = baseHeight(x, z);
  // river bed and banks (only below the ledge; the waterfall falls from the ledge into a pool)
  if (z > -47) {
    const { d } = riverDist(x, z);
    const hw = RIVER_HW + (z < -38 ? 2.5 * (1 - smoothstep(-44, -38, z)) : 0); // the pool under the waterfall is wider
    if (d < hw + 4) {
      const bed = -1.5 + smoothstep(0, hw, d) * 0.9; // -1.5 in the middle, -0.6 at the water's edge
      const bank = smoothstep(hw - 0.5, hw + 4, d);
      h = bed + (h - bed) * bank;
    }
  }
  return h;
}

function surfAt(x, z, h) {
  if (h < WATER_Y) return SURF.water;
  if (paved(x, z)) return SURF.stone;
  if (z < -45.5 && z > -70) {
    const { d, hw } = streamAt(x, z);
    if (d < hw - 0.35) return SURF.water;
  }
  if (boxMask(x, z, PLAZA, 0.01) > 0.5 || (x > 18 && h < 1)) return SURF.dirt;
  if (h > LEDGE_Y - 0.5 && z < -47) return SURF.grass;
  return SURF.grass;
}

// ------------------------------------------------------------------ build

/**
 * Builds the arena. Returns { world: CollisionWorld, props: [...], spawns: [{ p, yaw }], dummy, hf }.
 * props: descriptors for the client (src/world/): { t: 'tree' | 'house' | 'rock' | 'fence' | ..., ... }.
 */
export function buildMap(seed = MAP_SEED) {
  const rng = mulberry32(seed);
  const hf = { ...HF, h: new Float32Array(HF.nx * HF.nz), surf: new Uint8Array(HF.nx * HF.nz) };
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const x = hf.x0 + i * hf.cell, z = hf.z0 + j * hf.cell;
      const h = heightAt(x, z);
      hf.h[j * hf.nx + i] = h;
      hf.surf[j * hf.nx + i] = surfAt(x, z, h);
    }
  }
  const shapes = [];
  const props = [];
  const tmp = new CollisionWorld({ hf, shapes: [], waterY: WATER_Y, bounds: BOUNDS });
  const gy = (x, z) => tmp.terrain(x, z);
  const add = (s) => (shapes.push(s), s);
  // a box whose local +x axis points along (dx, dz) (unit): no trig, so every engine agrees
  const boxDir = (x, z, hx, hz, y0, y1, dx, dz, o = {}) => {
    const s = box(x, z, hx, hz, y0, y1, 0, o);
    s.c = dx;
    s.s = dz;
    s.yaw = null;
    return s;
  };
  const dirOf = (a) => [dcos(a), dsin(a)];

  // ---------------------------------------------------------------- north: cliffs, ledge, ridge, boundary
  // cliff faces are rows of rock blocks (climbable) standing on the step in the heightfield, so the player only
  // ever touches rock, never the steep terrain behind it
  const notches = [];
  const cliffRow = (z0, x0, x1, yTop, depth, yBase, notch = null) => {
    let x = x0;
    while (x < x1) {
      const w = Math.min(x1 - x, rng.range(4, 8));
      // the face stands 0.5-1.3 m south of the step so the block covers the whole 1 m terrain ramp behind it
      const face = z0 + 0.5 + rng.range(0, 0.8);
      const d = depth + rng.range(0, 1.2);
      const top = yTop + rng.range(-0.05, 0.02);
      // a block overlapping a fall's notch is split: the part under the water is cut down to the stream's bed (the
      // same random draws as an unsplit row: nothing else on the map moves)
      const e0 = x - 0.3, e1 = x + w + 0.3;
      const pieces = [];
      if (notch && e1 > notch.x0 && e0 < notch.x1) {
        if (e0 < notch.x0) pieces.push([e0, notch.x0, top, false]);
        pieces.push([Math.max(e0, notch.x0), Math.min(e1, notch.x1), yTop - STREAM_DEPTH + 0.02, true]);
        if (e1 > notch.x1) pieces.push([notch.x1, e1, top, false]);
      } else pieces.push([e0, e1, top, false]);
      const seed = rng.int(0, 1e6);
      for (const [a, b, t, cut] of pieces) {
        const s = add(box((a + b) / 2, face - d / 2, (b - a) / 2, d / 2, yBase - 2, t, 0, { surf: SURF.rock }));
        props.push({ t: 'cliff', s: { x: s.x, z: s.z, hx: s.hx, hz: s.hz, y0: yBase - 2, y1: t }, seed, notch: cut || undefined });
        if (cut) notches.push({ row: notch.row, x0: a, x1: b, face, back: face - d, top: t });
      }
      x += w;
    }
  };
  cliffRow(-47.5, -72, 26, LEDGE_Y, 2.2, 0, FALLS[1]);
  cliffRow(-57.5, -72, 26, RIDGE_Y, 2.4, LEDGE_Y, FALLS[0]);
  cliffRow(-57.5, 26, 72, RIDGE_Y, 2.4, TERRACE_Y); // behind the upper street
  // the upper street's retaining wall (plaza level -> terrace), with a gap for the stone stairs. The stairs fill the
  // whole slot between the ramen shop (east wall x 44.5) and the next house (west wall x 49.75): steps in the middle,
  // a stone balustrade on each side (no dead-end gaps beside them)
  const SLOT = [44.5, 49.75], STAIR_W = 3.6, STAIR_X = (SLOT[0] + SLOT[1]) / 2;
  for (const [a, b] of [[26, STAIR_X - STAIR_W / 2], [STAIR_X + STAIR_W / 2, 72]]) {
    const s = add(box((a + b) / 2, -26.9, (b - a) / 2, 1.4, -1.5, TERRACE_Y, 0, { surf: SURF.stone }));
    props.push({ t: 'wall', kind: 'retain', s: { x: s.x, z: s.z, hx: s.hx, hz: s.hz, y0: -0.5, y1: TERRACE_Y } });
  }
  // the terrace's west edge (x = 26): a rock step over the terrain ramp, from the retaining wall to the ridge
  add(box(25.6, -42.5, 0.8, 15, -1, TERRACE_Y + 0.4, 0, { surf: SURF.rock }));
  props.push({ t: 'cliff', s: { x: 25.6, z: -42.5, hx: 0.8, hz: 15, y0: -1, y1: TERRACE_Y + 0.4 }, seed: 11 });
  // boundary walls of rock around everything (tall: you can climb them but the top is out of bounds and clamped)
  const rim = (x0, z0, x1, z1, h) => {
    const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    const n = Math.ceil(len / 7);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const cx = x0 + (x1 - x0) * (t0 + t1) / 2, cz = z0 + (z1 - z0) * (t0 + t1) / 2;
      const top = h + rng.range(-1.5, 2);
      const s = add(boxDir(cx, cz, len / n / 2 + 0.4, 2, -2, top, dx, dz, { surf: SURF.rock }));
      props.push({ t: 'cliff', s: { x: s.x, z: s.z, hx: s.hx, hz: s.hz, c: dx, s2: dz, y0: -2, y1: top }, seed: rng.int(0, 1e6), rim: true });
    }
  };
  rim(-72, -70, 72, -70, RIDGE_Y + 12); // north
  rim(-73, -70, -73, 72, 16); // west (behind the forest)
  rim(-73, 73, 72, 73, 12); // south
  rim(73, -70, 73, 73, 14); // east (behind the village)

  // ---------------------------------------------------------------- village (east)
  const houses = [];
  const house = (x, z, w, d, floors, faceDir, o = {}) => {
    // faceDir: which way the front (door, awning) faces: 'n' | 's' | 'e' | 'w'
    const [fx, fz] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[faceDir];
    const base = o.base ?? Math.min(gy(x - w / 2, z - d / 2), gy(x + w / 2, z + d / 2), gy(x, z));
    const eave = base + floors * 3.1 + 0.4;
    const rise = Math.min(w, d) * 0.28;
    // local +x runs along the front (ridge parallel to the street), local +z points out of the front
    const lx = [fz, -fx]; // local +x along the front, so local +z = the front direction
    const along = faceDir === 'n' || faceDir === 's';
    const W = along ? w : d, D = along ? d : w; // W = frontage, D = depth
    const body = add(boxDir(x, z, W / 2, D / 2, base - 1, eave, lx[0], lx[1], { surf: SURF.plaster }));
    // gable roof: two slopes meeting at the ridge (over the middle of the depth), 0.5 m eaves overhang
    const oh = 0.5, half = D / 2 + oh, rz = half / 2;
    for (const sgn of [1, -1]) {
      // centre of this slope in local z = sgn * rz; top falls from the ridge (local z 0) to the eave
      const cx = x + fx * sgn * rz, cz = z + fz * sgn * rz;
      add(boxDir(cx, cz, W / 2 + oh, rz, eave - 0.25, eave + rise / 2, lx[0], lx[1], { sz: -sgn * (rise / half), surf: SURF.roof, climb: false }));
    }
    const h = { t: 'house', x, z, W, D, lx, face: [fx, fz], base, eave, rise, floors, oh, ...o };
    houses.push(h);
    props.push(h);
    return body;
  };
  // plaza north row (backs against the terrace wall), with the stairs gap at STAIR_X
  house(33, -21.5, 8.5, 9, 2, 's', { awning: 'red', variant: 0 });
  house(41.2, -21.5, 6.6, 9, 2, 's', { awning: 'yellow', shop: 'ramen', variant: 1 });
  house(54.5, -21.5, 9.5, 9, 3, 's', { awning: 'red', variant: 2 });
  house(64.5, -21.5, 8, 9, 2, 's', { awning: null, variant: 3 });
  // plaza south row
  house(31, 19.5, 8, 9, 2, 'n', { awning: 'yellow', variant: 4 });
  house(40.5, 19.5, 8.5, 9, 3, 'n', { awning: 'red', variant: 5 });
  house(51, 19.5, 9, 9, 2, 'n', { awning: 'yellow', variant: 6 });
  house(61.5, 19.5, 8, 9, 2, 'n', { awning: 'red', variant: 7 });
  // plaza east side
  house(66, -5, 9, 12, 3, 'w', { awning: 'red', variant: 8 });
  house(66, 8, 9, 8, 2, 'w', { awning: null, variant: 9 });
  // upper street (terrace, y = 4): a row facing south onto it, against the ridge cliff
  house(36, -41.5, 9, 8, 2, 's', { base: TERRACE_Y, awning: 'yellow', variant: 10 });
  house(46.5, -41.5, 8, 8, 2, 's', { base: TERRACE_Y, awning: 'red', variant: 11 });
  house(57, -41.5, 9.5, 8, 3, 's', { base: TERRACE_Y, awning: null, variant: 12 });
  house(67, -41.5, 7, 8, 2, 's', { base: TERRACE_Y, awning: 'yellow', variant: 13 });
  // south-east outskirts
  house(36, 34, 9, 8, 2, 'n', { awning: null, variant: 14 });
  house(56, 36, 10, 9, 2, 'w', { awning: 'red', variant: 15 });
  // stone stairs: plaza (y 0) -> terrace (y 4) between the ramen shop and the next house. The drawn steps stand on
  // ONE smooth ramp collider (through the middle of every tread, so feet are within half a step of the stone): a
  // collider per step made the fighter step up a 0.3 m ledge every half metre and shake all the way up.
  {
    const n = 16, z0 = -17.2, zTop = -25.5; // bottom step's front edge; the retaining wall's face
    const rise = TERRACE_Y / n, run = (z0 - zTop) / n;
    const rampY = (z) => rise * (0.5 + (z0 - z) / run);
    const zr1 = z0 - (n - 0.5) * run; // the last tread's middle: the ramp ends at the terrace's height there
    const slope = rise / run;
    add(box(STAIR_X, (z0 + zr1) / 2, STAIR_W / 2, (z0 - zr1) / 2, -1, rampY((z0 + zr1) / 2), 0, { sz: -slope, surf: SURF.stone, climb: false }));
    // the landing: from the last tread over the terrace's edge (the heightfield's 1 m ramp hides under it)
    const zl = -28.8;
    add(box(STAIR_X, (zr1 + zl) / 2, STAIR_W / 2, (zr1 - zl) / 2, -1, TERRACE_Y, 0, { surf: SURF.stone, climb: false }));
    // balustrades: a newel post at the foot, a wall whose top follows the steps 0.95 m above them, a post at the top
    const cheeks = [];
    const H = 0.95, nb = z0 + 0.35, nt = zTop - 0.4;
    for (const [a, b] of [[SLOT[0], STAIR_X - STAIR_W / 2], [STAIR_X + STAIR_W / 2, SLOT[1]]]) {
      const cx = (a + b) / 2, hx = (b - a) / 2;
      const post = (za, zb, top) => {
        const s = add(box(cx, (za + zb) / 2, hx, (za - zb) / 2, -1, top, 0, { surf: SURF.stone, climb: false }));
        cheeks.push({ x: cx, z: s.z, hx, hz: s.hz, y1: top, sz: 0, post: true });
      };
      post(nb + 0.75, nb, rampY(nb) + H + 0.2);
      const zc = (nb + nt) / 2;
      const s = add(box(cx, zc, hx, (nb - nt) / 2, -1, rampY(zc) + H, 0, { sz: -slope, surf: SURF.stone, climb: false }));
      cheeks.push({ x: cx, z: zc, hx, hz: s.hz, y1: s.y1, sz: -slope });
      post(nt, nt - 0.8, rampY(nt) + H + 0.2);
    }
    props.push({ t: 'stairs', x: STAIR_X, w: STAIR_W, z0, n, rise, run, top: TERRACE_Y, landing: [zr1, zl], cheeks });
  }
  // plaza props with colliders: crates, a well, a notice board
  const crate = (x, z, s, yaw) => {
    const y = gy(x, z);
    add(box(x, z, s / 2, s / 2, y - 0.2, y + s, yaw, { surf: SURF.wood, climb: false }));
    props.push({ t: 'crate', x, z, y, s, yaw });
  };
  crate(29.5, -15, 1.1, 0.2);
  crate(30.7, -15.3, 0.9, -0.3);
  crate(30, -14.9, 0.8, 0.5);
  crate(58.5, 13.5, 1.2, 0.1);
  crate(59.6, 13.1, 0.9, 0.7);
  {
    const x = 44, z = 2, y = gy(x, z);
    add(cyl(x, z, 1.25, y - 0.5, y + 0.9, { surf: SURF.stone, climb: false }));
    props.push({ t: 'well', x, z, y });
  }
  // the village edge toward the river: a low wall with a gate at the bridge
  for (const [a, b] of [[-38, -4], [4, 30]]) {
    const s = add(box(19, (a + b) / 2, 0.35, (b - a) / 2, -1, gy(19, (a + b) / 2) + 1.3, 0, { surf: SURF.plaster, climb: false }));
    props.push({ t: 'wall', kind: 'low', s: { x: s.x, z: s.z, hx: s.hx, hz: s.hz, y0: s.y0, y1: s.y1 } });
  }

  // ---------------------------------------------------------------- river: bridge, stepping stones, waterfall
  {
    const bz = 0, bx = riverX(bz);
    const len = RIVER_HW * 2 + 5, y = 0.75;
    // deck + ramps at both ends
    add(box(bx, bz, len / 2, 1.6, y - 0.35, y, 0, { surf: SURF.wood, climb: false }));
    for (const sgn of [-1, 1]) {
      const ex = bx + sgn * (len / 2 + 1.4);
      const g = gy(ex, bz);
      add(box(ex, bz, 1.4, 1.6, g - 0.6, (y + g) / 2, 0, { sx: -sgn * ((y - g) / 2.8), surf: SURF.wood, climb: false }));
    }
    props.push({ t: 'bridge', x: bx, z: bz, len, y, w: 3.2 });
    // stepping stones further south
    for (let i = 0; i < 6; i++) {
      const z = 26 + i * 0.35 + rng.range(-0.3, 0.3);
      const t = (i + 0.5) / 6;
      const x = riverX(z) - RIVER_HW - 0.2 + t * (RIVER_HW * 2 + 0.4);
      const r = rng.range(0.55, 0.75);
      add(cyl(x, z, r, -1.8, WATER_Y + rng.range(0.18, 0.3), { surf: SURF.stone, climb: false }));
      props.push({ t: 'stone', x, z, r, top: shapes[shapes.length - 1].y1 });
    }
    // the falls: over the notched blocks' faces (their front edge: the most southern notch face of the row)
    for (const F of FALLS) {
      const ns = notches.filter((n) => n.row === F.row);
      const face = Math.max(...ns.map((n) => n.face));
      const upper = F.row === 'ridge';
      props.push({ t: 'waterfall', x: (F.x0 + F.x1) / 2, z: face, w: F.x1 - F.x0 - 0.6, top: (upper ? RIDGE_Y : LEDGE_Y) - STREAM_DEPTH + 0.05, bottom: upper ? LEDGE_Y - STREAM_DEPTH + 0.05 : WATER_Y, upper });
    }
    props.push({ t: 'stream', pts: STREAM, ridge: RIDGE_Y - STREAM_DEPTH + 0.05, ledge: LEDGE_Y - STREAM_DEPTH + 0.05, split: -57.5 + 0.5 });
    props.push({ t: 'river', line: riverLine(0.05), hw: RIVER_HW, y: WATER_Y });
  }

  // ---------------------------------------------------------------- forest (west): giant trees with branches
  // A tree: a trunk cone (r at the ground, narrowing to 0.72 r inside the canopy), a root-flare cone round its foot
  // (the buttress roots are drawn inside it: nothing drawn stands outside a collider, so neither the fighter nor the
  // camera ends up inside the wood), 2-3 branches (tapering, rising a little outward; two sloped boxes each whose tops
  // are the drawn bark's top) and a crown on top of the canopy you can stand on (run up the trunk into it). Branches
  // are aimed clear of other trees, walls and the map edge (they used to run into neighbouring trunks and cliffs).
  const trees = [];
  const FOREST = [
    [-52, -30, 2.6], [-36, -36, 2.2], [-20, -30, 1.8], [-58, -8, 2.9], [-40, -14, 2.0],
    [-24, -12, 2.4], [-48, 10, 2.2], [-31, 4, 1.7], [-15, 8, 1.6], [-62, 20, 2.5],
    [-66, -42, 2.8], [-10, -36, 1.6], [-44, -42, 1.9],
  ];
  const spots = FOREST.map(([x, z, r]) => [x + rng.range(-1.5, 1.5), z + rng.range(-1.5, 1.5), r]);
  // trees round the training field and along the south edge, and on the east bank near the bridge
  spots.push([-56, 40, 2.3], [-54, 62, 2.6], [-8, 64, 2.0], [-40, 66, 1.9], [20, 62, 2.2], [14, 46, 1.7], [-60, 54, 1.8], [13, -18, 1.7], [12, 22, 1.6]);
  const pre = new CollisionWorld({ hf, shapes: shapes.slice(), waterY: WATER_Y, bounds: BOUNDS }); // everything so far
  const placed = []; // accepted branches as 2D segments { ax, az, bx, bz, y, tree }
  const segDist = (a, b) => {
    // closest distance between two 2D segments (a sampled against b: plenty to keep branches apart)
    let best = Infinity;
    const dx = b.bx - b.ax, dz = b.bz - b.az, l2 = dx * dx + dz * dz;
    for (let i = 0; i <= 8; i++) {
      const px = a.ax + ((a.bx - a.ax) * i) / 8, pz = a.az + ((a.bz - a.az) * i) / 8;
      let t = ((px - b.ax) * dx + (pz - b.az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = b.ax + dx * t - px, ez = b.az + dz * t - pz;
      best = Math.min(best, ex * ex + ez * ez);
    }
    return Math.sqrt(best);
  };
  const treeAt = (ti, x, z, r) => {
    const g = gy(x, z);
    const h = rng.range(15, 19);
    const crown = g + h + 4.5; // standing on top of the canopy
    const cy = crown - 1.3; // the trunk ends under the crown's floor
    const rTop = r * 0.72;
    const rAt = (y) => r + ((rTop - r) * (y - g)) / (cy - g);
    const trunk = [g - 2, rAt(g - 2), cy, rTop];
    const FH = 2.6; // the flare meets the trunk this far up; 1.6 r wide at the ground
    const fk = (r * 1.6 - rAt(g + FH)) / FH;
    const flare = [g - 1.5, r * 1.6 + fk * 1.5, g + FH, rAt(g + FH)];
    add(cyl(x, z, trunk[1], trunk[0], trunk[2], { r1: trunk[3], surf: SURF.bark }));
    add(cyl(x, z, flare[1], flare[0], flare[2], { r1: flare[3], surf: SURF.bark, wallTop: cy }));
    const cr = 2.2 + r * 0.35;
    add(cyl(x, z, cr, crown - 1.3, crown, { surf: SURF.grass, climb: false }));
    const branches = [];
    const nb = rng.int(2, 3);
    let a = rng.range(0, 6.283);
    for (let i = 0; i < nb; i++) {
      a += 6.283 / nb + rng.range(-0.5, 0.5);
      const y = g + rng.range(6.5, 11) + i * 0.4;
      let len = rng.range(5, 7.5);
      const w = rng.range(1.5, 2), rise = rng.range(0.35, 0.8);
      const rb = rAt(y);
      let pick = null;
      for (let round = 0; round < 3 && !pick; round++, len -= 0.8) {
        for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35]) {
          const [dx, dz] = dirOf(a + off);
          const reach = rb + len + 1.8; // the drawn tip and its leaves go past the walkable part
          const seg = { ax: x + dx * rb, az: z + dz * rb, bx: x + dx * reach, bz: z + dz * reach, y, tree: ti };
          let ok = true;
          for (const k of [0.35, 0.7, 1]) {
            const px = x + dx * (rb + (reach - rb) * k), pz = z + dz * (rb + (reach - rb) * k);
            if (px < BOUNDS.minX + 1 || px > BOUNDS.maxX - 1 || pz < BOUNDS.minZ + 1 || pz > BOUNDS.maxZ - 1) ok = false;
            for (const [ox, oz, or] of spots) {
              if (ox === x && oz === z) continue;
              const ex = px - ox, ez = pz - oz;
              if (ex * ex + ez * ez < (or * 1.1 + 1.4) * (or * 1.1 + 1.4)) ok = false;
            }
            for (const sh of pre.near(px, pz, 0.8)) if (sh.y0 < y + 2.5 && sh.ytop > y - 1.5 && pre.topAt(sh, px, pz, 0.6) !== -Infinity) ok = false;
            if (!ok) break;
          }
          if (ok) for (const o of placed) if (o.tree !== ti && Math.abs(o.y - y) < 3 && segDist(seg, o) < 1.6) ok = false;
          if (ok) {
            pick = { dx, dz, seg };
            break;
          }
        }
      }
      if (!pick) continue;
      const { dx, dz } = pick;
      placed.push(pick.seg);
      // two boxes from the trunk's surface: [-0.5, len/2] and [len/2, len]; the drawn limb tapers from w to w/2
      const rad = (s) => (w / 2) * (1 - 0.5 * Math.max(0, Math.min(1, s / len)));
      const top = (s) => y + (rise * s) / len;
      for (const [s0, s1] of [[-0.5, len / 2], [len / 2, len]]) {
        const sc = (s0 + s1) / 2;
        add(boxDir(x + dx * (rb + sc), z + dz * (rb + sc), (s1 - s0) / 2, rad(sc) * 0.72, top(s0) - rad(s0) * 1.8, top(sc), dx, dz, { sx: rise / len, surf: SURF.bark, climb: false }));
      }
      branches.push({ dx, dz, y, len, w, rise, rb });
    }
    const t = { t: 'tree', x, z, r, g, top: cy, crown, cr, trunk, flare, branches, seed: rng.int(0, 1e6) };
    trees.push(t);
    props.push(t);
  };
  spots.forEach(([x, z, r], i) => treeAt(i, x, z, r));
  // fallen logs (walkable, low)
  for (const [x, z, a, len] of [[-30, -22, 0.4, 9], [-46, -2, 1.9, 8], [-16, -18, 2.6, 7], [-38, 22, 0.9, 8]]) {
    const [dx, dz] = dirOf(a);
    const g = gy(x, z), rr = 0.55;
    add(boxDir(x, z, len / 2, rr * 0.9, g - 0.3, g + rr * 1.6, dx, dz, { surf: SURF.bark, climb: false }));
    props.push({ t: 'log', x, z, dx, dz, len, r: rr, y: g + rr * 0.8 });
  }
  // rock outcrops
  for (const [x, z, s] of [[-28, -40, 3], [-60, 2, 2.4], [-12, -24, 1.8], [-50, 28, 2.6], [8, -38, 2.2], [-2, 44, 1.6]]) {
    const g = gy(x, z);
    const h = s * rng.range(0.8, 1.3);
    const a = rng.range(0, 3.14);
    const [dx, dz] = dirOf(a);
    add(boxDir(x, z, s * 0.75, s * 0.55, g - 1, g + h, dx, dz, { surf: SURF.rock }));
    props.push({ t: 'rock', x, z, s, h, g, dx, dz, seed: rng.int(0, 1e6) });
  }
  // rusty chain-link fences (block, not climbable; you jump them)
  const fence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, g = gy(cx, cz);
    add(boxDir(cx, cz, len / 2, 0.08, g - 0.5, g + 2.4, dx, dz, { surf: SURF.metal, climb: false }));
    props.push({ t: 'fence', x0, z0, x1, z1, h: 2.4 });
  };
  fence(-68, -24, -56, -18);
  fence(-34, -46, -22, -45);
  fence(-66, 30, -56, 32);

  // ---------------------------------------------------------------- training field (south-west)
  const posts = [[-30, 36], [-26, 36], [-22, 36]];
  for (const [x, z] of posts) {
    const g = gy(x, z);
    add(cyl(x, z, 0.24, g - 0.5, g + 1.7, { surf: SURF.wood, climb: false }));
    props.push({ t: 'post', x, z, g });
  }
  {
    const x = -38, z = 48, g = gy(x, z);
    add(box(x, z, 1.4, 0.5, g - 0.5, g + 2.6, 0.3, { surf: SURF.stone, climb: false }));
    props.push({ t: 'memorial', x, z, g, yaw: 0.3 });
  }
  props.push({ t: 'target', tree: trees.findIndex((t) => Math.hypot(t.x + 56, t.z - 40) < 1), y: 2.2 });

  // ---------------------------------------------------------------- the south-east street, the gate, props
  // Added after everything above and with its own random stream, so nothing placed before moves. The training field
  // (x -52..-14, z 20..62: the tests' lanes) stays clear.
  const rp = mulberry32(seed ^ 0x2b7e1516);
  // flat-roofed blocks and a round tower: walkable roofs behind a parapet, a water tank and a stair hut on top
  const block = (x, z, w, d, floors, faceDir, variant, o = {}) => {
    const base = Math.min(gy(x - w / 2, z - d / 2), gy(x + w / 2, z + d / 2), gy(x, z), gy(x - w / 2, z + d / 2), gy(x + w / 2, z - d / 2));
    const top = base + floors * 3.1 + 0.3;
    const [fx, fz] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[faceDir];
    add(box(x, z, w / 2, d / 2, base - 1, top, 0, { surf: SURF.plaster }));
    const P = 0.7, T = 0.25; // parapet height, thickness
    const parapets = [
      { x, z: z - d / 2 + T / 2, hx: w / 2, hz: T / 2, h: P }, { x, z: z + d / 2 - T / 2, hx: w / 2, hz: T / 2, h: P },
      { x: x - w / 2 + T / 2, z, hx: T / 2, hz: d / 2 - T, h: P }, { x: x + w / 2 - T / 2, z, hx: T / 2, hz: d / 2 - T, h: P },
    ];
    for (const pp of parapets) add(box(pp.x, pp.z, pp.hx, pp.hz, top - 0.1, top + P, 0, { surf: SURF.stone, climb: false }));
    const tank = o.tank ? { x: x + o.tank[0], z: z + o.tank[1], y0: top, r: 1.1, h: 1.8, legs: 1.1 } : null;
    if (tank) add(cyl(tank.x, tank.z, tank.r, top - 0.1, top + tank.legs + tank.h + 0.3, { surf: SURF.metal, climb: false }));
    const hut = o.hut ? { x: x + o.hut[0], z: z + o.hut[1], y0: top, hx: 1.3, hz: 1.1, h: 2.4 } : null;
    if (hut) add(box(hut.x, hut.z, hut.hx, hut.hz, top - 0.1, top + hut.h, 0, { surf: SURF.plaster }));
    const ns = faceDir === 'n' || faceDir === 's';
    props.push({ t: 'block', x, z, w, d, yaw: 0, base, top, floors, variant, parapets, tank, hut, face: [fx, fz], lx: ns ? [1, 0] : [0, 1], fd: ns ? d / 2 : w / 2, fw: ns ? w : d, sign: o.sign });
  };
  const tower = (x, z, r, floors, variant) => {
    const base = gy(x, z) - 0.2, top = base + floors * 3.1;
    add(cyl(x, z, r, base - 1, top, { surf: SURF.plaster }));
    // the parapet ring as a ring of short boxes (standing on the roof's edge)
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * 6.283185307179586;
      const [c, sn] = [dcos(a), dsin(a)];
      add(boxDir(x + c * (r - 0.12), z + sn * (r - 0.12), 0.24, (r * 3.1416) / 14 + 0.05, top - 0.1, top + 0.8, c, sn, { surf: SURF.stone, climb: false }));
    }
    const tank = { x: x + 1.2, z: z - 0.8, y0: top, r: 1.0, h: 1.7, legs: 1.0 };
    add(cyl(tank.x, tank.z, tank.r, top - 0.1, top + tank.legs + tank.h + 0.3, { surf: SURF.metal, climb: false }));
    props.push({ t: 'block', round: true, x, z, r, base, top, floors, variant, tank });
  };
  block(38, 52, 12, 9, 4, 'n', 1, { tank: [3.2, 1.5], hut: [-3.5, 1.8], sign: 6 });
  tower(52, 55, 4.5, 6, 2);
  block(64, 52, 9, 12, 3, 'w', 3, { tank: [1.5, -3], sign: 9 });
  house(40, 64.5, 10, 7.5, 2, 'n', { awning: 'yellow', variant: 16 });
  house(60.5, 65.5, 9, 7, 2, 'n', { awning: 'red', variant: 17 });

  // the village gate: a red torii where the path from the bridge comes through the low wall (you can stand on its
  // top beam), with stone lanterns either side
  {
    const x = 21, g = gy(x, 0), H = 5.2, half = 3.2;
    for (const sz of [-1, 1]) add(cyl(x, sz * half, 0.3, g - 0.5, g + H, { surf: SURF.wood, climb: true }));
    add(box(x, 0, 0.35, 4.4, g + H, g + H + 0.45, 0, { surf: SURF.wood, climb: false })); // kasagi (top beam)
    add(box(x, 0, 0.2, half + 0.3, g + H - 1.15, g + H - 0.9, 0, { surf: SURF.wood, climb: false })); // nuki (tie beam)
    props.push({ t: 'torii', x, z: 0, g, H, half, big: true });
  }

  // small props, each with its collider (kind picks the art in src/world/props.js)
  const prop = (kind, x, z, o = {}) => {
    const g = gy(x, z), yaw = o.yaw ?? rp() * 6.283;
    const p = { t: 'prop', kind, x, z, g, yaw, ...o };
    if (kind === 'barrel') add(cyl(x, z, 0.42, g - 0.3, g + 1.0, { surf: SURF.wood, climb: false }));
    else if (kind === 'lantern') add(cyl(x, z, 0.42, g - 0.3, g + 2.1, { surf: SURF.stone, climb: false }));
    else if (kind === 'bench') add(box(x, z, 0.95, 0.24, g - 0.3, g + 0.48, yaw, { surf: SURF.wood, climb: false }));
    else if (kind === 'cart') add(box(x, z, 1.15, 0.7, g - 0.3, g + 1.05, yaw, { surf: SURF.wood, climb: false }));
    else if (kind === 'stall') add(box(x, z, 0.85, 0.45, g - 0.3, g + 0.9, yaw, { surf: SURF.wood, climb: false }));
    else if (kind === 'pole') add(cyl(x, z, 0.16, g - 0.5, g + 7.5, { surf: SURF.wood, climb: false }));
    else if (kind === 'banner') add(cyl(x, z, 0.07, g - 0.3, g + 4.2, { surf: SURF.wood, climb: false }));
    else if (kind === 'stump') add(cyl(x, z, 0.62, g - 0.4, g + 0.7, { surf: SURF.bark, climb: false }));
    else if (kind === 'dummy') add(cyl(x, z, 0.24, g - 0.3, g + 1.75, { surf: SURF.wood, climb: false }));
    else if (kind === 'targetStand') add(box(x, z, 0.65, 0.15, g - 0.3, g + 1.9, yaw, { surf: SURF.wood, climb: false }));
    else if (kind === 'logpile') add(box(x, z, 1.4, 0.8, g - 0.3, g + 1.0, yaw, { surf: SURF.bark, climb: false }));
    else if (kind === 'rack') add(box(x, z, 0.9, 0.2, g - 0.3, g + 1.7, yaw, { surf: SURF.wood, climb: false }));
    else if (kind === 'sakura') add(cyl(x, z, 0.32, g - 0.5, g + 3.2, { r1: 0.24, surf: SURF.bark, climb: false }));
    else if (kind === 'bamboo') add(cyl(x, z, 0.9, g - 0.5, g + 3.0, { surf: SURF.wood, climb: false }));
    else if (kind === 'boulder') add(cyl(x, z, o.r, g - 1, g + o.h, { surf: SURF.rock, climb: true }));
    else if (kind === 'shrine') add(box(x, z, 0.85, 0.75, g - 0.3, g + 2.3, yaw, { surf: SURF.wood }));
    props.push(p);
  };
  // village square: the gate's lanterns, a cart and barrels by the shops, benches, a tea stall, banners, a cherry tree
  for (const sz of [-1, 1]) prop('lantern', 23.2, sz * 5.4, { yaw: 0 });
  prop('cart', 34.5, -13.2, { yaw: 0.15 });
  for (const [x, z] of [[38.6, -15.6], [39.5, -15.9], [52.6, 13.3], [53.5, 13.7], [62.6, -9.2], [48.2, -15.7]]) prop('barrel', x, z);
  prop('bench', 47.2, -11.8, { yaw: 0 });
  prop('bench', 35.5, 11.2, { yaw: 0 });
  prop('bench', 60.2, 2.5, { yaw: Math.PI / 2 });
  prop('stall', 50.5, 5.5, { yaw: 0.1 });
  prop('sakura', 53, -5.5);
  for (const [x, z, c, yaw] of [[28.2, -10, 0, 1.5708], [28.2, 9, 1, 1.5708], [61.2, -13.5, 2, 1.5708], [61.2, 11.5, 3, 1.5708], [42, -15.8, 1, 0]]) prop('banner', x, z, { color: c, yaw });
  // utility poles along the square's edges, wires strung between them (drawn only)
  const poles = [[26.2, -15.5], [26.2, 14.5], [41.8, 15.2], [60.8, 15.8], [63.2, -15], [44, -16.2]];
  for (const [x, z] of poles) prop('pole', x, z, { yaw: 0 });
  props.push({ t: 'wires', poles: [[0, 1], [1, 2], [2, 3], [4, 5], [5, 0]].map(([a, b]) => [poles[a], poles[b]]) });
  // the upper street
  prop('barrel', 40.2, -35.4);
  prop('barrel', 41, -35.1);
  prop('bench', 52, -35.8, { yaw: 0 });
  prop('lantern', 31.5, -33.5, { yaw: 0 });
  prop('lantern', 70, -33.5, { yaw: 0 });
  // the south-east street
  prop('sakura', 47.5, 44.5);
  prop('bench', 45.5, 46.5, { yaw: 0 });
  prop('lantern', 30.5, 45.5, { yaw: 0 });
  prop('barrel', 58.5, 46.2);
  prop('barrel', 58.9, 47);
  prop('cart', 69, 42.5, { yaw: 1.4 });
  // cherry trees along the river's east bank
  prop('sakura', 14, -9);
  prop('sakura', 15.5, 12);
  prop('sakura', 11, 32);
  // the forest: a small shrine with its torii, stumps, more boulders
  {
    const x = -45, z = -27;
    prop('shrine', x, z, { yaw: 0 });
    const g = gy(x, z + 3.2);
    for (const sx of [-1, 1]) add(cyl(x + sx * 1.05, z + 3.2, 0.13, g - 0.3, g + 2.8, { surf: SURF.wood, climb: false }));
    add(box(x, z + 3.2, 1.55, 0.16, g + 2.8, g + 3.05, 0, { surf: SURF.wood, climb: false }));
    props.push({ t: 'torii', x, z: z + 3.2, g, H: 2.8, half: 1.05, along: 'x' });
    for (const sx of [-1, 1]) prop('lantern', x + sx * 1.9, z + 5.2, { yaw: 0, small: true });
  }
  for (const [x, z] of [[-34, -28.5], [-18.5, -4], [-55.5, 15.5], [-27, 14], [-62, -35]]) prop('stump', x, z);
  prop('boulder', -64, 6, { r: 1.5, h: 1.9 });
  prop('boulder', -22, -44.2, { r: 1.2, h: 1.3 });
  prop('boulder', -10.2, -40.2, { r: 1.1, h: 0.9 });
  prop('boulder', 3.2, -41.5, { r: 1.0, h: 0.8 });
  // the training field's east side: straw dummies, a target on a stand, a weapons rack, a log pile
  prop('dummy', -10, 30);
  prop('dummy', -8, 33.5);
  prop('dummy', -11.5, 36.5);
  prop('targetStand', -6, 55.5, { yaw: 2.6 });
  prop('targetStand', -10.5, 58.5, { yaw: 2.9 });
  prop('rack', -13.5, 42, { yaw: Math.PI / 2 });
  prop('logpile', -13, 62.5, { yaw: 0.3 });
  // bamboo along the south wall
  for (const [x, z] of [[6, 68.2], [-22, 68.8], [30, 69.5], [-62, 67.5], [8.5, 67]]) prop('bamboo', x, z);

  const world = new CollisionWorld({ hf, shapes, waterY: WATER_Y, bounds: BOUNDS });

  // spawn points spread over the zones; yaw 0 looks toward -z (north)
  const sp = (x, z, yaw) => {
    const g = world.ground(x, z, 30);
    return { p: [x, g.y, z], yaw };
  };
  const spawns = [
    sp(52, 10, 0.4), // village square
    sp(58, -33, -1.2), // upper street
    sp(-44, -22, -2.2), // forest
    sp(-22, 48, 2.6), // training field
    sp(-30, -52.5, 2.8), // cliff ledge
    sp(24, 42, -0.6), // south-east by the river
  ];
  const dummy = sp(-26, 40, Math.PI);
  return { world, hf, props, spawns, dummy, houses, trees, seed };
}

/** A tree's collider radius at height y (its trunk or root flare, whichever is wider): what the art must match. */
export function treeRadius(t, y) {
  const lin = ([y0, r0, y1, r1]) => r0 + (r1 - r0) * Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
  return y > t.flare[2] ? lin(t.trunk) : Math.max(lin(t.trunk), lin(t.flare));
}

// shape count of a built map, for a quick determinism check (client vs server)
export function mapHash(map) {
  let h = 0;
  for (const s of map.world.shapes) {
    const v = [s.x, s.z, s.y0, s.y1, s.k === BOX ? s.hx : s.r, s.k === BOX ? s.sx + s.sz : s.r1];
    for (const x of v) h = (Math.imul(h, 31) + Math.round(x * 1000)) | 0;
  }
  return (h >>> 0).toString(36) + ':' + map.world.shapes.length;
}
