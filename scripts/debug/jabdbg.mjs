// debug: one jab from A at B, logging A's hitbox samples and B's hurtbox capsules
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:3101/';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name) { const b = await launch(); const p = await b.newPage(); await p.setViewport({ width: 640, height: 360 }); await p.goto(`${URL}?autojoin=1&name=${name}`); await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 }); return { b, p }; }
const [A, B] = await Promise.all([client('A'), client('B')]);
await sleep(1500);
const idB = await B.p.evaluate(() => __game.net.id);
await A.p.evaluate(() => __game.teleport(-30, 44, 0));
await B.p.evaluate(() => __game.teleport(-30, 42.6, Math.PI));
await sleep(1500);
await A.p.evaluate((idB) => {
  window.__dbg = [];
  const c = __game.combat, orig = c.hitboxAt.bind(c);
  c.hitboxAt = (act, frame, a, b) => {
    orig(act, frame, a, b);
    const r = __game.remotes.get(idB);
    const caps = r.fighter.hurt.caps.map((c) => [c.part, c.a.toArray().map((v) => +v.toFixed(2)), c.b.toArray().map((v) => +v.toFixed(2)), c.r]);
    window.__dbg.push({ id: act.id, frame, a: a.toArray().map((v) => +v.toFixed(2)), b: b.toArray().map((v) => +v.toFixed(2)), me: [__game.ctrl.body.x, __game.ctrl.body.z].map((v) => +v.toFixed(2)), B: [r.fighter.pos.x, r.fighter.pos.z].map((v) => +v.toFixed(2)), caps: frame === act.M.startup ? caps : undefined, tracked: act.target ? act.target.id : null });
  };
  __game.input.press('attack');
}, idB);
await sleep(1200);
for (const d of await A.p.evaluate(() => window.__dbg)) console.log(JSON.stringify(d));
await A.b.close(); await B.b.close();
