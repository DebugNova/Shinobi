// Collision world, shared by the client (movement, camera, line of sight, hit checks) and the server (validation,
// knockback flights). Pure math, no three.js, deterministic: the same inputs give the same answers everywhere.
//
// Terrain = a heightfield (bilinear). Everything else = shapes:
//   box: yaw-rotated box {k: 0, x, z, c, s, hx, hz, y0, y1, sx, sz} with an optionally sloped top
//        (top at local (lx, lz) = y1 + sx * lx + sz * lz: roofs and ramps)
//   cyl: vertical cylinder {k: 1, x, z, r, y0, y1, r1} (tree trunks, posts); the radius runs from r at y0 to r1 at y1
//        (a cone: tapering trunks, root flares), r1 = r when not given
// Every shape carries `climb` (wall-runnable sides) and `surf` (SURF id: footsteps, particles).
// Water: anywhere the terrain lies below `waterY` the surface is walkable water.
import { SURF } from './config.js';
import { dsin, dcos } from './rng.js';

export const BOX = 0, CYL = 1;
const CELL = 8;

export class CollisionWorld {
  /**
   * hf: { x0, z0, cell, nx, nz, h: Float32Array (nx * nz), surf?: Uint8Array } heights at grid points
   * shapes: [...]; waterY: water surface height (or -Infinity); bounds: { minX, maxX, minZ, maxZ } hard clamp
   */
  constructor({ hf, shapes, waterY = -Infinity, bounds }) {
    this.hf = hf;
    this.shapes = shapes;
    this.waterY = waterY;
    this.bounds = bounds;
    shapes.forEach((s, i) => {
      s.id = i;
      if (s.k === BOX) {
        // bounding radius and the highest point of a sloped top, for the broad phase and ray tests
        s.br = Math.hypot(s.hx, s.hz);
        s.ytop = s.y1 + Math.abs(s.sx || 0) * s.hx + Math.abs(s.sz || 0) * s.hz;
        s.sx ||= 0;
        s.sz ||= 0;
      } else {
        s.r1 ??= s.r;
        s.br = Math.max(s.r, s.r1);
        s.ytop = s.y1;
      }
    });
    // uniform grid over the shapes' footprints
    this.gx0 = bounds.minX - 64;
    this.gz0 = bounds.minZ - 64;
    this.gw = Math.ceil((bounds.maxX - bounds.minX + 128) / CELL);
    this.gh = Math.ceil((bounds.maxZ - bounds.minZ + 128) / CELL);
    this.cells = Array.from({ length: this.gw * this.gh }, () => []);
    for (const s of shapes) {
      const [a, b, c, d] = this.cellRange(s.x - s.br, s.z - s.br, s.x + s.br, s.z + s.br);
      for (let j = b; j <= d; j++) for (let i = a; i <= c; i++) this.cells[j * this.gw + i].push(s);
    }
    this.stamp = new Uint32Array(shapes.length);
    this.tick = 0;
    this._near = [];
  }

  cellRange(x0, z0, x1, z1) {
    const cl = (v, n) => Math.max(0, Math.min(n - 1, v));
    return [
      cl(Math.floor((x0 - this.gx0) / CELL), this.gw),
      cl(Math.floor((z0 - this.gz0) / CELL), this.gh),
      cl(Math.floor((x1 - this.gx0) / CELL), this.gw),
      cl(Math.floor((z1 - this.gz0) / CELL), this.gh),
    ];
  }

