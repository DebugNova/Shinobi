// The sky and the light: a bright anime sky dome (deep-to-pale blue gradient, sun glow, painted cumulus bands),
// the sun (the one shadowed directional light) and a hemisphere fill. Aerial perspective: fog toward the horizon
// colour. Lights are created once here and never added or removed at runtime (that recompiles every shader).
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.4).normalize(); // toward the sun
export const SKY = {
  zenith: new THREE.Color('#2f7fe0'),
  horizon: new THREE.Color('#bfe3ff'),
  fog: new THREE.Color('#cfe6f7'),
};

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    scene.background = SKY.horizon.clone();
    scene.fog = new THREE.Fog(SKY.fog, 65, 400); // aerial perspective: the backdrop town and hills fade into the haze
    // sun: shadows over the whole arena from one fixed frustum (cached for static geometry later)
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(160);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const S = sun.shadow;
    S.mapSize.set(4096, 4096);
    S.camera.left = -92;
    S.camera.right = 92;
    S.camera.top = 92;
    S.camera.bottom = -92;
    S.camera.near = 20;
    S.camera.far = 330;
    S.bias = -0.0004;
    S.normalBias = 0.035;
    scene.add(sun, sun.target);
    this.sun = sun;
    // fill: sky blue from above, warm grass bounce from below
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x7a8f52, 1.15);
    scene.add(this.hemi);

    // the dome
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: SKY.zenith },
        uHorizon: { value: SKY.horizon },
        uSun: { value: SUN_DIR },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // at the far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith, uHorizon, uSun;
        uniform float uTime;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          // sun glow
          float s = max(dot(d, uSun), 0.0);
          col += vec3(1.0, 0.92, 0.75) * (pow(s, 12.0) * 0.35 + pow(s, 300.0) * 1.6);
          // painted cumulus: noise on the sky plane, cut into toon bands (lit tops, soft blue-grey undersides)
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
            float n = fbm(uv * 0.9) * 0.75 + fbm(uv * 3.1 + 7.0) * 0.25;
            float cov = smoothstep(0.52, 0.56, n) * smoothstep(0.0, 0.18, d.y);
            float lit = smoothstep(0.6, 0.64, n + (d.x * uSun.x + d.z * uSun.z) * 0.05);
            vec3 cloud = mix(vec3(0.78, 0.84, 0.95), vec3(1.0), lit);
            col = mix(col, cloud, cov * (1.0 - smoothstep(0.55, 0.95, h) * 0.6));
          }
          // below the horizon: the fog colour (distant land meets it)
          col = mix(col, uHorizon * 0.98, smoothstep(0.02, -0.08, d.y));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);
    this.mat = mat;
  }

  update(dt, camera) {
    this.mat.uniforms.uTime.value += dt;
    this.dome.position.copy(camera.position);
  }
}
