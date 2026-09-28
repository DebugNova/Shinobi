// Jutsu effects (all created up front and compiled behind the loading screen; toggled, never added at runtime):
//   ChakraAura     layered blue flame shells around a charging fighter
//   RasenganFX     the swirling sphere in the palm (rings, rim glow, a wind shell)
//   RasenshurikenFX the sphere with four spinning wind blades; expands into a big sphere on impact
//   Shuriken       a spinning steel star
// HDR colours above 1 feed the bloom; everything is additive so it reads as light.
import * as THREE from 'three';

const noise = /* glsl */ `
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm3(vec3 p) { return n3(p) * 0.55 + n3(p * 2.1) * 0.3 + n3(p * 4.3) * 0.15; }`;

// ---------------------------------------------------------------- chakra aura

const auraMat = (inner) => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uColor: { value: inner ? new THREE.Color(1.6, 3.2, 5.0) : new THREE.Color(0.4, 1.2, 3.2) } },
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uAmt; varying vec3 vP; varying vec3 vN; varying vec3 vV;
    ${noise}
    void main() {
      vec3 p = position;
      float h = clamp(p.y / 2.1, 0.0, 1.0);
      // flames lick upward and outward, tapering to points at the top
      float f = fbm3(vec3(p.x * 2.0, p.y * 1.2 - uTime * 3.5, p.z * 2.0));
      p.xz *= (0.8 + f * 0.6) * (1.0 - h * 0.55) * (0.6 + uAmt * 0.4);
      p.y *= 0.85 + f * 0.45 * h;
      vP = position; vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform float uAmt; uniform vec3 uColor; varying vec3 vP; varying vec3 vN; varying vec3 vV;
    ${noise}
    void main() {
      float h = clamp(vP.y / 2.1, 0.0, 1.0);
      float f = fbm3(vec3(vP.x * 3.0, vP.y * 2.2 - uTime * 4.0, vP.z * 3.0));
      // toon flame: hard bands of the noise, fading out toward the tips and at grazing angles
      float band = step(0.42 + h * 0.3, f) * 0.6 + step(0.58 + h * 0.25, f) * 0.4;
      float rim = pow(1.0 - abs(dot(vN, vV)), 0.6);
      float a = band * rim * (1.0 - h) * uAmt;
      if (a < 0.01) discard;
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});

export class ChakraAura {
  constructor(scene) {
    const g = new THREE.CylinderGeometry(0.5, 0.62, 2.1, 20, 10, true);
    g.translate(0, 1.05, 0);
    this.group = new THREE.Group();
    this.outer = new THREE.Mesh(g, auraMat(false));
    this.inner = new THREE.Mesh(g, auraMat(true));
    this.inner.scale.setScalar(0.72);
    for (const m of [this.outer, this.inner]) {
      m.frustumCulled = false;
      m.renderOrder = 7;
      this.group.add(m);
    }
    this.group.visible = false;
    this.amt = 0;
    scene.add(this.group);
  }

  update(dt, pos, on, t) {
    this.amt += ((on ? 1 : 0) - this.amt) * Math.min(1, dt * (on ? 6 : 4));
    this.group.visible = this.amt > 0.01;
    if (!this.group.visible) return;
    this.group.position.copy(pos);
    for (const m of [this.outer, this.inner]) {
      m.material.uniforms.uTime.value = t;
      m.material.uniforms.uAmt.value = this.amt;
    }
  }
}

// ---------------------------------------------------------------- rasengan sphere

export function rasenganMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmt: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main() { vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uAmt; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 p = normalize(vP);
        // swirling rings: bands of longitude sheared by latitude, spinning fast on two axes
        float a1 = atan(p.z, p.x) + p.y * 5.0 + uTime * 18.0;
        float a2 = atan(p.y, p.x) - p.z * 4.0 - uTime * 13.0;
        float rings = smoothstep(0.55, 0.95, sin(a1 * 3.0)) + smoothstep(0.6, 0.97, sin(a2 * 2.0)) * 0.7;
        float fres = pow(1.0 - abs(dot(vN, vV)), 1.6);
        float core = pow(abs(dot(vN, vV)), 3.0);
        vec3 col = vec3(0.5, 1.6, 3.6) * (0.35 + rings * 0.9 + fres * 1.8) + vec3(3.0, 3.6, 4.0) * core * 0.9;
        gl_FragColor = vec4(col * uAmt, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export class RasenganFX {
  constructor(scene) {
    this.group = new THREE.Group();
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 3), rasenganMaterial());
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 2), rasenganMaterial());
    this.shell.material.uniforms.uAmt.value = 0.35;
    for (const m of [this.core, this.shell]) {
      m.frustumCulled = false;
      m.renderOrder = 8;
      this.group.add(m);
    }
    this.group.visible = false;
    scene.add(this.group);
    this.t = 0;
  }

  /** size 0..1 (grows during the wind-up) */
  update(dt, pos, size) {
    this.t += dt;
    this.group.visible = size > 0.01;
    if (!this.group.visible) return;
    this.group.position.copy(pos);
    this.group.scale.setScalar(size * (1 + Math.sin(this.t * 40) * 0.04));
    this.shell.rotation.set(this.t * 7, this.t * 11, 0);
    this.core.material.uniforms.uTime.value = this.t;
    this.shell.material.uniforms.uTime.value = this.t * 1.3;
  }
}

