/**
 * Saisei Records (SIGNS.saisei): building shell, two-storey facade, interior, genre
 * sections, listening bar and counter.
 *
 * Owns: the shop's walls (with a real doorway onto the street) and the grimy upper storey
 * (dark windows, one dimly lit, AC unit, drain pipe, soot and leak streaks); the magenta and
 * cyan SAISEI neon, the tategaki lightbox blade sign, the half-open roll-up shutter over the
 * doorway, the CRT in the window showing an OPEN card (SIGNS.open) and the brass door bell; the
 * warm tungsten interior (3 real PointLights inside incl. the deck light, plus one magenta
 * neon spill outside: 4 in all; everything else is emissive + bloom); the 10 genre
 * sections built by setRecords (bin + section sign + face-out featured record + filler
 * sleeves) under a BY GENRE banner; the listening bar (turntable with spinning platter and
 * tonearm, wooden speakers, a tube amp with glowing valves, Inicio's open toolkit on the
 * floor); the counter with a brass mechanical cash register and a hand-lettered PAY HERE
 * card; the poster wall (concert poster, the band's tour poster) and drifting dust.
 * Registers the "record:<id>", "deck" and "cashier" interactables and all interior collision.
 * All shop signs share one SignAtlas (one texture, one draw call); Japanese text comes from
 * signage.ts.
 * Must not: decide what a record costs or whether it may leave; the clerk character
 * lives in npcs.ts; record objects themselves live in record-item.ts.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldRecord } from "./api";
import { Collision } from "./collision";
import { Interactables } from "./interactables";
import { COUNTER, DECK, DOOR, SHOP_FLOOR_Y, SHOP_INTERIOR } from "./layout";
import { batchStaticGeometry, box, flat, surfaces } from "./materials";
import { canvasTexture, fitText } from "./labels";
import { RecordItems } from "./record-item";
import { drawBilingual, EN_FONT, fitFont, grime, JP_FONT, SignAtlas, SIGNS } from "./signage";

const Y = SHOP_FLOOR_Y;
/** Turntables are modelled at real size and drawn at twice that, so the deck reads on a projector. */
const TT_SCALE = 2;
const TONEARM_REST = 0.05;
const TONEARM_PLAY = -0.6;
const EQ_BARS = 20;
/** A small shared palette for props, so the batcher merges them into a few draw calls. */
const PROP_DARK = flat("#1d1a17", 0.6);
const PROP_BLACK = flat("#141210", 0.6);
const PROP_LIGHT = flat("#b9b3a6", 0.45);
const PROP_CREAM = flat("#d8c7a4", 0.9);
const BRASS = new THREE.MeshStandardMaterial({ color: "#a9823e", metalness: 0.85, roughness: 0.38, name: "brass" });
const STEEL = new THREE.MeshStandardMaterial({ color: "#8d918f", metalness: 0.8, roughness: 0.45, name: "steel" });
const BULB = new THREE.MeshStandardMaterial({ color: "#ffd9a0", emissive: "#ffb060", emissiveIntensity: 3.2, toneMapped: false });
const BULB_DEAD = flat("#5a5246", 0.3);
const VALVE = new THREE.MeshStandardMaterial({ color: "#ffb070", emissive: "#ff7a26", emissiveIntensity: 2.6, toneMapped: false, transparent: true, opacity: 0.9 });
const TT_SILVER = new THREE.MeshStandardMaterial({ color: "#b9b5ac", metalness: 0.6, roughness: 0.4 });
const TT_PLATTER = new THREE.MeshStandardMaterial({ color: "#5d5d5b", metalness: 0.7, roughness: 0.35 });
const TT_CHROME = new THREE.MeshStandardMaterial({ color: "#e4e8ec", metalness: 0.85, roughness: 0.18 });
const TT_HEADSHELL = new THREE.MeshStandardMaterial({ color: "#ff8a3c", emissive: "#ff6a1a", emissiveIntensity: 0.6, roughness: 0.4 });
const TT_SLIPMAT = new THREE.MeshStandardMaterial({ color: "#3a2e28", roughness: 0.95 });
const WALL_H = 5;
const CEILING = 4.6;
/** Upper storey: from the roof slab of the shop up to this height. */
const UPPER_TOP = 9.5;
/** The doorway's clear height (the half-open shutter's bottom edge sits above the frame). */
const DOOR_H = 3.6;
const SHUTTER_BOTTOM = 2.8;
/** The window CRT (inside the west window) and Inicio's toolkit (east of his spot, clear of it). */
const WINDOW_CRT = { x: -4.6, z: -0.8 };
const TOOLKIT = { x: -1.85, z: -12.75 };

/** Neon palette (Gamer's art): magenta and cyan. */
const MAGENTA = "#ff3fb4";
const CYAN = "#3ff0ff";

/** Where each of the 10 sections stands: front-centre position and facing (radians, 0 = +z). */
const SECTION_SLOTS: { x: number; z: number; facing: number }[] = [
  { x: -7.85, z: -3.0, facing: Math.PI / 2 },
  { x: -7.85, z: -6.3, facing: Math.PI / 2 },
  { x: -7.85, z: -9.6, facing: Math.PI / 2 },
  { x: -2.8, z: -3.6, facing: 0 },
  { x: 2.8, z: -3.6, facing: 0 },
  { x: -2.8, z: -8.1, facing: 0 },
  { x: 2.8, z: -8.1, facing: 0 },
  { x: 7.85, z: -3.0, facing: -Math.PI / 2 },
  { x: 7.85, z: -6.3, facing: -Math.PI / 2 },
  { x: 7.85, z: -9.6, facing: -Math.PI / 2 },
];

export interface Section {
  record: WorldRecord;
  anchor: THREE.Object3D;
  interact: { x: number; z: number };
}

export class Shop {
  readonly root = new THREE.Group();
  readonly sections: Section[] = [];
  /** The record sits here when it is on the deck (child of the static plinth). */
  readonly deckAnchor = new THREE.Object3D();
  /** Where the sleeve stands (upright "now playing" display behind the live deck), in deckAnchor space. */
  readonly deckSleeveSpot = new THREE.Vector3(0.06, 0.066, -0.27);
  /** Real lights the shop adds to the scene (3 inside incl. the deck light, 1 neon spill outside). */
  readonly lightCount = 4;
  private sectionGroup = new THREE.Group();
  private platter!: THREE.Group;
  private tonearm!: THREE.Group;
  private playing = false;
  private playBlend = 0;
  private vu: THREE.MeshStandardMaterial;
  /** Shared warm glow: console edge, strobe ring, amp meter. Brightens while playing. */
  private glow = new THREE.MeshStandardMaterial({ color: "#ffb35c", emissive: "#ff9a3c", emissiveIntensity: 1.0, toneMapped: false });
  private eq!: THREE.InstancedMesh;
  private eqColors!: Float32Array;
  private eqMatrix = new THREE.Matrix4();
  /** The listening bar's one real light: swells while playing. */
  private deckLight = new THREE.PointLight("#ffc890", 5, 6.5, 1.6);
  private signs = new SignAtlas("saisei", 2048, 2.4);
  private dust: THREE.InstancedMesh | null = null;
  private wood = surfaces.woodWorn;
  constructor(
    scene: THREE.Scene,
    private collision: Collision,
    private interactables: Interactables,
    options: { lowQuality?: boolean } = {},
  ) {
    this.root.name = "shop";
    scene.add(this.root);
    this.root.add(this.sectionGroup);
    this.vu = new THREE.MeshStandardMaterial({ color: "#222", emissive: "#ffb347", emissiveIntensity: 0.4, toneMapped: false });
    this.shell();
    this.upperStorey();
    // Only the shell casts (sun) shadows; the interior is lit by non-shadowing point lights.
    const shellCount = this.root.children.length;
    this.facade();
    this.lighting();
    this.deck();
    this.counter();
    this.decor();
    this.root.children.slice(shellCount).forEach((o) => o.traverse((m) => (m.castShadow = false)));
    mergeFlatColors(this.root);
    batchStaticGeometry(this.root);
    this.root.add(this.signs.build());
    if (!options.lowQuality) this.makeDust();
  }

