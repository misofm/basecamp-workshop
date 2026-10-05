/**
 * GPU particles for the dusk street: the casino roof fire (flame blobs + embers, some carried
 * down the street, and a smoke column), wind-blown ash around the camera, steam from the
 * vents, dust motes in the low sun, and (`?rain=1`) a light drizzle.
 *
 * Every system is ONE instanced sprite (one draw call) whose state lives in two vec4 storage
 * buffers (`instancedArray`) advanced by a TSL compute kernel each frame; all kernels go out in
 * a single `renderer.compute([...])`. On the WebGL2 fallback three runs the same kernels with
 * transform feedback (each invocation reads/writes only its own element, which is what that
 * path supports), so there is no separate CPU path.
 *
 * Particle lifetimes are deterministic: particle i has a fixed life L_i and phase, so its
 * generation `gen = floor((time + phase) / L)` and `age` follow from the clock. The kernel
 * stores `gen` in pos.w and respawns when it changes; the sprite material recomputes age and
 * the per-generation seed in the vertex stage, so no age/seed buffers are needed. A respawn
 * places the particle where it would be at its current age, so every system starts "warm".
 *
 * Wind blows WEST (-x) and gusts; one wind for everything. No per-frame allocations.
 */
import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  abs,
  clamp,
  cos,
  float,
  floor,
  hash,
  instanceIndex,
  instancedArray,
  length,
  max,
  min,
  mix,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { ROOF_FIRE, SHOP_INTERIOR } from "./layout";
import { STEAM_VENTS } from "./street-props";

type Tier = "high" | "medium" | "low";
// TSL node handles: the typings of chained TSL expressions are too deep to spell out.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export interface GpuParticlesOptions {
  tier: Tier;
  rain: boolean;
}

/** Playable street box (ash / dust / embers live here). */
const STREET_BOX = { minX: -40, maxX: 34, minZ: -2, maxZ: 16 };
/** Shop roof height (m): no rain below it inside SHOP_INTERIOR. Local: not in layout.ts. */
const SHOP_ROOF_Y = 6.5;
/** Mean wind (m/s), toward the west; the gust factor scales it. */
const WIND = { x: -2.2, z: 0.25 };

type Vent = { x: number; y: number; z: number; rate?: number };
const FALLBACK_VENTS: Vent[] = [
  { x: -12, y: 0.15, z: 11.6 },
  { x: 15.5, y: 0.15, z: 2.4 },
  { x: -22, y: 0.15, z: 12 },
];
const MAX_VENTS = 16;

const COUNTS: Record<Tier, { flames: number; embers: number; street: number; smoke: number; ash: number; steam: number; dust: number; rain: number }> = {
  high: { flames: 40, embers: 420, street: 90, smoke: 150, ash: 1400, steam: 240, dust: 420, rain: 2000 },
  medium: { flames: 28, embers: 220, street: 50, smoke: 90, ash: 600, steam: 130, dust: 160, rain: 1300 },
  low: { flames: 16, embers: 90, street: 20, smoke: 45, ash: 220, steam: 50, dust: 0, rain: 500 },
};

/** Smooth 1D value noise in [0, 1] (flicker, gusts). */
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

/** Soft, slightly lumpy puff (smoke, steam): one small canvas texture shared by both. */
function puffTexture() {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 18; k++) {
    const r = S * (0.12 + rnd() * 0.16);
    const a = rnd() * Math.PI * 2,
      d = rnd() * S * 0.2;
    const x = S / 2 + Math.cos(a) * d,
      y = S / 2 + Math.sin(a) * d;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.32)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }
  // Fade the square's edge so no corner ever shows.
  g.globalCompositeOperation = "destination-in";
  const edge = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.5);
  edge.addColorStop(0, "rgba(0,0,0,1)");
  edge.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = edge;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

