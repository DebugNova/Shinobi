// Wall-run up every face of every house (several points along each face) and every trunk, then report where the
// fighter ends up inside a collider (embedded: the capsule's middle inside a shape's volume). No server, no browser.
// usage: node scripts/debug/embed.mjs [--verbose]   TRACE="house 7 face (0,1) at 1.1" prints that attempt per tick;
// NOUNBURY=1 turns off the controller's unbury() safety net (to test that the moves themselves never bury us)
import { buildMap } from '../../src/shared/map.js';
import { Controller } from '../../src/game/controller.js';
import { SIM } from '../../src/shared/config.js';

const VERBOSE = process.argv.includes('--verbose');
const map = buildMap();
const world = map.world;
class BotInput {
  constructor() { this.t = 0; this.down = new Set(); this.presses = new Map(); }
  hold(l) { this.down = new Set(l); }
  press(a) { this.presses.set(a, this.t); }
  take(a, win = 0.15) { const t = this.presses.get(a); if (t === undefined || this.t - t > win) return false; this.presses.delete(a); return true; }
  peek(a, win = 0.15) { const t = this.presses.get(a); return t !== undefined && this.t - t <= win; }
  held(a) { return this.down.has(a); }
  heldFor(a) { return this.held(a) ? 1 : 0; }
  move(o) { o.x = 0; o.y = this.down.has('up') ? 1 : 0; return o; }
}
/** The shape the body's middle is buried in, or null. */
export function embedded(world, b, h = 1.6) {
  const list = world.near(b.x, b.z, 0.01);
  for (const s of list) {
    const top = world.topAt(s, b.x, b.z, -0.05);
    if (top === -Infinity) continue;
    const y = b.y + 0.6;
    if (s.y0 < y && top > y) return s;
  }
  return null;
}
if (process.env.NOUNBURY) Controller.prototype.unbury = function () {};
const TRACE = process.env.TRACE || '';
const input = new BotInput();
const ctrl = new Controller(world, 'naruto');
let simT = 0, bad = 0, runs = 0;
function attempt(name, x, z, yaw) {
  const g = world.ground(x, z, 80, {});
  ctrl.reset([x, g.y, z], yaw);
  ctrl.chakra = ctrl.C.stats.chakra;
  input.hold(['up', 'jump']);
  let worst = null;
  for (let i = 0; i < 60 * 5; i++) {
    input.t = simT;
    if (i % 20 === 2 && ctrl.body.ground) input.press('jump');
    ctrl.step(input, yaw, [], simT);
    simT += SIM.dt;
    const s = embedded(world, ctrl.body);
    if (TRACE === name) {
      const b = ctrl.body;
      console.log(i, 'st', ctrl.st, [b.x, b.y, b.z, b.vy].map((v) => v.toFixed(2)).join(' '), b.ground ? 'G' : '-', ctrl.vault ? 'vault->' + ctrl.vault.y1.toFixed(2) : '', s ? 'IN ' + s.id : '', ctrl.events.map((e) => e.k).join(','));
    }
    ctrl.events.length = 0;
    if (s && !worst && ctrl.body.ground && !ctrl.wall && !ctrl.vault) worst = { s, i, p: [ctrl.body.x, ctrl.body.y, ctrl.body.z].map((v) => v.toFixed(2)).join(',') };
  }
  runs++;
  if (worst) {
    bad++;
    if (VERBOSE || bad < 30) console.log(`  ${name}: inside shape ${worst.s.id} (k${worst.s.k} y0 ${worst.s.y0.toFixed(2)} top ${worst.s.ytop.toFixed(2)}) at ${worst.p} after ${(worst.i / 60).toFixed(2)} s`);
  }
}
// houses: every face, 7 points along it, starting 2.5 m out, facing the wall
for (const [hi, h] of map.houses.entries()) {
  const [lx, lz] = h.lx, [fx, fz] = h.face;
  for (const [nx, nz, half, alongX, alongZ, span] of [
    [fx, fz, h.D / 2, lx, lz, h.W / 2], [-fx, -fz, h.D / 2, lx, lz, h.W / 2],
    [lx, lz, h.W / 2, fx, fz, h.D / 2], [-lx, -lz, h.W / 2, fx, fz, h.D / 2],
  ]) {
    for (let k = -3; k <= 3; k++) {
      const t = (k / 3.5) * span;
      const x = h.x + nx * (half + 2.5) + alongX * t, z = h.z + nz * (half + 2.5) + alongZ * t;
      attempt(`house ${hi} face (${nx},${nz}) at ${t.toFixed(1)}`, x, z, Math.atan2(nx, nz));
    }
  }
}
// trunks: 8 sides
for (const [ti, t] of map.trees.entries()) {
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
    attempt(`tree ${ti} side ${k}`, t.x + nx * (t.r + 2.5), t.z + nz * (t.r + 2.5), Math.atan2(nx, nz));
  }
}
console.log(`${bad ? 'FAIL' : 'PASS'}: ${bad} of ${runs} wall runs ended up inside a collider`);
