// usage: node views.mjs <url> <prefix> <views-json: [[name, jsExpr, waitMs?, clip?], ...]> [w h]
// clip = {x, y, width, height} crops the shot; VIEWS_DSF=2 renders at 2x device pixels (sharper crops).
import puppeteer from 'puppeteer-core';
const [url, prefix, viewsJson, w = '1600', h = '900'] = process.argv.slice(2);
const views = JSON.parse(viewsJson);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: +(process.env.VIEWS_DSF || 1) });
page.on('console', (m) => { const t = m.text(); if (/\[shinobi\]|rror|GL_INVALID/.test(t) && !/X4122|X3595|Pointer Lock/.test(t)) console.log('  console:', t.slice(0, 200)); });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('  PAGEERROR', e.message); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
for (const [name, js, wait = 900, clip] of views) {
  try { const r = await page.evaluate(js); if (r !== undefined && r !== null) console.log(name, '=>', JSON.stringify(r).slice(0, +(process.env.VIEWS_MAX || 4000))); } catch (e) { console.log(name, 'eval error', e.message); }
  await new Promise((r) => setTimeout(r, wait));
  await page.screenshot({ path: `${prefix}_${name}.png`, ...(clip ? { clip } : {}) });
}
await browser.close();
