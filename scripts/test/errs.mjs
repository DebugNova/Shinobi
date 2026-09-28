// Prints console errors / page errors while the page loads (quick check for startup crashes).
// usage: node errs.mjs <url> [timeoutMs] [jsAfterReady] [waitAfterMs]
import puppeteer from 'puppeteer-core';
const [url, ms = '45000', js, after = '3000'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || /\[shinobi\]/.test(m.text())) console.log(`[${m.type()}]`, m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 12).join(' | ')));
await page.goto(url, { waitUntil: 'load' });
try { await page.waitForFunction('window.__ready === true', { timeout: +ms }); console.log('ready'); if (js) { await page.evaluate(js).catch((e) => console.log('eval error', e.message)); await new Promise((r) => setTimeout(r, +after)); } } catch { console.log('!! __ready timeout'); }
await browser.close();
