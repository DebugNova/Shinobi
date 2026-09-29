// Madara's gunbai workbench: holds the local Madara at chosen frames of a clip (default mad_counter; frame -1 = no
// clip: the idle, the fan on his back) and shoots each from several studio angles; one row per frame.
// usage: node scripts/debug/gunbai.mjs <url> <out.png> [frames=-1,5,8,12] [views] [w=420] [h=520]
//   views: name:yaw:pitch:dist:h[:fov] (yaw 0 = in front of him, PI/2 his left side), default back, right, left, front
//   env: CLIP=<clip> (default mad_counter), BACK='{"p":[..],"up":[..],"face":[..]}' (try a mount without a rebuild),
//        GRIP=<m>, W=<forceGunbai weight 0..1>, RUN=1 (hold 'up' instead of standing: frames are then ignored and
//        each row is 90 ms later), JS=<extra setup js>
import puppeteer from 'puppeteer-core';

const [url, out, framesArg = '-1,5,8,12', viewsArg, W = '420', H = '520'] = process.argv.slice(2);
if (!url || !out) {
  console.log('usage: node scripts/debug/gunbai.mjs <url> <out.png> [frames] [views] [w] [h]');
  process.exit(1);
}
const frames = framesArg.split(',').map(Number);
const VIEWS = (viewsArg || 'back:3.1416:0.12:3.2:1.1:40,right:-1.5708:0.08:3.2:1.1:40,left:1.5708:0.08:3.2:1.1:40,front:0.35:0.1:3.4:1.1:40').split(',').map((v) => {
  const [name, yaw, pitch, dist, h, fov] = v.split(':');
  return { name, yaw: +yaw, pitch: +pitch, dist: +dist, h: +h, fov: +(fov || 40) };
});
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.setViewport({ width: +W, height: +H });
p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
p.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock/.test(t)) console.log('console:', t.slice(0, 200)); });
await p.goto(url, { waitUntil: 'load' });
await p.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
await p.evaluate((clip, back, grip, w, js) => {
  const g = __game;
  g.hud && (document.querySelector('#hud') || {}).style && (document.querySelector('#hud').style.display = 'none');
  g.teleport(-44, 50, 0);
  const K = g.jutsu.madara;
  if (back) K.debugGunbai(JSON.parse(back));
  if (grip) K.debugGunbai(null, +grip);
  if (w) K.forceGunbai = +w;
  // hold a clip frame: the view's action is replaced after the game fills it
  const fill = g.fillView.bind(g);
  window.__wb = null;
  g.fillView = (v, c) => {
    fill(v, c);
    if (window.__wb !== null) v.act = { clip, t: window.__wb / 60, key: 'wb' };
  };
  if (js) (0, eval)(js);
}, process.env.CLIP || 'mad_counter', process.env.BACK || '', process.env.GRIP || '', process.env.W || '', process.env.JS || '');
if (process.env.RUN) await p.evaluate(() => __game.hold(['up']));
const rows = [];
for (const fr of frames) {
  if (!process.env.RUN) {
    await p.evaluate((fr) => { window.__wb = fr < 0 ? null : fr; }, fr);
    await new Promise((r) => setTimeout(r, 700)); // blends and springs settle
  } else await new Promise((r) => setTimeout(r, 90));
  const shots = [];
  if (process.env.RUN) await p.evaluate(() => { __game.timeScale = 0; });
  for (const v of VIEWS) {
    await p.evaluate((v) => { __game.studio = { yaw: v.yaw, pitch: v.pitch, dist: v.dist, h: v.h, fov: v.fov }; }, v);
    await new Promise((r) => setTimeout(r, 120));
    shots.push({ name: `${fr} ${v.name}`, b64: await p.screenshot({ encoding: 'base64' }) });
  }
  if (process.env.RUN) await p.evaluate(() => { __game.timeScale = 1; });
  rows.push(shots);
}
const cols = VIEWS.length, sc = Math.min(1, 1900 / (+W * cols));
const html = `<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${+W * sc}px)">${rows.flat().map((s) => `<div style="position:relative"><img style="width:${+W * sc}px" src="data:image/png;base64,${s.b64}"><span style="position:absolute;left:4px;top:2px;color:#ff0;font:bold 14px sans-serif">${s.name}</span></div>`).join('')}</body>`;
const p2 = await b.newPage();
await p2.setViewport({ width: Math.ceil(+W * sc * cols), height: Math.ceil(+H * sc * rows.length) });
await p2.setContent(html);
await p2.screenshot({ path: out });
await b.close();
console.log('wrote', out);
