/**
 * StreetProps: every street-level and wall-mounted prop of the Nozomi back street (world
 * bible §7.5) that no other module owns.
 *
 * Owns: utility poles (crossarms, insulators, transformers, the dead camera, the one
 * flickering street lamp) and their tangled cables; the street sign with a box on top;
 * the festival bulbs and the sun-bleached banner; the sold-out vending machines; the poster
 * wall and the murals; the 2036 public notice; the torn Tamashi billboard; the CRT heads in
 * the fitting center's window; the dead hydrant, Mizuto's buckets and the puddles; Vine's
 * dent; the diner alley (dumpster, bags, kitchen door, Itamae's knife); Stonks's folding
 * table and its "assets"; the fans' bench; Disco's sake; the west barricade; rubble, crates,
 * bottles and curb litter. Collision boxes for the solid ones.
 * Must not: add lights (glow is emissive + bloom), place Japanese text (signage.ts owns it),
 * or touch buildings, cars, NPCs or interactables.
 *
 * Draw calls (measured, see the report): one merged vertex-coloured mesh for big solids
 * (casts shadows) and one for small ones, one SignAtlas, instanced bulbs, CRT screens and
 * litter, the puddles, one additive glow mesh and the lamp.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Collision } from "./collision";
import { surfaces, texture } from "./materials";
import { canvasTexture } from "./labels";
import { SignAtlas, type AtlasRect, type Draw } from "./signage";
import {
  BUYER_TABLE,
  CAST_SPOTS,
  CURB_HEIGHT,
  DINER_KITCHEN_DOOR,
  FAN_BENCH,
  FESTIVAL,
  HYDRANT,
  KNIFE_IN_BRICK,
  STREET,
  STREET_SIGN,
  UTILITY_POLES,
  VENDING,
  VENDING_SIZE,
  VINE_DENT,
  groundHeight,
} from "./layout";
import { Solids, compose, rng, sagCurve } from "./props/solids";
import * as art from "./props/art";

const G = CURB_HEIGHT;
/** Height of the pole tops (m above the sidewalk). */
const POLE_H = 9.4;
/** Fitting-center display window recess on its z 0 face (built by city.ts; local copy). */
const FITTING_WINDOW = { minX: -20, maxX: -12, sill: 0.6, top: 2.6, depth: 0.5 };
/** The fitting center's roof (billboard frame stands on it). */
const FITTING_ROOF = { x: -15.65, y: 8.5, front: 0 };
/** Banner across the street (x) and the notice board (x, against the north facade). */
const BANNER_X = -12.6;
const NOTICE_X = -11.5;
/** The west barricade line. */
const BARRICADE_X = -39.6;
/** Second vending cluster at the hotel end (clear of the camera pole at x -21.4 and the z 2.3 walkers). */
const VENDING_WEST = [
  { x: -21.62, z: 0.48 },
  { x: -20.52, z: 0.48 },
];
/** The tiny izakaya front at the back of the diner alley (alley-s-back wall, z 19.5, facing north). */
const IZAKAYA = { x: -19.95, z: 19.5 };
/** Stacked CRTs outside a TV repair counter on Stonks's block (south sidewalk, facing north). */
const REPAIR = { minX: -15.4, maxX: -13.2, z: 13 };
/** Manhole covers on the road. */
const MANHOLES: [number, number][] = [
  [-6.5, 6.6],
  [15.0, 4.9],
  [-30.5, 7.0],
  [27.5, 5.0],
];
/** Gutter grates (road edge). */
const GRATES: [number, number][] = [
  [10.5, 9.85],
  [-18.0, 3.15],
];
/** Outdoor AC units on walls: position of the unit's back face and the way it faces (rotY). */
const AC_UNITS: { x: number; y: number; z: number; rotY: number }[] = [
  { x: -17.5, y: G + 2.6, z: 14.2, rotY: -Math.PI / 2 },
  { x: -21.0, y: G + 3.3, z: 18.3, rotY: Math.PI / 2 },
  { x: 26.0, y: G + 2.8, z: -1.3, rotY: Math.PI / 2 },
  { x: 27.6, y: G + 3.1, z: -7.0, rotY: 0 },
  { x: -17.5, y: G + 4.2, z: 16.9, rotY: -Math.PI / 2 },
];

/**
 * Where steam puffs (read by the particles module): manholes, gutter grates, the diner's
 * kitchen exhaust, the izakaya's vent and the AC exhausts. `rate` ≈ relative puff rate.
 */
export const STEAM_VENTS: { x: number; y: number; z: number; rate?: number }[] = [
  ...MANHOLES.map(([x, z]) => ({ x, y: 0.03, z, rate: 1 })),
  ...GRATES.map(([x, z]) => ({ x, y: 0.02, z, rate: 0.6 })),
  { x: -20.55, y: G + 2.95, z: 17.4, rate: 1.6 },
  { x: IZAKAYA.x + 0.65, y: G + 2.75, z: IZAKAYA.z - 0.25, rate: 0.8 },
  ...AC_UNITS.map((a) => ({ x: a.x + Math.sin(a.rotY) * 0.35, y: a.y, z: a.z + Math.cos(a.rotY) * 0.35, rate: 0.35 })),
];

// Palette (sRGB).
const C = {
  concrete: "#9a978f",
  concreteDark: "#6f6c66",
  steel: "#4a4d4f",
  steelDark: "#2c2e30",
  rust: "#6e3a22",
  cable: "#141414",
  yellow: "#c9a227",
  black: "#1c1b1a",
  porcelain: "#c9c4b6",
  transformer: "#7d8582",
  wood: "#7a5a3a",
  woodDark: "#4e3a28",
  brick: "#8b4a37",
  cardboard: "#9c7a50",
};

type Glow = { x: number; y: number; z: number; w: number; d: number; color: string; strength: number; rotY?: number; vertical?: boolean };

interface AtlasItem {
  w: number;
  h: number;
  draw: Draw;
  lit: number;
  place: ((r: AtlasRect) => void)[];
}

export class StreetProps {
  readonly root = new THREE.Group();
  private readonly rand = rng(4242);
  private readonly big = new Solids(this.rand);
  private readonly small = new Solids(this.rand);
  /** Textured collectors (materials.ts `surfaces`; the textures agent upgrades them in place). */
  private readonly concrete = new Solids(this.rand);
  private readonly wood = new Solids(this.rand);
  private readonly corrugated = new Solids(this.rand);
  private readonly atlas = new SignAtlas("street-props", 2048, 2.4);
  private readonly atlasItems: AtlasItem[] = [];
  private readonly glows: Glow[] = [];
  private readonly cctv = art.cctvPlate();
  private readonly lanternText = art.lanternText();
  private vendWindows?: Draw[];
  private readonly low: boolean;

