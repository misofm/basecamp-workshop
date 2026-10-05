/**
 * A Tamashi character: assembles the TV head, screen and body for one token and runs a
 * procedural animation rig (idle, walk, run, carry, overhead swing, cheer, sit, crouch).
 *
 * Owns: per-token geometry cache (one merged skinned mesh per LOD, built once per id),
 * per-instance skeleton + bones, the screen mesh (child of the head bone), distance LOD,
 * and every animation (no clips, no GLBs). Draw calls per character: body (1) + screen (1).
 * Must not: decide what a character does (player.ts / npcs.ts set the animation inputs).
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";
import { traitsFor, type TamashiTraits } from "./traits";
import { DISPLAY_SCALE } from "../world/record-item";
import { boneInverses, BI, J, makeSkeleton, restPositions, RIG_BONES, type RigBone } from "./rig";
import { PartBuilder, triangles } from "./geometry";
import { bodyMaterial } from "./materials";
import { buildTvHead, screenGeometry, tvDims, type TvDims } from "./tv-head";
import { buildBody, resolveLook } from "./body";
import { buildHeadwear } from "./headwear";
import { screenMaterial } from "./screen";

/**
 * Rig joints. Every bone has an identity rest rotation, so its local axes are the body's:
 * +x = the character's LEFT, +y = up, +z = forward. "R" bones are on the character's right (−x).
 */
export type BoneName =
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "upperArmL"
  | "foreArmL"
  | "handL"
  | "upperArmR"
  | "foreArmR"
  | "handR"
  | "thighL"
  | "shinL"
  | "footL"
  | "thighR"
  | "shinR"
  | "footR";

export interface TamashiOptions {
  /** "player": highest detail (larger screen texture, casts + receives shadows). Default "npc". */
  role?: "player" | "npc";
  /** Default: true for the player, false for NPCs. */
  castShadow?: boolean;
}

/** Whole-body pose; changes blend smoothly. */
export type TamashiPose = "stand" | "sit" | "crouch";

// ── Shared per-token assets ──

interface Asset {
  dims: TvDims;
  rest: THREE.Vector3[];
  inverses: THREE.Matrix4[];
  hi: THREE.BufferGeometry;
  lo: THREE.BufferGeometry;
  buildMs: number;
}
const assets = new Map<number, Asset>();

function assetFor(t: TamashiTraits): Asset {
  const hit = assets.get(t.id);
  if (hit) return hit;
  const t0 = performance.now();
  const dims = tvDims(t);
  const rest = restPositions(dims.antenna.base[0], dims.antenna.base[1]);
  const look = resolveLook(t);
  const build = (lod: 0 | 1) => {
    const b = new PartBuilder(rest, lod);
    buildTvHead(b, t, dims);
    buildHeadwear(b, t, dims);
    buildBody(b, t, look, dims);
    const g = b.build();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.35);
    return g;
  };
  const a: Asset = { dims, rest, inverses: boneInverses(rest), hi: build(0), lo: build(1), buildMs: 0 };
  a.buildMs = performance.now() - t0;
  assets.set(t.id, a);
  return a;
}

/** Triangle counts and draw calls for token `id` (builds its geometry if needed). */
export function tamashiStats(id: number): { hiTriangles: number; loTriangles: number; screenTriangles: number; drawCalls: number; buildMs: number } {
  const a = assetFor(traitsFor(id));
  return { hiTriangles: triangles(a.hi), loTriangles: triangles(a.lo), screenTriangles: triangles(screenGeometry(a.dims)), drawCalls: 2, buildMs: a.buildMs };
}

// ── Quality / LOD ──

let farDistance = 16;
/** Global detail level: "low" pulls the far-LOD distance in (weak GPUs, ?quality=low). */
export function setTamashiQuality(quality: "low" | "high"): void {
  farDistance = quality === "low" ? 9 : 16;
}

const IDENTITY = new THREE.Matrix4();
const RECORD_LOCAL = new THREE.Matrix4().compose(
  new THREE.Vector3(0, -0.27, 0),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -2.1, 0)),
  new THREE.Vector3(DISPLAY_SCALE, DISPLAY_SCALE, DISPLAY_SCALE),
);
const BEAT = (96 / 60) * Math.PI * 2;
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;

