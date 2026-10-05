/**
 * Shared Tamashi materials and colour helpers.
 *
 * Owns: the ONE body material every character's skinned mesh uses (vertex colours plus a
 * per-vertex `rme` attribute = roughness, metalness, emissive amount, so cloth, chrome,
 * glossy plastic and glowing bits all share a single program and draw call), finish presets,
 * and small colour utilities (linear-space vertex colours, colour words in trait text).
 * Must not: hold per-token state (screen.ts caches the per-token screen materials).
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";

/** Surface response per vertex: roughness, metalness, emissive (× base colour). */
export interface Finish {
  r: number;
  m: number;
  e?: number;
}

export const CLOTH: Finish = { r: 0.9, m: 0 };
export const SKIN: Finish = { r: 0.72, m: 0 };
export const PLASTIC: Finish = { r: 0.45, m: 0.05 };
export const GLOSS: Finish = { r: 0.28, m: 0.08 };
export const METAL: Finish = { r: 0.32, m: 0.75 };
export const GOLD: Finish = { r: 0.3, m: 0.85 };
export const RUBBER: Finish = { r: 0.8, m: 0 };
export const glow = (e: number, r = 0.5): Finish => ({ r, m: 0, e });

let shared: THREE.MeshStandardMaterial | null = null;

/** The shared body material (vertex colours + per-vertex roughness/metalness/emissive). */
export function bodyMaterial(): THREE.MeshStandardMaterial {
  if (shared) return shared;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.name = "tamashi-body";
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 rme;\nvarying vec3 vRme;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRme = rme;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRme;")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vRme.x;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vRme.y;")
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance += diffuseColor.rgb * vRme.z;");
  };
  m.customProgramCacheKey = () => "tamashi-body-rme";
  shared = m;
  return m;
}

// ── Colours (THREE.Color is linear; hex inputs are sRGB). ──

export function col(hex: THREE.ColorRepresentation | null | undefined, fallback: THREE.ColorRepresentation = "#888888"): THREE.Color {
  try {
    return new THREE.Color(hex ?? fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

/** Multiply (in sRGB-ish terms: f < 1 darkens, > 1 lightens, clamped). */
export function shade(c: THREE.Color, f: number): THREE.Color {
  const s = c.clone().convertLinearToSRGB();
  if (f <= 1) s.multiplyScalar(f);
  else s.lerp(new THREE.Color(1, 1, 1), Math.min(1, f - 1));
  return s.convertSRGBToLinear();
}

export function mix(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().convertLinearToSRGB().lerp(b.clone().convertLinearToSRGB(), t).convertSRGBToLinear();
}

/** Perceived lightness 0..1 (sRGB luma). */
export function lum(c: THREE.Color): number {
  const s = c.clone().convertLinearToSRGB();
  return 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
}

/** Distance between two colours in sRGB, 0..~1.7. */
export function colorDistance(a: THREE.Color, b: THREE.Color): number {
  const x = a.clone().convertLinearToSRGB();
  const y = b.clone().convertLinearToSRGB();
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
}

const WORDS: [string, string][] = [
  ["crimson", "#b81a26"],
  ["scarlet", "#d0201c"],
  ["red", "#c8262a"],
  ["orange", "#ec7a22"],
  ["amber", "#e8a020"],
  ["yellow", "#f2c628"],
  ["gold", "#e0b030"],
  ["brass", "#c8a040"],
  ["lime", "#9ad040"],
  ["green", "#3aa04a"],
  ["jade", "#30a070"],
  ["teal", "#1f9aa0"],
  ["cyan", "#30c8d8"],
  ["turquoise", "#40d0c0"],
  ["navy", "#1e2a50"],
  ["blue", "#3a6ad0"],
  ["indigo", "#3a2a80"],
  ["violet", "#7a3ad0"],
  ["purple", "#7a3ac0"],
  ["magenta", "#d030b0"],
  ["pink", "#f08ac0"],
  ["white", "#f2f2f2"],
  ["cream", "#f0e6cc"],
  ["black", "#1a1a1c"],
  ["silver", "#c8c8d0"],
  ["grey", "#8a8a8e"],
  ["gray", "#8a8a8e"],
  ["brown", "#7a4a2a"],
  ["tan", "#c8a070"],
  ["beige", "#d8c4a0"],
];

/** First colour word in `text` (by position), as hex; null if none. */
export function colorWord(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  let best: string | null = null;
  let at = Infinity;
  for (const [w, hex] of WORDS) {
    const re = new RegExp(`\\b${w}`, "i");
    const m = re.exec(t);
    if (m && m.index < at) {
      at = m.index;
      best = hex;
    }
  }
  return best;
}

/** Deterministic small PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
