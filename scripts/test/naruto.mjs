// Naruto's kit (Jiraiya training era), two clients: A plays Naruto, B (Naruto too) is the target. Each ability must do
// what it says on both screens, the damage must agree, and what moves must be in the same place on both. PASS/FAIL.
// usage: node scripts/test/naruto.mjs [url=http://localhost:3104/] [only=clones,rasengan,rush,defense]
// The server needs HP 600 (the 3104 / 3102 test servers): SHINOBI_HP=600 SHINOBI_MATCH=300,10,2
//   clones    Q: three clones appear on both screens, drawn where their caster runs them (net of the uplink), they
//             hit B (HP agrees), B's hits on a clone reach both screens with the same HP, a beaten clone bursts on
//             both, all gone after their life
//   rasengan  E held to the Big Rasengan: the hit, B thrown back 8+ m, the same landing spot on both screens; a tap:
//             the plain Rasengan
//   rush      X: B sees the three clones charge out from A, two strikes + the launch + the finisher's spike, all
//             confirmed; B dashing sideways as they close in is not hit; B hitting A in the seal bursts the clones
//   defense   G: uncaught, A re-forms ~6 m away (the same spot on B's screen); caught (B strikes inside the window):
//             the clone takes it, A re-forms behind B, B is staggered, A takes no damage
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3104/';
const ONLY = (process.argv[3] || 'clones,rasengan,rush,defense').split(',');
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};
const errors = [];
async function client(name) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 960, height: 540 });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) errors.push(`[${name}] ${e.message}`); });
  p.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock|naruto\.vrm/.test(t)) errors.push(`[${name}] ${t.slice(0, 200)}`); });
  await p.goto(`${URL}?autojoin=1&name=${name}&ch=naruto`, { waitUntil: 'load' });
  await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}
const status = await fetch(new globalThis.URL('/api/status', URL)).then((r) => r.json()).catch(() => null);
const LAG = status?.lag?.rtt || 0;
console.log(`server lag: ${JSON.stringify(status?.lag)}`);
const [A, B] = await Promise.all([client('Naruto'), client('Target')]);
await sleep(2500);
const idA = await A.p.evaluate(() => __game.net.id), idB = await B.p.evaluate(() => __game.net.id);
const LOG = `window.__hl = []; __game.net.on('hitr', (m) => window.__hl.push({ a: m.a, v: m.v, m: String(m.m), d: m.d, r: m.r, hp: m.hp })); window.__hx = []; __game.net.on('hitx', (m) => window.__hx.push(m.why)); window.__ch = []; __game.net.on('ch', (m) => window.__ch.push({ s: m.s, hp: m.hp, d: m.d })); window.__acts = []; __game.net.on('a', (m) => window.__acts.push({ id: m.id, k: m.k, m: m.m, n: m.n, f: m.f, s: m.s, o: m.o, why: m.why })); 0`;
await A.p.evaluate(LOG);
await B.p.evaluate(LOG);
// a clear flat lane (scripts/debug/lanes.mjs, los.mjs): A at (x, z) facing -z, B `gap` m in front of A facing A
const place = async (gap, x = -44, z = 58) => {
  await A.p.evaluate(({ x, z }) => { __game.hold([]); __game.teleport(x, z, 0); __game.ctrl.chakra = 100; __game.jutsu.ready = {}; __game.ctrl.lockTarget = null; }, { x, z });
  await B.p.evaluate(({ x, z, gap }) => { __game.hold([]); __game.teleport(x, z - gap, Math.PI); __game.ctrl.chakra = 100; __game.ctrl.lockTarget = null; }, { x, z, gap });
  await sleep(1300);
  await A.p.evaluate((id) => { const r = __game.remotes.get(id); if (r?.fighter) __game.ctrl.lockTarget = { id, x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, dead: false }; }, idB);
};
// the server's cooldowns (the client's are reset by place): each jutsu waits its own
const lastCast = {};
const cast = async (key, cd, js = null) => {
  const wait = (lastCast[key] || 0) + cd * 1000 + 400 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCast[key] = Date.now();
  await A.p.evaluate(js || ((k) => __game.input.press(k)), key);
};
const clear = () => Promise.all([A.p, B.p].map((p) => p.evaluate('window.__hl.length = 0; window.__hx.length = 0; window.__ch.length = 0; window.__acts.length = 0; 0')));
const hits = (P, pre) => P.p.evaluate(({ id, pre }) => window.__hl.filter((h) => h.v === id && h.m.startsWith(pre)), { id: idB, pre });
const hpPair = async () => [await B.p.evaluate(() => __game.hp), await A.p.evaluate((id) => __game.remotes.get(id)?.info.hp, idB)];
// until: poll a page expression up to ms
const until = async (P, js, ms = 3000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (await P.p.evaluate(js)) return true;
  return false;
};
/** The median distance between B's drawn copies and A's own track of the same things, B's drawing shifted by the best
 *  uplink delay (0-300 ms): the remote side draws a state ~interp behind, stamped when it reached the server. */
