/**
 * Cameo character: a stylised, human-headed guest on the Tamashi body (a consented cameo
 * for the Basecamp stage build; src/world/cameo.ts places him and can switch him off with
 * ?cameo=0 for the public take-home build).
 *
 * Owns: the guest's modelled head (bald head, ears, short full beard and mustache, thick
 * rectangular glasses, a friendly face, over-ear headphones), his outfit (bomber jacket over
 * a heather-blue tee, dark trousers, white sneakers), a plain record sleeve in his left hand,
 * and a small procedural idle rig (breathing, nodding to the beat, foot tap, sleeve glance,
 * head turn). Same low-poly style and plumbing as the Tamashi: the rig.ts skeleton, the
 * PartBuilder (one merged skinned mesh per LOD) and the shared bodyMaterial(), so the whole
 * figure is ONE draw call (plus the far LOD, shown instead of it).
 * Must not: decide what he does (src/world/cameo.ts sets the animation inputs).
 */
import * as THREE from "three";
import { boneInverses, BI, J, makeSkeleton, restPositions, RIG_BONES, type RigBone } from "./rig";
import { box, cyl, PartBuilder, rbox, softFront, sphere, taperBox, torus, tr, triangles } from "./geometry";
import { bodyMaterial, CLOTH, col, METAL, mix, PLASTIC, RUBBER, shade, type Finish } from "./materials";
import { buildBody, type Look } from "./body";
import type { TamashiTraits } from "./traits";
import type { TvDims } from "./tv-head";
import type { BoneName, TamashiPose } from "./character";

// ── Palette (sRGB hex) ──
const SKIN = col("#94603f");
const SKIN_SHADE = col("#7c4d32");
const LIPS = col("#6e3f33");
const BEARD = col("#2a1e17");
const BEARD_GREY = col("#6a645f");
const FRAME = col("#1d140f");
const FRAME_TORT = col("#4a2c18");
const JACKET = col("#9c6233");
const RIB = col("#7e4720");
const TEE = col("#5b7593");
const PANTS = col("#25272d");
const SHOE = col("#e9e9ea");
const SOLE = col("#cfcfd2");
const PHONES = col("#3b3d42");
const PADS = col("#26272b");
const SLEEVE = col("#2b6f78");
const SLEEVE_ART = col("#e88a3a");
const SLEEVE_BACK = col("#d9cdb4");

const SKIN_F: Finish = { r: 0.55, m: 0 };
const HAIR_F: Finish = { r: 0.95, m: 0 };
const EYE_F: Finish = { r: 0.3, m: 0 };
const LENS_GLINT: Finish = { r: 0.2, m: 0, e: 0.15 };

/** Head shape: ellipsoid centre and radii in head-bone space (joint = top of the neck). */
const HC = new THREE.Vector3(0, 0.175, 0);
const HR = new THREE.Vector3(0.122, 0.152, 0.134);
/** Eye line, nose tip, mouth heights (head-bone space). */
const EYE_Y = 0.162;
const MOUTH_Y = 0.094;

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Front surface z of the (undeformed) head ellipsoid at (x, y). */
function faceZ(x: number, y: number): number {
  const u = x / HR.x;
  const v = (y - HC.y) / HR.y;
  return HC.z + HR.z * Math.sqrt(Math.max(0, 1 - u * u - v * v));
}

/** Beard coverage (0..1) for a unit-sphere direction. */
function beardMask(n: THREE.Vector3): number {
  const ax = Math.min(1, Math.abs(n.x) / 0.9);
  const top = -0.36 + 0.33 * Math.pow(ax, 1.7);
  let m = smooth(top + 0.05, top - 0.05, n.y) * smooth(-0.45, -0.15, n.z);
  // The lips stay clear.
  const lips = smooth(0.34, 0.24, Math.abs(n.x)) * smooth(-0.62, -0.57, n.y) * smooth(-0.46, -0.51, n.y) * smooth(0.55, 0.7, n.z);
  m *= 1 - lips;
  return m;
}
function lipsMask(n: THREE.Vector3): number {
  return smooth(0.34, 0.24, Math.abs(n.x)) * smooth(-0.62, -0.57, n.y) * smooth(-0.46, -0.51, n.y) * smooth(0.55, 0.7, n.z);
}

