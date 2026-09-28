// Freeze-frame sheet: runs a setup (e.g. a cast), then at each listed game time freezes the game (timeScale 0) and
// shoots it from several studio angles; one row per moment. For effect reviews where a film strip is too small.
// usage: node scripts/debug/freeze.mjs <url> <out.png> <setupJs> <times s, comma> [views] [w] [h]
//   views: name:yaw:pitch:dist:h[:fov] (studio: yaw 0 = in front of the local fighter), default: back, side, front
//   `setupJs` runs once; game time is counted by the page (it advances only while not frozen).
import puppeteer from 'puppeteer-core';

const [url, out, setup, timesArg, viewsArg, W = '640', H = '400'] = process.argv.slice(2);
const times = timesArg.split(',').map(Number);
const VIEWS = (viewsArg || 'back:3.6:0.25:9:1.6:55,side:1.5708:0.12:11:1.4:50,front:0.4:0.1:9:1.4:50').split(',').map((v) => {
  const [name, yaw, pitch, dist, h, fov] = v.split(':');
  return { name, yaw: +yaw, pitch: +pitch, dist: +dist, h: +h, fov: +(fov || 50) };
});
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.setViewport({ width: +W, height: +H });
p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
p.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock/.test(t)) console.log('console:', t.slice(0, 200)); });
await p.goto(url, { waitUntil: 'load' });
await p.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
// game time: summed from the frame loop's scaled dt
await p.evaluate(() => {
  const g = __game;
  window.__gt = 0;
  const f = g.frame.bind(g);
  let last = performance.now();
  g.frame = () => {
    const n = performance.now();
    window.__gt += (Math.min((n - last) / 1000, 0.1)) * g.timeScale;
    last = n;
    f();
  };
});
const r0 = await p.evaluate(setup);
if (r0 !== undefined && r0 !== null) console.log('setup =>', JSON.stringify(r0).slice(0, 300));
await p.evaluate(() => { window.__gt = 0; });
const rows = [];
for (const T of times) {
  await p.waitForFunction((T) => window.__gt >= T, { timeout: 60000, polling: 'raf' }, T);
  const ts = await p.evaluate(() => { const s = __game.timeScale; __game.timeScale = 0; return s; });
  const row = [];
  for (const v of VIEWS) {
    await p.evaluate((v) => { __game.studio = { yaw: v.yaw, pitch: v.pitch, dist: v.dist, h: v.h, fov: v.fov }; }, v);
    await new Promise((r) => setTimeout(r, 160));
    row.push(await p.screenshot({ encoding: 'base64' }));
  }
  rows.push({ T, row });
  await p.evaluate((s) => { __game.timeScale = s; }, ts);
}
const w = +W, h = +H;
const html = `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${VIEWS.length},${w}px)}figure{margin:0;position:relative}
img{width:${w}px;height:${h}px;display:block}figcaption{position:absolute;left:4px;top:2px;font:bold 14px sans-serif;color:#ff0;text-shadow:0 0 3px #000}</style>
${rows.flatMap((r) => r.row.map((s, i) => `<figure><img src="data:image/png;base64,${s}"><figcaption>t=${r.T}s ${VIEWS[i].name}</figcaption></figure>`)).join('')}`;
const p2 = await b.newPage();
await p2.setViewport({ width: w * VIEWS.length, height: h * rows.length });
await p2.setContent(html);
await p2.screenshot({ path: out, fullPage: true });
await b.close();
console.log('wrote', out);
