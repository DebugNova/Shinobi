// Itachi's M1 strings at real speed against a real victim (two clients, one browser each): every hit of each string
// is confirmed by the server, nothing is rejected, HP agrees on both screens, the reactions are the ones the data asks
// for (the launch, the spike, the knockback), the crow warps end where they should (behind / above the victim) and
// the victim's own screen saw the same reactions. PASS/FAIL per string.
//   stand  I1-I6: presses through the launcher: the crow finisher
//   juggle I1-I5, then (after the launcher's leap) the air string IA1-IA5: a 10-hit juggle
//   run    R1-R5 out of a sprint
// usage: node scripts/test/itachicombo.mjs [url=http://localhost:3104/] [stand,juggle,run]
// The server: SHINOBI_HP=600 SHINOBI_MATCH=300,10,2 (at 0 ms and with SHINOBI_LAG=200,40,1).
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3104/';
const ONLY = (process.argv[3] || 'stand,juggle,run').split(',');
const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};
async function client(name, ch) {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args });
  const p = await b.newPage();
  await p.setViewport({ width: 800, height: 450 });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(`[${name}] PAGEERROR ${e.message}`); });
  p.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock/.test(t)) console.log(`[${name}] console: ${t.slice(0, 200)}`); });
  await p.goto(`${URL}?autojoin=1&pw=HUNNY&name=${name}&grass=0&ch=${ch}`, { waitUntil: 'load' });
  await p.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}