// ---------------------------------------------------------------- rasenshuriken

const bladeMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uAmt: { value: 1 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform float uAmt; varying vec2 vUv;
    void main() {
      // a curved blade of wind: bright edge, streaks along it, fading at the tip
      float x = vUv.x, y = vUv.y;
      float w = (1.0 - x) * 0.5;
      float d = abs(y - 0.5 - x * x * 0.25);
      float body = smoothstep(w, w * 0.4, d);
      float streak = 0.6 + 0.4 * sin(x * 40.0 - uTime * 60.0 + y * 20.0);
      float a = body * streak * (1.0 - x * 0.7);
      if (a < 0.02) discard;
      gl_FragColor = vec4(vec3(1.6, 2.6, 3.4) * a * uAmt, 1.0);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});

export class RasenshurikenFX {
  constructor(scene) {
    this.group = new THREE.Group();
    this.sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 3), rasenganMaterial());
    this.blades = new THREE.Group();
    const bg = new THREE.PlaneGeometry(1.5, 0.5);
    bg.translate(0.95, 0, 0);
    this.bladeMat = bladeMat();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(bg, this.bladeMat);
      b.rotation.set(-Math.PI / 2, 0, (i / 4) * Math.PI * 2);
      b.frustumCulled = false;
      this.blades.add(b);
    }
    // a thin ring of wind round the blades
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.05, 6, 48), rasenganMaterial());
    this.ring.rotation.x = Math.PI / 2;
    this.ring.material.uniforms.uAmt.value = 0.6;
    for (const m of [this.sphere, this.ring]) m.frustumCulled = false;
    this.group.add(this.sphere, this.blades, this.ring);
    this.group.renderOrder = 8;
    this.group.visible = false;
    scene.add(this.group);
    // the explosion: a big sphere
    this.boom = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), rasenganMaterial());
    this.boom.frustumCulled = false;
    this.boom.visible = false;
    scene.add(this.boom);
    this.t = 0;
    this.boomT = -1;
  }

  update(dt, pos, size) {
    this.t += dt;
    this.group.visible = size > 0.01;
    if (this.group.visible) {
      this.group.position.copy(pos);
      this.group.scale.setScalar(size);
      this.blades.rotation.y = this.t * 26;
      this.ring.rotation.z = this.t * 9;
      for (const m of [this.sphere.material, this.ring.material, this.bladeMat]) m.uniforms.uTime.value = this.t;
    }
    if (this.boomT >= 0) {
      this.boomT += dt;
      const k = this.boomT / 0.9;
      this.boom.visible = k < 1;
      if (k >= 1) this.boomT = -1;
      else {
        const r = this.boomR * (0.25 + 0.75 * (1 - Math.pow(1 - Math.min(1, k * 2.2), 3)));
        this.boom.scale.setScalar(r);
        this.boom.material.uniforms.uTime.value = this.t;
        this.boom.material.uniforms.uAmt.value = k < 0.7 ? 0.7 : 0.7 * (1 - (k - 0.7) / 0.3);
      }
    }
  }

  explode(pos, radius) {
    this.boom.position.copy(pos);
    this.boomT = 0;
    this.boomR = radius;
  }
}

// ---------------------------------------------------------------- shuriken

let starGeo = null;
export function shurikenMesh() {
  if (!starGeo) {
    const s = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? 0.045 : 0.16;
      s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.022, 0, Math.PI * 2, true);
    s.holes.push(hole);
    starGeo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 1 });
    starGeo.center();
    starGeo.rotateX(Math.PI / 2);
  }
  const m = new THREE.Mesh(starGeo, new THREE.MeshLambertMaterial({ color: 0xaab4c0, emissive: 0x223344 }));
  m.castShadow = false;
  return m;
}
