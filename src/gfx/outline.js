// Ink outlines for the world: a screen-space edge pass on the depth buffer. Silhouettes = a neighbour much farther
// away (the line goes on the nearer object's edge only, so it stays one pixel wide); creases = the Laplacian of
// inverse depth (planes are linear in 1/z on screen, so flat surfaces give nothing and folds give a line). Lines are
// lighter and thinner than the characters' (MToon's own outlines) and fade out with distance, so far detail never
// turns into black noise.
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

const frag = /* glsl */ `
uniform vec3 uInk;
uniform float uFar;
uniform float uThick;
uniform float uAmount;
float vz(const in vec2 uv) { return max(1e-3, -getViewZ(readDepth(uv))); }
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float d0 = max(1e-3, -getViewZ(depth));
  if (d0 > uFar * 1.2) { outputColor = inputColor; return; }
  vec2 t = texelSize * uThick;
  float dl = vz(uv - vec2(t.x, 0.0)), dr = vz(uv + vec2(t.x, 0.0));
  float du = vz(uv + vec2(0.0, t.y)), dd = vz(uv - vec2(0.0, t.y));
  // silhouette: this pixel is nearer than a neighbour by a fraction of its distance
  float far = max(max(dl, dr), max(du, dd));
  float sil = smoothstep(0.04, 0.09, (far - d0) / d0);
  // crease: second derivative of 1/z, scaled back by distance
  float i0 = 1.0 / d0;
  float lap = abs(1.0 / dl + 1.0 / dr + 1.0 / du + 1.0 / dd - 4.0 * i0) * d0;
  float crease = smoothstep(0.012, 0.035, lap);
  float edge = max(sil, crease * 0.65);
  edge *= 1.0 - smoothstep(uFar * 0.4, uFar, d0);
  outputColor = vec4(mix(inputColor.rgb, uInk * inputColor.rgb, edge * uAmount), inputColor.a);
}`;

export class OutlineEffect extends Effect {
  constructor() {
    super('InkOutline', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uInk', new THREE.Uniform(new THREE.Color(0.12, 0.08, 0.1))],
        ['uFar', new THREE.Uniform(95)],
        ['uThick', new THREE.Uniform(1)],
        ['uAmount', new THREE.Uniform(0.85)],
      ]),
    });
  }
}