export class TamashiCharacter {
  readonly traits: TamashiTraits;
  /** Put this in the scene: upright, feet at y = 0, facing +z. */
  readonly root = new THREE.Group();
  /** Child of root holding the body; npcs.ts shifts it sideways for sidesteps. */
  readonly model = new THREE.Group();
  /** Height to the top of the TV (antennas excluded), metres. */
  readonly height: number;

  // ── Animation inputs: set them every frame (or whenever they change). ──
  /** Ground speed, m/s. 0 idle · ~1.3 stroll · 3.2 walk · 6 run. The gait blends by speed. */
  speed = 0;
  /** 0..1: blend into the carry pose (right arm holding a record at the side). */
  carry = 0;
  /** Overhead swing: right-arm rotation about the body's x axis (rad; negative raises it forward-up and overhead, about -3.25 at the top). */
  swingArm = 0;
  /** Torso lean for the swing (rad; positive leans forward). */
  swingLean = 0;
  /** Head nod amplitude (rad, 0..~0.25) on a ~96 bpm beat. */
  nod = 0;
  /** Sideways head/TV tilt (rad), e.g. while thinking. */
  tilt = 0;
  /** Wave the right arm (beckoning the player over). */
  waving = false;
  /** Whole-body pose: "sit" (on the ground/curb) or "crouch" (kneeling, tinkering). `speed` is ignored unless standing. */
  pose: TamashiPose = "stand";

  /** The two body meshes (high / low detail) and the screen. */
  readonly bodyHi: THREE.SkinnedMesh;
  readonly bodyLo: THREE.SkinnedMesh;
  readonly screen: THREE.Mesh;
  readonly skeleton: THREE.Skeleton;

  private bones = new Map<RigBone, THREE.Bone>();
  private boneList: THREE.Bone[];
  private rest: THREE.Vector3[];
  private time = Math.random() * 10;
  private phase = 0;
  private gaitSpeed = 0;
  private cheerT = 0;
  private waveW = 0;
  private sitW = 0;
  private crouchW = 0;
  private far = false;
  private skip = 0;
  private pendingDt = 0;
  private seed = Math.random() * 100;

  constructor(
    readonly id: number,
    options: TamashiOptions = {},
  ) {
    this.traits = traitsFor(id);
    this.root.name = `tamashi:${id}`;
    this.root.add(this.model);
    const a = assetFor(this.traits);
    this.rest = a.rest;
    this.height = J.headY + a.dims.H;
    const { skeleton, bones } = makeSkeleton(a.rest, a.inverses);
    this.skeleton = skeleton;
    this.boneList = bones;
    RIG_BONES.forEach((n, i) => this.bones.set(n, bones[i]));
    this.model.add(bones[0]);
    const mat = bodyMaterial();
    const mk = (g: THREE.BufferGeometry) => {
      const m = new THREE.SkinnedMesh(g, mat);
      m.bind(skeleton, IDENTITY);
      m.boundingSphere = g.boundingSphere!.clone();
      this.model.add(m);
      return m;
    };
    this.bodyHi = mk(a.hi);
    this.bodyLo = mk(a.lo);
    this.bodyLo.visible = false;
    const big = options.role === "player";
    const s = a.dims.screen;
    this.screen = new THREE.Mesh(screenGeometry(a.dims), screenMaterial(this.traits, s.w / s.h, big));
    this.screen.name = "tamashi-screen";
    this.bones.get("head")!.add(this.screen);
    const shadow = options.castShadow ?? big;
    for (const m of [this.bodyHi, this.bodyLo, this.screen]) {
      m.castShadow = shadow;
      m.receiveShadow = shadow;
    }
    this.animate(0);
  }

  /** Bone to attach props to. Child positions are relative to the joint, in body axes (metres). */
  bone(name: BoneName): THREE.Object3D {
    return this.bones.get(name)!;
  }

  /** Short happy reaction: a hop, arms up, antennas wiggle. */
  cheer(): void {
    this.cheerT = 1.2;
  }

  /** True when the far (low-detail) mesh is showing. */
  get lowDetail(): boolean {
    return this.far;
  }

