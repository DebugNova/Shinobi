// Madara's Sharingan Genjutsu review shots: A (Madara) casts X on B (Naruto) GAP metres away. A's screen at set times
// after the capture reached it (the cast, his eyes, the eye thrown before him, the capture and the mark on B; A's camera
// off to the side), B's screen (the vision) with its clock held at each time (exact frames, gotcha 60). One contact
// sheet per screen (scripts/test/sheet.mjs).
// usage: node scripts/debug/mgenshots.mjs <url> <outDir> [w=1280] [h=720]
//   env: TA="..." / TB="..." (seconds after the capture), GAP (m, 7), X / Z (A's spot, a clear lane: -44, 58),
//   CH_B (B's character, naruto), AVIEW (studio json for A's camera; '' = the game camera), LIVE=1 (B's clock not held)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [url = 'http://localhost:3104/', outDir = 'shots/mgen', W = '1280', H = '720'] = process.argv.slice(2);
const TA = (process.env.TA || '-0.2,0.0,0.15,0.4,0.8,1.5').split(',').map(Number);
const TB = (process.env.TB || '0.05,0.15,0.3,0.45,0.6,0.9,1.2,1.26,1.32,1.4,1.6,1.85,2.05,2.3,2.45,2.5,2.6,2.75,2.9').split(',').map(Number);
const GAP = +(process.env.GAP || 7), X = +(process.env.X ?? -44), Z = +(process.env.Z ?? 58);
const AVIEW = process.env.AVIEW ?? '{ yaw: Math.PI - 0.5, dist: 3.4, h: 1.35, pitch: 0.1, fov: 50 }';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name, ch) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: +W, height: +H });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(`[${name}] PAGEERROR ${e.message}`); });
  p.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock|naruto\.vrm/.test(t)) console.log(`[${name}] console: ${t.slice(0, 300)}`); });
  await p.goto(`${url}?autojoin=1&pw=HUNNY&name=${name}&ch=${ch}`, { waitUntil: 'load' });
  await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}
fs.mkdirSync(outDir, { recursive: true });
const [A, B] = await Promise.all([client('Madara', 'madara'), client('Target', process.env.CH_B || 'naruto')]);
await sleep(2500);
const idB = await B.p.evaluate(() => __game.net.id);
await A.p.evaluate(({ X, Z }) => { __game.teleport(X, Z, 0); __game.ctrl.chakra = 100; __game.jutsu.ready = {}; }, { X, Z });
await B.p.evaluate(({ X, Z, GAP }) => { __game.teleport(X, Z - GAP, Math.PI); }, { X, Z, GAP });
await sleep(1400);
await A.p.evaluate((id) => { const r = __game.remotes.get(id); if (r?.fighter) __game.ctrl.lockTarget = { id, x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, dead: false }; }, idB);
if (AVIEW) await A.p.evaluate(`__game.studio = ${AVIEW}`);
// the capture's time on each screen: when its hitr arrived (performance clock of that page); B holds its vision's clock
const HOOK = `window.__cap = null; __game.net.on('hitr', (m) => { if (String(m.m) === 'sharinganGenjutsu:main' && window.__cap === null) { window.__cap = performance.now(); if (window.__holdVision) __game.jutsu.madara.gen.vision.hold = 0; } }); 0`;
await A.p.evaluate(HOOK);
await B.p.evaluate(`window.__holdVision = ${process.env.LIVE ? 'false' : 'true'}; ${HOOK}`);
await sleep(300);
const t0 = Date.now();
await A.p.evaluate(() => __game.input.press('jutsu4'));
const raf = (P, n = 3) => P.p.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shoot = async (P, times, tag, held) => {
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
      if (held) {
        await P.p.evaluate((t) => { __game.jutsu.madara.gen.vision.hold = t; }, t);
        await raf(P, 3);
      } else await P.p.waitForFunction((b, t) => performance.now() >= b + t * 1000, { polling: 'raf', timeout: 8000 }, base, t);
    } else await sleep(Math.max(0, t0 + (0.27 + t) * 1000 - Date.now()));
    const f = `${outDir}/${tag}_${String(t).replace('-', 'm')}.png`;
    await P.p.screenshot({ path: f });
    files.push(f);
  }
  if (held) await P.p.evaluate(() => { __game.jutsu.madara.gen.vision.hold = null; });
  return files;
};
const [fa, fb] = await Promise.all([shoot(A, TA, 'A', false), shoot(B, TB, 'B', !process.env.LIVE)]);
await sleep(3500);
// everything given back on B's screen
const back = await B.p.evaluate(() => ({ S: !!__game.jutsu.madara.gen.vision.S, fov: __game.camera.fov, me: __game.player.root.visible, hud: document.querySelector('#hud')?.className }));
console.log('B after:', JSON.stringify(back));
await Promise.all([A.b.close(), B.b.close()]);
for (const [files, tag] of [[fa, 'A'], [fb, 'B']]) {
  if (!files.length) continue;
  execFileSync('node', ['scripts/test/sheet.mjs', `${outDir}/sheet_${tag}.png`, '4', ...files]);
  console.log(`wrote ${outDir}/sheet_${tag}.png (${files.length} shots)`);
}
