// Naruto's shadow clones (Q) jumping up to a ledge / dropping off it after their target: shots from the caster's and
// the target's screens + a trace (the caster runs them: naruto.js own; the target draws them from the stream: remote)
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const URL = 'http://localhost:3101/';
const OUT = process.argv[2];
const CASE = process.argv[3] || 'up';
fs.mkdirSync(OUT, { recursive: true });
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 960, height: 540 });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(`[${name}] PAGEERROR ${e.message}`); });
  p.on('console', (m) => { if (/error/i.test(m.type())) console.log(`[${name}] ${m.text()}`); });
  await p.goto(`${URL}?autojoin=1&name=${name}`, { waitUntil: 'load' });
  await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}
const [A, B] = await Promise.all([client('Caster'), client('Target')]);
await sleep(2500);
const idA = await A.p.evaluate(() => __game.net.id);
if (CASE === 'up') {
  await A.p.evaluate(() => __game.teleport(-41, 28, Math.PI / 2));
  await B.p.evaluate(() => __game.teleport(-50, 28, -Math.PI / 2));
} else {
  await A.p.evaluate(() => __game.teleport(-50, 28, -Math.PI / 2));
  await B.p.evaluate(() => __game.teleport(-41, 28, Math.PI / 2));
}
await sleep(1500);
console.log('A', await A.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.y, __game.ctrl.body.z].map((v) => v.toFixed(2))), 'B', await B.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.y, __game.ctrl.body.z].map((v) => v.toFixed(2))));
// side view from the south of the ledge, on both screens
for (const P of [A, B]) await P.p.evaluate(() => { __game.timeScale = 1; });
await B.p.evaluate(`window.__cl = []; (function loop(){ const g = __game; for (const c of g.jutsu.naruto.remote.values()) if (c.owner === ${idA} && c.shown) window.__cl.push([Math.round(g.net.serverNow()), c.slot, 'remote', c.f.pos.x.toFixed(2), c.f.pos.y.toFixed(2), c.f.pos.z.toFixed(2), c.view.ground ? 1 : 0, c.f.anim.key, '-']); requestAnimationFrame(loop); })(); 0`);
await A.p.evaluate(`window.__cl = []; (function loop(){ const g = __game; for (const c of g.jutsu.naruto.own?.list || []) window.__cl.push([Math.round(g.net.serverNow()), c.slot, c.state, c.b.x.toFixed(2), c.b.y.toFixed(2), c.b.z.toFixed(2), c.b.ground ? 1 : 0, c.f.anim.key, c.jumps]); requestAnimationFrame(loop); })(); 0`);
await A.p.evaluate(() => { __game.ctrl.chakra = 100; __game.timeScale = 0.35; });
await B.p.evaluate(() => { __game.timeScale = 0.35; });
await A.p.evaluate(() => __game.input.press('jutsu1'));
if (process.env.VIEW === 'B') await B.p.evaluate(() => { __game.studio = { yaw: Math.PI / 2, pitch: 0.2, dist: 8, h: 1.2 }; });
await sleep(150); // the target is picked from the game camera at the press; then the side view
await A.p.evaluate((c) => { __game.studio = { yaw: c === 'up' ? -Math.PI / 2 : Math.PI / 2, pitch: 0.12, dist: 11, h: 1.5 }; }, CASE);
await sleep(700);
for (let i = 0; i < 12; i++) {
  await (process.env.VIEW === 'B' ? B : A).p.screenshot({ path: `${OUT}/${CASE}_${String(i).padStart(2, '0')}.png` });
  await sleep(160);
}
await sleep(4000);
const ca = await A.p.evaluate(() => window.__cl), cb = await B.p.evaluate(() => window.__cl);
const brief = (cl) => {
  const rows = [];
  const last = {};
  for (const r of cl) {
    const k = `${r[1]} ${r[2]} g${r[6]} ${r[7]} j${r[8]}`;
    if (k !== last[r[1]]) rows.push(r.join(" "));
    last[r[1]] = k;
  }
  return rows;
};
console.log('caster screen:\n ' + brief(ca).join('\n '));
console.log('target screen:\n ' + brief(cb).join('\n '));
await A.b.close();
await B.b.close();
