// The world's toon shading: one patch of MeshLambertMaterial (so shadows, fog and the hemisphere fill come from
// three.js) that replaces the smooth Lambert term with soft light bands, tints the shadowed side a cool colour
// instead of grey, overlays pen-stroke hatching (world-space, triplanar) in the shadow bands, optionally maps its
// texture triplanar in world space (terrain, rocks, bark), and dithers away whatever stands between the camera and
// the player so a wall or trunk never hides them. All uniforms are shared (TOON): one update drives every material.
import * as THREE from 'three';

export const TOON = {
  uSunColor: { value: new THREE.Color(1, 1, 1) }, // set from the sun light (colour * intensity)
  uShadowTint: { value: new THREE.Color(0.42, 0.46, 0.72) }, // the shadowed side: cool blue-violet, not grey
  uHatch: { value: null },
  uHatchScale: { value: 0.9 },
  uFadeA: { value: new THREE.Vector3(0, -999, 0) }, // camera
  uFadeB: { value: new THREE.Vector3(0, -999, 0) }, // the player's chest
  uFadeR: { value: 0.85 },
  uTime: { value: 0 },
};

const VERT_PARS = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNormal;
`;
const VERT_MAIN = /* glsl */ `
{
  vec4 tw = vec4(transformed, 1.0);
  vec3 tn = objectNormal;
  #ifdef USE_INSTANCING
    tw = instanceMatrix * tw;
    tn = mat3(instanceMatrix) * tn;
  #endif
  tw = modelMatrix * tw;
  vWPos = tw.xyz;
  vWNormal = normalize(mat3(modelMatrix) * tn);
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vViewPosition;
varying vec3 vWPos;
varying vec3 vWNormal;
uniform vec3 uSunColor;
uniform vec3 uShadowTint;
uniform sampler2D uHatch;
uniform float uHatchScale;
uniform float uHatchAmt;
uniform vec3 uFadeA;
uniform vec3 uFadeB;
uniform float uFadeR;
uniform float uTexScale;
#ifdef TOON_SPLAT
uniform sampler2D uSplat; uniform float uSplatScale; varying float vSplat;
#endif
float toonLit = 1.0;

struct LambertMaterial { vec3 diffuseColor; float specularStrength; };

void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  float nl = dot( geometryNormal, directLight.direction );
  // the shadow map's contribution: the light colour arrives already multiplied by it (one directional light)
  float sh = dot( directLight.color, vec3( 1.0 ) ) / max( dot( uSunColor, vec3( 1.0 ) ), 1e-4 );
  // two soft bands: full light, a half tone, the shadow
  float band = smoothstep( -0.02, 0.1, nl ) * 0.45 + smoothstep( 0.32, 0.44, nl ) * 0.55;
  float lit = band * smoothstep( 0.3, 0.7, sh );
  toonLit = lit;
  vec3 irradiance = mix( uShadowTint * 0.55, vec3( 1.0 ), lit ) * uSunColor;
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Lambert
#define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert

float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int k = i.x + i.y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  return (m[k] + 0.5) / 16.0;
}
vec4 triSample(sampler2D t, vec3 p, vec3 n, float s) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return texture2D(t, p.zy * s) * w.x + texture2D(t, p.xz * s) * w.y + texture2D(t, p.xy * s) * w.z;
}
`;

const FRAG_FADE = /* glsl */ `
#ifdef TOON_FADE
{
  // whatever stands between the camera and the player dissolves (ordered dither): nothing hides the fighter
  vec3 ab = uFadeB - uFadeA;
  float L = length(ab);
  if (L > 0.5) {
    vec3 d = ab / L;
    float t = dot(vWPos - uFadeA, d);
    if (t > 0.2 && t < L - 0.6) {
      float r = length(vWPos - (uFadeA + d * t));
      float k = 1.0 - smoothstep(uFadeR * 0.6, uFadeR, r);
      if (k * 0.85 > bayer4(gl_FragCoord.xy)) discard;
    }
  }
}
#endif
#ifdef TOON_NEAR
{
  // foliage close to the camera dissolves (no collider keeps the camera out of a leaf clump)
  float k = 1.0 - smoothstep(1.4, 3.4, length(vWPos - uFadeA));
  if (k > bayer4(gl_FragCoord.xy)) discard;
}
#endif
`;

const FRAG_MAP_TRI = /* glsl */ `
#ifdef TOON_SPLAT
  diffuseColor *= mix(triSample(map, vWPos, vWNormal, uTexScale), triSample(uSplat, vWPos, vWNormal, uSplatScale), smoothstep(0.35, 0.65, vSplat));
