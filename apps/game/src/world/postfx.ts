/**
 * Post-processing for the dusk street, in TSL (`PostProcessing` from three/webgpu), so it runs
 * on WebGPU and on three's WebGL2 fallback alike.
 *
 * Chain (each stage toggleable): scene pass → GTAO (high) → bloom on the HDR colour (neon,
 * CRTs, bulbs, embers, the sun disc) → ACES tone mapping + sRGB (renderOutput, honouring the
 * renderer's toneMappingExposure, which the finale's brown-out scales) → grade (teal shadows,
 * orange highlights) + vignette → SMAA (high) / FXAA (medium) → film grain.
 * The "low" tier builds nothing here: world.ts renders straight to the canvas with the
 * renderer's own tone mapping.
 * Skipped on purpose (scope guardrails): SSR (artefacts / cost on the wet street), height haze
 * and light shafts (FogExp2 + the sky already carry the dusk).
 *
 * Owns: the PostProcessing instance and its uniforms.
 * Must not: touch scene content or lights.
 */
import * as THREE from "three/webgpu";
import { Fn, float, luminance, mix, renderOutput, pass, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import type { QualityTier } from "./quality";

// TSL node handles: chained expression typings are too deep to spell out.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Bloom at dusk: neon, CRTs, bulbs, embers and the sun disc bloom; the sky itself doesn't. */
export const BLOOM = { strength: 0.55, radius: 0.45, threshold: 0.9 };

export interface PostStages {
  ao: boolean;
  bloom: boolean;
  grade: boolean;
  aa: "smaa" | "fxaa" | "none";
  grain: boolean;
}

export function stagesFor(tier: QualityTier): PostStages | null {
  if (tier === "low") return null;
  if (tier === "medium") return { ao: false, bloom: true, grade: true, aa: "fxaa", grain: true };
  return { ao: true, bloom: true, grade: true, aa: "smaa", grain: true };
}

export class PostFx {
  readonly post: THREE.PostProcessing;
  stages: PostStages;
  private readonly uTime = uniform(0);
  private bloomScale = 1;
  private bloomNode: N = null;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    stages: PostStages,
  ) {
    this.post = new THREE.PostProcessing(renderer);
    this.post.outputColorTransform = false; // renderOutput below does it, before grade/AA/grain
    this.stages = { ...stages };
    this.build();
  }

  /** Turn stages on/off (adaptive quality drops AO first, then bloom). */
  set(stages: Partial<PostStages>) {
    const next = { ...this.stages, ...stages };
    if (JSON.stringify(next) === JSON.stringify(this.stages)) return;
    this.stages = next;
    this.build();
  }

  /** Bloom strength multiplier (1 = normal; the brown-out takes it to ~0.12). */
  setBloomScale(f: number) {
    this.bloomScale = f;
    if (this.bloomNode) this.bloomNode.strength.value = BLOOM.strength * f;
  }

  render(time: number) {
    this.uTime.value = time % 1000;
    this.post.render();
  }

  private build() {
    const s = this.stages;
    const scenePass: N = pass(this.scene, this.camera);
    const color: N = scenePass.getTextureNode("output");
    let hdr: N = color;
    if (s.ao) {
      // Normals reconstructed from depth (no MRT): cheaper and robust on both backends.
      const aoPass: N = ao(scenePass.getTextureNode("depth"), null as N, this.camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 0.6;
      const occl: N = mix(float(1), aoPass.getTextureNode().r, 0.75);
      hdr = vec4(color.rgb.mul(occl), color.a);
    }
    if (s.bloom) {
      this.bloomNode = bloom(hdr, BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      this.bloomNode.strength.value = BLOOM.strength * this.bloomScale;
      hdr = hdr.add(this.bloomNode);
    } else this.bloomNode = null;
    let ldr: N = renderOutput(hdr);
    if (s.grade) {
      const toned: N = ldr;
      ldr = Fn(() => {
        const c: N = toned.rgb;
        const l: N = luminance(c);
        const graded: N = mix(c.mul(vec3(0.93, 1.0, 1.06)), c.mul(vec3(1.05, 1.0, 0.92)), smoothstep(0.15, 0.7, l));
        const d: N = screenUV.sub(0.5).mul(1.2).length();
        const vignette: N = float(1).sub(d.pow(1.8).mul(0.26));
        return vec4(graded.mul(vignette), 1);
      })();
    }
    let out: N = ldr;
    if (s.aa === "smaa") out = smaa(ldr);
    else if (s.aa === "fxaa") out = fxaa(ldr);
    if (s.grain) {
      const grain: N = screenUV.add(this.uTime.fract()).dot(vec2(12.9898, 78.233)).sin().mul(43758.5453).fract().sub(0.5).mul(0.022);
      out = vec4(out.rgb.add(grain), 1);
    }
    this.post.outputNode = out;
    this.post.needsUpdate = true;
  }
}