  /** Shapes whose footprint may touch the square around (x, z) of half-size r. Returns a reused array. */
  near(x, z, r) {
    const out = this._near;
    out.length = 0;
    const t = ++this.tick;
    const [a, b, c, d] = this.cellRange(x - r, z - r, x + r, z + r);
    for (let j = b; j <= d; j++) {
      for (let i = a; i <= c; i++) {
        const list = this.cells[j * this.gw + i];
        for (let k = 0; k < list.length; k++) {
          const s = list[k];
          if (this.stamp[s.id] === t) continue;
          this.stamp[s.id] = t;
          if (Math.abs(s.x - x) > s.br + r || Math.abs(s.z - z) > s.br + r) continue;
          out.push(s);
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ terrain

  /** Terrain height (bilinear). */
  terrain(x, z) {
    const hf = this.hf;
    let fx = (x - hf.x0) / hf.cell, fz = (z - hf.z0) / hf.cell;
    fx = Math.max(0, Math.min(hf.nx - 1.001, fx));
    fz = Math.max(0, Math.min(hf.nz - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const h = hf.h, n = hf.nx;
    const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Terrain normal (central differences), written into out = [nx, ny, nz]. */
  terrainNormal(x, z, out) {
    const e = this.hf.cell * 0.5;
    const dx = this.terrain(x + e, z) - this.terrain(x - e, z);
    const dz = this.terrain(x, z + e) - this.terrain(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    out[0] = -dx / l;
    out[1] = (2 * e) / l;
    out[2] = -dz / l;
    return out;
  }

  terrainSurf(x, z) {
    const hf = this.hf;
    if (!hf.surf) return SURF.grass;
    const i = Math.max(0, Math.min(hf.nx - 1, Math.round((x - hf.x0) / hf.cell)));
    const j = Math.max(0, Math.min(hf.nz - 1, Math.round((z - hf.z0) / hf.cell)));
    return hf.surf[j * hf.nx + i];
  }

  // ------------------------------------------------------------------ shapes

  /** Height of a shape's top at (x, z), or -Infinity when the point is outside its footprint (margin m). */
  topAt(s, x, z, m = 0) {
    const dx = x - s.x, dz = z - s.z;
    if (s.k === CYL) return dx * dx + dz * dz <= (s.r1 + m) * (s.r1 + m) ? s.y1 : -Infinity;
    const lx = dx * s.c + dz * s.s, lz = -dx * s.s + dz * s.c;
    if (Math.abs(lx) > s.hx + m || Math.abs(lz) > s.hz + m) return -Infinity;
    const cx = Math.max(-s.hx, Math.min(s.hx, lx)), cz = Math.max(-s.hz, Math.min(s.hz, lz));
    return s.y1 + s.sx * cx + s.sz * cz;
  }

  /**
   * The surface a fighter standing at (x, z) with feet no higher than `maxY` rests on: the highest terrain, water or
   * shape top at or below maxY. out = { y, surf, shape, nx, ny, nz }.
   */
  ground(x, z, maxY, out = {}, m = 0) {
    let y = this.terrain(x, z), surf = -1, shape = null;
    if (this.waterY > y) {
      y = this.waterY;
      surf = SURF.water;
    }
    const list = this.near(x, z, m + 0.01);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.y0 > maxY) continue;
      const top = this.topAt(s, x, z, m);
      if (top > y && top <= maxY) {
        y = top;
        shape = s;
      }
    }
    out.y = y;
    out.shape = shape;
    if (shape) {
      out.surf = shape.surf ?? SURF.stone;
      if (shape.k === BOX && (shape.sx || shape.sz)) {
        // sloped top: normal from the slope, turned into world space
        const gx = shape.sx * shape.c - shape.sz * shape.s, gz = shape.sx * shape.s + shape.sz * shape.c;
        const l = Math.hypot(gx, 1, gz);
        out.nx = -gx / l;
        out.ny = 1 / l;
        out.nz = -gz / l;
      } else {
        out.nx = 0;
        out.ny = 1;
        out.nz = 0;
      }
    } else if (surf === SURF.water) {
      out.surf = SURF.water;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
    } else {
      out.surf = this.terrainSurf(x, z);
      const n = (this._n ||= [0, 1, 0]);
      this.terrainNormal(x, z, n);
      out.nx = n[0];
      out.ny = n[1];
      out.nz = n[2];
    }
    return out;
  }

  /**
   * Pushes a vertical capsule (circle radius r, feet y0, head y1) out of every shape it overlaps sideways. A shape
   * whose top is within `step` of the feet doesn't block (it is stepped onto). pos = { x, z } is modified.
   * Contacts go to `hits` (reused array of { nx, nz, shape, depth }). Returns the number of contacts.
   */
  pushOut(pos, r, y0, y1, step, hits) {
    let n = 0;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const list = this.near(pos.x, pos.z, r + 0.05);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.y0 >= y1 || s.ytop <= y0 + step) continue;
        const dx = pos.x - s.x, dz = pos.z - s.z;
        let nx, nz, depth;
        if (s.k === CYL) {
          const d = Math.hypot(dx, dz);
          // a cone: the widest radius along the capsule's height
          depth = Math.max(radiusAt(s, y0), radiusAt(s, y1)) + r - d;
          if (depth <= 0) continue;
          if (s.y1 <= y0 + step) continue;
          if (d > 1e-6) {
            nx = dx / d;
            nz = dz / d;
          } else {
            nx = 1;
            nz = 0;
          }
        } else {
          const lx = dx * s.c + dz * s.s, lz = -dx * s.s + dz * s.c;
          const cx = Math.max(-s.hx, Math.min(s.hx, lx)), cz = Math.max(-s.hz, Math.min(s.hz, lz));
          // a sloped top that is low enough here is ground, not a wall
          const top = s.y1 + s.sx * cx + s.sz * cz;
          if (top <= y0 + step) continue;
          let lnx = lx - cx, lnz = lz - cz;
          const d = Math.hypot(lnx, lnz);
          if (d > 1e-6) {
            depth = r - d;
            if (depth <= 0) continue;
            lnx /= d;
            lnz /= d;
          } else {
            // centre inside the box: out through the nearest face
            const ex = s.hx - Math.abs(lx), ez = s.hz - Math.abs(lz);
            if (ex < ez) {
              lnx = Math.sign(lx) || 1;
              lnz = 0;
              depth = ex + r;
            } else {
              lnx = 0;
              lnz = Math.sign(lz) || 1;
              depth = ez + r;
            }
          }
          nx = lnx * s.c - lnz * s.s;
          nz = lnx * s.s + lnz * s.c;
        }
        pos.x += nx * (depth + 1e-4);
        pos.z += nz * (depth + 1e-4);
        moved = true;
        if (hits && n < 8) {
          const h = (hits[n] ||= {});
          h.nx = nx;
          h.nz = nz;
          h.shape = s;
          h.depth = depth;
          n++;
        }
      }
      if (!moved) break;
    }
    const b = this.bounds;
    if (pos.x < b.minX || pos.x > b.maxX || pos.z < b.minZ || pos.z > b.maxZ) {
      const ox = pos.x, oz = pos.z;
      pos.x = Math.max(b.minX, Math.min(b.maxX, pos.x));
      pos.z = Math.max(b.minZ, Math.min(b.maxZ, pos.z));
      if (hits && n < 8) {
        const h = (hits[n] ||= {});
        const l = Math.hypot(pos.x - ox, pos.z - oz) || 1;
        h.nx = (pos.x - ox) / l;
        h.nz = (pos.z - oz) / l;
        h.shape = null;
        h.depth = l;
        n++;
      }
    }
    return n;
  }

  /** Lowest shape underside above a capsule at (x, z) between y0 and y1 (a ceiling), or Infinity. */
  ceiling(x, z, r, y0, y1) {
    let c = Infinity;
    const list = this.near(x, z, r);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.y0 < y0 || s.y0 > y1) continue;
      if (s.k === CYL) {
        const dx = x - s.x, dz = z - s.z, rr = s.r + r * 0.7;
        if (dx * dx + dz * dz > rr * rr) continue;
      } else if (this.topAt(s, x, z, r * 0.7) === -Infinity) continue;
      if (s.y0 < c) c = s.y0;
    }
    return c;
  }

  /**
   * The shape that fills the vertical span y0..y1 at (x, z) (its footprint within margin m, its top above y0), the
   * one with the highest top when several do; null when there is room. Landing spots (vaults, mantles) must be free.
   */
  solidAt(x, z, y0, y1, m = 0) {
    let best = null, bt = -Infinity;
    const list = this.near(x, z, Math.max(0, m) + 0.01);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.y0 >= y1) continue;
      const top = this.topAt(s, x, z, m);
      if (top <= y0 + 0.02 || top <= bt) continue;
      best = s;
      bt = top;
    }
    return best;
  }

  /**
   * The nearest climbable wall within `reach` of the circle (x, z, r) at height y (a point on the body):
   * out = { nx, nz, px, pz, dist, shape, top } (normal points out of the wall, top = the wall's top at that point)
   * or null.
   */
  wall(x, y, z, r, reach, out = {}) {
    let best = null, bd = Infinity;
    const list = this.near(x, z, r + reach);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s.climb || s.y0 > y || s.ytop < y) continue;
      const dx = x - s.x, dz = z - s.z;
      let nx, nz, d, px, pz;
      if (s.k === CYL) {
        // a cone (a root flare) is as wide as it gets along the body below the probe: pushOut keeps the feet out there
        const l = Math.hypot(dx, dz) || 1e-6, sr = Math.max(radiusAt(s, y), radiusAt(s, y - 0.9));
        d = l - sr - r;
        nx = dx / l;
        nz = dz / l;
        px = s.x + nx * sr;
        pz = s.z + nz * sr;
      } else {
        const lx = dx * s.c + dz * s.s, lz = -dx * s.s + dz * s.c;
        const cx = Math.max(-s.hx, Math.min(s.hx, lx)), cz = Math.max(-s.hz, Math.min(s.hz, lz));
        let lnx = lx - cx, lnz = lz - cz;
        const l = Math.hypot(lnx, lnz);
        if (l < 1e-6) continue; // inside: not a wall to run on
        lnx /= l;
        lnz /= l;
        // corners count as walls only near a face (running round a corner hands over to the next face)
        d = l - r;
        nx = lnx * s.c - lnz * s.s;
        nz = lnx * s.s + lnz * s.c;
        px = s.x + cx * s.c - cz * s.s;
        pz = s.z + cx * s.s + cz * s.c;
      }
      if (d > reach || d >= bd) continue;
      bd = d;
      best = s;
      out.nx = nx;
      out.nz = nz;
      out.px = px;
      out.pz = pz;
    }
    if (!best) return null;
    out.dist = bd;
    out.shape = best;
    out.top = best.k === CYL ? best.wallTop ?? best.y1 : this.topAt(best, out.px, out.pz, 0.01);
    return out;
  }

  /**
   * Ray vs shapes and terrain. Returns the distance to the first hit (< far) or far. `out` gets { nx, ny, nz, shape }.
   */
  raycast(ox, oy, oz, dx, dy, dz, far, out) {
    let best = far, bs = null, bnx = 0, bny = 1, bnz = 0;
    // shapes: walk the grid cells the ray's bounding box covers (rays here are short: camera, LOS, hit checks)
    const ex = ox + dx * far, ez = oz + dz * far;
    const t = ++this.tick;
    const [a, b, c, d] = this.cellRange(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
    for (let j = b; j <= d; j++) {
      for (let i = a; i <= c; i++) {
        const list = this.cells[j * this.gw + i];
        for (let k = 0; k < list.length; k++) {
          const s = list[k];
          if (this.stamp[s.id] === t) continue;
          this.stamp[s.id] = t;
          const h = s.k === CYL ? rayCyl(s, ox, oy, oz, dx, dy, dz, best) : rayBox(s, ox, oy, oz, dx, dy, dz, best);
          if (h) {
            best = h.t;
            bs = s;
            bnx = h.nx;
            bny = h.ny;
            bnz = h.nz;
          }
        }
      }
    }
    // terrain: march, then bisect
    const step = 0.5;
    let prevT = 0, prevAbove = oy - this.terrain(ox, oz) >= 0;
    if (prevAbove) {
      for (let tt = step; tt < best + step; tt += step) {
        const tc = Math.min(tt, best);
        const above = oy + dy * tc - this.terrain(ox + dx * tc, oz + dz * tc) >= 0;
        if (!above) {
          let lo = prevT, hi = tc;
          for (let it = 0; it < 12; it++) {
            const m = (lo + hi) / 2;
            if (oy + dy * m - this.terrain(ox + dx * m, oz + dz * m) >= 0) lo = m;
            else hi = m;
          }
          if (hi < best) {
            best = hi;
            bs = null;
            const n = this.terrainNormal(ox + dx * hi, oz + dz * hi, [0, 1, 0]);
            bnx = n[0];
            bny = n[1];
            bnz = n[2];
          }
          break;
        }
        prevT = tc;
        if (tc >= best) break;
      }
    }
    if (out) {
      out.nx = bnx;
      out.ny = bny;
      out.nz = bnz;
      out.shape = bs;
    }
    return best;
  }

  /** True when nothing blocks the segment a -> b (line of sight). */
  clear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) return true;
    return this.raycast(ax, ay, az, dx / l, dy / l, dz / l, l) >= l - 1e-3;
  }
}