/** The head: one deformed sphere, the beard pushed out as a darker volume (with a touch of grey). */
function headGeometry(lod: 0 | 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, lod ? 14 : 34, lod ? 10 : 26);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  const beard = new Float32Array(pos.count);
  const lips = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    let x = n.x * HR.x;
    let y = n.y * HR.y;
    let z = n.z * HR.z;
    // Narrower jaw, a forward chin, a fuller back of the skull.
    const low = smooth(0, -1, n.y);
    x *= 1 - 0.14 * low;
    if (n.z > 0) z += 0.03 * smooth(-0.3, -0.9, n.y) * n.z;
    if (n.z < 0 && n.y > -0.2) z *= 1.05;
    // Slightly flatter face front, so the glasses sit naturally.
    if (n.z > 0.6 && Math.abs(n.y) < 0.5) z -= 0.006 * smooth(0.6, 0.95, n.z);
    const bm = beardMask(n);
    const lm = lipsMask(n);
    beard[i] = bm;
    lips[i] = lm;
    const chin = smooth(-0.55, -0.95, n.y) * Math.max(0, n.z + 0.3);
    const push = bm * (0.011 + 0.016 * chin) - lm * 0.002;
    pos.setXYZ(i, HC.x + x + n.x * push, HC.y + y + n.y * push, HC.z + z + n.z * push);
  }
  g.computeVertexNormals();
  g.userData.beard = beard;
  g.userData.lips = lips;
  return g;
}

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Front surface z of the chest piece at chest-local height y (mirrors body.ts CHEST). */
function chestFrontZ(y: number): number {
  const C = { y0: -0.18, h: 0.33, dB: 0.195, dT: 0.215 };
  const t = THREE.MathUtils.clamp((y - C.y0) / C.h, 0, 1);
  const front = Math.max(0.55, softFront(t * 2 - 1));
  return ((C.dB + (C.dT - C.dB) * t) / 2) * front;
}