  /** Advance the rig. With `camera`, also picks the level of detail by distance. */
  update(dt: number, camera?: THREE.Camera): void {
    if (camera) {
      this.root.getWorldPosition(P);
      camera.getWorldPosition(P2);
      const d = P.distanceTo(P2);
      const far = this.far ? d > farDistance - 1 : d > farDistance + 1;
      if (far !== this.far) {
        this.far = far;
        this.bodyHi.visible = !far;
        this.bodyLo.visible = far;
      }
    }
    // Far characters animate at half rate.
    this.pendingDt += dt;
    if (this.far && this.cheerT <= 0 && ++this.skip % 2 === 1) return;
    const step = Math.min(this.pendingDt, 0.1);
    this.pendingDt = 0;
    this.animate(step);
  }

  /**
   * World matrix for a record held in the right hand (a record-item.ts Holder body):
   * sleeve hanging just below the grip, cover turned out, at DISPLAY_SCALE.
   * Returns whether the character is visible.
   */
  recordMatrix(out: THREE.Matrix4): boolean {
    const hand = this.bones.get("handR")!;
    hand.updateWorldMatrix(true, false);
    out.multiplyMatrices(hand.matrixWorld, RECORD_LOCAL);
    return this.root.visible;
  }

  /** Free per-instance GPU resources (shared caches stay). Remove root from the scene first. */
  dispose(): void {
    this.skeleton.dispose();
    this.root.removeFromParent();
  }

  // ── The rig ──

