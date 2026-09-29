// The developer's command bar (src/ui/devbar.js) and the server's dev commands, PASS/FAIL:
//   in a real page (headless Chrome, real key events): "/" opens the bar, typing never plays (the T of "ult" is the
//   lock-on key), Enter runs /ult: the server fills the gauge and R then casts; /cd resets cooldowns + chakra; /sub
//   answers; an unknown command is caught; Esc closes it without the pause menu;
//   over raw WebSockets: a player arriving through a proxy (X-Forwarded-For, Cloudflare's header) is refused, even
//   when it forges a loopback entry first; a direct local one is served.
// usage: node scripts/test/devcmd.mjs [url=http://localhost:3101/]   (a plain test server: no SHINOBI_ULT, no SHINOBI_DEV)
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';

const url = process.argv[2] || 'http://localhost:3101/';
const wsUrl = url.replace(/^http/, 'ws').replace(/\/?$/, '/ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); if (!ok) fails++; };

// ---- raw clients: who may use them
async function rawDev(headers) {
  const ws = new WebSocket(wsUrl, { headers });
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((ok, no) => { ws.on('open', ok); ws.on('error', no); });
  ws.send(JSON.stringify({ t: 'join', name: 'Probe', ch: 'naruto' }));
  for (let k = 0; k < 50 && !got.some((m) => m.t === 'welcome'); k++) await sleep(100);
  ws.send(JSON.stringify({ t: 'dev', c: 'ult' }));
  for (let k = 0; k < 30 && !got.some((m) => m.t === 'dev'); k++) await sleep(100);
  ws.close();
  return { dev: got.find((m) => m.t === 'dev'), gauge: got.filter((m) => m.t === 'gauge').pop() };
}
{
  const r = await rawDev({});
  check(r.dev?.ok === 1 && r.gauge?.u === 100, 'a player on this machine is served (/ult fills the gauge)', JSON.stringify(r.dev));
}
for (const [what, h] of [
  ['through a proxy (X-Forwarded-For: a remote address)', { 'x-forwarded-for': '203.0.113.5' }],
  ['forging a loopback entry before the proxy\'s', { 'x-forwarded-for': '127.0.0.1, 203.0.113.5' }],
  ['through Cloudflare\'s tunnel', { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '203.0.113.5' }],
]) {
  const r = await rawDev(h);
  check(r.dev?.ok === 0 && r.dev?.why === 'off' && !(r.gauge?.u > 99), `a player ${what} is refused`, JSON.stringify(r.dev));
}
{
  const r = await rawDev({ 'x-forwarded-for': '127.0.0.1' });
  check(r.dev?.ok === 1, 'a player through the local dev proxy (Vite: X-Forwarded-For 127.0.0.1) is served', JSON.stringify(r.dev));
}

// ---- the bar in a real page
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) { console.log(`PAGEERROR ${e.message}`); fails++; } });
await p.goto(`${url}?autojoin=1&pw=HUNNY&name=Dev&ch=itachi`, { waitUntil: 'load' });
await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
await sleep(2000);
await p.evaluate(() => __game.teleport(-44, 58, 0));
await sleep(500);
const st = () => p.evaluate(() => ({
  open: document.getElementById('devbar').classList.contains('on'), focus: document.activeElement?.closest?.('#devbar') ? 1 : 0,
  u: __game.gauge.u, sp: __game.gauge.sp, lock: !!__game.ctrl.lockTarget, paused: !document.getElementById('pause')?.classList.contains('hidden'),
  toast: document.getElementById('toast')?.textContent, x: __game.ctrl.body.x, z: __game.ctrl.body.z,
  cine: __game.jutsu.itachi?.cine?.active, chakra: __game.ctrl.chakra, ready: Object.keys(__game.jutsu.ready).length,
}));
const s0 = await st();
check(s0.u < 99.5, 'the gauge starts empty (no SHINOBI_ULT)', `u ${s0.u}`);
await p.keyboard.press('Slash');
await sleep(150);
const s1 = await st();
check(s1.open && s1.focus, '"/" opens the bar, the field focused');
await p.keyboard.type('ult', { delay: 60 }); // (T is lock-on, U/L nothing: none may reach the fighter)
const typed = await p.evaluate(() => document.querySelector('#devbar input').value);
check(typed === 'ult', 'what is typed lands in the field (not a "/" before it)', JSON.stringify(typed));
await p.keyboard.press('Enter');
await sleep(600);
const s2 = await st();
check(!s2.open, 'Enter closes the bar');
check(s2.u === 100, '/ult: the server fills the ultimate gauge', `u ${s2.u}`);
check(!s2.lock && Math.hypot(s2.x - s0.x, s2.z - s0.z) < 0.05, 'typing never played (no lock-on from the T, no step)', `lock ${s2.lock}, moved ${Math.hypot(s2.x - s0.x, s2.z - s0.z).toFixed(3)} m`);
check(/Ultimate charged/.test(s2.toast || ''), 'the HUD says so', JSON.stringify(s2.toast));
await p.keyboard.press('KeyR');
await sleep(700);
const s3 = await st();
check(s3.cine === true && s3.u < 1, 'R then casts the ultimate (Amaterasu plays, the gauge spent)', `cine ${s3.cine}, u ${s3.u}`);
await sleep(6000); // (the cinematic out: the arena holds still meanwhile)
// /cd: cooldowns + chakra
await p.evaluate(() => { __game.jutsu.ready = { jutsu1: performance.now() / 1000 + 60 }; __game.ctrl.chakra = 5; });
await p.keyboard.press('Slash');
await p.keyboard.type('/cd', { delay: 40 }); // (a typed leading "/" is fine too)
await p.keyboard.press('Enter');
await sleep(600);
const s4 = await st();
check(s4.ready === 0 && s4.chakra >= 99, '/cd: cooldowns reset, chakra full', `ready ${s4.ready}, chakra ${s4.chakra.toFixed(0)}`);
await p.keyboard.press('Slash');
await p.keyboard.type('sub');
await p.keyboard.press('Enter');
await sleep(600);
const s5 = await st();
check(/Substitutions full/.test(s5.toast || '') && s5.sp >= 3, '/sub: substitutions full', `pips ${s5.sp}`);
await p.keyboard.press('Slash');
await p.keyboard.type('fly');
await p.keyboard.press('Enter');
await sleep(300);
check(/Unknown command \/fly/.test((await st()).toast || ''), 'an unknown command is caught');
await p.keyboard.press('Slash');
await sleep(100);
await p.keyboard.press('Escape');
await sleep(400);
const s6 = await st();
check(!s6.open && !s6.paused, 'Esc closes it without opening the pause menu', `open ${s6.open}, paused ${s6.paused}`);
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
