// debug: A combos B under lag; B logs its seq, each hitr sq, and the server's seq for B from snapshots
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:3102/';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name) { const b = await launch(); const p = await b.newPage(); await p.setViewport({ width: 640, height: 360 }); await p.goto(`${URL}?autojoin=1&name=${name}`); await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 }); return { b, p }; }
const [A, B] = await Promise.all([client('A'), client('B')]);
await sleep(1500);
await A.p.evaluate(() => __game.teleport(-30, 44, 0));
await B.p.evaluate(() => __game.teleport(-30, 42.6, Math.PI));
await sleep(1500);
await B.p.evaluate(() => {
  window.__log = [];
  const n = __game.net, t0 = performance.now();
  const T = () => Math.round(performance.now() - t0);
  n.on('hitr', (m) => m.v === n.id && __log.push([T(), 'hitr', m.sq, 'mine', n.seq]));
  n.on('spawn', (m) => m.id === n.id && __log.push([T(), 'spawn', m.seq]));
  n.on('a', (m) => m.id === n.id && __log.push([T(), 'a', m.k, m.sq]));
  n.on('deny', (m) => __log.push([T(), 'deny', JSON.stringify(m)]));
  n.on('gauge', (m) => __log.push([T(), 'gauge', m.sp]));
  n.on('hitr', (m) => { if (m.v === n.id && !window.__sub) { window.__sub = 1; setTimeout(() => { __game.input.press('dash'); __log.push([T(), 'press dash', __game.ctrl.action?.constructor.name, __game.gauge.sp]); }, 60); } });
  n.on('snap', (m) => { const e = m.ps.find((p) => p[0] === n.id); if (e && e[12] !== window.__lastS) { window.__lastS = e[12]; __log.push([T(), 'snapseq', e[12], 'mine', n.seq]); } });
  const orig = n.sendState.bind(n);
  n.sendState = (s) => { if (n.seq !== window.__lastSent) { window.__lastSent = n.seq; __log.push([T(), 'send n', n.seq]); } orig(s); };
});
await A.p.evaluate(`(async () => { for (let i = 0; i < 3; i++) { __game.input.press('attack'); await new Promise(r => setTimeout(r, 260)); } })(); 0`);
await sleep(4000);
for (const l of await B.p.evaluate(() => window.__log)) console.log(JSON.stringify(l));
await A.b.close(); await B.b.close();
