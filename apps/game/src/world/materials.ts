/**
 * Shared materials and texture helpers for the world.
 *
 * Owns: locally served PBR texture sets (public/textures, Poly Haven CC0: KTX2/Basis sets per
 * quality tier plus the original 1K JPG sets), a small cache of flat-colour materials,
 * world-scaled UVs, and the static-geometry batcher.
 * Must not: build scene content itself or know about gameplay.
 *
 * Texture loading: `pbr()` returns its material synchronously; for a KTX2 set the maps are
 * attached when `initTextures(renderer)` (called by world.ts after `renderer.init()`, because
 * KTX2Loader must detect the GPU's compressed formats) has loaded them, so until then the
 * material renders as its flat tint. Tiers (quality.ts):
 *   low    1K everything; brick_wall_001 and wood_floor_worn use their original 1K JPGs at once
 *          (grey_plaster and denim_fabric are JPG-only on every tier).
 *   medium 2K albedo + 1K normal + 1K packed AO/roughness (ORM).
 *   high   starts as medium (fast first frame), then after the first frames swaps in 2K normal
 *          + 2K ORM everywhere and 4K albedo on the hero sets (street asphalt, shop brick, shop
 *          floor wood).
 * Anisotropy 16 / 8 / 4 (clamped to the GPU's maximum).
 */
import * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { qualityTier, type QualityTier } from "./quality";

const BASE = import.meta.env.BASE_URL;
const ANISOTROPY: Record<QualityTier, number> = { high: 16, medium: 8, low: 4 };

/** KTX2 sets in public/textures (scripts/fetch-textures.mjs). `repeat` maps the 2 m UV tile of
 * physicalUVs() onto the scan's real size; `hero` sets have a 4K albedo for the high tier;
 * `legacyJpg` sets also exist as the original 1K JPGs, used on the low tier. */
const KTX2_SETS: Record<string, { repeat: number; hero?: boolean; legacyJpg?: boolean }> = {
  asphalt_04: { repeat: 1, hero: true }, // city.ts lays the road at 4 m per UV already
  cracked_concrete: { repeat: 1 },
  plastered_wall_03: { repeat: 0.5 },
  rusty_corrugated_iron: { repeat: 1 },
  rounded_square_tiled_wall: { repeat: 1 },
  weathered_planks: { repeat: 1 },
  rusty_metal_shutter: { repeat: 1.05 },
  dark_brick_wall: { repeat: 1.9 },
  brick_wall_001: { repeat: 1, hero: true, legacyJpg: true },
  wood_floor_worn: { repeat: 1, hero: true, legacyJpg: true },
};

// ---- legacy 1K JPG textures (also used directly by street-props via texture()) ----
const jpgLoader = new THREE.TextureLoader();
const maps = new Map<string, THREE.Texture>();
let anisotropy = 8;
export function texture(name: string, color = false) {
  if (!maps.has(name)) {
    const map = jpgLoader.load(`${BASE}textures/${name}.jpg`);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = anisotropy;
    if (color) map.colorSpace = THREE.SRGBColorSpace;
    maps.set(name, map);
  }
  return maps.get(name)!;
}
function attachJpg(material: THREE.MeshStandardMaterial, asset: string) {
  material.map = texture(`${asset}_diff`, true);
  material.normalMap = texture(`${asset}_nor_gl`);
  material.roughnessMap = texture(`${asset}_rough`);
  material.needsUpdate = true;
}

// ---- KTX2 sets ----
type MapKind = "diff" | "nor_gl" | "orm";
type Res = "1k" | "2k" | "4k";
const registry = new Map<string, THREE.MeshStandardMaterial[]>(); // set id -> materials using it
const ktx2Cache = new Map<string, Promise<THREE.Texture>>();
const live = new Set<THREE.Texture>(); // every texture currently attached (memory estimate)
let ktx2: KTX2Loader | null = null;
let tier: QualityTier = qualityTier(); // pre-renderer guess; "low" is exact (URL / webdriver)

