// Itachi's kit as pure geometry, shared by the client (the caster's aim, the escape spot, debug checks) and the server
// (who a gaze takes, where an escape may land). Pure JS (no three.js). Numbers come from itachi.js.
import { BOUNDS } from './map.js';
import { SURF } from './config.js';

const _g = {};
const DEG = Math.PI / 180;

/**
 * Is a body (feet p = [x, y, z], radius r) inside a gaze (Tsukuyomi, Amaterasu)? o = [x, y, z] his eyes, d = [dx, 0, dz]
 * his facing. The cone opens `cone` degrees either side (widened by the body's radius), `range` metres out, `height`
 * metres up or down. Line of sight is the caller's (world.clear from the eyes to the chest).
 */
export function inGaze(J, o, d, p, r = 0.34) {
  const rx = p[0] - o[0], rz = p[2] - o[2], dist = Math.hypot(rx, rz);
  if (dist > J.range + r) return false;
  const dy = p[1] + 1.0 - o[1];
  if (Math.abs(dy) > J.height) return false;
  if (dist < 1.2) return true; // (right on top of him: in his face)
  const dl = Math.hypot(d[0], d[2]) || 1;
  const cos = (rx * d[0] + rz * d[2]) / (dist * dl);
  return cos >= Math.cos(J.cone * DEG + Math.atan(r / dist));
}

/**
 * Crow Clone Escape: the safest spot nearby. Candidates on rings `dist` metres from `from` (feet), each a free spot on
 * walkable ground (not inside anything, not over a drop, not in the river, inside the arena, near his height). Scored
 * by how far it is from the nearest enemy and whether enemies can see it (out of sight counts as 6 m more), plus a
 * little randomness (`rand`: () => 0..1) so it isn't predictable. enemies: [{ x, y, z }]. Returns [x, y, z] or null.
 */
export function escapeSpot(world, J, from, enemies, rand = Math.random) {
  const [d0, d1] = J.dist;
  const N = 20, a0 = rand() * Math.PI * 2;
  let best = null, bs = -Infinity;
  for (let ring = 0; ring < 3; ring++) {
    const rad = d0 + ((d1 - d0) * ring) / 2;
    for (let k = 0; k < N; k++) {
      const a = a0 + ((k + ring * 0.5) / N) * Math.PI * 2;
      const x = from[0] + Math.cos(a) * rad, z = from[2] + Math.sin(a) * rad;
      const y = spotOk(world, x, z, from[1]);
      if (y === null) continue;
      let near = 60, seen = 0;
      for (const e of enemies) {
        const dd = Math.hypot(e.x - x, e.z - z);
        near = Math.min(near, dd);
        if (dd < 40 && world.clear(e.x, e.y + 1.4, e.z, x, y + 1.2, z)) seen++;
      }
      const score = Math.min(near, 30) + (enemies.length && !seen ? 6 : 0) - seen * 1.5 + rand() * 3;
      if (score > bs) {
        bs = score;
        best = [x, y, z];
      }
    }
  }
  return best;
}

/** The ground height at (x, z) when a fighter can stand there (see escapeSpot), else null. */
export function spotOk(world, x, z, fromY) {
  if (x < BOUNDS.minX + 2 || x > BOUNDS.maxX - 2 || z < BOUNDS.minZ + 2 || z > BOUNDS.maxZ - 2) return null;
  const g = world.ground(x, z, fromY + 3.5, _g);
  const y = g.y;
  if (g.surf === SURF.water || y < fromY - 5 || y > fromY + 3.5) return null;
  // room to stand (nothing from the ankles to above the head, a body's width round it)
  if (world.solidAt(x, z, y + 0.1, y + 1.8, 0.38)) return null;
  // flat enough: no drop or wall edge within half a metre
  for (const [ox, oz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
    const h = world.ground(x + ox, z + oz, y + 0.6, _g).y;
    if (Math.abs(h - y) > 0.45) return null;
  }
  return y;
}

/** Where fireball `k` of a cast leaves toward: the aim direction a = [x, y, z] (unit) turned by spread[k] about the
 * vertical and lifted by `lift`. Returns a unit [x, y, z]. */
export function shotDir(J, a, k) {
  const s = J.spread[k] || 0, c = Math.cos(s), n = Math.sin(s);
  let x = a[0] * c + a[2] * n, z = -a[0] * n + a[2] * c, y = a[1] + J.lift;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
