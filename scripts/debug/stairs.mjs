// Runs up the village stairs (plaza -> upper street) with real input and records every drawn frame: the fighter's
// drawn height, the sim's, the camera's. A smooth climb has a steady vertical speed; shaking shows as the drawn
// height's rate jumping around (a step-up every tread). Prints the rate's spread and the biggest frame-to-frame jump.
// usage: node scripts/debug/stairs.mjs <url> [sprint=0]
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:3101/';
const SPRINT = process.argv[3] === '1';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'autojoin=1&name=Stairs', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
const res = await page.evaluate(async (sprint) => {
  const g = window.__game;
  const stairs = g.map.props.find((p) => p.t === 'stairs');
  g.teleport(stairs.x, stairs.z0 + (sprint ? 9 : 3), 0); // facing north, up the stairs
  await new Promise((r) => setTimeout(r, 400));
  g.hold(['up']);
  const rows = [];
  const t0 = performance.now();
  await new Promise((done) => {
    const f = () => {
      const t = performance.now() - t0;
      rows.push([t, g.player.root.position.y, g.ctrl.body.y, g.camera.position.y, g.ctrl.body.z]);
      if (t < 3200) requestAnimationFrame(f);
      else done();
    };
    requestAnimationFrame(f);
  });
  g.hold([]);
  return { rows, top: stairs.top, z0: stairs.z0, zt: stairs.z0 - stairs.n * stairs.run };
}, SPRINT);
await browser.close();

// the climb: frames whose sim position is on the flight of steps
const on = res.rows.filter((r) => r[4] < res.z0 - 0.3 && r[4] > res.zt + 0.3);
const rate = (k) => {
  const v = [];
  for (let i = 1; i < on.length; i++) {
    const dt = (on[i][0] - on[i - 1][0]) / 1000;
    if (dt > 0) v.push((on[i][k] - on[i - 1][k]) / dt);
  }
  const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length || 1));
  let jump = 0;
  for (let i = 1; i < v.length; i++) jump = Math.max(jump, Math.abs(v[i] - v[i - 1]));
  return { mean: mean.toFixed(2), sd: sd.toFixed(2), maxJump: jump.toFixed(2), n: v.length };
};
if (process.env.DUMP) for (const r of on) console.log(r.map((v) => v.toFixed(3)).join(' '));
console.log(`frames on the stairs: ${on.length}; reached y ${res.rows[res.rows.length - 1][2].toFixed(2)} (top ${res.top})`);
console.log('  drawn fighter height rate m/s', rate(1));
console.log('  sim height rate m/s         ', rate(2));
console.log('  camera height rate m/s      ', rate(3));
