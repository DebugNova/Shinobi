import puppeteer from 'puppeteer-core';
const URL = 'http://localhost:3104/';
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(name, ch) { const b = await launch(); const p = await b.newPage(); p.on('pageerror', (e) => console.log(name, 'ERR', e.message, e.stack?.split('\n').slice(0, 4).join(' | '))); await p.goto(`${URL}?autojoin=1&name=${name}&ch=${ch}`); await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 }); return { b, p }; }
const [A, B] = await Promise.all([client('M', 'madara'), client('T', 'naruto')]);
await sleep(2500);
const idB = await B.p.evaluate(() => __game.net.id);
await A.p.evaluate(() => { __game.teleport(-30, 44, 0); });
await B.p.evaluate(() => { __game.teleport(-30, 35, Math.PI); });
await sleep(1300);
await A.p.evaluate(() => { __game.ctrl.lockTarget = __game.pickLock(0); window.__dbg = []; const K = __game.jutsu.madara; const f0 = K.fireHits.bind(K); K.fireHits = (f, t) => { const tg = __game.combat.targets().map((x) => ({ id: x.id, x: +x.x.toFixed(2), y: +x.y.toFixed(2), z: +x.z.toFixed(2), valid: x.hurt?.valid, fl: x.entry.view?.flags, inv: x.entry.react?.invuln?.(__game.net.serverNow()) })); if (window.__dbg.length < 40 && Math.random() < 0.3) window.__dbg.push({ t: +t.toFixed(2), tg, o: f.shape.o, d: [f.shape.dx, f.shape.dz], lanes: f.shape.lanes.map((l) => +l.len.toFixed(1)), v: [...f.victims] }); return f0(f, t); }; __game.input.press('jutsu1'); });
await sleep(2500);
console.log(JSON.stringify(await A.p.evaluate(() => ({ lock: __game.ctrl.lockTarget, dbg: window.__dbg.slice(0, 8) })), null, 0));
await A.b.close(); await B.b.close();