#elif defined(TOON_TRI)
  diffuseColor *= triSample(map, vWPos, vWNormal, uTexScale);
#else
  #include <map_fragment>
#endif
`;

const FRAG_HATCH = /* glsl */ `
{
  // pen strokes in the shadow: the main hatch in the half tone, the cross hatch in the deepest shadow
  float dark = 1.0 - toonLit;
  if (dark > 0.02 && uHatchAmt > 0.0) {
    vec4 h = triSample(uHatch, vWPos, vWNormal, uHatchScale);
    float a = smoothstep(0.1, 0.6, dark) * uHatchAmt;
    outgoingLight *= mix(1.0, h.r, a) * mix(1.0, h.g, smoothstep(0.6, 1.0, dark) * uHatchAmt * 0.8);
  }
}
`;

/**
 * A toon world material. o: { color, map, tri (world texture scale: texture repeats per metre), hatch (0..1),
 * fade (dither between camera and player, default true), near (dither away within ~3 m of the camera), vertexColors, side, transparent, alphaTest, emissive,
 * splat: a second texture blended in by the vertex attribute aSplat (terrain: grass -> dirt), splatScale,
 * vertex: { pars, main } extra vertex code (after begin_vertex: modify `transformed`), uniforms: extra uniforms,
 * key: a program cache key for the extra code }
 */
export function toon(o = {}) {
  const m = new THREE.MeshLambertMaterial({
    color: o.color ?? 0xffffff,
    map: o.map || null,
    vertexColors: !!o.vertexColors,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
    alphaTest: o.alphaTest ?? 0,
    emissive: o.emissive ?? 0x000000,
  });
  const hatchAmt = { value: o.hatch ?? 0.7 };
  const texScale = { value: o.tri ?? 0.25 };
  const fade = o.fade !== false;
  const tri = !!(o.tri && o.map);
  const splat = o.splat || null;
  const splatScale = { value: o.splatScale ?? texScale.value };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, TOON, { uHatchAmt: hatchAmt, uTexScale: texScale, uSplat: { value: splat }, uSplatScale: splatScale }, o.uniforms || {});
    if (fade) s.defines = { ...(s.defines || {}), TOON_FADE: '' };
    if (o.near) s.defines = { ...(s.defines || {}), TOON_NEAR: '' };
    if (tri) s.defines = { ...(s.defines || {}), TOON_TRI: '' };
    if (splat) s.defines = { ...(s.defines || {}), TOON_SPLAT: '' };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}\n#ifdef TOON_SPLAT\nattribute float aSplat; varying float vSplat;\n#endif\n${o.vertex?.pars || ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n#ifdef TOON_SPLAT\nvSplat = aSplat;\n#endif\n${o.vertex?.main || ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_MAIN}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <lights_lambert_pars_fragment>', FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAP_TRI)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_FADE}`)
      .replace('#include <opaque_fragment>', `${FRAG_HATCH}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `toon${fade ? 'F' : ''}${o.near ? 'N' : ''}${tri ? 'T' : ''}${splat ? 'S' : ''}${o.key || ''}`;
  m.userData.toon = { hatchAmt, texScale };
  return m;
}

/** Keeps the shared uniforms current (once per frame). */
export function updateToon(sun, camera, focus, dt) {
  TOON.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
  TOON.uFadeA.value.copy(camera.position);
  if (focus) TOON.uFadeB.value.copy(focus);
  TOON.uTime.value += dt;
}