const _hit = { t: 0, nx: 0, ny: 0, nz: 0 };

/** Radius of a cylinder / cone at height y (clamped to its ends). */
export function radiusAt(s, y) {
  if (s.r1 === s.r || s.r1 === undefined) return s.r;
  const t = (y - s.y0) / (s.y1 - s.y0);
  return s.r + (s.r1 - s.r) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

function rayCyl(s, ox, oy, oz, dx, dy, dz, far) {
  const px = ox - s.x, pz = oz - s.z;
  let tBest = Infinity, nx = 0, ny = 0, nz = 0;
  // side: radius R(y) = a0 + a1 t along the ray (a cone; a1 = 0 for a cylinder); |p + d t|^2 = R^2
  const k = (s.r1 - s.r) / (s.y1 - s.y0);
  const a0 = s.r + k * (oy - s.y0), a1 = k * dy;
  const a = dx * dx + dz * dz - a1 * a1;
  const b = px * dx + pz * dz - a0 * a1, c = px * px + pz * pz - a0 * a0;
  let ts = -1;
  if (Math.abs(a) > 1e-9) {
    const disc = b * b - a * c;
    if (disc >= 0) {
      const q = Math.sqrt(disc);
      for (const t of a > 0 ? [(-b - q) / a, (-b + q) / a] : [(-b + q) / a, (-b - q) / a]) {
        const y = oy + dy * t;
        if (t >= 0 && y >= s.y0 && y <= s.y1 && a0 + a1 * t > 0) {
          ts = t;
          break;
        }
      }
    }
  } else if (Math.abs(b) > 1e-12) {
    const t = -c / (2 * b), y = oy + dy * t;
    if (t >= 0 && y >= s.y0 && y <= s.y1 && a0 + a1 * t > 0) ts = t;
  }
  if (ts >= 0 && ts < tBest) {
    const R = a0 + a1 * ts;
    const l = Math.sqrt(1 + k * k);
    tBest = ts;
    nx = (px + dx * ts) / R / l;
    nz = (pz + dz * ts) / R / l;
    ny = -k / l;
  }
  // caps
  if (Math.abs(dy) > 1e-9) {
    for (const [yc, sign, rc] of [[s.y1, 1, s.r1], [s.y0, -1, s.r]]) {
      const t = (yc - oy) / dy;
      if (t < 0 || t >= tBest) continue;
      const x = px + dx * t, z = pz + dz * t;
      if (x * x + z * z <= rc * rc) {
        tBest = t;
        nx = 0;
        ny = sign;
        nz = 0;
      }
    }
  }
  if (tBest >= far) return null;
  _hit.t = tBest;
  _hit.nx = nx;
  _hit.ny = ny;
  _hit.nz = nz;
  return _hit;
}

function rayBox(s, ox, oy, oz, dx, dy, dz, far) {
  // into the box frame (yaw only)
  const px = ox - s.x, pz = oz - s.z;
  const lx = px * s.c + pz * s.s, lz = -px * s.s + pz * s.c;
  const ldx = dx * s.c + dz * s.s, ldz = -dx * s.s + dz * s.c;
  const lo = [-s.hx, s.y0, -s.hz], hi = [s.hx, s.ytop, s.hz];
  const o = [lx, oy, lz], d = [ldx, dy, ldz];
  let t0 = 0, t1 = far, axis = -1, sign = 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < lo[k] || o[k] > hi[k]) return null;
      continue;
    }
    let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k];
    let sg = -1;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
      sg = 1;
    }
    if (ta > t0) {
      t0 = ta;
      axis = k;
      sign = sg;
    }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (axis < 0 || t0 >= far) return null;
  // sloped top: the slab test used the top's highest point; check the hit point is under the real top
  if (s.sx || s.sz) {
    const hx = o[0] + d[0] * t0, hz = o[2] + d[2] * t0;
    const top = s.y1 + s.sx * hx + s.sz * hz;
    if (oy + dy * t0 > top + 1e-3) {
      // march the plane: find where the ray crosses the top plane inside the footprint
      const denom = dy - s.sx * d[0] - s.sz * d[2];
      if (Math.abs(denom) < 1e-9) return null;
      const tp = (s.y1 + s.sx * o[0] + s.sz * o[2] - oy) / denom;
      if (tp < t0 || tp > t1 || tp >= far) return null;
      const qx = o[0] + d[0] * tp, qz = o[2] + d[2] * tp;
      if (Math.abs(qx) > s.hx || Math.abs(qz) > s.hz) return null;
      const gx = s.sx * s.c - s.sz * s.s, gz = s.sx * s.s + s.sz * s.c;
      const l = Math.hypot(gx, 1, gz);
      _hit.t = tp;
      _hit.nx = -gx / l;
      _hit.ny = 1 / l;
      _hit.nz = -gz / l;
      return _hit;
    }
  }
  const ln = [0, 0, 0];
  ln[axis] = sign;
  _hit.t = t0;
  _hit.nx = ln[0] * s.c - ln[2] * s.s;
  _hit.ny = ln[1];
  _hit.nz = ln[0] * s.s + ln[2] * s.c;
  return _hit;
}

/** Packs a yaw-rotated box. yaw: rotation about +Y (three.js sense). */
export function box(x, z, hx, hz, y0, y1, yaw = 0, o = {}) {
  // local -> world: wx = x + lx * c - lz * s, wz = z + lx * s + lz * c (a rotation by -yaw in three's sense)
  return { k: BOX, x, z, hx, hz, y0, y1, c: dcos(-yaw), s: dsin(-yaw), yaw, sx: o.sx || 0, sz: o.sz || 0, climb: o.climb ?? true, surf: o.surf ?? SURF.stone, tag: o.tag };
}

export function cyl(x, z, r, y0, y1, o = {}) {
  // wallTop: where a wall run up it ends (a root flare hands over to its trunk: its own top is not an edge to vault)
  return { k: CYL, x, z, r, y0, y1, r1: o.r1 ?? r, climb: o.climb ?? true, surf: o.surf ?? SURF.bark, tag: o.tag, wallTop: o.wallTop };
}
