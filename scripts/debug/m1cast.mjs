// M1 strings at real speed against a real victim (a second client, its own browser): Chrome's screencast grabs the
// attacker's screen without stopping the game, the frames go on a contact sheet (every `step`-th frame), captioned
// with the attacker's move + frame and the victim's HP as the attacker sees it. Also prints what the server confirmed.
// usage: node scripts/debug/m1cast.mjs <url> <out.png> [stand|run] [presses=5] [gapMs=270] [yaw=1.2] [dist=5.5] [step=3] [cols=6]
//   CH=<id> both fighters as that character; VIEW=B films the victim's screen instead; HALF=0 full-size cells;
//   FROM/TO=<s> only that stretch.
import puppeteer from 'puppeteer-core';

const [url, out, mode = 'stand', presses = '5', gap = '270', yaw = '1.2', dist = '5.5', step = '3', cols = '6'] = process.argv.slice(2);
const W = 640, H = 400, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const open = async (name) => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(name, 'PAGEERROR', e.message); });
  page.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock/.test(t)) console.log(name, 'console:', t.slice(0, 200)); });
  await page.goto(`${url}?autojoin=1&name=${name}&grass=0${process.env.CH ? `&ch=${process.env.CH}` : ''}`, { waitUntil: 'load' });
  await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
  return { browser, page };
};
const A = await open('Attacker');
const B = await open('Victim');
// the match starts (everyone respawns) once two are in: place them after that
await sleep(3500);
const X = -8, Z = 40, YAW = 2.356, fx = -Math.sin(YAW), fz = -Math.cos(YAW);
const D = mode === 'run' ? 7 : 2.6;
await B.page.evaluate((x, z, y) => __game.teleport(x, z, y), X + fx * D, Z + fz * D, YAW + Math.PI);
await A.page.evaluate((x, z, y) => __game.teleport(x, z, y), X, Z, YAW);
await sleep(1200);
const film = process.env.VIEW === 'B' ? B.page : A.page;
await film.evaluate((yaw, dist) => { __game.studio = { yaw, pitch: 0.16, dist, h: 1.0, fov: 50 }; document.querySelectorAll('#hud, .hud').forEach((e) => (e.style.opacity = 0.3)); }, +yaw, +dist);
await sleep(400);
// screencast
const cdp = await film.createCDPSession();
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ t: f.metadata.timestamp * 1000, data: f.data });
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
});
// captions: the attacker's move + frame, polled in the page
await A.page.evaluate(() => {
  window.__cap = [];
  const tick = () => {
    const g = __game, a = g.player.view?.act, r = [...g.remotes.values()][0];
    window.__cap.push([performance.timeOrigin + performance.now(), a ? `${a.clip} f${(a.t * 60).toFixed(0)}` : String(g.ctrl.st), r ? r.info.hp : -1, +g.ctrl.body.y.toFixed(2)]);
    if (window.__cap.length < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
await sleep(150);
await A.page.evaluate(async (mode, n, gap) => {
  const g = __game, s = (ms) => new Promise((r) => setTimeout(r, ms));
  g.combat.log = [];
  if (mode === 'run') { g.hold(['up']); await s(650); }
  for (let i = 0; i < n; i++) {
    g.input.press('attack');
    await s(i === 0 && mode === 'run' ? 100 : gap);
    if (i === 0) g.hold([]);
  }
  await s(1400);
}, mode, +presses, +gap);
await cdp.send('Page.stopScreencast');
const caps = await A.page.evaluate(() => window.__cap);
const res = await A.page.evaluate(() => ({ stats: __game.combat.stats, log: __game.combat.log, hp: [...__game.remotes.values()].map((r) => r.info.hp) }));
console.log(JSON.stringify(res));
const t0 = frames[0]?.t || 0;
// FROM/TO (s): only that stretch of the recording
const from = +(process.env.FROM || 0), to = +(process.env.TO || 99);
const pick = frames.filter((f, i) => i % +step === 0 && (f.t - t0) / 1000 >= from && (f.t - t0) / 1000 <= to);
const capAt = (t) => {
  let best = caps[0];
  for (const c of caps) if (Math.abs(c[0] - t) < Math.abs(best[0] - t)) best = c;
  return best ? `${best[1]} hp${best[2]} y${best[3]}` : '';
};
console.log(`${frames.length} frames over ${((frames.at(-1)?.t - t0) / 1000).toFixed(2)} s`);
const n = +cols, cw = W / (process.env.HALF === "0" ? 1 : 2), ch = H / (process.env.HALF === "0" ? 1 : 2);
const html = `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${n},${cw}px)}figure{margin:0;position:relative}
img{width:${cw}px;height:${ch}px;display:block}figcaption{position:absolute;left:4px;top:2px;font:bold 11px sans-serif;color:#ff0;text-shadow:0 0 3px #000}</style>
${pick.map((f) => `<figure><img src="data:image/jpeg;base64,${f.data}"><figcaption>${((f.t - t0) / 1000).toFixed(2)}s ${capAt(f.t)}</figcaption></figure>`).join('')}`;
const sheet = await A.browser.newPage();
await sheet.setViewport({ width: n * cw, height: Math.ceil(pick.length / n) * ch });
await sheet.setContent(html);
await sheet.screenshot({ path: out, fullPage: true });
await A.browser.close();
await B.browser.close();
console.log('wrote', out);
