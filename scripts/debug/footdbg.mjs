// One animcheck scenario traced frame by frame for one leg: per-frame rotation (deg) of the thigh, shin and foot
// (normalized local), the foot's world rotation, and the gait's state for that foot. Finds what drives a pop.
// usage: CH=madara node scripts/debug/footdbg.mjs [url] [fromMs] [toMs] [side=left]
//   SCEN="<js>": another scenario (async; g = __game, s(ms), T(x, z, yaw) as in animcheck.mjs); default: the strafe
import puppeteer from 'puppeteer-core';

const [URL = 'http://localhost:3101/', from = '3600', to = '4000', side = 'left'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
await page.goto(`${URL}?autojoin=1&grass=0${process.env.CH ? `&ch=${process.env.CH}` : ''}`, { waitUntil: 'load' });
await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
const rows = await page.evaluate(async (from, to, side, scen) => {
  const g = __game, f = g.player, H = f.vrm.humanoid, s = (ms) => new Promise((r) => setTimeout(r, ms));
  const bones = ['UpperLeg', 'LowerLeg', 'Foot'].map((b) => H.getNormalizedBoneNode(side + b));
  const Q = bones[0].quaternion.constructor;
  const prev = bones.map((b) => b.quaternion.clone()), wq = new Q(), pw = new Q();
  bones[2].getWorldQuaternion(pw);
  const out = [];
  let t0 = 0, on = true;
  const deg = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI;
  const tick = () => {
    if (!on) return;
    requestAnimationFrame(tick);
    const t = performance.now() - t0;
    bones[2].getWorldQuaternion(wq);
    const d = bones.map((b, i) => deg(prev[i], b.quaternion)), dw = deg(pw, wq);
    bones.forEach((b, i) => prev[i].copy(b.quaternion));
    pw.copy(wq);
    if (t0 && t >= from && t <= to) {
      const gait = f.anim.gait, L = gait.feet.find((x) => x.side === side);
      out.push({ t: Math.round(t), key: f.anim.key, sp: +gait.speed.toFixed(2), d: d.map((v) => +v.toFixed(1)), dw: +dw.toFixed(1), pl: L.planted ? 1 : 0, sw: +L.swing.toFixed(2), pitch: +L.pitch.toFixed(1), yaw: +L.yaw.toFixed(2), p: [L.p.x, L.p.y, L.p.z].map((v) => +v.toFixed(3)), lw: +gait.legYaw.toFixed(2) });
    }
  };
  requestAnimationFrame(tick);
  if (scen) {
    const T = (x, z, yaw) => g.teleport(x, z, yaw, g.world.terrain(x, z));
    t0 = performance.now();
    await new Function('g', 's', 'T', `return (async () => { ${scen} })();`)(g, s, T);
    on = false;
    return out;
  }
  g.teleport(-26, 45, 0);
  t0 = performance.now();
  await s(300);
  g.ctrl.lockTarget = g.pickLock(0);
  g.hold(['left']);
  await s(1600);
  g.hold(['right']);
  await s(1200);
  g.hold(['down']);
  await s(900);
  g.hold([]);
  g.ctrl.lockTarget = null;
  await s(700);
  on = false;
  return out;
}, +from, +to, side, process.env.SCEN || '');
for (const r of rows) console.log(JSON.stringify(r));
await browser.close();
