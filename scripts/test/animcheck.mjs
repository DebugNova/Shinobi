// Automated animation checks on the drawn character, every rendered frame, across movement and combat scenarios
// played with real input at normal speed, on clear flat lanes (scripts/debug/lanes.mjs; teleports onto the terrain,
// never onto a prop):
//  - foot sliding: while the gait has a foot planted and flat (pitch < 8 deg), its ankle must not move over the ground
//    (horizontal drift from where the stance began; limit 2 cm);
//  - pops: a bone whose rotation in one frame is large (> 15 deg) and at least 2.5x its rotation in the frames
//    before and after: a discontinuity, not fast motion (sprinting legs and strikes are legitimately fast; the fastest
//    rotation is reported as information, scaled to deg per 60 fps frame). Strikes are not limited;
//  - facing: after running/strafing the body faces where the controller says.
// usage: node scripts/test/animcheck.mjs [url=http://localhost:3101/]   (CH=sage: as another character)
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3101/';
const SLIDE_CM = 2, POP_DEG = 15, SPIKE = 2.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [name, js run in the page (async), attack? (pop limit not applied)]
const S = [
  ['idle', `T(-40, 40, 0); await s(1500);`],
  ['run + stop', `T(-40, 40, -Math.PI / 2); g.hold(['up']); await s(1800); g.hold([]); await s(1200);`],
  ['sprint + turns', `T(-44, 40, -Math.PI / 2); g.hold(['up']); await s(1500); g.hold(['up', 'left']); await s(500); g.hold(['up']); await s(600); g.hold(['up', 'right']); await s(500); g.hold([]); await s(900);`],
  ['reverse (skid 180)', `T(-40, 40, -Math.PI / 2); g.hold(['up']); await s(1400); g.hold(['down']); await s(1200); g.hold([]); await s(800);`],
  ['walk-speed nudges', `T(-44, 44, 0); for (let i = 0; i < 4; i++) { g.hold(['up']); await s(160); g.hold([]); await s(420); }`],
  ['strafe (lock-on)', `g.teleport(-26, 45, 0); await s(300); g.ctrl.lockTarget = g.pickLock(0); g.hold(['left']); await s(1600); g.hold(['right']); await s(1200); g.hold(['down']); await s(900); g.hold([]); g.ctrl.lockTarget = null; await s(700);`],
  ['jump + double jump', `T(-40, 40, 0); await s(300); g.input.press('jump'); await s(380); g.input.press('jump'); await s(1500);`],
  ['run + jump + land', `T(-40, 40, -Math.PI / 2); g.hold(['up']); await s(900); g.input.press('jump'); await s(1200); g.hold([]); await s(900);`],
  ['dashes', `T(-40, 40, 0); await s(300); g.hold(['up']); g.input.press('dash'); await s(80); g.hold([]); await s(700); g.hold(['left']); g.input.press('dash'); await s(80); g.hold([]); await s(900);`],
  ['light combo', `g.teleport(-26, 42, 0); await s(400); for (let i = 0; i < 5; i++) { g.input.press('attack'); await s(270); } await s(900);`, true],
  ['moving combo', `g.teleport(-26, 49, 0); await s(400); g.hold(['up']); await s(600); for (let i = 0; i < 5; i++) { g.input.press('attack'); if (i === 0) g.hold([]); await s(270); } await s(1400);`, true],
  ['heavy', `g.teleport(-26, 42, 0); await s(400); g.input.press('heavy'); await s(1300);`, true],
];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('[pageerror]', e.message); });
await page.goto(`${URL}?autojoin=1&pw=HUNNY&grass=0${process.env.CH ? `&ch=${process.env.CH}` : ''}`, { waitUntil: 'load' });
await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
await sleep(800);