function loadKtx2(set: string, kind: MapKind, res: Res): Promise<THREE.Texture> {
  const url = `${BASE}textures/${set}_${kind}_${res}.ktx2`;
  let p = ktx2Cache.get(url);
  if (!p) {
    p = ktx2!.loadAsync(url).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.setScalar(KTX2_SETS[set].repeat);
      t.anisotropy = anisotropy;
      t.colorSpace = kind === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.name = `${set}_${kind}_${res}`;
      t.needsUpdate = true;
      return t;
    });
    ktx2Cache.set(url, p);
  }
  return p;
}

/** Load one set at the given resolutions and attach it to every material using it (disposing what it replaces). */
async function attachSet(set: string, res: Record<MapKind, Res>) {
  const [diff, nor, orm] = await Promise.all([loadKtx2(set, "diff", res.diff), loadKtx2(set, "nor_gl", res.nor_gl), loadKtx2(set, "orm", res.orm)]);
  const old = new Set<THREE.Texture>();
  for (const m of registry.get(set) ?? []) {
    for (const t of [m.map, m.normalMap, m.roughnessMap, m.aoMap]) if (t && !maps.has(t.name)) old.add(t);
    const first = !m.map;
    m.map = diff;
    m.normalMap = nor;
    m.roughnessMap = orm; // G channel
    m.aoMap = orm; // R channel (uv channel 0)
    if (first) m.needsUpdate = true;
  }
  for (const t of [diff, nor, orm]) live.add(t);
  for (const t of old)
    if (![diff, nor, orm].includes(t)) {
      t.dispose();
      live.delete(t);
      ktx2Cache.delete(`${BASE}textures/${t.name}.ktx2`);
    }
}

export function pbr(asset: string, color: string, roughness = 0.8, metalness = 0) {
  const material = new THREE.MeshStandardMaterial({
    color,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughness,
    metalness,
  });
  material.name = asset;
  material.userData.textured = true; // box()/physicalUVs: maps may be attached later
  const set = KTX2_SETS[asset];
  if (!set || (tier === "low" && set.legacyJpg)) attachJpg(material, asset);
  else {
    register(asset, material);
    if (ktx2) void attachSet(asset, baseRes(asset)).catch((e) => console.warn(`[textures] ${asset}:`, e));
  }
  return material;
}

/** Track a material (and, recursively, every clone of it: city.ts clones surfaces) so late-loading maps reach it. */
function register(asset: string, material: THREE.MeshStandardMaterial) {
  if (!registry.has(asset)) registry.set(asset, []);
  registry.get(asset)!.push(material);
  material.clone = function (this: THREE.MeshStandardMaterial) {
    const copy = THREE.MeshStandardMaterial.prototype.clone.call(this) as THREE.MeshStandardMaterial;
    register(asset, copy);
    return copy;
  } as typeof material.clone;
}

function baseRes(_set: string): Record<MapKind, Res> {
  return tier === "low" ? { diff: "1k", nor_gl: "1k", orm: "1k" } : { diff: "2k", nor_gl: "1k", orm: "1k" };
}

/**
 * Start loading the KTX2 texture sets. Call once after `renderer.init()` (KTX2Loader needs the
 * renderer to pick a GPU format). Resolves when the first-frame maps of every set are attached
 * (about 10 MB on medium/high); on "high" the 2K normal/ORM and 4K hero albedo swaps then load in
 * the background. Never rejects: a set that fails to load stays a flat tint (or its 1K JPG).
 */