function trackError(aRec, bRec) {
  const at = (slot, t) => {
    const r = aRec.filter((e) => e[1] === slot);
    for (let i = 1; i < r.length; i++) if (r[i][0] >= t) {
      const k = (t - r[i - 1][0]) / Math.max(1, r[i][0] - r[i - 1][0]);
      return [r[i - 1][2] + (r[i][2] - r[i - 1][2]) * k, r[i - 1][3] + (r[i][3] - r[i - 1][3]) * k];
    }
    return null;
  };
  let best = Infinity, bestShift = 0;
  for (let sh = 0; sh <= 300; sh += 10) {
    const errs = [];
    for (const b of bRec) {
      const a = at(b[1], b[0] - sh);
      if (a) errs.push(Math.hypot(a[0] - b[2], a[1] - b[3]));
    }
    if (errs.length < 20) continue;
    errs.sort((x, y) => x - y);
    const med = errs[Math.floor(errs.length / 2)];
    if (med < best) {
      best = med;
      bestShift = sh;
    }
  }
  return { med: best, shift: bestShift };
}

// ---------------------------------------------------------------- Q: Shadow Clone Jutsu
if (ONLY.includes('clones')) {
  console.log('--- Q Shadow Clone Jutsu');
  await place(7);
  await clear();
  // tracks: A's own clones on the server clock, B's drawn copies on its render clock
  await A.p.evaluate(`window.__tr = []; window.__trOn = true; (function loop(){ if (!window.__trOn) return; const g = __game; for (const c of g.jutsu.naruto.own?.list || []) if (!c.gone) window.__tr.push([g.net.serverNow(), c.slot, c.b.x, c.b.z]); requestAnimationFrame(loop); })(); 0`);
  await B.p.evaluate(`window.__tr = []; window.__trOn = true; (function loop(){ if (!window.__trOn) return; const g = __game; for (const c of g.jutsu.naruto.remote.values()) if (c.shown && !c.gone) window.__tr.push([g.net.renderTime(), c.slot, c.f.pos.x, c.f.pos.z]); requestAnimationFrame(loop); })(); 0`);
  await cast('jutsu1', 22);
  await sleep(1200);
  const nA = await A.p.evaluate(() => __game.jutsu.naruto.own?.list.filter((c) => !c.gone).length || 0);
  const nB = await B.p.evaluate(() => [...__game.jutsu.naruto.remote.values()].filter((c) => c.shown && !c.gone).length);
  check('three clones appear on the caster\'s screen and on the other', nA === 3 && nB === 3, `A ${nA}, B ${nB}`);
  // B beats a clone: it goes for the weakest one in reach (its M1 strings track it) until one bursts at 0 HP
  await B.p.evaluate(() => { __game.combat.log = []; });
  const beaten = () => B.p.evaluate(() => window.__acts.find((x) => x.m === 'shadowClones' && x.n === 2 && x.why === 'ko')?.s);
  let slot;
  for (let i = 0; i < 50 && slot === undefined; i++) {
    await B.p.evaluate(() => {
      const g = __game, me = g.ctrl.body;
      const cs = [...g.jutsu.naruto.remote.values()].filter((x) => x.shown && !x.gone);
      if (!cs.length) return;
      const c = cs.reduce((p, q) => (q.hp < p.hp ? q : p)), p = c.f.pos;
      // (a teleport ends the attack under way: only to get near it)
      if (Math.hypot(p.x - me.x, p.z - me.z) > 4) g.teleport(p.x, p.z + 1.0, 0);
      if (!g.ctrl.action) g.ctrl.yaw = Math.atan2(-(p.x - me.x), -(p.z - me.z));
      g.input.press('attack');
    });
    await sleep(160);
    slot = await beaten();
  }
  await sleep(300 + LAG);
  const chA = await A.p.evaluate(() => window.__ch.slice()), chB = await B.p.evaluate(() => window.__ch.slice());
  if (process.env.DETAIL) console.log('  B hit A', JSON.stringify(await A.p.evaluate((id) => window.__hl.filter((h) => h.a === id).map((h) => h.m), idB)), 'B stats', JSON.stringify(await B.p.evaluate(() => __game.combat.stats)), 'B log', JSON.stringify(await B.p.evaluate(() => __game.combat.log)));
  check('B\'s hits on the clones reach both screens (the same HP)', chB.length > 0 && chA.length === chB.length && chA.at(-1)?.hp === chB.at(-1)?.hp, `${chB.length} on B, ${chA.length} on A, hp ${chB.at(-1)?.hp} / ${chA.at(-1)?.hp}`);
  const goneA = slot !== undefined && (await A.p.evaluate((s) => !(__game.jutsu.naruto.own?.list || []).some((c) => c.slot === s && !c.gone), slot));
  const goneB = slot !== undefined && (await B.p.evaluate(({ s, id }) => !__game.jutsu.naruto.remote.has(`${id}:${s}`), { s: slot, id: idA }));
  // (under lag B's strings spread over the clones and may beat none inside their life: the burst is checked when one falls)
  if (LAG && slot === undefined) console.log('n/a   a clone beaten to 0 bursts on both screens  (no clone fell in the fight under lag)');
  else check('a clone beaten to 0 bursts on both screens', slot !== undefined && goneA && goneB, `slot ${slot}, A ${goneA}, B ${goneB}`);
  await sleep(300); // (the tracks and the clones' hits on B were recorded meanwhile)
  await Promise.all([A.p, B.p].map((p) => p.evaluate('window.__trOn = false')));
  const trA = await A.p.evaluate(() => window.__tr), trB = await B.p.evaluate(() => window.__tr);
  const te = trackError(trA, trB);
  check('the clones are drawn where their caster runs them', te.med < 0.3, `median ${(te.med * 100).toFixed(1)} cm, shift ${te.shift} ms`);
  const hB = await hits(B, 'shadowClones:'), hA = await hits(A, 'shadowClones:');
  const [hpB, hpAB] = await hpPair();
  check('the clones hit B (confirmed on both screens)', hB.length >= 2 && hA.length === hB.length, `${hB.length} hits on B, ${hA.length} on A`);
  check('B\'s HP agrees on both screens', hpB === hpAB && hpB < 600, `${hpB} / ${hpAB}`);
  const rej = await A.p.evaluate(() => window.__hx.slice());
  // (under lag a clone can swing before its caster's screen hears the server forced a knockdown: those few are refused)
  const late = rej.every((w) => w === 'invuln:down' || w === 'far-from-history') && rej.length <= hB.length / 3;
  check(LAG ? 'clone hits refused only for knockdowns heard late' : 'no clone hit refused', LAG ? late : !rej.length, rej.join(' '));
  await until(A, '!(__game.jutsu.naruto.own?.list || []).some((c) => !c.gone)', 8000);
  await sleep(300 + LAG);
  const leftA = await A.p.evaluate(() => (__game.jutsu.naruto.own?.list || []).filter((c) => !c.gone).length);
  const leftB = await B.p.evaluate(() => __game.jutsu.naruto.remote.size);
  check('all gone after their life on both screens', leftA === 0 && leftB === 0, `A ${leftA}, B ${leftB}`);
}

