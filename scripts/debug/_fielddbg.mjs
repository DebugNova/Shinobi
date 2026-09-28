import puppeteer from 'puppeteer-core';
const URL = 'http://localhost:3104/';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name, ch) { const b = await launch(); const p = await b.newPage(); p.on('pageerror', (e) => console.log(name, 'ERR', e.message)); await p.goto(`${URL}?autojoin=1&name=${name}&ch=${ch}`); await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 }); return { b, p }; }
const [A, B] = await Promise.all([client('M', 'madara'), client('T', 'naruto')]);
await sleep(2500);
const idB = await B.p.evaluate(() => __game.net.id);
await A.p.evaluate(() => { __game.teleport(-30, 44, 0); });
await B.p.evaluate(() => { __game.teleport(-30, 35, Math.PI); });
await sleep(1300);
await A.p.evaluate(() => { __game.combat.aimTarget = () => null; __game.ctrl.lockTarget = null; __game.cam.yaw = Math.PI / 2; __game.ctrl.yaw = Math.PI / 2; __game.input.press('jutsu1'); });
await sleep(2000);
const fp = await A.p.evaluate(() => { const f = __game.jutsu.madara.fires.at(-1); const s = (f.shape.field.s0 + f.shape.field.s1) / 2; return { p: [f.shape.o[0] + f.shape.dx * s, f.shape.o[2] + f.shape.dz * s], o: f.shape.o, d: [f.shape.dx, f.shape.dz], field: f.shape.field, lanes: f.shape.lanes.map((l) => l.len) }; });
console.log(JSON.stringify(fp));
await B.p.evaluate((p) => __game.teleport(p[0], p[1], 0), fp.p);
for (let i = 0; i < 6; i++) {
  await sleep(300);
  console.log(JSON.stringify(await A.p.evaluate((id) => { const f = __game.jutsu.madara.fires.at(-1); const r = __game.remotes.get(id); const t = f.t; return { t: +t.toFixed(2), tick: f.fieldTick, b: r.fighter.pos.toArray().map((v) => +v.toFixed(2)), react: !!r.react, fl: r.view?.flags }; }, idB)));
}
console.log(JSON.stringify(await A.p.evaluate(() => window.__hx ?? null)));
await A.b.close(); await B.b.close();
