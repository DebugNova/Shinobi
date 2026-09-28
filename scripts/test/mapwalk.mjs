// Map walk + wall-run bot (no browser: the real Controller on the real CollisionWorld, stepped at 60 Hz in Node).
// Tours every 10 m cell of the playable ground, every tree branch (wall run up the trunk) and every rooftop, steering
// like a player (camera yaw toward the target, forward held; jump when blocked; hold jump to wall-run up to targets
// above). Fails on: falling through the world, leaving the bounds, getting trapped (no direction frees the fighter),
// standing inside a collider (a roof, a trunk).
// Reports unreached targets (a target can be legitimately unreachable by this simple steering: check them).
// usage: node scripts/test/mapwalk.mjs [maxTargetSeconds=25] [--verbose]   (TRACE="tree 4 branch 0" traces one target)
import { buildMap, BOUNDS } from '../../src/shared/map.js';
import { Controller } from '../../src/game/controller.js';
import { SIM, ST } from '../../src/shared/config.js';

const MAXT = +(process.argv.find((a) => /^\d+$/.test(a)) || 25);
const VERBOSE = process.argv.includes('--verbose');
const TRACE = process.env.TRACE || ''; // e.g. TRACE='tree 4 branch 0': prints that attempt
const map = buildMap();
const world = map.world;

// ---- a scripted input on the simulation clock (same API as src/game/input.js)
class BotInput {
  constructor() {
    this.t = 0;
    this.down = new Set();
    this.presses = new Map();
    this.downAt = new Map();
  }
  hold(list) {
    for (const a of list) if (!this.down.has(a)) this.downAt.set(a, this.t);
    for (const a of [...this.down]) if (!list.includes(a)) this.down.delete(a);
    for (const a of list) this.down.add(a);
  }
  press(a) {
    this.presses.set(a, this.t);
    this.downAt.set(a, this.t);
  }
  take(a, win = 0.15) {
    const t = this.presses.get(a);
    if (t === undefined || this.t - t > win) return false;
    this.presses.delete(a);
    return true;
  }
  peek(a, win = 0.15) {
    const t = this.presses.get(a);
    return t !== undefined && this.t - t <= win;
  }
  held(a) {
    return this.down.has(a);
  }
  heldFor(a) {
    return this.held(a) ? this.t - (this.downAt.get(a) ?? this.t) : 0;
  }
  move(out) {
    out.x = (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0);
    out.y = (this.down.has('up') ? 1 : 0) - (this.down.has('down') ? 1 : 0);
    const l = Math.hypot(out.x, out.y);
    if (l > 1) {
      out.x /= l;
      out.y /= l;
    }
    return out;
  }
}

// ---- targets
const targets = [];
const IN = 3;
for (let x = BOUNDS.minX + IN; x <= BOUNDS.maxX - IN; x += 10) {
  for (let z = BOUNDS.minZ + IN; z <= BOUNDS.maxZ - IN; z += 10) {
    const g = world.ground(x, z, 80, {});
    const t = world.terrain(x, z);
    // a cell whose top is a roof, branch or cliff is a climb target; plain ground is a walk target
    if (g.y - t > 1.5) targets.push({ x, z, y: g.y, kind: 'high', name: `cell ${x},${z} top` });
    else targets.push({ x, z, y: g.y, kind: 'ground', name: `cell ${x},${z}` });
  }
}
for (const [i, t] of map.trees.entries()) {
  for (const [k, b] of t.branches.entries()) {
    // b.rb: the trunk's radius where the branch leaves it; the branch's top rises by b.rise over its length
    const reach = b.rb + b.len * 0.55;
    // climbed from the trunk: run at the trunk under the branch, wall-run up, mantle onto the branch
    targets.push({ x: t.x + b.dx * reach, z: t.z + b.dz * reach, y: b.y + b.rise * 0.55, kind: 'branch', name: `tree ${i} branch ${k}`, via: { x: t.x, z: t.z }, under: { x: t.x + b.dx * (b.rb + 1.2), z: t.z + b.dz * (b.rb + 1.2) } });
  }
  // the crown: run up the trunk into the canopy's underside, mantle onto the top
  targets.push({ x: t.x + t.cr * 0.5, z: t.z, y: t.crown, kind: 'crown', name: `tree ${i} crown`, via: { x: t.x, z: t.z } });
}
for (const [i, h] of map.houses.entries()) targets.push({ x: h.x, z: h.z, y: h.eave + h.rise * 0.5, kind: 'roof', name: `house ${i} roof` });