function buildHead(b: PartBuilder): void {
  const hi = b.hi;
  b.on("head");
  // Skin + beard in one mesh: colours from the masks the geometry kept.
  const head = headGeometry(b.lod);
  const beard = head.userData.beard as Float32Array;
  const lips = head.userData.lips as Float32Array;
  let idx = 0;
  const c = new THREE.Color();
  b.add(
    head,
    (p) => {
      const i = idx++;
      const bm = beard[i] ?? 0;
      const lm = lips[i] ?? 0;
      // Subtle shading: a little darker under the jaw and at the back of the skull.
      const shadeK = smooth(0.08, 0.02, p.y) * 0.5 + smooth(-0.02, -0.12, p.z) * 0.25;
      c.copy(mix(SKIN, SKIN_SHADE, shadeK));
      if (lm > 0) c.copy(mix(c, LIPS, lm));
      if (bm > 0) {
        const h = hash(p.x * 40, p.y * 40, p.z * 40);
        const grey = 0.32 * Math.pow(h, 3) * (0.6 + 0.8 * smooth(0.09, 0.03, p.y));
        c.copy(mix(c, mix(BEARD, BEARD_GREY, grey), smooth(0.05, 0.6, bm)));
      }
      return c.clone();
    },
    SKIN_F,
  );
  // Ears (mostly under the headphone cups).
  for (const s of [1, -1]) b.add(sphere(1, hi ? 8 : 5, hi ? 6 : 4), SKIN, SKIN_F, tr(s * 0.118, 0.158, -0.004, 0, 0, 0, 0.022, 0.036, 0.028));
  // Nose: bridge, tip and wings.
  const noseY = 0.123;
  const nz = faceZ(0, noseY);
  b.add(sphere(1, hi ? 10 : 5, hi ? 8 : 4), SKIN, SKIN_F, tr(0, noseY + 0.004, nz + 0.006, 0, 0, 0, 0.017, 0.018, 0.017));
  if (hi) {
    b.add(sphere(1, 8, 6), SKIN, SKIN_F, tr(0, 0.15, faceZ(0, 0.15) + 0.002, -0.35, 0, 0, 0.012, 0.032, 0.014));
    for (const s of [1, -1]) b.add(sphere(1, 7, 5), SKIN_SHADE, SKIN_F, tr(s * 0.014, noseY - 0.001, nz - 0.001, 0, 0, 0, 0.011, 0.011, 0.011));
  }
  // Mustache: a soft dark bar over the lips, joining the beard.
  const mz = faceZ(0, MOUTH_Y + 0.017) + 0.014;
  b.add(sphere(1, hi ? 10 : 6, hi ? 6 : 4), BEARD, HAIR_F, tr(0, MOUTH_Y + 0.017, mz - 0.004, 0.25, 0, 0, 0.042, 0.011, 0.015));
  if (hi) {
    // A gentle smile: the mouth line curving up at the corners.
    const a = 1.5;
    const smile = torus(0.034, 0.0035, 3, 10, a);
    smile.rotateZ(-Math.PI / 2 - a / 2);
    b.add(smile, col("#2a1510"), HAIR_F, tr(0, MOUTH_Y + 0.032, faceZ(0, MOUTH_Y) + 0.022 - 0.004, -0.15));
  }
  // Eyes: dark irises in small whites, an upper lid line; brows a touch raised (friendly).
  for (const s of [1, -1]) {
    const ex = s * 0.044;
    const ez = faceZ(ex, EYE_Y) - 0.003;
    if (hi) {
      b.add(sphere(1, 10, 6), col("#ece6dc"), EYE_F, tr(ex, EYE_Y, ez, 0, 0, 0, 0.015, 0.0092, 0.007));
      b.add(sphere(1, 8, 6), col("#1a100b"), EYE_F, tr(ex, EYE_Y - 0.0005, ez + 0.0045, 0, 0, 0, 0.0078, 0.0088, 0.004));
      b.add(sphere(1, 4, 3), col("#ffffff"), { r: 0.2, m: 0, e: 0.4 }, tr(ex + 0.0025, EYE_Y + 0.003, ez + 0.0085, 0, 0, 0, 0.0018, 0.0018, 0.001));
      b.add(box(0.036, 0.004, 0.006), SKIN_SHADE, SKIN_F, tr(ex, EYE_Y + 0.011, ez + 0.004, 0, 0, s * -0.12));
    } else {
      b.add(sphere(0.01, 4, 3), col("#1a100b"), EYE_F, tr(ex, EYE_Y, ez + 0.004));
    }
    b.add(box(0.042, 0.009, 0.012), BEARD, HAIR_F, tr(s * 0.047, 0.196, faceZ(s * 0.047, 0.196) + 0.012, -0.1, s * 0.15, s * -0.1));
  }
  buildGlasses(b);
  buildHeadphones(b);
}

/** Thick dark-tortoise rectangular frames with a hint of lens. */
function buildGlasses(b: PartBuilder): void {
  const hi = b.hi;
  const w = 0.074;
  const h = 0.054;
  const thick = 0.012;
  const shape = new THREE.Shape();
  rr(shape, w, h, 0.012);
  const hole = new THREE.Path();
  rr(hole, w - 2 * thick, h - 2 * thick, 0.006);
  shape.holes.push(hole);
  const tort = (p: THREE.Vector3) => {
    const t = hash(Math.round(p.x * 160), Math.round(p.y * 160), 1);
    return mix(FRAME, FRAME_TORT, t > 0.7 ? 0.7 : 0.15);
  };
  for (const s of [1, -1]) {
    const cx = s * 0.047;
    const cz = faceZ(cx, EYE_Y) + 0.022;
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false, curveSegments: hi ? 3 : 1 });
    g.translate(0, 0, -0.006);
    b.add(g, hi ? tort : FRAME, { r: 0.3, m: 0.05 }, tr(cx, EYE_Y + 0.002, cz, 0, s * 0.22, 0));
    if (hi) {
      // Lens glint: a thin diagonal sliver catching the light.
      b.add(box(0.003, 0.016, 0.001), col("#a9c4d0"), LENS_GLINT, tr(cx + s * 0.012, EYE_Y + 0.006, cz + 0.003 + s * -0.003, 0, s * 0.22, -0.6));
    }
    // Temple arm back to the headphone cup.
    const a = new THREE.Vector3(s * (0.047 + w / 2 - 0.004), EYE_Y + 0.012, cz - s * s * 0.012);
    const e = new THREE.Vector3(s * 0.13, EYE_Y + 0.008, -0.01);
    const len = a.distanceTo(e);
    const mid = a.clone().add(e).multiplyScalar(0.5);
    const yaw = Math.atan2(e.x - a.x, e.z - a.z);
    b.add(box(0.005, 0.008, len), FRAME, { r: 0.3, m: 0.05 }, tr(mid.x, mid.y, mid.z, 0, yaw, 0));
  }
  b.add(box(0.026, 0.01, 0.01), FRAME, { r: 0.3, m: 0.05 }, tr(0, EYE_Y + 0.012, faceZ(0, EYE_Y) + 0.022));
}

