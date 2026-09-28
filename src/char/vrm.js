// VRM characters: one download, one parse per fighter instance (three-vrm objects can't be cloned: humanoid, spring
// bones and expressions all point at their own nodes), with every instance's textures swapped for the first
// instance's, so six fighters cost the texture memory of one. Every instance also draws with the first instance's
// materials: the renderer sorts by material, so the fighters' draws of one material follow each other and its ~40
// MToon uniforms upload once per frame instead of once per fighter (Fighter keeps its own variants for LOD and the
// hit flash). MToon materials get the game's outline and rim look.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { Rig } from './rig.js';

const TEX_PROPS = ['map', 'normalMap', 'emissiveMap', 'shadeMultiplyTexture', 'shadingShiftTexture', 'matcapTexture', 'rimMultiplyTexture', 'outlineWidthMultiplyTexture', 'uvAnimationMaskTexture', 'alphaMap'];

export class CharacterModel {
  /** url: the .vrm; fetchBuffer(url) -> ArrayBuffer (the boot screen's fetch, for progress). */
  constructor(url, fetchBuffer) {
    this.url = url;
    this.fetchBuffer = fetchBuffer;
    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
    this.pool = [];
    this.textures = new Map(); // `${material}|${prop}` -> the shared texture
    this.shared = null; // the first instance's mesh materials, in traversal order
    this.sharedMats = new Set();
  }

  async load() {
    this.buffer = await this.fetchBuffer(this.url);
    this.proto = await this.parse(true);
    this.rig = new Rig(this.proto);
    this.pool.push(this.proto);
    return this;
  }

  async parse(first = false) {
    const gltf = await this.loader.parseAsync(this.buffer, '');
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error(`${this.url} is not a VRM`);
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons?.(gltf.scene);
    if (vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false; // skinned bounds are the bind pose: culling would drop a fighter mid-kick
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) this.prepMaterial(m, first);
      }
    });
    // the face's small parts (eyes, brows, mouth, lashes: the meshes with morph targets but the biggest) sit inside
    // the head's silhouette: no shadow draws for them
    const faces = [];
    vrm.scene.traverse((o) => o.isMesh && o.geometry.morphAttributes.position?.length && faces.push(o));
    const tris = (o) => (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count);
    faces.sort((a, b) => tris(b) - tris(a));
    for (const o of faces.slice(1)) o.castShadow = false;
    // share the first instance's materials
    const meshes = [];
    vrm.scene.traverse((o) => o.isMesh && meshes.push(o));
    if (!this.shared) {
      this.shared = meshes.map((o) => o.material);
      for (const o of meshes) for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.sharedMats.add(m);
    } else if (this.shared.length === meshes.length) {
      meshes.forEach((o, i) => {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!this.sharedMats.has(m)) m.dispose();
        o.material = this.shared[i];
      });
      vrm.materials = [];
    }
    for (const o of meshes) o.userData.baseMaterial = o.material;
    return vrm;
  }

  /** Shares textures between instances and applies the outline/rim look to MToon materials. */
  prepMaterial(m, first) {
    for (const p of TEX_PROPS) {
      const tex = m[p];
      if (!tex || !tex.isTexture) continue;
      const key = `${m.name}|${p}|${m.isMToonMaterial ? 1 : 0}`;
      if (first || !this.textures.has(key)) this.textures.set(key, tex);
      else if (this.textures.get(key) !== tex) {
        const shared = this.textures.get(key);
        tex.dispose();
        tex.image?.close?.();
        m[p] = shared;
      }
    }
    if (m.isMToonMaterial) {
      // outlines of constant screen width (VRoid exports world-space widths: thin far away, fat up close)
      if (m.isOutline || m.outlineWidthMode !== 'none') {
        m.outlineWidthMode = 'screenCoordinates';
        m.outlineWidthFactor = 0.0032;
        m.outlineColorFactor?.set(0.05, 0.03, 0.035);
        m.outlineLightingMixFactor = 0.2;
      }
    }
  }

  /** A fighter instance (parsed on demand; call warm(n) at load so joins never parse mid-fight). */
  async take() {
    const free = this.pool.find((v) => !v.taken);
    const vrm = free || (await this.parse());
    if (!free) this.pool.push(vrm);
    vrm.taken = true;
    return vrm;
  }

  /** Per frame, once: MToon copies its properties into its uniforms here (and runs UV animation). */
  updateMaterials(dt) {
    for (const m of this.sharedMats) m.update?.(dt);
  }

  give(vrm) {
    vrm.taken = false;
    vrm.scene.removeFromParent();
  }

  /** Parses instances up front, behind the loading screen. */
  async warm(n) {
    while (this.pool.length < n) this.pool.push(await this.parse());
  }
}

/** Every MToon material of a VRM (including the outline passes). */
export function vrmMaterials(vrm) {
  const out = new Set();
  vrm.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) out.add(m);
  });
  return [...out];
}

export { THREE };