const status = await fetch(new globalThis.URL('/api/status', URL)).then((r) => r.json()).catch(() => null);
console.log(`server lag: ${JSON.stringify(status?.lag)}`);
const [A, B] = await Promise.all([client('Itachi', 'itachi'), client('Victim', process.env.VCH || 'naruto')]);
await sleep(3500); // (the match starts once two are in: everyone respawns)
const idA = await A.p.evaluate(() => __game.net.id), idB = await B.p.evaluate(() => __game.net.id);
await A.p.evaluate(`window.__hitr = []; window.__hitx = []; __game.net.on('hitr', (m) => { if (m.a === __game.net.id) window.__hitr.push({ m: m.m, r: m.r, v: m.v }); }); __game.net.on('hitx', (m) => window.__hitx.push(m.why)); 0`);
await B.p.evaluate(`window.__got = []; __game.net.on('hitr', (m) => { if (m.v === __game.net.id) window.__got.push({ m: m.m, r: m.r }); }); 0`);
// the moves A's own screen started, and where the warps left it relative to the victim
await A.p.evaluate(`window.__moves = []; window.__warps = []; (function loop() {
  const g = __game, a = g.ctrl.action, v = g.remotes.get(${idB})?.fighter;
  if (a && a.M && a.id !== window.__lastId) { window.__moves.push(a.id); window.__lastId = a.id; }
  if (a && a.M && v && !a.__c && a.frame >= a.M.startup) { a.__c = 1; const b = g.ctrl.body; (window.__contact ||= []).push(a.id + ':' + Math.hypot(b.x - v.pos.x, b.z - v.pos.z).toFixed(2) + '/' + (b.y - v.pos.y).toFixed(2) + (a.hit ? 'h' : '') + (a.target ? '' : ' notarget')); }
  if (!a || !a.M) window.__lastId = null;
  if (a && a.M && a.M.warp && v && !a.__logged && a.frame >= a.M.startup - 0.5) {
    a.__logged = true;
    const b = g.ctrl.body, dx = b.x - v.pos.x, dz = b.z - v.pos.z, fx = -Math.sin(g.ctrl.yaw), fz = -Math.cos(g.ctrl.yaw);
    window.__warps.push({ id: a.id, d: +Math.hypot(dx, dz).toFixed(2), dy: +(b.y - v.pos.y).toFixed(2), facing: +((-dx * fx - dz * fz) / (Math.hypot(dx, dz) || 1)).toFixed(2) });
  }
  requestAnimationFrame(loop);
})(); 0`);
const place = async (run) => {
  await B.p.evaluate(() => __game.teleport(-44, 40, 0));
  await A.p.evaluate((run) => __game.teleport(-44, run ? 49 : 42.4, 0), run);
  await sleep(1400);
  // (full HP for each string: a KO mid-string would end it)
  await A.p.evaluate(() => { window.__hitr.length = 0; window.__hitx.length = 0; window.__moves.length = 0; window.__warps.length = 0; window.__contact = []; });
  await B.p.evaluate(() => { window.__got.length = 0; });
};
const press = (plan) => A.p.evaluate(async (plan) => {
  const g = __game, s = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const [what, ms] of plan) {
    if (what === 'run') g.hold(['up']);
    else if (what === 'stop') g.hold([]);
    // (the launcher's leap is over and he hangs in the air: the air string can start)
    else if (what === 'waitAir') { const t0 = performance.now(); while (performance.now() - t0 < 1500 && !(!g.ctrl.action && !g.ctrl.grounded)) await s(8); }
    else g.input.press(what);
    await s(ms);
  }
}, plan);
const settle = async () => {
  await sleep(2600);
  const a = await A.p.evaluate(() => ({ hitr: window.__hitr, hitx: window.__hitx, moves: window.__moves, warps: window.__warps, contact: window.__contact }));
  const b = await B.p.evaluate(() => ({ got: window.__got, hp: __game.hp }));
  const aSees = await A.p.evaluate((id) => __game.remotes.get(id)?.info.hp, idB);
  return { ...a, ...b, aSees };
};
const R = { launch: 3, knockback: 4, spike: 5 };
async function run(name, plan, want, reacts) {
  await place(name === 'run');
  await press(plan);
  const o = await settle();
  const got = o.hitr.map((h) => h.m);
  console.log(`  [${name}] moves ${o.moves.join(' ')} | confirmed ${got.join(' ')} | rejected ${o.hitx.join(',') || '-'} | warps ${JSON.stringify(o.warps)}
    contact (distance/height at the first active frame): ${(o.contact || []).join(' ')}`);
  check(`${name}: every hit confirmed (${want.join(' ')})`, want.every((m) => got.includes(m)), `missing ${want.filter((m) => !got.includes(m)).join(' ') || '-'}`);
  check(`${name}: nothing rejected by the server`, o.hitx.length === 0, o.hitx.join(','));
  check(`${name}: HP agrees on both screens`, o.hp === o.aSees && o.hp < 600, `victim ${o.hp}, attacker sees ${o.aSees}`);
  for (const [m, r] of reacts) check(`${name}: ${m} ${Object.keys(R).find((k) => R[k] === r)}s`, o.hitr.some((h) => h.m === m && h.r === r) && o.got.some((h) => h.m === m && h.r === r));
  for (const w of o.warps) {
    const M = w.id;
    const ok = w.facing > 0.7 && w.d < 1.6 && (M === 'I6' || M === 'IA5' ? w.dy > 0.2 : true);
    check(`${name}: the ${M} warp ends by the victim, facing it`, ok, JSON.stringify(w));
  }
}
const P = 'attack';
if (ONLY.includes('stand')) await run('stand', [[P, 330], [P, 360], [P, 360], [P, 360], [P, 380], [P, 330], [P, 330]], ['I1', 'I2', 'I3', 'I4', 'I5', 'I6'], [['I5', R.launch], ['I6', R.spike]]);
if (ONLY.includes('juggle')) await run('juggle', [[P, 330], [P, 360], [P, 360], [P, 360], [P, 200], ['waitAir', 0], [P, 280], [P, 280], [P, 300], [P, 330], [P, 330], [P, 330]], ['I1', 'I2', 'I3', 'I4', 'I5', 'IA1', 'IA2', 'IA3', 'IA4', 'IA5'], [['I5', R.launch], ['IA5', R.spike]]);
if (ONLY.includes('run')) await run('run', [['run', 700], [P, 120], ['stop', 230], [P, 340], [P, 340], [P, 360], [P, 360], [P, 300]], ['R1', 'R2', 'R3', 'R4', 'R5'], [['R5', R.knockback]]);
const fails = results.filter(([, ok]) => !ok).length;
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await A.b.close();
await B.b.close();
process.exit(fails ? 1 : 0);
