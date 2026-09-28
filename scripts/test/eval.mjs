// Joins, runs one expression in the page after it is ready and prints the result (quick checks of game state).
// usage: node eval.mjs <url> "<js expression>" [waitBeforeMs]
import puppeteer from 'puppeteer-core';
const [url, js, wait = '1500'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[error]', m.text().slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__game.state === "playing"', { timeout: 60000 });
await new Promise((r) => setTimeout(r, +wait));
console.log(await page.evaluate(js).catch((e) => 'eval error: ' + e.message));
await browser.close();
