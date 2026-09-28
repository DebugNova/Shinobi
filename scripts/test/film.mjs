// Filmstrip: loads the game once, runs a setup, then captures frames at a fixed interval into one contact sheet
// (animation review: one image per sequence instead of a video).
// usage: node film.mjs <url> <out.png> <setupJs> [frames=12] [everyMs=120] [cols=6] [w=640] [h=480] [stepJs]
//   stepJs (optional) runs before each frame with `i` = frame index.
// Tip: slow the game with __game.timeScale = 0.25 in setupJs to see fast moves frame by frame.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [url, out, setup, frames = '12', every = '120', cols = '6', w = '640', h = '480', stepJs = ''] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
page.on('console', (m) => { const t = m.text(); if (/rror|GL_INVALID/.test(t) && !/404|Pointer Lock/.test(t)) console.log('console:', t.slice(0, 200)); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
try {
  const r = await page.evaluate(setup);
  if (r !== undefined && r !== null) console.log('setup =>', JSON.stringify(r).slice(0, 600));
} catch (e) {
  console.log('setup error', e.message);
}
const shots = [];
for (let i = 0; i < +frames; i++) {
  if (stepJs) {
    try {
      const r = await page.evaluate(`(i => { ${stepJs} })(${i})`);
      if (r !== undefined && r !== null) console.log(`#${i}`, JSON.stringify(r).slice(0, 300));
    } catch (e) {
      console.log('step error', e.message);
    }
  }
  await new Promise((r) => setTimeout(r, +every));
  shots.push((await page.screenshot({ encoding: 'base64' })));
}
const n = +cols, cw = +w / 2, ch = +h / 2;
const html = `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${n},${cw}px)}figure{margin:0;position:relative}
img{width:${cw}px;height:${ch}px;display:block}figcaption{position:absolute;left:4px;top:2px;font:bold 12px sans-serif;color:#ff0;text-shadow:0 0 3px #000}</style>
${shots.map((s, i) => `<figure><img src="data:image/png;base64,${s}"><figcaption>${i}</figcaption></figure>`).join('')}`;
const p2 = await browser.newPage();
await p2.setViewport({ width: cw * n, height: ch * Math.ceil(shots.length / n) });
await p2.setContent(html);
await p2.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote', out);