// ---- the walker
const input = new BotInput();
const ctrl = new Controller(world, 'naruto');
const sp = map.spawns[0];
ctrl.reset([...sp.p], sp.yaw);
const results = { falls: [], trapped: [], oob: [], buried: [], reached: [], missed: [] };
let simT = 0;

function step(camYaw) {
  input.t = simT;
  ctrl.step(input, camYaw, [], simT);
  ctrl.events.length = 0;
  simT += SIM.dt;
  const b = ctrl.body;
  const ter = world.terrain(b.x, b.z);
  if (b.y < ter - 1.2 || b.y < -8) return 'fall';
  if (b.x < BOUNDS.minX - 1.5 || b.x > BOUNDS.maxX + 1.5 || b.z < BOUNDS.minZ - 1.5 || b.z > BOUNDS.maxZ + 1.5) return 'oob';
  // standing with the body's middle inside a solid (a roof, a trunk): the fighter got into a collider
  if (b.ground && !ctrl.wall && !ctrl.vault && world.solidAt(b.x, b.z, b.y + 0.35, b.y + 1.1, -0.05)) return 'buried';
  return null;
}

/** Can the fighter get away from here at all? Tries 8 directions (with jumps) for 0.7 s each. */
function trappedHere() {
  const b = ctrl.body, x0 = b.x, y0 = b.y, z0 = b.z;
  let best = 0;
  for (let k = 0; k < 8 && best < 0.8; k++) {
    const yaw = (k / 8) * Math.PI * 2;
    input.hold(['up']);
    for (let i = 0; i < 42; i++) {
      if (i === 5) input.press('jump');
      step(yaw);
      best = Math.max(best, Math.hypot(b.x - x0, b.y - y0, b.z - z0));
    }
  }
  input.hold([]);
  return best < 0.8;
}

function go(tg) {
  const b = ctrl.body;
  const t0 = simT;
  let lastCheck = simT, lastD = Infinity, stalls = 0, nearUnder = false;
  // a player charges chakra (F) before a climb: wall runs drain it
  if (tg.kind !== 'ground') ctrl.chakra = ctrl.C.stats.chakra;
  while (simT - t0 < MAXT) {
    // a climb target reached through a wall (a trunk): head for the wall until running on it
    // (from under the branch's root, so the climb goes straight up into the branch)
    let aim = tg;
    if (tg.via && b.y < tg.y - 1) aim = tg.under && Math.hypot(tg.under.x - b.x, tg.under.z - b.z) > 1.2 && !nearUnder ? tg.under : tg.via;
    if (tg.under && Math.hypot(tg.under.x - b.x, tg.under.z - b.z) <= 1.2) nearUnder = true;
    const dx = aim.x - b.x, dz = aim.z - b.z, dh = Math.hypot(dx, dz);
    const dhT = Math.hypot(tg.x - b.x, tg.z - b.z);
    const high = tg.y - b.y > 1.2;
    if (dhT < (tg.kind === 'ground' ? 2.5 : 2.2) && Math.abs(b.y - tg.y) < 1.4 && b.ground) return true;
    const yaw = Math.atan2(-dx, -dz);
    // above us and close: hold jump (a wall run starts in the air against a climbable surface) and tap it to take off
    const want = ['up'];
    if (high && dh < 9) want.push('jump');
    input.hold(dh < 0.8 && !high ? [] : want);
    if (high && dh < 9 && b.ground && ((simT * 60) | 0) % 20 === 0) input.press('jump');
    const r = step(yaw);
    if (TRACE === tg.name && ((simT * 60) | 0) % 15 === 0) console.log(`  ${(simT - t0).toFixed(2)}s st ${ctrl.st} pos ${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)} target ${tg.x.toFixed(1)},${tg.y.toFixed(1)},${tg.z.toFixed(1)} dh ${dh.toFixed(1)} chakra ${ctrl.chakra.toFixed(0)} hold ${[...input.down]}`);
    if (r === 'fall') {
      results.falls.push(`${tg.name}: fell at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`);
      return 'reset';
    }
    if (r === 'buried') {
      results.buried.push(`${tg.name}: inside a collider at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`);
      return 'reset';
    }
    if (r === 'oob') {
      results.oob.push(`${tg.name}: out of bounds at ${b.x.toFixed(1)},${b.z.toFixed(1)}`);
      return 'reset';
    }
    if (simT - lastCheck > 0.8) {
      const d = Math.hypot(dh, (tg.y - b.y) * 0.5);
      if (d > lastD - 0.3) {
        stalls++;
        // blocked: hop (onto steps, over logs), then sidestep round the obstacle
        input.press('jump');
        if (stalls % 3 === 2) {
          const side = stalls % 6 < 3 ? 'left' : 'right';
          input.hold(['up', side]);
          for (let i = 0; i < 30; i++) step(yaw);
        }
        if (stalls >= 5 && stalls % 5 === 0 && trappedHere()) {
          results.trapped.push(`${tg.name}: trapped at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`);
          return 'reset';
        }
      } else stalls = Math.max(0, stalls - 1);
      lastD = d;
      lastCheck = simT;
    }
  }
  return false;
}