  /** Floor, walls with the doorway, ceiling and roof slab. */
  private shell() {
    const r = this.root;
    const { minX, maxX, minZ } = SHOP_INTERIOR;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, -0.3 - minZ), surfaces.floor);
    const uv = floor.geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 5);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, Y + 0.004, (minZ - 0.3) / 2);
    floor.receiveShadow = true;
    floor.userData.keepDynamic = true;
    r.add(floor);
    const brick = surfaces.brick;
    const t = 0.3;
    // Back and side walls.
    box(r, maxX - minX + 2 * t, WALL_H, t, 0, WALL_H / 2, minZ - t / 2, brick);
    box(r, t, WALL_H, -minZ + t, minX - t / 2, WALL_H / 2, (minZ - t) / 2, brick);
    box(r, t, WALL_H, -minZ + t, maxX + t / 2, WALL_H / 2, (minZ - t) / 2, brick);
    this.collision.addBounds(minX - t, minZ - t, maxX + t, minZ, WALL_H, "shop-wall");
    this.collision.addBounds(minX - t, minZ - t, minX, 0, WALL_H, "shop-wall");
    this.collision.addBounds(maxX, minZ - t, maxX + t, 0, WALL_H, "shop-wall");
    // Front wall: piers, window sills/headers, the doorway.
    const fz = -0.15,
      hw = DOOR.halfWidth;
    const pier = (x0: number, x1: number) => box(r, x1 - x0, WALL_H, t, (x0 + x1) / 2, WALL_H / 2, fz, brick);
    pier(minX - t, minX + 1.0);
    pier(-hw - 0.9, -hw);
    pier(hw, hw + 0.9);
    pier(maxX - 1.0, maxX + t);
    const windows: [number, number][] = [
      [minX + 1.0, -hw - 0.9],
      [hw + 0.9, maxX - 1.0],
    ];
    const glass = new THREE.MeshPhysicalMaterial({ color: "#8a8a74", roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    const frame = flat("#24201c", 0.6);
    for (const [x0, x1] of windows) {
      const cx = (x0 + x1) / 2,
        w = x1 - x0;
      box(r, w, 0.75, t, cx, Y + 0.375, fz, surfaces.darkBrick);
      box(r, w, WALL_H - 3.7, t, cx, (WALL_H + 3.7) / 2, fz, brick);
      const pane = box(r, w, 2.95, 0.03, cx, Y + 0.75 + 1.4, fz, glass, { cast: true });
      pane.userData.keepDynamic = true;
      pane.renderOrder = 4;
      box(r, w, 0.08, 0.36, cx, Y + 0.78, fz, frame);
      box(r, w, 0.1, 0.36, cx, 3.66, fz, frame);
      for (let x = x0 + w / 3; x < x1 - 0.1; x += w / 3) box(r, 0.07, 2.9, 0.36, x, Y + 2.2, fz, frame);
    }
    // Door header and frame (open doorway, tall enough to see in under the shutter).
    box(r, hw * 2, WALL_H - DOOR_H, t, 0, (WALL_H + DOOR_H) / 2, fz, brick);
    for (const x of [-hw, hw]) box(r, 0.12, DOOR_H, 0.4, x, DOOR_H / 2, fz, frame);
    box(r, hw * 2 + 0.24, 0.14, 0.4, 0, DOOR_H, fz, frame);
    this.collision.addBounds(minX - t, -0.3, -hw, 0, WALL_H, "shop-front");
    this.collision.addBounds(hw, -0.3, maxX + t, 0, WALL_H, "shop-front");
    // Ceiling (stained, seen from inside) and roof slab.
    const ceiling = box(r, maxX - minX, 0.08, -minZ, 0, CEILING + 0.04, minZ / 2, surfaces.plasterStained, { receive: true });
    ceiling.castShadow = false;
    box(r, maxX - minX + 2 * t, 0.3, -minZ + t, 0, WALL_H + 0.15, minZ / 2 - 0.15, flat("#3c3a37", 0.9), { cast: true });
    // Dark worn-wood wainscot inside.
    const wains = this.wood;
    box(r, maxX - minX, 1.1, 0.06, 0, Y + 0.55, minZ + 0.03, wains);
    box(r, 0.06, 1.1, -minZ - 0.3, minX + 0.03, Y + 0.55, minZ / 2 - 0.15, wains);
    box(r, 0.06, 1.1, -minZ - 0.3, maxX - 0.03, Y + 0.55, minZ / 2 - 0.15, wains);
  }

  /** The second storey: stained render over the shop, dark windows (one dim), AC unit, drain pipe. */
  private upperStorey() {
    const r = this.root;
    const { minX, maxX, minZ } = SHOP_INTERIOR;
    const t = 0.3;
    const y0 = WALL_H + 0.3,
      h = UPPER_TOP - y0;
    const w = maxX - minX + 2 * t,
      d = -minZ + t;
    box(r, w, h, d, 0, y0 + h / 2, minZ / 2 - 0.15, surfaces.plasterStained);
    // String course between the storeys (sign mount) and a cornice on top.
    box(r, w + 0.2, 0.22, 0.4, 0, y0 + 0.05, 0.05, surfaces.concrete);
    box(r, w + 0.3, 0.3, 0.5, 0, UPPER_TOP + 0.05, 0.05, surfaces.concrete);
    box(r, w, 0.6, 0.25, 0, UPPER_TOP + 0.5, -0.05, surfaces.plasterStained);
    // Windows: dark glass in deep reveals, with sills; the fourth one has a dim lamp behind a blind.
    const dark = new THREE.MeshStandardMaterial({ color: "#0e1113", roughness: 0.2, metalness: 0.5, name: "dark-window" });
    const dim = flat("#3a2a1c", 0.6, "#ff9f55", 0.55);
    const blind = flat("#6a5a44", 0.9);
    const wy = 8.15;
    [-7, -3.5, 0, 3.5, 7].forEach((x, i) => {
      box(r, 1.3, 1.5, 0.05, x, wy, 0.0, i === 3 ? dim : dark, {});
      box(r, 1.5, 0.08, 0.22, x, wy - 0.8, 0.08, surfaces.concrete);
      box(r, 1.42, 0.06, 0.14, x, wy + 0.76, 0.04, frame());
      box(r, 0.06, 1.5, 0.12, x, wy, 0.04, frame());
      if (i === 3) box(r, 1.28, 0.62, 0.02, x, wy + 0.42, 0.035, blind, {});
      if (i === 1) box(r, 0.6, 0.9, 0.02, x - 0.3, wy + 0.1, 0.035, flat("#1a1612", 0.9), {}); // cardboard over a broken pane
    });
    // AC unit hanging under the second window, with its drip stain (atlas) and bracket.
    const ac = { x: -3.5, y: 6.95, z: 0.32 };
    box(r, 0.85, 0.55, 0.42, ac.x, ac.y, ac.z, flat("#bdb6a6", 0.7));
    box(r, 0.7, 0.4, 0.02, ac.x, ac.y, ac.z + 0.215, flat("#5c5850", 0.8), {});
    box(r, 0.9, 0.04, 0.5, ac.x, ac.y - 0.3, ac.z - 0.02, STEEL);
    // Drain pipe down the east end of the facade, with brackets.
    const pipe = flat("#4a4038", 0.55);
    const px = maxX + 0.05;
    const down = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, UPPER_TOP + 0.4, 10), pipe);
    down.position.set(px, (UPPER_TOP + 0.4) / 2, 0.12);
    r.add(down);
    for (let y = 1.5; y < UPPER_TOP; y += 2.2) box(r, 0.18, 0.05, 0.14, px, y, 0.08, pipe);
    box(r, 0.4, 0.12, 0.25, px - 0.15, UPPER_TOP + 0.35, 0.1, pipe);
  }

  /** Neon, lightbox blade, shutter, window CRT, bell, window lettering and grime. */
  private facade() {
    const r = this.root;
    const a = this.signs;
    const hw = DOOR.halfWidth;
    // The big neon: SIGNS.saisei.jp in magenta tubes, SAISEI RECORDS in cyan, on a rusty backing board.
    const neon = a.add(1536, 360, drawSaiseiNeon, 1);
    box(r, 9.0, 1.75, 0.12, 0, 6.15, 0.2, flat("#141014", 0.7));
    for (const x of [-3.8, 3.8]) box(r, 0.08, 0.08, 0.3, x, 6.15, 0.1, STEEL);
    a.quad(neon, 8.8, 1.65, new THREE.Vector3(0, 6.15, 0.27));
    // Tategaki lightbox blade at the east end, readable down the street both ways.
    const blade = a.add(144, 640, drawBlade, 1);
    const bx = 8.4,
      bz = 0.75;
    box(r, 0.16, 3.5, 0.84, bx, 7.2, bz, flat("#1a1418", 0.6));
    box(r, 0.1, 0.1, 0.6, bx, 8.6, 0.25, STEEL);
    box(r, 0.1, 0.1, 0.6, bx, 5.8, 0.25, STEEL);
    a.quad(blade, 0.76, 3.4, new THREE.Vector3(bx + 0.085, 7.2, bz), Math.PI / 2);
    a.quad(blade, 0.76, 3.4, new THREE.Vector3(bx - 0.085, 7.2, bz), -Math.PI / 2);
    // Soot, leak streaks and edge wear over both storeys.
    const soot = a.add(512, 256, drawFacadeSoot, 0);
    a.quad(soot, 18.6, UPPER_TOP - 0.2, new THREE.Vector3(0, (UPPER_TOP + 0.2) / 2, 0.012));
    const acDrip = a.add(32, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(30,24,18,0.7)");
      g.addColorStop(1, "rgba(30,24,18,0)");
      c.fillStyle = g;
      c.fillRect(w * 0.3, 0, w * 0.4, h);
    }, 0);
    a.quad(acDrip, 0.4, 1.4, new THREE.Vector3(-3.5, 5.95, 0.015));
    // Roll-up shutter, half open over the doorway: housing, ribbed slats, bottom bar, handle.
    const sw = hw * 2 + 0.2;
    box(r, sw + 0.2, 0.42, 0.4, 0, DOOR_H + 0.28, 0.2, surfaces.shutter);
    const slats = box(r, sw, DOOR_H - SHUTTER_BOTTOM, 0.04, 0, (DOOR_H + SHUTTER_BOTTOM) / 2, 0.06, surfaces.shutter);
    slats.castShadow = false;
    for (let y = SHUTTER_BOTTOM + 0.08; y < DOOR_H; y += 0.1) box(r, sw, 0.025, 0.02, 0, y, 0.09, surfaces.shutter, {});
    box(r, sw + 0.04, 0.06, 0.08, 0, SHUTTER_BOTTOM, 0.07, STEEL);
    box(r, 0.2, 0.04, 0.05, 0, SHUTTER_BOTTOM - 0.05, 0.12, STEEL);
    for (const x of [-1, 1]) box(r, 0.07, DOOR_H, 0.08, x * (sw / 2 + 0.03), DOOR_H / 2, 0.06, STEEL); // guide rails
    const tag = a.add(512, 256, drawShutterTag, 0);
    a.quad(tag, sw, DOOR_H - SHUTTER_BOTTOM - 0.05, new THREE.Vector3(0, (DOOR_H + SHUTTER_BOTTOM) / 2, 0.1));
    // Window lettering (gold leaf, flaking) and grime on the glass.
    const vinyl = a.add(768, 96, (c, w, h) => paintLettering(c, w, h, "NEW & USED VINYL"), 0.25);
    const listen = a.add(768, 96, (c, w, h) => paintLettering(c, w, h, "LISTEN BEFORE YOU BUY"), 0.25);
    a.quad(vinyl, 4.6, 0.5, new THREE.Vector3(-5.2, Y + 3.15, 0.03));
    a.quad(listen, 4.6, 0.5, new THREE.Vector3(5.2, Y + 3.15, 0.03));
    const dirtyGlass = a.add(384, 240, drawWindowGrime, 0);
    a.quad(dirtyGlass, 5.85, 2.95, new THREE.Vector3(-5.08, Y + 2.15, 0.01));
    a.quad(dirtyGlass, 5.85, 2.95, new THREE.Vector3(5.08, Y + 2.15, 0.01), 0, new THREE.Euler(0, 0, Math.PI));
    // The CRT in the west window, on a crate, showing the OPEN card (SIGNS.open).
    const crt = WINDOW_CRT;
    box(r, 0.7, 0.62, 0.6, crt.x, Y + 0.31, crt.z, this.wood);
    box(r, 0.66, 0.5, 0.56, crt.x, Y + 0.87, crt.z, this.wood); // two crates stacked
    const tv = Y + 1.38;
    box(r, 0.66, 0.54, 0.5, crt.x, tv, crt.z, flat("#b4ab98", 0.7));
    box(r, 0.44, 0.38, 0.3, crt.x, tv, crt.z - 0.38, flat("#9c937f", 0.7));
    const ear = (dx: number) => {
      const rod = box(r, 0.015, 0.42, 0.015, crt.x + dx, tv + 0.45, crt.z - 0.1, STEEL, {});
      rod.rotation.z = -dx * 3;
    };
    ear(0.1);
    ear(-0.1);
    const open = a.add(320, 240, drawOpenCrt, 1);
    a.quad(open, 0.52, 0.39, new THREE.Vector3(crt.x, tv, crt.z + 0.252));
    this.collision.add({ x: crt.x, z: crt.z - 0.1, w: 0.8, d: 0.85, h: 1.7, tag: "shop-window" });
    // A small brass bell on a curled bracket over the door (inside, top of the frame).
    const bell = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(0.0, 0.0), new THREE.Vector2(0.09, 0.0), new THREE.Vector2(0.075, 0.04), new THREE.Vector2(0.05, 0.12), new THREE.Vector2(0.03, 0.16), new THREE.Vector2(0, 0.17)], 14),
      BRASS,
    );
    bell.position.set(hw - 0.35, DOOR_H - 0.38, -0.42);
    r.add(bell);
    box(r, 0.03, 0.22, 0.03, hw - 0.35, DOOR_H - 0.12, -0.42, BRASS);
    box(r, 0.03, 0.03, 0.2, hw - 0.35, DOOR_H - 0.02, -0.33, BRASS);
    // Worn doormat.
    box(r, 2.0, 0.015, 0.8, 0, Y + 0.008, -1.0, flat("#3a3128", 0.98), { receive: true });
  }

  /**
   * Light: two warm tungsten PointLights inside (over the bins, over the counter) and the deck
   * light (in deck()), plus one magenta spill from the neon onto the sidewalk: 4 in all.
   * Bare Edison bulbs on cords and dusty enamel shades fake the rest (emissive + bloom).
   */
  private lighting() {
    const r = this.root;
    const main = new THREE.PointLight("#ffb46a", 34, 17, 1.5);
    main.position.set(-0.8, 3.95, -5.2);
    r.add(main);
    const till = new THREE.PointLight("#ffa858", 20, 9, 1.5);
    till.position.set(4.6, 3.5, -10.6);
    r.add(till);
    const spill = new THREE.PointLight(MAGENTA, 16, 10, 1.6);
    spill.position.set(0, 5.6, 1.8);
    r.add(spill);
    const shade = flat("#3b4a3a", 0.8);
    const cordMat = PROP_BLACK;
    let k = 0;
    for (const x of [-4.5, 0, 4.5])
      for (const z of [-2.5, -6.5, -10.6]) {
        const dead = k++ === 4 || k === 8;
        const drop = 0.55 + ((k * 37) % 5) * 0.12;
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, drop, 4), cordMat);
        cord.position.set(x, CEILING - drop / 2, z);
        r.add(cord);
        if (k % 2) {
          const s = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.28, 14, 1, true), shade);
          s.position.set(x, CEILING - drop - 0.05, z);
          r.add(s);
        }
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 6), dead ? BULB_DEAD : BULB);
        b.scale.y = 1.35;
        b.position.set(x, CEILING - drop - 0.14, z);
        r.add(b);
      }
  }

  /**
   * The listening bar: a worn wooden bar with the live turntable (right of centre, so the
   * player at the deck interactable never blocks it from the default camera), a small tube
   * amp with glowing valves (left), a mixer with VU lights, an equalizer strip that comes
   * alive while a record plays, two wooden speakers, headphones on a hook, the LISTEN (SIGNS.listen)
   * sign hung above, a dusty light cone, and Inicio's open toolkit on the floor nearby.
   */
  private deck() {
    const r = this.root;
    const top = Y + 1.0;
    const cx = DECK.x,
      cz = DECK.z;
    const W = 3.4,
      D = 1.1;
    const front = cz + D / 2;
    // Bar: worn wood body and top, a warm strip under the lip.
    box(r, W, 0.92, D - 0.12, cx, Y + 0.46, cz - 0.04, this.wood);
    box(r, W + 0.12, 0.08, D + 0.06, cx, top - 0.04, cz, this.wood);
    box(r, W + 0.1, 0.03, 0.02, cx, top - 0.1, front + 0.035, this.glow, {});
    this.collision.add({ x: cx, z: cz, w: W + 0.12, d: D + 0.06, h: 1.1, tag: "deck" });
    // Equalizer strip on the front panel (one instanced draw; animated in update()).
    const bar = new THREE.BoxGeometry(0.1, 1, 0.02).translate(0, 0.5, 0);
    this.eq = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ toneMapped: false }), EQ_BARS);
    this.eq.userData.keepDynamic = true;
    this.eq.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < EQ_BARS; i++) this.eq.setColorAt(i, new THREE.Color().setHSL(0.1 - (i / EQ_BARS) * 0.1, 0.95, 0.55));
    this.eqColors = Float32Array.from(this.eq.instanceColor!.array);
    this.eq.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.eq.position.set(cx + 0.15, Y + 0.2, front - 0.05);
    r.add(this.eq);
    this.updateEq(0, false);
    // The live turntable (right).
    const live = new THREE.Group();
    live.position.set(cx + 0.85, top, cz - 0.02);
    live.rotation.x = 0.1; // tilted a touch toward the camera so the record reads
    live.scale.setScalar(TT_SCALE);
    r.add(live);
    this.turntable(live);
    // Tube amp (left): steel chassis, transformers, four glowing valves, a lit meter, knobs.
    const ax = cx - 0.85,
      az = cz - 0.05;
    box(r, 0.86, 0.14, 0.5, ax, top + 0.07, az, STEEL);
    box(r, 0.86, 0.14, 0.02, ax, top + 0.07, az + 0.255, PROP_DARK, {});
    for (const dx of [-0.3, 0.3]) box(r, 0.16, 0.16, 0.14, ax + dx, top + 0.22, az - 0.12, PROP_BLACK);
    for (let i = 0; i < 4; i++) {
      const valve = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.1, 4, 10), VALVE);
      valve.position.set(ax - 0.18 + i * 0.12, top + 0.22, az + 0.04);
      r.add(valve);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), PROP_BLACK);
      base.position.set(ax - 0.18 + i * 0.12, top + 0.15, az + 0.04);
      r.add(base);
    }
    box(r, 0.16, 0.08, 0.01, ax, top + 0.08, az + 0.267, this.vu, {});
    for (const dx of [-0.3, -0.2, 0.2, 0.3]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), PROP_CREAM);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(ax + dx, top + 0.07, az + 0.275);
      r.add(knob);
    }
    // Mixer: body, faders, knobs, two VU columns.
    box(r, 0.56, 0.07, 0.8, cx, top + 0.035, cz - 0.02, PROP_DARK);
    for (const dx of [-0.12, 0.12]) {
      box(r, 0.05, 0.035, 0.1, cx + dx, top + 0.085, cz + 0.16, PROP_LIGHT);
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12), PROP_LIGHT);
        c.position.set(cx + dx, top + 0.085, cz - 0.3 + k * 0.12);
        r.add(c);
      }
      box(r, 0.035, 0.01, 0.3, cx + dx * 0.4, top + 0.075, cz - 0.15, this.vu, {});
    }
    box(r, 0.16, 0.035, 0.05, cx, top + 0.085, cz + 0.3, PROP_LIGHT);
    // Wooden floor speakers either side, cloth grilles and cones.
    const grille = surfaces.fabric;
    for (const dx of [-2.05, 2.05]) {
      box(r, 0.58, 1.35, 0.5, cx + dx, Y + 0.675, cz - 0.1, this.wood);
      box(r, 0.48, 1.0, 0.02, cx + dx, Y + 0.8, cz + 0.155, grille, {});
      this.collision.add({ x: cx + dx, z: cz - 0.1, w: 0.62, d: 0.54, h: 1.4, tag: "deck" });
      for (const [y, rad] of [
        [0.5, 0.18],
        [1.1, 0.08],
      ]) {
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.03, 20), PROP_BLACK);
        cone.rotation.x = Math.PI / 2;
        cone.position.set(cx + dx, Y + y, cz + 0.17);
        r.add(cone);
      }
    }
    // Headphones on a hook at the bar's front-left corner.
    box(r, 0.03, 0.03, 0.12, cx - 1.45, top - 0.2, front + 0.04, PROP_LIGHT);
    const phones = new THREE.Group();
    phones.position.set(cx - 1.45, top - 0.2, front + 0.1);
    r.add(phones);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 6, 20, Math.PI), PROP_DARK);
    band.position.y = -0.13; // the arc's top rests on the hook
    phones.add(band);
    for (const sx of [-0.13, 0.13]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), PROP_DARK);
      cup.rotation.x = Math.PI / 2;
      cup.position.set(sx, -0.15, 0.0);
      phones.add(cup);
    }
    // LISTEN (SIGNS.listen) lightbox hung above the bar, with its rods.
    const listen = this.signs.add(512, 224, drawBilingual("listen", { bg: "#efe0bd", ink: "#b0222a", inkEn: "#2a221c", border: "#2a221c", jpShare: 0.62, grime: 0.8 }), 0.32);
    box(r, 2.1, 0.86, 0.12, cx, 3.6, cz - 0.42, PROP_DARK);
    this.signs.quad(listen, 2.0, 0.78, new THREE.Vector3(cx, 3.6, cz - 0.355));
    for (const dx of [-0.9, 0.9]) box(r, 0.02, CEILING - 4.03, 0.02, cx + dx, (CEILING + 4.03) / 2, cz - 0.42, PROP_BLACK, {});
    // Spotlight: ceiling can, glowing lens, and a dusty additive light cone onto the turntable.
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 16), PROP_DARK);
    can.position.set(cx + 0.6, CEILING - 0.11, cz + 0.35);
    r.add(can);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16).rotateX(Math.PI / 2), BULB);
    lens.position.set(cx + 0.6, CEILING - 0.225, cz + 0.35);
    r.add(lens);
    const beamHeight = CEILING - 0.23 - (top + 0.05);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 1.25, beamHeight, 28, 1, true).translate(0, -beamHeight / 2, 0),
      new THREE.MeshBasicMaterial({ color: "#ffc98a", transparent: true, opacity: 0.085, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    beam.position.set(cx + 0.6, CEILING - 0.23, cz + 0.35);
    beam.userData.keepDynamic = true;
    beam.renderOrder = 3;
    r.add(beam);
    this.deckLight.position.set(cx + 0.6, top + 1.5, cz + 0.6);
    r.add(this.deckLight);
    this.toolkit();
  }

  /** Inicio's open toolkit on the floor beside his spot: chipped red box, lid up, tray, tools, wire. */
  private toolkit() {
    const r = this.root;
    const { x, z } = TOOLKIT;
    const red = flat("#8e2a22", 0.6);
    box(r, 0.5, 0.2, 0.26, x, Y + 0.1, z, red);
    const lid = box(r, 0.5, 0.02, 0.26, x, Y + 0.32, z - 0.2, red);
    lid.rotation.x = -1.2;
    box(r, 0.46, 0.03, 0.22, x, Y + 0.2, z, STEEL); // cantilever tray
    box(r, 0.3, 0.02, 0.03, x + 0.05, Y + 0.23, z + 0.05, PROP_DARK); // screwdriver
    box(r, 0.22, 0.03, 0.03, x + 0.4, Y + 0.015, z + 0.15, STEEL); // spanner on the floor
    box(r, 0.04, 0.03, 0.18, x - 0.35, Y + 0.015, z + 0.1, flat("#c9a227", 0.6)); // soldering iron
    const wire = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 18), flat("#c45a1e", 0.6));
    wire.rotation.x = -Math.PI / 2;
    wire.position.set(x + 0.15, Y + 0.012, z + 0.32);
    r.add(wire);
    // A gutted CRT chassis he is working on.
    box(r, 0.34, 0.28, 0.3, x - 0.48, Y + 0.14, z - 0.12, flat("#7b7466", 0.7));
    box(r, 0.26, 0.2, 0.01, x - 0.48, Y + 0.15, z + 0.035, flat("#0c1a14", 0.3));
    this.collision.add({ x: x - 0.12, z, w: 0.95, d: 0.5, h: 0.35, tag: "toolkit" });
  }

  /** The turntable in its own (scaled) frame: plinth, spinning platter + slipmat, strobe ring, tonearm. */
  private turntable(tt: THREE.Group) {
    const px = -0.06; // platter centre (left of the plinth centre, tonearm on the right)
    box(tt, 0.52, 0.07, 0.42, 0, 0.035, 0, this.wood);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.176, 0.19, 48).rotateX(-Math.PI / 2), this.glow);
    ring.position.set(px, 0.0715, 0);
    tt.add(ring);
    box(tt, 0.05, 0.012, 0.035, -0.2, 0.076, 0.165, this.glow, {});
    box(tt, 0.02, 0.006, 0.16, 0.215, 0.073, 0.08, PROP_DARK, {});
    const platter = new THREE.Group();
    platter.position.set(px, 0.07, 0);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 48).translate(0, 0.015, 0), TT_PLATTER);
    const mat = new THREE.Mesh(new THREE.CircleGeometry(0.158, 48).rotateX(-Math.PI / 2), TT_SLIPMAT);
    mat.position.y = 0.0315;
    platter.add(plate, mat);
    tt.add(platter);
    // Tonearm: chrome post + arm + counterweight (one mesh) and a bright orange headshell.
    const arm = new THREE.Group();
    arm.position.set(0.19, 0.118, -0.15);
    const chrome = mergeGeometries([
      new THREE.CylinderGeometry(0.018, 0.022, 0.05, 12).translate(0, -0.025, 0),
      new THREE.CylinderGeometry(0.0075, 0.0075, 0.28, 8).rotateX(Math.PI / 2).translate(0, 0, 0.14),
      new THREE.CylinderGeometry(0.022, 0.022, 0.045, 12).rotateX(Math.PI / 2).translate(0, 0, -0.04),
    ])!;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.014, 0.055), TT_HEADSHELL);
    shell.position.set(0, -0.008, 0.29);
    arm.add(new THREE.Mesh(chrome, TT_CHROME), shell);
    arm.rotation.y = TONEARM_REST;
    tt.add(arm);
    platter.userData.keepDynamic = true;
    arm.userData.keepDynamic = true;
    this.platter = platter;
    this.tonearm = arm;
    this.deckAnchor.position.set(px, 0.07 + 0.0315, 0);
    tt.add(this.deckAnchor);
  }

  /** The till: worn counter with a brass kick rail, a brass mechanical cash register, the PAY HERE card (the clerk is in npcs.ts). */
  private counter() {
    const r = this.root;
    const cx = COUNTER.x,
      cz = COUNTER.z;
    const top = Y + 1.15;
    box(r, 3.6, 1.05, 0.9, cx, Y + 0.525, cz, this.wood);
    box(r, 3.8, 0.1, 1.05, cx, Y + 1.1, cz, this.wood);
    box(r, 3.5, 0.04, 0.04, cx, Y + 0.12, cz + 0.5, BRASS);
    this.collision.add({ x: cx, z: cz, w: 3.8, d: 1.05, h: 1.2, tag: "counter" });
    // Block the gap behind the counter so the player can't walk round to the clerk.
    this.collision.add({ x: cx + 2.4, z: cz - 0.6, w: 1.2, d: 1.8, h: 0, tag: "counter" });
    this.collision.add({ x: cx - 2.2, z: cz - 0.6, w: 0.8, d: 1.8, h: 0, tag: "counter" });
    // Mechanical register (right of the clerk), scaled up a touch so it reads on a projector.
    const reg = new THREE.Group();
    reg.position.set(cx + 1.0, top, cz + 0.02);
    reg.scale.setScalar(1.25);
    r.add(reg);
    box(reg, 0.5, 0.14, 0.42, 0, 0.07, 0, BRASS); // cash drawer base
    box(reg, 0.46, 0.08, 0.02, 0, 0.07, 0.215, this.wood, {}); // drawer front
    box(reg, 0.1, 0.02, 0.02, 0, 0.07, 0.23, STEEL, {}); // drawer pull
    const keyBank = new THREE.Group();
    keyBank.position.set(0, 0.2, 0.06);
    keyBank.rotation.x = 0.55;
    reg.add(keyBank);
    box(keyBank, 0.44, 0.12, 0.26, 0, 0, 0, BRASS);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 6; col++) {
        const key = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.04, 10), row === 3 && col > 3 ? flat("#8e2a22", 0.5) : PROP_CREAM);
        key.position.set(-0.17 + col * 0.068, 0.07, -0.09 + row * 0.06);
        keyBank.add(key);
      }
    box(reg, 0.42, 0.18, 0.18, 0, 0.3, -0.12, BRASS); // the ornate top housing
    box(reg, 0.36, 0.06, 0.1, 0, 0.42, -0.12, BRASS);
    // Crank on the right side.
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8).rotateZ(Math.PI / 2), STEEL);
    axle.position.set(0.29, 0.12, 0);
    reg.add(axle);
    box(reg, 0.02, 0.16, 0.03, 0.33, 0.06, 0, STEEL);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 8).rotateZ(Math.PI / 2), this.wood);
    handle.position.set(0.37, -0.01, 0);
    reg.add(handle);
    // Pop-up price flags in the window on top (one atlas cell each, on thin stems).
    const flags = ["1", "2", "50"].map((d) => this.signs.add(64, 56, (c, w, h) => drawFlag(c, w, h, d), 0.4));
    reg.updateMatrixWorld(true);
    flags.forEach((rect, i) => {
      const local = new THREE.Vector3(-0.09 + i * 0.09, 0.53, -0.12);
      box(reg, 0.006, 0.08, 0.006, local.x, 0.46, local.z, STEEL, {});
      const world = local.clone().applyMatrix4(reg.matrixWorld).sub(this.root.position);
      this.signs.quad(rect, 0.09, 0.08, world);
    });
    // Receipt spike, bags, and the hand-lettered PAY HERE card (propped on the counter + hung above).
    box(r, 0.4, 0.08, 0.44, cx - 1.45, top + 0.04, cz - 0.15, PROP_CREAM);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.16, 6), STEEL);
    spike.position.set(cx - 0.4, top + 0.08, cz + 0.2);
    r.add(spike);
    box(r, 0.1, 0.01, 0.1, cx - 0.4, top + 0.005, cz + 0.2, PROP_DARK);
    const card = this.signs.add(512, 320, drawPayHere, 0.1);
    this.signs.quad(card, 0.55, 0.34, new THREE.Vector3(cx - 0.75, top + 0.17, cz + 0.33), 0, new THREE.Euler(-0.25, 0.15, 0.03));
    this.signs.quad(card, 2.0, 1.25, new THREE.Vector3(cx, 3.45, cz - 0.15), 0, new THREE.Euler(0, 0, -0.03));
    for (const dx of [-0.85, 0.85]) box(r, 0.012, CEILING - 4.05, 0.012, cx + dx, (CEILING + 4.05) / 2, cz - 0.16, PROP_BLACK, {});
  }

  /** Poster wall, BY GENRE banner, boxes of stock, dead plants and a faded rug. */
  private decor() {
    const r = this.root;
    const wallZ = SHOP_INTERIOR.minZ + 0.035;
    const a = this.signs;
    const concert = a.add(384, 576, drawConcertPoster, 0);
    const tour = a.add(384, 576, drawTourPoster, 0);
    const flyerA = a.add(192, 264, (c, w, h) => drawFlyer(c, w, h, "#2e6f73", "#e8d9b0", 3), 0);
    const flyerB = a.add(192, 264, (c, w, h) => drawFlyer(c, w, h, "#d9cbb0", "#8e2a22", 7), 0);
    a.quad(concert, 1.15, 1.72, new THREE.Vector3(-1.75, 2.55, wallZ), 0, new THREE.Euler(0, 0, 0.015));
    a.quad(tour, 1.15, 1.72, new THREE.Vector3(-0.35, 2.6, wallZ + 0.004), 0, new THREE.Euler(0, 0, -0.02));
    a.quad(flyerA, 0.6, 0.82, new THREE.Vector3(1.05, 2.9, wallZ), 0, new THREE.Euler(0, 0, 0.05));
    a.quad(flyerB, 0.6, 0.82, new THREE.Vector3(1.85, 2.4, wallZ + 0.002), 0, new THREE.Euler(0, 0, -0.04));
    a.quad(concert, 0.8, 1.2, new THREE.Vector3(2.65, 2.95, wallZ), 0, new THREE.Euler(0, 0, 0.03)); // an older copy, half covered
    // BY GENRE banner across the centre aisle, facing the door.
    const genre = a.add(768, 200, drawBilingual("byGenre", { bg: "#1d1a17", ink: "#f2d49a", inkEn: "#c9b48a", border: "#7a5a2a", row: true, grime: 0.7 }), 0.6);
    a.quad(genre, 2.8, 0.73, new THREE.Vector3(0, 3.75, -5.6));
    for (const dx of [-1.25, 1.25]) box(r, 0.012, CEILING - 4.1, 0.012, dx, (CEILING + 4.1) / 2, -5.6, PROP_BLACK, {});
    // Boxes of stock against the back wall under the posters (clear of Inicio and the till).
    const card = flat("#8a6a45", 0.95);
    box(r, 0.6, 0.45, 0.5, 0.6, Y + 0.225, -13.6, card);
    box(r, 0.55, 0.4, 0.45, 0.65, Y + 0.65, -13.62, flat("#7a5c3a", 0.95));
    box(r, 0.6, 0.45, 0.5, 1.3, Y + 0.225, -13.58, card);
    box(r, 0.5, 0.36, 0.42, 2.1, Y + 0.18, -13.6, this.wood); // a crate of unsorted records
    this.collision.add({ x: 1.35, z: -13.6, w: 2.1, d: 0.55, h: 1.0, tag: "boxes" });
    const rug = box(r, 4.2, 0.012, 2.6, 0, Y + 0.01, -6, flat("#5a3a2e", 0.98), { receive: true });
    rug.castShadow = false;
    // Dead plants (seven years without water): pots and brittle brown leaves.
    for (const [x, z] of [
      [-8.4, -12.9],
      [8.4, -12.9],
      [-8.4, -1.0],
      [8.4, -1.0],
    ]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 12), flat("#8e5c42", 0.85));
      pot.position.set(x, Y + 0.25, z);
      r.add(pot);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), flat(i % 2 ? "#6b5434" : "#7d6a45", 0.95));
        leaf.position.set(x + Math.sin(i * 2.4) * 0.2, Y + 0.6 + (i % 3) * 0.18, z + Math.cos(i * 2.4) * 0.2);
        leaf.scale.set(0.6, 1.2, 0.6);
        leaf.rotation.z = (i - 2) * 0.3;
        r.add(leaf);
      }
      this.collision.add({ x, z, w: 0.6, d: 0.6, h: 0 });
    }
  }

  /** Drifting dust in the tungsten light (one instanced draw of tiny motes; skipped at low quality). */
  private makeDust() {
    const n = 240;
    const rand = rng(13);
    const motes = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.009, 0),
      new THREE.MeshBasicMaterial({ color: "#ffd9a8", transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      n,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) motes.setMatrixAt(i, m.makeTranslation(-8.5 + rand() * 17, Y + 0.4 + rand() * 3.9, -13.5 + rand() * 12.6));
    motes.instanceMatrix.needsUpdate = true;
    motes.userData.keepDynamic = true;
    motes.castShadow = false;
    motes.name = "shop-dust";
    this.dust = motes;
    this.root.add(motes);
  }

  /** Build the 10 genre sections and place each featured record face-out on its stand. */
  setRecords(records: WorldRecord[], items: RecordItems) {
    // Rebuild from scratch if called again.
    for (const s of this.sections) this.interactables.setEnabled(`record:${s.record.id}`, false);
    this.sections.length = 0;
    this.sectionGroup.clear();
    const group = new THREE.Group();
    this.sectionGroup.add(group);
    const list = records.slice(0, SECTION_SLOTS.length);
    const sleeves: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const signParts: THREE.BufferGeometry[] = [];
    const n = list.length;
    const atlas = sectionSignAtlas(list);
    const bin = this.wood;
    const board = flat("#2a2520", 0.85);
    const lightStrip = new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#ffcf96", emissiveIntensity: 1.3, toneMapped: false });
    list.forEach((record, i) => {
      const slot = SECTION_SLOTS[i];
      const unit = new THREE.Group();
      unit.position.set(slot.x, Y, slot.z);
      unit.rotation.y = slot.facing;
      group.add(unit);
      // Crate and backboard.
      box(unit, 2.2, 0.85, 1.0, 0, 0.425, -0.5, bin);
      box(unit, 2.3, 0.08, 1.08, 0, 0.86, -0.5, bin);
      box(unit, 2.3, 2.05, 0.1, 0, 1.025, -1.05, board);
      box(unit, 2.0, 0.04, 0.04, 0, 2.02, -0.96, lightStrip, {});
      // Hanging rods for the section sign.
      for (const dx of [-0.9, 0.9]) box(unit, 0.02, CEILING - Y - 2.9, 0.02, dx, (CEILING - Y + 2.9) / 2, -0.99, PROP_BLACK, {});
      // A small shelf ledge that holds the featured record.
      box(unit, 0.9, 0.05, 0.16, 0, 1.18, -0.93, bin);
      const anchor = new THREE.Object3D();
      anchor.position.set(0, 1.18 + 0.025 + 0.24, -0.93);
      anchor.rotation.x = -0.08;
      unit.add(anchor);
      // Filler sleeves standing in the crate (two columns), tinted from the palette and dulled by dust.
      unit.updateMatrixWorld(true);
      const palette = record.palette.length ? record.palette : ["#888"];
      const dusty = (c: THREE.Color, k: number) => c.lerp(new THREE.Color("#8a7d6a"), 0.25).multiplyScalar(k);
      for (let col = 0; col < 2; col++)
        for (let j = 0; j < 9; j++) {
          const local = new THREE.Matrix4().compose(
            new THREE.Vector3(-0.52 + col * 1.04, 0.95 + 0.06, -0.12 - j * 0.085),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.22 - ((j * 7) % 3) * 0.04, 0, ((j * 13) % 5) * 0.012 - 0.024)),
            new THREE.Vector3(1, 1, 1),
          );
          const c = dusty(new THREE.Color(palette[(i + col + j) % palette.length]), 0.72 + ((j * 37) % 10) / 30);
          sleeves.push({ m: unit.matrixWorld.clone().multiply(local), c });
        }
      // Spines on two little shelves either side of the featured record.
      for (const side of [-1, 1])
        for (let k = 0; k < 14; k++) {
          const local = new THREE.Matrix4().compose(
            new THREE.Vector3(side * (0.55 + k * 0.035), 1.21 + 0.155, -0.95),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)),
            new THREE.Vector3(1, 1, 1),
          );
          const c = dusty(new THREE.Color(palette[(k + (side > 0 ? 1 : 0)) % palette.length]), 0.68 + (k % 4) * 0.1);
          sleeves.push({ m: unit.matrixWorld.clone().multiply(local), c });
        }
      box(unit, 0.6, 0.04, 0.16, -0.8, 1.18, -0.93, bin);
      box(unit, 0.6, 0.04, 0.16, 0.8, 1.18, -0.93, bin);
      // Free-standing islands get a stocked back side too (spines facing the other aisle).
      if (slot.facing === 0)
        for (const shelfY of [0.55, 1.2]) {
          box(unit, 2.2, 0.04, 0.2, 0, shelfY, -1.2, bin);
          for (let k = 0; k < 52; k++) {
            const local = new THREE.Matrix4().compose(
              new THREE.Vector3(-1.02 + k * 0.04, shelfY + 0.175, -1.2),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, k % 7 === 3 ? 0.12 : 0)),
              new THREE.Vector3(1, 1, 1),
            );
            const c = dusty(new THREE.Color(palette[(k + Math.round(shelfY * 3)) % palette.length]), 0.62 + (k % 5) * 0.08);
            sleeves.push({ m: unit.matrixWorld.clone().multiply(local), c });
          }
        }
      // Section sign above the stand (geometry merged; texture from the shared atlas).
      const sign = new THREE.PlaneGeometry(2.2, 0.62);
      const uv = sign.getAttribute("uv");
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1 - uv.getY(k)) / n);
      sign.applyMatrix4(unit.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.62, -0.99)));
      signParts.push(sign);
      // Collision + interactable in front of the stand.
      const fx = Math.sin(slot.facing),
        fz = Math.cos(slot.facing);
      const cx = slot.x - fx * 0.55,
        cz = slot.z - fz * 0.55;
      const across = Math.abs(fx) > 0.5;
      this.collision.add({ x: cx, z: cz, w: across ? 1.1 : 2.3, d: across ? 2.3 : 1.1, h: 2.4, tag: "section" });
      const interact = { x: slot.x + fx * 0.95, z: slot.z + fz * 0.95 };
      this.interactables.register({ id: `record:${record.id}`, kind: "record", recordId: record.id, x: interact.x, z: interact.z, radius: 1.35 });
      const item = items.ensure(record);
      item.toShelf(anchor);
      this.sections.push({ record, anchor, interact });
    });
    group.traverse((m) => (m.castShadow = false));
    mergeFlatColors(group);
    batchStaticGeometry(group);
    if (signParts.length) {
      const signs = new THREE.Mesh(
        mergeGeometries(signParts)!,
        new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: "#ffffff", emissiveIntensity: 0.6, roughness: 0.8 }),
      );
      signs.name = "section-signs";
      this.sectionGroup.add(signs);
    }
    const sleeveMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.31, 0.31, 0.012), new THREE.MeshStandardMaterial({ roughness: 0.9 }), sleeves.length);
    sleeves.forEach((s, k) => {
      sleeveMesh.setMatrixAt(k, s.m);
      sleeveMesh.setColorAt(k, s.c);
    });
    sleeveMesh.instanceMatrix.needsUpdate = true;
    if (sleeveMesh.instanceColor) sleeveMesh.instanceColor.needsUpdate = true;
    sleeveMesh.castShadow = false;
    sleeveMesh.receiveShadow = true;
    sleeveMesh.name = "filler-sleeves";
    this.sectionGroup.add(sleeveMesh);
  }

  anchorFor(recordId: string) {
    return this.sections.find((s) => s.record.id === recordId)?.anchor;
  }

  registerStations() {
    this.interactables.register({ id: "deck", kind: "deck", x: DECK.interactX, z: DECK.interactZ, radius: 1.6 });
    this.interactables.register({ id: "cashier", kind: "cashier", x: COUNTER.interactX, z: COUNTER.interactZ, radius: 1.6 });
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
  }

  update(dt: number, elapsed: number) {
    if (this.playing) this.platter.rotation.y -= (dt * Math.PI * 2 * 33.333) / 60;
    const target = this.playing ? TONEARM_PLAY : TONEARM_REST;
    this.tonearm.rotation.y = THREE.MathUtils.lerp(this.tonearm.rotation.y, target, 1 - Math.exp(-dt * 4));
    this.playBlend = THREE.MathUtils.lerp(this.playBlend, this.playing ? 1 : 0, 1 - Math.exp(-dt * 3));
    const beat = Math.pow(Math.max(0, Math.sin(elapsed * Math.PI * 2 * (118 / 60))), 4); // ~118 bpm pulse
    this.vu.emissiveIntensity = this.playing ? 0.8 + Math.abs(Math.sin(elapsed * 9) * Math.sin(elapsed * 3.3)) * 2.5 : 0.5;
    this.glow.emissiveIntensity = 1.0 + this.playBlend * (1.0 + beat * 1.4);
    this.deckLight.intensity = 5 + this.playBlend * (7 + beat * 5);
    // Valves breathe a little (old tubes), brighter while playing.
    VALVE.emissiveIntensity = 2.2 + this.playBlend * 0.8 + Math.sin(elapsed * 7.3) * Math.sin(elapsed * 2.1) * 0.25;
    if (this.dust) {
      this.dust.position.y = Math.sin(elapsed * 0.21) * 0.08;
      this.dust.position.x = Math.sin(elapsed * 0.13) * 0.12;
    }
    this.updateEq(elapsed, this.playing);
  }

  /** Equalizer bars: idle = low dim row; playing = bouncing, bright. */
  private updateEq(elapsed: number, playing: boolean) {
    const colors = this.eq.instanceColor!.array as Float32Array;
    const level = playing ? 1.6 : 0.4;
    for (let i = 0; i < EQ_BARS; i++) {
      const x = (i - (EQ_BARS - 1) / 2) * 0.13;
      const h = playing
        ? 0.06 + 0.5 * Math.abs(Math.sin(elapsed * (3.1 + (i % 5) * 0.9) + i * 1.7) * Math.sin(elapsed * 1.3 + i * 0.4))
        : 0.035;
      this.eqMatrix.makeScale(1, h, 1).setPosition(x, 0, 0);
      this.eq.setMatrixAt(i, this.eqMatrix);
      for (let k = 0; k < 3; k++) colors[i * 3 + k] = this.eqColors[i * 3 + k] * level;
    }
    this.eq.instanceMatrix.needsUpdate = true;
    this.eq.instanceColor!.needsUpdate = true;
  }
}

