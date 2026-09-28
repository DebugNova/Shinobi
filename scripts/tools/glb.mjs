// Minimal GLB reader/writer for the tools (no three.js): the JSON chunk, the binary chunk, typed views of
// accessors, and a builder that packs new buffer views/accessors into a fresh binary chunk.
import fs from 'fs';

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { json, bin };
}

/** A typed copy of an accessor's data (tightly packed, normalized integers left as integers). */
export function accessor(g, i) {
  const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
  const T = COMP[a.componentType], n = SIZE[a.type], stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const out = new T(a.count * n);
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset);
  for (let k = 0; k < a.count; k++) {
    for (let c = 0; c < n; c++) {
      const o = base + k * stride + c * T.BYTES_PER_ELEMENT;
      out[k * n + c] = T === Float32Array ? dv.getFloat32(o, true) : T === Uint32Array ? dv.getUint32(o, true) : T === Uint16Array ? dv.getUint16(o, true) : T === Uint8Array ? dv.getUint8(o) : T === Int16Array ? dv.getInt16(o, true) : dv.getInt8(o);
    }
  }
  return out;
}

/** Raw bytes of a buffer view (images). */
export function viewBytes(g, i) {
  const bv = g.json.bufferViews[i];
  return Buffer.from(g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
}

/** Packs buffer views and accessors for a new glTF. */
export class BinBuilder {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.bufferViews = [];
    this.accessors = [];
  }

  view(bytes, target) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.parts.push(Buffer.alloc(pad));
      this.length += pad;
    }
    const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.parts.push(b);
    const v = { buffer: 0, byteOffset: this.length, byteLength: b.length };
    if (target) v.target = target;
    this.length += b.length;
    this.bufferViews.push(v);
    return this.bufferViews.length - 1;
  }

  /** arr: a typed array; type: 'VEC3'...; minmax: add min/max (required for POSITION). */
  accessor(arr, type, { target, minmax = false, normalized = false } = {}) {
    const ct = Object.entries(COMP).find(([, T]) => arr instanceof T)[0];
    const n = SIZE[type];
    const a = { bufferView: this.view(arr, target), componentType: +ct, count: arr.length / n, type };
    if (normalized) a.normalized = true;
    if (minmax) {
      a.min = Array(n).fill(Infinity);
      a.max = Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        a.min[i % n] = Math.min(a.min[i % n], arr[i]);
        a.max[i % n] = Math.max(a.max[i % n], arr[i]);
      }
    }
    this.accessors.push(a);
    return this.accessors.length - 1;
  }

  buffer() {
    return Buffer.concat(this.parts);
  }
}

export function writeGlb(file, json, bin) {
  const js = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = Buffer.alloc((4 - (js.length % 4)) % 4, 0x20);
  const bpad = Buffer.alloc((4 - (bin.length % 4)) % 4, 0);
  const jlen = js.length + jpad.length, blen = bin.length + bpad.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jlen + 8 + blen, 8);
  const ch = (len, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  fs.writeFileSync(file, Buffer.concat([head, ch(jlen, 0x4e4f534a), js, jpad, ch(blen, 0x004e4942), bin, bpad]));
}
