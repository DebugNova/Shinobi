import puppeteer from 'puppeteer-core';
const URL = 'http://localhost:3104/';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name, ch) { const b = await launch(); const p = await b.newPage(); p.on('pageerror', (e) => console.log(name, 'ERR', e.message)); await p.goto(`${URL}?autojoin=1&name=${name}&ch=${ch}`); await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 }); return { b, p }; }
const [A, B] = await Promise.all([client('M', 'madara'), client('T', 'naruto')]);
await sleep(2500);
await A.p.evaluate(() => { __game.teleport(-30, 44, 0); });
await B.p.evaluate(() => { __game.teleport(-30, 35, Math.PI); window.__nan = null; const g = __game; const add = g.cam.addTrauma.bind(g.cam); g.cam.addTrauma = (t) => { if (!Number.isFinite(t) && !window.__nan) window.__nan = new Error('trauma ' + t).stack; add(t); }; (function loop() { const c = g.camera.position; if (!Number.isFinite(c.x) && !window.__nan2) window.__nan2 = { cam: [c.x, c.y, c.z], trauma: g.cam.trauma, focus: g.cam.focus.toArray(), player: g.player.pos.toArray(), body: [g.ctrl.body.x, g.ctrl.body.y, g.ctrl.body.z], act: g.ctrl.action?.constructor.name }; requestAnimationFrame(loop); })(); });
await sleep(1300);
await A.p.evaluate(() => { __game.ctrl.lockTarget = __game.pickLock(0); __game.input.press('jutsu1'); });
await sleep(4000);
console.log(JSON.stringify(await B.p.evaluate(() => ({ nan: window.__nan, nan2: window.__nan2, hp: __game.hp }))));
await A.b.close(); await B.b.close();
