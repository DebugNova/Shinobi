// usage: node shoot.mjs <url> <out.png> [waitMs] [w] [h] [evalJs]
import puppeteer from 'puppeteer-core';
const [url, out, wait = '3000', w = '1280', h = '720', evalJs] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', `--window-size=${w},${h}`],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
try { await page.waitForFunction('window.__ready === true', { timeout: 90000 }); } catch { logs.push('!! __ready timeout'); }
if (evalJs) { try { const r = await page.evaluate(evalJs); if (r !== undefined) logs.push('eval: ' + JSON.stringify(r)); } catch (e) { logs.push('eval error: ' + e.message); } }
await new Promise((r) => setTimeout(r, +wait));
const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
await page.screenshot({ path: out });
console.log('GPU:', gl);
console.log(logs.filter(l => !l.includes('GPU stall')).slice(0, 40).join('\n'));
await browser.close();
