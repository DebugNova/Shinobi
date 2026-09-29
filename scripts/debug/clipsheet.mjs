// A move's clip at exact frames on the real model (no timing involved): the clip is sampled onto the local fighter
// (Animator.debugPose), the move's hitbox capsule (red) drawn at each frame with F4 on, the training dummy's hurtbox
// (green) standing where the move meets it (its step's `gap` in front, or where its warp puts him). One contact sheet
// per move, captioned with the frame and whether it is active. For posing and hitbox checks (the timing: m1film,
// m1cast, scripts/test/itachicombo.mjs).
// usage: node scripts/debug/clipsheet.mjs <url> <out.png> <moveId> [frames=every 2nd] [yaw=1.3] [dist=3.2] [h=1.1]
//   CH=<id> (default itachi); frames: comma list or "a-b/step"; SIZE=<px> cell size (default 300); COLS=<n>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [url, out, id, framesArg, yaw = '1.3', dist = '3.2', h = '1.1'] = process.argv.slice(2);
if (!url || !out || !id) {
  console.log('usage: node scripts/debug/clipsheet.mjs <url> <out.png> <moveId> [frames] [yaw] [dist] [h]');
  process.exit(1);
}
const CH = process.env.CH || 'itachi', SIZE = +(process.env.SIZE || 300);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: SIZE * 2, height: SIZE * 2 });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
page.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock/.test(t)) console.log('console:', t.slice(0, 200)); });
await page.goto(`${url}?autojoin=1&pw=HUNNY&name=Sheet&grass=0&ch=${CH}`, { waitUntil: 'load' });
await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
const info = await page.evaluate((id) => {
  const g = __game, M = g.ctrl.C.moves[id];
  if (!M) return null;
  const total = M.startup + M.active + M.recovery;
  // stand facing the dummy where the move meets it
  const d = g.dummy.pos, W = M.warp;
  const gap = W ? (W.to === 'behind' ? W.gap ?? 0.9 : W.back ?? 0.3) : M.step.track.gap;
  g.teleport(d.x, d.z + gap, 0);
  g.hud.show(false);
  g.timeScale = 0;
  const up = W && (W.to === 'above' || M.kind === 'air') ? W.up || 0 : 0;
  g.__sheet = { up };
  return { total, startup: M.startup, active: M.active, anim: M.anim, gap, up };
}, id);
if (!info) {
  console.log('no move', id);
  await browser.close();
  process.exit(1);
}
let frames;
if (framesArg && framesArg.includes('-')) {
  const [ab, st = '2'] = framesArg.split('/');
  const [a, b] = ab.split('-').map(Number);
  frames = [];
  for (let f = a; f <= b; f += +st) frames.push(f);
} else if (framesArg) frames = framesArg.split(',').map(Number);
else {
  frames = [];
  for (let f = 0; f <= info.total; f += 2) frames.push(f);
}
console.log(JSON.stringify(info));
await page.evaluate(() => __game.debugKey('F4'));
await page.evaluate((yaw, dist, h) => { __game.studio = { yaw, pitch: 0.1, dist, h, fov: 45 }; }, +yaw, +dist, +h);
const shots = [];
for (const f of frames) {
  const cap = await page.evaluate((id, f) => {
    const g = __game, a = g.player.anim, rig = a.rig, M = g.ctrl.C.moves[id], clip = a.lib.get(M.anim);
    const b = g.ctrl.body, up = g.__sheet.up;
    // (lifted for the air moves: where their warp or the air combo holds him)
    b.y = g.dummy.pos.y + up;
    g.ctrl.prevY = b.y;
    a.debugPose = (pose) => clip.sample(f / 60, pose, rig.hipsY);
    const V = g.player.pos.constructor, A = new V(), B = new V();
    setTimeout(() => {
      g.combat.hitboxAt({ M }, Math.min(f, M.startup + M.active - 0.01), A, B);
      if (f >= M.startup && f < M.startup + M.active) g.debug?.hitbox(A, B, M.hit.box.r);
    }, 60);
    return `${M.anim} f${f}${f >= M.startup && f < M.startup + M.active ? ' ACTIVE' : ''}`;
  }, id, f);
  await new Promise((r) => setTimeout(r, 220));
  shots.push([await page.screenshot({ encoding: 'base64' }), cap]);
}
const n = +(process.env.COLS || 6);
const html = `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${n},${SIZE}px)}figure{margin:0;position:relative}
img{width:${SIZE}px;height:${SIZE}px;display:block}figcaption{position:absolute;left:4px;top:2px;font:bold 12px sans-serif;color:#ff0;text-shadow:0 0 3px #000}</style>
${shots.map(([s, c]) => `<figure><img src="data:image/png;base64,${s}"><figcaption>${c}</figcaption></figure>`).join('')}`;
const sheet = await browser.newPage();
await sheet.setViewport({ width: n * SIZE, height: Math.ceil(shots.length / n) * SIZE });
await sheet.setContent(html);
await sheet.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote', out, fs.statSync(out).size);
