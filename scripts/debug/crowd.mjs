// Bots + one client: prints what the client knows about the remotes (positions, visibility, LOD, materials) and saves
// a screenshot. usage: node scripts/debug/crowd.mjs [url=http://localhost:3101/] [bots=3] [out=shots/crowd.png]
import puppeteer from 'puppeteer-core';
import { bot } from '../test/bots.mjs';

const [URL = 'http://localhost:3101/', NB = '3', OUT = 'shots/crowd.png'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('[pageerror]', e.message); });
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`[${m.type()}]`, m.text().slice(0, 300)));
await page.goto(`${URL}?autojoin=1&name=Crowd`, { waitUntil: 'load' });
await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
const bots = [];
for (let i = 0; i < +NB; i++) bots.push(bot(URL, i, +NB, [8, 12]));
await sleep(2500); // the match starts when the bots join: everyone respawns
await page.evaluate(() => __game.teleport(8, 20, 0));
await sleep(3000);
console.log(await page.evaluate(() => {
  const g = __game;
  const out = [`player ${g.player.pos.toArray().map((v) => v.toFixed(1))} cam ${g.camera.position.toArray().map((v) => v.toFixed(1))}`];
  for (const [id, r] of g.remotes) {
    const f = r.fighter;
    if (!f) { out.push(`${id} no fighter`); continue; }
    let meshes = 0, vis = 0;
    f.root.traverse((o) => { if (o.isMesh) { meshes++; if (o.visible) vis++; } });
    out.push(`${id} ${r.info.name} pos ${f.pos.toArray().map((v) => v.toFixed(1))} root.visible ${f.root.visible} inScene ${!!f.root.parent} lod ${f.lod} matKey ${f.matKey} meshes ${meshes}/${vis} view ${!!f.view}`);
  }
  out.push(`portrait: ${getComputedStyle(g.hud.el.port).backgroundImage.slice(0, 40)}…`);
  return out.join('\n');
}));
await page.screenshot({ path: OUT });
for (const B of bots) { clearInterval(B.timer); B.ws.close(); }
await browser.close();
process.exit(0);
