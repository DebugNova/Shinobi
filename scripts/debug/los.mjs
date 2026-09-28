// Line of sight along a line on the map: what the first collider in the way is (debug for aimed/gazed jutsu).
// usage: node scripts/debug/los.mjs x0 y0 z0 x1 y1 z1   (y: height above the ground there)
import { buildMap } from '../../src/shared/map.js';
const [x0, h0, z0, x1, h1, z1] = process.argv.slice(2).map(Number);
const { world } = buildMap();
const g0 = world.ground(x0, z0, 60, {}).y, g1 = world.ground(x1, z1, 60, {}).y;
const a = [x0, g0 + h0, z0], b = [x1, g1 + h1, z1];
const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d);
const out = {};
const t = world.raycast(...a, d[0] / l, d[1] / l, d[2] / l, l, out);
console.log(`ground ${g0.toFixed(2)} -> ${g1.toFixed(2)}, length ${l.toFixed(2)}, hit at ${t.toFixed(2)}`, t < l ? JSON.stringify({ shape: out.shape && { k: out.shape.k, x: out.shape.x, z: out.shape.z, y0: out.shape.y0, y1: out.shape.y1, r: out.shape.r, hx: out.shape.hx, hz: out.shape.hz } }) : 'clear');
