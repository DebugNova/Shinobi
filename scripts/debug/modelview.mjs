// Model viewer for rigging work: renders a .glb/.vrm (no game, no server) from several angles into one PNG.
// usage: node scripts/debug/modelview.mjs <model> <out.png> [views=front,left,back,right] [opts]
//   opts (comma list): bones (draw the humanoid skeleton), weights=<bone> (paint one bone's skin weights red),
//   pose=<name> (a test pose on a VRM: run, kick, crouch, arms, punch), size=<px per view>, zoom=<k>,
//   focus=<y> fx=<x> fz=<z> (camera target), xray (with bones: see-through model). Views: front left back right q q2 top bottom.
// Serves the repo root on a random port so the page can import three / three-vrm from node_modules.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [model, out, views = 'front,left,back,right', opts = ''] = process.argv.slice(2);
if (!model || !out) {
  console.log('usage: node scripts/debug/modelview.mjs <model> <out.png> [views] [opts]');
  process.exit(1);
}
const O = Object.fromEntries(opts.split(',').filter(Boolean).map((s) => s.split('=')).map(([k, v]) => [k, v ?? true]));
const size = +(O.size || 420);
const modelPath = path.resolve(model);

const PAGE = `<!doctype html><html><head><style>html,body{margin:0;background:#8a8f99}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/","@pixiv/three-vrm":"/node_modules/@pixiv/three-vrm/lib/three-vrm.module.js"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
const O = ${JSON.stringify(O)}, VIEWS = ${JSON.stringify(views.split(','))}, S = ${size};
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setSize(S * VIEWS.length, S);
r.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x666655, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1, 2, 3); scene.add(sun);
const grid = new THREE.GridHelper(4, 40, 0x333333, 0x555555); scene.add(grid);
const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));
const gltf = await loader.loadAsync('/__model');
const vrm = gltf.userData.vrm;
const root = vrm ? vrm.scene : gltf.scene;
scene.add(root);
root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
const box = new THREE.Box3().setFromObject(root);
const info = { box: [box.min.toArray(), box.max.toArray()], vrm: !!vrm };
if (vrm && O.pose) {
  const H = vrm.humanoid, e = (b, x, y, z) => { const n = H.getNormalizedBoneNode(b); if (n) n.rotation.set(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180); };
  const P = {
    run: () => { e('leftUpperLeg', -60, 0, 0); e('leftLowerLeg', 70, 0, 0); e('rightUpperLeg', 35, 0, 0); e('rightLowerLeg', 20, 0, 0); e('leftUpperArm', 0, 0, -70); e('rightUpperArm', 0, 0, 70); e('leftLowerArm', 0, -80, 0); e('rightLowerArm', 0, 80, 0); e('spine', 15, 0, 0); },
    kick: () => { e('rightUpperLeg', -95, 0, 0); e('leftUpperLeg', 10, 0, 0); e('leftLowerLeg', 20, 0, 0); e('spine', -10, 20, 0); e('leftUpperArm', 0, 0, -40); e('rightUpperArm', 0, 0, 40); },
    crouch: () => { e('leftUpperLeg', -100, 0, 0); e('rightUpperLeg', -100, 0, 0); e('leftLowerLeg', 120, 0, 0); e('rightLowerLeg', 120, 0, 0); e('spine', 30, 0, 0); H.getNormalizedBoneNode('hips').position.y -= 0.45; },
    arms: () => { e('leftUpperArm', 0, 0, -75); e('rightUpperArm', 0, 0, 75); e('leftLowerArm', 0, -100, 0); e('rightLowerArm', 0, 100, 0); e('head', 0, 40, 0); e('chest', 0, 30, 0); },
    punch: () => { e('leftUpperArm', 0, 80, 0); e('rightUpperArm', 0, 0, 70); e('rightLowerArm', 0, 120, 0); e('chest', 0, -25, 0); },
  };
  P[O.pose]?.();
  vrm.update(0);
}
// one bone's weights painted red (vertex colours), everything else grey
if (vrm && O.weights) {
  const node = vrm.humanoid.getRawBoneNode(O.weights);
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const bi = o.skeleton.bones.indexOf(node), g = o.geometry, n = g.attributes.position.count;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k); col[i * 3] = 0.4 + 0.6 * w; col[i * 3 + 1] = 0.4 * (1 - w); col[i * 3 + 2] = 0.4 * (1 - w); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    o.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  });
}
const helpers = [];
if (O.bones && vrm) {
  const pts = [];
  const H = vrm.humanoid;
  root.updateMatrixWorld(true);
  for (const [name, b] of Object.entries(H.humanBones)) {
    const n = b.node, p = n.parent;
    if (!p || !Object.values(H.humanBones).some((x) => x.node === p)) continue;
    pts.push(n.getWorldPosition(new THREE.Vector3()), p.getWorldPosition(new THREE.Vector3()));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x00ff66, depthTest: false, transparent: true }));
  lines.renderOrder = 9;
  scene.add(lines);
  const dots = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffff00, size: 6, sizeAttenuation: false, depthTest: false, transparent: true }));
  dots.renderOrder = 10;
  scene.add(dots);
  if (O.xray) root.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) { m.transparent = true; m.opacity = 0.45; m.depthWrite = false; } });
}
const c = box.getCenter(new THREE.Vector3()), h = box.max.y - box.min.y;
const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
const ANG = { front: 0, left: Math.PI / 2, back: Math.PI, right: -Math.PI / 2, q: Math.PI / 4, q2: -Math.PI / 4, top: 0, bottom: 0 };
r.setScissorTest(true);
VIEWS.forEach((v, i) => {
  const zoom = O.zoom ? +O.zoom : 1;
  const a = ANG[v] ?? 0, d = (h * 2.2) / zoom;
  const ty = O.focus ? +O.focus : c.y, tx = O.fx ? +O.fx : c.x, tz = O.fz ? +O.fz : c.z;
  if (v === 'top' || v === 'bottom') {
    cam.up.set(0, 0, -1);
    cam.position.set(tx, ty + (v === 'top' ? d : -d), tz);
  } else {
    cam.up.set(0, 1, 0);
    cam.position.set(tx + Math.sin(a) * d, ty + h * 0.05 / zoom, tz + Math.cos(a) * d);
  }
  cam.lookAt(tx, ty, tz);
  r.setViewport(i * S, 0, S, S);
  r.setScissor(i * S, 0, S, S);
  r.render(scene, cam);
});
window.__info = info;
window.__done = true;
</script></body></html>`;

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') return res.end(PAGE);
  if (u === '/__model') return fs.createReadStream(modelPath).pipe(res);
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) return (res.statusCode = 404), res.end();
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const W = size * views.split(',').length;
await page.setViewport({ width: W, height: size });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction('window.__done === true', { timeout: 30000 });
console.log(JSON.stringify(await page.evaluate(() => window.__info)));
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: size } });
await browser.close();
server.close();
