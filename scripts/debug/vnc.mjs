// Minimal VNC (RFB 3.8) console driver for the VPS (when SSH is lost): types text, then saves a screenshot.
// node scripts/debug/vnc.mjs <out.png> [text] [waitMs]    text: "\n" = Enter, "{ctrl-c}" = Ctrl+C
// First call: text "root\n", then the root password + "\n" (from the Shulker panel), then commands.
import net from 'node:net';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const [out, text = '', waitArg] = process.argv.slice(2);
const wait = Number(waitArg ?? 1500);
const HOST = 'in-1.shulker.in', PORT = 5939, PASS = process.env.VNC_PASS || '';

const sock = net.connect(PORT, HOST);
let buf = Buffer.alloc(0), want = null;
sock.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
sock.on('error', (e) => { console.error('socket', e.message); process.exit(1); });
function pump() {
  if (want && buf.length >= want.n) { const b = buf.subarray(0, want.n); buf = buf.subarray(want.n); const w = want; want = null; w.ok(b); }
}
const read = (n) => new Promise((ok) => { want = { n, ok }; pump(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function desKey(pw) {
  const k = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    const c = i < pw.length ? pw.charCodeAt(i) : 0;
    let r = 0; for (let b = 0; b < 8; b++) if (c & (1 << b)) r |= 1 << (7 - b);
    k[i] = r;
  }
  return k;
}

const SHIFTED = '~!@#$%^&*()_+{}|:"<>?';
function key(sym, down) {
  const m = Buffer.alloc(8); m[0] = 4; m[1] = down ? 1 : 0; m.writeUInt32BE(sym, 4); sock.write(m);
}
async function press(sym, shift) {
  if (shift) key(0xffe1, true);
  key(sym, true); key(sym, false);
  if (shift) key(0xffe1, false);
  await sleep(12);
}
async function type(s) {
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('{ctrl-c}', i)) { key(0xffe3, true); await press(0x63); key(0xffe3, false); i += 7; continue; }
    const ch = s[i];
    if (ch === '\n') { await press(0xff0d); continue; }
    const c = ch.charCodeAt(0);
    await press(c, (ch >= 'A' && ch <= 'Z') || SHIFTED.includes(ch));
  }
}

function png(w, h, rgba) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = y * (w * 3 + 1) + 1 + x * 3;
    raw[d] = rgba[s + 2]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s];
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  await read(12);
  sock.write('RFB 003.008\n');
  const n = (await read(1))[0];
  if (!n) { const l = (await read(4)).readUInt32BE(); console.error('refused:', (await read(l)).toString()); process.exit(1); }
  const types = [...(await read(n))];
  if (types.includes(1)) sock.write(Buffer.from([1]));
  else if (types.includes(2)) {
    sock.write(Buffer.from([2]));
    const ch = await read(16);
    const c = crypto.createCipheriv('des-ecb', desKey(PASS), null); c.setAutoPadding(false);
    sock.write(Buffer.concat([c.update(ch), c.final()]));
  } else { console.error('security types', types); process.exit(1); }
  const res = (await read(4)).readUInt32BE();
  if (res) { console.error('auth failed'); process.exit(1); }
  sock.write(Buffer.from([1]));
  const si = await read(24);
  const W = si.readUInt16BE(0), H = si.readUInt16BE(2);
  await read(si.readUInt32BE(20));
  const pf = Buffer.alloc(20); pf[0] = 0;
  pf.set([32, 24, 0, 1], 4); pf.writeUInt16BE(255, 8); pf.writeUInt16BE(255, 10); pf.writeUInt16BE(255, 12); pf.set([16, 8, 0], 14);
  sock.write(pf);
  const enc = Buffer.alloc(8); enc[0] = 2; enc.writeUInt16BE(1, 2); enc.writeInt32BE(0, 4); sock.write(enc);

  await type(text);
  await sleep(wait);

  const fb = Buffer.alloc(W * H * 4);
  const req = Buffer.alloc(10); req[0] = 3; req[1] = 0; req.writeUInt16BE(W, 6); req.writeUInt16BE(H, 8);
  sock.write(req);
  for (;;) {
    const t = (await read(1))[0];
    if (t === 0) {
      const h = await read(3); const rects = h.readUInt16BE(1);
      let fw = W, fh = H;
      for (let r = 0; r < rects; r++) {
        const rh = await read(12);
        const x = rh.readUInt16BE(0), y = rh.readUInt16BE(2), w = rh.readUInt16BE(4), hh = rh.readUInt16BE(6), e = rh.readInt32BE(8);
        if (e === -223) { fw = w; fh = hh; continue; }
        const px = await read(w * hh * 4);
        for (let j = 0; j < hh; j++) px.copy(fb, ((y + j) * W + x) * 4, j * w * 4, (j + 1) * w * 4);
      }
      fs.writeFileSync(out, png(fw, fh, fb));
      console.log(`saved ${out} ${fw}x${fh}`);
      process.exit(0);
    } else if (t === 2) { /* bell */ }
    else if (t === 3) { const h = await read(7); await read(h.readUInt32BE(3)); }
    else if (t === 1) { const h = await read(5); await read(h.readUInt16BE(3) * 6); }
    else { console.error('unknown msg', t); process.exit(1); }
  }
})();
