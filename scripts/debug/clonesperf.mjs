// Boot time, and frame time / draw calls / CPU with Naruto's kit on screen vs idle (one client, 1080p, vsync off):
// three shadow clones, then a Rush, then a Big Rasengan. usage: node scripts/debug/clonesperf.mjs <url>
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:3101/';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080 });
const t0 = Date.now();
await p.goto(`${URL}?autojoin=1&name=P`, { waitUntil: 'load' });
await p.waitForFunction('window.__ready === true', { timeout: 120000 });
console.log('boot to ready', Date.now() - t0, 'ms');
await p.waitForFunction("window.__game.state === 'playing'", { timeout: 60000 });
const measure = (ms) => p.evaluate((ms) => new Promise((ok) => {
  const g = __game, ts = [], calls = [], sim = [], cpu = [];
  let last = performance.now();
  const end = last + ms;
  (function loop() {
    const n = performance.now();
    ts.push(n - last);
    calls.push(g.frameInfo?.calls || 0);
    sim.push(g.simMs || 0);
    cpu.push(g.cpuMs || 0);
    last = n;
    if (n < end) requestAnimationFrame(loop);
    else {
      ts.sort((a, c) => a - c);
      ok({ fps: Math.round(1000 / (ts.reduce((a, c) => a + c, 0) / ts.length)), p99: ts[Math.floor(ts.length * 0.99)].toFixed(1), calls: Math.round(calls.reduce((a, c) => a + c, 0) / calls.length), maxCalls: Math.max(...calls), sim: (sim.reduce((a, c) => a + c, 0) / sim.length).toFixed(2), cpu: (cpu.reduce((a, c) => a + c, 0) / cpu.length).toFixed(2) });
    }
  })();
}), ms);
await p.evaluate(() => { const d = __game.dummy.pos; __game.teleport(d.x, d.z + 7, 0); __game.ctrl.lockTarget = { id: 0, x: d.x, y: d.y, z: d.z, dead: false }; });
await new Promise((r) => setTimeout(r, 1500));
console.log('idle      ', JSON.stringify(await measure(3000)));
await p.evaluate(() => __game.input.press('jutsu1'));
await new Promise((r) => setTimeout(r, 800));
console.log('3 clones  ', JSON.stringify(await measure(3000)));
await p.evaluate(() => { __game.jutsu.ready = {}; __game.ctrl.chakra = 100; __game.input.press('jutsu4'); });
console.log('+ rush    ', JSON.stringify(await measure(1200)));
await new Promise((r) => setTimeout(r, 1500));
await p.evaluate(() => { __game.jutsu.ready = {}; __game.ctrl.chakra = 100; __game.hold(['jutsu2']); setTimeout(() => __game.hold([]), 900); });
console.log('+ rasengan', JSON.stringify(await measure(1600)));
await b.close();
