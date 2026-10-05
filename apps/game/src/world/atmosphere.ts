/**
 * Atmosphere: Nozomi at dusk on the afternoon of Book 3.0 (world bible §7.7).
 *
 * Owns: the gradient sky dome (a TSL node material: orange horizon → violet → indigo zenith,
 * a low sun disc + glow in the WEST straight down the street, thin dark cloud bands), the
 * image-based light (the dusk HDRI from environment-map.ts; a PMREM of this sky if it fails),
 * fog, the key light (the scene's ONLY shadow caster, a fixed tight frustum over the
 * playable street), the hemisphere light, and the three street point lights this module is
 * budgeted: the casino roof fire (noise flicker), the diner's neon wash and one warm
 * festival fill. Fire/ember/smoke/ash particles live in particles.ts (GPU compute).
 * Must not: know about gameplay, the UI or other modules' lights (the brown-out dims those
 * in world.ts); it only exposes `setDim` for its own lights and the sky.
 *
 * Draw calls: sky 1. Real lights: 1 directional (shadow), 1 hemisphere, 3 point.
 * Point lights use physical units (candela, decay 2).
 */
import * as THREE from "three/webgpu";
import { Fn, dot, float, max, mix, mx_noise_float, normalize, positionLocal, pow, smoothstep, uniform, vec3 } from "three/tsl";
import { DINER_DOOR, ROOF_FIRE } from "./layout";
import type { QualityTier } from "./quality";
import { loadDuskEnvironment } from "./environment-map";

// TSL node handles: chained expression typings are too deep to spell out.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Sky palette (bible §7.7). */
const HORIZON = new THREE.Color("#ff7a2f");
const VIOLET = new THREE.Color("#5b3a8c");
const ZENITH = new THREE.Color("#141634");
const FOG = "#3a2c3f";
const FOG_DENSITY = 0.0135;

/** Sun azimuth: due west, a hair south so the disc sits off the road's vanishing point. */
const SUN_AZIMUTH_Z = 0.05;
/** Visible disc elevation (deg) and key-light elevation (deg; a little higher keeps shadows usable). */
const SUN_DISC_ELEV = 5;
const SUN_LIGHT_ELEV = 12;

const SKY_RADIUS = 450;
/** Sky brightness under ACES (keeps the horizon a saturated orange instead of a washed-out peach). */
const SKY_BRIGHT = 0.5;

/**
 * The sun's shadow frustum: fixed over the playable street (x -40..34, z -14..19.5) incl.
 * the 18 m casino; centred here, sized in the light's view (lateral = z, vertical = height
 * + ground x · sin elevation).
 */
const SHADOW_CENTER = new THREE.Vector3(-3, 0, 2.75);
const SHADOW_BOX = { left: -18.5, right: 18.5, top: 25, bottom: -7.5, near: 100, far: 240 };
const SHADOW_DISTANCE = 160;
const SHADOW_MAP: Record<QualityTier, number> = { high: 4096, medium: 2048, low: 1024 };

/** Diner neon wash: in front of its door at ~3 m (local: DINER_DOOR is the facade line). */
const DINER_WASH = { x: DINER_DOOR.x, y: 3.0, z: DINER_DOOR.z - 2.2 };
/** Warm festival fill, mid-street under the bulbs. */
const FESTIVAL_FILL = { x: -4, y: 5.5, z: 6.5 };

const rgb = (c: THREE.Color) => vec3(c.r, c.g, c.b);

/** `azimuthZ` 0 = exactly down the street's axis (the key light: no side row shades the road). */
function sunDir(elevDeg: number, azimuthZ = SUN_AZIMUTH_Z) {
  const e = THREE.MathUtils.degToRad(elevDeg);
  return new THREE.Vector3(-Math.cos(e), Math.sin(e), azimuthZ).normalize();
}