  private animate(dt: number): void {
    this.time += dt;
    const t = this.time;
    const b = this.boneList;
    for (const bone of b) bone.rotation.set(0, 0, 0);
    const R = (n: RigBone) => b[BI[n]].rotation;

    // Pose blend.
    const k = 1 - Math.exp(-dt * 5);
    this.sitW += ((this.pose === "sit" ? 1 : 0) - this.sitW) * k;
    this.crouchW += ((this.pose === "crouch" ? 1 : 0) - this.crouchW) * k;
    const posed = Math.max(this.sitW, this.crouchW);
    const stand = 1 - posed;

    // Gait.
    const target = this.speed * stand;
    this.gaitSpeed += (target - this.gaitSpeed) * (1 - Math.exp(-dt * 10));
    const s = Math.max(0, this.gaitSpeed);
    const cycle = 1.0 + 0.27 * s;
    this.phase = (this.phase + ((s * dt) / cycle) * Math.PI * 2) % (Math.PI * 200);
    const ph = this.phase;
    const walkW = smooth(0.05, 1.0, s);
    const runW = smooth(3.6, 5.6, s);
    const sin = Math.sin(ph);
    const cos = Math.cos(ph);
    const thighAmp = walkW * (0.3 + 0.12 * Math.min(1, s / 3.2)) + runW * 0.35;
    const kneeK = walkW * lerp(0.75, 1.55, runW);
    const legs = (side: 1 | -1, p: number) => {
      const th = side > 0 ? "thighL" : "thighR";
      const sh = side > 0 ? "shinL" : "shinR";
      const ft = side > 0 ? "footL" : "footR";
      const sp = Math.sin(p);
      const cp = Math.cos(p);
      const thigh = -thighAmp * sp - runW * 0.18;
      const knee = kneeK * Math.pow(Math.max(0, cp), 1.4) + walkW * 0.08 + runW * 0.25 * Math.max(0, -sp);
      R(th).x = thigh;
      R(sh).x = knee;
      R(ft).x = -(thigh + knee) * 0.75 + walkW * 0.25 * Math.max(0, -cp) * Math.max(0, sp);
    };
    legs(1, ph);
    legs(-1, ph + Math.PI);
    const hips = b[BI.hips];
    let hipY = this.rest[BI.hips].y;
    hipY += walkW * (lerp(0.022, -0.045, runW) * Math.cos(2 * ph) - lerp(0.005, 0.03, runW));
    R("hips").y = (0.12 * walkW + 0.06 * runW) * sin;
    R("hips").z = 0.04 * walkW * cos * (1 - runW);
    R("spine").x = 0.03 * walkW + 0.16 * runW;
    R("chest").y = -(0.16 * walkW + 0.1 * runW) * sin;
    R("chest").x = 0.02 * runW;
    const armAmp = walkW * 0.38 + runW * 0.45;
    R("upperArmL").x = armAmp * sin;
    R("upperArmR").x = -armAmp * sin;
    R("upperArmL").z = 0.1 + runW * 0.06;
    R("upperArmR").z = -0.1 - runW * 0.06;
    R("foreArmL").x = -(0.12 + walkW * 0.22 + runW * 1.0) - Math.max(0, -sin) * armAmp * 0.6;
    R("foreArmR").x = -(0.12 + walkW * 0.22 + runW * 1.0) - Math.max(0, sin) * armAmp * 0.6;
    R("neck").x = -0.6 * R("spine").x;
    R("head").z = (0.03 * walkW + 0.05 * runW) * sin;
    R("head").x = (0.02 * walkW + 0.04 * runW) * Math.cos(2 * ph);

    // Idle: breathing, a slow weight shift, relaxed arms.
    const idle = 1 - walkW;
    const breath = Math.sin((t * Math.PI * 2) / 3.8 + this.seed);
    R("chest").x += -0.018 * breath * idle;
    R("upperArmL").z += 0.02 * breath * idle;
    R("upperArmR").z -= 0.02 * breath * idle;
    R("hips").z += 0.025 * Math.sin(t * 0.45 + this.seed) * idle * stand;
    R("spine").z -= 0.02 * Math.sin(t * 0.45 + this.seed) * idle * stand;
    R("head").y += 0.06 * Math.sin(t * 0.31 + this.seed * 2) * idle;
    hipY += 0.004 * breath * idle;

    // Sit / crouch (blended on top of the standing rig).
    if (posed > 0.001) {
      const sw = this.sitW;
      const cw = this.crouchW;
      const add = (n: RigBone, x: number, y = 0, z = 0) => {
        const r = R(n);
        r.x += x;
        r.y += y;
        r.z += z;
      };
      // Sit on the ground: hips ~0.3 m up, knees up, hands on knees.
      hipY -= sw * 0.6;
      add("thighL", sw * -1.95, 0, sw * 0.12);
      add("thighR", sw * -1.95, 0, sw * -0.12);
      add("shinL", sw * 1.8);
      add("shinR", sw * 1.8);
      add("footL", sw * 0.15);
      add("footR", sw * 0.15);
      add("spine", sw * 0.22);
      add("chest", sw * 0.1);
      add("neck", sw * -0.2);
      add("upperArmL", sw * -0.75, 0, sw * 0.02);
      add("upperArmR", sw * -0.75, 0, sw * -0.02);
      add("foreArmL", sw * -0.5);
      add("foreArmR", sw * -0.5);
      // Crouch: kneel on the right knee, left foot planted, lean in, hands forward.
      hipY -= cw * 0.43;
      add("thighL", cw * -1.45, 0, cw * 0.06);
      add("shinL", cw * 1.62);
      add("footL", cw * -0.17);
      add("thighR", cw * 0.05, 0, cw * -0.05);
      add("shinR", cw * 1.55);
      add("footR", cw * -0.6);
      add("spine", cw * 0.32);
      add("chest", cw * 0.18);
      add("neck", cw * -0.15);
      add("head", cw * 0.15);
      add("upperArmL", cw * -0.95, 0, cw * 0.05);
      add("upperArmR", cw * -0.85, 0, cw * -0.05);
      add("foreArmL", cw * -0.65);
      add("foreArmR", cw * -0.75);
      hips.position.z = this.rest[BI.hips].z - cw * 0.08;
    } else hips.position.z = this.rest[BI.hips].z;

    // Carry: right arm holding a record out at the side, hand level.
    const c = clamp(this.carry, 0, 1);
    if (c > 0) {
      const ua = R("upperArmR");
      const fa = R("foreArmR");
      ua.x = lerp(ua.x, -0.28 + 0.06 * sin * walkW, c);
      ua.z = lerp(ua.z, -0.3, c);
      fa.x = lerp(fa.x, -0.6, c);
      const h = R("handR");
      h.x = lerp(h.x, -(ua.x + fa.x), c);
      h.z = lerp(h.z, -ua.z, c);
    }

    // Overhead smash (game-driven).
    const sw = clamp(Math.max(Math.abs(this.swingArm) / 0.25, Math.abs(this.swingLean) / 0.08), 0, 1);
    if (sw > 0) {
      const ua = R("upperArmR");
      const fa = R("foreArmR");
      const raised = clamp(-this.swingArm / 3.25, 0, 1);
      ua.x = lerp(ua.x, this.swingArm, sw);
      ua.z = lerp(ua.z, -0.12 - 0.15 * raised, sw);
      fa.x = lerp(fa.x, -0.7 * raised * raised, sw);
      R("handR").x = lerp(R("handR").x, 0, sw);
      R("handR").z = lerp(R("handR").z, 0, sw);
      R("spine").x += this.swingLean * 0.6;
      R("chest").x += this.swingLean * 0.45;
      R("neck").x -= this.swingLean * 0.4;
      R("upperArmL").x = lerp(R("upperArmL").x, -0.35 * raised + 0.3 * Math.max(0, this.swingArm), sw);
      R("chest").y += -0.18 * raised * sw;
    }

    // Wave (right arm up, forearm waving).
    this.waveW += ((this.waving ? 1 : 0) - this.waveW) * (1 - Math.exp(-dt * 6));
    if (this.waveW > 0.001) {
      const w = this.waveW;
      const ua = R("upperArmR");
      const fa = R("foreArmR");
      ua.x = lerp(ua.x, -0.25, w);
      ua.z = lerp(ua.z, -2.45, w);
      fa.x = lerp(fa.x, 0, w);
      fa.z = lerp(fa.z, 0.15 + 0.4 * Math.sin(t * 9), w);
      R("handR").z = lerp(R("handR").z, 0.2 * Math.sin(t * 9 - 0.5), w);
      R("head").z += 0.06 * w;
    }

    // Cheer: crouch, hop, arms up.
    let wiggle = 0;
    if (this.cheerT > 0) {
      this.cheerT = Math.max(0, this.cheerT - dt);
      const u = 1.2 - this.cheerT; // 0 → 1.2
      const env = Math.sin(Math.PI * clamp(u / 1.2, 0, 1));
      const hop = u > 0.15 && u < 0.6 ? Math.sin(((u - 0.15) / 0.45) * Math.PI) : 0;
      const dip = u < 0.15 ? Math.sin((u / 0.15) * Math.PI) : u > 0.6 && u < 0.8 ? Math.sin(((u - 0.6) / 0.2) * Math.PI) * 0.6 : 0;
      hipY += 0.17 * hop - 0.06 * dip;
      for (const side of ["L", "R"] as const) {
        const sg = side === "L" ? 1 : -1;
        const ua = R(`upperArm${side}`);
        ua.z = lerp(ua.z, sg * 2.6, env);
        ua.x = lerp(ua.x, -0.2, env);
        R(`foreArm${side}`).z = lerp(R(`foreArm${side}`).z, sg * 0.3, env);
        R(`thigh${side}`).x += -0.5 * dip + -0.25 * hop;
        R(`shin${side}`).x += 0.9 * dip + 0.5 * hop;
        R(`foot${side}`).x += -0.4 * dip - 0.25 * hop;
      }
      R("head").z += 0.12 * Math.sin(u * 14) * env;
      wiggle = env;
    }

    // Head: nod on the beat, tilt.
    if (this.nod) R("head").x += this.nod * (0.5 - 0.5 * Math.cos(t * BEAT));
    R("head").z += this.tilt;

    // Antennas: a little sway, bigger when running, wild while cheering.
    const wob = 0.035 * Math.sin(t * 1.7 + this.seed) + (0.05 * walkW + 0.13 * runW) * Math.sin(2 * ph + 0.9) + 0.4 * wiggle * Math.sin(t * 22);
    const bob = (0.03 * walkW + 0.1 * runW) * Math.cos(2 * ph + 0.6) + 0.15 * wiggle * Math.sin(t * 17);
    R("antennaL").z = wob - R("head").z * 0.8;
    R("antennaR").z = wob * 0.9 - R("head").z * 0.8;
    R("antennaL").x = bob;
    R("antennaR").x = bob * 1.1;

    hips.position.y = hipY;
  }
}

/** Build Tamashi #id (1..100). */
export function createTamashi(id: number, options?: TamashiOptions): TamashiCharacter {
  return new TamashiCharacter(id, options);
}

/** Pre-build geometry for these ids (e.g. during a loading screen) so later creates are instant. */
export function warmTamashi(ids: Iterable<number>): void {
  for (const id of ids) assetFor(traitsFor(id));
}

const P = new THREE.Vector3();
const P2 = new THREE.Vector3();
