// Finds clear, nearly flat straight lanes (for animation tests): every 0.5 m along the lane the highest surface is the
// terrain, the slope is small and nothing stands within 1.5 m to either side.
// usage: node scripts/debug/lanes.mjs [length=26] [nearX,nearZ]
import { buildMap } from '../../src/shared/map.js';
const LEN = +(process.argv[2] || 26);
const { world } = buildMap();
const out = [];
for (let x = -64; x <= 64; x += 4) for (let z = -60; z <= 64; z += 4) for (let a = 0; a < 8; a++) {
  const yaw = (a / 8) * Math.PI * 2, dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  let ok = true, y0 = world.terrain(x, z), maxDy = 0;
  for (let s = 0; s <= LEN && ok; s += 0.5) {
    for (const off of [-1.5, 0, 1.5]) {
      const px = x + dx * s - dz * off, pz = z + dz * s + dx * off;
      const t = world.terrain(px, pz), g = world.ground(px, pz, t + 4, {});
      if (Math.abs(g.y - t) > 0.05 || t < -0.3) ok = false; // a prop or water
      maxDy = Math.max(maxDy, Math.abs(t - y0));
    }
  }
  if (ok && maxDy < 0.6) out.push([x, z, +yaw.toFixed(3), +maxDy.toFixed(2)]);
}
out.sort((p, q) => p[3] - q[3]);
console.log(`${out.length} lanes; flattest:`);
const near = process.argv[3] ? process.argv[3].split(",").map(Number) : null;
if (near) out.sort((p, q) => Math.hypot(p[0] - near[0], p[1] - near[1]) - Math.hypot(q[0] - near[0], q[1] - near[1]));
for (const l of out.slice(0, 12)) console.log(`  start ${l[0]},${l[1]} yaw ${l[2]} (height range ${l[3]} m)`);
