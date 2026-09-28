// Crops (and optionally upscales) a screenshot region for close inspection.
// usage: node crop.mjs <in.png> <out.png> <x> <y> <w> <h> [scale=2]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [inp, out, x, y, w, h, scale = '2'] = process.argv.slice(2);
const k = +scale;
const src = `data:image/png;base64,${fs.readFileSync(inp).toString('base64')}`;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: Math.round(w * k), height: Math.round(h * k) });
await page.setContent(`<style>body{margin:0;overflow:hidden}img{position:absolute;left:${-x * k}px;top:${-y * k}px;transform-origin:0 0;transform:scale(${k});image-rendering:auto}</style><img src="${src}">`);
await page.waitForSelector('img');
await page.evaluate(() => document.querySelector('img').decode());
await page.screenshot({ path: out });
await browser.close();
