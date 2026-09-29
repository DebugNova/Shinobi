// Tsukuyomi review shots: A (Itachi) casts on B (Naruto) GAP metres away; full-size screenshots at set times after the
// capture reached each screen: A's (the capture round B, the eye before him; A's camera off to the side so B shows
// past him) and B's (the genjutsu's world). One contact sheet per screen (scripts/test/sheet.mjs).
// usage: node scripts/debug/tsushots.mjs <url> <outDir> [w=1280] [h=720]
//   env: TA="0.05,0.2,..." / TB="..." (seconds after the capture), GAP (m, 7), X / Z (A's spot, a clear lane: -44, 58),
//   CH_B (B's character, naruto), AVIEW (studio json for A's camera; '' = the game camera)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [url = 'http://localhost:3104/', outDir = 'shots/tsu', W = '1280', H = '720'] = process.argv.slice(2);
const TA = (process.env.TA || '-0.12,0.05,0.2,0.45,0.75,1.0,1.3,1.8,3.0').split(',').map(Number);
const TB = (process.env.TB || '0.25,0.45,0.7,0.95,1.4,1.9,2.3,2.6,3.1,3.5,4.0,4.5').split(',').map(Number);
const GAP = +(process.env.GAP || 7), X = +(process.env.X ?? -44), Z = +(process.env.Z ?? 58);
const AVIEW = process.env.AVIEW ?? '{ yaw: Math.PI - 0.5, dist: 3.4, h: 1.35, pitch: 0.1, fov: 50 }';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name, ch) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: +W, height: +H });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(`[${name}] PAGEERROR ${e.message}`); });
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
await A.p.evaluate((id) => { const r = __game.remotes.get(id); if (r?.fighter) __game.ctrl.lockTarget = { id, x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, dead: false }; }, idB);
if (AVIEW) await A.p.evaluate(`__game.studio = ${AVIEW}`);
// the capture's time on each screen: when its hitr arrived (performance clock of that page)
const HOOK = `window.__cap = null; __game.net.on('hitr', (m) => { if (String(m.m) === 'tsukuyomi:main' && window.__cap === null) window.__cap = performance.now(); }); 0`;
await A.p.evaluate(HOOK);
await B.p.evaluate(HOOK);
await sleep(300);
const t0 = Date.now();
await A.p.evaluate(() => __game.input.press('jutsu2'));
// A's shots before the capture (negative times) are taken from the press, at the gaze frame's 0.3 s
const shoot = async (P, times, tag) => {
  const files = [];
  const cap = () => P.p.evaluate(() => window.__cap);
  for (const t of times) {
    let base = await cap();
    if (t >= 0) {
      while (base === null && Date.now() - t0 < 3000) {
        await sleep(5);
        base = await cap();
      }
      if (base === null) break;
      await P.p.waitForFunction((b, t) => performance.now() >= b + t * 1000, { polling: 'raf', timeout: 8000 }, base, t);
    } else await sleep(Math.max(0, t0 + (0.3 + t) * 1000 - Date.now()));
    const f = `${outDir}/${tag}_${String(t).replace('-', 'm')}.png`;
    await P.p.screenshot({ path: f });
    files.push(f);
  }
  return files;
};
const [fa, fb] = await Promise.all([shoot(A, TA, 'A'), shoot(B, TB, 'B')]);
await Promise.all([A.b.close(), B.b.close()]);
for (const [files, tag] of [[fa, 'A'], [fb, 'B']]) {
  if (!files.length) continue;
  execFileSync('node', ['scripts/test/sheet.mjs', `${outDir}/sheet_${tag}.png`, '3', ...files]);
  console.log(`wrote ${outDir}/sheet_${tag}.png (${files.length} shots)`);
}