function nearestSpawn(x, z) {
  let best = map.spawns[0], bd = Infinity;
  for (const s of map.spawns) {
    const d = Math.hypot(s.p[0] - x, s.p[2] - z);
    if (d < bd) (bd = d), (best = s);
  }
  return best;
}

// nearest-neighbour tour, ground cells first (they connect everything), then the climbs
const t0 = Date.now();
const todo = [...targets];
while (todo.length) {
  const b = ctrl.body;
  let bi = 0, bd = Infinity;
  for (const [i, t] of todo.entries()) {
    const d = Math.hypot(t.x - b.x, t.z - b.z) + (t.kind === 'ground' ? 0 : 25);
    if (d < bd) (bd = d), (bi = i);
  }
  const tg = todo.splice(bi, 1)[0];
  const r = go(tg);
  if (r === true) results.reached.push(tg);
  else {
    results.missed.push(tg);
    if (VERBOSE) console.log(`  missed ${tg.name} (${tg.kind}) from ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`);
    // start the next target from a known place (a failed climb can leave us anywhere)
    const s = r === 'reset' ? nearestSpawn(b.x, b.z) : null;
    if (s) ctrl.reset([...s.p], s.yaw);
  }
}

// ---- report
const by = (k) => [results.reached.filter((t) => t.kind === k).length, targets.filter((t) => t.kind === k).length];
const pct = ([a, n]) => `${a}/${n} (${n ? Math.round((a / n) * 100) : 100}%)`;
console.log(`map walk: ${targets.length} targets, ${(simT / 60).toFixed(1)} sim minutes in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`  ground cells reached ${pct(by('ground'))}, high cells ${pct(by('high'))}, branches ${pct(by('branch'))}, tree crowns ${pct(by('crown'))}, roofs ${pct(by('roof'))}`);
for (const k of ['falls', 'oob', 'trapped', 'buried']) for (const m of results[k]) console.log(`  ${k.toUpperCase()}: ${m}`);
const unreachedGround = results.missed.filter((t) => t.kind === 'ground');
for (const t of unreachedGround) console.log(`  unreached ground: ${t.name} (y ${t.y.toFixed(1)})`);
if (VERBOSE) for (const t of results.missed.filter((t) => t.kind !== 'ground')) console.log(`  unreached ${t.kind}: ${t.name}`);
const [gr, gn] = by('ground');
const ok = !results.falls.length && !results.oob.length && !results.trapped.length && !results.buried.length && gr / gn >= 0.9;
console.log(`${ok ? 'PASS' : 'FAIL'}  no falls through the world (${results.falls.length}), none out of bounds (${results.oob.length}), no trapped spots (${results.trapped.length}), never inside a collider (${results.buried.length}), >= 90% of the ground reached`);
process.exit(ok ? 0 : 1);