// ---------------------------------------------------------------- E: Rasengan
if (ONLY.includes('rasengan')) {
  console.log('--- E Rasengan');
  await sleep(2500);
  await place(7);
  await clear();
  const z0 = await B.p.evaluate(() => __game.ctrl.body.z);
  await cast('jutsu2', 11, () => __game.hold(['jutsu2']));
  await sleep(950);
  await A.p.evaluate(() => __game.hold([]));
  await sleep(1800 + LAG);
  const hB = await hits(B, 'rasengan'), hA = await hits(A, 'rasengan');
  check('the Big Rasengan hits (held to its full charge)', hB.length === 1 && hB[0].m === 'rasengan:big' && hA.length === 1, hB.map((h) => `${h.m} ${h.d}`).join(' '));
  const pB = await B.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.z]);
  const pAB = await A.p.evaluate((id) => { const f = __game.remotes.get(id)?.fighter; return f ? [f.pos.x, f.pos.z] : null; }, idB);
  check('B is thrown back 8+ m', Math.abs(pB[1] - z0) > 8, `${Math.abs(pB[1] - z0).toFixed(1)} m`);
  check('B lands in the same place on both screens', pAB && Math.hypot(pB[0] - pAB[0], pB[1] - pAB[1]) < 0.3, pAB ? `${(Math.hypot(pB[0] - pAB[0], pB[1] - pAB[1]) * 100).toFixed(1)} cm` : 'no B on A');
  const [hpB, hpAB] = await hpPair();
  check('B\'s HP agrees', hpB === hpAB, `${hpB} / ${hpAB}`);
  await sleep(2000);
  await place(7);
  await clear();
  await cast('jutsu2', 11, () => { __game.hold(['jutsu2']); setTimeout(() => __game.hold([]), 60); });
  await sleep(1600 + LAG);
  const tB = await hits(B, 'rasengan');
  check('a tap: the plain Rasengan', tB.length === 1 && tB[0].m === 'rasengan', tB.map((h) => `${h.m} ${h.d}`).join(' '));
}

