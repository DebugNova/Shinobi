// Minimal PNG codec for the tools (no dependencies): decodes 8-bit greyscale/RGB/RGBA/palette PNGs (not interlaced)
// to RGBA, encodes RGBA as an 8-bit RGB or RGBA PNG. Used by rig.mjs to build a texture atlas.
import zlib from 'zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** bytes -> { width, height, data: Uint8Array RGBA } */
export function decodePng(bytes) {
  const buf = Buffer.from(bytes);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') [w, h, depth, ctype, interlace] = [d.readUInt32BE(0), d.readUInt32BE(4), d[8], d[9], d[12]];
    else if (type === 'PLTE') plte = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? row[i - ch] : 0, b = up ? up[i] : 0, c = up && i >= ch ? up[i - ch] : 0;
      let p;
      if (f === 0) p = 0;
      else if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = (src[i] + p) & 255;
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch, o = i * 4;
    if (ctype === 0) data.set([px[s], px[s], px[s], 255], o);
    else if (ctype === 4) data.set([px[s], px[s], px[s], px[s + 1]], o);
    else if (ctype === 2) data.set([px[s], px[s + 1], px[s + 2], 255], o);
    else if (ctype === 6) data.set([px[s], px[s + 1], px[s + 2], px[s + 3]], o);
    else data.set([plte[px[s] * 3], plte[px[s] * 3 + 1], plte[px[s] * 3 + 2], trns && px[s] < trns.length ? trns[px[s]] : 255], o);
  }
  return { width: w, height: h, data };
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b) => {
  let c = -1;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, d) => {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'ascii'), d]);
  len.writeUInt32BE(d.length);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** { width, height, data: RGBA } -> PNG bytes (RGB when every pixel is opaque). */
export function encodePng({ width: w, height: h, data }) {
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) opaque = false;
  const ch = opaque ? 3 : 4, stride = w * ch, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    // filter 1 (sub) on every row: compresses flat regions well, deterministic
    raw[y * (stride + 1)] = 1;
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
      const i = y * (stride + 1) + 1 + x * ch + c, v = data[(y * w + x) * 4 + c], left = x ? data[(y * w + x - 1) * 4 + c] : 0;
      raw[i] = (v - left) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
