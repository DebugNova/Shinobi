import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });
page.on('console', (m) => console.log('console:', m.text().slice(0, 300)));
await page.goto('http://localhost:3101/?autojoin=1&name=Probe&grass=0', { waitUntil: 'load' });
await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
const r = await page.evaluate(async () => {
  const g = __game; g.teleport(-20, 40, 0);
  await new Promise((r) => setTimeout(r, 400));
  g.timeScale = 0.2;
  g.combat.startAttack(g.ctrl, 'U3');
  const out = [];
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 60));
    const fx = g.fx, T = fx.aTime.array, K = fx.aKind.array, C = fx.aColor.array;
    const big = [];
    for (let k = 0; k < 1024; k++) {
      const age = (fx.time - T[k * 4]) / T[k * 4 + 1];
      if (age >= 0 && age <= 1 && (T[k * 4 + 2] > 0.7 || T[k * 4 + 3] > 0.9)) big.push([K[k * 2], +age.toFixed(2), T[k * 4 + 1], T[k * 4 + 2], T[k * 4 + 3], ...Array.from(C.slice(k * 4, k * 4 + 4)).map((v) => +v.toFixed(2))]);
    }
    const vis = [];
    g.scene.traverse((o) => { if (o.visible && o.isMesh && o.geometry?.boundingSphere?.radius > 0 && o.renderOrder >= 5) vis.push(o.name || o.material?.type); });
    out.push([(g.ctrl.action?.t * 60 || -1).toFixed(1), JSON.stringify(big), vis.join(',')]);
  }
  return out;
});
for (const l of r) console.log(l.join(' | '));
await browser.close();
