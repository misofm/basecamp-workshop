/**
 * The record shop: building shell, illuminated facade, interior, genre sections,
 * listening deck and counter.
 *
 * Owns: the shop's walls (with a real doorway onto the street), the big lit
 * "miso records" sign, interior lighting, the 10 genre sections built by
 * setShopRecords (bin + big section sign + face-out featured record stand + filler
 * sleeves), the listening deck (platter spin, tonearm) and the counter. Registers the
 * "record:<id>", "deck" and "cashier" interactables and all interior collision.
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
import { canvasTexture, fitText, FONT_STACK, signMesh } from "./labels";
import { RecordItems } from "./record-item";

const Y = SHOP_FLOOR_Y;
/** Turntables are modelled at real size and drawn at twice that, so the deck reads on a projector. */
const TT_SCALE = 2;
const TONEARM_REST = 0.05;
const TONEARM_PLAY = -0.6;
const EQ_BARS = 20;
/** A small shared palette for props, so the batcher merges them into a few draw calls. */
const PROP_DARK = flat("#1d2422", 0.5);
const PROP_BLACK = flat("#1b1f1e", 0.5);
const PROP_LIGHT = flat("#c9cdd1", 0.4);
const PROP_CREAM = flat("#e6d3b0", 0.9);
const BULB = new THREE.MeshStandardMaterial({ color: "#fff3d6", emissive: "#ffe0b0", emissiveIntensity: 4, toneMapped: false });
const TT_SILVER = new THREE.MeshStandardMaterial({ color: "#c3c8cc", metalness: 0.6, roughness: 0.35 });
const TT_PLATTER = new THREE.MeshStandardMaterial({ color: "#5d646b", metalness: 0.7, roughness: 0.3 });
const TT_CHROME = new THREE.MeshStandardMaterial({ color: "#e4e8ec", metalness: 0.85, roughness: 0.18 });
const TT_HEADSHELL = new THREE.MeshStandardMaterial({ color: "#ff8a3c", emissive: "#ff6a1a", emissiveIntensity: 0.6, roughness: 0.4 });
const TT_SLIPMAT = new THREE.MeshStandardMaterial({ color: "#ffb35c", roughness: 0.9 });
const WALL_H = 5;
const CEILING = 4.6;

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
  private sectionGroup = new THREE.Group();
  private platter!: THREE.Group;
  private tonearm!: THREE.Group;
  private playing = false;
  private playBlend = 0;
  private vu: THREE.MeshStandardMaterial;
  /** Shared warm glow: console LED edge, strobe rings, speaker strips, till edge. Brightens while playing. */
  private glow = new THREE.MeshStandardMaterial({ color: "#ffb35c", emissive: "#ff9a3c", emissiveIntensity: 1.2, toneMapped: false });
  private eq!: THREE.InstancedMesh;
  private eqColors!: Float32Array;
  private eqMatrix = new THREE.Matrix4();
  /** The station's one real light (the shop's 6th and last PointLight): swells while playing. */
  private deckLight = new THREE.PointLight("#ffd2a0", 6, 6.5, 1.6);
  constructor(
    scene: THREE.Scene,
    private collision: Collision,
    private interactables: Interactables,
  ) {
    this.root.name = "shop";
    scene.add(this.root);
    this.root.add(this.sectionGroup);
    this.vu = new THREE.MeshStandardMaterial({ color: "#222", emissive: "#7cff9a", emissiveIntensity: 0.4 });
    this.shell();
    // Only the shell casts (moonlight) shadows; the interior is lit by non-shadowing point lights.
    const shellCount = this.root.children.length;
    this.facade();
    this.lighting();
    this.deck();
    this.counter();
    this.decor();
    this.root.children.slice(shellCount).forEach((o) => o.traverse((m) => (m.castShadow = false)));
    batchStaticGeometry(this.root);
  }

  /** Floor, walls with the doorway, ceiling and roof. */
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
    // Front wall: piers, window sills/headers, the doorway, and a tall parapet for the sign.
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
    const glass = new THREE.MeshPhysicalMaterial({ color: "#8fb3b8", roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
    const frame = flat("#1d2422", 0.5);
    for (const [x0, x1] of windows) {
      const cx = (x0 + x1) / 2,
        w = x1 - x0;
      box(r, w, 0.75, t, cx, Y + 0.375, fz, surfaces.darkBrick);
      box(r, w, WALL_H - 3.7, t, cx, (WALL_H + 3.7) / 2, fz, brick);
      // Panes cast (moonlight) shadows so the interior reads as lit by its own warm lamps.
      const pane = box(r, w, 2.95, 0.03, cx, Y + 0.75 + 1.4, fz, glass, { cast: true });
      pane.userData.keepDynamic = true;
      pane.renderOrder = 4;
      box(r, w, 0.08, 0.36, cx, Y + 0.78, fz, frame);
      box(r, w, 0.1, 0.36, cx, 3.66, fz, frame);
      for (let x = x0 + w / 3; x < x1 - 0.1; x += w / 3) box(r, 0.07, 2.9, 0.36, x, Y + 2.2, fz, frame);
    }
    // Door header and frame (open doorway).
    box(r, hw * 2, WALL_H - 3.2, t, 0, (WALL_H + 3.2) / 2, fz, brick);
    for (const x of [-hw, hw]) box(r, 0.12, 3.2, 0.4, x, 1.6, fz, frame);
    box(r, hw * 2 + 0.24, 0.14, 0.4, 0, 3.2, fz, frame);
    this.collision.addBounds(minX - t, -0.3, -hw, 0, WALL_H, "shop-front");
    this.collision.addBounds(hw, -0.3, maxX + t, 0, WALL_H, "shop-front");
    // Low parapet above the shopfront.
    box(r, maxX - minX + 2 * t, 1.0, t, 0, WALL_H + 0.5, fz, surfaces.darkBrick);
    box(r, maxX - minX + 2 * t + 0.3, 0.18, 0.6, 0, WALL_H + 1.0, fz, frame);
    // Ceiling (seen from inside) and roof slab.
    const ceiling = box(r, maxX - minX, 0.08, -minZ, 0, CEILING + 0.04, minZ / 2, surfaces.plaster, { receive: true });
    ceiling.castShadow = false;
    box(r, maxX - minX + 2 * t, 0.3, -minZ + t, 0, WALL_H + 0.15, minZ / 2 - 0.15, flat("#3c3f3e", 0.9), { cast: true });
    // Wainscot inside.
    box(r, maxX - minX, 1.1, 0.06, 0, Y + 0.55, minZ + 0.03, surfaces.paint);
    box(r, 0.06, 1.1, -minZ - 0.3, minX + 0.03, Y + 0.55, minZ / 2 - 0.15, surfaces.paint);
    box(r, 0.06, 1.1, -minZ - 0.3, maxX - 0.03, Y + 0.55, minZ / 2 - 0.15, surfaces.paint);
  }

  /** Big illuminated sign, awnings, door light and window lettering — must read instantly on a projector. */
  private facade() {
    const r = this.root;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 1.84),
      (() => {
        const tex = canvasTexture(2048, 376, (c, w, h) => {
          c.fillStyle = "#141918";
          c.fillRect(0, 0, w, h);
          c.strokeStyle = "#ffb35c";
          c.lineWidth = 14;
          c.strokeRect(18, 18, w - 36, h - 36);
          c.textBaseline = "middle";
          c.textAlign = "left";
          c.font = `700 250px ${FONT_STACK}`;
          const a = "miso",
            b = " records";
          const wa = c.measureText(a).width;
          c.font = `500 210px ${FONT_STACK}`;
          const wb = c.measureText(b).width;
          const x = (w - wa - wb - 90) / 2;
          c.fillStyle = "#ffb35c";
          c.beginPath();
          c.arc(x + 35, h / 2 + 10, 34, 0, Math.PI * 2);
          c.fill();
          c.font = `700 250px ${FONT_STACK}`;
          c.fillStyle = "#ffcf8a";
          c.fillText(a, x + 90, h / 2);
          c.font = `500 210px ${FONT_STACK}`;
          c.fillStyle = "#fff4e0";
          c.fillText(b, x + 90 + wa, h / 2 + 8);
        });
        const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: "#ffffff", emissiveIntensity: 1.05, roughness: 0.6 });
        m.toneMapped = true;
        return m;
      })(),
    );
    // Sits on the brick band between the windows and the roofline, low enough to read from the sidewalk.
    sign.position.set(0, 4.62, 0.04);
    sign.userData.keepDynamic = true;
    r.add(sign);
    // Window lettering and a neon OPEN sign.
    const lettering = signMesh("NEW & USED VINYL", 4.6, 0.5, { bg: "rgba(0,0,0,0)", ink: "#ffe7b8", glow: 0.9 });
    (lettering.material as THREE.MeshStandardMaterial).transparent = true;
    lettering.position.set(-5.2, Y + 3.15, 0.03);
    r.add(lettering);
    const listen = signMesh("LISTEN BEFORE YOU BUY", 4.6, 0.5, { bg: "rgba(0,0,0,0)", ink: "#ffe7b8", glow: 0.9 });
    (listen.material as THREE.MeshStandardMaterial).transparent = true;
    listen.position.set(5.2, Y + 3.15, 0.03);
    r.add(listen);
    const open = signMesh("OPEN", 1.1, 0.42, { bg: "#111", ink: "#ff5c7a", glow: 2.5, border: "#ff5c7a" });
    open.position.set(-2.95, Y + 2.2, 0.04);
    r.add(open);
    // Doormat.
    const mat = signMesh("COME ON IN", 2.2, 0.8, { bg: "#33473f", ink: "#e9cf9a" });
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(0, Y + 0.012, -1.1);
    r.add(mat);
  }

  /** Warm interior: three point lights + glowing pendant fixtures; one warm light over the door. */
  private lighting() {
    const r = this.root;
    for (const [x, z] of [
      [-4.5, -4.2],
      [4.5, -4.2],
      [0, -10.6],
    ]) {
      const light = new THREE.PointLight("#ffcf9a", 42, 15, 1.6);
      light.position.set(x, 3.9, z);
      r.add(light);
    }
    const bulb = BULB;
    const shade = flat("#24413a", 0.6);
    for (const x of [-4.5, 0, 4.5])
      for (const z of [-2.5, -6.5, -10.6]) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.32, 16, 1, true), shade);
        s.position.set(x, 3.95, z);
        r.add(s);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 6), bulb);
        b.position.set(x, 3.82, z);
        r.add(b);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 4), shade);
        cord.position.set(x, 4.35, z);
        r.add(cord);
      }
    const doorLight = new THREE.PointLight("#ffc98a", 26, 10, 1.6);
    doorLight.position.set(0, 3.6, 1.6);
    r.add(doorLight);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.35), bulb);
    lamp.position.set(0, 3.45, 0.25);
    r.add(lamp);
  }

  /**
   * The listening station, built as the shop's hero spot: a DJ console with a big
   * turntable (right of centre, so the player standing at the deck interactable never
   * blocks it from the default over-the-shoulder camera), a sampler, a mixer
   * with VU lights, an equalizer strip and LED edge that come alive while a record
   * plays, floor speakers, headphones on a hook, a lit sign hanging directly above and
   * a soft spotlight cone (plus one real light that swells while playing).
   */
  private deck() {
    const r = this.root;
    const top = Y + 1.0;
    const cx = DECK.x,
      cz = DECK.z;
    const W = 3.4,
      D = 1.1;
    const front = cz + D / 2;
    // Console: body, black top slab, glowing LED edge.
    box(r, W, 0.92, D - 0.12, cx, Y + 0.46, cz - 0.04, PROP_DARK);
    box(r, W + 0.12, 0.08, D + 0.06, cx, top - 0.04, cz, PROP_BLACK);
    box(r, W + 0.1, 0.035, 0.02, cx, top - 0.1, front + 0.035, this.glow, {});
    this.collision.add({ x: cx, z: cz, w: W + 0.12, d: D + 0.06, h: 1.1, tag: "deck" });
    // Equalizer strip on the front panel (one instanced draw; animated in update()).
    const bar = new THREE.BoxGeometry(0.1, 1, 0.02).translate(0, 0.5, 0);
    this.eq = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ toneMapped: false }), EQ_BARS);
    this.eq.userData.keepDynamic = true;
    this.eq.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < EQ_BARS; i++) {
      this.eq.setColorAt(i, new THREE.Color().setHSL(0.08 - (i / EQ_BARS) * 0.62, 0.95, 0.55));
    }
    this.eqColors = Float32Array.from(this.eq.instanceColor!.array);
    this.eq.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.eq.position.set(cx + 0.15, Y + 0.2, front - 0.05);
    r.add(this.eq);
    this.updateEq(0, false);
    // The live turntable (right), a sampler with glowing pads (left), mixer in between.
    const live = new THREE.Group();
    live.position.set(cx + 0.85, top, cz - 0.02);
    live.rotation.x = 0.1; // tilted a touch toward the camera so the record reads
    live.scale.setScalar(TT_SCALE);
    r.add(live);
    this.turntable(live);
    box(r, 0.9, 0.08, 0.72, cx - 0.85, top + 0.04, cz - 0.02, PROP_DARK);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 4; col++)
        box(r, 0.15, 0.03, 0.12, cx - 1.12 + col * 0.18, top + 0.095, cz - 0.24 + row * 0.15, (row + col) % 3 === 0 ? this.glow : PROP_LIGHT, {});
    // Mixer: body, faders, knobs, two VU columns.
    const knob = PROP_LIGHT;
    box(r, 0.56, 0.07, 0.8, cx, top + 0.035, cz - 0.02, PROP_DARK);
    for (const dx of [-0.12, 0.12]) {
      box(r, 0.05, 0.035, 0.1, cx + dx, top + 0.085, cz + 0.16, knob);
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12), knob);
        c.position.set(cx + dx, top + 0.085, cz - 0.3 + k * 0.12);
        r.add(c);
      }
      box(r, 0.035, 0.01, 0.3, cx + dx * 0.4, top + 0.075, cz - 0.15, this.vu, {});
    }
    box(r, 0.16, 0.035, 0.05, cx, top + 0.085, cz + 0.3, knob);
    // Floor speakers either side.
    const cabinet = PROP_DARK;
    const coneMat = PROP_BLACK;
    for (const dx of [-2.05, 2.05]) {
      box(r, 0.58, 1.35, 0.5, cx + dx, Y + 0.675, cz - 0.1, cabinet);
      this.collision.add({ x: cx + dx, z: cz - 0.1, w: 0.62, d: 0.54, h: 1.4, tag: "deck" });
      for (const [y, rad] of [
        [0.42, 0.2],
        [0.98, 0.1],
      ]) {
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.03, 20), coneMat);
        cone.rotation.x = Math.PI / 2;
        cone.position.set(cx + dx, Y + y, cz + 0.16);
        r.add(cone);
      }
      box(r, 0.44, 0.02, 0.02, cx + dx, Y + 1.25, cz + 0.16, this.glow, {});
    }
    // Headphones on a hook at the console's front-left corner.
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
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.065, 16), this.glow);
      pad.rotation.x = Math.PI / 2;
      pad.position.set(sx, -0.15, 0.003);
      phones.add(pad);
    }
    // Lit sign hanging directly above the console, with its rods.
    const sign = signMesh("LISTENING STATION", 3.0, 0.6, { bg: "#141b19", ink: "#ffd08a", glow: 1.6, border: "#ffb35c" });
    sign.position.set(cx, 3.6, cz - 0.35);
    r.add(sign);
    for (const dx of [-1.3, 1.3]) box(r, 0.02, CEILING - 3.9, 0.02, cx + dx, (CEILING + 3.9) / 2, cz - 0.36, PROP_BLACK, {});
    // Spotlight: ceiling can, glowing lens, and an additive light cone onto the live deck.
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 16), PROP_DARK);
    can.position.set(cx + 0.6, CEILING - 0.11, cz + 0.35);
    r.add(can);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16).rotateX(Math.PI / 2), BULB);
    lens.position.set(cx + 0.6, CEILING - 0.225, cz + 0.35);
    r.add(lens);
    const beamHeight = CEILING - 0.23 - (top + 0.05);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 1.25, beamHeight, 28, 1, true).translate(0, -beamHeight / 2, 0),
      new THREE.MeshBasicMaterial({ color: "#ffd9a8", transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    beam.position.set(cx + 0.6, CEILING - 0.23, cz + 0.35);
    beam.userData.keepDynamic = true;
    beam.renderOrder = 3;
    r.add(beam);
    this.deckLight.position.set(cx + 0.6, top + 1.5, cz + 0.6);
    r.add(this.deckLight);
  }

  /** The turntable in its own (scaled) frame: plinth, spinning platter + slipmat, strobe ring, tonearm. */
  private turntable(tt: THREE.Group) {
    const px = -0.06; // platter centre (left of the plinth centre, tonearm on the right)
    box(tt, 0.52, 0.07, 0.42, 0, 0.035, 0, TT_SILVER);
    // Strobe ring around the platter and the start button: share the console glow material.
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

  /** The till: counter, cash register, card terminal, and a lit "PAY HERE" sign hung above (the clerk is in npcs.ts). */
  private counter() {
    const r = this.root;
    const cx = COUNTER.x,
      cz = COUNTER.z;
    const top = Y + 1.15;
    box(r, 3.6, 1.05, 0.9, cx, Y + 0.525, cz, surfaces.paint);
    box(r, 3.8, 0.1, 1.05, cx, Y + 1.1, cz, surfaces.wood);
    box(r, 3.7, 0.035, 0.02, cx, Y + 1.03, cz + 0.535, this.glow, {}); // warm LED edge, like the deck
    this.collision.add({ x: cx, z: cz, w: 3.8, d: 1.05, h: 1.2, tag: "counter" });
    // Block the gap behind the counter so the player can't walk round to the clerk.
    this.collision.add({ x: cx + 2.4, z: cz - 0.6, w: 1.2, d: 1.8, h: 0, tag: "counter" });
    this.collision.add({ x: cx - 2.2, z: cz - 0.6, w: 0.8, d: 1.8, h: 0, tag: "counter" });
    // Cash register (right of the clerk): body, sloped keypad, drawer, customer display on a pole.
    const regX = cx + 1.05,
      regZ = cz + 0.05;
    const shell = PROP_DARK;
    box(r, 0.6, 0.2, 0.5, regX, top + 0.1, regZ, shell);
    const keys = box(r, 0.5, 0.05, 0.28, regX, top + 0.23, regZ + 0.08, PROP_LIGHT);
    keys.rotation.x = 0.35;
    box(r, 0.56, 0.06, 0.02, regX, top + 0.06, regZ + 0.26, this.glow); // drawer handle strip
    box(r, 0.04, 0.32, 0.04, regX + 0.18, top + 0.36, regZ - 0.16, shell);
    const display = signMesh("THANK YOU", 0.42, 0.16, { bg: "#062018", ink: "#59f0b8", glow: 2.2 });
    display.position.set(regX + 0.18, top + 0.58, regZ - 0.13);
    display.rotation.x = -0.15;
    r.add(display);
    const displayBox = box(r, 0.46, 0.2, 0.05, regX + 0.18, top + 0.58, regZ - 0.165, shell);
    displayBox.rotation.x = -0.15;
    // Card terminal on its stand at the customer's edge (left of the clerk).
    const termX = cx - 0.95,
      termZ = cz + 0.3;
    box(r, 0.1, 0.06, 0.1, termX, top + 0.03, termZ, shell);
    const terminal = new THREE.Group();
    terminal.position.set(termX, top + 0.16, termZ);
    terminal.rotation.x = -0.75; // screen tipped up toward the customer
    terminal.scale.setScalar(1.4);
    r.add(terminal);
    box(terminal, 0.17, 0.3, 0.05, 0, 0, 0, PROP_DARK);
    const termScreen = signMesh("TAP", 0.13, 0.1, { bg: "#03141c", ink: "#6fe3ff", glow: 2.4, sub: "))))" });
    termScreen.position.set(0, 0.07, 0.027);
    terminal.add(termScreen);
    box(terminal, 0.13, 0.12, 0.01, 0, -0.06, 0.027, PROP_LIGHT, {});
    // Receipt roll and a little stack of bags.
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 14), PROP_CREAM);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(regX - 0.42, top + 0.05, regZ - 0.05);
    r.add(roll);
    box(r, 0.4, 0.08, 0.44, cx - 1.45, top + 0.04, cz - 0.15, PROP_CREAM);
    // The big lit sign, hung from the ceiling right above the till.
    const sign = signMesh("PAY HERE", 2.4, 0.78, { bg: "#141b19", ink: "#ffd08a", glow: 1.6, border: "#ffb35c", sub: "▼  TILL  ▼" });
    sign.position.set(cx, 3.55, cz - 0.15);
    r.add(sign);
    for (const dx of [-1.0, 1.0]) box(r, 0.02, CEILING - 3.94, 0.02, cx + dx, (CEILING + 3.94) / 2, cz - 0.16, PROP_BLACK, {});
    const front = signMesh("GOOD FINDS", 2.4, 0.4, { bg: "#3f5a50", ink: "#f0d9a8" });
    front.position.set(cx, Y + 0.65, cz + 0.46);
    this.root.add(front);
  }

  /** Posters, a long back-wall shelf, plants and a rug: lived-in detail (all batched). */
  private decor() {
    const r = this.root;
    const poster = signMesh("LOSE YOURSELF IN A GOOD RECORD", 4.2, 0.55, { bg: "#dc754f", ink: "#fff1d0" });
    poster.position.set(0, 3.55, SHOP_INTERIOR.minZ + 0.06);
    r.add(poster);
    const rug = box(r, 4.2, 0.012, 2.6, 0, Y + 0.01, -6, flat("#7a4b3a", 0.95), { receive: true });
    rug.castShadow = false;
    for (const [x, z] of [
      [-8.4, -12.9],
      [8.4, -12.9],
      [-8.4, -1.0],
      [8.4, -1.0],
    ]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 12), flat("#b97755", 0.8));
      pot.position.set(x, Y + 0.25, z);
      r.add(pot);
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), flat(i % 2 ? "#3d6b47" : "#5b8148", 0.9));
        leaf.position.set(x + Math.sin(i * 2.4) * 0.2, Y + 0.75 + (i % 3) * 0.22, z + Math.cos(i * 2.4) * 0.2);
        leaf.scale.set(0.8, 1.4, 0.8);
        r.add(leaf);
      }
      this.collision.add({ x, z, w: 0.6, d: 0.6, h: 0 });
    }
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
    const bin = surfaces.wood;
    const board = flat("#2a3b35", 0.8);
    const lightStrip = new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#ffe6bf", emissiveIntensity: 3, toneMapped: false });
    list.forEach((record, i) => {
      const slot = SECTION_SLOTS[i];
      const unit = new THREE.Group();
      unit.position.set(slot.x, Y, slot.z);
      unit.rotation.y = slot.facing;
      group.add(unit);
      // Crate and backboard.
      box(unit, 2.2, 0.85, 1.0, 0, 0.425, -0.5, bin);
      box(unit, 2.3, 0.08, 1.08, 0, 0.86, -0.5, surfaces.wood);
      box(unit, 2.3, 2.05, 0.1, 0, 1.025, -1.05, board);
      box(unit, 2.0, 0.05, 0.05, 0, 2.02, -0.96, lightStrip, {});
      // Hanging rods for the section sign.
      for (const dx of [-0.9, 0.9]) box(unit, 0.02, CEILING - Y - 2.9, 0.02, dx, (CEILING - Y + 2.9) / 2, -0.99, flat("#1b1f1e", 0.5), {});
      // A small shelf ledge that holds the featured record.
      box(unit, 0.9, 0.05, 0.16, 0, 1.18, -0.93, surfaces.wood);
      const anchor = new THREE.Object3D();
      anchor.position.set(0, 1.18 + 0.025 + 0.24, -0.93);
      anchor.rotation.x = -0.08;
      unit.add(anchor);
      // Filler sleeves standing in the crate (two columns), tinted from the palette.
      unit.updateMatrixWorld(true);
      const palette = record.palette.length ? record.palette : ["#888"];
      for (let col = 0; col < 2; col++)
        for (let j = 0; j < 9; j++) {
          const local = new THREE.Matrix4().compose(
            new THREE.Vector3(-0.52 + col * 1.04, 0.95 + 0.06, -0.12 - j * 0.085),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.22, 0, 0)),
            new THREE.Vector3(1, 1, 1),
          );
          const c = new THREE.Color(palette[(i + col + j) % palette.length]).multiplyScalar(0.75 + ((j * 37) % 10) / 30);
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
          const c = new THREE.Color(palette[(k + (side > 0 ? 1 : 0)) % palette.length]).multiplyScalar(0.7 + (k % 4) * 0.1);
          sleeves.push({ m: unit.matrixWorld.clone().multiply(local), c });
        }
      box(unit, 0.6, 0.04, 0.16, -0.8, 1.18, -0.93, surfaces.wood);
      box(unit, 0.6, 0.04, 0.16, 0.8, 1.18, -0.93, surfaces.wood);
      // Free-standing islands get a stocked back side too (spines facing the other aisle).
      if (slot.facing === 0)
        for (const shelfY of [0.55, 1.2]) {
          box(unit, 2.2, 0.04, 0.2, 0, shelfY, -1.2, surfaces.wood);
          for (let k = 0; k < 52; k++) {
            const local = new THREE.Matrix4().compose(
              new THREE.Vector3(-1.02 + k * 0.04, shelfY + 0.175, -1.2),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, (k % 7 === 3 ? 0.12 : 0))),
              new THREE.Vector3(1, 1, 1),
            );
            const c = new THREE.Color(palette[(k + Math.round(shelfY * 3)) % palette.length]).multiplyScalar(0.65 + (k % 5) * 0.08);
            sleeves.push({ m: unit.matrixWorld.clone().multiply(local), c });
          }
        }
      // Big section sign above the stand (geometry merged; texture from the shared atlas).
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
    batchStaticGeometry(group);
    if (signParts.length) {
      const signs = new THREE.Mesh(
        mergeGeometries(signParts)!,
        new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: "#ffffff", emissiveIntensity: 0.75, roughness: 0.7 }),
      );
      signs.name = "section-signs";
      this.sectionGroup.add(signs);
    }
    const sleeveMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.31, 0.31, 0.012), new THREE.MeshStandardMaterial({ roughness: 0.85 }), sleeves.length);
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
    this.vu.emissiveIntensity = this.playing ? 0.8 + Math.abs(Math.sin(elapsed * 9) * Math.sin(elapsed * 3.3)) * 2.5 : 0.3;
    this.glow.emissiveIntensity = 1.2 + this.playBlend * (1.2 + beat * 1.6);
    this.deckLight.intensity = 6 + this.playBlend * (8 + beat * 6);
    this.updateEq(elapsed, this.playing);
  }

  /** Equalizer bars: idle = low dim row; playing = bouncing, bright. */
  private updateEq(elapsed: number, playing: boolean) {
    const colors = this.eq.instanceColor!.array as Float32Array;
    const level = playing ? 1.6 : 0.45;
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
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.fillRect(10, y + 10, w - 20, rowH - 20);
      c.strokeStyle = accent;
      c.lineWidth = 12;
      c.strokeRect(24, y + 24, w - 48, rowH - 48);
      c.fillStyle = "#fffaf0";
      c.textAlign = "center";
      c.textBaseline = "middle";
      fitText(c, record.section.toUpperCase(), w - 120, 150);
      c.fillText(record.section.toUpperCase(), w / 2, y + rowH * 0.44);
      c.fillStyle = accent;
      fitText(c, `${i + 1 < 10 ? "0" : ""}${i + 1} · FEATURED: ${record.title.toUpperCase()}`, w - 140, 38, 500);
      c.fillText(`${i + 1 < 10 ? "0" : ""}${i + 1} · FEATURED: ${record.title.toUpperCase()}`, w / 2, y + rowH * 0.8);
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
