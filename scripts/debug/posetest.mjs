// Keyed-pose workbench: joins as a character, holds one pose spec (keyframes.js format, merged over the stance or a
// clip's `base`) on the local fighter and shoots it from several studio angles into one contact sheet. For hand signs,
// hand targets and clipping checks without rebuilding (the spec is applied live through Animator.debugPose).
// usage: node scripts/debug/posetest.mjs <url> <out.png> <spec.json | inline JSON> [views] [size]
//   views: comma list of name:yaw:pitch:dist:h (yaw 0 = in front; defaults: front, side (its left), back, top, close)
//   The page URL should autojoin (e.g. http://localhost:3104/?autojoin=1&name=P&ch=madara).
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const [url, out, specArg, viewsArg, sizeArg] = process.argv.slice(2);
if (!url || !out || !specArg) {
  console.log('usage: node scripts/debug/posetest.mjs <url> <out.png> <spec.json|JSON> [views] [size]');
  process.exit(1);
}
const spec = JSON.parse(fs.existsSync(specArg) ? fs.readFileSync(specArg, 'utf8') : specArg);
spec.__pos = (process.env.POS || '-30,44').split(',').map(Number);
const size = +(sizeArg || 420);
const VIEWS = (viewsArg || 'front:0:0.05:2.6:1.1,left:1.5708:0.05:2.6:1.1,back:3.1416:0.05:2.6:1.1,top:0.4:1.2:2.6:1.1,close:0.35:0.1:1.2:1.25')
  .split(',').map((v) => { const [name, yaw, pitch, dist, h] = v.split(':'); return { name, yaw: +yaw, pitch: +pitch, dist: +dist, h: +h }; });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: size, height: size });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await page.evaluate((spec) => {
  const g = __game, K = __kf, a = g.player.anim, rig = a.rig;
  // an open spot on the training field (POS=x,z for another; parallel runs on one server need different spots)
  g.teleport(spec.__pos[0], spec.__pos[1], 0);
  g.hud.show(false);
  const full = K.merge(K.merge(K.STANCE, spec.base || {}), spec.pose || spec);
  a.debugPose = (pose) => K.buildPose(rig, pose, full, K.H0(rig));
}, spec);
if (process.env.SETUP) await page.evaluate(process.env.SETUP); // (e.g. __game.jutsu.madara.forceGunbai = true)
await new Promise((r) => setTimeout(r, 1500));
// where the key bones landed, in the fighter frame (+x its left, +z forward, feet at 0; the reference body's units
// are NOT applied: these are this model's metres)
console.log(JSON.stringify(await page.evaluate(() => {
  const g = __game, f = g.player, out = {};
  const inv = f.root.matrixWorld.clone().invert();
  for (const b of ['head', 'neck', 'upperChest', 'leftHand', 'rightHand', 'rightIndexDistal', 'leftShoulder', 'rightShoulder']) {
    const n = f.vrm.humanoid.getRawBoneNode(b);
    if (!n) continue;
    const p = n.getWorldPosition(new f.pos.constructor()).applyMatrix4(inv);
    out[b] = [-p.x, p.y, -p.z].map((v) => +v.toFixed(3)); // the root faces -z; +x of the fighter frame is its left
  }
  return out;
})));
const shots = [];
for (const v of VIEWS) {
  await page.evaluate((v) => { __game.studio = { yaw: v.yaw, pitch: v.pitch, dist: v.dist, h: v.h, fov: 35 }; }, v);
  await new Promise((r) => setTimeout(r, 350));
  shots.push({ name: v.name, b64: await page.screenshot({ encoding: 'base64' }) });
}
const html = `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${shots.length},${size}px)}figure{margin:0;position:relative}
img{width:${size}px;height:${size}px;display:block}figcaption{position:absolute;left:4px;top:2px;font:bold 13px sans-serif;color:#ff0;text-shadow:0 0 3px #000}</style>
${shots.map((s) => `<figure><img src="data:image/png;base64,${s.b64}"><figcaption>${s.name}</figcaption></figure>`).join('')}`;
const p2 = await browser.newPage();
await p2.setViewport({ width: size * shots.length, height: size });
await p2.setContent(html);
await p2.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
