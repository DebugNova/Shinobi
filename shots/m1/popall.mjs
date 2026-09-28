// every normalized bone: one-frame rotations that spike (> LIM deg and 2.5x the frames around them), with the move
import puppeteer from 'puppeteer-core';
const [url, mode = 'moving', LIM = '30'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
await page.goto(`${url}?autojoin=1&grass=0${process.env.CH ? `&ch=${process.env.CH}` : ''}`, { waitUntil: 'load' });
await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
const JS = {
  moving: `g.teleport(-26, 49, 0); await s(400); START(); g.hold(['up']); await s(600); for (let i = 0; i < 5; i++) { g.input.press('attack'); if (i === 0) g.hold([]); await s(270); } await s(1400);`,
  stand: `g.teleport(-8, 40, 2.356); await s(400); START(); for (let i = 0; i < 5; i++) { g.input.press('attack'); await s(270); } await s(1400);`,
  slow: `g.teleport(-8, 40, 2.356); await s(400); START(); for (let i = 0; i < 5; i++) { g.input.press('attack'); await s(520); } await s(1400);`,
  movingslow: `g.teleport(-26, 49, 0); await s(400); START(); g.hold(['up']); await s(600); for (let i = 0; i < 5; i++) { g.input.press('attack'); if (i === 0) g.hold([]); await s(560); } await s(1400);`,
};
const out = await page.evaluate(async (code, LIM) => {
  const g = __game, s = (ms) => new Promise((r) => setTimeout(r, ms)), H = g.player.vrm.humanoid;
  const names = Object.keys(H.humanBones).filter((n) => H.getNormalizedBoneNode(n) && !/Proximal|Intermediate|Distal|Metacarpal/.test(n));
  const nodes = names.map((n) => H.getNormalizedBoneNode(n)), prev = nodes.map((n) => n.quaternion.clone());
  const hist = names.map(() => []), ctx = []; let on = false;
  const START = () => (on = true);
  const tick = () => {
    if (on) {
      const a = g.player.view?.act;
      ctx.push(a ? `${a.clip}:${(a.t * 60).toFixed(1)}` : `st${g.ctrl.st}`);
      nodes.forEach((n, i) => { const d = Math.min(1, Math.abs(prev[i].dot(n.quaternion))); hist[i].push(2 * Math.acos(d) * 180 / Math.PI); });
    }
    nodes.forEach((n, i) => prev[i].copy(n.quaternion));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await eval(`(async () => { ${code} })()`);
  on = false;
  const res = [];
  hist.forEach((h, i) => { for (let k = 1; k < h.length - 1; k++) if (h[k] > LIM && h[k] > 2.5 * Math.max(h[k - 1], h[k + 1])) res.push([names[i], +h[k].toFixed(1), +h[k - 1].toFixed(1), +h[k + 1].toFixed(1), ctx[k - 1], ctx[k]]); });
  return res;
}, JS[mode], +LIM);
console.log(mode, out.length ? '' : 'no spikes');
for (const r of out) console.log('  ', JSON.stringify(r));
await browser.close();
