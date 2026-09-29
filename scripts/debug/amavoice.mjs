// Amaterasu's voice line vs its cinematic: A (Itachi) casts on B; on BOTH screens, when the line is scheduled on the
// audio clock (AudioBufferSourceNode.start patched) and so when "Amaterasu" is heard, in the cinematic's own seconds
// (the word starts 1.46 s into public/assets/audio/amaterasu.mp3; it must be heard at AMA.voice + 1.46 + the display's
// lag). Also: the file as Chrome decodes it lines up with ffmpeg's decode (no encoder-delay shift), and a screen
// joining late (JOIN=0.3: B's line started 0.3 s into the cinematic's voice window) picks it up at the right offset.
// usage: node scripts/debug/amavoice.mjs [url=http://localhost:3104/]   (needs SHINOBI_ULT=1)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const url = process.argv[2] || 'http://localhost:3104/';
const FILE = 'public/assets/audio/amaterasu.mp3', WORD = 1.46, VOICE = 0; // (AMA.voice)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
async function client(name, ch) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 960, height: 540 });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) console.log(`[${name}] PAGEERROR ${e.message}`); });
  p.on('console', (m) => { const t = m.text(); if (/rror|audio/.test(t) && !/404|Pointer Lock|naruto\.vrm/.test(t)) console.log(`[${name}] ${t.slice(0, 300)}`); });
  await p.goto(`${url}?autojoin=1&pw=HUNNY&name=${name}&ch=${ch}`, { waitUntil: 'load' });
  await p.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
  return { b, p };
}
let fails = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); if (!ok) fails++; };

const [A, B] = await Promise.all([client('Itachi', 'itachi'), client('Target', 'naruto')]);
await sleep(2500);
// the audio runs on both, the file decoded
for (const [P, n] of [[A, 'A'], [B, 'B']]) {
  const st = await P.p.evaluate(async () => {
    const a = __game.audio;
    a.start();
    for (let k = 0; k < 50 && !a.buffer('amaterasu'); k++) await new Promise((r) => setTimeout(r, 100));
    const b = a.buffer('amaterasu');
    return { state: a.ctx?.state, dur: b?.duration, lat: a.latency() };
  });
  check(st.state === 'running' && st.dur > 9, `${n}: audio running, the line decoded`, JSON.stringify(st));
}
// Chrome's decode vs ffmpeg's: the lag that best lines up the word's first 0.6 s (cross-correlation within +-60 ms;
// not on the drone before it: its steady 85 Hz lines up every 12 ms)
const W0 = WORD - 0.05;
const chrome = await A.p.evaluate((W0) => {
  const b = __game.audio.buffer('amaterasu'), sr = b.sampleRate;
  return { sr, d: Array.from(b.getChannelData(0).subarray(Math.floor(W0 * sr), Math.floor((W0 + 0.7) * sr))) };
}, W0);
const tmp = 'shots/amavoice_pcm.f32';
fs.mkdirSync('shots', { recursive: true });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', FILE, '-af', 'pan=mono|c0=c0', '-ar', String(chrome.sr), '-f', 'f32le', tmp]);
const buf = fs.readFileSync(tmp), x = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
fs.unlinkSync(tmp);
const sr = chrome.sr, x0 = Math.floor(W0 * sr), N = Math.floor(0.6 * sr), R = Math.floor(0.06 * sr);
let best = -Infinity, lag = 0;
for (let L = -R; L <= R; L++) {
  let s = 0;
  for (let i = R; i < N; i++) s += chrome.d[i] * x[x0 + i + L];
  if (s > best) { best = s; lag = L; }
}
check(Math.abs(lag / sr) < 0.002, 'Chrome decodes the file on the same timeline as ffmpeg (no encoder-delay shift)', `best lag ${(lag / sr * 1000).toFixed(2)} ms`);

// the cast, with the scheduling recorded on both screens
const idB = await B.p.evaluate(() => __game.net.id);
await A.p.evaluate(() => { __game.teleport(-44, 58, 0); __game.ctrl.chakra = 100; __game.jutsu.ready = {}; });
await B.p.evaluate(() => { __game.teleport(-44, 49, Math.PI); });
await sleep(1400);
for (const P of [A, B]) {
  await P.p.evaluate(() => {
    window.__voice = [];
    const o = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, ...r) {
      if (this.buffer && this.buffer.duration > 9) {
        const a = __game.audio;
        window.__voice.push({ cine: __game.jutsu.itachi.cine.time(), now: this.context.currentTime, when, offset, lat: a.latency() });
      }
      return o.call(this, when, offset, ...r);
    };
  });
}
await A.p.evaluate((id) => { const r = __game.remotes.get(id); if (r?.fighter) __game.ctrl.lockTarget = { id, x: r.fighter.pos.x, y: r.fighter.pos.y, z: r.fighter.pos.z, dead: false }; if (__game.gauge) __game.gauge.u = 100; }, idB);
await A.p.evaluate(() => __game.input.press('ult'));
await sleep(6500);
const exp = VOICE + WORD + 0.01; // AMA.voice + the word's start + SHOW_LAG
const heard = [];
for (const [P, n] of [[A, 'A'], [B, 'B']]) {
  const v = await P.p.evaluate(() => window.__voice);
  check(v.length === 1, `${n}: the line played exactly once`, `${v.length} start(s)`);
  if (!v.length) continue;
  const s = v[0];
  // heard: the cinematic time of the call + the wait on the audio clock + the device latency, minus how far in it began
  const h = s.cine + Math.max(0, s.when - s.now) + s.lat + (WORD - s.offset);
  heard.push(h);
  check(Math.abs(h - exp) < 0.012, `${n}: "Amaterasu" heard on time (cinematic ${exp.toFixed(3)} s)`, `heard at ${h.toFixed(3)} s; scheduled at cine ${s.cine.toFixed(3)}, ${((s.when - s.now) * 1000).toFixed(0)} ms ahead, offset ${s.offset.toFixed(3)}, latency ${(s.lat * 1000).toFixed(1)} ms`);
  // (the caster's own screen: the line's first sound at the press, within a frame or two)
  if (n === 'A') check(s.cine < 0.04 && s.offset < 0.1, 'A: the line starts as soon as the ultimate is pressed', `started at cine ${s.cine.toFixed(3)} s, ${(s.offset * 1000).toFixed(0)} ms into the file`);
}
if (heard.length === 2) check(Math.abs(heard[0] - heard[1]) < 0.012, 'both screens hear it at the same moment', `${((heard[0] - heard[1]) * 1000).toFixed(1)} ms apart`);
// a screen that hears of the cast late joins the line at the right offset (voiceStep called 0.3 s into the line)
const late = await B.p.evaluate((VOICE) => {
  const c = __game.jutsu.itachi.cine, a = __game.audio;
  window.__voice = [];
  const S = { voice: false };
  const keep = c.S;
  c.S = S;
  c.voiceStep(VOICE + 0.3);
  const v = window.__voice[0];
  c.voice?.stop(0.01);
  c.voice = null;
  c.S = keep;
  return v ? { offset: v.offset, lat: a.latency() } : null;
}, VOICE);
check(!!late && Math.abs(late.offset - (0.3 + late.lat - 0.01)) < 0.002, 'a late screen joins the line where it is', late ? `offset ${late.offset.toFixed(3)} s` : 'not played');
await Promise.all([A.b.close(), B.b.close()]);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