/** The dusk sky as a node material (BackSide sphere, no fog, no depth write). */
function skyMaterial(sun: THREE.Vector3, sunPower: number, bright: number) {
  const uSunDir = uniform(sun.clone());
  const uSun = uniform(sunPower);
  const uBright = uniform(bright);
  const color = Fn(() => {
    const d: N = normalize(positionLocal);
    const h: N = d.y;
    const sunDot: N = dot(d, uSunDir);
    const toSun: N = max(sunDot, 0);
    // Gradient by elevation; the orange band is taller toward the sun.
    const band: N = mix(float(0.16), float(0.34), pow(toSun, 3));
    const col: N = mix(rgb(HORIZON), rgb(VIOLET), smoothstep(0, band, h)).toVar();
    col.assign(mix(col, rgb(ZENITH), smoothstep(band.mul(0.8), 0.75, h)));
    // Away from the sun the horizon cools to a dusky rose.
    const cool: N = float(1).sub(smoothstep(-0.2, 0.6, sunDot)).mul(float(1).sub(smoothstep(0, 0.4, h))).mul(0.7);
    col.assign(mix(col, col.mul(vec3(0.62, 0.5, 0.75)), cool));
    // Sun glow and disc.
    col.addAssign(vec3(1.0, 0.38, 0.08).mul(pow(toSun, 10).mul(0.45)));
    col.addAssign(vec3(1.0, 0.55, 0.22).mul(pow(toSun, 300).mul(1.2)));
    const disc: N = smoothstep(0.99965, 0.99985, sunDot);
    col.assign(mix(col, vec3(1.0, 0.78, 0.5).mul(uSun), disc));
    // Thin dark cloud bands (stretched noise on a sky plane), lit orange near the sun.
    const q: N = d.xz.div(max(h, 0).add(0.06));
    const n: N = mx_noise_float(vec3(q.x.mul(0.55).add(3.1), q.y.mul(3.2), 0))
      .mul(0.65)
      .add(mx_noise_float(vec3(q.x.mul(1.4), q.y.mul(7.0), 1.7)).mul(0.35))
      .mul(0.5)
      .add(0.5);
    const c: N = smoothstep(0.56, 0.74, n)
      .mul(smoothstep(0.015, 0.06, h))
      .mul(float(1).sub(smoothstep(0.16, 0.34, h)));
    const cloud: N = mix(vec3(0.07, 0.045, 0.08), vec3(0.75, 0.3, 0.12), pow(toSun, 6).mul(0.6));
    col.assign(mix(col, cloud, c.mul(0.85)));
    // Below the horizon: the dark ground haze (hidden by buildings almost everywhere).
    col.assign(mix(col, rgb(new THREE.Color(FOG)), float(1).sub(smoothstep(-0.06, 0, h))));
    return col.mul(uBright);
  });
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  m.colorNode = color();
  m.name = "dusk-sky";
  return { material: m, uBright };
}

export interface AtmosphereOptions {
  tier: QualityTier;
}

export class Atmosphere {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fireLight: THREE.PointLight;
  readonly dinerLight: THREE.PointLight;
  readonly festivalLight: THREE.PointLight;
  /** Toward the sun from the scene. */
  readonly sunDirection = sunDir(SUN_LIGHT_ELEV, 0);
  /** Base exposure for ACES at dusk (world.ts scales it for the brown-out). */
  readonly exposure = 1.35;

