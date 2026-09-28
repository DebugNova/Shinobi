// Animation review: runs movement scenarios in one browser session and writes a filmstrip per scenario
// (shots/anim_<name>.png). The local fighter is driven with real input actions (__game.hold) in slow motion.
// usage: node scripts/test/anim.mjs [url=http://localhost:3101/] [only=name1,name2]
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3101/';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [name, setup js, frames, every ms, step js (i = frame), camera]
// the field at (-40, 40) is flat and open; the big tree at about (-56, 40) is climbable
const SIDE = '{yaw:Math.PI/2,dist:3.6,h:0.85}';
const Q = '{yaw:Math.PI*0.72,dist:3.8,h:0.9,pitch:0.15}';
const S = [
  ['idle', `__game.teleport(-40,40,0); __game.hold([]); __game.timeScale=1; __game.studio={yaw:0.5,dist:3,h:0.9}`, 8, 350, '', null],
  ['run_side', `__game.teleport(-50,40,-Math.PI/2); __game.hold(['up']); __game.timeScale=0.2; __game.studio=${SIDE}`, 18, 70, '', null],
  ['sprint_side', `__game.teleport(-48,30,-Math.PI/2); __game.hold(['up']); __game.timeScale=1`, 18, 70, 'if(i==0){__game.timeScale=0.2; __game.studio=' + SIDE + ';}', 900],
  ['sprint_q', `__game.teleport(-48,30,-Math.PI/2); __game.hold(['up']); __game.timeScale=1`, 12, 90, 'if(i==0){__game.timeScale=0.2; __game.studio=' + Q + ';}', 900],
  ['stop', `__game.teleport(-48,30,-Math.PI/2); __game.hold(['up']); __game.timeScale=1`, 18, 90, "if(i==0){__game.hold([]); __game.timeScale=0.3; __game.studio=" + SIDE + ";}", 900],
  ['turn', `__game.teleport(-40,40,0); __game.hold([]); __game.timeScale=1; __game.studio={yaw:0.6,dist:3.4,h:0.9,abs:true}`, 12, 160, "if(i==1){__game.hold(['left']);} if(i==4){__game.hold([]);} ", null],
  ['jump', `__game.teleport(-40,40,-Math.PI/2); __game.hold([]); __game.timeScale=0.3; __game.studio=${SIDE}`, 18, 80, "if(i==1){__game.hold(['jump']);} if(i==3){__game.hold([]);} if(i==6){__game.hold(['jump']);} if(i==7){__game.hold([]);}", null],
  ['runjump', `__game.teleport(-46,30,-Math.PI/2); __game.hold(['up']); __game.timeScale=0.3; __game.studio=${SIDE}`, 18, 80, "if(i==3){__game.hold(['up','jump']);} if(i==5){__game.hold(['up']);}", null],
  ['dash', `__game.teleport(-40,40,-Math.PI/2); __game.hold([]); __game.timeScale=0.25; __game.studio=${Q}`, 12, 60, "if(i==1){__game.hold(['up','dash']);} if(i==2){__game.hold([]);}", null],
  ['dash_side', `__game.teleport(-40,40,-Math.PI/2); __game.hold([]); __game.timeScale=0.25; __game.studio={yaw:0,dist:4,h:0.9}`, 12, 60, "if(i==1){__game.hold(['left','dash']);} if(i==2){__game.hold([]);}", null],
  ['wall', `__game.teleport(-49.5,40,-Math.PI/2); __game.hold([]); __game.timeScale=1`, 18, 110, "if(i==0){__game.cam.yaw=Math.PI/2; __game.teleport(-50,40,Math.PI/2); __game.cam.yaw=Math.PI/2; __game.hold(['up']); __game.timeScale=0.5; __game.studio={yaw:Math.PI/2,dist:5,h:1.5,pitch:0.1};} if(i==2){__game.hold(['up','jump']);} ", null],
];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 480 });
page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log('PAGEERROR', e.message); });
await page.goto(`${URL}?autojoin=1&name=Anim`, { waitUntil: 'load' });
await page.waitForFunction("window.__ready === true && window.__game.state === 'playing'", { timeout: 120000 });
await sleep(1000);
const sheetPage = await browser.newPage();
for (const [name, setup, frames, every, step, pre] of S) {
  if (ONLY && !ONLY.includes(name)) continue;
  await page.bringToFront();
  await page.evaluate(`__game.timeScale=1; __game.hold([]); __game.studio=null;`);
  await sleep(300);
  await page.evaluate(setup);
  await sleep(pre || 250);
  const shots = [];
  for (let i = 0; i < frames; i++) {
    if (step) await page.evaluate(`(i => { ${step} })(${i})`).catch((e) => console.log(name, 'step error', e.message));
    await sleep(every);
    shots.push(await page.screenshot({ encoding: 'base64' }));
  }
  const cols = 6, cw = 320, ch = 240;
  await sheetPage.setViewport({ width: cw * cols, height: ch * Math.ceil(shots.length / cols) });
  await sheetPage.setContent(`<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${cw}px)}figure{margin:0;position:relative}img{width:${cw}px;height:${ch}px;display:block}figcaption{position:absolute;left:4px;top:2px;font:bold 12px sans-serif;color:#ff0;text-shadow:0 0 3px #000}</style>${shots.map((s, i) => `<figure><img src="data:image/png;base64,${s}"><figcaption>${name} ${i}</figcaption></figure>`).join('')}`);
  await sheetPage.screenshot({ path: `shots/anim_${name}.png`, fullPage: true });
  console.log('wrote', `shots/anim_${name}.png`);
}
await browser.close();
