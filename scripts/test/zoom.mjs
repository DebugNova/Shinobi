// Wheel zoom (the camera dollies in toward the fighter): one client, synthetic wheel events (Chrome notches, Firefox
// lines, trackpad deltas): glide shape, limits (full arm out, ZOOM_NEAR in), the FOV never changes, a wall behind
// the camera still wins while zooming, sprinting zoomed in keeps the fighter framed, the wheel switches lock-on
// targets instead of zooming, no overshoot. usage: node zoom.mjs [url] [shotsDir]
import puppeteer from 'puppeteer-core';
const url = (process.argv[2] || 'http://localhost:3101/') + '?autojoin=1&name=Z';
const out = process.argv[3] || '.';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errs.push(m.text().slice(0, 200)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__game.state === "playing"', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, what) => {
  console.log(ok ? 'PASS' : 'FAIL', what);
  if (!ok) fails++;
};
await page.evaluate(() => {
  const g = __game;
  g.input.locked = true;
  window.__rec = [];
  // camera distance to the pivot over the shoulder (what the zoom changes), FOV, zoom level
  window.__armLen = () => {
    const c = g.cam, cp = Math.cos(c.pitch);
    const side = c.side * (1 - c.lockW * 0.4);
    const px = c.focus.x + Math.cos(c.yaw) * side, pz = c.focus.z - Math.sin(c.yaw) * side;
    return Math.hypot(g.camera.position.x - px, g.camera.position.y - c.focus.y, g.camera.position.z - pz);
  };
  const tick = () => { __rec.push([performance.now(), __armLen(), g.camera.fov, g.cam.zoom]); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__wheel = (dy, mode = 0) => dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: mode }));
});
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const state = () => page.evaluate(() => ({ arm: +__armLen().toFixed(3), fov: __game.camera.fov, zoom: +__game.cam.zoom.toFixed(4), target: +__game.cam.zoomTarget.toFixed(4), base: __game.cam.baseFov }));
const wheel = async (dy, n, gap, mode = 0) => {
  for (let i = 0; i < n; i++) {
    await page.evaluate((dy, mode) => __wheel(dy, mode), dy, mode);
    await sleep(gap);
  }
};
// an open spot: the arm is free at every yaw
const spot = await page.evaluate(async () => {
  const g = __game, w = g.world;
  for (let x = -40; x <= 40; x += 4) for (let z = -40; z <= 40; z += 4) {
    const y = w.ground(x, z, 60, {}).y + 1.42;
    let ok = true;
    for (let a = 0; a < 16 && ok; a++) {
      const t = w.raycast(x, y, z, Math.cos(a * 0.3927), 0.1, Math.sin(a * 0.3927), 6, {});
      if (t < 6) ok = false;
    }
    if (ok && Math.hypot(x - g.dummy.pos.x, z - g.dummy.pos.z) > 8) return [x, z];
  }
  return null;
});
check(!!spot, `open spot ${spot}`);
await page.evaluate(([x, z]) => __game.teleport(x, z, 0), spot);
await sleep(800);
const s0 = await state();
console.log('start', s0);
await shot('0-out');
await wheel(-100, 3, 40);
await sleep(600);
console.log('3 in', await state());
await wheel(-100, 15, 12);
await sleep(700);
const sIn = await state();
console.log('max in', sIn);
check(sIn.zoom === 1 && Math.abs(sIn.arm - 1.0) < 0.06, `fully in: arm ${sIn.arm} m (want ~1.0)`);
check(sIn.fov === s0.base, `FOV unchanged zoomed in (${sIn.fov})`);
await shot('1-in');
// look around zoomed in (side view, looking down, looking up)
await page.evaluate(() => { __game.cam.yaw += 1.2; });
await sleep(400);
await shot('2-in-turned');
await page.evaluate(() => { __game.cam.pitch = 0.9; });
await sleep(400);
await shot('3-in-up');
await page.evaluate(() => { __game.cam.pitch = -1.3; });
await sleep(400);
await shot('4-in-down');
await page.evaluate(() => { __game.cam.pitch = -0.22; __game.cam.yaw = __game.ctrl.yaw; });
// sprint zoomed in: the fighter stays near its framing (the focus tightens)
await page.evaluate(() => __game.hold(['up']));
await sleep(1600);
const run = await page.evaluate(() => {
  const g = __game, f = g.cam.focus, p = g.player.pos;
  return { lag: +Math.hypot(f.x - p.x, f.z - p.z).toFixed(3), speed: +Math.hypot(g.ctrl.body.vx, g.ctrl.body.vz).toFixed(2), arm: +__armLen().toFixed(3) };
});
await shot('5-in-run');
await page.evaluate(() => __game.hold([]));
console.log('running zoomed in', run);
check(run.lag < 0.3, `focus lag while running zoomed in ${run.lag} m`);
await sleep(600);
await page.evaluate(([x, z]) => __game.teleport(x, z, 0), spot);
await sleep(500);
// Firefox line mode: 2 notches out; trackpad: 50 small deltas out
await wheel(3, 2, 20, 1);
await sleep(600);
const ff = await state();
console.log('ff 2 out', ff);
check(Math.abs(ff.target - 0.8) < 1e-6, 'Firefox lines: 2 notches');
await wheel(4, 50, 8);
await sleep(600);
const tp = await state();
console.log('trackpad out', tp);
check(Math.abs(tp.target - 0.6) < 1e-6, 'trackpad: 2 notches worth');
await wheel(100, 20, 12);
await sleep(800);
const sOut = await state();
console.log('max out', sOut);
check(sOut.zoom === 0 && Math.abs(sOut.arm - s0.arm) < 0.01, `fully out: arm ${sOut.arm} = start ${s0.arm}`);
check(sOut.fov === s0.base, `FOV exactly the setting (${sOut.fov})`);
// settings FOV change: the zoom range stays, the FOV follows the setting only
await page.evaluate(() => __game.applySettings({ ...__game.settings, fov: 90 }, 'fov'));
await wheel(-100, 5, 20);
await sleep(600);
const s90 = await state();
check(s90.fov === 90, `FOV 90 setting while zoomed: ${s90.fov}`);
await wheel(100, 10, 12);
await page.evaluate(() => __game.applySettings({ ...__game.settings, fov: 70 }, 'fov'));
await sleep(700);
// a wall behind the camera: find a yaw where the arm is cut short, zoom in and out: never past the wall
const wall = await page.evaluate(async () => {
  const g = __game, w = g.world;
  for (let x = -60; x <= 60; x += 3) for (let z = -60; z <= 60; z += 3) {
    const gy = w.ground(x, z, 60, {}).y;
    if (Math.abs(gy) > 20) continue;
    for (let a = 0; a < 8; a++) {
      const yaw = a * Math.PI / 4;
      // the arm points backward from the view: -forward = (sin yaw, cos yaw)
      const t = w.raycast(x, gy + 1.42, z, Math.sin(yaw), 0.07, Math.cos(yaw), 6, {});
      const ahead = w.raycast(x, gy + 1.42, z, -Math.sin(yaw), 0, -Math.cos(yaw), 3, {});
      if (t > 1.9 && t < 2.4 && ahead >= 3) return [x, z, yaw, t];
    }
  }
  return null;
});
check(!!wall, `wall spot ${wall}`);
if (wall) {
  await page.evaluate(([x, z, yaw]) => { __game.teleport(x, z, yaw); __game.cam.yaw = yaw; }, wall);
  await sleep(1500);
  const w0 = await state();
  await page.evaluate(() => { __rec.length = 0; });
  await wheel(-100, 10, 15);
  await sleep(600);
  const w1 = await state();
  await wheel(100, 10, 15);
  await sleep(900);
  const w2 = await state();
  const peak = Math.max(...(await page.evaluate(() => __rec.map((r) => r[1]))));
  console.log('wall', { outBefore: w0.arm, in: w1.arm, outAfter: w2.arm, peak: +peak.toFixed(3) });
  check(w0.arm < s0.arm - 0.3, `arm cut by the wall (${w0.arm} < ${s0.arm})`);
  check(Math.abs(w1.arm - 1.0) < 0.06, `zoomed in in front of the wall (${w1.arm})`);
  check(Math.abs(w2.arm - w0.arm) < 0.03 && peak < w0.arm + 0.03, `zooming out stops at the wall (${w2.arm}, peak ${peak.toFixed(3)})`);
  await shot('6-wall');
}
// lock-on: the wheel switches targets, never zooms
await page.evaluate(() => { const d = __game.dummy; __game.teleport(d.pos.x + 4, d.pos.z + 4, Math.atan2(4, 4)); });
await sleep(500);
const locked = await page.evaluate(() => { __game.ctrl.lockTarget = __game.pickLock(0); return !!__game.ctrl.lockTarget; });
const z0 = (await state()).target;
await wheel(-100, 3, 40);
await sleep(300);
check(locked && (await state()).target === z0, 'locked on: the wheel does not zoom');
await page.evaluate(() => { __game.ctrl.lockTarget = null; });
// smoothness over the whole recording (of the zoom level)
const rec = await page.evaluate(() => __rec);
let bad = 0;
for (const r of rec) if (r[3] < -1e-9 || r[3] > 1 + 1e-9) bad++;
check(bad === 0, 'zoom level never outside [0, 1]');
check(errs.length === 0, `no page errors ${errs.length ? JSON.stringify(errs) : ''}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