/**
 * Merge every static, plain-coloured prop under `root` (untextured, non-emissive, opaque,
 * non-metal MeshStandardMaterial, e.g. cached flat() colours) into ONE vertex-coloured mesh
 * per shadow setting, so a room full of small differently coloured props costs a single
 * draw call. Run before batchStaticGeometry (which drops vertex colours). Roughness is
 * averaged per batch. Shared with atm.ts.
 */
const SURFACE_SET = new Set<THREE.Material>(Object.values(surfaces));
export function mergeFlatColors(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const batches = new Map<string, { meshes: THREE.Mesh[]; rough: number }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    for (let n: THREE.Object3D | null = m; n; n = n.parent) if (n.userData.keepDynamic) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat.isMeshStandardMaterial || SURFACE_SET.has(mat) || mat.userData.textured || mat.map || mat.normalMap || mat.transparent || mat.vertexColors || mat.metalness > 0.05) return;
    if (mat.emissiveIntensity > 0 && mat.emissive.getHex() !== 0) return;
    const key = `${m.castShadow}/${m.receiveShadow}`;
    if (!batches.has(key)) batches.set(key, { meshes: [], rough: 0 });
    const b = batches.get(key)!;
    b.meshes.push(m);
    b.rough += mat.roughness;
  });
  for (const [key, b] of batches) {
    if (b.meshes.length < 3) continue;
    const parts = b.meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
      if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, m.matrixWorld));
      const c = (m.material as THREE.MeshStandardMaterial).color;
      const n = g.getAttribute("position").count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      return g;
    });
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: b.rough / b.meshes.length, name: "flat-props" }));
    const [cast, receive] = key.split("/");
    mesh.castShadow = cast === "true";
    mesh.receiveShadow = receive === "true";
    mesh.userData.keepDynamic = true; // already merged; keep the batcher (which drops colours) off it
    mesh.name = "flat-props";
    b.meshes.forEach((m) => {
      m.removeFromParent();
      m.geometry.dispose();
    });
    root.add(mesh);
  }
}