// ---------------------------------------------------------------- X: Shadow Clone Rush
if (ONLY.includes('rush')) {
  console.log('--- X Shadow Clone Rush');
  await sleep(2500);
  await place(8);
  await clear();
  // B's view of the clones: which ones, how far from A when they appear, how close they get to B
  const WATCH = (id) => `window.__rc = new Map(); window.__rcOn = true; (function loop(){ if (!window.__rcOn) return; const g = __game, me = g.player.pos, a = g.remotes.get(${id})?.fighter?.pos;
    for (const R of g.jutsu.naruto.rushes) for (const c of R.clones) if (c.f && !c.done && c.f.root.visible) {
      const e = window.__rc.get(c.k) || { a: a ? Math.hypot(c.f.pos.x - a.x, c.f.pos.z - a.z) : 99, near: 99 };
      e.near = Math.min(e.near, Math.hypot(c.f.pos.x - me.x, c.f.pos.z - me.z)); window.__rc.set(c.k, e); }
    requestAnimationFrame(loop); })(); 0`;
  await B.p.evaluate(WATCH(idA));
  await cast('jutsu4', 20);
  await sleep(3000 + LAG);
  await B.p.evaluate('window.__rcOn = false');
  const seen = await B.p.evaluate(() => [...window.__rc.entries()]);
  check('B sees the three clones burst out beside A and charge in', seen.length === 3 && seen.every(([, e]) => e.a < 1.8 && e.near < 1.3), seen.map(([k, e]) => `${k}: ${e.a.toFixed(2)} m from A, ${e.near.toFixed(2)} m from B`).join(', '));
  const hB = await hits(B, ''), hA = await hits(A, '');
  const names = hB.map((h) => h.m);
  check('two strikes, the launch and the finisher land', names.filter((m) => m === 'clones:hit').length === 2 && names.includes('clones:launch') && names.includes('NR'), names.join(' '));
  check('the finisher spikes B', hB.find((h) => h.m === 'NR')?.r === 5);
  check('the same hits on A\'s screen', hA.length === hB.length);
  const dmg = hB.reduce((a, h) => a + (h.d || 0), 0);
  check('the whole Rush deals at most 130 (was ~190)', dmg > 0 && dmg <= 130, `${dmg}`);
  const rej = await A.p.evaluate(() => window.__hx.slice());
  check('no hit refused', !rej.length, rej.join(' '));
  const [hpB, hpAB] = await hpPair();
  check('B\'s HP agrees', hpB === hpAB, `${hpB} / ${hpAB}`);

  // a dash sideways as they close in: they turn too slowly to follow (B dashes when the first clone is ~3 m off)
  await sleep(3500);
  await place(10);
  await clear();
  await B.p.evaluate(`window.__dodge = 0; window.__dOn = true; (function loop(){ if (!window.__dOn) return; const g = __game, me = g.player.pos;
    let near = 99; for (const R of g.jutsu.naruto.rushes) for (const c of R.clones) if (c.f && !c.done && c.f.root.visible) near = Math.min(near, Math.hypot(c.f.pos.x - me.x, c.f.pos.z - me.z));
    if (!window.__dodge && near < 3.2) { window.__dodge = 1; g.hold(['left']); setTimeout(() => g.input.press('dash'), 16); setTimeout(() => g.hold([]), 420); }
    requestAnimationFrame(loop); })(); 0`);
  await cast('jutsu4', 20);
  await sleep(2800 + LAG);
  await B.p.evaluate('window.__dOn = false');
  const dodged = await B.p.evaluate(() => window.__dodge);
  const dh = await hits(B, 'clones');
  check('a dash sideways shakes the charge (no clone hit)', dodged === 1 && dh.length === 0, `dashed ${dodged}, ${dh.length} hits: ${dh.map((h) => h.m).join(' ')}`);

  // B hits A in the seal: A's clones burst on both screens, none strikes
  await sleep(3500);
  await place(1.5);
  await clear();
  await B.p.evaluate((id) => { const r = __game.remotes.get(id); __game.ctrl.lockTarget = { id, x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, dead: false }; }, idA);
  // (the target is B, 1.5 m in front: A casts, B punches at once)
  await cast('jutsu4', 20);
  await sleep(60);
  await B.p.evaluate(() => __game.input.press('attack'));
  await sleep(1600 + LAG);
  const hitA = await A.p.evaluate((id) => window.__hl.filter((h) => h.v === __game.net.id && h.a === id).length, idB);
  const liveA = await A.p.evaluate(() => __game.jutsu.naruto.rushes.length), liveB = await B.p.evaluate(() => __game.jutsu.naruto.rushes.length);
  const ch = await hits(B, 'clones');
  check('hit in the seal: A\'s clones burst, none strikes', hitA >= 1 && ch.length === 0 && liveA === 0 && liveB === 0, `A hit ${hitA}, clone hits ${ch.length}, rushes A ${liveA} B ${liveB}`);
}

