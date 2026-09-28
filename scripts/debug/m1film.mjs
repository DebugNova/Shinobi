// M1 review: slow-motion filmstrip of a string, captioned with the clip + frame.
// F4=1: hurtboxes/hitboxes drawn. CH=<id>, HALF=0 full-size cells.
// node m1film.mjs <url> <out.png> <stand|run|moves:ID> [yaw=1.57] [frames=40] [every=90] [scale=0.1] [presses=5] [cols=8] [dist=4.2] [vs=0]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [url, out, mode = 'stand', yaw = '1.57', frames = '40', every = '90', scale = '0.1', presses = '5', cols = '8', dist = '4.2', vs = '0'] = process.argv.slice(2);
const W = 560, H = 420;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const open = async (name) => {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(name, 'PAGEERROR', e.message); });
  page.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock/.test(t)) console.log(name, 'console:', t.slice(0, 200)); });
  await page.goto(`${url}?autojoin=1&pw=HUNNY&name=${name}&grass=0${process.env.CH ? `&ch=${process.env.CH}` : ''}`, { waitUntil: 'load' });
  await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
  return page;
};
const page = await open('Film');
let victim = null;
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => { __game.hud && document.querySelectorAll('#hud, .hud').forEach((e) => (e.style.opacity = 0.25)); });
await page.evaluate(() => __game.teleport(-8, 40, 2.356));
if (+vs) {
  victim = await open('Victim');
  await new Promise((r) => setTimeout(r, 1500));
  await victim.evaluate((d) => __game.teleport(-8 - d * 0.7071, 40 + d * 0.7071, 2.356 + Math.PI), +vs);
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => __game.teleport(-8, 40, 2.356));
}
await new Promise((r) => setTimeout(r, 700));
if (process.env.F4) await page.evaluate(() => __game.debugKey('F4'));
await page.evaluate((yaw, dist) => { __game.studio = { yaw, pitch: 0.12, dist, h: 1.0, fov: 50 }; }, +yaw, +dist);
await new Promise((r) => setTimeout(r, 300));
const S = +scale;
// the string, in game time (the page's timers are scaled)
page.evaluate(`(async () => {
  const g = __game, s = (ms) => new Promise((r) => setTimeout(r, ms / ${S}));
  g.timeScale = ${S};
  if ('${mode}' === 'run') { g.hold(['up']); await s(700); }
  if ('${mode}'.startsWith('moves:')) { g.combat.startAttack(g.ctrl, '${mode}'.slice(6)); await s(270); }
  else for (let i = 0; i < ${presses}; i++) { g.input.press('attack'); await s(i === 0 && '${mode}' === 'run' ? 120 : 270); if (i === 0) g.hold([]); }
})()`).catch(() => {});
const shots = [];
for (let i = 0; i < +frames; i++) {
  await new Promise((r) => setTimeout(r, +every));
  const cap = await page.evaluate(() => {
    const g = __game, a = g.player.view?.act, c = g.ctrl;
    return a ? `${a.clip} f${(a.t * 60).toFixed(1)} y${c.body.y.toFixed(2)}` : `${c.st} y${c.body.y.toFixed(2)}`;
  });
  shots.push([await page.screenshot({ encoding: 'base64' }), cap]);
}
const info = await page.evaluate(() => ({ stats: __game.combat.stats, hp: [...__game.remotes.values()].map((r) => r.info.hp) }));
console.log(JSON.stringify(info));
const n = +cols, cw = W / (+process.env.HALF === 0 ? 1 : 2), ch = H / (+process.env.HALF === 0 ? 1 : 2);
const html = `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${n},${cw}px)}figure{margin:0;position:relative}
img{width:${cw}px;height:${ch}px;display:block}figcaption{position:absolute;left:4px;top:2px;font:bold 11px sans-serif;color:#ff0;text-shadow:0 0 3px #000}</style>
${shots.map(([s, c], i) => `<figure><img src="data:image/png;base64,${s}"><figcaption>${i} ${c}</figcaption></figure>`).join('')}`;
const sheet = await browser.newPage();
await sheet.setViewport({ width: n * cw, height: Math.ceil(shots.length / n) * ch });
await sheet.setContent(html);
await sheet.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote', out);