function frame() {
  return flat("#24201c", 0.6);
}

// ─────────────────────────────── sign painters (all into the one shop atlas) ───────────────────────────────

/** Rng for the painters (deterministic). */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Neon tube lettering: a glowing coloured stroke with a hot pale core. */
function neonStroke(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, dead = false) {
  c.lineJoin = "round";
  if (dead) {
    c.shadowBlur = 0;
    c.strokeStyle = "#3a2630";
    c.lineWidth = size * 0.07;
    c.strokeText(text, x, y);
    return;
  }
  c.shadowColor = color;
  c.shadowBlur = size * 0.3;
  c.strokeStyle = color;
  c.lineWidth = size * 0.09;
  c.strokeText(text, x, y);
  c.shadowBlur = size * 0.08;
  c.strokeStyle = color === CYAN ? "#c8fbff" : "#ffb8e4";
  c.lineWidth = size * 0.022;
  c.strokeText(text, x, y);
  c.shadowBlur = 0;
}

/** SIGNS.saisei.jp (magenta) over SAISEI RECORDS (cyan, one dead tube) on a rusty steel board. */
function drawSaiseiNeon(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = "#161015";
  c.fillRect(0, 0, w, h);
  const rand = rng(31);
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(110,52,24,${0.1 + rand() * 0.25})`;
    c.fillRect(rand() * w, rand() * h * 0.3, 3 + rand() * 6, h * (0.3 + rand() * 0.7));
  }
  c.strokeStyle = "#2c2428";
  c.lineWidth = 10;
  c.strokeRect(8, 8, w - 16, h - 16);
  c.textAlign = "center";
  c.textBaseline = "middle";
  const jp = SIGNS.saisei.jp;
  const jpSize = fitFont(c, jp, w * 0.86, h * 0.56, JP_FONT, 700);
  neonStroke(c, jp, w / 2, h * 0.37, jpSize, MAGENTA);
  const en = SIGNS.saisei.en;
  const enSize = fitFont(c, en, w * 0.62, h * 0.22, EN_FONT, 700);
  // Letter by letter, so one tube can be dead.
  const widths = [...en].map((ch) => c.measureText(ch).width);
  const spacing = enSize * 0.18;
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (en.length - 1);
  let x = (w - total) / 2;
  c.textAlign = "left";
  [...en].forEach((ch, i) => {
    if (ch !== " ") neonStroke(c, ch, x, h * 0.8, enSize, CYAN, i === 9);
    x += widths[i] + spacing;
  });
  grime(c, w, h, 0.5, 91);
}

/** The tategaki lightbox: SIGNS.saisei.jp top to bottom, magenta on a dark box with cyan rails. */
function drawBlade(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = "#1a1219";
  c.fillRect(0, 0, w, h);
  c.shadowColor = CYAN;
  c.shadowBlur = 16;
  c.fillStyle = CYAN;
  c.fillRect(10, 10, 8, h - 20);
  c.fillRect(w - 18, 10, 8, h - 20);
  c.shadowBlur = 0;
  const chars = [...SIGNS.saisei.jp];
  const step = (h - 60) / chars.length;
  c.textAlign = "center";
  c.textBaseline = "middle";
  chars.forEach((ch, i) => {
    const size = fitFont(c, ch, w * 0.66, step * 0.86, JP_FONT, 700);
    // The long-vowel mark is horizontal in yokogaki; rotate it for vertical writing.
    c.save();
    c.translate(w / 2, 30 + step * (i + 0.5));
    if (ch === "\u30fc") c.rotate(Math.PI / 2);
    neonStroke(c, ch, 0, 0, size, MAGENTA, i === 4);
    c.restore();
  });
  grime(c, w, h, 0.6, 17);
}

/** Soot and leak streaks over the whole facade: dark under the cornice, runs below sills, grimy base. */
function drawFacadeSoot(c: CanvasRenderingContext2D, w: number, h: number) {
  const rand = rng(57);
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(22,16,12,0.55)");
  g.addColorStop(0.12, "rgba(22,16,12,0.08)");
  g.addColorStop(0.75, "rgba(22,16,12,0.0)");
  g.addColorStop(1, "rgba(30,22,16,0.5)");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // Leak streaks: from the cornice and from under each upper window sill.
  for (let i = 0; i < 90; i++) {
    const x = rand() * w;
    const y0 = rand() < 0.5 ? 0 : h * (0.12 + rand() * 0.3);
    const len = h * (0.1 + rand() * 0.45);
    const s = c.createLinearGradient(0, y0, 0, y0 + len);
    s.addColorStop(0, `rgba(25,20,14,${0.25 + rand() * 0.35})`);
    s.addColorStop(1, "rgba(25,20,14,0)");
    c.fillStyle = s;
    c.fillRect(x, y0, 2 + rand() * 10, len);
  }
  // Rust runs from the sign brackets.
  for (const fx of [0.3, 0.7]) {
    const s = c.createLinearGradient(0, h * 0.38, 0, h * 0.6);
    s.addColorStop(0, "rgba(120,58,22,0.6)");
    s.addColorStop(1, "rgba(120,58,22,0)");
    c.fillStyle = s;
    c.fillRect(w * fx - 4, h * 0.38, 8, h * 0.22);
  }
  // Edge wear: chipped corners down both ends.
  for (let i = 0; i < 60; i++) {
    const x = rand() < 0.5 ? rand() * 24 : w - rand() * 24;
    c.fillStyle = `rgba(${150 + rand() * 40},${140 + rand() * 30},${120 + rand() * 30},${0.2 + rand() * 0.3})`;
    c.fillRect(x, rand() * h, 3 + rand() * 8, 2 + rand() * 6);
  }
  grime(c, w, h, 0.7, 5);
}

/** Paint and an invented scrawled tag on the shutter slats (abstract loops, no real tag). */
function drawShutterTag(c: CanvasRenderingContext2D, w: number, h: number) {
  const rand = rng(77);
  c.lineCap = "round";
  c.strokeStyle = "rgba(240,240,235,0.75)";
  c.lineWidth = 9;
  c.beginPath();
  c.moveTo(w * 0.15, h * 0.7);
  for (let i = 0; i < 9; i++) c.quadraticCurveTo(w * (0.18 + i * 0.07), h * (0.15 + rand() * 0.3), w * (0.22 + i * 0.075), h * (0.55 + rand() * 0.3));
  c.stroke();
  c.strokeStyle = "rgba(255,63,180,0.7)";
  c.lineWidth = 5;
  c.stroke();
  // Rust bleeding from the slat seams.
  for (let i = 0; i < 30; i++) {
    c.fillStyle = `rgba(110,55,25,${0.15 + rand() * 0.3})`;
    c.fillRect(rand() * w, rand() * h, 4 + rand() * 20, 2 + rand() * 4);
  }
  grime(c, w, h, 1.2, 9);
}

/** Flaking gold-leaf window lettering. */
function paintLettering(c: CanvasRenderingContext2D, w: number, h: number, text: string) {
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "#d9b46a";
  fitFont(c, text, w * 0.94, h * 0.7, EN_FONT, 700);
  c.fillText(text, w / 2, h / 2);
  // Flaking: punch little holes out of the gilding.
  const rand = rng(text.length * 7);
  c.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 260; i++) c.fillRect(rand() * w, rand() * h, 2 + rand() * 6, 1 + rand() * 4);
  c.globalCompositeOperation = "source-over";
}

/** Grime on the shop glass: dusty corners, a hand-wiped patch, a taped crack. */
function drawWindowGrime(c: CanvasRenderingContext2D, w: number, h: number) {
  const g = c.createRadialGradient(w / 2, h * 0.55, h * 0.2, w / 2, h / 2, w * 0.6);
  g.addColorStop(0, "rgba(120,104,80,0)");
  g.addColorStop(1, "rgba(120,104,80,0.45)");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const b = c.createLinearGradient(0, h * 0.7, 0, h);
  b.addColorStop(0, "rgba(90,74,54,0)");
  b.addColorStop(1, "rgba(90,74,54,0.55)");
  c.fillStyle = b;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "rgba(230,235,235,0.6)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(w * 0.82, h * 0.1);
  c.lineTo(w * 0.78, h * 0.3);
  c.lineTo(w * 0.86, h * 0.42);
  c.lineTo(w * 0.8, h * 0.62);
  c.stroke();
  c.fillStyle = "rgba(200,180,130,0.75)"; // packing tape over the crack
  c.save();
  c.translate(w * 0.81, h * 0.33);
  c.rotate(0.6);
  c.fillRect(-50, -9, 100, 18);
  c.rotate(-1.2);
  c.fillRect(-50, -9, 100, 18);
  c.restore();
  grime(c, w, h, 1.2, 33);
}

/** The window CRT: an OPEN card (SIGNS.open) on a curved, scanlined tube. */
function drawOpenCrt(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = "#050505";
  c.fillRect(0, 0, w, h);
  c.save();
  c.beginPath();
  c.ellipse(w / 2, h / 2, w * 0.56, h * 0.62, 0, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = "#1a1210";
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#f1e4c4";
  c.fillRect(w * 0.12, h * 0.14, w * 0.76, h * 0.72);
  c.strokeStyle = "#c41e2a";
  c.lineWidth = 8;
  c.strokeRect(w * 0.15, h * 0.18, w * 0.7, h * 0.64);
  drawBilingual("open", { ink: "#c41e2a", inkEn: "#1a1a1a", jpShare: 0.6 })(
c, w, h);
  c.fillStyle = "rgba(0,0,0,0.3)";
  for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 2);
  const vig = c.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, w * 0.6);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.7)");
  c.fillStyle = vig;
  c.fillRect(0, 0, w, h);
  c.restore();
}

/** Hand-lettered cardboard: PAY HERE (SIGNS.payHere) in marker, with an arrow. */
function drawPayHere(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = "#b8956a";
  c.fillRect(0, 0, w, h);
  const rand = rng(19);
  for (let i = 0; i < 400; i++) {
    c.fillStyle = `rgba(90,62,36,${rand() * 0.25})`;
    c.fillRect(rand() * w, rand() * h, 2, 2);
  }
  c.save();
  c.translate(w / 2, h / 2);
  c.rotate(-0.04);
  c.translate(-w / 2, -h / 2);
  drawBilingual("payHere", { ink: "#1b1612", inkEn: "#8e1e1a", jpShare: 0.56 })(c, w, h * 0.9);
  c.restore();
  c.strokeStyle = "#8e1e1a";
  c.lineWidth = 7;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(w * 0.86, h * 0.72);
  c.lineTo(w * 0.86, h * 0.92);
  c.moveTo(w * 0.82, h * 0.86);
  c.lineTo(w * 0.86, h * 0.93);
  c.lineTo(w * 0.9, h * 0.86);
  c.stroke();
  grime(c, w, h, 0.9, 61);
}

/** A register pop-up flag: black tab, white digits. */
function drawFlag(c: CanvasRenderingContext2D, w: number, h: number, digits: string) {
  c.fillStyle = "#151311";
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#f3ead6";
  c.textAlign = "center";
  c.textBaseline = "middle";
  fitFont(c, digits, w * 0.8, h * 0.8, EN_FONT, 800);
  c.fillText(digits, w / 2, h * 0.55);
}

/** FIRST CONCERT OF NOZOMI · STADIUM ON THE HILL (SIGNS.concert / SIGNS.stadium): orange sky, a stadium bowl on its hill. */
function drawConcertPoster(c: CanvasRenderingContext2D, w: number, h: number) {
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#2a1838");
  sky.addColorStop(0.45, "#ff7a2f");
  sky.addColorStop(0.7, "#ffc070");
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#ffe2a8";
  c.beginPath();
  c.arc(w * 0.5, h * 0.6, w * 0.2, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#140c0c";
  c.beginPath();
  c.moveTo(0, h * 0.78);
  c.quadraticCurveTo(w * 0.5, h * 0.52, w, h * 0.78);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.fill();
  // The stadium bowl on the crest, with light towers.
  c.beginPath();
  c.ellipse(w * 0.5, h * 0.645, w * 0.24, h * 0.035, 0, Math.PI, 0);
  c.lineTo(w * 0.7, h * 0.68);
  c.lineTo(w * 0.3, h * 0.68);
  c.fill();
  for (const x of [0.28, 0.72]) c.fillRect(w * x, h * 0.55, 5, h * 0.1);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "#140c0c";
  fitFont(c, SIGNS.concert.jp, w * 0.88, h * 0.1, JP_FONT, 700);
  c.fillText(SIGNS.concert.jp, w / 2, h * 0.1);
  fitFont(c, SIGNS.concert.en, w * 0.86, h * 0.05, EN_FONT, 700);
  c.fillText(SIGNS.concert.en, w / 2, h * 0.19);
  c.fillStyle = "#ffcf8a";
  fitFont(c, SIGNS.stadium.jp, w * 0.7, h * 0.05, JP_FONT, 700);
  c.fillText(SIGNS.stadium.jp, w / 2, h * 0.86);
  fitFont(c, SIGNS.stadium.en, w * 0.7, h * 0.035, EN_FONT, 600);
  c.fillText(SIGNS.stadium.en, w / 2, h * 0.92);
  agePoster(c, w, h, 11);
}

/** The band's vintage tour poster: five CRT-headed silhouettes in a spotlight and "LIVE" (no band name). */
function drawTourPoster(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = "#1c1430";
  c.fillRect(0, 0, w, h);
  // Halftone dots.
  for (let y = 0; y < h; y += 14)
    for (let x = (y / 14) % 2 ? 7 : 0; x < w; x += 14) {
      c.fillStyle = "rgba(255,63,180,0.18)";
      c.beginPath();
      c.arc(x, y, 3 + (y / h) * 3, 0, Math.PI * 2);
      c.fill();
    }
  const spot = c.createRadialGradient(w / 2, h * 0.62, 10, w / 2, h * 0.62, w * 0.55);
  spot.addColorStop(0, "#ffb35c");
  spot.addColorStop(1, "rgba(255,122,47,0)");
  c.fillStyle = spot;
  c.fillRect(0, h * 0.25, w, h * 0.75);
  // Five silhouettes: boxy screen heads with antennas, guitar necks, a drum kit.
  c.fillStyle = "#0d0a10";
  c.strokeStyle = "#0d0a10";
  c.lineWidth = 4;
  [0.14, 0.32, 0.5, 0.68, 0.86].forEach((fx, i) => {
    const x = w * fx,
      base = h * (i === 2 ? 0.86 : 0.9),
      tall = h * (i === 2 ? 0.3 : 0.27);
    c.fillRect(x - 22, base - tall, 44, tall); // body
    c.fillRect(x - 30, base - tall - 52, 60, 48); // screen head
    c.beginPath();
    c.moveTo(x - 10, base - tall - 52);
    c.lineTo(x - 22, base - tall - 82);
    c.moveTo(x + 10, base - tall - 52);
    c.lineTo(x + 24, base - tall - 80);
    c.stroke();
    if (i === 1 || i === 3) {
      c.beginPath();
      c.moveTo(x - 30, base - tall * 0.4);
      c.lineTo(x + 50, base - tall * 0.95);
      c.lineWidth = 7;
      c.stroke();
      c.lineWidth = 4;
    }
  });
  c.beginPath();
  c.ellipse(w * 0.5, h * 0.93, w * 0.12, h * 0.04, 0, 0, Math.PI * 2);
  c.fill();
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "#f3e2b8";
  fitFont(c, "LIVE", w * 0.8, h * 0.2, EN_FONT, 800);
  c.fillText("LIVE", w / 2, h * 0.14);
  c.fillStyle = CYAN;
  fitFont(c, "ONE NIGHT · ONE CITY", w * 0.7, h * 0.04, EN_FONT, 600);
  c.fillText("ONE NIGHT · ONE CITY", w / 2, h * 0.27);
  agePoster(c, w, h, 23);
}

/** A generic old flyer: blocks of colour and fake "text" rules (nothing legible). */
function drawFlyer(c: CanvasRenderingContext2D, w: number, h: number, bg: string, ink: string, seed: number) {
  const rand = rng(seed);
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.fillStyle = ink;
  c.fillRect(w * 0.1, h * 0.08, w * 0.8, h * 0.28);
  for (let i = 0; i < 8; i++) c.fillRect(w * 0.1, h * (0.45 + i * 0.055), w * (0.4 + rand() * 0.4), h * 0.02);
  agePoster(c, w, h, seed);
}

/** Fading, creases, a torn corner and tape: posters that have hung for seven years. */
function agePoster(c: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const rand = rng(seed);
  c.fillStyle = "rgba(235,220,190,0.18)";
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "rgba(255,245,225,0.35)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, h * 0.5);
  c.lineTo(w, h * 0.5 + (rand() - 0.5) * 10);
  c.moveTo(w * 0.5, 0);
  c.lineTo(w * 0.5 + (rand() - 0.5) * 10, h);
  c.stroke();
  // Torn corner.
  c.globalCompositeOperation = "destination-out";
  c.beginPath();
  c.moveTo(w, h);
  c.lineTo(w - w * (0.15 + rand() * 0.15), h);
  for (let k = 0; k < 6; k++) c.lineTo(w - w * 0.2 * (1 - k / 6) + rand() * 8, h - h * 0.12 * (k / 6) - rand() * 8);
  c.lineTo(w, h - h * (0.1 + rand() * 0.1));
  c.fill();
  c.globalCompositeOperation = "source-over";
  c.fillStyle = "rgba(220,205,160,0.7)";
  c.fillRect(w * 0.02, h * 0.01, w * 0.14, h * 0.035);
  c.fillRect(w * 0.84, h * 0.01, w * 0.14, h * 0.035);
  grime(c, w, h, 1.1, seed * 3);
}

/** One canvas holding all 10 section signs stacked vertically (one texture, one draw call). */
function sectionSignAtlas(records: WorldRecord[]) {
  const n = Math.max(1, records.length);
  const w = 1024,
    rowH = 288;
  return canvasTexture(w, rowH * n, (c) => {
    records.forEach((record, i) => {
      const y = i * rowH;
      const bg = record.palette[0] ?? "#222";
      const accent = pickAccent(record.palette);
      c.fillStyle = "#121514";
      c.fillRect(0, y, w, rowH);
      c.fillStyle = bg;
      c.fillRect(10, y + 10, w - 20, rowH - 20);
      c.fillStyle = "rgba(20,14,10,0.45)";
      c.fillRect(10, y + 10, w - 20, rowH - 20);
      c.strokeStyle = accent;
      c.lineWidth = 12;
      c.strokeRect(24, y + 24, w - 48, rowH - 48);
      c.fillStyle = "#f6ecd8";
      c.textAlign = "center";
      c.textBaseline = "middle";
      fitText(c, record.section.toUpperCase(), w - 120, 150);
      c.fillText(record.section.toUpperCase(), w / 2, y + rowH * 0.44);
      c.fillStyle = accent;
      fitText(c, `${i + 1 < 10 ? "0" : ""}${i + 1} · FEATURED: ${record.title.toUpperCase()}`, w - 140, 38, 500);
      c.fillText(`${i + 1 < 10 ? "0" : ""}${i + 1} · FEATURED: ${record.title.toUpperCase()}`, w / 2, y + rowH * 0.8);
      c.save();
      c.translate(0, y);
      grime(c, w, rowH, 0.6, 7 + i * 13);
      c.restore();
    });
  });
}

/** The brightest palette colour, for sign borders. */
function pickAccent(palette: string[]) {
  let best = "#ffd08a",
    bestL = -1;
  for (const p of palette) {
    const c = new THREE.Color(p);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    const score = hsl.s * 0.6 + hsl.l * 0.4 + (hsl.l > 0.85 ? -0.3 : 0);
    if (score > bestL) {
      bestL = score;
      best = p;
    }
  }
  return best;
}
