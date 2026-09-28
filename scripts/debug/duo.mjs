// Two screens at once: A (the caster, CH_A, default madara) and B (the target, CH_B, default naruto) join, stand GAP
// metres apart facing each other, A runs `castJs`; both game cameras are filmed side by side (A left, B right), one
// row per frame. For "does it look right on the victim's screen too" reviews, at any lag (point it at :3102).
// usage: node scripts/debug/duo.mjs <url> <out.png> <castJs> [frames=12] [everyMs=150] [w=560] [h=340]
//   env: GAP (m, default 9), X / Z (where A stands, default -30, 44: a training post stands at -30, 36), SETUP_A / SETUP_B (js run before the cast), BVIEW=studio json for B's camera
import puppeteer from 'puppeteer-core';

const [url, out, castJs, frames = '12', every = '150', W = '560', H = '340'] = process.argv.slice(2);
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
const [A, B] = await Promise.all([client('Caster', process.env.CH_A || 'madara'), client('Target', process.env.CH_B || 'naruto')]);
await sleep(2500);
const gap = +(process.env.GAP || 9);
const X = +(process.env.X ?? -30), Z = +(process.env.Z ?? 44);
await A.p.evaluate(({ X, Z }) => { __game.teleport(X, Z, 0); __game.hud.show(false); __game.ctrl.chakra = 100; }, { X, Z });
await B.p.evaluate(({ X, Z, gap }) => { __game.teleport(X, Z - gap, Math.PI); __game.hud.show(false); }, { X, Z, gap });
await sleep(1400);
await A.p.evaluate(() => { __game.ctrl.lockTarget = __game.pickLock(0); });
await B.p.evaluate(() => { __game.ctrl.lockTarget = __game.pickLock(0); });
if (process.env.SETUP_A) await A.p.evaluate(process.env.SETUP_A);
if (process.env.SETUP_B) await B.p.evaluate(process.env.SETUP_B);
if (process.env.BVIEW) await B.p.evaluate(`__game.studio = ${process.env.BVIEW}`);
await sleep(300);
await A.p.evaluate(castJs);
const rows = [];
for (let i = 0; i < +frames; i++) {
  await sleep(+every);
  const [a, b] = await Promise.all([A.p.screenshot({ encoding: 'base64' }), B.p.screenshot({ encoding: 'base64' })]);
  rows.push([a, b]);
}
const w = +W, h = +H;
const html = `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(4,${w}px)}figure{margin:0;position:relative}
img{width:${w}px;height:${h}px;display:block}figcaption{position:absolute;left:4px;top:2px;font:bold 13px sans-serif;color:#ff0;text-shadow:0 0 3px #000}</style>
${rows.flatMap((r, i) => r.map((s, k) => `<figure><img src="data:image/png;base64,${s}"><figcaption>${i} ${k ? 'B (target)' : 'A (caster)'}</figcaption></figure>`)).join('')}`;
const p2 = await A.b.newPage();
await p2.setViewport({ width: w * 4, height: h * Math.ceil(rows.length / 2) });
await p2.setContent(html);
await p2.screenshot({ path: out, fullPage: true });
await A.b.close();
await B.b.close();
console.log('wrote', out);
