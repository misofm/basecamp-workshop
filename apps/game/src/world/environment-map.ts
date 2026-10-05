/**
 * Dusk image-based lighting: one CC0 Poly Haven HDRI ("Joburg Central Sunset", a low-contrast
 * city-rooftop sunset) used as `scene.environment` only (the sky dome stays the gradient).
 *
 * Owns: loading the equirectangular .hdr for the quality tier and turning it so its sun sits
 * in the WEST, straight down the street, matching atmosphere.ts's sun (-x, a hair +z).
 * Must not: set scene.background, add lights, or run a PMREM pass itself: both renderer
 * backends PMREM an equirectangular `scene.environment` automatically (WebGPU's node PMREM,
 * WebGL's cube-UV cache), so the raw texture is what the caller assigns.
 */
import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

const HDRI = "sunset_jhbcentral";
/** Where the sun is in the published image (brightest texel; measured with three's HDRLoader). */
const SOURCE_SUN_U = 0.6104;
/** Where three's equirect lookup (u = atan2(z, x) / 2π + 0.5) wants it: dir (-1, ·, 0.05). */
const TARGET_SUN_U = Math.atan2(0.05, -1) / (2 * Math.PI) + 0.5;

type Tier = "high" | "medium" | "default" | "low";

/**
 * Load the dusk HDRI (2K on "high", 1K otherwise) as an equirectangular texture ready for
 * `scene.environment` on WebGPU and WebGL2. The renderer argument is unused (kept so callers
 * do not change if a backend ever needs an explicit PMREM pass again).
 */
export async function loadDuskEnvironment(_renderer: unknown, tier: Tier): Promise<THREE.Texture> {
  const res = tier === "high" ? "2k" : "1k";
  const loader = new HDRLoader().setDataType(THREE.HalfFloatType);
  const texture = await loader.loadAsync(`${import.meta.env.BASE_URL}textures/hdri/${HDRI}_${res}.hdr`);
  rollColumns(texture as THREE.DataTexture, TARGET_SUN_U - SOURCE_SUN_U);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.wrapS = THREE.RepeatWrapping; // the turned sun sits near the u=0/1 seam
  texture.name = `hdri:${HDRI}_${res}`;
  texture.needsUpdate = true;
  return texture;
}

/** Turn the panorama about the vertical axis by shifting every row by `du` (fraction of width). */
function rollColumns(texture: THREE.DataTexture, du: number) {
  const { width, height, data } = texture.image as { width: number; height: number; data: Uint16Array | Float32Array };
  const shift = (((Math.round(du * width) % width) + width) % width) * 4;
  if (!shift) return;
  const row = width * 4;
  const tmp = new (data.constructor as { new (n: number): Uint16Array | Float32Array })(row);
  for (let y = 0; y < height; y++) {
    const start = y * row;
    tmp.set(data.subarray(start + row - shift, start + row), 0);
    tmp.set(data.subarray(start, start + row - shift), shift);
    data.set(tmp, start);
  }
}
