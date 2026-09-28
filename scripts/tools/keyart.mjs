// Boot screen key art: three in-game shots (no HUD) at 1920x1080 saved as JPEG to public/assets/boot/key1-3.jpg.
// Re-run it after the character or the map changes (e.g. when naruto.vrm arrives). Needs a running server with a
// current build (dist-test on :3101 is fine).
// usage: node scripts/tools/keyart.mjs [url=http://localhost:3101/] [outDir=public/assets/boot]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:3101/';
const OUT = process.argv[3] || 'public/assets/boot';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [file, setup js, wait ms]: studio = an orbit camera round the fighter (yaw 0 = in front of it)
const SHOTS = [
  // the village street behind, a jab frozen mid-strike (slow motion)
  ['key1.jpg', `__game.teleport(30, 3, Math.PI / 2); setTimeout(() => { __game.studio = { yaw: 0.45, pitch: 0.02, dist: 3.1, h: 1.15, fov: 46 }; __game.timeScale = 0.2; __game.input.press('attack'); }, 400)`, 900],
  // the forest: giant trees, light shafts, falling leaves, the ninja sprint
  ['key2.jpg', `__game.teleport(-20, 22, 1.25); __game.hold(['up']); setTimeout(() => { __game.studio = { yaw: 2.3, pitch: -0.02, dist: 3.4, h: 0.95, fov: 52 }; }, 1300)`, 1500],
  // the Rasengan by the river, the waterfall behind
  ['key3.jpg', `__game.teleport(-2, -22, 0.2); setTimeout(() => { __game.gauge = { u: 100, sp: 3 }; __game.ctrl.chakra = 100; __game.input.press('jutsu1'); __game.studio = { yaw: 0.85, pitch: 0.06, dist: 2.8, h: 1.3, fov: 50 }; }, 300)`, 1050],
];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080'] });
for (const [file, js, wait] of SHOTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(`${URL}?autojoin=1&name=Naruto`, { waitUntil: 'load' });
  await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  await page.evaluate(() => {
    for (const id of ['hud', 'plates']) document.getElementById(id).style.display = 'none';
    __game.setPreset('ultra');
    __game.player.ring.scale.setScalar(0); // no ground ring in the art
  });
  await sleep(800);
  await page.evaluate(js);
  await sleep(wait);
  await page.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 84 });
  console.log(`wrote ${OUT}/${file} (${(fs.statSync(`${OUT}/${file}`).size / 1024).toFixed(0)} KB)`);
  await page.close();
}
await browser.close();
