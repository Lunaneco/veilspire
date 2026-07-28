import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OPTIMIZED } from './perfFlags.js';

// Static batching. Hand-built architecture is authored as hundreds of small
// meshes because that is how you reason about a building — but every one of
// them costs a draw call, twice over once the sun casts shadows. Nothing in a
// wall moves, so once construction is done we bake each mesh's world transform
// into its geometry and merge everything that shares a material into a single
// mesh.
//
// Anything that animates must be excluded: mark it (or any ancestor) with
// `userData.dynamic = true` and the walker leaves that whole subtree alone.
// InstancedMesh, Sprite, Points and lights are skipped — they are already
// batched or not geometry at all.

const ATTRS = ['position', 'normal', 'uv'];

// mergeGeometries is strict: every geometry in a batch needs the same
// attributes, in the same layout, and all indexed or all not.
function normalize(geo, needColor) {
  const g = new THREE.BufferGeometry();
  const count = geo.attributes.position.count;
  for (const name of ATTRS) {
    let attr = geo.attributes[name];
    if (!attr) {
      if (name === 'normal') { geo.computeVertexNormals(); attr = geo.attributes.normal; }
      else attr = new THREE.BufferAttribute(new Float32Array(count * 2), 2); // flat uv
    }
    g.setAttribute(name, attr.clone());
  }
  if (needColor) {
    const c = geo.attributes.color;
    g.setAttribute('color', c ? c.clone()
      : new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  }
  if (geo.index) g.setIndex(geo.index.clone());
  else g.setIndex(Array.from({ length: count }, (_, i) => i));
  return g;
}

// Batches sharing a material still need separate meshes when their shadow
// flags differ — those flags change the shader and what the shadow pass draws.
// The cell keeps a merge local: batching a whole region into one mesh would
// make it un-cullable, so pieces far apart stay in separate meshes.
const _wp = new THREE.Vector3();
function keyFor(mesh, cellSize) {
  mesh.getWorldPosition(_wp);
  const cell = `${Math.round(_wp.x / cellSize)},${Math.round(_wp.z / cellSize)}`;
  return `${mesh.material.uuid}#${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}@${cell}`;
}

// descend:false stops the walk at the root's own meshes. Animated rigs need
// this: each joint may only merge the meshes rigidly attached to it, or the
// merge would bake a child joint's pose into its parent and freeze the limb.
export function mergeStatics(root, { minBatch = 2, cellSize = 80, descend = true } = {}) {
  if (!OPTIMIZED) return { batches: 0, meshesRemoved: 0 };
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const batches = new Map();

  const walk = (obj) => {
    if (obj !== root && obj.userData.dynamic) return;
    if (obj.isMesh && !obj.isInstancedMesh && !obj.isSkinnedMesh &&
        obj.geometry && !Array.isArray(obj.material) &&
        obj.visible && obj.children.length === 0) {
      const key = keyFor(obj, cellSize);
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(obj);
      return;
    }
    if (descend || obj === root) for (const c of [...obj.children]) walk(c);
  };
  walk(root);

  let merged = 0, removed = 0;
  for (const list of batches.values()) {
    if (list.length < minBatch) continue;
    const needColor = list.some((m) => m.geometry.attributes.color);
    const geos = list.map((m) => {
      const g = normalize(m.geometry, needColor);
      // Into the root's local space, so the merged mesh can sit on the root
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      return g;
    });
    const combined = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!combined) continue;
    const mesh = new THREE.Mesh(combined, list[0].material);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    mesh.userData.mergedFrom = list.length;
    root.add(mesh);
    for (const m of list) m.parent?.remove(m);
    merged++;
    removed += list.length;
  }
  // Groups emptied by the merge would still be walked every frame
  const prune = (obj) => {
    for (const c of [...obj.children]) prune(c);
    if (obj !== root && obj.isGroup && obj.children.length === 0 && !obj.userData.dynamic) {
      obj.parent?.remove(obj);
    }
  };
  prune(root);
  return { batches: merged, meshesRemoved: removed };
}
