// Amaterasu's cinematic review shots: A (Itachi) casts his ultimate on B GAP metres away; full-size screenshots of
// BOTH screens at the same moments of the cinematic's timeline (seconds after the press on the server clock: each page
// reads its own cine.time(), so the two sheets must show the same frames). One contact sheet per screen.
// usage: node scripts/debug/amashots.mjs <url> <outDir> [w=1280] [h=720]
//   env: T="0.3,0.6,..." (timeline seconds), GAP (m, 9), X / Z (A's spot, a clear lane: -44, 58), CH_B (naruto),
//   ONLY=A|B (one screen), HOLD=1: the cinematic's clock held at each time (exact frames of its look; the fighters and
//   particles keep moving; the real run's timing is the test's: scripts/test/itachi.mjs)
// The server needs a full gauge: SHINOBI_ULT=1 (the :3104 test server).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [url = 'http://localhost:3104/', outDir = 'shots/ama', W = '1280', H = '720'] = process.argv.slice(2);
const T = (process.env.T || '0.3,0.7,1.0,1.4,1.9,2.3,2.45,2.6,2.85,3.1,3.35,3.5,3.7,3.9,4.1,4.22,4.35,4.5,4.65,4.8,5.0,5.2,5.5').split(',').map(Number);
const GAP = +(process.env.GAP || 9), X = +(process.env.X ?? -44), Z = +(process.env.Z ?? 58);
const ONLY = process.env.ONLY || '';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name, ch) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: +W, height: +H });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(`[${name}] PAGEERROR ${e.message}`); });
  p.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID|WARNING|cine end/.test(t) && !/404|Pointer Lock|naruto\.vrm/.test(t)) console.log(`[${name}] ${t.slice(0, 400)}`); });
  await p.goto(`${url}?autojoin=1&pw=HUNNY&name=${name}&ch=${ch}`, { waitUntil: 'load' });
  await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}
fs.mkdirSync(outDir, { recursive: true });
const [A, B] = await Promise.all([client('Itachi', 'itachi'), client('Target', process.env.CH_B || 'naruto')]);
await sleep(2500);
const idB = await B.p.evaluate(() => __game.net.id);
await A.p.evaluate(({ X, Z }) => { __game.teleport(X, Z, 0); __game.ctrl.chakra = 100; __game.jutsu.ready = {}; }, { X, Z });
await B.p.evaluate(({ X, Z, GAP }) => { __game.teleport(X, Z - GAP, Math.PI); }, { X, Z, GAP });
await sleep(1400);
await A.p.evaluate((id) => { const r = __game.remotes.get(id); if (r?.fighter) __game.ctrl.lockTarget = { id, x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, dead: false }; if (__game.gauge) __game.gauge.u = 100; }, idB);
const progs0 = await Promise.all([A.p, B.p].map((p) => p.evaluate(() => __game.renderer.info.programs.length)));
if (process.env.TRACE) for (const P of [A, B]) await P.p.evaluate(() => { const c = __game.jutsu.itachi.cine, e = c.end.bind(c); c.end = () => { console.log('cine end at ' + c.time().toFixed(3) + ' ' + new Error().stack.split(String.fromCharCode(10)).slice(1, 4).join(' | ')); e(); }; });
await A.p.evaluate(() => __game.input.press('ult'));
const shoot = async (P, tag) => {
  const files = [];
  for (const t of T) {
    try {
      if (process.env.HOLD) {
        await P.p.waitForFunction(() => __game.jutsu.itachi.cine.time() >= 0.05, { polling: 'raf', timeout: 9000 });
        await P.p.evaluate((t) => { __game.jutsu.itachi.cine.hold = t; }, t);
        await P.p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
      }
      await P.p.waitForFunction((t) => __game.jutsu.itachi.cine.time() >= t, { polling: 'raf', timeout: 9000 }, t);
    } catch {
      console.log(`[${tag}] never reached ${t} s (cine ${await P.p.evaluate(() => __game.jutsu.itachi.cine.time())})`);
      break;
    }
    const f = `${outDir}/${tag}_${t.toFixed(2)}.png`;
    await P.p.screenshot({ path: f });
    files.push(f);
  }
  return files;
};
const [fa, fb] = await Promise.all([ONLY === 'B' ? [] : shoot(A, 'A'), ONLY === 'A' ? [] : shoot(B, 'B')]);
await sleep(1500);
const progs1 = await Promise.all([A.p, B.p].map((p) => p.evaluate(() => __game.renderer.info.programs.length)));
console.log(`programs A ${progs0[0]} -> ${progs1[0]}, B ${progs0[1]} -> ${progs1[1]}`);
await Promise.all([A.b.close(), B.b.close()]);
for (const [files, tag] of [[fa, 'A'], [fb, 'B']]) {
  if (!files.length) continue;
  execFileSync('node', ['scripts/test/sheet.mjs', `${outDir}/sheet_${tag}.png`, '4', ...files]);
  console.log(`wrote ${outDir}/sheet_${tag}.png (${files.length} shots)`);
}
