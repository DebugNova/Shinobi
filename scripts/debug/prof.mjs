// CPU profile of one client with bots around it: runs the Chrome profiler for a few seconds and prints the functions
// with the most self time (and the files they live in). Build unminified for readable names:
//   npx vite build --minify false --outDir dist-prof ; PORT=3103 SHINOBI_DIST=dist-prof node server/index.js
// usage: node scripts/debug/prof.mjs [url=http://localhost:3103/] [bots=5] [seconds=5] [x z yaw]
import puppeteer from 'puppeteer-core';
import { bot } from '../test/bots.mjs';

const [URL = 'http://localhost:3103/', NB = '5', SECS = '5', X = '30', Z = '6', YAW = String(-Math.PI / 2)] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto(`${URL}?autojoin=1&name=Prof`, { waitUntil: 'load' });
await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
const bots = [];
for (let i = 0; i < +NB; i++) bots.push(bot(URL, i, +NB, [+X + 6, +Z]));
await page.evaluate((x, z, y) => __game.teleport(x, z, y), +X, +Z, +YAW);
await sleep(3000);
const cdp = await page.createCDPSession();
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.evaluate(() => { window.__nf = 0; const f = () => { window.__nf++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
await sleep(+SECS * 1000);
const { profile } = await cdp.send('Profiler.stop');
const frames = await page.evaluate(() => window.__nf);
// self time per node from the samples
const dt = new Map();
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
const byFn = new Map();
let total = 0;
for (const n of profile.nodes) {
  const t = (dt.get(n.id) || 0) / 1000;
  total += t;
  const cf = n.callFrame, key = `${cf.functionName || '(anon)'}  ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
  byFn.set(key, (byFn.get(key) || 0) + t);
}
const idle = [...byFn].filter(([k]) => /^\(idle\)|^\(program\)|^\(garbage/.test(k));
console.log(`${frames} frames in ${SECS} s; per frame: ${(total / frames).toFixed(2)} ms sampled (${idle.map(([k, v]) => `${k.split(' ')[0]} ${(v / frames).toFixed(2)}`).join(', ')})`);
for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${(v / frames).toFixed(3).padStart(7)} ms  ${k}`);
// inclusive time per function (counted once per stack)
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const incl = new Map();
for (const n of profile.nodes) {
  const t = (dt.get(n.id) || 0) / 1000;
  if (!t) continue;
  const seen = new Set();
  for (let id = n.id; id !== undefined; id = parent.get(id)) {
    const cf = nodes.get(id).callFrame, key = `${cf.functionName || '(anon)'}  ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    incl.set(key, (incl.get(key) || 0) + t);
  }
}
console.log('--- inclusive');
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP || 60))) console.log(`${(v / frames).toFixed(3).padStart(7)} ms  ${k}`);
// CALLERS=fnName: who calls it (time of its topmost frames, grouped by the caller)
if (process.env.CALLERS) {
  const by = new Map();
  for (const n of profile.nodes) {
    const t = (dt.get(n.id) || 0) / 1000;
    if (!t) continue;
    let top = null;
    for (let id = n.id; id !== undefined; id = parent.get(id)) if (nodes.get(id).callFrame.functionName === process.env.CALLERS) top = id;
    if (top === null) continue;
    const cf = nodes.get(parent.get(top))?.callFrame;
    const key = cf ? `${cf.functionName || '(anon)'}  ${cf.url.split('/').pop()}:${cf.lineNumber + 1}` : '?';
    by.set(key, (by.get(key) || 0) + t);
  }
  console.log(`--- callers of ${process.env.CALLERS}`);
  for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${(v / frames).toFixed(3).padStart(7)} ms  ${k}`);
}
for (const B of bots) {
  clearInterval(B.timer);
  B.ws.close();
}
await browser.close();
process.exit(0);