  private bulbs!: THREE.InstancedMesh;
  private bulbBase: THREE.Color[] = [];
  private bulbFlicker: number[] = [];
  private screens!: THREE.InstancedMesh;
  private screenBase: THREE.Color[] = [];
  private screenMats: THREE.Matrix4[] = [];
  private puddleSpots: [number, number, number, number, number][] = [];
  private lanterns: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  private noticeCanvas?: HTMLCanvasElement;
  private noticeTex?: THREE.CanvasTexture;
  private noticePage = -1;
  private lamp!: THREE.Mesh;
  private lampMat!: THREE.MeshBasicMaterial;
  private tmpColor = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly collision: Collision,
    opts: { low?: boolean } = {},
  ) {
    this.low = !!opts.low;
    this.root.name = "street-props";
    this.root.userData.keepDynamic = true; // already batched here; keep vertex colours intact

    this.poles();
    this.streetSign();
    this.festival();
    this.vending();
    this.posterWall();
    this.murals();
    this.notice();
    this.billboard();
    this.fittingWindow();
    this.hydrant();
    this.vineDent();
    this.dinerAlley();
    this.buyerTable();
    this.bench();
    this.sake();
    this.barricade();
    this.grunge();
    this.izakaya();
    this.crates();
    this.bikes();
    this.bollards();
    this.vents();
    this.repairStack();
    this.noticeScreen();
    this.cameras();
    this.gutterPuddles();
    this.litter();
    this.buildScreens();
    this.buildLanterns();
    this.buildPuddles();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: texture("grey_plaster_diff", true),
      normalMap: texture("grey_plaster_nor_gl"),
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.86,
      metalness: 0.05,
    });
    mat.name = "street-props:solid";
    const big = this.big.mesh(mat, "props:big");
    big.castShadow = true;
    big.receiveShadow = true;
    const small = this.small.mesh(mat, "props:small");
    small.receiveShadow = true;
    this.root.add(big, small);
    const textured: [Solids, THREE.Material, string, boolean][] = [
      [this.concrete, surfaces.concrete, "props:concrete", true],
      [this.wood, surfaces.woodWorn, "props:wood", false],
      [this.corrugated, surfaces.corrugated, "props:corrugated", true],
    ];
    for (const [s, m, name, cast] of textured) {
      if (!s.count) continue;
      const mesh = s.mesh(m, name);
      mesh.geometry.deleteAttribute("color");
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }

    for (const it of this.atlasItems.sort((a, b) => b.h - a.h)) {
      const r = this.atlas.add(it.w, it.h, it.draw, it.lit);
      it.place.forEach((p) => p(r));
    }
    this.root.add(this.atlas.build());
    this.buildGlows();
    scene.add(this.root);
  }

  // ───────────────────────── frame ─────────────────────────

  update(dt: number, elapsed: number) {
    void dt;
    // The one street lamp: mostly on, stutters in bursts, sometimes drops out.
    const burst = Math.sin(elapsed * 0.37) + Math.sin(elapsed * 1.13) > 1.1;
    const tick = Math.floor(elapsed * 14);
    const noise = fract(Math.sin(tick * 12.9898) * 43758.5453);
    const on = burst ? noise > 0.45 : noise > 0.03;
    const level = on ? (burst ? 0.5 + noise * 0.6 : 1) : 0.05;
    this.lampMat.color.setRGB(1.0 * level, 0.78 * level, 0.5 * level);

    // Public-notice screen: a new page every 5 s, with a brief roll between pages.
    if (this.noticeCanvas && this.noticeTex) {
      const page = Math.floor(elapsed / 5);
      if (page !== this.noticePage) {
        this.noticePage = page;
        const c = this.noticeCanvas.getContext("2d")!;
        art.noticeScreenPage(c, this.noticeCanvas.width, this.noticeCanvas.height, page);
        this.noticeTex.needsUpdate = true;
      }
      const into = elapsed % 5;
      this.noticeTex.offset.y = into < 0.25 && !this.low ? (0.25 - into) * 2 : 0;
    }
    if (this.low) return;

    // Festival bulbs: a few flicker, the rest hold steady.
    for (const i of this.bulbFlicker) {
      const n = fract(Math.sin(Math.floor(elapsed * 9 + i * 7.3) * 78.233 + i) * 43758.5453);
      const k = n > 0.25 ? 0.75 + n * 0.35 : 0.15;
      this.bulbs.setColorAt(i, this.tmpColor.copy(this.bulbBase[i]).multiplyScalar(k));
    }
    if (this.bulbFlicker.length && this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;

    // Standby CRT screens: a slow breathing pulse, one rolls and flickers.
    for (let i = 0; i < this.screenBase.length; i++) {
      let k = 0.75 + 0.25 * Math.sin(elapsed * (0.9 + i * 0.37) + i);
      if (i % 3 === 1) {
        const n = fract(Math.sin(Math.floor(elapsed * 11 + i) * 91.7) * 43758.5453);
        k = n > 0.3 ? 0.6 + n * 0.6 : 0.08;
      }
      this.screens.setColorAt(i, this.tmpColor.copy(this.screenBase[i]).multiplyScalar(k));
    }
    if (this.screens.instanceColor) this.screens.instanceColor.needsUpdate = true;
  }

  // ───────────────────────── helpers ─────────────────────────

  /** Queue a SignAtlas cell; `place` gets its rect once the atlas is packed. */
  private sign(w: number, h: number, draw: Draw, lit: number, ...place: ((r: AtlasRect) => void)[]) {
    const same = this.atlasItems.find((i) => i.draw === draw);
    if (same) same.place.push(...place);
    else this.atlasItems.push({ w, h, draw, lit, place });
  }
  /** A quad placement callback: centre, size, facing (rotY) and optional tilt. */
  private at(x: number, y: number, z: number, w: number, h: number, rotY = 0, euler?: THREE.Euler) {
    return (r: AtlasRect) => this.atlas.quad(r, w, h, new THREE.Vector3(x, y, z), rotY, euler);
  }
  /** A flat decal on the ground. */
  private onGround(x: number, z: number, w: number, d: number, rotY = 0, lift = 0.006) {
    return this.at(x, groundHeight(x, z) + lift, z, w, d, rotY, new THREE.Euler(-Math.PI / 2, 0, 0));
  }
  private solid(x: number, z: number, w: number, d: number, h: number) {
    this.collision.add({ x, z, w, d, h, tag: "prop" });
  }
  private r(a: number, b: number) {
    return a + (b - a) * this.rand();
  }

  // ───────────────────────── poles and cables ─────────────────────────

  private poles() {
    const s = this.big,
      t = this.small;
    const tops = new Map<number, THREE.Vector3[]>(); // pole index → cable attach points
    UTILITY_POLES.forEach((p, idx) => {
      const north = p.z < (STREET.roadNorth + STREET.roadSouth) / 2;
      const road = north ? 1 : -1; // +z toward the road from a north pole
      s.cyl(0.13, 0.175, POLE_H, p.x, G + POLE_H / 2, p.z, "#8a867d", 10);
      // Yellow/black guard sleeve at the base.
      for (let i = 0; i < 6; i++) t.cyl(0.182, 0.182, 0.3, p.x, G + 0.15 + i * 0.3, p.z, i % 2 ? C.black : C.yellow, 10);
      // Step bolts.
      for (let y = 2.6; y < POLE_H - 1; y += 0.45) t.box(0.34, 0.025, 0.025, p.x, G + y, p.z, C.steelDark, ((y * 2.22) | 0) % 2 ? 0 : Math.PI / 2, 0);
      // A faded address plate.
      t.box(0.24, 0.6, 0.02, p.x, G + 2.2, p.z + road * 0.17, "#6f8a9a");
      // Crossarms (along the street) with insulators.
      const arms = [
        { y: G + POLE_H - 0.6, len: 1.9 },
        { y: G + POLE_H - 1.35, len: 1.5 },
      ];
      const attach: THREE.Vector3[] = [];
      for (const a of arms) {
        s.box(a.len, 0.09, 0.1, p.x, a.y, p.z, C.steel);
        t.rod(new THREE.Vector3(p.x - a.len * 0.35, a.y - 0.04, p.z), new THREE.Vector3(p.x, a.y - 0.5, p.z), 0.018, C.steel);
        for (const off of [-0.42, -0.14, 0.14, 0.42].map((o) => o * a.len)) {
          t.cyl(0.035, 0.05, 0.13, p.x + off, a.y + 0.11, p.z, C.porcelain, 6);
          attach.push(new THREE.Vector3(p.x + off, a.y + 0.17, p.z));
        }
      }
      tops.set(idx, attach);
      if (p.transformer) {
        const tz = p.z - road * 0.42;
        s.cyl(0.27, 0.27, 0.9, p.x, G + 6.3, tz, C.transformer, 12);
        t.cyl(0.29, 0.29, 0.06, p.x, G + 6.78, tz, C.transformer, 12);
        for (const dy of [0.25, -0.25]) t.box(0.08, 0.06, 0.42, p.x, G + 6.3 + dy, p.z - road * 0.2, C.steelDark);
        for (const dx of [-0.1, 0.1]) {
          t.cyl(0.03, 0.04, 0.16, p.x + dx, G + 6.88, tz, C.porcelain, 6);
          t.tube([new THREE.Vector3(p.x + dx, G + 6.95, tz), new THREE.Vector3(p.x + dx * 3, G + 7.4, p.z - road * 0.15), new THREE.Vector3(p.x + dx * 4, attach[0].y, p.z)], 0.012, C.cable, 6, 3);
        }
        t.box(0.1, 0.5, 0.05, p.x + 0.12, G + 6.1, tz - road * 0.27, "#9a7b2a"); // warning tag
      }
      if (p.camera) {
        // Dead surveillance camera on a bracket, looking down the street to the west.
        this.camera(p.x, G + 4.6, p.z + road * 0.15, north ? 0 : Math.PI, -Math.PI / 2 + road * 0.35, false);
        t.tube([new THREE.Vector3(p.x, G + 4.5, p.z + road * 0.1), new THREE.Vector3(p.x - 0.05, G + 4.1, p.z + road * 0.3), new THREE.Vector3(p.x, G + 4.45, p.z + road * 0.5)], 0.012, C.cable, 8, 3);
      }
      if (p.lamp) {
        // Curved arm over the road and the lamp head; the glow lives in the lamp mesh.
        const base = new THREE.Vector3(p.x, G + 6.3, p.z);
        const pts = [base, new THREE.Vector3(p.x, G + 6.7, p.z + road * 0.5), new THREE.Vector3(p.x, G + 6.75, p.z + road * 1.3)];
        t.tube(pts, 0.045, C.steel, 8, 6);
        s.box(0.32, 0.12, 0.6, p.x, G + 6.7, p.z + road * 1.45, "#55595a");
      }
      this.solid(p.x, p.z, 0.36, 0.36, POLE_H);
    });

    // Cables along each curb, pole to pole: sagging, crossing, a few loose ones.
    const sides = [true, false].map((n) =>
      UTILITY_POLES.map((p, i) => ({ p, i }))
        .filter(({ p }) => p.z < 6.5 === n)
        .sort((a, b) => a.p.x - b.p.x),
    );
    const wob = () => (this.rand() - 0.5) * 0.25;
    for (const side of sides) {
      for (let k = 0; k < side.length - 1; k++) {
        const a = tops.get(side[k].i)!,
          b = tops.get(side[k + 1].i)!;
        const span = side[k + 1].p.x - side[k].p.x;
        for (let c = 0; c < a.length; c += c < 4 ? 1 : 2) {
          const sag = 0.25 + span * 0.025 + this.rand() * 0.35;
          this.small.tube(sagCurve(a[c], b[(c + (this.rand() < 0.3 ? 1 : 0)) % b.length], sag, 12, wob), 0.014, C.cable, 16, 3);
        }
        // Thick telecom bundle lower down.
        const pa = side[k].p,
          pb = side[k + 1].p;
        this.small.tube(sagCurve(new THREE.Vector3(pa.x, G + 6.9, pa.z), new THREE.Vector3(pb.x, G + 6.9, pb.z), 0.6 + span * 0.03, 12, wob), 0.03, C.cable, 16, 4);
      }
      // Off the ends: west into the dead street, east to the casino wall.
      const first = side[0].p,
        last = side[side.length - 1].p;
      this.small.tube(sagCurve(new THREE.Vector3(first.x, G + 7.9, first.z), new THREE.Vector3(-48, G + 7.2, first.z), 0.8, 10), 0.016, C.cable, 12, 3);
      this.small.tube(sagCurve(new THREE.Vector3(last.x, G + 7.9, last.z), new THREE.Vector3(STREET.casinoFront - 0.05, G + 7.0, last.z + 0.3), 0.4, 8), 0.016, C.cable, 10, 3);
    }
    // Service drops from each pole to the nearest facade, and across the street.
    UTILITY_POLES.forEach((p) => {
      const north = p.z < 6.5;
      const fz = north ? STREET.northFront + 0.05 : STREET.southFront - 0.05;
      let fx = p.x + this.r(-1.8, 1.8);
      if (!north && fx > 21 && fx < 29) fx = 20.6; // the rubble lot has no facade
      if (north && fx > 26 && fx < 29) fx = 25.7; // north alley mouth
      for (let k = 0; k < 2; k++) {
        const a = new THREE.Vector3(p.x, G + 7.2 - k * 0.5, p.z);
        const b = new THREE.Vector3(fx + k * 0.4, G + this.r(4.6, 5.8), fz);
        this.small.tube(sagCurve(a, b, 0.3 + this.rand() * 0.3, 8), 0.012, C.cable, 10, 3);
        this.small.box(0.12, 0.12, 0.08, b.x, b.y, fz, "#3a3836", 0, 0); // wall clamp
      }
    });
    const across: [number, number][] = [
      [-9.9, -3.4],
      [8.9, 12.4],
      [19.6, 21.3],
      [-35, -37],
    ];
    for (const [nx, sx] of across) {
      const a = new THREE.Vector3(nx, G + POLE_H - 0.9, 2.85),
        b = new THREE.Vector3(sx, G + POLE_H - 1.0, 10.15);
      this.small.tube(sagCurve(a, b, 0.7, 12), 0.016, C.cable, 14, 3);
      this.small.tube(sagCurve(a.clone().setY(a.y - 0.6), b.clone().setY(b.y - 0.5), 0.9, 12), 0.02, C.cable, 14, 3);
    }
  }

  // ───────────────────────── street sign ─────────────────────────

  private streetSign() {
    const { x, z } = STREET_SIGN;
    this.small.cyl(0.035, 0.035, 2.75, x, G + 1.375, z, "#8d9192", 8);
    this.small.box(0.92, 0.32, 0.04, x, G + 2.55, z, "#1c3d66", 0, 0);
    // The small box sitting on top of the sign (canon 2.2): a weathered tin box.
    this.small.box(0.2, 0.12, 0.14, x + 0.18, G + 2.775, z - 0.01, "#6c5a3c", 0.12, 0);
    this.small.box(0.21, 0.025, 0.15, x + 0.18, G + 2.845, z - 0.01, "#5a4a31", 0.12, 0);
    const d = art.streetPlate();
    this.sign(384, 128, d, 0, this.at(x, G + 2.55, z + 0.022, 0.9, 0.3, 0), this.at(x, G + 2.55, z - 0.022, 0.9, 0.3, Math.PI));
    this.solid(x, z, 0.12, 0.12, 2.8);
  }

  // ───────────────────────── festival ─────────────────────────

  private festival() {
    const nudge = (x: number, north: boolean) => {
      if (north && x > 26 && x < 29) return x < 27.5 ? 25.8 : 29.2;
      if (!north && x > -21 && x < -17.5) return x < -19.25 ? -21.2 : -17.3;
      if (!north && x > 21 && x < 29) return x < 25 ? 20.8 : 29.2;
      return x;
    };
    const anchors: THREE.Vector3[] = [];
    let north = true;
    for (let x = FESTIVAL.minX; x <= FESTIVAL.maxX + 0.01; x += 4.0) {
      const ax = Math.min(FESTIVAL.maxX, nudge(x, north));
      anchors.push(new THREE.Vector3(ax, FESTIVAL.height + this.r(-0.15, 0.15), north ? STREET.northFront + 0.12 : STREET.southFront - 0.12));
      north = !north;
    }
    const bulbs: { p: THREE.Vector3; c: THREE.Color; flicker: boolean }[] = [];
    const warm = new THREE.Color("#ffd28a");
    for (const a of anchors) {
      const face = a.z < 6.5 ? STREET.northFront : STREET.southFront;
      this.small.box(0.07, 0.9, 0.05, a.x, a.y - 0.35, face + (a.z < 6.5 ? 0.03 : -0.03), C.steelDark, 0, 0);
      this.small.box(0.05, 0.05, 0.14, a.x, a.y + 0.05, (a.z + face) / 2, C.steelDark, 0, 0);
    }
    for (let k = 0; k < anchors.length - 1; k++) {
      const a = anchors[k],
        b = anchors[k + 1];
      const pts = sagCurve(a, b, FESTIVAL.sag * this.r(0.85, 1.15), 16);
      this.small.tube(pts, 0.009, C.cable, 20, 3);
      const curve = new THREE.CatmullRomCurve3(pts);
      const len = curve.getLength();
      const n = Math.floor(len / 0.62);
      for (let i = 1; i < n; i++) {
        const p = curve.getPointAt(i / n);
        p.y -= 0.09;
        const roll = this.rand();
        const c =
          roll < 0.08
            ? new THREE.Color("#2a2520") // dead
            : roll < 0.16
              ? warm.clone().multiplyScalar(0.7) // dim
              : warm.clone().multiplyScalar(2.6 + this.rand() * 0.8);
        bulbs.push({ p, c, flicker: roll >= 0.16 && this.rand() < 0.06 });
      }
    }
    const geo = new THREE.IcosahedronGeometry(0.06, 1);
    geo.scale(1, 1.25, 1);
    const mat = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    mat.name = "props:bulbs";
    this.bulbs = new THREE.InstancedMesh(geo, mat, bulbs.length);
    this.bulbs.name = "props:bulbs";
    const m = new THREE.Matrix4();
    bulbs.forEach((b, i) => {
      this.bulbs.setMatrixAt(i, m.makeTranslation(b.p.x, b.p.y, b.p.z));
      this.bulbs.setColorAt(i, b.c);
      this.bulbBase.push(b.c);
      if (b.flicker) this.bulbFlicker.push(i);
    });
    this.bulbs.frustumCulled = false;
    this.root.add(this.bulbs);

    // Sun-bleached banner across the street on a rope between the facades.
    const y = 5.55;
    const ropeA = new THREE.Vector3(BANNER_X, y + 0.75, STREET.northFront + 0.1),
      ropeB = new THREE.Vector3(BANNER_X, y + 0.75, STREET.southFront - 0.1);
    this.small.tube(sagCurve(ropeA, ropeB, 0.35, 12), 0.012, "#5a5448", 14, 3);
    const d = art.festivalBanner();
    const tilt = new THREE.Euler(0, 0, 0);
    this.sign(768, 102, d, 0, this.at(BANNER_X + 0.012, y, 6.5, 7.4, 0.98, Math.PI / 2, tilt), this.at(BANNER_X - 0.012, y, 6.5, 7.4, 0.98, -Math.PI / 2, tilt));
  }

  // ───────────────────────── vending ─────────────────────────

  private vending() {
    this.vendingCluster(VENDING, ["#d6d3c8", "#a8443b", "#3d6684"], 70, true);
    this.vendingCluster(VENDING_WEST, ["#3f6e5a", "#d9d4c6"], 90, false);
  }

  private vendingCluster(list: { x: number; z: number }[], bodies: string[], seed: number, bins: boolean) {
    const { w, d, h } = VENDING_SIZE;
    const windows = (this.vendWindows ??= [art.vendingWindow(70), art.vendingWindow(71)]);
    list.forEach((v, i) => {
      const body = bodies[i % bodies.length];
      this.big.box(w, h - 0.05, d, v.x, G + 0.05 + (h - 0.05) / 2, v.z, body);
      this.small.box(w * 0.98, 0.05, d * 0.95, v.x, G + 0.025, v.z, "#1d1d1c");
      this.small.box(w + 0.02, 0.1, d + 0.04, v.x, G + h - 0.02, v.z, "#2a2b2c", 0, 0);
      const front = v.z + d / 2 + 0.006;
      this.sign(192, 225, windows[i % 2], 0.42, this.at(v.x, G + 1.27, front, w * 0.88, 0.95, 0));
      this.sign(192, 150, art.vendingPanel(body, seed + 10 + i), 0, this.at(v.x, G + 0.44, front, w * 0.88, 0.66, 0));
      // Side vents and a sticker-scarred top edge.
      for (const sx of [-1, 1]) this.small.box(0.01, 0.4, 0.5, v.x + sx * (w / 2 + 0.004), G + 0.35, v.z, "#262728", 0, 0);
    });
    const minX = list[0].x - w / 2,
      maxX = list[list.length - 1].x + w / 2;
    this.collision.addBounds(minX, list[0].z - d / 2, maxX, list[0].z + d / 2, h, "prop");
    if (bins) {
      // Two can bins beside the row.
      for (const bx of [minX - 0.28, maxX + 0.28]) {
        this.small.box(0.4, 0.75, 0.38, bx, G + 0.375, 0.32, "#cfcfc9");
        this.small.box(0.14, 0.1, 0.02, bx, G + 0.6, 0.512, "#151515", 0, 0);
      }
      this.solid(minX - 0.28, 0.32, 0.4, 0.38, 0.75);
      this.solid(maxX + 0.28, 0.32, 0.4, 0.38, 0.75);
    }
    // Cold-white light pool on the sidewalk and a haze on the wall around the fronts.
    const span = maxX - minX;
    this.glows.push({ x: (minX + maxX) / 2, y: G + 0.008, z: list[0].z + 1.1, w: span + 1.6, d: 2.4, color: "#cfe4ff", strength: 0.35 });
    this.glows.push({ x: (minX + maxX) / 2, y: G + 1.3, z: list[0].z + d / 2 + 0.02, w: span + 1.0, d: 1.6, color: "#cfe4ff", strength: 0.18, vertical: true });
  }

  // ───────────────────────── poster wall & murals ─────────────────────────

  private posterWall() {
    const z0 = STREET.northFront + 0.012;
    let layer = 0;
    const put = (draw: Draw, x: number, y: number, w: number, h: number, tilt = 0) => {
      const z = z0 + layer++ * 0.0022;
      this.sign(150, Math.round((150 * h) / w), draw, 0, this.at(x, y, z, w, h, 0, new THREE.Euler(0, 0, tilt)));
    };
    // Big NOZOMI lettering high on the wall.
    this.sign(720, 240, art.nozomiLettering(), 0, this.at(23, 6.35, z0, 5.5, 1.83, 0));
    // Seven years of bill-posting: layer after layer, torn, pasted over, crossed out.
    const gang = [art.posterGang(1), art.posterGang(2)],
      order = [art.posterOrder(3), art.posterOrder(4)],
      chaos = [art.posterChaos(5), art.posterChaos(6)],
      scrap = ["#c9bfa6", "#a7b4b0", "#c7a98d"].map((c, i) => art.posterScrap(100 + i, c));
    const all = [...scrap, ...scrap, ...order, ...chaos, ...gang];
    for (const y of [2.35, 3.2, 4.05, 4.75])
      for (let x = 20.45; x < 25.8; x += this.r(0.5, 0.7)) {
        const w = this.r(0.55, 0.8);
        put(all[Math.floor(this.rand() * all.length)], x + this.r(-0.08, 0.08), y + this.r(-0.15, 0.15), w, w * 1.41, this.r(-0.06, 0.06));
      }
    // The ones you read: Gang's crossed out, Order's, Chaos's.
    put(gang[0], 21.0, 3.3, 0.85, 1.2, 0.03);
    put(order[0], 22.15, 3.1, 0.85, 1.2, -0.02);
    put(chaos[0], 23.35, 3.45, 0.85, 1.2, 0.05);
    put(gang[1], 24.55, 3.85, 0.8, 1.13, -0.05);
    put(order[1], 25.45, 3.0, 0.75, 1.06, 0.04);
    put(chaos[1], 21.4, 4.6, 0.7, 0.99, -0.03);
    // Low, beside the vending row.
    for (const [x, y] of [[24.75, 0.75], [25.4, 0.9], [24.9, 1.6], [25.55, 1.75]]) put(all[Math.floor(this.rand() * all.length)], x, y, 0.6, 0.85, this.r(-0.08, 0.08));
    put(chaos[1], 25.2, 1.3, 0.72, 1.02, -0.04);
  }

  private murals() {
    const zS = STREET.southFront - 0.03;
    // Shuttered building (x 13 → 21, facing north): swirling night sky and the soup can.
    this.sign(560, 366, art.swirlSky(), 0, this.at(15.6, G + 1.75, zS, 4.6, 3.0, Math.PI));
    this.sign(256, 372, art.soupCan(), 0, this.at(19.5, G + 1.65, zS, 2.0, 2.9, Math.PI));
    // North alley (posters building's east wall at x 26, facing east): the cubist TV.
    this.sign(360, 294, art.cubistTV(), 0, this.at(26.03, G + 2.0, -3.6, 2.7, 2.2, Math.PI / 2));
    // Diner alley (Stonks's west wall at x -17.5, facing west): the stencil.
    this.sign(256, 256, art.stencilCord(), 0, this.at(-17.53, G + 2.1, 16.6, 1.3, 1.3, -Math.PI / 2));
  }

  private notice() {
    const x = NOTICE_X,
      z = STREET.northFront;
    this.wood.box(1.34, 1.04, 0.07, x, G + 1.6, z + 0.035, C.woodDark);
    this.small.box(1.46, 0.08, 0.16, x, G + 2.16, z + 0.08, "#3d3a35"); // little roof
    for (const dx of [-0.6, 0.6]) this.small.box(0.06, 1.7, 0.06, x + dx, G + 0.85, z + 0.05, C.steelDark);
    this.sign(400, 300, art.publicNotice(), 0, this.at(x, G + 1.6, z + 0.074, 1.2, 0.9, 0));
    this.sign(120, 164, art.posterScrap(120, "#d8d0bb"), 0, this.at(x + 0.45, G + 1.35, z + 0.078, 0.3, 0.41, 0, new THREE.Euler(0, 0, 0.12)));
  }

  private billboard() {
    const x = FITTING_ROOF.x,
      z = FITTING_ROOF.front - 1.3,
      y0 = FITTING_ROOF.y;
    const w = 7.2,
      h = 3.2,
      cy = y0 + 1.0 + h / 2;
    // Steel frame on the roof: two posts, bracing, a catwalk.
    for (const dx of [-2.7, 2.7]) {
      this.big.box(0.2, cy + h / 2 - y0 + 0.2, 0.2, x + dx, (y0 + cy + h / 2 + 0.2) / 2, z - 0.25, C.steelDark);
      this.small.rod(new THREE.Vector3(x + dx, y0, z - 1.6), new THREE.Vector3(x + dx, cy, z - 0.3), 0.05, C.steelDark);
    }
    this.small.box(w + 0.3, 0.12, 0.12, x, cy + h / 2 + 0.06, z - 0.08, C.steel);
    this.small.box(w + 0.3, 0.12, 0.12, x, cy - h / 2 - 0.06, z - 0.08, C.steel);
    this.small.box(w, 0.05, 0.7, x, cy - h / 2 - 0.2, z + 0.3, C.steelDark, 0, 0);
    this.small.box(w, h, 0.05, x, cy, z - 0.15, "#3a3936", 0, 0);
    // Paint, glow overlay and the hanging flap.
    this.sign(760, 338, art.billboard(), 0, this.at(x, cy, z, w, h, 0));
    this.sign(760, 338, art.billboardGlow(), 1, this.at(x, cy, z + 0.01, w, h, 0));
    this.sign(160, 204, art.billboardFlap(), 0, this.at(x + 0.9, cy - h / 2 - 0.45, z + 0.12, 0.9, 1.15, 0, new THREE.Euler(0.25, 0, -0.35)));
  }

  // ───────────────────────── fitting window ─────────────────────────

  private fittingWindow() {
    const fw = FITTING_WINDOW;
    const zc = STREET.northFront - fw.depth * 0.55;
    const colours = ["#cbbd9a", "#8d8f8c", "#c8692f", "#3f7f7a", "#d9d2bf", "#5a4a3c", "#a8a39a"];
    const tints = ["#7fe0ff", "#9cffd0", "#ffb070", "#7fe0ff", "#c8d8ff", "#7fe0ff", "#ffd0a0"];
    const screens = this.screenMats;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x = fw.minX + 0.6 + (i * (fw.maxX - fw.minX - 1.2)) / (n - 1);
      const size = 0.34 + (i % 3) * 0.05;
      const standH = i % 2 ? 0.55 : 0.25;
      const base = fw.sill;
      this.small.box(0.26, 0.04, 0.22, x, base + 0.02, zc, C.steelDark, 0, 0);
      this.small.cyl(0.025, 0.025, standH, x, base + standH / 2, zc, "#8d9192", 6, undefined, 0);
      const hy = base + standH + size * 0.42;
      const yaw = this.r(-0.25, 0.25);
      const head = new THREE.Group();
      head.position.set(x, hy, zc);
      head.rotation.y = yaw;
      head.updateMatrixWorld();
      const local = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyMatrix4(head.matrixWorld);
      const col = colours[i % colours.length];
      this.small.add(new THREE.BoxGeometry(size * 1.15, size * 0.85, size * 0.85), col, compose(x, hy, zc, yaw), 0);
      // Screen bezel, dome, antennas, side knobs.
      const front = local(0, 0, size * 0.43);
      this.small.add(new THREE.BoxGeometry(size * 0.95, size * 0.68, 0.02), "#1a1c1c", compose(front.x, front.y, front.z, yaw), 0);
      const dome = local(0, size * 0.42, 0);
      this.small.add(new THREE.SphereGeometry(size * 0.18, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), col, compose(dome.x, dome.y, dome.z, yaw), 0);
      for (const s of [-1, 1]) {
        const tip = local(s * size * 0.45, size * 1.05, -0.02);
        this.small.rod(dome, tip, 0.008, "#b9b9b3", 4, 0);
        this.small.add(new THREE.SphereGeometry(0.018, 6, 4), "#b9b9b3", compose(tip.x, tip.y, tip.z), 0);
      }
      const knob = local(size * 0.59, size * 0.1, 0.08);
      this.small.add(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8).rotateZ(Math.PI / 2), "#2a2a28", compose(knob.x, knob.y, knob.z, yaw), 0);
      const scr = local(0, 0, size * 0.43 + 0.012);
      screens.push(compose(scr.x, scr.y, scr.z, yaw, new THREE.Vector3(size * 0.82, size * 0.56, 1)));
      const dead = i === 4;
      this.screenBase.push(dead ? new THREE.Color("#0c1012") : new THREE.Color(tints[i]).multiplyScalar(1.6));
    }
    this.glows.push({ x: (fw.minX + fw.maxX) / 2, y: G + 0.008, z: 0.9, w: 8.5, d: 1.8, color: "#7fd8ff", strength: 0.12 });
  }

  // ───────────────────────── hydrant ─────────────────────────

  private hydrant() {
    const { x, z } = HYDRANT;
    const red = "#a3352a";
    this.big.cyl(0.13, 0.15, 0.62, x, G + 0.31, z, red, 10);
    this.small.cyl(0.19, 0.19, 0.06, x, G + 0.03, z, "#6a2a22", 10);
    this.small.add(new THREE.SphereGeometry(0.14, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), red, compose(x, G + 0.62, z), 0);
    this.small.cyl(0.03, 0.03, 0.06, x, G + 0.78, z, "#7a2a22", 6);
    for (const a of [0, Math.PI]) {
      const dx = Math.cos(a) * 0.17,
        dz = Math.sin(a) * 0.17;
      this.small.add(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 8).rotateZ(Math.PI / 2), "#8f2f26", compose(x + dx, G + 0.48, z + dz, a), 0);
    }
    this.solid(x, z, 0.4, 0.4, 0.8);
    // Plate on a post, facing west down the street.
    const px = x + 0.55,
      pz = z - 0.55;
    this.small.cyl(0.03, 0.03, 2.3, px, G + 1.15, pz, "#8d9192", 6);
    this.small.box(0.03, 0.5, 0.42, px - 0.035, G + 2.05, pz, "#7a1f19", 0, 0);
    this.sign(150, 180, art.hydrantPlate(), 0, this.at(px - 0.055, G + 2.05, pz, 0.4, 0.48, -Math.PI / 2));
    this.solid(px, pz, 0.1, 0.1, 2.3);
    // Mizuto's buckets (one tipped over).
    const buckets: [number, number, string, boolean][] = [
      [x - 0.5, z - 0.35, "#8f9596", false],
      [x - 0.62, z + 0.25, "#2f6fa3", false],
      [x + 0.45, z + 0.45, "#b9a23a", false],
      [x - 0.15, z + 0.62, "#a03b2f", true],
      [x + 0.5, z - 0.15, "#8f9596", false],
    ];
    for (const [bx, bz, col, tipped] of buckets) {
      if (tipped) {
        this.small.add(new THREE.CylinderGeometry(0.15, 0.12, 0.28, 10, 1, true), col, compose(bx, G + 0.14, bz, new THREE.Euler(0, 0.6, Math.PI / 2)), 0);
      } else {
        this.small.add(new THREE.CylinderGeometry(0.15, 0.12, 0.28, 10, 1, true), col, compose(bx, G + 0.14, bz), 0);
        this.small.cyl(0.12, 0.12, 0.01, bx, G + 0.005, bz, col, 10, undefined, 0);
        this.small.cyl(0.135, 0.135, 0.01, bx, G + 0.21, bz, "#1b2226", 10, undefined, 0); // water
        this.small.add(new THREE.TorusGeometry(0.15, 0.006, 4, 10, Math.PI).rotateY(this.rand() * 3), "#5a5a58", compose(bx, G + 0.28, bz), 0);
      }
    }
    // Puddles around the hydrant and the buckets.
    this.puddleSpots.push(...[
      [x - 0.4, z + 0.3, 1.0, 0.55, 0.3],
      [x + 0.25, z - 0.5, 0.7, 0.5, 1.2],
      [x - 1.1, z - 0.2, 0.55, 0.35, 2.0],
      [STREET.roadEast - 0.6, z + 1.2, 0.9, 0.45, 0.4],
      [x + 0.3, z + 1.1, 0.6, 0.4, 2.6],
    ] as [number, number, number, number, number][]);
  }

  private buildPuddles() {
    const spots = this.puddleSpots;
    const feather = canvasTexture(128, 128, art.radial([[0, "#fff"], [0.55, "#fff"], [1, "#000"]]));
    feather.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshStandardMaterial({
      color: "#0a0e12",
      roughness: 0.03,
      metalness: 0.35,
      transparent: true,
      opacity: 0.8,
      alphaMap: feather,
      depthWrite: false,
      envMapIntensity: 1.2,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    mat.name = "props:puddles";
    const geos = spots.map(([x, z, rx, rz, rot]) => {
      const g = new THREE.CircleGeometry(1, 20);
      g.rotateX(-Math.PI / 2);
      g.scale(rx, 1, rz);
      g.rotateY(rot);
      g.translate(x, groundHeight(x, z) + 0.008, z);
      return g;
    });
    const s = new Solids(this.rand);
    geos.forEach((g) => s.add(g, "#ffffff", new THREE.Matrix4(), 0, 0));
    const mesh = s.mesh(mat, "props:puddles");
    // Keep the circle UVs (feathering), not world UVs.
    const uv = mesh.geometry.getAttribute("uv");
    const pos = mesh.geometry.getAttribute("position");
    let vi = 0;
    for (const [x, z, rx, rz, rot] of spots) {
      const cos = Math.cos(-rot),
        sin = Math.sin(-rot);
      for (let k = 0; k < 20 * 3; k++, vi++) {
        const dx = pos.getX(vi) - x,
          dz = pos.getZ(vi) - z;
        const lx = (dx * cos - dz * sin) / rx,
          lz = (dx * sin + dz * cos) / rz;
        uv.setXY(vi, 0.5 + lx * 0.5, 0.5 - lz * 0.5);
      }
    }
    mesh.geometry.deleteAttribute("color");
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    this.root.add(mesh);
  }

  // ───────────────────────── Vine's dent ─────────────────────────

  private vineDent() {
    const { x, z } = VINE_DENT;
    this.sign(320, 320, art.dentCracks(), 0, this.onGround(x, z, 2.4, 2.4, 0.4, 0.007));
    for (let i = 0; i < 9; i++) {
      const a = this.rand() * Math.PI * 2,
        r = this.r(0.18, 0.42);
      this.small.add(new THREE.BoxGeometry(this.r(0.08, 0.18), 0.04, this.r(0.06, 0.14)), C.concreteDark, compose(x + Math.cos(a) * r, G + 0.015, z + Math.sin(a) * r, new THREE.Euler(this.r(-0.3, 0.3), a, this.r(-0.3, 0.3))), 0.3);
    }
  }

  // ───────────────────────── diner alley ─────────────────────────

  private dinerAlley() {
    // Dumpster against Stonks's west wall at the back of the alley.
    const dx = -18.15,
      dz = 18.55;
    this.big.box(1.0, 1.0, 1.75, dx, G + 0.6, dz, "#2f4a3c");
    this.small.box(1.06, 0.06, 1.8, dx, G + 1.1, dz, "#26392f", 0, 0);
    this.small.add(new THREE.BoxGeometry(0.06, 0.06, 1.7), "#253529", compose(dx + 0.52, G + 1.04, dz), 0);
    this.small.add(new THREE.BoxGeometry(1.0, 0.04, 0.85), "#20302a", compose(dx - 0.05, G + 1.32, dz - 0.42, new THREE.Euler(0, 0, 0.5)), 0);
    for (const [ox, oz] of [[-0.4, -0.75], [0.4, -0.75], [-0.4, 0.75], [0.4, 0.75]]) this.small.cyl(0.05, 0.05, 0.04, dx + ox, G + 0.07, dz + oz, C.black, 6, new THREE.Euler(Math.PI / 2, 0, 0));
    this.collision.addBounds(dx - 0.52, dz - 0.9, -17.5, dz + 0.9, 1.3, "prop");
    // Trash bags.
    const bags: [number, number, string][] = [
      [-18.4, 17.35, "#18191b"],
      [-17.95, 17.45, "#3a4a5e"],
      [-18.2, 17.0, "#1d1e20"],
      [-18.95, 17.25, "#18191b"],
      [-20.65, 17.75, "#45566a"],
    ];
    for (const [bx, bz, col] of bags) this.small.rock(0.3, bx, G + 0.2, bz, col, new THREE.Vector3(1, 0.75, 0.9), 1, 0.2);
    // Kitchen door on the diner's east wall, facing east, with a noren and the STAFF ONLY plate.
    const { x: kx, z: kz } = DINER_KITCHEN_DOOR;
    this.small.box(0.05, 2.1, 1.0, kx + 0.025, G + 1.05, kz, "#3e3f3b", 0, 0.6);
    this.small.box(0.07, 2.2, 0.07, kx + 0.035, G + 1.1, kz - 0.53, "#2a2b29", 0, 0);
    this.small.box(0.07, 2.2, 0.07, kx + 0.035, G + 1.1, kz + 0.53, "#2a2b29", 0, 0);
    this.small.box(0.08, 0.08, 1.14, kx + 0.04, G + 2.2, kz, "#2a2b29", 0, 0);
    this.small.rod(new THREE.Vector3(kx + 0.12, G + 2.12, kz - 0.55), new THREE.Vector3(kx + 0.12, G + 2.12, kz + 0.55), 0.012, C.wood, 5, 0);
    this.sign(200, 160, art.noren(), 0, this.at(kx + 0.13, G + 1.75, kz, 0.95, 0.75, Math.PI / 2));
    this.sign(300, 112, art.staffOnlyPlate(), 0, this.at(kx + 0.055, G + 1.05, kz, 0.48, 0.18, Math.PI / 2));
    // Step and a stack of plastic crates by the door.
    this.concrete.box(0.4, 0.12, 1.1, kx + 0.2, G + 0.06, kz, C.concreteDark);
    // Itamae's knife, lodged in a brick at head height.
    const k = KNIFE_IN_BRICK;
    this.small.box(0.11, 0.03, 0.026, k.x + 0.075, k.y, k.z, "#4a3020", 0, 0);
    this.small.box(0.02, 0.034, 0.03, k.x + 0.015, k.y, k.z, "#9a9a96", 0, 0);
    this.small.box(0.02, 0.032, 0.004, k.x + 0.003, k.y, k.z, "#c8c8c4", 0, 0);
    this.sign(128, 128, art.brickCrack(), 0, this.at(k.x + 0.004, k.y, k.z, 0.3, 0.3, Math.PI / 2));
  }

  // ───────────────────────── Stonks's table ─────────────────────────

  private buyerTable() {
    const t = BUYER_TABLE;
    const top = G + 0.74;
    this.small.box(t.w, 0.035, t.d, t.x, top - 0.018, t.z, "#c9c3b4");
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) this.small.rod(new THREE.Vector3(t.x + sx * (t.w / 2 - 0.08), G, t.z + sz * (t.d / 2 - 0.06)), new THREE.Vector3(t.x + sx * (t.w / 2 - 0.08), top - 0.03, t.z + sz * (t.d / 2 - 0.06)), 0.014, "#7b7f80", 5, 0.4);
    this.small.rod(new THREE.Vector3(t.x - t.w / 2 + 0.08, G + 0.3, t.z), new THREE.Vector3(t.x + t.w / 2 - 0.08, G + 0.3, t.z), 0.01, "#7b7f80", 5, 0);
    this.solid(t.x, t.z, t.w, t.d, 0.8);
    const front = t.z - t.d / 2; // the street side (north)
    // Cans: a pyramid of NOZOMI SOUP and a row of other tins.
    const soup = "#d4692a";
    const cans: [number, number, number, string][] = [];
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 3 - row; i++) cans.push([t.x - 0.72 + i * 0.08 + row * 0.04, top + 0.05 + row * 0.1, front + 0.14, soup]);
    for (let i = 0; i < 4; i++) cans.push([t.x - 0.38 + (i % 2) * 0.08, top + 0.05 + Math.floor(i / 2) * 0.1, front + 0.26 + (i % 2) * 0.02, ["#8f9596", "#4f6b3a", "#b3a26a", "#8f9596"][i]]);
    for (const [cx, cy, cz, col] of cans) this.small.cyl(0.036, 0.036, 0.098, cx, cy, cz, col, 10, undefined, 0);
    const label = art.soupLabel();
    const labels = [0, 1, 2].map((i) => this.at(t.x - 0.72 + i * 0.08, top + 0.05, front + 0.14 - 0.037, 0.06, 0.06, Math.PI));
    labels.push(this.at(t.x - 0.68, top + 0.15, front + 0.14 - 0.037, 0.06, 0.06, Math.PI));
    this.sign(96, 96, label, 0, ...labels);
    // A crate of records.
    const cx = t.x + 0.05,
      cz = t.z + 0.02;
    this.wood.box(0.38, 0.22, 0.36, cx, top + 0.11, cz, C.wood);
    const sleeves = ["#2b2b2b", "#c84a2f", "#e3d6b4", "#3a6b8f", "#6d3a5a", "#d9b23a", "#1f4a3a", "#9a9a9a", "#b0302a", "#2f2f45"];
    sleeves.forEach((col, i) => this.small.box(0.31, 0.31, 0.006, cx, top + 0.17, cz - 0.15 + i * 0.03, col, new THREE.Euler(-0.08 + this.r(-0.04, 0.04), 0, 0), 0));
    // The cash tin, lid ajar.
    const tx = t.x + 0.5;
    this.small.box(0.26, 0.08, 0.18, tx, top + 0.04, t.z + 0.05, "#55665a");
    this.small.add(new THREE.BoxGeometry(0.27, 0.015, 0.19), "#5f7064", compose(tx, top + 0.1, t.z + 0.14, new THREE.Euler(0.55, 0, 0)), 0);
    // A few loose records and a jar.
    this.small.cyl(0.155, 0.155, 0.004, t.x + 0.42, top + 0.002, t.z - 0.15, "#111111", 16, undefined, 0);
    this.small.cyl(0.05, 0.05, 0.004, t.x + 0.42, top + 0.006, t.z - 0.15, "#c84a2f", 10, undefined, 0);
    this.small.cyl(0.05, 0.045, 0.14, t.x + 0.74, top + 0.07, t.z + 0.12, "#8a7d55", 8, undefined, 0);
    // Hand-lettered BUYING card on the table front, and TOP PRICES propped up on top.
    this.sign(400, 200, art.buyingCard(), 0, this.at(t.x, G + 0.5, front - 0.012, 0.92, 0.46, Math.PI, new THREE.Euler(0, 0, 0.03)));
    this.sign(256, 128, art.topPricesCard(), 0, this.at(t.x + 0.62, top + 0.12, front + 0.12, 0.36, 0.18, Math.PI, new THREE.Euler(-0.25, 0, 0)));
  }

  // ───────────────────────── bench, sake ─────────────────────────

  private bench() {
    const b = FAN_BENCH;
    const seatY = G + 0.44;
    for (let i = 0; i < 3; i++) this.wood.box(b.w, 0.04, 0.12, b.x, seatY, b.z - 0.15 + i * 0.14, C.wood, 0, 0.3);
    for (let i = 0; i < 2; i++) this.wood.box(b.w, 0.1, 0.035, b.x, seatY + 0.2 + i * 0.16, b.z + 0.27, C.wood, new THREE.Euler(-0.15, 0, 0), 0);
    for (const sx of [-1, 1]) {
      this.concrete.box(0.12, 0.42, 0.5, b.x + sx * (b.w / 2 - 0.15), G + 0.21, b.z, C.concreteDark);
      this.small.box(0.06, 0.45, 0.05, b.x + sx * (b.w / 2 - 0.15), seatY + 0.22, b.z + 0.28, C.steelDark, 0, 0);
    }
    this.solid(b.x, b.z, b.w, b.d, 0.5);
  }

  private sake() {
    // Disco's isshōbin and cups on the curb between band2 and band3 (no collision).
    const bx = 31.13,
      bz = 6.28;
    const gy = groundHeight(bx, bz);
    this.small.cyl(0.05, 0.05, 0.27, bx, gy + 0.135, bz, "#3b2a14", 10, undefined, 0);
    this.small.cyl(0.02, 0.05, 0.07, bx, gy + 0.305, bz, "#3b2a14", 10, undefined, 0);
    this.small.cyl(0.017, 0.017, 0.07, bx, gy + 0.37, bz, "#3b2a14", 8, undefined, 0);
    this.small.cyl(0.019, 0.019, 0.02, bx, gy + 0.41, bz, "#c9c2b0", 8, undefined, 0);
    this.small.box(0.07, 0.12, 0.005, bx - 0.045, gy + 0.14, bz, "#e6dcc4", Math.PI / 2, 0); // blank paper label
    for (const [cx, cz] of [[31.22, 6.45], [31.08, 6.08], [31.28, 6.2]]) this.small.cyl(0.028, 0.02, 0.035, cx, groundHeight(cx, cz) + 0.018, cz, "#e9e4d8", 8, undefined, 0);
    void CAST_SPOTS;
  }

  // ───────────────────────── barricade ─────────────────────────

  private barricade() {
    const x = BARRICADE_X;
    // Jersey blocks on both sidewalks and in the middle of the road.
    const jersey = (z: number, len: number, rot = 0) => {
      const gy = groundHeight(x, z);
      this.concrete.box(0.6, 0.25, len, x, gy + 0.125, z, C.concrete, rot);
      this.concrete.box(0.32, 0.55, len, x, gy + 0.52, z, C.concrete, rot);
      this.small.box(0.34, 0.06, len * 0.98, x, gy + 0.82, z, "#b23a2a", rot, 0);
    };
    jersey(1.2, 1.9, 0.04);
    jersey(2.4, 0.8, -0.1);
    jersey(11.3, 2.1, -0.03);
    jersey(6.5, 1.6, 0.06);
    // Sawhorses across the road with striped top bars.
    const sawhorse = (z0: number, z1: number) => {
      for (const zz of [z0 + 0.15, z1 - 0.15])
        for (const s of [-1, 1]) this.small.rod(new THREE.Vector3(x + s * 0.35, 0, zz), new THREE.Vector3(x, 1.0, zz), 0.03, "#8a8d8e", 5, 0.6);
      const n = Math.round((z1 - z0) / 0.3);
      for (let i = 0; i < n; i++) this.small.box(0.06, 0.18, (z1 - z0) / n, x, 0.92, z0 + ((i + 0.5) * (z1 - z0)) / n, i % 2 ? "#e2ddd2" : "#c7372b", 0, 0);
      for (let i = 0; i < n; i++) this.small.box(0.06, 0.14, (z1 - z0) / n, x, 0.5, z0 + ((i + 0.5) * (z1 - z0)) / n, i % 2 ? C.black : C.yellow, 0, 0);
    };
    sawhorse(3.2, 5.6);
    sawhorse(7.4, 9.8);
    // KEEP OUT board on the north sawhorse, tape along the whole line.
    this.sign(400, 200, art.keepOutBoard(), 0, this.at(x + 0.05, 0.75, 4.4, 1.2, 0.6, Math.PI / 2), this.at(x - 0.05, 0.75, 4.4, 1.2, 0.6, -Math.PI / 2));
    const tape = art.keepOutTape();
    const tapes: ((r: AtlasRect) => void)[] = [];
    for (let z = 0.3; z < 12.7; z += 3.1) tapes.push(this.at(x + 0.17, 1.08 + this.r(-0.06, 0.06), z + 1.55, 3.1, 0.07, Math.PI / 2, new THREE.Euler(0, 0, this.r(-0.03, 0.03))));
    this.sign(640, 26, tape, 0, ...tapes);
    this.collision.addBounds(BARRICADE_X - 0.4, STREET.northFront, BARRICADE_X + 0.35, STREET.southFront, 1.1, "prop");
  }

  // ───────────────────────── grunge ─────────────────────────

  private grunge() {
    const greys = ["#8a8780", "#77746d", "#9c988f", "#6a665f"];
    const bricks = ["#8b4a37", "#7a3f30", "#9c5a43", "#6e3a2c"];
    // Rubble piles in the lot (x 21 → 29, z 13 → 19.5).
    const piles: [number, number, number, boolean][] = [
      [23.2, 16.4, 1.5, true],
      [27.0, 17.9, 1.25, true],
      [27.8, 14.4, 0.7, false],
      [22.0, 18.7, 0.8, false],
    ];
    for (const [px, pz, pr, solid] of piles) {
      const n = Math.round(pr * 34);
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2,
          d = Math.sqrt(this.rand()) * pr;
        const hgt = (1 - d / pr) * pr * 0.55;
        const size = this.r(0.08, 0.3) * (0.6 + (1 - d / pr) * 0.6);
        const col = this.rand() < 0.4 ? bricks[i % 4] : greys[i % 4];
        this.small.rock(size, px + Math.cos(a) * d, G + hgt * this.r(0.6, 1) + size * 0.3, pz + Math.sin(a) * d, col, new THREE.Vector3(1, this.r(0.5, 0.9), 1), 0, 0.5);
      }
      if (solid) this.solid(px, pz, pr * 1.3, pr * 1.3, pr * 0.6);
    }
    // A tilted slab with rebar.
    this.concrete.box(1.3, 0.14, 0.9, 25.1, G + 0.35, 15.2, C.concreteDark, new THREE.Euler(0.15, 0.4, 0.35));
    for (let i = 0; i < 4; i++) this.small.rod(new THREE.Vector3(25.5 + i * 0.08, G + 0.5, 15.0 + i * 0.1), new THREE.Vector3(25.9 + i * 0.1, G + 0.9 + i * 0.1, 14.9 + i * 0.12), 0.01, C.rust, 4, 0);
    this.solid(25.1, 15.2, 1.3, 1.0, 0.6);
    // Rusty corrugated sheets leaning on the lot's back wall, one fallen flat.
    for (let i = 0; i < 4; i++) {
      const sx = 22.0 + i * 0.75 + this.r(-0.1, 0.1);
      this.corrugated.add(corrugatedSheet(0.9, 2.1), "#ffffff", compose(sx, G + 1.0, 19.15, new THREE.Euler(-0.28, Math.PI + this.r(-0.08, 0.08), this.r(-0.06, 0.06), "YXZ")), 0);
    }
    this.corrugated.add(corrugatedSheet(0.9, 2.1), "#ffffff", compose(26.2, G + 0.05, 16.3, new THREE.Euler(-Math.PI / 2 + 0.06, 0.7, 0, "YXZ")), 0);
    this.solid(23.2, 19.05, 3.3, 0.5, 2.0);
    // Broken bricks scattered across the lot and toward the sidewalk.
    for (let i = 0; i < 40; i++) {
      const bx = this.r(21.3, 28.7),
        bz = this.r(13.2, 19.3);
      this.small.box(0.22, 0.07, 0.1, bx, G + 0.035, bz, bricks[i % 4], new THREE.Euler(this.r(-0.2, 0.2), this.rand() * 3.14, 0), 0.4);
    }
    // Gutter by the scorched building: broken bottles and rags (clear of the sedan's swing spot).
    for (let i = 0; i < 16; i++) {
      let gx = this.r(-2.7, 12.8);
      if (gx > 2.6 && gx < 6.4) gx += 4;
      const gz = this.r(10.05, 10.35);
      if (Math.abs(gx + 3.4) < 0.4) continue; // the pole
      if (i % 3 === 0) {
        this.small.add(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 7), i % 2 ? "#2f5a33" : "#5a3a1a", compose(gx, G + 0.035, gz, new THREE.Euler(0, this.rand() * 3, Math.PI / 2)), 0);
      } else if (i % 3 === 1) {
        for (let k = 0; k < 4; k++) this.small.add(new THREE.TetrahedronGeometry(this.r(0.02, 0.045)), i % 2 ? "#3c6a40" : "#6a4a22", compose(gx + this.r(-0.15, 0.15), G + 0.01, gz + this.r(-0.06, 0.06), new THREE.Euler(this.rand() * 3, this.rand() * 3, 0), new THREE.Vector3(1, 0.3, 1)), 0);
      } else {
        this.small.add(new THREE.BoxGeometry(this.r(0.2, 0.4), 0.025, this.r(0.12, 0.25)), ["#3a3530", "#5a4f45", "#2c2a2e"][i % 3], compose(gx, G + 0.013, gz, new THREE.Euler(this.r(-0.1, 0.1), this.rand() * 3, this.r(-0.1, 0.1))), 0);
      }
    }
    // North alley (x 26 → 29, z -7 → 0): crates and pallets along the east side.
    const crates: [number, number, number, number][] = [
      [28.45, -5.9, 0, 0.1],
      [28.4, -5.15, 0, -0.08],
      [28.42, -5.5, 1, 0.2],
      [28.5, -6.55, 0, 0.05],
    ];
    for (const [cx, cz, lvl, rot] of crates) {
      const y = G + 0.3 + lvl * 0.6;
      this.wood.box(0.66, 0.6, 0.62, cx, y, cz, lvl ? C.woodDark : C.wood, rot);
      this.wood.box(0.68, 0.06, 0.64, cx, y + 0.18, cz, C.woodDark, rot, 0);
    }
    this.collision.addBounds(28.0, -6.95, 28.95, -4.8, 1.2, "prop");
    for (let i = 0; i < 3; i++) {
      // Pallets leaning on the casino wing's wall.
      const pz = -3.6 + i * 0.25;
      const tilt = new THREE.Euler(0, 0, 0.25);
      for (let k = 0; k < 5; k++) this.wood.add(new THREE.BoxGeometry(0.03, 1.2, 0.1), C.wood, compose(28.75 - i * 0.05, G + 0.6, pz - 0.5 + k * 0.25, tilt), 0.6);
      for (const yy of [0.1, 0.6, 1.1]) this.wood.add(new THREE.BoxGeometry(0.08, 0.08, 1.2), C.woodDark, compose(28.72 - i * 0.05 + (yy - 0.6) * 0.25, G + yy, pz, tilt), 0.6);
    }
    this.solid(28.7, -3.35, 0.5, 1.4, 1.2);
  }

  /** Paper scraps, leaves and receipts along the curbs (instanced, no collision). */
  private litter() {
    const n = this.low ? 300 : 950;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide });
    mat.name = "props:litter";
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = "props:litter";
    mesh.receiveShadow = true;
    const papers = ["#d8d2c0", "#bdb6a2", "#e6e1d2", "#a9a08a", "#c9c0aa"];
    const leaves = ["#7a5a2a", "#8d6a30", "#5e4422", "#a07a3a", "#6b4f2a"];
    const bands: [number, number, number][] = [
      // z range, weight
      [2.6, 3.0, 3],
      [3.0, 3.45, 4],
      [9.55, 10.0, 4],
      [10.0, 10.4, 3],
      [0.05, 0.45, 1.5],
      [12.55, 12.95, 1.5],
      [3.5, 9.5, 1],
    ];
    const total = bands.reduce((s, b) => s + b[2], 0);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      let pick = this.rand() * total,
        band = bands[0];
      for (const b of bands) {
        pick -= b[2];
        if (pick <= 0) {
          band = b;
          break;
        }
      }
      const x = this.r(-39.3, STREET.roadEast - 0.3),
        z = this.r(band[0], band[1]);
      const leaf = this.rand() < 0.55;
      const sx = leaf ? this.r(0.04, 0.09) : this.r(0.05, 0.16);
      const sz = leaf ? sx * this.r(0.5, 0.8) : sx * this.r(0.5, 1.4);
      const rot = new THREE.Euler(this.r(-0.25, 0.25), this.rand() * Math.PI * 2, this.r(-0.25, 0.25));
      m.copy(compose(x, groundHeight(x, z) + 0.006, z, rot, new THREE.Vector3(sx, 1, sz)));
      mesh.setMatrixAt(i, m);
      const col = new THREE.Color(leaf ? leaves[i % 5] : papers[i % 5]);
      mesh.setColorAt(i, col.multiplyScalar(leaf ? 0.75 : 0.42));
    }
    this.root.add(mesh);
  }

  // ───────────────────────── back-street density ─────────────────────────

  /** A dead surveillance camera on a bracket: wall/pole point (x, y, z), bracket along nYaw, lens toward lookYaw. */
  private camera(x: number, y: number, z: number, nYaw: number, lookYaw: number, plate = true) {
    const t = this.small;
    const nx = Math.sin(nYaw),
      nz = Math.cos(nYaw);
    t.box(0.14, 0.14, 0.04, x + nx * 0.02, y, z + nz * 0.02, C.steelDark, nYaw, 0);
    t.rod(new THREE.Vector3(x, y, z), new THREE.Vector3(x + nx * 0.38, y - 0.05, z + nz * 0.38), 0.025, C.steelDark, 5, 0);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, lookYaw, 0, "YXZ"));
    const c = new THREE.Vector3(x + nx * 0.42, y - 0.15, z + nz * 0.42);
    const off = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(c);
    const m = (p: THREE.Vector3) => new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
    t.add(new THREE.BoxGeometry(0.17, 0.16, 0.4), "#bdb8ae", m(c), 0);
    t.add(new THREE.BoxGeometry(0.23, 0.025, 0.5), "#8f8b83", m(off(0, 0.095, 0.04)), 0);
    t.add(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 8).rotateX(Math.PI / 2), "#0b0c0d", m(off(0, 0, 0.21)), 0);
    if (plate) this.sign(256, 88, this.cctv, 0, this.at(x + nx * 0.012, y - 0.42, z + nz * 0.012, 0.38, 0.13, nYaw));
  }

  private cameras() {
    this.camera(-22.4, G + 4.2, STREET.northFront, 0, 0.9); // hotel corner, watching the hotel door
    this.camera(19.7, G + 3.7, STREET.northFront, 0, 0.35); // TriMart, over the vending row
    this.camera(STREET.casinoFront, G + 4.4, 1.6, -Math.PI / 2, -Math.PI / 2 - 0.35); // casino end wall
    this.camera(-17.5, G + 3.3, 13.8, -Math.PI / 2, -0.7); // diner alley mouth
    this.camera(4.5, G + 3.9, STREET.southFront, Math.PI, Math.PI - 0.5); // scorched front, over the sedan
  }

  /** The tiny izakaya at the back of the diner alley: lattice door, noren, lanterns, awning. */
  private izakaya() {
    const { x, z } = IZAKAYA;
    const zf = z - 0.03;
    // Wooden frame and lattice over a warm paper screen.
    this.wood.box(1.7, 0.12, 0.12, x, G + 2.1, zf - 0.04, C.woodDark);
    for (const dx of [-0.8, 0.8]) this.wood.box(0.12, 2.1, 0.12, x + dx, G + 1.05, zf - 0.04, C.woodDark);
    for (let i = 0; i < 13; i++) this.wood.box(0.025, 1.95, 0.03, x - 0.72 + i * 0.12, G + 1.0, zf - 0.07, C.wood, 0, 0.4);
    for (const yy of [0.5, 1.1, 1.6]) this.wood.box(1.5, 0.025, 0.03, x, G + yy, zf - 0.07, C.wood, 0, 0.4);
    this.small.box(1.5, 1.95, 0.01, x, G + 1.0, zf - 0.02, "#e8d6b0", 0, 0.5);
    this.glows.push({ x, y: G + 1.1, z: zf - 0.09, w: 2.6, d: 2.4, color: "#ffb070", strength: 0.55, vertical: true, rotY: Math.PI });
    this.glows.push({ x, y: G + 0.01, z: zf - 1.0, w: 3.0, d: 2.0, color: "#ff9a50", strength: 0.3 });
    // Noren on a rod, corrugated awning, vent duct.
    this.small.rod(new THREE.Vector3(x - 0.75, G + 2.02, zf - 0.16), new THREE.Vector3(x + 0.75, G + 2.02, zf - 0.16), 0.012, C.wood, 5, 0);
    this.sign(256, 128, art.izakayaNoren(), 0, this.at(x, G + 1.72, zf - 0.17, 1.4, 0.6, Math.PI));
    this.corrugated.add(corrugatedSheet(2.2, 0.85), "#ffffff", compose(x, G + 2.45, zf - 0.38, new THREE.Euler(-Math.PI / 2 + 0.35, Math.PI, 0, "YXZ")), 0);
    for (const dx of [-1.0, 1.0]) this.small.rod(new THREE.Vector3(x + dx, G + 2.6, zf), new THREE.Vector3(x + dx, G + 2.3, zf - 0.75), 0.015, C.steelDark, 4, 0);
    this.small.cyl(0.11, 0.11, 0.5, x + 0.65, G + 2.75, zf - 0.12, "#7d7a72", 8, new THREE.Euler(Math.PI / 2, 0, 0));
    // Two red lanterns on the frame.
    for (const dx of [-0.92, 0.92]) this.lantern(x + dx, G + 1.85, zf - 0.3, "#ff3a1c", Math.PI);
    // One white lantern over the diner's kitchen door, a dead one hanging off the scorched front.
    this.lantern(DINER_KITCHEN_DOOR.x + 0.32, G + 2.55, DINER_KITCHEN_DOOR.z - 0.75, "#c9a77a", Math.PI / 2);
    this.lantern(-1.2, G + 2.4, STREET.southFront - 0.35, "#2a1612", Math.PI, 0.5);
  }

  /** A chōchin: glowing body (instanced), black caps and a hook; `rotY` faces the lettering. */
  private lantern(x: number, y: number, z: number, color: string, rotY: number, tilt = 0) {
    const lit = color !== "#2a1612";
    const c = new THREE.Color(color).multiplyScalar(lit ? 1.7 : 1);
    const rot = new THREE.Euler(0, rotY, tilt);
    this.lanterns.push({ m: compose(x, y, z, rot, new THREE.Vector3(1, 1.4, 1)), c });
    const up = new THREE.Vector3(0, 1, 0).applyEuler(rot);
    const at = (d: number) => new THREE.Vector3(x, y, z).addScaledVector(up, d);
    for (const d of [0.27, -0.27]) {
      const p = at(d);
      this.small.add(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), C.black, compose(p.x, p.y, p.z, rot), 0);
    }
    const top = at(0.3);
    this.small.rod(top, at(0.42), 0.006, C.black, 3, 0);
    if (lit) {
      const f = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).multiplyScalar(0.205);
      this.sign(48, 128, this.lanternText, 0.5, this.at(x + f.x, y, z + f.z, 0.13, 0.36, rotY));
      this.glows.push({ x, y, z, w: 1.4, d: 1.4, color, strength: 0.35, vertical: true, rotY });
    }
  }

  /** Stacked plastic beer/bottle crates (one InstancedMesh, generic colours, no brands). */
  private crates() {
    const stacks: [number, number, number, string, number][] = [
      [-20.7, 18.95, 3, "#d8b32a", 0.05],
      [-20.7, 18.5, 2, "#b3322a", -0.08],
      [-20.65, 15.0, 2, "#2f5f9a", 0.1],
      [27.05, -6.4, 3, "#2f5f9a", 0.2],
      [27.5, -6.65, 1, "#3f7f4a", -0.3],
      [26.95, -5.95, 2, "#b3322a", 0.4],
      [-22.45, 0.35, 2, "#d8b32a", 0.05],
      [12.6, 12.6, 1, "#2f5f9a", 0.6],
      [33.5, 4.3, 1, "#b3322a", 0.3],
      [-36.0, 12.55, 2, "#3f7f4a", -0.1],
    ];
    const list: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    for (const [x, z, n, col, rot] of stacks) {
      const gy = groundHeight(x, z);
      for (let i = 0; i < n; i++) {
        const r = rot + this.r(-0.08, 0.08);
        list.push({ m: compose(x + this.r(-0.02, 0.02), gy + 0.15 + i * 0.3, z, r), c: new THREE.Color(col).multiplyScalar(this.r(0.7, 1)) });
      }
      this.solid(x, z, 0.5, 0.4, n * 0.3);
    }
    const tex = canvasTexture(64, 48, art.crateLattice());
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
    mat.name = "props:crates";
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.3, 0.34), mat, list.length);
    mesh.name = "props:crates";
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      mesh.setColorAt(i, it.c);
    });
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** Parked bicycles (mamachari): one InstancedMesh, tinted per bike. */
  private bikes() {
    const s = new Solids(() => 0.5, -10);
    const tyre = "#151515",
      frame = "#ffffff",
      dark = "#3a3a3a";
    for (const wx of [-0.52, 0.52]) {
      s.add(new THREE.TorusGeometry(0.31, 0.022, 4, 20), tyre, compose(wx, 0.33, 0), 0, 0);
      s.add(new THREE.TorusGeometry(0.27, 0.006, 3, 12), "#9a9a9a", compose(wx, 0.33, 0), 0, 0);
    }
    const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
    const tubes: [THREE.Vector3, THREE.Vector3][] = [
      [v(-0.52, 0.33), v(-0.04, 0.3)],
      [v(-0.52, 0.33), v(-0.2, 0.84)],
      [v(-0.04, 0.3), v(-0.2, 0.86)],
      [v(-0.04, 0.3), v(0.38, 0.78)],
      [v(0.38, 0.78), v(0.52, 0.33)],
      [v(0.38, 0.78), v(0.34, 1.02)],
    ];
    for (const [a, b] of tubes) s.rod(a, b, 0.018, frame, 5, 0);
    s.rod(v(0.34, 1.02, -0.27), v(0.34, 1.02, 0.27), 0.012, "#b0b0b0", 4, 0);
    s.box(0.24, 0.05, 0.13, -0.22, 0.9, 0, dark, 0, 0);
    s.box(0.32, 0.2, 0.3, 0.62, 0.86, 0, dark, 0, 0); // basket
    s.box(0.42, 0.02, 0.16, -0.5, 0.7, 0, "#8a8a8a", 0, 0); // rear carrier
    s.box(0.5, 0.03, 0.1, -0.5, 0.66, 0, frame, 0, 0); // mudguard
    const geo = s.mesh(new THREE.MeshBasicMaterial(), "tmp").geometry;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.55 });
    mat.name = "props:bikes";
    const bikes: [number, number, number, string, boolean][] = [
      [7.4, 0.42, 0.04, "#c9c4b8", false],
      [8.45, 0.5, -0.1, "#3f6f8f", false],
      [-16.6, 12.55, Math.PI + 0.05, "#7a2a22", false],
      [-36.8, 0.45, 0, "#3d5a44", false],
      [24.3, 18.6, 0.5, "#8a843a", true],
    ];
    const mesh = new THREE.InstancedMesh(geo, mat, bikes.length);
    mesh.name = "props:bikes";
    bikes.forEach(([x, z, yaw, col, fallen], i) => {
      const gy = groundHeight(x, z);
      const rot = fallen ? new THREE.Euler(Math.PI / 2 - 0.05, yaw, 0, "YXZ") : new THREE.Euler(0.13, yaw, 0, "YXZ");
      mesh.setMatrixAt(i, compose(x, gy + (fallen ? 0.03 : 0), z, rot));
      mesh.setColorAt(i, new THREE.Color(col));
      if (!fallen) this.solid(x, z, Math.abs(Math.cos(yaw)) > 0.7 ? 1.7 : 0.5, Math.abs(Math.cos(yaw)) > 0.7 ? 0.5 : 1.7, 1.0);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** Steel bollards at the alley mouths and along the rubble lot (instanced). */
  private bollards() {
    const pts: [number, number, string][] = [];
    for (const x of [26.45, 27.25, 28.05, 28.85]) pts.push([x, 0.3, "#c9a227"]);
    for (const x of [-20.6, -19.75, -18.9, -18.05]) pts.push([x, 13.25, "#8d9192"]);
    for (const x of [21.6, 22.6, 23.6, 26.6, 27.6, 28.6]) pts.push([x, 13.2, "#8d9192"]);
    const geo = mergeGeometries([new THREE.CylinderGeometry(0.075, 0.085, 0.8, 10).translate(0, 0.4, 0), new THREE.SphereGeometry(0.075, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.8, 0)].map((g) => g.toNonIndexed()))!;
    const mat = new THREE.MeshStandardMaterial({ map: texture("grey_plaster_diff", true), roughness: 0.6, metalness: 0.1 });
    mat.name = "props:bollards";
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    mesh.name = "props:bollards";
    pts.forEach(([x, z, col], i) => {
      mesh.setMatrixAt(i, compose(x, groundHeight(x, z), z, this.r(0, 3), new THREE.Vector3(1, this.r(0.95, 1.05), 1)));
      mesh.setColorAt(i, new THREE.Color(col).multiplyScalar(this.r(0.65, 0.95)));
      this.solid(x, z, 0.2, 0.2, 0.85);
    });
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** Manhole covers, gutter grates, AC units and the kitchen exhaust (STEAM_VENTS puff here). */
  private vents() {
    for (const [x, z] of MANHOLES) {
      this.small.cyl(0.34, 0.34, 0.02, x, 0.01, z, "#2b2a28", 16, undefined, 0);
      this.small.add(new THREE.TorusGeometry(0.3, 0.012, 3, 16).rotateX(Math.PI / 2), "#3d3b37", compose(x, 0.022, z), 0);
      this.small.add(new THREE.TorusGeometry(0.18, 0.01, 3, 12).rotateX(Math.PI / 2), "#3d3b37", compose(x, 0.022, z), 0);
    }
    for (const [x, z] of GRATES) {
      this.small.box(0.9, 0.012, 0.35, x, 0.006, z, "#151515", 0, 0);
      for (let i = 0; i < 9; i++) this.small.box(0.03, 0.014, 0.33, x - 0.4 + i * 0.1, 0.008, z, "#3a3834", 0, 0);
    }
    for (const a of AC_UNITS) {
      const nx = Math.sin(a.rotY),
        nz = Math.cos(a.rotY);
      const cx = a.x + nx * 0.16,
        cz = a.z + nz * 0.16;
      this.small.box(0.8, 0.6, 0.3, cx, a.y, cz, "#c9c6bc", a.rotY);
      this.small.add(new THREE.CylinderGeometry(0.21, 0.21, 0.02, 14).rotateX(Math.PI / 2), "#1c1d1e", compose(cx + nx * 0.15 - Math.cos(a.rotY) * 0.12, a.y, cz + nz * 0.15 + Math.sin(a.rotY) * 0.12, a.rotY), 0);
      this.small.box(0.04, 0.25, 0.32, cx, a.y - 0.42, cz, C.steelDark, a.rotY, 0); // bracket
      // Drain hose down the wall.
      this.small.tube([new THREE.Vector3(cx, a.y - 0.3, cz), new THREE.Vector3(a.x + nx * 0.06, a.y - 1.2, a.z + nz * 0.06), new THREE.Vector3(a.x + nx * 0.06, G + 0.05, a.z + nz * 0.06)], 0.012, "#d8d4c8", 10, 3);
    }
    // Diner kitchen exhaust: a hood and duct on the diner's east wall above the kitchen door.
    this.small.box(0.4, 0.4, 0.45, -20.78, G + 2.95, 17.4, "#7d7a72");
    this.small.cyl(0.12, 0.12, 0.6, -20.6, G + 3.4, 17.4, "#6d6a62", 8);
  }

  /** Stacked CRT monitors and TVs outside a repair counter on the south sidewalk. */
  private repairStack() {
    const { minX, maxX, z } = REPAIR;
    const zc = z - 0.3;
    const bodies = ["#cbbd9a", "#8d8f8c", "#2e2e2c", "#b8a77e", "#5e5a52", "#d9d2bf", "#7d4a2a"];
    const tints = ["#7fe0ff", "#9cffd0", "#ffb070", "#c8d8ff", "#ff8a7a", "#7fe0ff"];
    const rows = [
      { y: G, n: 3, s: 0.58 },
      { y: G + 0.5, n: 3, s: 0.5 },
      { y: G + 0.94, n: 2, s: 0.46 },
    ];
    let k = 0;
    for (const r of rows) {
      const span = maxX - minX - 0.3;
      for (let i = 0; i < r.n; i++, k++) {
        const x = minX + 0.15 + ((i + 0.5) * span) / r.n + this.r(-0.06, 0.06);
        const s = r.s * this.r(0.9, 1.05);
        const yaw = Math.PI + this.r(-0.15, 0.15);
        const h = s * 0.82;
        const cy = r.y + h / 2;
        this.small.add(new THREE.BoxGeometry(s, h, s * 0.85), bodies[k % bodies.length], compose(x, cy, zc, yaw), 0.6);
        const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const front = new THREE.Vector3(x, cy, zc).addScaledVector(fwd, s * 0.425 + 0.004);
        this.small.add(new THREE.BoxGeometry(s * 0.86, h * 0.76, 0.01), "#151617", compose(front.x, front.y, front.z, yaw), 0);
        const scr = front.clone().addScaledVector(fwd, 0.008);
        this.screenMats.push(compose(scr.x, scr.y + h * 0.02, scr.z, yaw, new THREE.Vector3(s * 0.74, h * 0.62, 1)));
        const dead = k % 4 === 3;
        this.screenBase.push(dead ? new THREE.Color("#0c1012") : new THREE.Color(tints[k % tints.length]).multiplyScalar(1.3));
        if (k % 3 === 0) {
          const top = new THREE.Vector3(x, r.y + h, zc);
          for (const sgn of [-1, 1]) this.small.rod(top, top.clone().add(new THREE.Vector3(sgn * s * 0.4, s * 0.55, 0.05)), 0.006, "#b9b9b3", 3, 0);
        }
      }
    }
    // Cables spilling onto the sidewalk, the hand-painted board above.
    for (let i = 0; i < 3; i++) this.small.tube([new THREE.Vector3(minX + 0.4 + i * 0.6, G + 0.3, z - 0.1), new THREE.Vector3(minX + 0.6 + i * 0.5, G + 0.02, z - 0.75), new THREE.Vector3(minX + 0.2 + i * 0.7, G + 0.02, z - 1.0)], 0.012, C.cable, 10, 3);
    this.sign(512, 160, art.repairBoard(), 0, this.at((minX + maxX) / 2, G + 2.25, z - 0.03, 1.8, 0.56, Math.PI));
    this.collision.addBounds(minX, zc - 0.35, maxX, z, 1.5, "prop");
  }

  /** The public-notice screen on the pole at x -9.9, facing west down the street. */
  private noticeScreen() {
    const p = UTILITY_POLES.find((q) => Math.abs(q.x + 9.9) < 0.01) ?? UTILITY_POLES[2];
    const x = p.x - 0.25,
      y = G + 3.5,
      z = p.z;
    this.small.box(0.14, 0.92, 1.36, x, y, z, "#2a2c2d");
    for (const dy of [-0.3, 0.3]) this.small.box(0.22, 0.08, 0.08, p.x - 0.1, y + dy, z, C.steelDark, 0, 0);
    this.small.box(0.16, 0.06, 1.42, x, y + 0.49, z, "#1c1d1e", 0, 0);
    this.camera(x, y + 0.52, z - 0.5, -Math.PI / 2, -Math.PI / 2 - 0.4, false);
    this.camera(x, y + 0.52, z + 0.5, -Math.PI / 2, -Math.PI / 2 + 0.5, false);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 320;
    this.noticeCanvas = canvas;
    this.noticeTex = new THREE.CanvasTexture(canvas);
    this.noticeTex.colorSpace = THREE.SRGBColorSpace;
    this.noticeTex.wrapT = THREE.RepeatWrapping;
    art.noticeScreenPage(canvas.getContext("2d")!, 512, 320, 0);
    const mat = new THREE.MeshBasicMaterial({ map: this.noticeTex, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) });
    mat.name = "props:notice-screen";
    const geo = new THREE.PlaneGeometry(1.2, 0.75);
    geo.rotateY(-Math.PI / 2);
    const screen = new THREE.Mesh(geo, mat);
    screen.position.set(x - 0.075, y, z);
    screen.name = "props:notice-screen";
    this.root.add(screen);
    this.glows.push({ x: x - 0.09, y, z, w: 2.4, d: 1.6, color: "#6dffc0", strength: 0.12, vertical: true, rotY: -Math.PI / 2 });
  }

  /** Standing water along both gutters and in a few sidewalk dips. */
  private gutterPuddles() {
    const spots: [number, number, number, number][] = [
      [-33, 3.35, 1.3, 0.38],
      [-24, 9.68, 1.0, 0.32],
      [-16, 3.3, 1.5, 0.4],
      [-11.5, 9.65, 1.2, 0.35],
      [-4, 3.35, 0.9, 0.3],
      [1.5, 9.7, 1.4, 0.32],
      [9.5, 3.3, 1.1, 0.36],
      [13.2, 9.72, 0.9, 0.28],
      [17, 3.4, 1.3, 0.4],
      [23, 9.62, 1.2, 0.38],
      [28.6, 3.3, 0.8, 0.3],
      [-1, 12.2, 0.7, 0.4],
      [19, 1.7, 0.6, 0.35],
      [-36, 11.6, 0.8, 0.45],
      [-6, 7.5, 1.6, 0.7],
      [11.5, 6.0, 1.2, 0.55],
    ];
    for (const [x, z, rx, rz] of spots) this.puddleSpots.push([x, z, rx, rz, this.r(-0.12, 0.12)]);
  }

  private buildScreens() {
    const tex = canvasTexture(64, 48, art.crtStandby());
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    mat.name = "props:crt";
    this.screens = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, this.screenMats.length);
    this.screens.name = "props:crt";
    this.screenMats.forEach((m, i) => {
      this.screens.setMatrixAt(i, m);
      this.screens.setColorAt(i, this.screenBase[i]);
    });
    this.screens.frustumCulled = false;
    this.root.add(this.screens);
  }

  private buildLanterns() {
    const geo = new THREE.SphereGeometry(0.2, 14, 10);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    mat.name = "props:lanterns";
    const mesh = new THREE.InstancedMesh(geo, mat, this.lanterns.length);
    mesh.name = "props:lanterns";
    this.lanterns.forEach((l, i) => {
      mesh.setMatrixAt(i, l.m);
      mesh.setColorAt(i, l.c);
    });
    this.root.add(mesh);
  }

  // ───────────────────────── glow + lamp ─────────────────────────

  private buildGlows() {
    const tex = canvasTexture(128, 128, art.radial([[0, "rgba(255,255,255,1)"], [0.4, "rgba(255,255,255,0.45)"], [1, "rgba(255,255,255,0)"]]));
    const glowMat = (name: string) => {
      const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: true });
      m.name = name;
      return m;
    };
    const quad = (g: Glow) => {
      const geo = new THREE.PlaneGeometry(g.w, g.d);
      if (!g.vertical) geo.rotateX(-Math.PI / 2);
      if (g.rotY) geo.rotateY(g.rotY);
      geo.translate(g.x, g.y, g.z);
      const c = new THREE.Color(g.color).multiplyScalar(g.strength);
      const cols = new Float32Array(geo.getAttribute("position").count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]);
      geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      return geo;
    };
    if (this.glows.length) {
      const geos = this.glows.map(quad);
      const merged = new THREE.Mesh(mergeAll(geos), glowMat("props:glow"));
      merged.name = "props:glow";
      merged.renderOrder = 3;
      this.root.add(merged);
    }
    // The flickering lamp: head (UVs at the glow centre = solid) + a pool under it.
    const p = UTILITY_POLES.find((q) => q.lamp);
    this.lampMat = glowMat("props:lamp");
    this.lampMat.vertexColors = false;
    if (p) {
      const road = p.z < 6.5 ? 1 : -1;
      const hz = p.z + road * 1.45;
      const head = new THREE.PlaneGeometry(0.28, 0.5);
      head.rotateX(Math.PI / 2);
      head.translate(p.x, G + 6.635, hz);
      head.getAttribute("uv").array.fill(0.5);
      const halo = new THREE.PlaneGeometry(1.4, 1.4);
      halo.rotateX(Math.PI / 2);
      halo.translate(p.x, G + 6.6, hz);
      const pool = new THREE.PlaneGeometry(6, 6);
      pool.rotateX(-Math.PI / 2);
      pool.translate(p.x, groundHeight(p.x, hz) + 0.01, hz);
      const scale = (g: THREE.BufferGeometry, k: number) => {
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(k), 3));
        return g;
      };
      this.lampMat.vertexColors = true;
      this.lamp = new THREE.Mesh(mergeAll([scale(head, 2.2), scale(halo, 0.8), scale(pool, 0.22)]), this.lampMat);
      this.lamp.name = "props:lamp";
      this.lamp.renderOrder = 3;
      this.root.add(this.lamp);
    }
  }
}

function fract(x: number) {
  return x - Math.floor(x);
}

function mergeAll(geos: THREE.BufferGeometry[]) {
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

/** A corrugated metal sheet in the XY plane (ribs along Y), w × h m. */
function corrugatedSheet(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h, Math.round(w / 0.019), 1);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / 0.076) * Math.PI * 2) * 0.012);
  g.computeVertexNormals();
  return g;
}
