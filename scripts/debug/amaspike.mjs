// What Amaterasu's cinematic costs to draw: one client (1920x1080 High, vsync off), back to back: the arena idle, the
// cinematic, and the cinematic with its post effect muted (the same scene underneath). Median frame ms per phase
// (the negative world, the painted eyes, back in the arena) and the long frames (> 25 ms) with their timeline time.
// The laptop's speed swings between runs (gotcha 20): compare within one run only. RUNS=n (3). VSYNC=1: as players run
// it (vsync-off runs flood the GPU queue: a DOM raster then waits behind it, ~1-2 s frames that vsync never shows, gotcha 63).
// usage: node scripts/debug/amaspike.mjs [url=http://localhost:3104/]   (needs SHINOBI_ULT=1)
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3104/';
const RUNS = +(process.env.RUNS || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', ...(process.env.VSYNC ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'])] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080 });
await p.goto(`${URL}?autojoin=1&pw=HUNNY&name=Perf&ch=itachi`, { waitUntil: 'load' });
await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
await sleep(3000);
await p.evaluate(() => { __game.setPreset('high'); const A = __game.post.amaterasu; A.__apply = A.apply; });
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : NaN);
const frames = (ms) => p.evaluate((ms) => new Promise((res) => { const L = []; let last = performance.now(); const t0 = last; (function f() { const n = performance.now(); L.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(f); else res(L); })(); }), ms);
const cast = (muted) => p.evaluate((muted) => new Promise((res) => {
  const A = __game.post.amaterasu;
  A.apply = muted ? function (dt) { this.reset(); A.__apply.call(this, dt); } : A.__apply;
  __game.teleport(-44, 58, 0);
  if (__game.gauge) __game.gauge.u = 100;
  setTimeout(() => {
    const L = []; let last = performance.now(), seen = false;
    __game.input.press('ult');
    (function f() {
      const n = performance.now(), t = __game.jutsu.itachi.cine.time();
      L.push([t, n - last]);
      last = n;
      if (t >= 0) seen = true;
      if ((seen && t < 0) || L.length > 6000) { A.apply = A.__apply; res(L); } else requestAnimationFrame(f);
    })();
  }, 1200);
}), muted);
for (let run = 0; run < RUNS; run++) {
  const idle = await frames(1500);
  const on = await cast(false);
  await sleep(2500);
  const off = await cast(true);
  await sleep(2500);
  const ph = (L, a, z) => med(L.filter((x) => x[0] >= a && x[0] < z).map((x) => x[1]));
  const row = (L) => `negative ${ph(L, 0.6, 2.4).toFixed(2)}  eyes ${ph(L, 2.6, 4.2).toFixed(2)}  arena ${ph(L, 4.35, 5).toFixed(2)}  long ${L.filter((x) => x[1] > 22).map((x) => `${x[0].toFixed(2)}s:${x[1].toFixed(0)}`).join(' ') || '-'}`;
  console.log(`run ${run}: idle ${med(idle).toFixed(2)} ms`);
  console.log(`  effect on : ${row(on)}`);
  console.log(`  effect off: ${row(off)}`);
}
await b.close();
