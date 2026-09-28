// trace a string: per drawn frame the attacker's move/frame/height, the victim's (as the attacker sees it) and the gap
import puppeteer from 'puppeteer-core';
const [url, mode = 'run', gap = '270', presses = '5'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const open = async (name) => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 400 });
  page.on('pageerror', (e) => console.log(name, 'PAGEERROR', e.message));
  await page.goto(`${url}?autojoin=1&pw=HUNNY&name=${name}&grass=0${process.env.CH ? `&ch=${process.env.CH}` : ''}`, { waitUntil: 'load' });
  await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
  return { browser, page };
};
const A = await open('Attacker'), B = await open('Victim');
await sleep(3500);
const X = -8, Z = 40, YAW = 2.356, fx = -Math.sin(YAW), fz = -Math.cos(YAW), D = +(process.env.D || (mode === 'run' ? 7 : 2.6));
await B.page.evaluate((x, z, y) => __game.teleport(x, z, y), X + fx * D, Z + fz * D, YAW + Math.PI);
await A.page.evaluate((x, z, y) => __game.teleport(x, z, y), X, Z, YAW);
await sleep(1200);
// the victim's screen: frames where it draws the attacker's scroll / trails
await B.page.evaluate(() => { window.__fx = { scroll: 0, trail: 0, frames: 0 }; const t = () => { const M = __game.movefx; window.__fx.frames++; if (M.scrolls.some((s) => s.visible)) window.__fx.scroll++; if (M.trails.some((x) => x.mesh.visible)) window.__fx.trail++; requestAnimationFrame(t); }; requestAnimationFrame(t); });
const rows = await A.page.evaluate(async (mode, n, gap) => {
  const g = __game, s = (ms) => new Promise((r) => setTimeout(r, ms)), rows = [];
  let on = true;
  const tick = () => {
    const a = g.player.view?.act, r = [...g.remotes.values()][0], b = g.ctrl.body, f = r?.fighter;
    rows.push([Math.round(performance.now()), a ? `${a.clip}:${(a.t * 60).toFixed(0)}` : `st${g.ctrl.st}`, b.y.toFixed(2), f ? f.pos.y.toFixed(2) : '-', f ? Math.hypot(f.pos.x - b.x, f.pos.z - b.z).toFixed(2) : '-', r?.react ? r.react.r : '', r?.info.hp]);
    if (on) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  g.combat.log = [];
  if (mode === 'run') { g.hold(['up']); await s(650); }
  for (let i = 0; i < n; i++) { g.input.press('attack'); await s(i === 0 && mode === 'run' ? 100 : gap); if (i === 0) g.hold([]); }
  await s(1300);
  on = false;
  return { rows, log: g.combat.log, stats: g.combat.stats };
}, mode, +presses, +gap);
let last = '';
for (const r of rows.rows) { const k = r[1].split(':')[0]; if (k !== last || /r_slam|r_rise/.test(k)) { console.log(r.join('  ')); last = k; } }
console.log(JSON.stringify(rows.log), JSON.stringify(rows.stats));
console.log('victim screen', JSON.stringify(await B.page.evaluate(() => window.__fx)));
await A.browser.close(); await B.browser.close();