function rr(p: THREE.Path, w: number, h: number, r: number): void {
  const x = -w / 2;
  const y = -h / 2;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
}

/** Neutral dark grey over-ear headphones, no markings. */
function buildHeadphones(b: PartBuilder): void {
  const hi = b.hi;
  const cy = 0.158;
  const cz = -0.006;
  for (const s of [1, -1]) {
    b.add(cyl(0.047, 0.047, 0.034, hi ? 16 : 8), PHONES, PLASTIC, tr(s * 0.142, cy, cz, 0, 0, Math.PI / 2, 1, 1, 1.12));
    b.add(cyl(0.05, 0.05, 0.016, hi ? 16 : 8), PADS, RUBBER, tr(s * 0.122, cy, cz, 0, 0, Math.PI / 2, 1, 1, 1.12));
    if (hi) {
      b.add(cyl(0.032, 0.032, 0.004, 14), shade(PHONES, 0.8), PLASTIC, tr(s * 0.16, cy, cz, 0, 0, Math.PI / 2, 1, 1, 1.12));
      // Yoke: short arm from the cup up to the band.
      b.add(box(0.008, 0.05, 0.014), PHONES, METAL, tr(s * 0.146, cy + 0.055, cz));
    }
  }
  // Headband over the crown (an elliptical arch), padded underside.
  const band = torus(0.146, 0.008, hi ? 5 : 3, hi ? 20 : 10, Math.PI);
  b.add(band, PHONES, PLASTIC, tr(0, cy + 0.02, cz, 0, 0, 0, 1, 1.0, 2.2));
  if (hi) {
    const pad = torus(0.138, 0.008, 4, 12, Math.PI * 0.42);
    pad.rotateZ(Math.PI / 2 - Math.PI * 0.21);
    b.add(pad, PADS, RUBBER, tr(0, cy + 0.02, cz, 0, 0, 0, 1, 1.0, 2.6));
  }
}

