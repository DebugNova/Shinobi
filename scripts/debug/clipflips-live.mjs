// clipflips.mjs on the real bodies: every character's baked keyed clips (its own rig), sampled at quarter frames in
// the game page. usage: node scripts/debug/clipflips-live.mjs <url> [clip prefix regex=^(u_|r_)] [LIM=8]
import puppeteer from 'puppeteer-core';
const [url, re = '^(u_|r_)', LIM = '8'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto(`${url}?autojoin=1&grass=0`, { waitUntil: 'load' });
await page.waitForFunction("window.__game && window.__game.state === 'playing'", { timeout: 120000 });
const out = await page.evaluate((re, LIM) => {
  const g = __game, res = [];
  for (const [ch, e] of g.chars) {
    const rig = e.model.rig, P = g.player.anim.pose.constructor;
    for (const [id, clip] of e.lib.clips || e.lib.map || []) {
      if (!new RegExp(re).test(id)) continue;
      const n = Math.round(clip.dur * 240), poses = [];
      for (let i = 0; i <= n; i++) { const p = new P(); clip.sample(i / 240, p, rig.hipsY); poses.push(p.q.slice()); }
      for (let b = 0; b < poses[0].length / 4; b++) {
        const d = [];
        for (let i = 1; i <= n; i++) { const a = poses[i - 1], q = poses[i], o = b * 4; const dot = Math.min(1, Math.abs(a[o] * q[o] + a[o + 1] * q[o + 1] + a[o + 2] * q[o + 2] + a[o + 3] * q[o + 3])); d.push((2 * Math.acos(dot) * 180) / Math.PI); }
        for (let i = 1; i < d.length - 1; i++) if (d[i] > LIM && d[i] > 3 * Math.max(d[i - 1], d[i + 1])) res.push(`${ch} ${id} bone${b} f${(i / 4).toFixed(2)} ${d[i].toFixed(1)} (${d[i - 1].toFixed(1)}, ${d[i + 1].toFixed(1)})`);
      }
    }
  }
  return res;
}, re, +LIM);
console.log(out.length ? out.join('\n') : 'no flips');
await browser.close();
