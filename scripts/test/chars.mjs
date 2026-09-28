// Character select + names over the network: A joins as Sage Naruto (or CH=<id>) named "Nova", B as the default character with
// no name. Checks: the names the server gives (typed name / the character's name), each client draws the other with
// the right character's model and clip library, B sees A's Shadow Clones in A's body, and the title screen's name
// field + cards work (typing doesn't join, Enter does). PASS/FAIL per check; screenshots with SHOTS=dir.
// usage: [CH=<id>] node scripts/test/chars.mjs [url=http://localhost:3101/]   (CH: the character A picks, default sage)
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3101/';
const SHOTS = process.env.SHOTS;
const CH = process.env.CH || 'sage';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// one browser per client (own profile = own localStorage; no background-tab throttling), as in mp.mjs
const browsers = [];
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
let fails = 0;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) fails++;
};
async function open(query) {
  const br = await launch();
  browsers.push(br);
  const p = await br.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  p.on('pageerror', (e) => !/Pointer Lock/.test(e.message) && console.log('  [pageerror]', e.message));
  await p.goto(`${URL}${query}`, { waitUntil: 'load' });
  await p.waitForFunction('window.__ready === true', { timeout: 120000 });
  return p;
}

// ---- A: through the title screen like a player (type a name, pick CH's card by its number key, Enter)
const A = await open('?grass=0');
await A.evaluate(() => localStorage.clear());
await A.click('#ti-name');
await A.keyboard.type('Nova');
await sleep(200);
check(await A.evaluate(() => __game.state === 'title'), 'typing a name does not join');
await A.evaluate(() => document.getElementById('ti-name').blur());
const key = (await A.evaluate((ch) => [...__game.cardEls.keys()].indexOf(ch), CH)) + 1;
if (key < 1) throw new Error(`no card for ${CH}`);
await A.keyboard.press(`Digit${key}`);
await sleep(100);
check(await A.evaluate((ch) => __game.picked === ch && document.querySelectorAll('.ti-card.on').length === 1, CH), `key ${key} picks the ${CH} card`);
await A.click('#ti-name');
await A.keyboard.press('Enter');
await A.waitForFunction("__game.state === 'playing'", { timeout: 60000 });
const a = await A.evaluate((ch) => ({ id: __game.net.id, name: __game.me.name, ch: __game.me.ch, saved: [localStorage.getItem('shinobi.name'), localStorage.getItem('shinobi.char')], ownModel: __game.chars.get(ch).model.pool.includes(__game.player.vrm) }), CH);
check(a.name === 'Nova' && a.ch === CH, `A joined as Nova / ${CH}`, JSON.stringify(a));
check(a.ownModel, `A draws itself with the ${CH} model`);
check(a.saved[0] === 'Nova' && a.saved[1] === CH, 'name and character remembered', a.saved.join(', '));

// ---- B: the default character, no name
const B = await open('?autojoin=1&grass=0&name=');
await B.waitForFunction("__game.state === 'playing'", { timeout: 60000 });
const b = await B.evaluate(() => ({ id: __game.net.id, name: __game.me.name, ch: __game.me.ch }));
check(b.ch === 'naruto' && /^Naruto( \d+)?$/.test(b.name), 'B with no name gets the character name', JSON.stringify(b));

await A.waitForFunction((id) => __game.remotes.get(id)?.fighter, { timeout: 20000 }, b.id);
await B.waitForFunction((id) => __game.remotes.get(id)?.fighter, { timeout: 20000 }, a.id);
const aSeesB = await A.evaluate((id) => { const r = __game.remotes.get(id); return { name: r.info.name, ch: r.info.ch, model: __game.chars.get('naruto').model.pool.includes(r.fighter.vrm), lib: r.fighter.anim.lib === __game.chars.get('naruto').lib }; }, b.id);
const bSeesA = await B.evaluate((id, ch) => { const r = __game.remotes.get(id); return { name: r.info.name, ch: r.info.ch, model: __game.chars.get(ch).model.pool.includes(r.fighter.vrm), lib: r.fighter.anim.lib === __game.chars.get(ch).lib, plate: r.plate?.textContent }; }, a.id, CH);
check(aSeesB.ch === 'naruto' && aSeesB.model && aSeesB.lib, 'A draws B as Naruto', JSON.stringify(aSeesB));
check(bSeesA.ch === CH && bSeesA.model && bSeesA.lib && bSeesA.name === 'Nova', `B draws A as ${CH} named Nova`, JSON.stringify(bSeesA));

// ---- A casts Shadow Clone Rush next to B: B must see clones in A's body
await A.evaluate(() => __game.teleport(-30, 44, 0));
await B.evaluate(() => __game.teleport(-30, 40, Math.PI));
await sleep(1200);
await A.evaluate(() => { __game.ctrl.chakra = 100; __game.input.press('jutsu2'); });
let clones = null;
for (let i = 0; i < 40 && !clones?.n; i++) {
  await sleep(100);
  clones = await B.evaluate((ch) => { const cs = __game.jutsu.clones.filter((c) => !c.gone); const pool = __game.jutsu.clonePools.get(ch); return { n: cs.length, own: cs.every((c) => pool.includes(c.f.vrm)) }; }, CH);
}
check(clones.n > 0 && clones.own, `B sees A's clones in the ${CH} body`, JSON.stringify(clones));
if (SHOTS) {
  await B.evaluate(() => { __game.studio = { yaw: 0, pitch: 0.1, dist: 7, h: 1, fov: 45 }; });
  await sleep(300);
  await B.screenshot({ path: `${SHOTS}/chars_b.png` });
  await A.evaluate(() => { __game.studio = { yaw: 0, pitch: 0.1, dist: 7, h: 1, fov: 45 }; });
  await A.screenshot({ path: `${SHOTS}/chars_a.png` });
}

// ---- rename relayed: the server's `name` message updates the other screen
await A.evaluate(() => __game.net.send({ t: 'name', name: 'Nova the Sage' }));
await sleep(600);
const renamed = await B.evaluate((id) => __game.remotes.get(id).info.name, a.id);
check(renamed === 'Nova the Sage', 'a rename reaches the other screen', renamed);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
for (const br of browsers) await br.close();
process.exit(fails ? 1 : 0);
