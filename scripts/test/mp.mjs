// Two real clients (two Chrome instances) against a running server: join, see each other, movement sync (remote
// position error while running and after stopping), jump/dash replication, leave. Prints PASS/FAIL per check.
// usage: node scripts/test/mp.mjs [url=http://localhost:3101/] [outDir=shots]
// Run it at 0 ms and against a server started with SHINOBI_LAG=200,40,1.
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3101/';
const OUT = process.argv[3] || 'shots';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};

async function client(name) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 960, height: 540 });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(`[${name}] PAGEERROR ${e.message}`); });
  await p.goto(`${URL}?autojoin=1&name=${name}`, { waitUntil: 'load' });
  await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}

const status = await fetch(new globalThis.URL('/api/status', URL)).then((r) => r.json()).catch(() => null);
console.log(`server: ${status ? `${status.players} players, lag ${JSON.stringify(status.lag)}` : 'unreachable'}`);
const [A, B] = await Promise.all([client('Alpha'), client('Bravo')]);
await sleep(2500);
const info = (pg) => pg.evaluate(() => ({ id: __game.net.id, rtt: Math.round(__game.net.rtt), interp: Math.round(__game.net.interp), remotes: [...__game.remotes.values()].map((r) => ({ id: r.info.id, name: r.info.name, ok: !!r.fighter })) }));
const ia = await info(A.p), ib = await info(B.p);
check('A sees B', ia.remotes.some((r) => r.id === ib.id && r.ok), JSON.stringify(ia));
check('B sees A', ib.remotes.some((r) => r.id === ia.id && r.ok), JSON.stringify(ib));

// both on the training field, B runs past A
await A.p.evaluate(() => __game.teleport(-40, 32, Math.PI / 2));
await B.p.evaluate(() => __game.teleport(-46, 40, -Math.PI / 2));
await sleep(800);
const bPos = () => B.p.evaluate(() => { const b = __game.ctrl.body; return [b.x, b.y, b.z, __game.net.serverNow()]; });
const aSeesB = (id) => A.p.evaluate((id) => { const r = __game.remotes.get(id); return r?.fighter ? [r.fighter.pos.x, r.fighter.pos.y, r.fighter.pos.z, __game.net.serverNow(), __game.net.interp] : null; }, id);
// record B's true path (server clock) so A's view can be compared with where B was at A's render time
const upB = await B.p.evaluate(() => __game.net.rtt / 2);
const path = [];
const rec = setInterval(async () => path.push(await bPos()), 20);
await B.p.evaluate(() => __game.hold(['up']));
const errs = [];
for (let i = 0; i < 20; i++) {
  await sleep(90);
  const a = await aSeesB(ib.id);
  if (!a || path.length < 5) continue;
  // where B was at A's render time (serverNow - interp) minus B's uplink (states are stamped when they reach the
  // server; nothing can show B's position sooner than its upload latency)
  const t = a[3] - a[4] - upB;
  let best = null;
  for (let k = 1; k < path.length; k++) {
    if (path[k - 1][3] <= t && path[k][3] >= t) {
      const f = (t - path[k - 1][3]) / (path[k][3] - path[k - 1][3] || 1);
      best = [0, 1, 2].map((j) => path[k - 1][j] + (path[k][j] - path[k - 1][j]) * f);
    }
  }
  if (best) errs.push(Math.hypot(a[0] - best[0], a[2] - best[2]));
}
await B.p.evaluate(() => __game.hold([]));
clearInterval(rec);
errs.sort((x, y) => x - y);
const med = errs[Math.floor(errs.length / 2)] ?? 99, p90 = errs[Math.floor(errs.length * 0.9)] ?? 99;
// the reference path is sampled from outside the page every ~20 ms, so a little error is measurement noise
check('remote path while running (vs the true path at render time)', med < 0.35 && p90 < 0.8, `median ${med.toFixed(2)} m, p90 ${p90.toFixed(2)} m, n=${errs.length}`);
await sleep(1500);
const bp = await bPos(), ap = await aSeesB(ib.id);
const settled = Math.hypot(bp[0] - ap[0], bp[2] - ap[2]);
check('remote settles where it stopped', settled < 0.05, `${settled.toFixed(3)} m`);
await A.p.screenshot({ path: `${OUT}/mp_A.png` });

// a jump replicates (B's airborne state reaches A)
await B.p.evaluate(() => __game.hold(['jump']));
let sawAir = false;
for (let i = 0; i < 15 && !sawAir; i++) {
  await sleep(60);
  sawAir = await A.p.evaluate((id) => { const r = __game.remotes.get(id); if (!r) return false; const p = r.fighter.pos; return r.view.st === 1 && p.y - __game.world.ground(p.x, p.z, p.y, {}).y > 0.3; }, ib.id).catch(() => false);
}
await B.p.evaluate(() => __game.hold([]));
check('jump replicates', sawAir);

// leave: A drops B
await B.b.close();
let gone = false;
for (let i = 0; i < 40 && !gone; i++) {
  await sleep(250);
  gone = await A.p.evaluate((id) => !__game.remotes.has(id), ib.id);
}
check('leave removes the remote', gone);
const net = await A.p.evaluate(() => ({ rtt: __game.net.rtt, interp: __game.net.interp, ...__game.net.stats }));
console.log(`A net: rtt ${net.rtt.toFixed(0)} ms, interp ${net.interp.toFixed(0)} ms, in ${(net.bytesIn / 1024).toFixed(0)} KB (${net.recv} msgs), out ${(net.bytesOut / 1024).toFixed(0)} KB (${net.sent} msgs)`);
await A.b.close();
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
