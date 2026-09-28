// Frame times with Itachi's effects on screen (1920x1080, High, vsync off): a quiet baseline, then each ability on
// the training dummy (fireballs, Tsukuyomi's mark, Amaterasu's black flames, the crow escape) and everything at once.
// usage: node scripts/test/itachiperf.mjs [url=http://localhost:3104/]   (needs SHINOBI_ULT=1: 3104 / 3102)
// Run it alone (other headless tests on the laptop wreck the numbers; gotcha 20).
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3104/';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1920,1080', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`${URL}?autojoin=1&pw=HUNNY&name=Perf&ch=itachi`, { waitUntil: 'load' });
await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
await page.evaluate(() => __game.setPreset('high'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2000);
// frame times over `ms` while `js` runs at the start
const measure = (js, ms) => page.evaluate(async ({ js, ms }) => {
  const d = __game.dummy.pos;
  __game.teleport(d.x, d.z + 11, 0);
  __game.ctrl.chakra = 100;
  __game.jutsu.ready = {};
  __game.gauge.u = 100;
  await new Promise((r) => setTimeout(r, 400));
  const f = [], cpu = [], p0 = __game.renderer.info.programs.length;
  let last = performance.now();
  // eslint-disable-next-line no-eval
  eval(js);
  await new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      const n = performance.now();
      f.push(n - last);
      cpu.push(__game.cpuMs || 0);
      last = n;
      if (n - t0 < ms) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  f.sort((a, b) => a - b);
  const avg = f.reduce((s, x) => s + x, 0) / f.length, low = f[Math.floor(f.length * 0.99)];
  return { fps: 1000 / avg, low1: 1000 / low, worst: f.at(-1), cpu: cpu.reduce((s, x) => s + x, 0) / cpu.length, newPrograms: __game.renderer.info.programs.length - p0 };
}, { js, ms });
const rows = [
  ['quiet', '0'],
  ['fireballs', "__game.input.press('jutsu1')"],
  ['tsukuyomi', "__game.input.press('jutsu2')"],
  ['amaterasu', "__game.input.press('ult')"],
  ['crow escape', "__game.input.press('jutsu3')"],
  ['all at once', "__game.input.press('ult'); setTimeout(() => __game.input.press('jutsu1'), 950); setTimeout(() => __game.input.press('jutsu3'), 2100)"],
];
for (const [name, js] of rows) {
  const r = await measure(js, 3000);
  console.log(`${name.padEnd(12)} ${r.fps.toFixed(0).padStart(4)} fps  1% low ${r.low1.toFixed(0).padStart(4)}  worst ${r.worst.toFixed(1)} ms  CPU ${r.cpu.toFixed(2)} ms  new programs ${r.newPrograms}`);
  await sleep(name === 'amaterasu' ? 5000 : 800);
}
await browser.close();
