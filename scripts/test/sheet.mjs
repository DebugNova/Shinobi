// Contact sheet: tiles screenshots into one labelled PNG for quick review.
// usage: node sheet.mjs <out.png> <cols> <img1.png> [img2.png ...]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const [out, cols = '4', ...files] = process.argv.slice(2);
const n = Number(cols);
const w = 1600, cellW = Math.floor(w / n), cellH = Math.round((cellW * 9) / 16);
const cells = files
  .map((f) => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${path.basename(f, '.png')}</figcaption></figure>`)
  .join('');
const html = `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${n},${cellW}px)}figure{margin:0;position:relative}
img{width:${cellW}px;height:${cellH}px;display:block}figcaption{position:absolute;left:4px;top:2px;font:bold 13px sans-serif;color:#ff0;text-shadow:0 0 3px #000}</style>${cells}`;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: cellW * n, height: cellH * Math.ceil(files.length / n) });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
