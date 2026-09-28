import puppeteer from 'puppeteer-core';
const URL = 'http://localhost:3102/';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name) { const b = await launch(); const p = await b.newPage(); await p.setViewport({ width: 640, height: 360 }); await p.goto(`${URL}?autojoin=1&name=${name}`); await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 }); return { b, p }; }
const [A, B] = await Promise.all([client('A'), client('B')]);
await sleep(2000);
await A.p.evaluate(() => __game.teleport(-40, 32, Math.PI / 2));
await B.p.evaluate(() => __game.teleport(-46, 40, -Math.PI / 2));
await sleep(800);
const idB = await B.p.evaluate(() => __game.net.id);
for (let i = 0; i < 12; i++) {
  const b = await B.p.evaluate(() => [__game.ctrl.body.x, __game.ctrl.body.z].map((v) => +v.toFixed(2)));
  const a = await A.p.evaluate((id) => { const r = __game.remotes.get(id); const m = r.motion; return { pos: [r.fighter.pos.x, r.fighter.pos.z].map((v) => +v.toFixed(2)), cur: [m.cur[0], m.cur[2]].map((v) => +v.toFixed(2)), off: m.off.map((v) => +v.toFixed(2)), late: Math.round(m.late), n: m.buf.length, last: m.buf.length ? [m.buf[m.buf.length - 1].s[0], m.buf[m.buf.length - 1].s[2]].map((v) => +v.toFixed(2)) : null, rt: Math.round(__game.net.renderTime() - (m.buf.length ? m.buf[m.buf.length - 1].t : 0)) }; }, idB);
  console.log(i, 'B', b, 'A sees', JSON.stringify(a));
  if (i === 3) await B.p.evaluate(() => __game.hold(['up']));
  if (i === 7) await B.p.evaluate(() => __game.hold([]));
  await sleep(300);
}
await A.b.close(); await B.b.close();
