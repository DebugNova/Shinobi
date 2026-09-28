import puppeteer from 'puppeteer-core';
const vsync = process.argv[2] === 'vsync';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', ...(vsync ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'])] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080 });
await p.goto('http://localhost:3101/?autojoin=1', { waitUntil: 'load' });
await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 3000));
console.log(await p.evaluate(() => new Promise((done) => {
  const g = __game, t0 = performance.now(); let last = t0; const long = []; let n = 0; const cpu = [];
  const f = () => { const t = performance.now(); const d = t - last; last = t; n++; if (d > 20) long.push(`${((t - t0) / 1000).toFixed(2)}s:${d.toFixed(0)}ms(cpu ${g.cpuMs.toFixed(1)} sim ${g.simMs.toFixed(1)})`); if (t - t0 < 6000) requestAnimationFrame(f); else done(`${n} frames; long: ${long.join(' ')}`); };
  requestAnimationFrame(f);
})));
await b.close();
