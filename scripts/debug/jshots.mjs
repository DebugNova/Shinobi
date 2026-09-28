// Screenshots from a JSON config (one load, one contact sheet): node scripts/debug/jshots.mjs <cfg.json>
// cfg { url, w, h, out, setup, views: [[name, js, waitMs]] } -> one contact sheet (cols = views)
import fs from 'fs';
import puppeteer from 'puppeteer-core';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', `--window-size=${cfg.w || 600},${cfg.h || 700}`] });
const page = await browser.newPage();
await page.setViewport({ width: cfg.w || 600, height: cfg.h || 700 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => (m.type() === 'error' || /^\[g\]/.test(m.text())) && console.log('[console]', m.text().slice(0, 400)));
await page.goto(cfg.url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__game.state === "playing"', { timeout: 60000 });
if (cfg.setup) console.log('setup =>', JSON.stringify(await page.evaluate(cfg.setup)).slice(0, 300));
const shots = [];
for (const [name, js, wait] of cfg.views) {
  const r = await page.evaluate(js).catch((e) => 'err ' + e.message);
  if (r !== undefined) console.log(name, '=>', JSON.stringify(r).slice(0, 300));
  await new Promise((res) => setTimeout(res, wait ?? 300));
  shots.push({ name, b64: await page.screenshot({ encoding: 'base64' }) });
}
// sheet
const cols = cfg.cols || shots.length, W = cfg.w || 600, H = cfg.h || 700, sc = Math.min(1, 1800 / (W * cols));
const html = `<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${W * sc}px)">${shots.map((s) => `<div style="position:relative"><img style="width:${W * sc}px" src="data:image/png;base64,${s.b64}"><span style="position:absolute;left:4px;top:2px;color:#ff0;font:bold 14px sans-serif">${s.name}</span></div>`).join('')}</body>`;
const p2 = await browser.newPage();
const rows = Math.ceil(shots.length / cols);
await p2.setViewport({ width: Math.ceil(W * sc * cols), height: Math.ceil(H * sc * rows) });
await p2.setContent(html);
await p2.screenshot({ path: cfg.out });
await browser.close();
console.log('wrote', cfg.out);
