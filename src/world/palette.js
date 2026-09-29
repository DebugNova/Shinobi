// Flat colours as vertex colours: pieces of many colours share one toon material (`vertexColors`), so a whole set
// of props, signs, pipes and roof tints costs one draw call instead of one per colour. Colours are given as sRGB hex
// and stored linear (vertex colours multiply in linear space, gotcha 22).
import * as THREE from 'three';

const _c = new THREE.Color();

/** Linear [r, g, b] of an sRGB hex colour (a number or '#rrggbb'), times k. */
export function lin(hex, k = 1) {
  _c.set(hex);
  return [_c.r * k, _c.g * k, _c.b * k];
}

/** Paints every vertex of g with one colour (k: brightness) and returns g. */
export function tint(g, hex, k = 1) {
  const [r, gr, b] = lin(hex, k);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) {
    c[i] = r;
    c[i + 1] = gr;
    c[i + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Paints g from a function of its (local) vertex position: f(x, y, z) -> [r, g, b] linear. */
export function paintBy(g, f) {
  const p = g.attributes.position, n = p.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(f(p.getX(i), p.getY(i), p.getZ(i)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
