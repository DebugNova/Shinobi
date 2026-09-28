import puppeteer from 'puppeteer-core';
const [url, bone = 'rightUpperArm'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
page.on('console', (m) => { if (/MOVEFX/.test(m.text())) console.log(m.text()); });
await page.goto(`${url}?autojoin=1&grass=0${process.env.CH ? `&ch=${process.env.CH}` : ''}`, { waitUntil: 'load' });
await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
const out = await page.evaluate(async (bone, js) => {
  const g = __game, s = (ms) => new Promise((r) => setTimeout(r, ms));
  const n = g.player.vrm.humanoid.getNormalizedBoneNode(bone), prev = n.quaternion.clone();
  const rows = []; let on = true, lastKey = '';
  const tick = () => {
    const d = Math.min(1, Math.abs(prev.dot(n.quaternion))), deg = 2 * Math.acos(d) * 180 / Math.PI;
    const a = g.player.view?.act;
    const now = performance.now(); rows.push([+deg.toFixed(1), a ? `${a.clip}:${(a.t * 60).toFixed(2)}` : `st${g.ctrl.st}`, g.player.anim.key, +(now - (window.__last || now)).toFixed(1), +((g.ctrl.action?.t || 0) * 60).toFixed(2), g.ctrl.action?.stop > 0 ? 'STOP' : '', +(g.alpha || 0).toFixed(2)]); window.__last = now;
    prev.copy(n.quaternion);
    if (on) requestAnimationFrame(tick);
  };
  await eval(js.replace('__START__', 'requestAnimationFrame(tick);'));
  on = false;
  return rows;
}, bone, process.env.JS || `(async () => { g.teleport(-26, 49, 0); await s(400); __START__ g.hold(['up']); await s(600); for (let i = 0; i < 5; i++) { g.input.press('attack'); if (i === 0) g.hold([]); await s(270); } await s(1400); })()`);
const big = out.map((r, i) => [i, ...r]).filter((r) => r[1] > +(process.env.LIMIT || 25));
for (const r of big) { const i = r[0]; console.log(JSON.stringify(out.slice(Math.max(0, i - 2), i + 3))); }
await browser.close();