// ---------------------------------------------------------------- G: Shadow Clone Substitution
if (ONLY.includes('defense')) {
  console.log('--- G Shadow Clone Substitution');
  await sleep(2500);
  await place(5);
  await clear();
  const p0 = await A.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.z]);
  await cast('jutsu3', 10);
  await sleep(1000 + LAG);
  const p1 = await A.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.z]);
  const pB = await B.p.evaluate((id) => { const f = __game.remotes.get(id)?.fighter; return f ? [f.pos.x, f.pos.z] : null; }, idA);
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  check('uncaught: A re-forms ~6 m away', moved > 4.5 && moved < 6.5, `${moved.toFixed(2)} m`);
  check('B sees A there', pB && Math.hypot(pB[0] - p1[0], pB[1] - p1[1]) < 0.3, pB ? `${(Math.hypot(pB[0] - p1[0], pB[1] - p1[1]) * 100).toFixed(1)} cm` : 'none');
  // caught: B strikes A inside the window
  await sleep(2000);
  await place(1.4);
  await clear();
  const hp0 = await A.p.evaluate(() => __game.hp);
  await B.p.evaluate((id) => { const r = __game.remotes.get(id); __game.ctrl.lockTarget = { id, x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, dead: false }; }, idA);
  await cast('jutsu3', 10);
  await sleep(40);
  const bAt = await B.p.evaluate(() => { __game.input.press('attack'); return [__game.ctrl.body.x, __game.ctrl.body.z]; });
  await sleep(1300 + LAG);
  const pa = await A.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.z]);
  const pbb = await B.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.z]);
  const hx = await B.p.evaluate(() => window.__hx.slice());
  check('the clone takes B\'s strike', hx.includes('decoy'), hx.join(' '));
  // B faced +z (toward A) when it struck: behind B is -z of where B was
  const behind = pa[1] < bAt[1] && Math.hypot(pa[0] - bAt[0], pa[1] - bAt[1]) < 2.2;
  check('A re-forms behind B', behind, `A ${pa.map((v) => v.toFixed(2))}, B struck from ${bAt.map((v) => v.toFixed(2))}, B now ${pbb.map((v) => v.toFixed(2))}`);
  const ctr = await hits(B, 'cloneDefense:counter'), ctrA = await hits(A, 'cloneDefense:counter');
  check('B is staggered on both screens (A\'s opening)', ctr.length === 1 && ctr[0].r === 2 && ctrA.length === 1, ctr.map((h) => `r${h.r}`).join(' '));
  const hp1 = await A.p.evaluate(() => __game.hp);
  check('A takes no damage', hp1 === hp0, `${hp0} -> ${hp1}`);
}

check('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
await A.b.close();
await B.b.close();
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
