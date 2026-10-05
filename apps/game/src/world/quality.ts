/**
 * Quality tier and render backend: one place every module asks.
 *
 * Tiers:
 *   "high"   default when the WebGPU backend is active: full post (bloom, GTAO, grade, grain,
 *            SMAA), 4096 sun shadows, hero textures, most particles.
 *   "medium" the WebGL2 fallback, or `?quality=medium`: bloom, FXAA, grade and grain, 2048
 *            shadows, no GTAO.
 *   "low"    `?quality=low`, or any automated browser (navigator.webdriver) without an
 *            explicit `?quality=`: tone mapping only (no post passes), 1024 shadows, fewer
 *            particles, low Tamashi detail.
 * Backend: WebGPU when the browser has it, else three's WebGL2 fallback; `?backend=webgl`
 * forces the fallback, `?backend=webgpu` asks for WebGPU (still falls back if unavailable).
 *
 * Owns: reading `?quality=` / `?backend=` / `?adapt=` and the resolved backend.
 * Must not: touch the scene, the renderer or the DOM beyond `dataset` flags (world.ts sets them).
 */
export type QualityTier = "high" | "medium" | "low";
export type Backend = "webgpu" | "webgl";

const params = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);

let resolvedBackend: Backend | null = null;

/** The backend the renderer is (or will be) using. Before init this is a guess from `navigator.gpu`. */
export function activeBackend(): Backend {
  if (resolvedBackend) return resolvedBackend;
  return requestedBackend();
}

/** What we will ask the renderer for (`?backend=` or feature detection). */
export function requestedBackend(): Backend {
  const b = params().get("backend");
  if (b === "webgl") return "webgl";
  return typeof navigator !== "undefined" && "gpu" in navigator && !!(navigator as Navigator & { gpu?: unknown }).gpu ? "webgpu" : "webgl";
}

/** world.ts calls this once the renderer has initialised (the backend it actually got). */
export function setActiveBackend(b: Backend) {
  resolvedBackend = b;
}

/** The explicit `?quality=` tier, if any. */
function explicitTier(): QualityTier | null {
  const q = params().get("quality");
  return q === "high" || q === "medium" || q === "low" ? q : null;
}

/**
 * The quality tier: `?quality=` wins; an automated browser starts low (fast e2e); otherwise
 * high on WebGPU, medium on the WebGL2 fallback.
 */
export function qualityTier(): QualityTier {
  const q = explicitTier();
  if (q) return q;
  if (typeof navigator !== "undefined" && navigator.webdriver === true) return "low";
  return activeBackend() === "webgpu" ? "high" : "medium";
}

/** `?adapt=0` pins quality (fixed render scale, passes as started) for screenshots and perf runs. */
export function adaptiveQuality(): boolean {
  return params().get("adapt") !== "0";
}
