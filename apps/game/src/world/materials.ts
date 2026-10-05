/**
 * Shared materials and texture helpers for the world.
 *
 * Owns: locally served PBR texture sets (public/textures, Poly Haven CC0), a small
 * cache of flat-colour materials, world-scaled UVs, and the static-geometry batcher.
 * Must not: build scene content itself or know about gameplay.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const loader = new THREE.TextureLoader();
const maps = new Map<string, THREE.Texture>();
export function texture(name: string, color = false) {
  if (!maps.has(name)) {
    const map = loader.load(`/textures/${name}.jpg`);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    if (color) map.colorSpace = THREE.SRGBColorSpace;
    maps.set(name, map);
  }
  return maps.get(name)!;
}
export function pbr(asset: string, color: string, roughness = 0.8) {
  return new THREE.MeshStandardMaterial({
    color,
    map: texture(`${asset}_diff`, true),
    normalMap: texture(`${asset}_nor_gl`),
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: texture(`${asset}_rough`),
    roughness,
  });
}
export const surfaces = {
  wood: pbr("wood_floor_worn", "#c9b29a", 0.83),
  floor: pbr("wood_floor_worn", "#a0907c", 0.85),
  brick: pbr("brick_wall_001", "#c4ab95", 0.95),
  darkBrick: pbr("brick_wall_001", "#8a6f61", 0.95),
  plaster: pbr("grey_plaster", "#b8bbb5", 0.93),
  paint: pbr("grey_plaster", "#3f5a50", 0.79),
  pavement: pbr("grey_plaster", "#8a9094", 0.86),
  asphalt: pbr("asphalt_02", "#6e767c", 0.5),
  fabric: pbr("denim_fabric", "#5f5546", 0.95),
  metal: new THREE.MeshStandardMaterial({ color: "#3b4242", metalness: 0.7, roughness: 0.4 }),
};

const flatCache = new Map<string, THREE.MeshStandardMaterial>();
/** Cached plain material by colour (+ optional emissive), so batching can merge by material. */
export function flat(color: THREE.ColorRepresentation, roughness = 0.8, emissive?: string, emissiveIntensity = 1) {
  const key = `${String(color)}/${roughness}/${emissive ?? ""}/${emissiveIntensity}`;
  let m = flatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness });
    if (emissive) {
      m.emissive.set(emissive);
      m.emissiveIntensity = emissiveIntensity;
    }
    flatCache.set(key, m);
  }
  return m;
}

/** World-sized UVs: a two-metre material tile, rather than stretching it over a wall. */
export function physicalUVs(geometry: THREE.BufferGeometry, scale = 0.5, offset = new THREE.Vector3()) {
  const uv = geometry.getAttribute("uv"),
    pos = geometry.getAttribute("position"),
    normal = geometry.getAttribute("normal");
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i) + offset.x,
      y = pos.getY(i) + offset.y,
      z = pos.getZ(i) + offset.z;
    if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, x * scale, z * scale);
    else if (Math.abs(normal.getX(i)) > 0.5) uv.setXY(i, z * scale, y * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
}

/** Convenience: an axis-aligned box mesh with world-scaled UVs when the material is textured. */
export function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  shadows: { cast?: boolean; receive?: boolean } = { cast: true, receive: true },
) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if ((material as THREE.MeshStandardMaterial).map) physicalUVs(geometry, 0.5, new THREE.Vector3(x, y, z));
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadows.cast ?? false;
  m.receiveShadow = shadows.receive ?? false;
  parent.add(m);
  return m;
}

/**
 * Merge every static mesh under `root` by material into one mesh per material.
 * Anything with `userData.keepDynamic` (or a dynamic ancestor) is left alone.
 * This is the main draw-call saver: hundreds of boxes become a few dozen meshes.
 */
export function batchStaticGeometry(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const batches = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; meshes: THREE.Mesh[] }>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || Array.isArray(object.material)) return;
    if ((object as THREE.Object3D as THREE.SkinnedMesh).isSkinnedMesh) return;
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node.userData.keepDynamic) return;
    const key = `${object.material.uuid}/${object.castShadow}/${object.receiveShadow}`;
    if (!batches.has(key))
      batches.set(key, { material: object.material, cast: object.castShadow, receive: object.receiveShadow, meshes: [] });
    batches.get(key)!.meshes.push(object);
  });
  for (const batch of batches.values()) {
    if (batch.meshes.length < 2) continue;
    const geometries = batch.meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, m.matrixWorld));
    });
    const merged = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, batch.material);
    mesh.castShadow = batch.cast;
    mesh.receiveShadow = batch.receive;
    mesh.name = `batch:${(batch.material as THREE.MeshStandardMaterial).name || batch.material.type}`;
    batch.meshes.forEach((m) => {
      m.removeFromParent();
      m.geometry.dispose();
    });
    root.add(mesh);
  }
}