// the per-frame probe: runs after the game's frame (registered later in the same animation frame)
await page.evaluate((POP_DEG, SPIKE) => {
  const g = __game, f = g.player, vrm = f.vrm, H = vrm.humanoid;
  const names = Object.keys(H.humanBones).filter((n) => H.getNormalizedBoneNode(n));
  const nodes = names.map((n) => H.getNormalizedBoneNode(n));
  const prev = nodes.map((n) => n.quaternion.clone());
  // rotation rate (deg/ms) 1 and 2 frames ago, and 1 frame ago in degrees
  const r1 = new Float32Array(nodes.length), r2 = new Float32Array(nodes.length), d1 = new Float32Array(nodes.length);
  let ctx1 = null; // the previous frame's context (a spike is confirmed one frame later)
  const ank = { left: H.getRawBoneNode('leftFoot'), right: H.getRawBoneNode('rightFoot') };
  const V = ank.left.position.constructor;
  const w = new V();
  window.__probe = { on: false, rec: null };
  let last = performance.now();
  const stance = { left: null, right: null };
  const tick = () => {
    requestAnimationFrame(tick);
    const now = performance.now();
    // a frame where the game drew nothing new (no bone moved at all) is merged into the next one: otherwise the
    // next frame's catch-up looks like a spike
    if (window.__probe.on && nodes.every((n, i) => Math.abs(prev[i].dot(n.quaternion)) > 0.9999999)) return;
    const dt = now - last;
    last = now;
    const P = window.__probe;
    if (!P.on) {
      nodes.forEach((n, i) => prev[i].copy(n.quaternion));
      r1.fill(0);
      r2.fill(0);
      d1.fill(0);
      ctx1 = null;
      stance.left = stance.right = null;
      return;
    }
    const R = P.rec;
    R.frames++;
    // rotation this frame per bone; a spike one frame ago is a pop; the fastest rotation is kept as information
    const ctx = { t: Math.round(now - R.t0), dt: +dt.toFixed(1), key: f.anim.key, sp: +f.anim.gait.speed.toFixed(1), skid: +f.anim.gait.skidW.toFixed(2), ph: +f.anim.gait.phase.toFixed(2), act: g.ctrl.action ? g.ctrl.action.constructor.name + ':' + g.ctrl.st : 'st ' + g.ctrl.st, feet: f.anim.gait.feet.map((L) => [L.planted ? 1 : 0, L.swing, L.yaw, L.pitch, L.p.x, L.p.y, L.p.z]), lw: f.anim.gait.legYaw };
    nodes.forEach((n, i) => {
      const d = Math.min(1, Math.abs(prev[i].dot(n.quaternion)));
      const raw = dt < 30 ? (2 * Math.acos(d) * 180) / Math.PI : 0;
      const fast = raw * (16.67 / Math.max(4, dt));
      if (fast > R.fast) {
        R.fast = fast;
        R.fastBone = names[i];
      }
      const rate = raw / Math.max(4, dt), mid = r1[i];
      // a pop: a big change in one frame (degrees) whose rate is well above the frames around it (a long frame
      // legitimately moves further); the first frames are the scenario's own teleport
      if (ctx1 && ctx1.t > 80 && d1[i] > POP_DEG && mid >= SPIKE * Math.max(r2[i], rate)) {
        if (d1[i] > R.pop) {
          R.pop = d1[i];
          R.popBone = names[i];
          R.popAt = ctx1.t;
          R.popAct = ctx1.act;
        }
        if (R.events.length < 400) R.events.push({ ...ctx1, feet: ctx1.feet.map((q) => (q[0] ? 'P' : 'S') + ' sw' + q[1].toFixed(2) + ' y' + q[2].toFixed(2) + ' p' + q[3].toFixed(0) + ' [' + q.slice(4).map((v) => v.toFixed(2)) + ']').join(' | '), bone: names[i], raw: +d1[i].toFixed(1), rate: +(mid * 16.67).toFixed(1), before: +(r2[i] * 16.67).toFixed(1), after: +(rate * 16.67).toFixed(1) });
      }
      r2[i] = r1[i];
      r1[i] = rate;
      d1[i] = raw;
    });
    ctx1 = ctx;
    nodes.forEach((n, i) => prev[i].copy(n.quaternion));
    // sliding: ankle drift over a flat planted stance (the gait's own contact flags)
    const gait = f.anim.gait, loco = f.anim.key === 'loco';
    for (const foot of gait.feet) {
      const s = foot.side;
      const flat = loco && foot.planted && Math.abs(foot.pitch) < 8 && !gait.skidW;
      if (!flat) {
        stance[s] = null;
        continue;
      }
      ank[s].getWorldPosition(w);
      if (!stance[s]) stance[s] = { x: w.x, z: w.z, n: 0 };
      const st = stance[s];
      st.n++;
      const drift = Math.hypot(w.x - st.x, w.z - st.z) * 100;
      if (st.n > 1 && drift > R.slide) {
        R.slide = drift;
        R.slideAt = Math.round(now - R.t0);
        R.slideSpeed = gait.speed;
      }
    }
  };
  requestAnimationFrame(tick);
}, POP_DEG, SPIKE);

const rows = [];
for (const [name, js, attack] of S) {
  await page.evaluate(() => {
    window.__probe.rec = { frames: 0, pop: 0, popBone: '', popAt: 0, popAct: '', fast: 0, fastBone: '', slide: 0, slideAt: 0, slideSpeed: 0, t0: performance.now(), events: [] };
    __game.hold([]);
  });
  await page.evaluate(`(async () => { const g = __game, s = (ms) => new Promise((r) => setTimeout(r, ms)); const T = (x, z, yaw) => g.teleport(x, z, yaw, g.world.terrain(x, z)); await s(250); window.__probe.on = true; window.__probe.rec.t0 = performance.now(); ${js} window.__probe.on = false; })()`);
  const r = await page.evaluate(() => window.__probe.rec);
  const slideOk = r.slide <= SLIDE_CM, popOk = attack || r.pop <= POP_DEG;
  rows.push([name, slideOk && popOk]);
  if (process.env.DETAIL && !popOk) for (const e of r.events.sort((a, b) => b.raw - a.raw).slice(0, +(process.env.DETAIL) || 8)) console.log('      ', JSON.stringify(e));
  console.log(`${slideOk && popOk ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} frames ${String(r.frames).padStart(4)}  slide ${r.slide.toFixed(2)} cm${r.slide ? ` (at ${r.slideAt} ms, ${r.slideSpeed.toFixed(1)} m/s)` : ''}  ${r.pop ? `POP ${r.pop.toFixed(1)} deg in one frame (${r.popBone} at ${r.popAt} ms, ${r.popAct})` : 'no pops'}; fastest ${r.fast.toFixed(0)} deg/60fps-frame (${r.fastBone})${attack ? ' [strike: not limited]' : ''}`);
}
console.log(rows.every((r) => r[1]) ? 'ALL PASS' : `${rows.filter((r) => !r[1]).length} FAILED`);
await browser.close();