/** Bomber-jacket details on the generic body: open front over the tee, ribbed collar, cuffs, waistband, snaps. */
function buildJacket(b: PartBuilder): void {
  if (!b.hi) {
    b.on("chest").add(box(0.09, 0.2, 0.01), TEE, CLOTH, tr(0, 0.05, chestFrontZ(0.05) + 0.003));
    return;
  }
  const top = -0.18 + 0.33;
  const heather = (p: THREE.Vector3) => mix(TEE, col("#7d93ad"), 0.35 * hash(Math.round(p.x * 300), Math.round(p.y * 300), 3));
  b.on("chest");
  // The tee showing through the open front (a V widening to the collarbones).
  b.add(taperBox(0.08, 0.15, 0.27, 0.012, 0.012, 0.004), heather, CLOTH, tr(0, top - 0.135, chestFrontZ(top - 0.135) + 0.002));
  b.add(torus(0.088, 0.014, 5, 16), shade(TEE, 0.9), CLOTH, tr(0, top - 0.006, 0.006, Math.PI / 2 - 0.12));
  // Jacket edges (ribbed placket) along the opening, and the stand collar round the back.
  const collar = torus(0.112, 0.022, 4, 16, Math.PI * 1.45);
  collar.rotateZ(Math.PI / 2 + Math.PI * 0.275);
  collar.rotateX(Math.PI / 2);
  b.add(collar, RIB, CLOTH, tr(0, top + 0.02, -0.006, 0, 0, 0, 1.02, 2.8, 1));
  // Snaps down the left front, a chest seam.
  for (const y of [0.08, 0.0, -0.08]) b.add(cyl(0.0085, 0.0085, 0.006, 8), col("#5a4630"), METAL, tr(0.077, y, chestFrontZ(y) + 0.012, Math.PI / 2));
  b.on("spine");
  b.add(box(0.07, 0.18, 0.012), heather, CLOTH, tr(0, 0.05, 0.103));
  for (const s of [1, -1]) {
    // Slanted welt pockets.
    b.add(box(0.012, 0.09, 0.012), shade(JACKET, 0.7), CLOTH, tr(s * 0.105, -0.02, 0.098, 0, s * 0.3, s * 0.35));
  }
  b.add(cyl(0.0085, 0.0085, 0.006, 8), col("#5a4630"), METAL, tr(0.06, 0.02, 0.112, Math.PI / 2));
  // Ribbed waistband.
  b.add(taperBox(0.315, 0.31, 0.055, 0.215, 0.21, 0.03), RIB, CLOTH, tr(0, -0.11, 0));
  // Ribbed cuffs.
  for (const fa of ["foreArmL", "foreArmR"] as const) b.on(fa).add(cyl(0.056, 0.054, 0.05, 10, true), RIB, CLOTH, tr(0, -(J.elbowY - J.wristY) + 0.03, 0));
}

/** A plain record sleeve held by its top edge in the left hand (generic art: colour + a disc). */
function buildSleeve(b: PartBuilder): void {
  const hi = b.hi;
  b.on("handL");
  const S = 0.31;
  const y = -0.07 - S / 2 + 0.035;
  const x = 0.03;
  const z = 0.035;
  b.add(box(0.006, S, S), SLEEVE, { r: 0.6, m: 0 }, tr(x, y, z));
  if (hi) {
    // Front (outward, +x): an off-centre orange disc and a thin bar. Back: a cream panel.
    b.add(cyl(0.085, 0.085, 0.002, 20), SLEEVE_ART, { r: 0.55, m: 0 }, tr(x + 0.0035, y + 0.03, z - 0.03, 0, 0, Math.PI / 2));
    b.add(box(0.002, 0.012, 0.2), col("#f2e8d2"), { r: 0.55, m: 0 }, tr(x + 0.0035, y - 0.1, z + 0.02));
    b.add(box(0.002, 0.012, 0.2), SLEEVE_BACK, { r: 0.7, m: 0 }, tr(x - 0.0035, y + 0.11, z - 0.02));
    b.add(cyl(0.05, 0.05, 0.002, 16), SLEEVE_ART, { r: 0.55, m: 0 }, tr(x - 0.0035, y - 0.05, z + 0.06, 0, 0, Math.PI / 2));
    // The record peeking out of the open edge.
    b.add(cyl(0.148, 0.148, 0.003, 24, false), col("#121214"), { r: 0.25, m: 0.1 }, tr(x, y - 0.01, z + 0.045, 0, 0, Math.PI / 2));
  }
}

function buildCameo(b: PartBuilder): void {
  const look: Look = {
    skin: SKIN,
    top: JACKET,
    sleeve: JACKET,
    sleeves: "long",
    cuff: null,
    pants: PANTS,
    shorts: false,
    shoes: SHOE,
    sole: SOLE,
    hands: SKIN,
    bulk: 1.04,
    untucked: true,
    collar: "none",
    collarColor: RIB,
    inner: null,
    coat: 0,
    coatColor: JACKET,
    coatOpen: false,
    sash: null,
    belt: null,
    stripes: null,
    tie: null,
    bowtie: null,
    buttons: null,
    double: false,
    bib: null,
    apron: null,
    vest: null,
    vestStripes: null,
    suspenders: null,
    cape: null,
    fur: false,
    panel: null,
    dots: null,
    armor: null,
    armorTrim: null,
    snowman: false,
    pocket: false,
    shawl: null,
  };
  // buildBody only reads traits/dims for trait-driven accessories (none here).
  const noTraits = { id: 0, accessories: [], notes: "", outfit: { type: "jacket", primary: "#a4602b", secondary: "#5b7593", accent: null, details: "" } } as unknown as TamashiTraits;
  buildBody(b, noTraits, look, {} as TvDims);
  buildJacket(b);
  buildHead(b);
  buildSleeve(b);
}