interface SystemSpec {
  name: string;
  count: number;
  /** Life range (s) and the respawn / integrate bodies. */
  life: [number, number] | (() => [N, N]);
  /** Returns [p0 (vec3), v0 (vec3)] for this generation, `r(k)` = per-generation random in [0,1). */
  spawn: (r: (k: number) => N, age: N) => [N, N];
  /** Advances p, v (TSL vars, vec3) by dt. */
  step: (p: N, v: N, r: (k: number) => N, age01: N) => void;
  /** Material setup from the attribute nodes. */
  material: (pos: N, vel: N, r: (k: number) => N, age01: N) => THREE.SpriteNodeMaterial;
  renderOrder: number;
}

export class GpuParticles {
  private readonly uTime = uniform(0);
  private readonly uDt = uniform(0);
  private readonly uGust = uniform(1);
  private readonly uFlick = uniform(0.6);
  private readonly uDim = uniform(1);
  private readonly uCam = uniform(new THREE.Vector3());
  private readonly sprites: THREE.Sprite[] = [];
  private readonly computes: N[] = [];
  private readonly textures: THREE.Texture[] = [];
  private warmed = false;
  private readonly buffers = new Map<string, N>();
  /** Instance counts per system (diagnostics). */
  readonly counts: Record<string, number> = {};

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGPURenderer,
    opts: GpuParticlesOptions,
  ) {
    const c = COUNTS[opts.tier];
    const puff = puffTexture();
    this.textures.push(puff);
    const specs: SystemSpec[] = [this.smoke(c.smoke, puff), this.embers(c.flames, c.embers, c.street), this.ash(c.ash)];
    const vents = this.vents();
    if (c.steam > 0 && vents.length) specs.push(this.steam(c.steam, puff, vents));
    if (c.dust > 0) specs.push(this.dust(c.dust));
    if (opts.rain) specs.push(this.rain(c.rain));
    for (const s of specs) this.build(s);
  }

  /**
   * Builds the compute pipelines now (call once during loading, next to
   * `renderer.compileAsync(scene, camera)`, which covers the sprite materials).
   */
  async warm() {
    await this.renderer.computeAsync(this.computes);
    this.warmed = true;
  }

  update(dt: number, elapsed: number, camera: THREE.Camera) {
    this.uTime.value = elapsed;
    this.uDt.value = Math.min(Math.max(dt, 0), 0.1);
    this.uGust.value = 0.6 + 0.9 * noise1(elapsed * 0.35) + 0.5 * Math.max(0, noise1(elapsed * 1.3 + 4) - 0.55);
    this.uFlick.value = 0.55 * noise1(elapsed * 5.3) + 0.3 * noise1(elapsed * 13.7 + 7) + 0.15 * noise1(elapsed * 31 + 3);
    this.uCam.value.copy(camera.position);
    if (!this.warmed && !this.renderer.hasInitialized()) return;
    this.renderer.compute(this.computes);
  }

  /** Diagnostics: GPU read-back of a system's first `n` particle positions (x, y, z, gen). */
  async debugSample(name: string, n = 4): Promise<number[]> {
    const buf = this.buffers.get(name);
    if (!buf) return [];
    const ab = await this.renderer.getArrayBufferAsync(buf.value);
    return Array.from(new Float32Array(ab, 0, n * 4)).map((v) => Math.round(v * 100) / 100);
  }

  /** Brown-out for the exit beat: 1 = normal, ~0.12 = power cut (embers barely dim). */
  setDim(f: number) {
    this.uDim.value = THREE.MathUtils.clamp(f, 0, 1);
  }

  dispose() {
    for (const s of this.sprites) {
      this.scene.remove(s);
      s.geometry.dispose();
      (s.material as THREE.Material).dispose();
    }
    for (const c of this.computes) c.dispose?.();
    for (const t of this.textures) t.dispose();
    this.sprites.length = 0;
    this.computes.length = 0;
  }

  // ───────────────────────── machinery ─────────────────────────

  private build(s: SystemSpec) {
    const n = s.count;
    const init = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) init[i * 4 + 3] = -1; // gen -1: respawn on the first dispatch
    const pos = instancedArray(init, "vec4");
    const vel = instancedArray(n, "vec4");
    const life = s.life;
    const uTime = this.uTime;

    // Shared lifetime clock (same expression in the kernel and the vertex stage).
    const clock = () => {
      const [lo, hi] = typeof life === "function" ? life() : [float(life[0]), float(life[1])];
      const L = mix(lo, hi, hash(instanceIndex.add(0x51ed)));
      const tt = uTime.add(hash(instanceIndex.add(0x9e37)).mul(L));
      const gen = floor(tt.div(L));
      const age = tt.sub(gen.mul(L));
      const r = (k: number) => hash(instanceIndex.add(gen.toUint().mul(7919)).add(k * 104729 + 13));
      return { L, gen, age, r, age01: age.div(L) };
    };

    const kernel = Fn(() => {
      const P = pos.element(instanceIndex);
      const V = vel.element(instanceIndex);
      const { gen, age, r, age01 } = clock();
      const p = vec3(P.xyz).toVar();
      const v = vec3(V.xyz).toVar();
      If(P.w.notEqual(gen), () => {
        const [p0, v0] = s.spawn(r, age);
        p.assign(p0);
        v.assign(v0);
      }).Else(() => {
        s.step(p, v, r, age01);
      });
      P.assign(vec4(p, gen));
      V.assign(vec4(v, 0));
    })().compute(n);
    kernel.name = `particles-${s.name}`;
    this.computes.push(kernel);

    const { r, age01 } = clock();
    const mat = s.material(pos.toAttribute(), vel.toAttribute(), r, age01);
    mat.depthWrite = false;
    const sprite = new THREE.Sprite(mat);
    sprite.count = n;
    sprite.frustumCulled = false;
    sprite.renderOrder = s.renderOrder;
    sprite.name = `particles-${s.name}`;
    this.scene.add(sprite);
    this.sprites.push(sprite);
    this.counts[s.name] = n;
    this.buffers.set(s.name, pos);
  }

  private vents(): Vent[] {
    return (STEAM_VENTS.length ? STEAM_VENTS : FALLBACK_VENTS).slice(0, MAX_VENTS);
  }

  /** Soft round dot from the sprite's uv. */
  private static dot(power: number) {
    const d = length(uv().sub(0.5)).mul(2);
    return pow(clamp(float(1).sub(d), 0, 1), power);
  }

  // ───────────────────────── fire: flames + embers ─────────────────────────

  private embers(flames: number, embers: number, street: number): SystemSpec {
    const total = flames + embers + street;
    const { uDt: dt, uGust: gust, uTime: t, uFlick: flick, uDim: dim } = this;
    const F = ROOF_FIRE;
    const isFlame = () => instanceIndex.lessThan(flames);
    const isStreet = () => instanceIndex.greaterThanEqual(total - street);
    return {
      name: "embers",
      count: total,
      // Flames 0.5-1 s, roof embers 1.8-5 s, street embers 16-28 s.
      life: () => [select(isFlame(), float(0.5), select(isStreet(), float(16), float(1.8))), select(isFlame(), float(1), select(isStreet(), float(28), float(5)))],
      spawn: (r, age) => {
        const jx = r(1).sub(0.5).mul(3.2),
          jz = r(2).sub(0.5).mul(3.2);
        const roof = vec3(F.x - 1.5 + 0, F.y + 0.2, F.z).add(vec3(jx, r(3).mul(0.8), jz));
        const vRoof = vec3(r(4).sub(0.5).mul(0.8), r(5).mul(2.2).add(1.6), r(6).sub(0.5).mul(0.8));
        const pFlame = vec3(F.x - 1.5, F.y - 0.1, F.z).add(vec3(jx, 0, jz));
        const vFlame = vec3(r(4).mul(-0.3), r(5).mul(0.8).add(0.6), r(6).sub(0.5).mul(0.3));
        const pStreet = vec3(r(1).mul(-2).add(F.x - 4), r(3).mul(6).add(12), r(2).mul(7).add(3));
        const vStreet = vec3(r(4).mul(-1.6).sub(1.6), r(5).mul(-0.25).sub(0.25), r(6).sub(0.5).mul(0.4));
        const p0 = select(isFlame(), pFlame, select(isStreet(), pStreet, roof)).toVar();
        const v0 = select(isFlame(), vFlame, select(isStreet(), vStreet, vRoof)).toVar();
        // Warm start: drop the particle where it would be at its age.
        p0.addAssign(v0.mul(select(isFlame(), float(0), age)));
        return [p0, v0];
      },
      step: (p, v) => {
        If(isStreet(), () => {
          v.x.addAssign(sin(t.mul(2.3).add(float(instanceIndex))).mul(0.4).mul(dt));
          v.y.addAssign(sin(t.mul(1.7).add(float(instanceIndex))).mul(0.12).sub(0.02).mul(dt));
          p.addAssign(v.mul(vec3(gust.mul(0.8), 1, 1)).mul(dt));
          If(p.y.lessThan(0.25), () => {
            p.y.assign(-50); // landed: parked out of sight until it respawns
            v.assign(vec3(0));
          });
        }).ElseIf(isFlame(), () => {
          p.addAssign(v.mul(dt));
        }).Else(() => {
          // Buoyant, then the wind takes them west with a little swirl.
          v.x.addAssign(float(WIND.x).mul(gust).mul(0.9).sub(v.x).mul(dt).mul(0.8));
          v.y.subAssign(dt.mul(0.35));
          const swirl = sin(t.mul(3.1).add(float(instanceIndex).mul(1.37))).mul(1.2);
          v.z.addAssign(float(WIND.z).mul(gust).add(swirl).sub(v.z).mul(dt).mul(0.8));
          p.addAssign(v.mul(dt));
        });
      },
      material: (pos, _vel, r, age01) => {
        const m = new THREE.SpriteNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, fog: false });
        const a = age01;
        const flameAge = a;
        const twinkle = sin(t.mul(r(7).mul(6).add(9)).add(r(8).mul(6.28))).mul(0.35).add(0.65);
        const fade = min(a.mul(8), 1).mul(float(1).sub(a)).mul(float(1).sub(a));
        const heat = float(1.1).sub(a.mul(0.6)).mul(flick.mul(0.45).add(0.75));
        const hot = vec3(heat.mul(3.2), float(1.1).sub(a.mul(0.6)).mul(heat), heat.mul(0.18));
        // Cooling: the last third of an ember's life sinks to a dull dark red.
        const cooled = mix(hot, vec3(0.55, 0.06, 0.02), smoothstep(0.55, 1, a));
        const streetCol = vec3(2.6, 0.95, 0.16).mul(flick.mul(0.35).add(0.8));
        const flameCol = vec3(2.6, float(1.25).sub(flameAge.mul(0.9)), float(0.25).mul(float(1).sub(flameAge)));
        const flameA = sin(flameAge.mul(Math.PI)).mul(flick.mul(0.4).add(0.45));
        const col = select(isFlame(), flameCol, select(isStreet(), streetCol, cooled));
        const alpha = select(isFlame(), flameA, fade.mul(twinkle).mul(select(isStreet(), float(1.6), float(1))));
        const dimF = dim.mul(0.4).add(0.6);
        const shape = select(isFlame(), GpuParticles.dot(1.6), GpuParticles.dot(2.2));
        m.positionNode = pos.xyz;
        const size = select(
          isFlame(),
          r(9).mul(1.1).add(0.9).mul(sin(flameAge.mul(Math.PI)).mul(0.5).add(0.6)),
          select(isStreet(), r(9).mul(0.06).add(0.09), r(9).mul(0.1).add(0.1)),
        );
        m.scaleNode = vec2(size, size);
        m.colorNode = col.mul(dimF).toVarying();
        m.opacityNode = alpha.toVarying().mul(shape);
        return m;
      },
      renderOrder: 3,
    };
  }

  // ───────────────────────── fire: smoke column ─────────────────────────

  private smoke(count: number, puff: THREE.Texture): SystemSpec {
    const { uDt: dt, uGust: gust, uTime: t, uFlick: flick, uDim: dim } = this;
    const F = ROOF_FIRE;
    return {
      name: "smoke",
      count,
      life: [9, 16],
      spawn: (r, age) => {
        const p0 = vec3(F.x - 1, F.y + 0.8, F.z).add(vec3(r(1).sub(0.5).mul(2.5), 0, r(2).sub(0.5).mul(2.5))).toVar();
        const v0 = vec3(WIND.x * 0.35, r(3).mul(0.8).add(1.5), r(4).sub(0.5).mul(0.3));
        // Warm start along the column's rough path.
        p0.addAssign(vec3(age.mul(WIND.x * 0.8), age.mul(0.9), age.mul(WIND.z * 0.3)));
        return [p0, v0];
      },
      step: (p, v, r) => {
        v.x.addAssign(float(WIND.x).mul(gust).sub(v.x).mul(dt).mul(0.4));
        v.y.assign(max(v.y.mul(float(1).sub(dt.mul(0.22))), 0.25));
        const swirl = sin(t.mul(0.4).add(r(5).mul(30))).mul(0.35);
        v.z.addAssign(float(WIND.z * 0.5).add(swirl).sub(v.z).mul(dt).mul(0.3));
        p.addAssign(v.mul(dt));
      },
      material: (pos, _vel, r, a) => {
        const m = new THREE.SpriteNodeMaterial({ transparent: true });
        const size = pow(a, 0.7).mul(9).add(1.8).mul(r(6).mul(0.4).add(0.8));
        m.positionNode = pos.xyz;
        m.scaleNode = vec2(size, size);
        m.rotationNode = r(7).mul(6.283).add(a.mul(r(8).sub(0.5).mul(2)));
        // Dark grey-brown; the base is lit from below by the fire, the top cools toward the dusk sky.
        const base = mix(vec3(0.05, 0.04, 0.035), vec3(0.075, 0.06, 0.065), a);
        const glow = vec3(0.55, 0.2, 0.06).mul(smoothstep(0.22, 0, a)).mul(flick.mul(0.5).add(0.6));
        const col = base.mul(dim.mul(0.6).add(0.4)).add(glow.mul(dim.mul(0.3).add(0.7)));
        const alpha = smoothstep(0, 0.1, a).mul(pow(float(1).sub(a), 1.3)).mul(0.6);
        m.colorNode = col.toVarying();
        m.opacityNode = alpha.toVarying().mul(texture(puff, uv()).a);
        return m;
      },
      renderOrder: 2,
    };
  }

  // ───────────────────────── wind-blown ash ─────────────────────────

  private ash(count: number): SystemSpec {
    const { uDt: dt, uGust: gust, uTime: t, uCam: cam, uDim: dim } = this;
    const B = STREET_BOX;
    const HALF = 22;
    return {
      name: "ash",
      count,
      life: [6, 12],
      spawn: (r) => {
        const x = clamp(cam.x.add(r(1).sub(0.5).mul(HALF * 2)), B.minX, B.maxX);
        const p0 = vec3(x, r(2).mul(9).add(0.3), r(3).mul(B.maxZ - B.minZ).add(B.minZ));
        const v0 = vec3(WIND.x * 0.6, r(4).mul(-0.25).sub(0.35), r(5).sub(0.5).mul(0.4));
        return [p0, v0];
      },
      step: (p, v, r) => {
        const s = r(6);
        v.x.addAssign(float(WIND.x).mul(gust).mul(s.mul(0.4).add(0.7)).sub(v.x).mul(dt).mul(1.5));
        v.y.addAssign(sin(t.mul(1.3).add(s.mul(30))).mul(0.25).sub(0.45).sub(v.y).mul(dt).mul(1.2));
        v.z.assign(sin(t.mul(0.9).add(s.mul(17))).mul(0.4).add(WIND.z));
        p.addAssign(v.mul(dt));
        // Stay in a box around the camera (x) and the street (z); the ground is a slow floor.
        const dx = p.x.sub(cam.x);
        If(dx.lessThan(-HALF), () => {
          p.x.addAssign(HALF * 2);
        }).ElseIf(dx.greaterThan(HALF), () => {
          p.x.subAssign(HALF * 2);
        });
        If(p.z.lessThan(B.minZ), () => {
          p.z.addAssign(B.maxZ - B.minZ);
        }).ElseIf(p.z.greaterThan(B.maxZ), () => {
          p.z.subAssign(B.maxZ - B.minZ);
        });
        p.y.assign(max(p.y, 0.03));
      },
      material: (pos, _vel, r, a) => {
        const m = new THREE.SpriteNodeMaterial({ transparent: true });
        const size = r(7).mul(0.03).add(0.03);
        // Tumbling flake: one axis flips with a per-flake rate.
        const flip = abs(sin(t.mul(r(8).mul(4).add(1.5)).add(r(9).mul(6.28)))).mul(0.85).add(0.15);
        m.positionNode = pos.xyz;
        m.scaleNode = vec2(size.mul(flip), size);
        m.rotationNode = r(10).mul(6.28).add(t.mul(r(11).sub(0.5)));
        const inStreet = select(pos.x.greaterThan(B.minX).and(pos.x.lessThan(B.maxX)), float(1), float(0));
        const near = smoothstep(0.6, 2.0, length(pos.xyz.sub(cam)));
        const fade = smoothstep(0, 0.15, a).mul(smoothstep(1, 0.8, a)).mul(inStreet).mul(near);
        const grey = r(12).mul(0.08).add(0.13);
        m.colorNode = vec3(grey.mul(1.12), grey.mul(1.02), grey).mul(dim.mul(0.65).add(0.35)).toVarying();
        m.opacityNode = fade.mul(0.75).toVarying().mul(GpuParticles.dot(0.6));
        return m;
      },
      renderOrder: 1,
    };
  }

  // ───────────────────────── steam ─────────────────────────

  private steam(count: number, puff: THREE.Texture, vents: Vent[]): SystemSpec {
    const { uDt: dt, uGust: gust, uTime: t, uDim: dim } = this;
    const nV = vents.length;
    const ventPos = uniformArray(vents.map((v) => new THREE.Vector4(v.x, v.y, v.z, v.rate ?? 1)), "vec4");
    const vent = () => ventPos.element(instanceIndex.mod(nV));
    return {
      name: "steam",
      count,
      life: [3, 5.5],
      spawn: (r, age) => {
        const V = vent();
        const p0 = V.xyz.add(vec3(r(1).sub(0.5).mul(0.5), 0, r(2).sub(0.5).mul(0.5))).toVar();
        const v0 = vec3(r(3).sub(0.5).mul(0.3), r(4).mul(0.5).add(0.8), r(5).sub(0.5).mul(0.3));
        p0.addAssign(vec3(age.mul(WIND.x * 0.35), age.mul(0.8), 0));
        return [p0, v0];
      },
      step: (p, v, r) => {
        v.x.addAssign(float(WIND.x * 0.5).mul(gust).sub(v.x).mul(dt).mul(0.6));
        v.y.assign(max(v.y.mul(float(1).sub(dt.mul(0.25))), 0.2));
        v.z.addAssign(sin(t.mul(1.1).add(r(6).mul(20))).mul(0.2).sub(v.z).mul(dt));
        p.addAssign(v.mul(dt));
      },
      material: (pos, _vel, r, a) => {
        const m = new THREE.SpriteNodeMaterial({ transparent: true });
        const size = pow(a, 0.6).mul(2.2).add(0.35);
        m.positionNode = pos.xyz;
        m.scaleNode = vec2(size, size);
        m.rotationNode = r(7).mul(6.28).add(a.mul(0.8));
        const rate = clamp(vent().w, 0, 1);
        const on = select(r(8).lessThan(rate), float(1), float(0));
        const alpha = smoothstep(0, 0.15, a).mul(pow(float(1).sub(a), 2)).mul(0.1).mul(on);
        m.colorNode = vec3(0.4, 0.37, 0.37).mul(dim.mul(0.6).add(0.4)).toVarying();
        m.opacityNode = alpha.toVarying().mul(texture(puff, uv()).a);
        return m;
      },
      renderOrder: 1,
    };
  }

  // ───────────────────────── dust motes ─────────────────────────

  private dust(count: number): SystemSpec {
    const { uDt: dt, uGust: gust, uTime: t, uCam: cam, uDim: dim } = this;
    const B = STREET_BOX;
    const HALF = 14;
    return {
      name: "dust",
      count,
      life: [8, 16],
      spawn: (r) => {
        const x = clamp(cam.x.add(r(1).sub(0.5).mul(HALF * 2)), B.minX, B.maxX);
        const z = clamp(cam.z.add(r(2).sub(0.5).mul(20)), B.minZ, B.maxZ);
        return [vec3(x, r(3).mul(3.5).add(0.5), z), vec3(0)];
      },
      step: (p, v, r) => {
        const s = r(4).mul(40);
        v.assign(vec3(float(WIND.x * 0.08).mul(gust).add(sin(t.mul(0.5).add(s)).mul(0.08)), sin(t.mul(0.37).add(s)).mul(0.05), cos(t.mul(0.43).add(s)).mul(0.06)));
        p.addAssign(v.mul(dt));
        const dx = p.x.sub(cam.x);
        If(dx.lessThan(-HALF), () => {
          p.x.addAssign(HALF * 2);
        }).ElseIf(dx.greaterThan(HALF), () => {
          p.x.subAssign(HALF * 2);
        });
      },
      material: (pos, _vel, r, a) => {
        const m = new THREE.SpriteNodeMaterial({ transparent: true });
        const size = r(5).mul(0.02).add(0.02);
        m.positionNode = pos.xyz;
        m.scaleNode = vec2(size, size);
        // Fake sun shafts: slanted bands along the street from the low western sun.
        const band = smoothstep(0.45, 0.95, sin(pos.z.mul(1.1).add(pos.y.mul(0.5)).add(sin(pos.x.mul(0.07)).mul(2))).mul(0.5).add(0.5));
        const twinkle = sin(t.mul(r(6).mul(2).add(1)).add(r(7).mul(6.28))).mul(0.3).add(0.7);
        const fade = smoothstep(0, 0.2, a).mul(smoothstep(1, 0.8, a));
        m.colorNode = vec3(1.5, 0.95, 0.55).mul(dim).toVarying();
        m.opacityNode = fade.mul(twinkle).mul(band.mul(0.75).add(0.15)).mul(0.6).toVarying().mul(GpuParticles.dot(1.5));
        return m;
      },
      renderOrder: 1,
    };
  }

  // ───────────────────────── drizzle (?rain=1) ─────────────────────────

  private rain(count: number): SystemSpec {
    const { uDt: dt, uGust: gust, uCam: cam, uDim: dim } = this;
    const S = SHOP_INTERIOR;
    const R = 18;
    return {
      name: "rain",
      count,
      life: [1.6, 2.0],
      spawn: (r, age) => {
        const v0 = vec3(float(WIND.x * 0.6).mul(gust), r(4).mul(-2).sub(10), WIND.z);
        const p0 = vec3(cam.x.add(r(1).sub(0.5).mul(R * 2)), r(2).mul(4).add(17), cam.z.add(r(3).sub(0.5).mul(R * 2))).toVar();
        p0.addAssign(v0.mul(age));
        return [p0, v0];
      },
      step: (p, v) => {
        p.addAssign(v.mul(dt));
      },
      material: (pos, vel, r) => {
        const m = new THREE.SpriteNodeMaterial({ transparent: true });
        m.positionNode = pos.xyz;
        m.scaleNode = vec2(0.012, r(5).mul(0.2).add(0.4));
        m.rotationNode = vel.x.div(vel.y).negate().mul(0.8);
        const inShop = pos.x.greaterThan(S.minX).and(pos.x.lessThan(S.maxX)).and(pos.z.greaterThan(S.minZ)).and(pos.z.lessThan(S.maxZ)).and(pos.y.lessThan(SHOP_ROOF_Y));
        const visible = select(inShop.or(pos.y.lessThan(0)), float(0), float(1));
        const streak = smoothstep(0.5, 0.1, abs(uv().x.sub(0.5))).mul(smoothstep(0, 0.4, uv().y));
        m.colorNode = vec3(0.55, 0.6, 0.68).mul(dim.mul(0.6).add(0.4)).toVarying();
        m.opacityNode = visible.mul(0.16).toVarying().mul(streak);
        return m;
      },
      renderOrder: 1,
    };
  }
}
