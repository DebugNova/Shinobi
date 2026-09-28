// Frame-rate benchmark with a full room: 5 network bots (plain WebSocket clients running and fighting in circles,
// ground-snapped with the shared map) + 1 real Chrome client at 1920x1080 (vsync off) that watches them from several
// spots of the map (the village square, the forest, the river). Prints fps, 1% low, draw calls, triangles, shader
// programs, JS time per frame, and flags anything over the budget (CLAUDE.md: 144 fps High 1080p, < 300 calls,
// < 1.5M tris, < 60 programs, JS < 4 ms). Needs a running server (dist-test on 3101).
// usage: node scripts/test/perf.mjs [url=http://localhost:3101/] [bots=5] [secondsPerSpot=6]
//   CH=<id>: the client's character; BOT_CH=<id>: every bot's (default: the bots cycle through the roster)
import puppeteer from 'puppeteer-core';
import { bot } from './bots.mjs';

const URL = process.argv[2] || 'http://localhost:3101/';
const NB = +(process.argv[3] ?? 5);
const SECS = +(process.argv[4] ?? 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the real client
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1920,1080', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage();
await page.setViewport({ width: +(process.env.W || 1920), height: +(process.env.H || 1080) });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('[pageerror]', e.message); });
await page.goto(`${URL}?autojoin=1&pw=HUNNY&name=Bench${process.env.CH ? `&ch=${process.env.CH}` : ''}`, { waitUntil: 'load' });
await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
const gpu = await page.evaluate(() => { const gl = __game.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
console.log(`GPU: ${gpu}`);

// spots: [name, player x, z, yaw, bots' centre x, z]
const spots = [
  ['village square', 30, 6, -Math.PI / 2, 36, 0],
  ['forest', -30, 4, Math.PI / 2, -36, 2],
  ['river bank', 2, -12, Math.PI, 2, -22],
  ['training field', 8, 22, 0, 8, 14],
  ['village again', 30, 6, -Math.PI / 2, 36, 0],
];
const bots = [];
for (let i = 0; i < NB; i++) bots.push(bot(URL, i, NB, [spots[0][4], spots[0][5]]));
await sleep(3000);

const rows = [];
for (const [name, x, z, yaw, cx, cz] of spots) {
  for (const B of bots) B.center = [cx, cz];
  await page.evaluate((x, z, yaw) => __game.teleport(x, z, yaw), x, z, yaw);
  await sleep(1500);
  const r = await page.evaluate(async (secs) => {
    const g = __game, dts = [], cpu = [], sim = [], calls = [], tris = [];
    let last = performance.now();
    await new Promise((done) => {
      const end = last + secs * 1000;
      const tick = () => {
        const t = performance.now();
        dts.push(t - last);
        last = t;
        cpu.push(g.cpuMs);
        sim.push(g.simMs);
        calls.push(g.frameInfo.calls);
        tris.push(g.frameInfo.tris);
        if (t < end) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    const s = [...dts].sort((a, b) => a - b), n = s.length, k = Math.max(1, Math.floor(n / 100));
    const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
    return {
      fps: 1000 / (s.reduce((a, b) => a + b, 0) / n),
      low1: 1000 / (s.slice(n - k).reduce((a, b) => a + b, 0) / k),
      worst: s[n - 1],
      js: med(cpu),
      sim: med(sim),
      js95: [...cpu].sort((p, q) => p - q)[Math.floor(n * 0.95)],
      calls: Math.max(...calls),
      tris: Math.max(...tris),
      programs: g.renderer.info.programs.length,
      remotes: [...g.remotes.values()].filter((r) => r.fighter && r.fighter.root.visible).length,
    };
  }, SECS);
  rows.push([name, r]);
  // SHOTS=dir: a screenshot per spot (the nearest remote flashing, to check the hit-flash material swap)
  if (process.env.SHOTS) {
    await page.evaluate(() => { const r = [...__game.remotes.values()].map((e) => e.fighter).filter(Boolean).sort((a, b) => a.pos.distanceTo(__game.camera.position) - b.pos.distanceTo(__game.camera.position))[0]; if (r) r.flashT = 1; });
    await page.screenshot({ path: `${process.env.SHOTS}/perf_${rows.length}.png` });
  }
  console.log(`${name.padEnd(15)} ${r.fps.toFixed(0).padStart(4)} fps  1% low ${r.low1.toFixed(0).padStart(4)}  worst ${r.worst.toFixed(1)} ms  CPU ${r.js.toFixed(2)} ms (p95 ${r.js95.toFixed(2)}, logic+anim ${r.sim.toFixed(2)})  calls ${r.calls}  tris ${(r.tris / 1e6).toFixed(2)}M  programs ${r.programs}  remotes ${r.remotes}`);
}

const worst = (k, f = Math.max) => f(...rows.map(([, r]) => r[k]));
const fails = [];
if (worst('calls') >= 300) fails.push(`calls ${worst('calls')} >= 300`);
if (worst('tris') >= 1.5e6) fails.push(`tris ${(worst('tris') / 1e6).toFixed(2)}M >= 1.5M`);
if (worst('programs') >= 60) fails.push(`programs ${worst('programs')} >= 60`);
if (worst('sim') >= 4) fails.push(`logic+anim JS ${worst('sim').toFixed(2)} ms >= 4`);
if (worst('fps', Math.min) < 144) fails.push(`fps ${worst('fps', Math.min).toFixed(0)} < 144 (vsync-off headless: compare on the owner's machine)`);
console.log(fails.length ? `OVER BUDGET: ${fails.join('; ')}` : 'ALL WITHIN BUDGET');
for (const B of bots) {
  clearInterval(B.timer);
  B.ws.close();
}
await browser.close();
process.exit(0);
