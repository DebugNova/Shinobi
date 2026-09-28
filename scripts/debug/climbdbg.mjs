// One wall run up a tree trunk toward a branch, traced (Node, real Controller + CollisionWorld).
// usage: node scripts/debug/climbdbg.mjs [tree=4] [branch=0] [approachAngleDeg=0]
import { buildMap } from '../../src/shared/map.js';
import { Controller } from '../../src/game/controller.js';
import { SIM } from '../../src/shared/config.js';

const [TI = '4', BI = '0', ANG = '0'] = process.argv.slice(2);
const map = buildMap(), world = map.world, t = map.trees[+TI], br = t.branches[+BI];
const inp = { t: 0, down: new Set(), presses: new Map(), move(o) { o.x = 0; o.y = this.down.has('up') ? 1 : 0; return o; }, take(a, w = 0.15) { const p = this.presses.get(a); if (p === undefined || this.t - p > w) return false; this.presses.delete(a); return true; }, peek(a, w = 0.15) { const p = this.presses.get(a); return p !== undefined && this.t - p <= w; }, held(a) { return this.down.has(a); }, heldFor() { return 0; }, press(a) { this.presses.set(a, this.t); } };
const c = new Controller(world, 'naruto');
// start 5 m out under the branch (rotated by the approach angle), facing the trunk
const a = Math.atan2(br.dz, br.dx) + (+ANG * Math.PI) / 180;
const sx = t.x + Math.cos(a) * (t.r + 5), sz = t.z + Math.sin(a) * (t.r + 5);
c.reset([sx, world.ground(sx, sz, t.g + 1, {}).y, sz], 0);
console.log(`tree ${TI} at ${t.x.toFixed(1)},${t.z.toFixed(1)} r ${t.r.toFixed(2)} ground ${t.g.toFixed(2)} top ${t.top.toFixed(1)}; branch ${BI} y ${br.y.toFixed(2)} dir ${br.dx.toFixed(2)},${br.dz.toFixed(2)}`);
let T = 0;
for (let i = 0; i < 60 * 5; i++) {
  inp.t = T;
  const yaw = Math.atan2(-(t.x - c.body.x), -(t.z - c.body.z));
  inp.down = new Set(['up', 'jump']);
  if (i % 30 === 5 && c.body.ground) inp.press('jump');
  c.step(inp, yaw, [], T);
  const ev = c.events.map((e) => e.k).join(',');
  c.events.length = 0;
  T += SIM.dt;
  const b = c.body;
  if (i % 6 === 0 || ev) console.log(`${T.toFixed(2)} st ${c.st} pos ${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)} v ${b.vx.toFixed(1)},${b.vy.toFixed(1)},${b.vz.toFixed(1)} dTrunk ${(Math.hypot(b.x - t.x, b.z - t.z) - t.r).toFixed(2)} ${c.wall ? `wall top ${c.wall.top.toFixed(1)}` : ''} ${c.vault ? 'VAULT' : ''} ${ev}`);
}