  private sky: THREE.Mesh;
  private skyBright: N;
  private dim = 1;
  private envIntensity = 0.38;
  private readonly base = { sun: 4.2, hemi: 1.7, fire: 680, diner: 10, festival: 70 };

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGPURenderer,
    opts: AtmosphereOptions,
  ) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.exposure;
    scene.background = new THREE.Color(FOG);
    scene.fog = new THREE.FogExp2(FOG, FOG_DENSITY);

    // Sky dome (follows the camera).
    const sky = skyMaterial(sunDir(SUN_DISC_ELEV), 14, SKY_BRIGHT);
    this.skyBright = sky.uBright;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), sky.material);
    this.sky.name = "sky";
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // Key light: the low sun, the scene's only shadow caster, fixed frustum over the street.
    this.sun = new THREE.DirectionalLight("#ffb070", this.base.sun);
    this.sun.castShadow = true;
    const map = SHADOW_MAP[opts.tier];
    this.sun.shadow.mapSize.set(map, map);
    Object.assign(this.sun.shadow.camera, SHADOW_BOX);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = opts.tier === "low" ? 0.06 : 0.035;
    this.sun.shadow.radius = 3;
    this.sun.target.position.copy(SHADOW_CENTER);
    this.sun.position.copy(SHADOW_CENTER).addScaledVector(this.sunDirection, SHADOW_DISTANCE);
    this.sun.shadow.camera.updateProjectionMatrix();
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight("#6d5aa8", "#2a1d1a", this.base.hemi);
    scene.add(this.hemi);

    // Fire on the casino roof corner; the diner's neon wash; a warm festival fill.
    this.fireLight = new THREE.PointLight("#ff6a1c", this.base.fire, 70, 2);
    this.fireLight.position.set(ROOF_FIRE.x - 1.2, ROOF_FIRE.y + 1.4, ROOF_FIRE.z);
    this.dinerLight = new THREE.PointLight("#ff4626", this.base.diner, 14, 2);
    this.dinerLight.position.set(DINER_WASH.x, DINER_WASH.y, DINER_WASH.z);
    this.festivalLight = new THREE.PointLight("#ffc98a", this.base.festival, 30, 2);
    this.festivalLight.position.set(FESTIVAL_FILL.x, FESTIVAL_FILL.y, FESTIVAL_FILL.z);
    for (const l of [this.fireLight, this.dinerLight, this.festivalLight]) {
      l.castShadow = false;
      scene.add(l);
    }
  }

  /**
   * Image-based light. Call after `renderer.init()`. The dusk HDRI (environment-map.ts; the
   * renderer PMREMs an equirect environment itself); if it fails to load, a PMREM of this sky.
   */
  async initEnvironment(tier: QualityTier) {
    try {
      this.scene.environment = await loadDuskEnvironment(this.renderer, tier);
      this.envIntensity = 0.6;
    } catch (e) {
      console.warn("dusk HDRI unavailable, using the sky as environment", e);
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial(sunDir(SUN_DISC_ELEV), 4, 1).material));
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = (await pmrem.fromSceneAsync(envScene, 0.02)).texture;
      this.envIntensity = 0.38;
    }
    this.scene.environmentIntensity = this.envIntensity * (0.3 + 0.7 * this.dim);
  }

  /** Shadow map size and filtering for the resolved tier (call before the first frame). */
  setShadowTier(tier: QualityTier) {
    const size = SHADOW_MAP[tier];
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.normalBias = tier === "low" ? 0.06 : 0.035;
  }

  /** Every point light this module added (light budget / brown-out bookkeeping). */
  get pointLights() {
    return [this.fireLight, this.dinerLight, this.festivalLight];
  }

  /**
   * Brown-out factor for the finale: 1 = normal, ~0.12 = power cut. Dims the electric
   * lights (diner, festival) and the hemisphere fully, the sun half way, the fire barely;
   * the sky is boosted against the exposure drop so the sunset still silhouettes the city.
   */
  setDim(f: number, exposureFactor = 1) {
    this.dim = f;
    this.skyBright.value = (SKY_BRIGHT * (0.75 + 0.25 * f)) / Math.max(exposureFactor, 0.1);
  }

  update(_dt: number, elapsed: number, camera: THREE.Camera) {
    const f = this.dim;
    this.sky.position.copy(camera.position);
    this.sun.intensity = this.base.sun * (0.4 + 0.6 * f);
    this.hemi.intensity = this.base.hemi * f;
    this.scene.environmentIntensity = this.envIntensity * (0.3 + 0.7 * f);
    this.dinerLight.intensity = this.base.diner * f * (0.92 + 0.08 * noise1(elapsed * 9));
    this.festivalLight.intensity = this.base.festival * f;
    const flick = 0.55 * noise1(elapsed * 5.3) + 0.3 * noise1(elapsed * 13.7 + 7) + 0.15 * noise1(elapsed * 31 + 3);
    this.fireLight.intensity = this.base.fire * (0.55 + 0.75 * flick) * (0.7 + 0.3 * f);
    this.fireLight.position.x = ROOF_FIRE.x - 1.2 + (noise1(elapsed * 2.1) - 0.5) * 0.8;
    this.fireLight.position.y = ROOF_FIRE.y + 1.4 + (noise1(elapsed * 3.3 + 9) - 0.5) * 0.6;
  }
}

/** Smooth 1D value noise in [0, 1] (light flicker). */
function noise1(t: number) {
  const i = Math.floor(t),
    f = t - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