export async function initTextures(renderer: Parameters<KTX2Loader["detectSupport"]>[0]): Promise<void> {
  if (ktx2) return;
  tier = qualityTier();
  const max = (renderer as { getMaxAnisotropy?: () => number }).getMaxAnisotropy?.() ?? 16;
  anisotropy = Math.min(ANISOTROPY[tier], max || 1);
  for (const t of maps.values()) t.anisotropy = anisotropy;
  ktx2 = new KTX2Loader().setTranscoderPath(`${BASE}basis/`).detectSupport(renderer);
  const fallback = (set: string) => (e: unknown) => {
    console.warn(`[textures] ${set} failed, ${KTX2_SETS[set].legacyJpg ? "using its 1K JPG" : "left untextured"}:`, e);
    if (KTX2_SETS[set].legacyJpg) for (const m of registry.get(set) ?? []) attachJpg(m, set);
  };
  await Promise.all([...registry.keys()].map((set) => attachSet(set, baseRes(set)).catch(fallback(set))));
  if (tier !== "high") return;
  void (async () => {
    // Let the first frames render before pulling the big files.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 1500))));
    for (const set of registry.keys()) {
      const hero = KTX2_SETS[set].hero;
      await attachSet(set, { diff: hero ? "4k" : "2k", nor_gl: "2k", orm: "2k" }).catch((e) => console.warn(`[textures] ${set} upgrade:`, e));
    }
  })();
}

/** Estimated GPU bytes of the textures this module has attached (compressed: transcoded mip
 * bytes, about 1 B/px for BC7/ASTC; JPG: RGBA8 with mips). */
export function textureMemoryEstimate(): { tier: QualityTier; bytes: number; count: number } {
  let bytes = 0,
    count = 0;
  const all = new Set<THREE.Texture>([...live, ...[...maps.values()].filter((t) => t.image)]);
  for (const t of all) {
    const mips = (t as THREE.CompressedTexture).mipmaps as { data?: ArrayBufferView }[] | undefined;
    const img = t.image as { width?: number; height?: number } | undefined;
    if ((t as THREE.CompressedTexture).isCompressedTexture && mips?.length) bytes += mips.reduce((a, l) => a + (l.data?.byteLength ?? 0), 0);
    else if (img?.width && img.height) bytes += img.width * img.height * 4 * 1.33;
    else continue;
    count++;
  }
  return { tier, bytes, count };
}

export const surfaces = {
  wood: pbr("wood_floor_worn", "#c9b29a", 0.83),
  floor: pbr("wood_floor_worn", "#a0907c", 0.85),
  brick: pbr("brick_wall_001", "#c4ab95", 0.95),
  darkBrick: pbr("brick_wall_001", "#8a6f61", 0.95),
  plaster: pbr("grey_plaster", "#b8bbb5", 0.93),
  paint: pbr("grey_plaster", "#3f5a50", 0.79),
  pavement: pbr("cracked_concrete", "#9a9b9c", 0.95),
  asphalt: pbr("asphalt_04", "#74787c", 0.85),
  fabric: pbr("denim_fabric", "#5f5546", 0.95),
  metal: new THREE.MeshStandardMaterial({ color: "#3b4242", metalness: 0.7, roughness: 0.4 }),
  // Realism pass (Nozomi street): 2K/4K Poly Haven CC0 scans (see docs/ASSETS.md).
  wetAsphalt: pbr("asphalt_04", "#4e5257", 0.4), // damp street: darker, glossier
  concrete: pbr("cracked_concrete", "#a3a3a2", 0.95), // cracked sidewalk concrete
  plasterStained: pbr("plastered_wall_03", "#c9c1b5", 0.95), // water-stained render
  corrugated: pbr("rusty_corrugated_iron", "#b8ada2", 1, 0.25), // rusty corrugated metal
  tiles: pbr("rounded_square_tiled_wall", "#e6e0d4", 0.9), // small Japanese facade tiles
  woodWorn: pbr("weathered_planks", "#b0a090", 0.95),
  shutter: pbr("rusty_metal_shutter", "#b9b9b4", 0.95, 0.35), // roll-up shutter, rust-stained
  brickDirty: pbr("dark_brick_wall", "#b4aaa0", 0.95), // sooty dark brick
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
  if ((material as THREE.MeshStandardMaterial).map || material.userData.textured) physicalUVs(geometry, 0.5, new THREE.Vector3(x, y, z));
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