// ── Shared asset (built once) ──

interface CameoAsset {
  rest: THREE.Vector3[];
  inverses: THREE.Matrix4[];
  hi: THREE.BufferGeometry;
  lo: THREE.BufferGeometry;
}
let asset: CameoAsset | null = null;
function cameoAsset(): CameoAsset {
  if (asset) return asset;
  const rest = restPositions(new THREE.Vector3(0.03, 0.3, 0), new THREE.Vector3(-0.03, 0.3, 0));
  const build = (lod: 0 | 1) => {
    const b = new PartBuilder(rest, lod);
    buildCameo(b);
    const g = b.build();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.2);
    return g;
  };
  asset = { rest, inverses: boneInverses(rest), hi: build(0), lo: build(1) };
  return asset;
}

export function cameoStats(): { hiTriangles: number; loTriangles: number; drawCalls: number } {
  const a = cameoAsset();
  return { hiTriangles: triangles(a.hi), loTriangles: triangles(a.lo), drawCalls: 1 };
}

const IDENTITY = new THREE.Matrix4();
/** Hand rotation while looking at the sleeve (front turned up toward his face). */
export const GLANCE_HAND = { x: -0.5, y: -2, z: 1 };
const BEAT = (96 / 60) * Math.PI * 2;
const FAR = 16;
const P = new THREE.Vector3();
const P2 = new THREE.Vector3();

/** Same outward shape as TamashiCharacter (root, model, height, update, bone, pose …), idle-only rig. */
export class CameoCharacter {
  readonly root = new THREE.Group();
  readonly model = new THREE.Group();
  /** Top of the head, metres. */
  readonly height = J.headY + HC.y + HR.y;
  readonly bodyHi: THREE.SkinnedMesh;
  readonly bodyLo: THREE.SkinnedMesh;
  readonly skeleton: THREE.Skeleton;

  // ── Animation inputs ──
  /** Kept for shape compatibility; he only stands. */
  speed = 0;
  pose: TamashiPose = "stand";
  /** Head nod amplitude (rad, 0..~0.25) on a ~96 bpm beat. */
  nod = 0.06;
  /** 0..1: tapping the right foot on the beat. */
  tap = 0;
  /** 0..1: lifting the sleeve in the left hand to look at it. */
  glance = 0;
  /** Head turn (rad, + = his left), e.g. toward the player. */
  lookYaw = 0;

  private bones: THREE.Bone[];
  private rest: THREE.Vector3[];
  private time = Math.random() * 10;
  private far = false;
  private yaw = 0;

  constructor(options: { castShadow?: boolean } = {}) {
    const a = cameoAsset();
    this.root.name = "cameo";
    this.root.add(this.model);
    this.rest = a.rest;
    const { skeleton, bones } = makeSkeleton(a.rest, a.inverses);
    this.skeleton = skeleton;
    this.bones = bones;
    this.model.add(bones[0]);
    const mat = bodyMaterial();
    const mk = (g: THREE.BufferGeometry) => {
      const m = new THREE.SkinnedMesh(g, mat);
      m.bind(skeleton, IDENTITY);
      m.boundingSphere = g.boundingSphere!.clone();
      m.castShadow = m.receiveShadow = options.castShadow ?? false;
      this.model.add(m);
      return m;
    };
    this.bodyHi = mk(a.hi);
    this.bodyLo = mk(a.lo);
    this.bodyLo.visible = false;
    this.animate(0);
  }

  bone(name: BoneName): THREE.Object3D {
    return this.bones[BI[name]];
  }

  get lowDetail(): boolean {
    return this.far;
  }

