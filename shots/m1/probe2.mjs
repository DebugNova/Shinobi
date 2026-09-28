import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:3101/?autojoin=1&name=Probe&grass=0', { waitUntil: 'load' });
await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
const r = await page.evaluate(async (move) => {
  const g = __game; g.teleport(-20, 40, 0);
  await new Promise((r) => setTimeout(r, 400));
  g.timeScale = 0.2;
  g.combat.startAttack(g.ctrl, move);
  const out = [];
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const M = g.movefx, e = M.by.get(g.player);
    out.push([(g.player.view?.act?.t * 60).toFixed(1), g.player.view?.act?.clip, e ? e.trails.size : -1, M.trails.map((t) => `${t.owner ? (t.owner === 'fading' ? 'F' : 'O') : '-'}${t.s.length}${t.mesh.visible ? 'v' : ''}${t.geo.drawRange.count}`).join(' '), M.scrolls.filter((s) => s.visible).length].join(' | '));
  }
  return out;
}, process.argv[2] || 'U5');
for (const l of r) console.log(l);
await browser.close();