  update(dt: number, camera?: THREE.Camera): void {
    if (camera) {
      this.root.getWorldPosition(P);
      camera.getWorldPosition(P2);
      const d = P.distanceTo(P2);
      const far = this.far ? d > FAR - 1 : d > FAR + 1;
      if (far !== this.far) {
        this.far = far;
        this.bodyHi.visible = !far;
        this.bodyLo.visible = far;
      }
    }
    this.animate(Math.min(dt, 0.1));
  }

  dispose(): void {
    this.skeleton.dispose();
    this.root.removeFromParent();
  }

  private animate(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (const bone of this.bones) bone.rotation.set(0, 0, 0);
    const R = (n: RigBone) => this.bones[BI[n]].rotation;
    const g = THREE.MathUtils.clamp(this.glance, 0, 1);
    const tap = THREE.MathUtils.clamp(this.tap, 0, 1);
    const beat = 0.5 - 0.5 * Math.cos(t * BEAT);

    // Relaxed stance: weight on the left leg, right knee soft, slow sway.
    const sway = Math.sin(t * 0.45);
    const breath = Math.sin((t * Math.PI * 2) / 4.2);
    R("hips").z = 0.035 + 0.015 * sway;
    R("hips").y = 0.05;
    R("spine").z = -0.03 - 0.012 * sway;
    R("chest").z = -0.012;
    R("chest").x = -0.02 - 0.016 * breath;
    R("thighL").z = 0.02;
    R("thighR").z = -0.07;
    R("thighR").x = -0.05;
    R("shinR").x = 0.1;
    R("footR").x = -0.05;
    R("footR").y = -0.2;
    R("footL").y = 0.12;
    // A little body bounce with the beat (knees), stronger with the nod.
    const groove = Math.min(1, this.nod / 0.16);
    R("shinL").x = 0.03 + 0.04 * groove * beat;
    R("thighL").x = -0.02 * groove * beat;

    // Foot tap: the right toes lift and drop on the beat.
    R("footR").x += -0.28 * tap * Math.max(0, Math.sin(t * BEAT));

    // Arms: right hand loose at the side (fingers tapping the beat); left holds the sleeve.
    R("upperArmR").z = -0.1 - 0.015 * breath;
    R("upperArmR").x = 0.04;
    R("foreArmR").x = -0.18;
    R("handR").x = -0.12 * beat * groove;
    R("upperArmL").z = 0.13 + 0.015 * breath;
    R("upperArmL").x = 0.02;
    R("foreArmL").x = -0.12;
    R("handL").y = 0.08;
    if (g > 0) {
      // Lift the sleeve to chest height, front turned to him, and look down at it.
      const lerp = THREE.MathUtils.lerp;
      R("upperArmL").x = lerp(R("upperArmL").x, -0.2, g);
      R("upperArmL").z = lerp(R("upperArmL").z, 0.16, g);
      R("upperArmL").y = lerp(0, -0.2, g);
      R("foreArmL").x = lerp(R("foreArmL").x, -1.2, g);
      R("foreArmL").y = lerp(0, 0.3, g);
      R("handL").y = lerp(R("handL").y, GLANCE_HAND.y, g);
      R("handL").z = lerp(0, GLANCE_HAND.z, g);
      R("handL").x = lerp(0, GLANCE_HAND.x, g);
    }

    // Head: nod on the beat (the neck helps a little), turn toward the player, glance down at the sleeve.
    this.yaw += (THREE.MathUtils.clamp(this.lookYaw, -0.7, 0.7) * (1 - g) + 0.32 * g - this.yaw) * (1 - Math.exp(-dt * 3));
    const nod = this.nod * beat;
    R("neck").x = 0.3 * nod + 0.18 * g;
    R("head").x = 0.75 * nod + 0.22 * g;
    R("head").y = this.yaw + 0.05 * Math.sin(t * 0.31);
    R("neck").y = 0.3 * this.yaw;
    R("head").z = 0.03 * Math.sin(t * BEAT * 0.5) * groove;

    const hips = this.bones[BI.hips];
    hips.position.y = this.rest[BI.hips].y - 0.008 * groove * beat + 0.003 * breath;
  }
}

/** Build the cameo character (one shared geometry, a fresh skeleton). */
export function createCameo(options?: { castShadow?: boolean }): CameoCharacter {
  return new CameoCharacter(options);
}
