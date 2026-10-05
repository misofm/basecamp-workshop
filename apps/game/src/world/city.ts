/**
 * Nozomi's back street: ground, building shells and facades, the skyline and the west vista.
 *
 * Owns: the asphalt (damp in patches, running west past the barricade into the dark),
 * sidewalks, curbs, alleys and the rubble lot; every building of layout.ts BUILDINGS
 * styled by `kind` (hotel, fitting center, TriMart and its ATM vestibule shell, poster
 * wall, casino back, diner, Stonks's walk-up, the scorched block, the shuttered shop,
 * alley and lot walls); the dead rows of the street west of the barricade; mid-ground
 * blocks; the unlit skyline (near ring and far ring: Triangle tower, crane, stadium on its
 * hill) and the western horizon (grassy hill and the facility). Registers building
 * footprints with Collision (tag "building").
 * Draw calls: static geometry is merged by material (materials.ts `surfaces`: wetAsphalt,
 * concrete, plasterStained, brick, tiles, corrugated, woodWorn, shutter; plus painted
 * details, a facade atlas with the few lit windows in its emissive map, transparent
 * decals, one SignAtlas); repeats (AC units, downpipes, lightbox housings, balcony rails)
 * are InstancedMeshes; the skyline is two MeshBasicMaterial meshes (fog off). No lights,
 * no custom shaders (WebGPU-safe). Rain lives in the particles module now.
 * Must not: place props (poles, puddles, vending, CRT heads, posters, the ATM), animate
 * gameplay objects or know about records, money or the UI. Japanese text only via SIGNS.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Collision } from "./collision";
import {
  BUILDINGS,
  CASINO_FIRE_DOOR,
  CURB_HEIGHT,
  DINER_DOOR,
  DINER_KITCHEN_DOOR,
  HOTEL_DOOR,
  HOTEL_WINDOW,
  ROOF_FIRE,
  SHOP,
  STONKS_DOOR,
  STREET,
  TRIMART_DOOR,
  buildingSolids,
  type BuildingSpec,
} from "./layout";
import { physicalUVs, surfaces } from "./materials";
import { canvasTexture } from "./labels";
import { EN_FONT, EN_ONLY, JP_FONT, SIGNS, SignAtlas, drawBilingual, drawTriangleMark, fitFont, grime, type AtlasRect, type SignKey } from "./signage";

// ─────────────────────────────── local coordinates ───────────────────────────────

/** How far west the dead street (asphalt, sidewalks, building rows) runs past the barricade. */
const VISTA_END_X = -172;
/** Cross streets in the dead west rows (x ranges), so the vista has depth. */
const CROSS_STREETS: [number, number][] = [
  [-84, -76],
  [-136, -128],
];
/** The vestibule ceiling height inside TriMart's cutout. */
const VESTIBULE_CEILING = 3.0;
/** The fitting center's display-window recess (on its z 0 face): the props agent fills it with CRT heads. */
export const FITTING_RECESS = { minX: -20, maxX: -12, sill: 0.6, top: 2.6, depth: 0.5 };
/** Stonks's recessed entry (steps up into the building behind his stoop). */
const STONKS_ENTRY = { minX: -11.4, maxX: -9.8, depth: 1.2 };
/** Skyline boxes nearer than this go in the near-ring mesh, the rest in the far ring. */
const SKY_SPLIT = 150;

// ─────────────────────────────── small helpers ───────────────────────────────

type Geo = THREE.BufferGeometry;
type ColorFn = (x: number, y: number, z: number, out: THREE.Color) => void;
type Paint = (c: CanvasRenderingContext2D, w: number, h: number, glow: boolean) => void;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

const colorCache = new Map<string, THREE.Color>();
function col(hex: string) {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)));
  return c;
}

/** Add a per-vertex colour attribute and push the geometry into a material bucket. */
function put(list: Geo[], g: Geo, color: string | ColorFn) {
  const pos = g.getAttribute("position");
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    if (typeof color === "string") c.copy(col(color));
    else color(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  list.push(g);
}

function merge(list: Geo[]): Geo {
  if (!list.length) return new THREE.BufferGeometry();
  const anyFlat = list.some((g) => !g.index);
  const gs = anyFlat ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
  const merged = mergeGeometries(gs)!;
  list.forEach((g) => g.dispose());
  return merged;
}

/** An axis-aligned box from min/max corners, subdivided every `step` m (so vertex colours can grade). */
function boxGeo(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, step = 0) {
  const w = Math.max(0.001, maxX - minX),
    h = Math.max(0.001, maxY - minY),
    d = Math.max(0.001, maxZ - minZ);
  const seg = (v: number) => (step > 0 ? Math.max(1, Math.min(40, Math.round(v / step))) : 1);
  const g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
  g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  return g;
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
/**
 * Wall tint with a grime splash at the foot, soot toward the roof, rain streaks,
 * patchiness, and edge wear (darker toward the building's vertical corners).
 */
function wallFn(tint: string, h: number, o: { soot?: number; dark?: number; fade?: boolean; base?: number; edges?: Bounds } = {}): ColorFn {
  const t = col(tint).clone().multiplyScalar(o.dark ?? 1);
  const soot = o.soot ?? 0.28;
  const baseK = o.base ?? 0.4;
  const e = o.edges;
  return (x, y, z, c) => {
    const base = 1 - baseK + baseK * smooth(0, 1.8, y);
    const top = 1 - soot * smooth(h - 4, h, y);
    const streak = 1 - 0.25 * hash(Math.floor((x + z) * 1.3)) * clamp01(y / Math.max(h, 1) + 0.25);
    const n = 0.88 + 0.12 * hash(Math.floor(x * 0.6) * 13.1 + Math.floor(y * 0.8) * 7.7 + Math.floor(z * 0.6) * 3.1);
    const fade = o.fade ? 1 - 0.6 * clamp01((-x - 40) / 130) : 1;
    let edge = 1;
    if (e) {
      const onZ = Math.min(Math.abs(z - e.minZ), Math.abs(z - e.maxZ)) < 0.01;
      const d = onZ ? Math.min(Math.abs(x - e.minX), Math.abs(x - e.maxX)) : Math.min(Math.abs(z - e.minZ), Math.abs(z - e.maxZ));
      edge = 1 - 0.3 * Math.exp(-d * 1.6);
    }
    c.copy(t).multiplyScalar(base * top * streak * n * fade * edge);
  };
}

/** A building face, in "face space": `along` runs left → right as seen from outside, `out` away from the wall. */
interface Face {
  ox: number;
  oz: number;
  ax: number;
  az: number;
  nx: number;
  nz: number;
  rot: number;
  len: number;
}
type Side = "n" | "s" | "e" | "w";
interface Box2 {
  x: number;
  z: number;
  w: number;
  d: number;
}
function faceOf(b: Box2, side: Side): Face {
  const minX = b.x - b.w / 2,
    maxX = b.x + b.w / 2,
    minZ = b.z - b.d / 2,
    maxZ = b.z + b.d / 2;
  switch (side) {
    case "s":
      return { ox: minX, oz: maxZ, ax: 1, az: 0, nx: 0, nz: 1, rot: 0, len: b.w };
    case "n":
      return { ox: maxX, oz: minZ, ax: -1, az: 0, nx: 0, nz: -1, rot: Math.PI, len: b.w };
    case "w":
      return { ox: minX, oz: minZ, ax: 0, az: 1, nx: -1, nz: 0, rot: -Math.PI / 2, len: b.d };
    case "e":
      return { ox: maxX, oz: maxZ, ax: 0, az: -1, nx: 1, nz: 0, rot: Math.PI / 2, len: b.d };
  }
}
const sideOf = (faces: BuildingSpec["faces"]): Side => (faces === "south" ? "s" : faces === "north" ? "n" : "w");
function fp(f: Face, a: number, y: number, o = 0) {
  return new THREE.Vector3(f.ox + f.ax * a + f.nx * o, y, f.oz + f.az * a + f.nz * o);
}
/** Along-coordinate of a world point on a face. */
function alongOf(f: Face, x: number, z: number) {
  return (x - f.ox) * f.ax + (z - f.oz) * f.az;
}
function boundsOf(b: Box2): Bounds {
  return { minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 };
}

// ─────────────────────────────── atlases ───────────────────────────────

/** A packed canvas atlas with an optional emissive twin (opaque facades) or alpha (decals). */
class Atlas {
  private cells: { x: number; y: number; w: number; h: number; paint: Paint; lit: boolean }[] = [];
  private cx = 0;
  private cy = 0;
  private rowH = 0;
  constructor(
    readonly name: string,
    readonly size: number,
    readonly height = size,
  ) {}
  add(w: number, h: number, paint: Paint, lit = false): AtlasRect {
    const pad = 8;
    if (this.cx + w > this.size) {
      this.cx = 0;
      this.cy += this.rowH + pad;
      this.rowH = 0;
    }
    if (this.cy + h > this.height) throw new Error(`atlas ${this.name} is full`);
    const cell = { x: this.cx, y: this.cy, w, h, paint, lit };
    this.cells.push(cell);
    this.cx += w + pad;
    this.rowH = Math.max(this.rowH, h);
    const S = this.size,
      H = this.height;
    return { u0: (cell.x + 1) / S, v0: 1 - (cell.y + h - 1) / H, u1: (cell.x + w - 1) / S, v1: 1 - (cell.y + 1) / H };
  }
  private paint(glow: boolean, transparent: boolean) {
    const tex = canvasTexture(this.size, this.height, (c) => {
      if (!transparent) {
        c.fillStyle = glow ? "#000" : "#2a2622";
        c.fillRect(0, 0, this.size, this.height);
      }
      for (const e of this.cells) {
        if (glow && !e.lit) continue;
        c.save();
        c.translate(e.x, e.y);
        c.beginPath();
        c.rect(0, 0, e.w, e.h);
        c.clip();
        e.paint(c, e.w, e.h, glow);
        c.restore();
      }
    });
    tex.anisotropy = 8;
    return tex;
  }
  map(transparent = false) {
    return this.paint(false, transparent);
  }
  emissive() {
    return this.paint(true, false);
  }
}

/** A flat quad showing `r`, centred at `p`, facing +z rotated by `rotY` (optionally tilted about x first). */
function quad(list: Geo[], r: AtlasRect, w: number, h: number, p: THREE.Vector3, rotY: number, color = "#ffffff", tiltX = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  if (tiltX) g.rotateX(tiltX);
  g.rotateY(rotY);
  g.translate(p.x, p.y, p.z);
  put(list, g, color);
}
/** A quad lying on the ground (y up), rotated `rot` about y. */
function groundQuad(list: Geo[], r: AtlasRect, w: number, d: number, x: number, y: number, z: number, rot: number, color = "#ffffff") {
  quad(list, r, w, d, new THREE.Vector3(x, y, z), rot, color, -Math.PI / 2);
}

/** Instances of a unit box: position, y-rotation, scale and colour. */
interface Inst {
  p: THREE.Vector3;
  rot: number;
  s: THREE.Vector3;
  color: string;
}

// ─────────────────────────────── painting: facade atlas ───────────────────────────────

type WinKind = "dark" | "dusty" | "broken" | "boarded" | "burnt" | "lit" | "mine" | "blind" | "frosted" | "barred";

function speckle(c: CanvasRenderingContext2D, w: number, h: number, r: () => number, n: number, rgb: string, a0: number, a1: number, size = 3) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(${rgb},${a0 + r() * (a1 - a0)})`;
    const s = 1 + r() * size;
    c.fillRect(r() * w, r() * h, s, s);
  }
}

function darkGlass(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number) {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, r() < 0.5 ? "#463c58" : "#3a3a4c");
  g.addColorStop(0.45, "#1f1c26");
  g.addColorStop(1, "#0e0d12");
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  // A smear of the orange sunset on the glass.
  c.fillStyle = `rgba(255,140,70,${0.05 + r() * 0.1})`;
  const k = r() * w;
  c.beginPath();
  c.moveTo(x + k, y);
  c.lineTo(x + k + w * 0.35, y);
  c.lineTo(x + k - w * 0.1, y + h);
  c.lineTo(x + k - w * 0.4, y + h);
  c.closePath();
  c.fill();
}

function windowPaint(kind: WinKind, seed: number): Paint {
  return (c, w, h, glow) => {
    const r = mulberry(seed);
    const f = 8;
    const gx = f,
      gy = f,
      gw = w - 2 * f,
      gh = h - 2 * f;
    const lit = kind === "lit" || kind === "mine";
    if (glow) {
      c.fillStyle = "#000";
      c.fillRect(0, 0, w, h);
      if (!lit) return;
    }
    if (!glow) {
      c.fillStyle = kind === "burnt" ? "#161210" : r() < 0.6 ? "#77736b" : "#4a4440";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.fillRect(0, h - f, w, f);
    }
    switch (kind) {
      case "lit":
      case "mine": {
        const g = c.createLinearGradient(0, gy, 0, gy + gh);
        g.addColorStop(0, kind === "mine" ? "#ffd59a" : "#ffc884");
        g.addColorStop(0.6, "#e0904a");
        g.addColorStop(1, "#7a3f1e");
        c.fillStyle = g;
        c.fillRect(gx, gy, gw, gh);
        c.fillStyle = glow ? "rgba(40,16,6,0.85)" : "rgba(92,40,24,0.9)";
        const cw = kind === "mine" ? gw * 0.22 : gw * (0.15 + r() * 0.25);
        c.fillRect(gx, gy, cw, gh);
        c.fillRect(gx + gw - (kind === "mine" ? gw * 0.12 : cw * 0.6), gy, kind === "mine" ? gw * 0.12 : cw * 0.6, gh);
        if (kind === "mine") {
          c.fillStyle = glow ? "#000" : "#1a120c";
          c.fillRect(gx + gw * 0.6, gy + gh * 0.82, gw * 0.14, gh * 0.16);
          c.beginPath();
          c.ellipse(gx + gw * 0.67, gy + gh * 0.74, gw * 0.13, gh * 0.12, 0, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = glow ? "#ffe9c0" : "#fff0d0";
          c.beginPath();
          c.moveTo(gx + gw * 0.3, gy + gh * 0.3);
          c.lineTo(gx + gw * 0.46, gy + gh * 0.3);
          c.lineTo(gx + gw * 0.5, gy + gh * 0.45);
          c.lineTo(gx + gw * 0.26, gy + gh * 0.45);
          c.closePath();
          c.fill();
        } else if (r() < 0.6) {
          c.fillStyle = glow ? "rgba(0,0,0,0.7)" : "rgba(60,40,30,0.75)";
          c.fillRect(gx, gy, gw, gh * (0.2 + r() * 0.3));
        }
        if (!glow) speckle(c, w, h, r, 60, "60,45,30", 0.1, 0.3);
        break;
      }
      case "dark":
      case "dusty":
      case "broken":
      case "blind":
      case "barred": {
        darkGlass(c, gx, gy, gw, gh, r);
        if (r() < 0.45 && kind !== "barred") {
          const colors = ["#5e4e3e", "#46525a", "#6e5e4c", "#4f4049", "#5a5a4a"];
          c.fillStyle = colors[Math.floor(r() * colors.length)];
          c.globalAlpha = 0.55;
          const left = r() < 0.5;
          const cw = gw * (0.25 + r() * 0.35);
          c.fillRect(left ? gx : gx + gw - cw, gy, cw, gh);
          c.globalAlpha = 1;
        }
        if (kind === "blind") {
          const stop = gh * (0.4 + r() * 0.55);
          for (let y = gy; y < gy + stop; y += 6) {
            c.fillStyle = `rgba(${180 + r() * 30},${172 + r() * 30},${150 + r() * 20},0.75)`;
            const bend = r() < 0.12 ? (r() - 0.5) * 8 : 0;
            c.fillRect(gx + (bend > 0 ? bend : 0), y + bend * 0.3, gw - Math.abs(bend), 3.5);
          }
        }
        if (kind === "dusty") {
          c.fillStyle = "rgba(150,138,118,0.45)";
          c.fillRect(gx, gy, gw, gh);
        }
        if (kind === "broken") {
          const cx = gx + gw * (0.3 + r() * 0.4),
            cy = gy + gh * (0.3 + r() * 0.4);
          const n = 9 + Math.floor(r() * 5);
          const rad = Math.min(gw, gh) * (0.25 + r() * 0.25);
          c.beginPath();
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const rr = rad * (0.35 + r() * 0.9);
            if (i) c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.3);
            else c.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.3);
          }
          c.closePath();
          c.fillStyle = "#050506";
          c.fill();
          c.strokeStyle = "rgba(200,210,220,0.35)";
          c.lineWidth = 1.5;
          c.stroke();
          for (let i = 0; i < 6; i++) {
            c.beginPath();
            c.moveTo(cx, cy);
            const a = r() * Math.PI * 2;
            c.lineTo(cx + Math.cos(a) * gw, cy + Math.sin(a) * gh);
            c.stroke();
          }
        }
        c.fillStyle = "#5e5a54";
        c.fillRect(gx + gw / 2 - 2.5, gy, 5, gh);
        if (kind === "barred") {
          c.fillStyle = "#1c1a18";
          for (let i = 1; i < 6; i++) c.fillRect(gx + (gw * i) / 6 - 2, gy, 4, gh);
          c.fillRect(gx, gy + gh * 0.5, gw, 4);
        }
        speckle(c, w, h, r, 90, "170,160,140", 0.04, 0.16);
        const g = c.createLinearGradient(0, gy + gh * 0.6, 0, gy + gh);
        g.addColorStop(0, "rgba(90,80,64,0)");
        g.addColorStop(1, "rgba(90,80,64,0.4)");
        c.fillStyle = g;
        c.fillRect(gx, gy, gw, gh);
        break;
      }
      case "frosted": {
        const g = c.createLinearGradient(0, gy, 0, gy + gh);
        g.addColorStop(0, "#8f9893");
        g.addColorStop(1, "#5f6663");
        c.fillStyle = g;
        c.fillRect(gx, gy, gw, gh);
        c.fillStyle = "#5e5a54";
        c.fillRect(gx + gw / 2 - 2.5, gy, 5, gh);
        speckle(c, w, h, r, 120, "60,55,45", 0.05, 0.25);
        break;
      }
      case "boarded": {
        c.fillStyle = "#151313";
        c.fillRect(gx, gy, gw, gh);
        const n = 3 + Math.floor(r() * 2);
        for (let i = 0; i < n; i++) {
          c.save();
          c.translate(w / 2, gy + ((i + 0.5) * gh) / n);
          c.rotate((r() - 0.5) * 0.35);
          const tone = 90 + r() * 40;
          c.fillStyle = `rgb(${tone + 20},${tone + 5},${tone - 20})`;
          c.fillRect(-w * 0.55, -gh / n / 2 + 2, w * 1.1, gh / n - 4);
          c.fillStyle = "rgba(0,0,0,0.3)";
          c.fillRect(-w * 0.55, gh / n / 2 - 5, w * 1.1, 3);
          c.fillStyle = "#2a2622";
          c.fillRect(-w * 0.4, -2, 3, 3);
          c.fillRect(w * 0.37, -2, 3, 3);
          c.restore();
        }
        speckle(c, w, h, r, 80, "40,34,28", 0.1, 0.3);
        break;
      }
      case "burnt": {
        const g = c.createLinearGradient(0, gy, 0, gy + gh);
        g.addColorStop(0, "#050404");
        g.addColorStop(1, "#1a110c");
        c.fillStyle = g;
        c.fillRect(gx, gy, gw, gh);
        c.fillStyle = "rgba(120,110,100,0.45)";
        for (let i = 0; i < 5; i++) {
          const x = gx + r() * gw;
          c.beginPath();
          c.moveTo(x, gy + gh);
          c.lineTo(x + 6 + r() * 10, gy + gh);
          c.lineTo(x + 3, gy + gh - 8 - r() * 22);
          c.closePath();
          c.fill();
        }
        if (r() < 0.5) {
          c.save();
          c.translate(w / 2, gy + gh * (0.4 + r() * 0.3));
          c.rotate((r() - 0.5) * 0.8);
          c.fillStyle = "#0b0908";
          c.fillRect(-w * 0.6, -5, w * 1.2, 10);
          c.restore();
        }
        c.fillStyle = "rgba(0,0,0,0.6)";
        c.fillRect(0, 0, w, f + 4);
        break;
      }
    }
  };
}

function dinerInterior(): Paint {
  return (c, w, h, glow) => {
    const r = mulberry(55);
    c.fillStyle = "#000";
    c.fillRect(0, 0, w, h);
    c.globalAlpha = glow ? 0.45 : 1;
    c.fillStyle = "#efe4cf";
    c.fillRect(0, 0, w, h * 0.58);
    for (let x = 0; x < w; x += 16) {
      c.fillStyle = (x / 16) % 2 ? "#141414" : "#f2f2f2";
      c.fillRect(x, h * 0.3, 16, 10);
      c.fillStyle = (x / 16) % 2 ? "#f2f2f2" : "#141414";
      c.fillRect(x, h * 0.3 + 10, 16, 10);
    }
    c.fillStyle = "#b52e28";
    c.fillRect(0, h * 0.5, w, h * 0.12);
    for (let row = 0; row < 4; row++) {
      const y0 = h * (0.78 + row * 0.055),
        size = 18 + row * 7;
      for (let x = -((row * 9) % size), i = 0; x < w; x += size, i++) {
        c.fillStyle = (i + row) % 2 ? "#151515" : "#e8e8e8";
        c.fillRect(x, y0, size, h * 0.055 + 1);
      }
    }
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 105;
      c.fillStyle = "#c2302a";
      c.fillRect(x, h * 0.48, 26, h * 0.32);
      c.fillRect(x + 66, h * 0.48, 26, h * 0.32);
      c.fillStyle = "#d9dde0";
      c.fillRect(x + 24, h * 0.6, 44, 6);
      c.fillStyle = "#888";
      c.fillRect(x + 44, h * 0.6, 4, h * 0.2);
    }
    c.fillStyle = "#a82a24";
    c.fillRect(w * 0.47, h * 0.6, w * 0.38, h * 0.18);
    c.fillStyle = "#dfe4e7";
    c.fillRect(w * 0.47, h * 0.59, w * 0.38, 5);
    for (let x = w * 0.5; x < w * 0.84; x += 42) {
      c.fillStyle = "#cfd3d6";
      c.fillRect(x + 8, h * 0.8, 4, h * 0.14);
      c.fillStyle = "#c8312b";
      c.beginPath();
      c.ellipse(x + 10, h * 0.79, 13, 5, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#6c6f72";
    c.fillRect(w * 0.53, h * 0.4, 50, 26);
    c.fillRect(w * 0.73, h * 0.36, 30, 40);
    c.globalAlpha = 1;
    // Orange circle sign behind the counter.
    const ox = w * 0.64,
      oy = h * 0.2;
    c.fillStyle = "#ff8a1e";
    c.fillRect(ox - 34, oy - 34, 68, 68);
    c.strokeStyle = "#fff4e0";
    c.lineWidth = 9;
    c.beginPath();
    c.arc(ox, oy, 20, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "#ff6a00";
    c.beginPath();
    c.arc(ox, oy, 11, 0, Math.PI * 2);
    c.fill();
    // Neon coffee cup.
    c.strokeStyle = "#ffcf7a";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(w * 0.4 - 18, h * 0.14);
    c.lineTo(w * 0.4 - 13, h * 0.26);
    c.lineTo(w * 0.4 + 13, h * 0.26);
    c.lineTo(w * 0.4 + 18, h * 0.14);
    c.stroke();
    c.beginPath();
    c.ellipse(w * 0.4, h * 0.28, 28, 4, 0, 0, Math.PI * 2);
    c.stroke();
    // Jukebox.
    const jx = w * 0.92,
      jy = h * 0.42;
    c.fillStyle = glow ? "#000" : "#5a1d12";
    c.fillRect(jx - 30, jy, 60, h * 0.4);
    ["#ffd23a", "#ff7a2f", "#ff3d7f", "#4fd8ff"].forEach((b, i) => {
      c.strokeStyle = b;
      c.lineWidth = 5;
      c.beginPath();
      c.arc(jx, jy + 18, 34 - i * 7, Math.PI, 0);
      c.lineTo(jx + 34 - i * 7, jy + h * 0.38);
      c.moveTo(jx - (34 - i * 7), jy + 18);
      c.lineTo(jx - (34 - i * 7), jy + h * 0.38);
      c.stroke();
    });
    for (let x = 60; x < w; x += 150) {
      c.fillStyle = "#ffe2a8";
      c.beginPath();
      c.ellipse(x, h * 0.09, 14, 6, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = glow ? "#000" : "#c9ced2";
    for (let x = 0; x <= w; x += w / 5) c.fillRect(x - 4, 0, 8, h);
    c.fillRect(0, 0, w, 6);
    c.fillRect(0, h - 6, w, 6);
    if (!glow) {
      speckle(c, w, h, r, 260, "90,80,70", 0.05, 0.2);
      const g = c.createLinearGradient(0, h * 0.7, 0, h);
      g.addColorStop(0, "rgba(70,60,50,0)");
      g.addColorStop(1, "rgba(70,60,50,0.35)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
  };
}

function trimartInterior(): Paint {
  return (c, w, h, glow) => {
    const r = mulberry(61);
    c.fillStyle = "#000";
    c.fillRect(0, 0, w, h);
    if (glow) {
      const g = c.createRadialGradient(w * 0.6, h * 0.15, 4, w * 0.6, h * 0.25, w * 0.35);
      g.addColorStop(0, "rgba(160,200,210,0.35)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#cfe8ee";
      c.fillRect(w * 0.5, h * 0.08, w * 0.2, 4);
      return;
    }
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#2e3436");
    g.addColorStop(0.6, "#1b1f20");
    g.addColorStop(1, "#141414");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let x = 20; x < w; x += 110) {
      c.fillStyle = x > w * 0.45 && x < w * 0.7 ? "#cfe8ee" : "#4a5052";
      c.fillRect(x, h * 0.08, 80, 4);
    }
    for (let i = 0; i < 6; i++) {
      const x = 25 + i * 102;
      c.fillStyle = "#5b6163";
      c.fillRect(x, h * 0.32, 6, h * 0.56);
      c.fillRect(x + 70, h * 0.32, 6, h * 0.56);
      for (let s = 0; s < 4; s++) {
        const y = h * (0.38 + s * 0.14);
        c.fillStyle = "#6e7476";
        c.fillRect(x, y, 76, 4);
        if (r() < 0.35) {
          c.fillStyle = ["#9a5a3a", "#c8b070", "#4a6a7a", "#8a8a8a"][Math.floor(r() * 4)];
          c.fillRect(x + 6 + r() * 50, y - 10, 8 + r() * 10, 10);
        }
      }
    }
    for (let i = 0; i < 40; i++) {
      c.fillStyle = ["#7a6a50", "#b0a080", "#505050", "#8a4a3a"][Math.floor(r() * 4)];
      c.fillRect(r() * w, h * (0.88 + r() * 0.1), 4 + r() * 12, 2 + r() * 4);
    }
    c.fillStyle = "rgba(120,110,95,0.3)";
    c.fillRect(0, 0, w, h);
    speckle(c, w, h, r, 500, "150,140,120", 0.05, 0.25);
    c.strokeStyle = "rgba(190,170,110,0.75)";
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(w * 0.05, h * 0.1);
    c.lineTo(w * 0.28, h * 0.85);
    c.moveTo(w * 0.28, h * 0.1);
    c.lineTo(w * 0.05, h * 0.85);
    c.stroke();
    c.strokeStyle = "rgba(220,230,235,0.4)";
    c.lineWidth = 1.2;
    const cx = w * 0.82,
      cy = h * 0.45;
    for (let i = 0; i < 9; i++) {
      c.beginPath();
      c.moveTo(cx, cy);
      const a = r() * Math.PI * 2;
      c.lineTo(cx + Math.cos(a) * 90, cy + Math.sin(a) * 70);
      c.stroke();
    }
    drawTriangleMark(c, w * 0.42, h * 0.62, 40, "rgba(240,240,235,0.7)");
    c.fillStyle = "#4e5153";
    for (const x of [0, w / 2 - 4, w - 8]) c.fillRect(x, 0, 8, h);
    c.fillRect(0, 0, w, 6);
    c.fillRect(0, h - 10, w, 10);
  };
}

function doorPaint(kind: "hotel" | "trimart" | "diner" | "fire" | "steel" | "kitchen"): Paint {
  return (c, w, h, glow) => {
    const r = mulberry(kind.length * 97 + 3);
    if (glow) {
      c.fillStyle = "#000";
      c.fillRect(0, 0, w, h);
      if (kind === "diner") {
        c.fillStyle = "#c98a50";
        c.fillRect(18, 22, w - 36, h * 0.55);
      }
      return;
    }
    switch (kind) {
      case "hotel": {
        c.fillStyle = "#2a1a12";
        c.fillRect(0, 0, w, h);
        for (const x of [8, w / 2 + 3]) {
          c.fillStyle = "#4a2e1e";
          c.fillRect(x, 10, w / 2 - 11, h - 18);
          darkGlass(c, x + 8, 22, w / 2 - 27, h * 0.42, r);
          c.fillStyle = "#3b2418";
          c.fillRect(x + 8, h * 0.62, w / 2 - 27, h * 0.28);
          c.fillStyle = "#a88a4a";
          c.fillRect(x + (x < w / 2 ? w / 2 - 20 : 4), h * 0.52, 5, 22);
        }
        break;
      }
      case "trimart": {
        c.fillStyle = "#62686a";
        c.fillRect(0, 0, w, h);
        darkGlass(c, 10, 10, w - 20, h - 40, r);
        c.fillStyle = "rgba(120,110,95,0.35)";
        c.fillRect(10, 10, w - 20, h - 40);
        c.strokeStyle = "rgba(230,235,240,0.6)";
        c.lineWidth = 1.3;
        const cx = w * 0.4,
          cy = h * 0.45;
        for (let i = 0; i < 12; i++) {
          c.beginPath();
          c.moveTo(cx, cy);
          const a = r() * Math.PI * 2;
          c.lineTo(cx + Math.cos(a) * 80, cy + Math.sin(a) * 120);
          c.stroke();
        }
        for (let k = 1; k < 4; k++) {
          c.beginPath();
          c.arc(cx, cy, k * 9, 0, Math.PI * 2);
          c.stroke();
        }
        c.fillStyle = "#9aa0a2";
        c.fillRect(14, h * 0.5, w - 28, 7);
        drawTriangleMark(c, w / 2, h * 0.75, 26, "rgba(240,240,235,0.8)");
        break;
      }
      case "diner": {
        c.fillStyle = "#c9ced2";
        c.fillRect(0, 0, w, h);
        c.fillStyle = "#7a2b20";
        c.fillRect(18, 22, w - 36, h * 0.55);
        c.fillStyle = "#e9c48a";
        c.fillRect(24, 30, w - 48, h * 0.3);
        c.fillStyle = "#b52e28";
        c.fillRect(10, h * 0.7, w - 20, h * 0.26);
        c.fillStyle = "#e8eaec";
        c.fillRect(12, h * 0.5, w - 24, 6);
        break;
      }
      case "fire": {
        c.fillStyle = "#2c5a42";
        c.fillRect(0, 0, w, h);
        c.fillStyle = "#24493a";
        c.fillRect(8, 8, w - 16, h - 16);
        darkGlass(c, w * 0.3, 24, w * 0.4, h * 0.2, r);
        c.strokeStyle = "rgba(200,200,200,0.4)";
        c.lineWidth = 1;
        for (let y = 24; y < 24 + h * 0.2; y += 6) {
          c.beginPath();
          c.moveTo(w * 0.3, y);
          c.lineTo(w * 0.7, y);
          c.stroke();
        }
        c.fillStyle = "#b8bcbe";
        c.fillRect(12, h * 0.52, w - 24, 8);
        for (let i = 0; i < 18; i++) {
          c.fillStyle = `rgba(120,70,40,${0.2 + r() * 0.4})`;
          c.fillRect(r() * w, h * 0.7 + r() * h * 0.3, 3 + r() * 8, 2 + r() * 6);
        }
        break;
      }
      case "steel":
      case "kitchen": {
        c.fillStyle = kind === "steel" ? "#4c5a64" : "#77756f";
        c.fillRect(0, 0, w, h);
        c.fillStyle = "rgba(0,0,0,0.25)";
        c.fillRect(8, 8, w - 16, h - 16);
        c.fillStyle = "#b8bcbe";
        c.fillRect(w - 26, h * 0.5, 14, 6);
        if (kind === "steel") {
          c.fillStyle = "#1c1c1c";
          c.fillRect(w / 2 - 16, h * 0.68, 32, 6);
          c.fillStyle = "#d8d0b8";
          c.fillRect(w / 2 - 14, h * 0.18, 28, 16);
          c.fillStyle = "#222";
          c.font = `700 13px ${EN_FONT}`;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText("35", w / 2, h * 0.18 + 8);
        }
        for (let i = 0; i < 30; i++) {
          c.fillStyle = `rgba(${200 - r() * 60},${190 - r() * 60},${170 - r() * 60},${0.15 + r() * 0.3})`;
          c.fillRect(r() * w, r() * h, 2 + r() * 14, 2 + r() * 10);
        }
        break;
      }
    }
    speckle(c, w, h, r, 120, "50,42,34", 0.06, 0.25);
  };
}

function plainPanel(seed: number, draw: (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void): Paint {
  return (c, w, h, glow) => {
    if (glow) return;
    draw(c, w, h, mulberry(seed));
  };
}

// ─────────────────────────────── painting: decal atlas (alpha) ───────────────────────────────

function decalPaint(draw: (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void, seed: number): Paint {
  return (c, w, h) => draw(c, w, h, mulberry(seed));
}

function crackLines(c: CanvasRenderingContext2D, w: number, h: number, r: () => number, alpha = 0.7) {
  c.strokeStyle = `rgba(14,12,10,${alpha})`;
  c.lineCap = "round";
  const branch = (x: number, y: number, a: number, len: number, width: number, depth: number) => {
    let px = x,
      py = y;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(px, py);
    const steps = 6 + Math.floor(r() * 6);
    for (let i = 0; i < steps; i++) {
      a += (r() - 0.5) * 0.9;
      px += (Math.cos(a) * len) / steps;
      py += (Math.sin(a) * len) / steps;
      c.lineTo(px, py);
      if (depth > 0 && r() < 0.25) {
        c.stroke();
        branch(px, py, a + (r() - 0.5) * 2, len * 0.5, width * 0.6, depth - 1);
        c.lineWidth = width;
        c.beginPath();
        c.moveTo(px, py);
      }
    }
    c.stroke();
  };
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) branch(w / 2 + (r() - 0.5) * w * 0.3, h / 2 + (r() - 0.5) * h * 0.3, r() * Math.PI * 2, Math.min(w, h) * 0.5, 2.6, 2);
}

// ─────────────────────────────── the city ───────────────────────────────

interface Buckets {
  asphalt: Geo[];
  damp: Geo[];
  concrete: Geo[];
  plaster: Geo[];
  brick: Geo[];
  tile: Geo[];
  corrugated: Geo[];
  wood: Geo[];
  shutter: Geo[];
  detail: Geo[];
  facade: Geo[];
  decal: Geo[];
  skyNear: Geo[];
  skyFar: Geo[];
}
type WallMat = "plaster" | "brick" | "tile";

/** Window atlas cells by kind. */
type WinCells = Record<WinKind, AtlasRect[]>;

/** Lightbox names for the vertical signs (all in SIGNS). */
const LIGHTBOXES: SignKey[] = ["snackYunagi", "ramenAkari", "denkiRepair", "pawn", "karaoke", "clinicNaika", "barberMinato", "coinLaundry", "kissaHotaru", "mahjong"];

export class City {
  readonly root = new THREE.Group();

  private B: Buckets = { asphalt: [], damp: [], concrete: [], plaster: [], brick: [], tile: [], corrugated: [], wood: [], shutter: [], detail: [], facade: [], decal: [], skyNear: [], skyFar: [] };
  private I: Record<"ac" | "pipe" | "signBox" | "rail", Inst[]> = { ac: [], pipe: [], signBox: [], rail: [] };
  private facadeAtlas = new Atlas("facade", 2048, 2048);
  private decalAtlas = new Atlas("decals", 1024, 2048);
  private signs = new SignAtlas("city", 2048, 2.6);
  private rng = mulberry(20420);
  private win!: WinCells;
  private cell!: Record<string, AtlasRect>;
  private dec!: Record<string, AtlasRect[]>;
  private lightboxCells = new Map<string, AtlasRect>();

  constructor(
    scene: THREE.Scene,
    private collision: Collision,
  ) {
    this.root.name = "city";
    scene.add(this.root);
    this.paintAtlases();
    // All lightbox faces first, in one row of the sign atlas (tall cells pack badly later).
    const palette = [
      ["#f5efe0", "#b3261e"],
      ["#fff7d6", "#1d3a7a"],
      ["#f2e9ff", "#6a1fa0"],
      ["#e6fbff", "#0f5c6e"],
      ["#ffe3e0", "#a01818"],
    ];
    LIGHTBOXES.forEach((key, i) => {
      const [bg, ink] = palette[i % palette.length];
      for (const lit of [true, false]) this.lightboxCells.set(`${key}/${lit}`, this.signs.add(80, 352, tategakiDraw(key, bg, ink, !lit), lit ? 0.55 : 0));
    });
    this.ground();
    this.markings();
    for (const b of BUILDINGS) this.building(b);
    this.vista();
    this.midground();
    this.skyline();
    this.horizon();
    this.assemble();
  }

  private R(a: number, b: number) {
    return a + (b - a) * this.rng();
  }
  private chance(p: number) {
    return this.rng() < p;
  }
  private one<T>(list: T[]) {
    return list[Math.floor(this.rng() * list.length)];
  }

  // ───────────────────────── atlases ─────────────────────────

  private paintAtlases() {
    const F = this.facadeAtlas;
    const kinds: [WinKind, number, boolean][] = [
      ["dark", 5, false],
      ["dusty", 2, false],
      ["broken", 3, false],
      ["boarded", 2, false],
      ["burnt", 3, false],
      ["lit", 3, true],
      ["mine", 1, true],
      ["blind", 2, false],
      ["frosted", 1, false],
      ["barred", 1, false],
    ];
    const win = {} as WinCells;
    let seed = 11;
    for (const [k, n, lit] of kinds) {
      win[k] = [];
      for (let i = 0; i < n; i++) win[k].push(F.add(112, 140, windowPaint(k, seed++ * 7919), lit));
    }
    this.win = win;
    this.cell = {
      diner: F.add(1024, 224, dinerInterior(), true),
      trimart: F.add(640, 256, trimartInterior(), true),
      doorHotel: F.add(160, 256, doorPaint("hotel")),
      doorTrimart: F.add(128, 256, doorPaint("trimart")),
      doorDiner: F.add(128, 256, doorPaint("diner"), true),
      doorFire: F.add(128, 256, doorPaint("fire")),
      doorSteel: F.add(128, 256, doorPaint("steel")),
      doorKitchen: F.add(128, 256, doorPaint("kitchen")),
      fittingBack: F.add(
        512,
        128,
        plainPanel(21, (c, w, h, r) => {
          const g = c.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, "#3e4644");
          g.addColorStop(1, "#1d2120");
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
          for (let x = 0; x < w; x += 18) {
            c.fillStyle = `rgba(150,170,168,${0.25 + r() * 0.15})`;
            c.fillRect(x, 0, 10, h * (0.8 + r() * 0.2));
          }
          speckle(c, w, h, r, 300, "120,115,100", 0.05, 0.3);
        }),
      ),
      crate: F.add(
        256,
        192,
        (c, w, h, glow) => {
          const r = mulberry(31);
          c.fillStyle = glow ? "#000" : "#090706";
          c.fillRect(0, 0, w, h);
          if (glow) {
            for (let i = 0; i < 9; i++) {
              c.fillStyle = `rgba(255,${80 + r() * 60},20,${0.4 + r() * 0.5})`;
              c.fillRect(w * 0.3 + r() * w * 0.4, h * 0.62 + r() * h * 0.2, 3, 2);
            }
            return;
          }
          c.fillStyle = "#1a120c";
          c.fillRect(w * 0.28, h * 0.55, w * 0.44, h * 0.35);
          for (let i = 0; i < 4; i++) {
            c.fillStyle = i % 2 ? "#2a1a10" : "#120c08";
            c.fillRect(w * 0.28, h * (0.57 + i * 0.08), w * 0.44, h * 0.05);
          }
          c.fillStyle = "#3a2a1e";
          c.fillRect(w * 0.36, h * 0.5, 14, 12);
          c.fillRect(w * 0.5, h * 0.48, 12, 14);
          c.fillStyle = "#151210";
          c.fillRect(0, 0, w, 10);
          c.fillRect(0, h - 10, w, 10);
          c.fillRect(0, 0, 10, h);
          c.fillRect(w - 10, 0, 10, h);
          c.fillStyle = "rgba(140,130,120,0.4)";
          for (let i = 0; i < 6; i++) {
            const x = 10 + r() * (w - 30);
            c.beginPath();
            c.moveTo(x, 10);
            c.lineTo(x + 12, 10);
            c.lineTo(x + 4, 10 + 15 + r() * 30);
            c.fill();
          }
        },
        true,
      ),
      scorchedStore: F.add(
        512,
        256,
        plainPanel(37, (c, w, h, r) => {
          c.fillStyle = "#070605";
          c.fillRect(0, 0, w, h);
          for (let i = 0; i < 7; i++) {
            c.save();
            c.translate(r() * w, h * (0.1 + r() * 0.4));
            c.rotate((r() - 0.5) * 1.2);
            c.fillStyle = "#14100d";
            c.fillRect(-60, -6, 120, 12);
            c.restore();
          }
          c.fillStyle = "#1a1512";
          for (let i = 0; i < 20; i++) c.fillRect(r() * w, h * (0.8 + r() * 0.2), 10 + r() * 30, 6 + r() * 14);
          c.fillStyle = "#121010";
          c.fillRect(0, 0, w, 10);
          for (const x of [0, w / 3, (2 * w) / 3, w - 10]) c.fillRect(x, 0, 10, h);
          c.fillStyle = "rgba(150,140,130,0.4)";
          for (let i = 0; i < 14; i++) {
            const x = r() * w;
            const top = r() < 0.5;
            c.beginPath();
            c.moveTo(x, top ? 10 : h);
            c.lineTo(x + 14, top ? 10 : h);
            c.lineTo(x + 5, top ? 10 + 20 + r() * 40 : h - 20 - r() * 40);
            c.fill();
          }
        }),
      ),
      darkStore: F.add(
        320,
        160,
        plainPanel(41, (c, w, h, r) => {
          darkGlass(c, 0, 0, w, h, r);
          c.fillStyle = "rgba(130,120,100,0.4)";
          c.fillRect(0, 0, w, h);
          c.fillStyle = "#3e3a36";
          for (const x of [0, w / 2 - 4, w - 8]) c.fillRect(x, 0, 8, h);
          for (let i = 0; i < 3; i++) {
            c.fillStyle = `rgba(${220 - r() * 30},${210 - r() * 30},${180 - r() * 30},0.6)`;
            c.fillRect(20 + r() * (w - 70), 20 + r() * (h * 0.4), 30, 40);
          }
          speckle(c, w, h, r, 300, "150,140,120", 0.05, 0.25);
        }),
      ),
      vestibule: F.add(
        256,
        192,
        plainPanel(43, (c, w, h, r) => {
          c.fillStyle = "#cfc8b6";
          c.fillRect(0, 0, w, h);
          c.strokeStyle = "#9c9686";
          c.lineWidth = 2;
          for (let x = 0; x < w; x += 16) {
            c.beginPath();
            c.moveTo(x, 0);
            c.lineTo(x, h);
            c.stroke();
          }
          for (let y = 0; y < h; y += 16) {
            c.beginPath();
            c.moveTo(0, y);
            c.lineTo(w, y);
            c.stroke();
          }
          for (let i = 0; i < 5; i++) {
            c.fillStyle = ["#d8cf9c", "#c4d0d4", "#e2b8a8", "#ece6d2"][Math.floor(r() * 4)];
            c.save();
            c.translate(20 + r() * (w - 40), 20 + r() * (h * 0.6));
            c.rotate((r() - 0.5) * 0.3);
            c.fillRect(-18, -24, 36 * (0.4 + r() * 0.6), 48);
            c.restore();
          }
          const g = c.createLinearGradient(0, h * 0.5, 0, h);
          g.addColorStop(0, "rgba(60,50,40,0)");
          g.addColorStop(1, "rgba(60,50,40,0.6)");
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
          speckle(c, w, h, r, 220, "60,50,40", 0.05, 0.3);
        }),
      ),
      ceilingLight: F.add(
        128,
        64,
        (c, w, h, glow) => {
          c.fillStyle = glow ? "#000" : "#6a6a66";
          c.fillRect(0, 0, w, h);
          c.fillStyle = glow ? "#e8f6ff" : "#f2f6f4";
          c.fillRect(8, 8, w - 16, h - 16);
          c.fillStyle = glow ? "#556066" : "#3a3a36";
          const r = mulberry(5);
          for (let i = 0; i < 9; i++) c.fillRect(10 + r() * (w - 24), 10 + r() * (h - 24), 3, 3);
        },
        true,
      ),
      acFace: F.add(
        128,
        96,
        plainPanel(47, (c, w, h, r) => {
          c.fillStyle = "#b4b0a4";
          c.fillRect(0, 0, w, h);
          c.fillStyle = "#3a3834";
          c.beginPath();
          c.arc(w * 0.62, h / 2, h * 0.38, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = "#8a877e";
          c.lineWidth = 2;
          for (let k = 1; k < 5; k++) {
            c.beginPath();
            c.arc(w * 0.62, h / 2, (h * 0.38 * k) / 5, 0, Math.PI * 2);
            c.stroke();
          }
          c.fillStyle = "#9c988c";
          for (let y = 10; y < h - 10; y += 7) c.fillRect(8, y, w * 0.25, 3);
          const g = c.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, "rgba(40,30,20,0)");
          g.addColorStop(1, "rgba(80,50,30,0.5)");
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
          speckle(c, w, h, r, 80, "60,50,40", 0.1, 0.3);
        }),
      ),
      louver: F.add(
        128,
        128,
        plainPanel(59, (c, w, h, r) => {
          c.fillStyle = "#4d4a44";
          c.fillRect(0, 0, w, h);
          for (let y = 8; y < h - 8; y += 10) {
            c.fillStyle = "#77736a";
            c.fillRect(8, y, w - 16, 5);
            c.fillStyle = "#24221f";
            c.fillRect(8, y + 5, w - 16, 3);
          }
          speckle(c, w, h, r, 60, "110,70,40", 0.1, 0.4);
        }),
      ),
    };

    // Decals (transparent).
    const D = this.decalAtlas;
    const dashes = [0, 1, 2].map((s) =>
      D.add(
        256,
        32,
        decalPaint((c, w, h, r) => {
          c.fillStyle = "rgba(225,220,200,0.55)";
          c.fillRect(0, 4, w, h - 8);
          c.globalCompositeOperation = "destination-out";
          for (let i = 0; i < 120; i++) {
            c.fillStyle = `rgba(0,0,0,${0.4 + r() * 0.6})`;
            c.fillRect(r() * w, r() * h, 3 + r() * 14, 2 + r() * 8);
          }
          c.globalCompositeOperation = "source-over";
        }, 100 + s),
      ),
    );
    const cracks = [0, 1, 2].map((s) => D.add(256, 256, decalPaint((c, w, h, r) => crackLines(c, w, h, r), 200 + s)));
    const stains = [0, 1].map((s) =>
      D.add(
        256,
        256,
        decalPaint((c, w, h, r) => {
          for (let i = 0; i < 6; i++) {
            const x = w * (0.3 + r() * 0.4),
              y = h * (0.3 + r() * 0.4),
              rad = w * (0.12 + r() * 0.25);
            const g = c.createRadialGradient(x, y, 0, x, y, rad);
            g.addColorStop(0, s ? "rgba(10,10,12,0.5)" : "rgba(40,30,20,0.45)");
            g.addColorStop(1, "rgba(0,0,0,0)");
            c.fillStyle = g;
            c.fillRect(0, 0, w, h);
          }
        }, 300 + s),
      ),
    );
    const manhole = D.add(
      128,
      128,
      decalPaint((c, w, h, r) => {
        c.fillStyle = "#3a3936";
        c.beginPath();
        c.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#54524c";
        c.lineWidth = 3;
        for (let k = 1; k < 4; k++) {
          c.beginPath();
          c.arc(w / 2, h / 2, (w / 2 - 6) * (k / 4), 0, Math.PI * 2);
          c.stroke();
        }
        for (let a = 0; a < 12; a++) {
          c.beginPath();
          c.moveTo(w / 2, h / 2);
          c.lineTo(w / 2 + Math.cos((a * Math.PI) / 6) * (w / 2 - 6), h / 2 + Math.sin((a * Math.PI) / 6) * (w / 2 - 6));
          c.stroke();
        }
        speckle(c, w, h, r, 60, "90,60,40", 0.2, 0.5);
      }, 401),
    );
    const weeds = [0, 1, 2].map((s) =>
      D.add(
        128,
        128,
        decalPaint((c, w, h, r) => {
          for (let i = 0; i < 22; i++) {
            const x = w * (0.2 + r() * 0.6);
            c.strokeStyle = r() < 0.6 ? `rgba(${70 + r() * 30},${90 + r() * 30},${40 + r() * 20},0.95)` : `rgba(${130 + r() * 30},${115 + r() * 20},70,0.95)`;
            c.lineWidth = 2 + r() * 2;
            c.beginPath();
            c.moveTo(x, h);
            c.quadraticCurveTo(x + (r() - 0.5) * 30, h * 0.6, x + (r() - 0.5) * 50, h * (0.05 + r() * 0.45));
            c.stroke();
          }
        }, 500 + s),
      ),
    );
    const litter = D.add(
      256,
      128,
      decalPaint((c, w, h, r) => {
        for (let i = 0; i < 40; i++) {
          c.fillStyle = ["rgba(200,190,160,0.8)", "rgba(120,90,50,0.8)", "rgba(90,70,40,0.75)", "rgba(160,60,40,0.6)"][Math.floor(r() * 4)];
          c.save();
          c.translate(r() * w, r() * h);
          c.rotate(r() * 6);
          c.fillRect(-4, -3, 4 + r() * 12, 3 + r() * 8);
          c.restore();
        }
      }, 600),
    );
    const streaks = [0, 1].map((s) =>
      D.add(
        64,
        256,
        decalPaint((c, w, h, r) => {
          for (let i = 0; i < 7; i++) {
            const x = w * (0.2 + r() * 0.6);
            const len = h * (0.5 + r() * 0.5);
            const g = c.createLinearGradient(0, 0, 0, len);
            g.addColorStop(0, s ? "rgba(90,50,25,0.55)" : "rgba(15,12,10,0.5)");
            g.addColorStop(1, "rgba(0,0,0,0)");
            c.fillStyle = g;
            c.fillRect(x, 0, 2 + r() * 6, len);
          }
        }, 700 + s),
      ),
    );
    // A water-leak stain: a dark tide mark spreading down from a crack or a pipe joint.
    const leak = D.add(
      128,
      256,
      decalPaint((c, w, h, r) => {
        for (let i = 0; i < 18; i++) {
          const x = w / 2 + (r() - 0.5) * w * 0.4 * (i / 18 + 0.3);
          const y = h * (0.05 + (i / 18) * 0.7);
          const rad = w * (0.1 + (i / 18) * 0.28);
          const g = c.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, "rgba(28,26,20,0.22)");
          g.addColorStop(0.8, "rgba(40,36,24,0.12)");
          g.addColorStop(1, "rgba(60,50,30,0)");
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
        }
        for (let i = 0; i < 5; i++) {
          const x = w * (0.3 + r() * 0.4);
          const g = c.createLinearGradient(0, h * 0.3, 0, h);
          g.addColorStop(0, "rgba(20,18,14,0.35)");
          g.addColorStop(1, "rgba(20,18,14,0)");
          c.fillStyle = g;
          c.fillRect(x, h * 0.3, 2 + r() * 4, h * 0.7);
        }
      }, 750),
    );
    const plume = D.add(
      256,
      512,
      decalPaint((c, w, h, r) => {
        for (let i = 0; i < 40; i++) {
          const t = r();
          const y = h * (1 - t);
          const x = w / 2 + (r() - 0.5) * w * (0.25 + t * 0.6);
          const rad = w * (0.12 + t * 0.25);
          const g = c.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, `rgba(8,6,5,${0.35 * (1 - t * 0.7)})`);
          g.addColorStop(1, "rgba(8,6,5,0)");
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
        }
      }, 800),
    );
    const baseGrime = D.add(
      512,
      64,
      decalPaint((c, w, h, r) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(30,24,18,0)");
        g.addColorStop(1, "rgba(30,24,18,0.6)");
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
        speckle(c, w, h, r, 200, "40,30,20", 0.1, 0.4, 5);
      }, 900),
    );
    const dustGlass = D.add(
      256,
      128,
      decalPaint((c, w, h, r) => {
        c.fillStyle = "rgba(170,160,140,0.22)";
        c.fillRect(0, 0, w, h);
        for (let i = 0; i < 30; i++) {
          c.fillStyle = `rgba(180,170,150,${0.05 + r() * 0.15})`;
          c.beginPath();
          c.ellipse(r() * w, r() * h, 10 + r() * 40, 5 + r() * 20, r() * 3, 0, Math.PI * 2);
          c.fill();
        }
        c.globalCompositeOperation = "destination-out";
        c.strokeStyle = "rgba(0,0,0,0.6)";
        c.lineWidth = 6;
        c.beginPath();
        c.moveTo(w * 0.62, h * 0.3);
        c.quadraticCurveTo(w * 0.7, h * 0.5, w * 0.66, h * 0.8);
        c.stroke();
        c.globalCompositeOperation = "source-over";
        const g = c.createLinearGradient(0, h * 0.6, 0, h);
        g.addColorStop(0, "rgba(120,110,90,0)");
        g.addColorStop(1, "rgba(120,110,90,0.35)");
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }, 1000),
    );
    const chain = D.add(
      128,
      128,
      decalPaint((c, w, h) => {
        c.strokeStyle = "rgba(150,150,145,0.9)";
        c.lineWidth = 1.6;
        for (let k = -w; k < w * 2; k += 16) {
          c.beginPath();
          c.moveTo(k, 0);
          c.lineTo(k + h, h);
          c.stroke();
          c.beginPath();
          c.moveTo(k + h, 0);
          c.lineTo(k, h);
          c.stroke();
        }
      }, 1100),
    );
    const graffiti = [0, 1, 2, 3].map((s) =>
      D.add(
        256,
        128,
        decalPaint((c, w, h, r) => {
          const inks = ["#e8e3d6", "#ff6a2b", "#b23cff", "#2fd0c8", "#f2d23a", "#e0303a", "#111"];
          const ink = inks[Math.floor(r() * inks.length)];
          const outline = inks[Math.floor(r() * inks.length)];
          c.lineJoin = "round";
          c.lineCap = "round";
          if (s % 2 === 0) {
            // Bubble scrawl, NOZOMI-ish letters (an invented tag).
            const word = ["NZMI", "N0Z0", "NOZ!", "ZOMI"][s];
            c.font = `900 ${h * 0.62}px ${EN_FONT}`;
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.save();
            c.translate(w / 2, h / 2);
            c.rotate((r() - 0.5) * 0.25);
            c.transform(1, 0, -0.25, 1, 0, 0);
            c.lineWidth = 10;
            c.strokeStyle = outline;
            c.strokeText(word, 0, 0);
            c.fillStyle = ink;
            c.fillText(word, 0, 0);
            c.restore();
            for (let i = 0; i < 6; i++) {
              c.fillStyle = ink;
              c.fillRect(w * (0.2 + r() * 0.6), h * 0.7, 2, h * (0.1 + r() * 0.25));
            }
          } else {
            c.strokeStyle = ink;
            c.lineWidth = 4;
            c.beginPath();
            let x = 16,
              y = h * 0.6;
            c.moveTo(x, y);
            while (x < w - 20) {
              const nx = x + 10 + r() * 22;
              c.bezierCurveTo(x + 4, y - 40 * r(), nx - 4, y + 30 * r(), nx, h * (0.35 + r() * 0.4));
              x = nx;
              y = h * (0.35 + r() * 0.4);
            }
            c.stroke();
            c.lineWidth = 3;
            c.beginPath();
            c.moveTo(14, h * 0.85);
            c.lineTo(w - 14, h * 0.75);
            c.stroke();
          }
        }, 1200 + s),
      ),
    );
    const char = D.add(
      256,
      256,
      decalPaint((c, w, h, r) => {
        for (let i = 0; i < 24; i++) {
          const x = w * (0.2 + r() * 0.6),
            y = h * (0.2 + r() * 0.6),
            rad = w * (0.15 + r() * 0.3);
          const g = c.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, "rgba(5,4,3,0.7)");
          g.addColorStop(1, "rgba(5,4,3,0)");
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
        }
      }, 1300),
    );
    const moss = D.add(
      128,
      256,
      decalPaint((c, w, h, r) => {
        for (let i = 0; i < 10; i++) {
          const x = w * (0.2 + r() * 0.6);
          const g = c.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, "rgba(50,60,30,0.5)");
          g.addColorStop(1, "rgba(40,50,25,0)");
          c.fillStyle = g;
          c.fillRect(x - 6, 0, 12 + r() * 14, h * (0.4 + r() * 0.6));
        }
      }, 1400),
    );
    this.dec = {
      dashes,
      cracks,
      stains,
      manhole: [manhole],
      weeds,
      litter: [litter],
      streaks,
      leak: [leak],
      plume: [plume],
      baseGrime: [baseGrime],
      dustGlass: [dustGlass],
      chain: [chain],
      graffiti,
      char: [char],
      moss: [moss],
    };
  }

  private pickWin(style: "normal" | "burnt" | "clinic", zone: boolean): AtlasRect {
    const W = this.win;
    const r = this.rng();
    if (style === "burnt") return r < 0.75 ? this.one(W.burnt) : r < 0.9 ? this.one(W.broken) : this.one(W.boarded);
    if (style === "clinic") return r < 0.55 ? this.one(W.frosted) : r < 0.8 ? this.one(W.dusty) : this.one(W.broken);
    if (zone && r < 0.045) return this.one(W.lit);
    if (r < 0.42) return this.one(W.dark);
    if (r < 0.56) return this.one(W.blind);
    if (r < 0.7) return this.one(W.dusty);
    if (r < 0.86) return this.one(W.broken);
    return this.one(W.boarded);
  }

  // ───────────────────────── face helpers ─────────────────────────

  /** A box in face space (along a0..a1, height y0..y1, out o0..o1). */
  private fbox(list: Geo[], f: Face, a0: number, a1: number, y0: number, y1: number, o0: number, o1: number, color: string | ColorFn, step = 0) {
    const p = fp(f, a0, y0, o0),
      q = fp(f, a1, y1, o1);
    put(list, boxGeo(Math.min(p.x, q.x), y0, Math.min(p.z, q.z), Math.max(p.x, q.x), y1, Math.max(p.z, q.z), step), color);
  }
  /** An instanced unit box in face space. */
  private finst(list: Inst[], f: Face, a0: number, a1: number, y0: number, y1: number, o0: number, o1: number, color: string) {
    list.push({ p: fp(f, (a0 + a1) / 2, (y0 + y1) / 2, (o0 + o1) / 2), rot: f.rot, s: new THREE.Vector3(Math.abs(a1 - a0), y1 - y0, Math.abs(o1 - o0)), color });
  }
  /** An atlas quad on a face. */
  private fquad(list: Geo[], f: Face, r: AtlasRect, a: number, y: number, w: number, h: number, o = 0.02, color = "#ffffff") {
    quad(list, r, w, h, fp(f, a, y, o), f.rot, color);
  }
  private sign(r: AtlasRect, f: Face, a: number, y: number, w: number, h: number, o = 0.06) {
    this.signs.quad(r, w, h, fp(f, a, y, o), f.rot);
  }
  /** A shell box of a wall material, with edge wear and the usual grime gradient. */
  private shell(mat: WallMat, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tint: string, h: number, o: { soot?: number; dark?: number; fade?: boolean; base?: number } = {}, edges?: Bounds) {
    put(this.B[mat], boxGeo(minX, minY, minZ, maxX, maxY, maxZ, 1.2), wallFn(tint, h, { ...o, edges: edges ?? { minX, maxX, minZ, maxZ } }));
  }

  /** Rows of upper-floor windows with sills, AC units, rust streaks, leaks and laundry poles. */
  private windows(
    f: Face,
    o: {
      a0?: number;
      a1?: number;
      rows: number[];
      step: number;
      w: number;
      h: number;
      zone: boolean;
      style?: "normal" | "burnt" | "clinic";
      ac?: number;
      laundry?: number;
      sills?: boolean;
      skip?: (a: number, y: number) => boolean;
      fixed?: (a: number, y: number) => AtlasRect | null;
    },
  ) {
    const a0 = o.a0 ?? 0,
      a1 = o.a1 ?? f.len;
    const n = Math.max(1, Math.floor((a1 - a0) / o.step));
    const start = a0 + (a1 - a0 - (n - 1) * o.step) / 2;
    const D = this.B.detail;
    for (const y of o.rows)
      for (let i = 0; i < n; i++) {
        const a = start + i * o.step;
        if (o.skip?.(a, y)) continue;
        const cell = o.fixed?.(a, y) ?? this.pickWin(o.style ?? "normal", o.zone);
        this.fquad(this.B.facade, f, cell, a, y, o.w, o.h, 0.02);
        if (o.sills !== false) {
          this.fbox(D, f, a - o.w / 2 - 0.08, a + o.w / 2 + 0.08, y - o.h / 2 - 0.1, y - o.h / 2, 0, 0.14, o.style === "burnt" ? "#1c1714" : "#77726a");
          if (this.chance(0.4)) {
            const len = this.R(1.2, 3);
            this.fquad(this.B.decal, f, this.dec.streaks[this.chance(0.5) ? 1 : 0], a + this.R(-0.3, 0.3), y - o.h / 2 - 0.1 - len / 2, 0.45, len, 0.012);
          }
        }
        if (this.chance(0.12)) {
          const len = this.R(2, 4);
          this.fquad(this.B.decal, f, this.dec.leak[0], a + this.R(-1.4, 1.4), y + o.h / 2 + 0.6 - len / 2, this.R(1, 1.8), len, 0.011);
        }
        if (o.style === "burnt") {
          const ph = this.R(2.5, 4.5);
          this.fquad(this.B.decal, f, this.dec.plume[0], a, y + o.h / 2 + ph / 2 - 0.9, o.w * 1.9, ph, 0.015);
        }
        if (o.ac && this.chance(o.ac)) {
          const ax = a + (this.chance(0.5) ? 1 : -1) * (o.w / 2 + 0.55);
          const ay = y - o.h / 2 + 0.05;
          this.finst(this.I.ac, f, ax - 0.4, ax + 0.4, ay, ay + 0.58, 0, 0.32, this.one(["#aaa69a", "#b8b4a8", "#9a978c", "#a39a88"]));
          this.fbox(D, f, ax - 0.35, ax - 0.3, ay - 0.15, ay, 0, 0.3, "#3d3934");
          this.fbox(D, f, ax + 0.3, ax + 0.35, ay - 0.15, ay, 0, 0.3, "#3d3934");
          this.fquad(this.B.facade, f, this.cell.acFace, ax, ay + 0.29, 0.78, 0.56, 0.325);
          // Its drain hose and the stain it leaves.
          this.finst(this.I.pipe, f, ax + 0.31, ax + 0.36, ay - 1.2, ay, 0.05, 0.1, "#2c2a28");
          if (this.chance(0.5)) this.fquad(this.B.decal, f, this.dec.streaks[1], ax + 0.33, ay - 1.8, 0.35, 1.8, 0.011);
        }
        if (o.laundry && this.chance(o.laundry)) {
          const ly = y + o.h / 2 + 0.25;
          for (const s of [-0.75, 0.75]) this.finst(this.I.rail, f, a + s - 0.03, a + s + 0.03, ly - 0.03, ly + 0.03, 0, 0.55, "#55524c");
          if (this.chance(0.6)) this.finst(this.I.rail, f, a - 1.0, a + 1.0, ly - 0.025, ly + 0.025, 0.47, 0.52, "#8a8780");
        }
      }
  }

  /** Vertical downpipes with brackets and leak stains at the joints, from the roof to the ground. */
  private pipes(f: Face, h: number, along: number[]) {
    for (const a of along) {
      this.finst(this.I.pipe, f, a - 0.06, a + 0.06, 0.1, h - 0.1, 0.04, 0.16, this.one(["#5a554d", "#6a4a36", "#4e5a58", "#77746c"]));
      this.finst(this.I.pipe, f, a - 0.1, a + 0.1, h - 0.35, h - 0.05, 0.02, 0.3, "#4a4642");
      for (let y = 1.2; y < h - 0.5; y += 2.4) this.finst(this.I.pipe, f, a - 0.1, a + 0.1, y, y + 0.06, 0, 0.18, "#3a3632");
      if (this.chance(0.6)) {
        const y = this.R(2, Math.max(2.5, h - 2));
        this.fquad(this.B.decal, f, this.dec.leak[0], a, y - 1.2, 1.1, 2.6, 0.011);
      }
    }
  }

  /** Balcony slabs with instanced railings across a face. */
  private balconies(f: Face, a0: number, a1: number, ys: number[], color = "#6c6862") {
    for (const y of ys) {
      this.fbox(this.B.detail, f, a0, a1, y, y + 0.15, 0, 1.0, color);
      this.finst(this.I.rail, f, a0, a1, y + 0.95, y + 1.0, 0.92, 1.0, "#4a4a48");
      for (let a = a0 + 0.1; a < a1; a += 0.22) this.finst(this.I.rail, f, a - 0.015, a + 0.015, y + 0.15, y + 0.95, 0.94, 0.97, "#4a4a48");
      for (const a of [a0 + 0.02, a1 - 0.02]) this.finst(this.I.rail, f, a - 0.02, a + 0.02, y + 0.15, y + 0.95, 0, 1.0, "#4a4a48");
    }
  }

  /** A protruding vertical lightbox sign (tategaki), readable from both ends of the street. */
  private lightbox(f: Face, a: number, top: number, len: number, key: SignKey, lit: boolean) {
    const out0 = 0.25,
      out1 = 1.15;
    this.finst(this.I.signBox, f, a - 0.14, a + 0.14, top - len, top, out0, out1, lit ? "#3a3634" : "#2a2725");
    this.fbox(this.B.detail, f, a - 0.04, a + 0.04, top - 0.25, top - 0.15, 0, out0, "#2a2826");
    this.fbox(this.B.detail, f, a - 0.04, a + 0.04, top - len + 0.15, top - len + 0.25, 0, out0, "#2a2826");
    const cell = this.lightboxCells.get(`${key}/${lit}`)!;
    const p = fp(f, a, top - len / 2, (out0 + out1) / 2);
    for (const s of [1, -1]) {
      const ex = f.ax * 0.145 * s,
        ez = f.az * 0.145 * s;
      this.signs.quad(cell, out1 - out0 - 0.06, len - 0.08, new THREE.Vector3(p.x + ex, p.y, p.z + ez), f.rot + (s > 0 ? Math.PI / 2 : -Math.PI / 2));
    }
  }

  /** A rusty corrugated patch (a covered-up window bay, a lean-to repair). */
  private corrugatedPatch(f: Face, a0: number, a1: number, y0: number, y1: number, o = 0.03) {
    this.fbox(this.B.corrugated, f, a0, a1, y0, y1, 0, o, (x, y, z, c) => c.copy(col(hash(Math.floor((x + z) * 1.5)) < 0.5 ? "#9a8a7a" : "#8a7262")).multiplyScalar(0.85 + 0.15 * hash(y * 3.1)));
  }

  /** Parapet ring, tanks, stair house, antenna, AC condensers, shacks, sometimes a dead billboard frame. */
  private roof(b: Box2 & { h: number }, o: { parapet?: string; tank?: boolean; stair?: boolean; antenna?: boolean; billboard?: Face | null; units?: number; shack?: boolean } = {}) {
    const D = this.B.detail;
    const minX = b.x - b.w / 2,
      maxX = b.x + b.w / 2,
      minZ = b.z - b.d / 2,
      maxZ = b.z + b.d / 2,
      h = b.h;
    const pc = o.parapet ?? "#5e5953";
    const t = 0.25,
      ph = 0.75;
    put(D, boxGeo(minX, h, minZ, maxX, h + ph, minZ + t), pc);
    put(D, boxGeo(minX, h, maxZ - t, maxX, h + ph, maxZ), pc);
    put(D, boxGeo(minX, h, minZ + t, minX + t, h + ph, maxZ - t), pc);
    put(D, boxGeo(maxX - t, h, minZ + t, maxX, h + ph, maxZ - t), pc);
    const inner = (m: number) => [this.R(minX + m, maxX - m), this.R(minZ + m, maxZ - m)] as const;
    if (o.tank && b.w > 5 && b.d > 5) {
      const [x, z] = inner(2.2);
      const r = this.R(0.8, 1.2),
        th = this.R(1.4, 2);
      const legs = 1.3;
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        put(D, boxGeo(x + dx * r * 0.7 - 0.06, h, z + dz * r * 0.7 - 0.06, x + dx * r * 0.7 + 0.06, h + legs, z + dz * r * 0.7 + 0.06), "#3e3a36");
      const g = new THREE.CylinderGeometry(r, r, th, 14);
      g.translate(x, h + legs + th / 2, z);
      put(D, g, this.chance(0.5) ? "#8d918c" : "#7c6656");
      const cap = new THREE.CylinderGeometry(r * 0.2, r, 0.35, 14);
      cap.translate(x, h + legs + th + 0.17, z);
      put(D, cap, "#6a6c68");
    }
    if (o.stair && b.w > 6 && b.d > 6) {
      const [x, z] = inner(2);
      put(this.B.plaster, boxGeo(x - 1.3, h, z - 1.2, x + 1.3, h + 2.5, z + 1.2), "#7c766e");
      put(D, boxGeo(x - 1.45, h + 2.5, z - 1.35, x + 1.45, h + 2.68, z + 1.35), "#4a4642");
    }
    if (o.shack && b.w > 5 && b.d > 5) {
      // A corrugated lean-to on the roof, propped with planks.
      const [x, z] = inner(2);
      put(this.B.corrugated, boxGeo(x - 1.4, h, z - 1.1, x + 1.4, h + 2.1, z + 1.1, 1), (_x, y, _z, c) => c.copy(col("#8e7a68")).multiplyScalar(0.8 + 0.2 * hash(y * 7)));
      put(this.B.wood, boxGeo(x - 1.6, h + 2.1, z - 1.3, x + 1.6, h + 2.2, z + 1.3), "#8a7660");
      put(this.B.wood, boxGeo(x + 1.45, h, z - 0.1, x + 1.55, h + 2.1, z + 0.1), "#7a6650");
    }
    for (let i = 0; i < (o.units ?? 0); i++) {
      const [x, z] = inner(1.2);
      this.I.ac.push({ p: new THREE.Vector3(x, h + 0.35, z), rot: this.R(0, 3), s: new THREE.Vector3(0.9, 0.7, 0.6), color: "#8e8a80" });
    }
    if (o.antenna) {
      const [x, z] = inner(1);
      const ah = this.R(3, 6);
      put(D, boxGeo(x - 0.04, h, z - 0.04, x + 0.04, h + ah, z + 0.04), "#3a3836");
      for (let k = 0; k < 3; k++) {
        const y = h + ah * (0.55 + k * 0.15);
        const l = 1.2 - k * 0.3;
        put(D, boxGeo(x - l, y, z - 0.02, x + l, y + 0.04, z + 0.02), "#3a3836");
      }
    }
    if (o.billboard) {
      const f = o.billboard;
      const a = f.len / 2,
        w = Math.min(f.len * 0.7, 9),
        bh = 3.2;
      const back = -Math.min(b.d, b.w) * 0.3;
      for (const s of [-w / 2 + 0.4, w / 2 - 0.4]) this.fbox(D, f, a + s - 0.08, a + s + 0.08, h, h + bh + 1.4, back - 0.08, back + 0.08, "#2f2c2a");
      for (const y of [h + 1.4, h + 1.4 + bh / 2, h + 1.4 + bh]) this.fbox(D, f, a - w / 2, a + w / 2, y - 0.06, y + 0.06, back - 0.06, back + 0.06, "#2f2c2a");
      for (let i = 0; i < 4; i++) if (this.chance(0.55)) this.fbox(D, f, a - w / 2 + (i * w) / 4, a - w / 2 + ((i + 1) * w) / 4 - 0.05, h + 1.45, h + 1.35 + bh, back + 0.08, back + 0.12, "#4c4640");
    }
  }

  // ───────────────────────── ground ─────────────────────────

  private ground() {
    const A = this.B.asphalt,
      C = this.B.concrete,
      K = CURB_HEIGHT;
    const fadeW = (x: number) => 1 - 0.65 * clamp01((-x - 40) / 130);
    // Asphalt: the street from the dark west to the end sidewalk, fading as it goes.
    const x0 = VISTA_END_X - 10,
      x1 = STREET.roadEast;
    const road = new THREE.PlaneGeometry(x1 - x0, STREET.roadSouth - STREET.roadNorth, 70, 7);
    road.rotateX(-Math.PI / 2);
    road.translate((x0 + x1) / 2, 0, (STREET.roadNorth + STREET.roadSouth) / 2);
    put(A, road, (x, _y, z, c) => {
      const n = 0.82 + 0.18 * hash(Math.floor(x / 3) * 3.7 + Math.floor(z / 2) * 11.3);
      const rut = 1 - 0.12 * Math.exp(-((z - 5.2) ** 2) * 3) - 0.12 * Math.exp(-((z - 7.8) ** 2) * 3);
      const gutter = 1 - 0.2 * Math.exp(-((z - 3.1) ** 2) * 10) - 0.2 * Math.exp(-((z - 9.9) ** 2) * 10);
      c.copy(col("#7a7872")).multiplyScalar(fadeW(x) * n * rut * gutter);
    });
    for (const [cx0, cx1] of CROSS_STREETS)
      for (const [z0, z1] of [
        [-70, STREET.roadNorth],
        [STREET.roadSouth, 80],
      ]) {
        const g = new THREE.PlaneGeometry(cx1 - cx0, z1 - z0, 2, 10);
        g.rotateX(-Math.PI / 2);
        g.translate((cx0 + cx1) / 2, -0.005, (z0 + z1) / 2);
        put(A, g, (_x, _y, z, c) => c.copy(col("#5a5853")).multiplyScalar(0.45 * (1 - 0.6 * clamp01(Math.abs(z - 6.5) / 60))));
      }
    // Damp patches: the same asphalt, darker and glossy (low roughness), irregular blobs.
    const blob = (x: number, z: number, rx: number, rz: number, seed: number) => {
      const g = new THREE.CircleGeometry(1, 28);
      const pos = g.getAttribute("position");
      for (let i = 1; i < pos.count; i++) {
        const k = 0.75 + 0.35 * hash(seed * 17 + i * 3.1) + 0.12 * Math.sin(i * 0.9 + seed);
        pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
      }
      g.scale(rx, rz, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.004, z);
      put(this.B.damp, g, (px, _y, pz, c) => c.copy(col("#55534f")).multiplyScalar(fadeW(px) * (0.9 + 0.1 * hash(pz))));
    };
    for (let k = 0; k < 26; k++) {
      const x = this.R(-90, 30),
        z = this.chance(0.5) ? this.R(3.3, 4.4) : this.chance(0.5) ? this.R(8.8, 9.7) : this.R(4.5, 8.5);
      blob(x, z, this.R(0.8, 2.6), this.R(0.4, 1.0), k);
    }
    // Raised areas (sidewalks, end sidewalk, alleys, vestibule, the rubble lot).
    const pave = (x: number, _y: number, z: number, c: THREE.Color) => {
      const slab = 0.86 + 0.14 * hash(Math.floor(x * 0.9) * 7.1 + Math.floor(z * 0.9) * 3.3);
      const edge = 1 - 0.22 * Math.exp(-((z - 0.15) ** 2) * 8) - 0.22 * Math.exp(-((z - 12.85) ** 2) * 8);
      c.copy(col("#8a877e")).multiplyScalar(fadeW(x) * slab * edge);
    };
    const dirt = (x: number, _y: number, z: number, c: THREE.Color) => {
      const n = 0.75 + 0.25 * hash(Math.floor(x * 1.3) * 5.1 + Math.floor(z * 1.3) * 9.7);
      c.copy(col(hash(Math.floor(x * 0.7) + Math.floor(z * 0.7) * 17) < 0.5 ? "#6a5f50" : "#7a776e")).multiplyScalar(n);
    };
    const xs: [number, number][] = [];
    let start = VISTA_END_X - 10;
    for (const [a, b] of [...CROSS_STREETS].sort((p, q) => p[0] - q[0])) {
      xs.push([start, a]);
      start = b;
    }
    xs.push([start, 34]);
    for (const [sx0, sx1] of xs) {
      put(C, boxGeo(sx0, 0, 0, sx1, K, STREET.roadNorth, 1), pave);
      put(C, boxGeo(sx0, 0, STREET.roadSouth, sx1, K, STREET.southFront, 1), pave);
    }
    put(C, boxGeo(STREET.roadEast, 0, STREET.roadNorth, 34, K, STREET.roadSouth, 1), pave);
    put(C, boxGeo(26, 0, -7, 29, K, 0, 1), pave); // north alley
    put(C, boxGeo(10.2, 0, -2.6, 13.8, K, 0, 1), pave); // TriMart vestibule
    put(C, boxGeo(-21, 0, 13, -17.5, K, 19.5, 1), pave); // diner alley
    put(C, boxGeo(21, 0, 13, 29, K, 19.5, 0.7), dirt); // rubble lot
    // Curb stones along the road edges (individual stones in the lit zone).
    const D = this.B.detail;
    const stone = (sx0: number, sx1: number, z0: number, z1: number, i: number) =>
      put(D, boxGeo(sx0, 0, z0, sx1, K + 0.008, z1), (x, _y, _z, c) => c.copy(col(i % 2 ? "#8e8a80" : "#86827a")).multiplyScalar((0.8 + 0.2 * hash(i * 3.3)) * fadeW(x)));
    let i = 0;
    for (let x = -60; x < STREET.roadEast; x += 1.0, i++) {
      const xe = Math.min(STREET.roadEast, x + 0.98);
      stone(x, xe, STREET.roadNorth - 0.22, STREET.roadNorth + 0.01, i);
      stone(x, xe, STREET.roadSouth - 0.01, STREET.roadSouth + 0.22, i + 1);
    }
    for (let z = STREET.roadNorth; z < STREET.roadSouth; z += 1, i++) stone(STREET.roadEast - 0.01, STREET.roadEast + 0.22, z, Math.min(STREET.roadSouth, z + 0.98), i);
    for (const [sx0, sx1] of xs) {
      const b = Math.min(sx1, -60);
      if (b <= sx0) continue;
      stone(sx0, b, STREET.roadNorth - 0.22, STREET.roadNorth + 0.01, 0);
      stone(sx0, b, STREET.roadSouth - 0.01, STREET.roadSouth + 0.22, 1);
    }
  }

  /** Faded road markings, cracks, stains, manholes, litter and weeds: all in the decal mesh. */
  private markings() {
    const L = this.B.decal,
      d = this.dec,
      K = CURB_HEIGHT;
    for (let x = VISTA_END_X; x < STREET.roadEast - 2; x += 5) {
      if (CROSS_STREETS.some(([a, b]) => x > a - 2 && x < b + 2)) continue;
      if (this.chance(0.85)) groundQuad(L, this.one(d.dashes), 3, 0.14, x + 1.5, 0.012, 6.5, 0);
    }
    for (let x = VISTA_END_X; x < STREET.roadEast - 1; x += 4) {
      if (CROSS_STREETS.some(([a, b]) => x > a - 4 && x < b)) continue;
      for (const z of [3.35, 9.65]) if (this.chance(0.7)) groundQuad(L, this.one(d.dashes), 4, 0.12, x + 2, 0.012, z, 0);
    }
    for (let k = 0; k < 90; k++) {
      const onRoad = this.chance(0.5);
      const x = this.R(-70, 30);
      const z = onRoad ? this.R(3.5, 9.5) : this.chance(0.5) ? this.R(0.4, 2.6) : this.R(10.4, 12.6);
      groundQuad(L, this.one(d.cracks), this.R(1.4, 3.4), this.R(1.4, 3.4), x, (onRoad ? 0 : K) + 0.013, z, this.R(0, 6));
    }
    for (let k = 0; k < 40; k++) {
      const onRoad = this.chance(0.6);
      const x = this.R(-60, 30);
      const z = onRoad ? this.R(3.6, 9.4) : this.chance(0.5) ? this.R(0.5, 2.5) : this.R(10.5, 12.5);
      const s = this.R(1, 3);
      groundQuad(L, this.one(d.stains), s, s * this.R(0.6, 1), x, (onRoad ? 0 : K) + 0.011, z, this.R(0, 6));
    }
    for (const [x, z] of [
      [-30, 6.5],
      [-3, 5.4],
      [22, 7.6],
      [-62, 6.5],
    ])
      groundQuad(L, d.manhole[0], 0.75, 0.75, x, 0.014, z, 0);
    for (let k = 0; k < 28; k++) {
      const z = this.chance(0.5) ? this.R(3.1, 3.6) : this.R(9.4, 9.9);
      groundQuad(L, d.litter[0], this.R(1, 2.2), 0.5, this.R(-50, 30), 0.015, z, this.R(-0.2, 0.2));
    }
    for (let k = 0; k < 8; k++) groundQuad(L, d.litter[0], this.R(1, 2), 1, this.R(21.5, 28.5), K + 0.015, this.R(13.5, 19), this.R(0, 6));
    for (let k = 0; k < 10; k++) groundQuad(L, this.one(d.cracks), 2.4, 2.4, this.R(21.5, 28.5), K + 0.013, this.R(13.5, 19), this.R(0, 6));
    for (const [x, z] of [
      [-19.3, 15],
      [-19, 18],
      [27.5, -2],
      [27.5, -5.5],
    ])
      groundQuad(L, this.one(d.stains), 2.2, 2.2, x, K + 0.011, z, this.R(0, 6));
    // Weeds: crossed tufts along the building feet, the curbs and in the lot.
    const tuft = (x: number, y: number, z: number, s = 1) => {
      const cell = this.one(d.weeds);
      const r = this.R(0, Math.PI);
      for (const k of [0, Math.PI / 2]) quad(L, cell, 0.55 * s, 0.42 * s, new THREE.Vector3(x, y + 0.2 * s, z), r + k);
    };
    for (let k = 0; k < 40; k++) {
      const x = this.R(-40, 31);
      if (Math.abs(x) < 2 || Math.abs(x - HOTEL_DOOR.x) < 1.2 || Math.abs(x - TRIMART_DOOR.x) < 1 || (x > 10 && x < 14)) continue;
      tuft(x, K, 0.18);
    }
    for (let k = 0; k < 30; k++) {
      const x = this.R(-40, 21);
      if (Math.abs(x - DINER_DOOR.x) < 1.2 || Math.abs(x - STONKS_DOOR.x) < 1.2) continue;
      tuft(x, K, 12.82);
    }
    for (let k = 0; k < 36; k++) tuft(this.R(-70, 31), 0, this.chance(0.5) ? 3.06 : 9.94, 0.8);
    for (let k = 0; k < 40; k++) tuft(this.R(21.3, 28.7), K, this.R(13.3, 19.3), this.R(1, 1.8));
    for (let k = 0; k < 10; k++) tuft(this.chance(0.5) ? -20.8 : -17.7, K, this.R(13.5, 19.3));
    for (let k = 0; k < 6; k++) tuft(this.R(26.2, 28.8), K, this.R(-6.8, -0.4));
    for (let k = 0; k < 60; k++) tuft(this.R(VISTA_END_X, -42), this.chance(0.5) ? 0 : K, this.R(0.2, 12.8), this.R(0.8, 1.6));
    // Rubble chunks and a couple of broken pallets in the lot (low, walkable).
    for (let k = 0; k < 26; k++) {
      const s = this.R(0.15, 0.55);
      const g = new THREE.BoxGeometry(s * this.R(1, 2.2), s * this.R(0.3, 0.6), s * this.R(0.8, 1.6));
      g.rotateY(this.R(0, 3));
      g.rotateX(this.R(-0.3, 0.3));
      g.translate(this.R(21.4, 28.6), K + s * 0.12, this.R(13.6, 19.2));
      put(this.B.concrete, g, this.chance(0.4) ? "#7a5a48" : "#8a867c");
    }
    for (const [x, z, r] of [
      [23, 18.6, 0.3],
      [27.6, 17.9, -0.5],
    ]) {
      for (let k = 0; k < 5; k++) {
        const g = new THREE.BoxGeometry(1.2, 0.03, 0.12);
        g.translate(0, 0, -0.5 + k * 0.25);
        g.rotateY(r);
        g.translate(x, K + 0.1, z);
        put(this.B.wood, g, "#8a7660");
      }
    }
  }

  // ───────────────────────── buildings ─────────────────────────

  private building(b: BuildingSpec) {
    for (const r of buildingSolids(b)) this.collision.add({ ...r, h: b.h, tag: "building" });
    const f = faceOf(b, sideOf(b.faces));
    switch (b.kind) {
      case "hotel":
        return this.hotel(b, f);
      case "fitting":
        return this.fitting(b, f);
      case "trimart":
        return this.trimart(b, f);
      case "posters":
        return this.posters(b, f);
      case "alley-back":
      case "lot-back":
        return this.backWall(b, f);
      case "casino":
        return this.casino(b, f);
      case "casino-wing":
        return this.casinoWing(b, f);
      case "diner":
        return this.diner(b, f);
      case "stonks":
        return this.stonks(b, f);
      case "scorched":
        return this.scorched(b, f);
      case "shuttered":
        return this.shuttered(b, f);
    }
  }

  /** The tallest neighbour (building or the shop) touching side `s` of `b`. */
  private neighbourHeight(b: BuildingSpec, s: Side) {
    const all: (Box2 & { h: number })[] = [...BUILDINGS, { ...SHOP, h: 6 }];
    const m = boundsOf(b);
    let h = 0;
    for (const o of all) {
      if (o === b) continue;
      const n = boundsOf(o);
      const zOver = n.minZ < m.maxZ - 0.5 && n.maxZ > m.minZ + 0.5;
      const xOver = n.minX < m.maxX - 0.5 && n.maxX > m.minX + 0.5;
      if (s === "e" && zOver && Math.abs(n.minX - m.maxX) < 0.4) h = Math.max(h, o.h);
      if (s === "w" && zOver && Math.abs(n.maxX - m.minX) < 0.4) h = Math.max(h, o.h);
      if (s === "n" && xOver && Math.abs(n.maxZ - m.minZ) < 0.4) h = Math.max(h, o.h);
      if (s === "s" && xOver && Math.abs(n.minZ - m.maxZ) < 0.4) h = Math.max(h, o.h);
    }
    return h;
  }

  /** Windows, AC units and downpipes on the exposed parts of the side walls. */
  private sideWindows(b: BuildingSpec, floorH: number, style: "normal" | "burnt" | "clinic" = "normal") {
    for (const s of ["e", "w"] as Side[]) {
      const nh = this.neighbourHeight(b, s);
      const f = faceOf(b, s);
      // Only the street half of a side wall is visible.
      const nearStreet = (s === "e") === (b.faces === "south");
      const a0 = nearStreet ? 0 : f.len * 0.4,
        a1 = nearStreet ? f.len * 0.6 : f.len;
      const rows: number[] = [];
      for (let y = Math.max(nh + 1.6, 4.6); y + 1 < b.h - 0.4; y += floorH) rows.push(y);
      if (rows.length) this.windows(f, { a0, a1, rows, step: 3, w: 1.1, h: 1.4, zone: false, style, ac: 0.35 });
      if (nh < b.h - 2) this.pipes(f, b.h, [nearStreet ? a1 - 0.6 : a0 + 0.6]);
    }
  }

  private hotel(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    const baseH = 5.2;
    this.shell("plaster", m.minX, 0, m.minZ, m.maxX, baseH, m.maxZ, "#6c655d", b.h, { base: 0.5 }, m);
    this.shell("brick", m.minX, baseH, m.minZ, m.maxX, b.h - 0.6, m.maxZ, b.tint, b.h, { soot: 0.4 }, m);
    const D = this.B.detail;
    this.fbox(D, f, -0.15, f.len + 0.15, 0, 0.5, 0, 0.18, "#4f4a44");
    this.fbox(D, f, -0.15, f.len + 0.15, baseH - 0.1, baseH + 0.3, 0, 0.3, "#7a736a");
    this.fbox(D, f, -0.25, f.len + 0.25, b.h - 0.6, b.h - 0.15, 0, 0.55, "#6e675e");
    this.fbox(D, f, -0.25, f.len + 0.25, b.h - 0.15, b.h + 0.6, 0, 0.3, "#5e5850");
    for (let a = 0; a <= f.len + 0.01; a += 3) this.fbox(D, f, a - 0.22, a + 0.22, baseH + 0.3, b.h - 0.6, 0, 0.14, wallFn("#7a6a5c", b.h, { soot: 0.5 }));
    const mineA = alongOf(f, HOTEL_WINDOW.x, HOTEL_WINDOW.z);
    this.windows(f, {
      rows: [HOTEL_WINDOW.y, HOTEL_WINDOW.y + 3, HOTEL_WINDOW.y + 5.85],
      step: 3,
      w: 1.25,
      h: 1.75,
      zone: true,
      ac: 0.35,
      fixed: (a, y) => (Math.abs(a - mineA) < 0.8 && Math.abs(y - HOTEL_WINDOW.y) < 0.1 ? this.win.mine[0] : null),
    });
    const doorA = alongOf(f, HOTEL_DOOR.x, HOTEL_DOOR.z);
    for (let a = 1.5; a < f.len; a += 3) {
      if (Math.abs(a - doorA) < 1.6) continue;
      const cell = this.chance(0.5) ? this.one(this.win.boarded) : this.win.dusty[0];
      this.fquad(this.B.facade, f, cell, a, 2.6, 1.5, 2.6, 0.02);
      this.fbox(D, f, a - 0.9, a + 0.9, 1.15, 1.27, 0, 0.2, "#5a544c");
      this.fbox(D, f, a - 0.95, a + 0.95, 3.95, 4.15, 0, 0.12, "#5a544c");
    }
    this.fbox(D, f, doorA - 1.05, doorA + 1.05, 0, 2.75, 0, 0.12, "#3e3630");
    this.fquad(this.B.facade, f, this.cell.doorHotel, doorA, CURB_HEIGHT + 1.22, 1.6, 2.45, 0.125);
    this.fbox(D, f, doorA - 1.3, doorA + 1.3, 2.9, 3.08, 0, 1.35, "#2e4038");
    this.fbox(D, f, doorA - 1.3, doorA + 1.3, 3.08, 3.3, 1.25, 1.35, "#a08a5a");
    for (const s of [-1.1, 1.1]) this.fbox(D, f, doorA + s - 0.03, doorA + s + 0.03, 3.1, 4.4, 0.06, 1.3, "#2a2a2a");
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.5, f.len, 1.0, 0.19);
    // Vertical half-dead HOTEL blade sign.
    const bladeA = f.len - 2.6;
    const bladeOut = 0.9;
    this.finst(this.I.signBox, f, bladeA - 0.12, bladeA + 0.12, 6.0, 12.6, 0.15, 1.65, "#241e1a");
    this.fbox(D, f, bladeA - 0.05, bladeA + 0.05, 6.2, 6.3, 0, 0.2, "#3a3632");
    this.fbox(D, f, bladeA - 0.05, bladeA + 0.05, 12.3, 12.4, 0, 0.2, "#3a3632");
    const chars: { ch: string; jp: boolean; dead: boolean }[] = [
      ...[...SIGNS.hotel.jp].map((ch, i) => ({ ch, jp: true, dead: i === 1 })),
      ...[...SIGNS.hotel.en].map((ch, i) => ({ ch, jp: false, dead: i === 3 || i === 4 })),
    ];
    const cellOf = new Map<string, AtlasRect>();
    for (const { ch, jp, dead } of chars) {
      const key = `${ch}/${dead}`;
      if (!cellOf.has(key)) cellOf.set(key, this.signs.add(128, 128, letterDraw(ch, jp ? JP_FONT : EN_FONT, "#ffb347", dead), dead ? 0 : 1));
    }
    let y = 12.0;
    for (const { ch, jp, dead } of chars) {
      const s = jp ? 1.15 : 0.62;
      y -= s / 2;
      const p = fp(f, bladeA, y, bladeOut);
      const r = cellOf.get(`${ch}/${dead}`)!;
      const ex = f.ax * 0.13,
        ez = f.az * 0.13;
      this.signs.quad(r, s, s, new THREE.Vector3(p.x + ex, y, p.z + ez), f.rot + Math.PI / 2);
      this.signs.quad(r, s, s, new THREE.Vector3(p.x - ex, y, p.z - ez), f.rot - Math.PI / 2);
      y -= s / 2 + 0.06;
    }
    this.sideWindows(b, 3);
    this.roof(b, { tank: true, stair: true, antenna: true, units: 3 });
    this.pipes(f, b.h, [0.4, f.len - 0.4, 7.5]);
  }

  private fitting(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    const R = FITTING_RECESS;
    const o = { soot: 0.3 };
    const back = m.maxZ - R.depth;
    this.shell("tile", m.minX, 0, m.minZ, m.maxX, b.h, back, b.tint, b.h, o, m);
    this.shell("tile", m.minX, 0, back, R.minX, b.h, m.maxZ, b.tint, b.h, o, m);
    this.shell("tile", R.maxX, 0, back, m.maxX, b.h, m.maxZ, b.tint, b.h, o, m);
    this.shell("tile", R.minX, 0, back, R.maxX, R.sill, m.maxZ, b.tint, b.h, o, m);
    this.shell("tile", R.minX, R.top, back, R.maxX, b.h, m.maxZ, b.tint, b.h, o, m);
    const D = this.B.detail;
    quad(this.B.facade, this.cell.fittingBack, R.maxX - R.minX, R.top - R.sill, new THREE.Vector3((R.minX + R.maxX) / 2, (R.sill + R.top) / 2, back + 0.01), 0);
    put(D, boxGeo(R.minX, R.sill - 0.02, back, R.maxX, R.sill + 0.01, m.maxZ + 0.02), "#6c6a64");
    for (const x of [R.minX, R.maxX - 0.08]) put(D, boxGeo(x, R.sill, m.maxZ - 0.08, x + 0.08, R.top, m.maxZ + 0.02), "#3c3a36");
    put(D, boxGeo(R.minX, R.top - 0.08, m.maxZ - 0.08, R.maxX, R.top, m.maxZ + 0.02), "#3c3a36");
    put(D, boxGeo((R.minX + R.maxX) / 2 - 0.03, R.sill, m.maxZ - 0.06, (R.minX + R.maxX) / 2 + 0.03, R.top, m.maxZ), "#3c3a36");
    quad(this.B.decal, this.dec.dustGlass[0], R.maxX - R.minX - 0.1, R.top - R.sill - 0.1, new THREE.Vector3((R.minX + R.maxX) / 2, (R.sill + R.top) / 2, m.maxZ - 0.04), 0);
    const closed = this.signs.add(256, 160, drawBilingual("closed", { bg: "#ece4cf", ink: "#b3261e", grime: 0.45, border: "#b3261e" }));
    this.signs.quad(closed, 0.6, 0.38, new THREE.Vector3(R.maxX - 0.9, 1.75, m.maxZ - 0.03), 0, new THREE.Euler(0, 0, 0.06));
    // Entrance east of the window: a roll-down shutter.
    const doorA = alongOf(f, -10.7, 0);
    this.fbox(this.B.shutter, f, doorA - 0.95, doorA + 0.95, CURB_HEIGHT, 2.75, 0, 0.05, "#8a9290");
    this.fbox(D, f, doorA - 1.05, doorA + 1.05, 2.75, 3.0, 0, 0.3, "#5c5f5c");
    this.fquad(this.B.decal, f, this.dec.graffiti[3], doorA, 1.4, 1.8, 0.9, 0.06);
    this.fbox(D, f, 0.4, f.len - 0.4, 3.05, 4.15, 0, 0.12, "#c5cbc6");
    const fascia = this.signs.add(1024, 112, drawBilingual("fitting", { bg: "#d4dad5", ink: "#2b6f78", inkEn: "#4c5f63", row: true, grime: 0.95 }));
    this.sign(fascia, f, f.len / 2, 3.6, f.len - 1.2, 0.95, 0.125);
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.45, f.len, 0.9, 0.012);
    this.windows(f, { rows: [5.9], step: 2.6, w: 1.4, h: 1.5, zone: true, style: "clinic", ac: 0.5 });
    this.lightbox(f, 1.1, 7.8, 3.4, "clinicNaika", true);
    this.roof(b, { units: 2, tank: true });
    this.pipes(f, b.h, [f.len - 0.25, 4.6]);
  }

  private trimart(b: BuildingSpec, f: Face) {
    const cut = b.cutout!;
    const m = boundsOf(b);
    const o = { soot: 0.25 };
    for (const r of buildingSolids(b)) this.shell("plaster", r.x - r.w / 2, 0, r.z - r.d / 2, r.x + r.w / 2, b.h, r.z + r.d / 2, b.tint, b.h, o, m);
    this.shell("plaster", cut.minX, VESTIBULE_CEILING, cut.minZ, cut.maxX, b.h, cut.maxZ, b.tint, b.h, o, m);
    const D = this.B.detail,
      FA = this.B.facade;
    const vw = cut.maxX - cut.minX,
      vd = cut.maxZ - cut.minZ,
      vy = (CURB_HEIGHT + VESTIBULE_CEILING) / 2,
      vh = VESTIBULE_CEILING - CURB_HEIGHT;
    quad(FA, this.cell.vestibule, vw, vh, new THREE.Vector3((cut.minX + cut.maxX) / 2, vy, cut.minZ + 0.01), 0);
    quad(FA, this.cell.vestibule, vd, vh, new THREE.Vector3(cut.minX + 0.01, vy, (cut.minZ + cut.maxZ) / 2), Math.PI / 2);
    quad(FA, this.cell.vestibule, vd, vh, new THREE.Vector3(cut.maxX - 0.01, vy, (cut.minZ + cut.maxZ) / 2), -Math.PI / 2);
    quad(FA, this.cell.ceilingLight, 1.3, 0.6, new THREE.Vector3((cut.minX + cut.maxX) / 2, VESTIBULE_CEILING - 0.01, (cut.minZ + cut.maxZ) / 2), 0, "#ffffff", Math.PI / 2);
    const g0 = alongOf(f, cut.maxX, 0) + 0.25,
      g1 = f.len - 0.4;
    this.fquad(FA, f, this.cell.trimart, (g0 + g1) / 2, 1.5, g1 - g0, 2.3, 0.015);
    const doorA = alongOf(f, TRIMART_DOOR.x, TRIMART_DOOR.z);
    this.fquad(FA, f, this.cell.doorTrimart, doorA, CURB_HEIGHT + 1.15, 1.2, 2.3, 0.03);
    this.fbox(D, f, g0 - 0.1, g1 + 0.1, 0, 0.35, 0, 0.1, "#55585a");
    this.fbox(D, f, g0 - 0.1, g1 + 0.1, 2.65, 2.8, 0, 0.1, "#55585a");
    this.fquad(this.B.decal, f, this.dec.dustGlass[0], (g0 + g1) / 2, 1.6, g1 - g0, 2.2, 0.04);
    this.fbox(D, f, g0 - 0.2, f.len - 0.1, 2.95, 4.1, 0, 0.14, "#d8d4c6");
    const fascia = this.signs.add(1024, 176, (c, w, h) => {
      c.fillStyle = "#ebe7da";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#1f8f8a";
      c.fillRect(0, 0, w, 16);
      c.fillStyle = "#f08a24";
      c.fillRect(0, h - 16, w, 16);
      drawTriangleMark(c, 92, h / 2, 118, "#1d2a33");
      c.fillStyle = "#1d2a33";
      c.textAlign = "center";
      c.textBaseline = "middle";
      fitFont(c, SIGNS.trimart.jp, w * 0.46, h * 0.56, JP_FONT);
      c.fillText(SIGNS.trimart.jp, w * 0.44, h * 0.5);
      fitFont(c, SIGNS.trimart.en, w * 0.3, h * 0.36, EN_FONT);
      c.fillText(SIGNS.trimart.en, w * 0.82, h * 0.52);
      grime(c, w, h, 1, 77);
    });
    this.sign(fascia, f, (g0 + f.len) / 2 - 0.1, 3.52, f.len - g0 - 0.2, 1.0, 0.145);
    const atmA = alongOf(f, (cut.minX + cut.maxX) / 2, 0);
    this.fbox(D, f, atmA - vw / 2 - 0.05, atmA + vw / 2 + 0.05, 3.02, 3.82, 0, 0.16, "#1b2230");
    const atm = this.signs.add(
      512,
      112,
      (c, w, h) => {
        c.fillStyle = "#0e1c34";
        c.fillRect(0, 0, w, h);
        c.strokeStyle = "#7fd8ff";
        c.lineWidth = 4;
        c.strokeRect(5, 5, w - 10, h - 10);
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.shadowColor = "#7fd8ff";
        c.shadowBlur = 12;
        c.fillStyle = "#f2fbff";
        fitFont(c, "ATM", w * 0.36, h * 0.72, EN_FONT, 800);
        c.fillText("ATM", w * 0.24, h * 0.54);
        fitFont(c, SIGNS.atm.jp, w * 0.5, h * 0.4, JP_FONT);
        c.fillText(SIGNS.atm.jp, w * 0.7, h * 0.36);
        c.fillStyle = "#9fdcf5";
        fitFont(c, SIGNS.atm.en, w * 0.44, h * 0.22, EN_FONT);
        c.fillText(SIGNS.atm.en, w * 0.7, h * 0.74);
        c.shadowBlur = 0;
      },
      1.2,
    );
    this.sign(atm, f, atmA, 3.42, vw - 0.1, 0.72, 0.17);
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.45, f.len, 0.9, 0.11);
    this.windows(f, { rows: [5.6], step: 2.7, w: 1.3, h: 1.4, zone: true, ac: 0.5, laundry: 0.3 });
    this.lightbox(f, f.len - 0.6, 7.2, 2.8, "kissaHotaru", true);
    this.roof(b, { units: 3, billboard: f });
    this.pipes(f, b.h, [0.25, 6.6]);
  }

  private posters(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    this.shell("plaster", m.minX, 0, m.minZ, m.maxX, 4.6, m.maxZ, "#8a7c6c", b.h, { base: 0.5 }, m);
    this.shell("brick", m.minX, 4.6, m.minZ, m.maxX, b.h, m.maxZ, b.tint, b.h, { soot: 0.35 }, m);
    this.fbox(this.B.detail, f, -0.05, f.len + 0.05, 4.5, 4.7, 0, 0.12, "#5a524a");
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.55, f.len, 1.1, 0.012);
    this.fquad(this.B.decal, f, this.dec.moss[0], 0.6, 3.2, 0.8, 2.6, 0.013);
    this.windows(f, { rows: [6.3], step: 2.4, w: 1.0, h: 1.2, zone: true, ac: 0.5 });
    this.lightbox(f, f.len - 0.5, 7.6, 2.6, "snackYunagi", true);
    const e = faceOf(b, "e");
    this.fquad(this.B.decal, e, this.dec.graffiti[1], 3, 1.5, 2.4, 1.2, 0.012);
    this.fquad(this.B.decal, e, this.dec.baseGrime[0], e.len / 2, 0.5, e.len, 1.0, 0.012);
    this.corrugatedPatch(e, 4.5, 6.8, 0.3, 2.6, 0.04);
    this.pipes(e, b.h, [2.2]);
    this.sideWindows(b, 3);
    this.roof(b, { tank: true, units: 1, shack: true });
  }

  private backWall(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    this.shell("brick", m.minX, 0, m.minZ, m.maxX, b.h, m.maxZ, b.tint, b.h, { soot: 0.2 }, m);
    this.fbox(this.B.detail, f, -0.05, f.len + 0.05, b.h, b.h + 0.18, -0.02, 0.1, "#4e4640");
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.5, f.len, 1.0, 0.012);
    this.fquad(this.B.decal, f, this.dec.graffiti[b.kind === "lot-back" ? 0 : 3], f.len * 0.4, 1.6, 2.6, 1.3, 0.013);
    this.fquad(this.B.decal, f, this.dec.moss[0], f.len * 0.8, b.h - 1.3, 0.9, 2.6, 0.013);
    if (b.kind === "lot-back") {
      // Chain-link fence (and a few corrugated sheets) on top of the low wall.
      const D = this.B.detail;
      const fh = 1.8;
      for (let a = 0; a <= f.len + 0.01; a += 2) this.fbox(D, f, a - 0.04, a + 0.04, b.h, b.h + fh + 0.1, 0.02, 0.1, "#6a6a66");
      this.fbox(D, f, 0, f.len, b.h + fh, b.h + fh + 0.05, 0.03, 0.08, "#6a6a66");
      for (let a = 1; a < f.len; a += 2) {
        if (a > 4 && a < 6.5) continue;
        this.fquad(this.B.decal, f, this.dec.chain[0], a, b.h + fh / 2, 2, fh, 0.06);
      }
      this.corrugatedPatch(f, 4, 6.6, b.h, b.h + fh - 0.1, 0.1);
      this.fbox(D, f, 0, f.len, b.h + fh + 0.25, b.h + fh + 0.27, 0.05, 0.07, "#2a2826");
    } else {
      this.pipes(f, b.h, [0.5]);
    }
  }

  /** Chestnut base, chestnut trim bands and a green accent line on a casino face. */
  private casinoBands(f: Face, a0: number, a1: number, h: number) {
    const D = this.B.detail;
    this.fbox(D, f, a0, a1, 0, 1.0, 0, 0.06, "#5e3420");
    for (const y of [4.4, 9.4, 14.4]) if (y < h - 0.5) this.fbox(D, f, a0, a1, y, y + 0.3, 0, 0.1, "#6a3a22");
    this.fbox(D, f, a0, a1, 4.1, 4.2, 0, 0.07, "#2f6a48");
    this.fbox(D, f, a0 - 0.1, a1 + 0.1, h - 0.6, h, 0, 0.22, "#6a3a22");
  }

  private casinoWing(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    this.shell("tile", m.minX, 0, m.minZ, m.maxX, b.h, m.maxZ, "#e6e0d2", b.h, { soot: 0.2, base: 0.3 }, m);
    this.casinoBands(f, 0, f.len, b.h);
    const w = faceOf(b, "w");
    const a0 = b.faces === "south" ? w.len - 7.2 : 0,
      a1 = b.faces === "south" ? w.len : 6.2;
    this.casinoBands(w, a0, a1, b.h);
    this.windows(f, { rows: [6.6, 11.6], step: 2.4, w: 0.9, h: 1.4, zone: true, fixed: () => this.win.barred[0] });
    this.windows(w, { a0, a1, rows: [6.6, 11.6], step: 3.2, w: 0.9, h: 1.4, zone: false, fixed: () => this.win.barred[0], ac: 0.5 });
    this.fquad(this.B.facade, f, this.cell.louver, f.len / 2, 2.4, 1.0, 1.0, 0.02);
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.6, f.len, 1.2, 0.07);
    this.fquad(this.B.decal, w, this.dec.baseGrime[0], (a0 + a1) / 2, 0.6, a1 - a0, 1.2, 0.07);
    this.fquad(this.B.decal, w, this.dec.graffiti[b.faces === "south" ? 2 : 1], (a0 + a1) / 2, 1.7, 2.6, 1.3, 0.075);
    this.fquad(this.B.decal, f, this.dec.leak[0], 1.5, b.h - 3, 1.6, 5, 0.012);
    this.pipes(f, b.h, [0.3]);
    this.pipes(w, b.h, [b.faces === "south" ? a0 + 0.4 : a1 - 0.4]);
    if (b.faces === "south") this.fquad(this.B.decal, f, this.dec.char[0], f.len - 1.2, b.h - 1.2, 3.2, 2.6, 0.24);
    this.roof(b, { parapet: "#6a3a22", units: 2 });
  }

  private casino(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    this.shell("tile", m.minX, 0, m.minZ, m.maxX, b.h, m.maxZ, "#e6e0d2", b.h, { soot: 0.2, base: 0.3 }, m);
    this.casinoBands(f, 0, f.len, b.h);
    const D = this.B.detail,
      FA = this.B.facade;
    const doorA = alongOf(f, CASINO_FIRE_DOOR.x, CASINO_FIRE_DOOR.z);
    this.fbox(D, f, doorA - 0.85, doorA + 0.85, 0, 2.55, 0, 0.1, "#6a3a22");
    this.fquad(FA, f, this.cell.doorFire, doorA, CURB_HEIGHT + 1.15, 1.25, 2.3, 0.105);
    this.fbox(D, f, doorA - 1.1, doorA + 1.1, 3.0, 3.12, 0, 1.0, "#2f6a48");
    const exit = this.signs.add(256, 112, drawBilingual("fireExit", { bg: "#178a48", ink: "#f0fff4", jpShare: 0.6 }), 0.9);
    this.sign(exit, f, doorA, 2.75, 0.85, 0.37, 0.11);
    this.windows(f, { a0: 15, a1: 30, rows: [6.6, 11.6], step: 3, w: 1.0, h: 1.5, zone: true, fixed: () => this.win.barred[0], ac: 0.3 });
    this.windows(f, { a0: 0, a1: 15.5, rows: [15.6], step: 3.4, w: 1.0, h: 1.3, zone: false, fixed: () => (this.chance(0.5) ? this.win.barred[0] : this.win.burnt[0]), sills: false });
    this.windows(f, { a0: 30, a1: f.len, rows: [15.6], step: 3.4, w: 1.0, h: 1.3, zone: false, fixed: () => this.win.barred[0], sills: false });
    for (const a of [doorA - 3.2, doorA + 3.4]) this.fquad(FA, f, this.cell.louver, a, 2.2, 1.1, 1.1, 0.02);
    this.pipes(f, b.h, [doorA - 5.2, doorA + 5.3]);
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.7, f.len, 1.4, 0.075);
    for (const a of [doorA - 4.5, doorA + 2.2]) this.fquad(this.B.decal, f, this.dec.leak[0], a, 7, 1.8, 6, 0.012);
    // The big back-lit sign, half dead.
    const signA = alongOf(f, 34, 6.5);
    this.fbox(D, f, signA - 6.2, signA + 6.2, 11.6, 17.4, 0, 0.45, "#231e1c");
    for (const s of [-4, 0, 4]) this.fbox(D, f, signA + s - 0.08, signA + s + 0.08, 10.2, 11.6, 0, 0.3, "#2c2826");
    const row = (chars: string[], dead: Set<number>, font: string, size: number, y: number, color: string) => {
      const step = size * 1.08;
      chars.forEach((ch, i) => {
        const r = this.signs.add(128, 128, letterDraw(ch, font, color, dead.has(i)), dead.has(i) ? 0 : 1.1);
        this.sign(r, f, signA + (i - (chars.length - 1) / 2) * step, y, size, size, 0.47);
      });
    };
    row([...SIGNS.casino.jp], new Set([1]), JP_FONT, 2.4, 15.95, "#ffe6b0");
    row([...SIGNS.casino.en], new Set([2, 4]), EN_FONT, 1.75, 12.75, "#fff0c8");
    // Soot from the burnt roof corner, a charred patch and burnt roof beams.
    const fireA = alongOf(f, 34, ROOF_FIRE.z);
    this.fquad(this.B.decal, f, this.dec.char[0], fireA, b.h - 1.6, 6, 3.4, 0.03);
    for (let k = 0; k < 5; k++) {
      const len = this.R(3, 7);
      this.fquad(this.B.decal, f, this.dec.streaks[0], fireA + this.R(-3, 3), b.h - 0.6 - len / 2, this.R(0.8, 1.5), len, 0.035);
    }
    this.fquad(this.B.decal, f, this.dec.plume[0], fireA + 1.5, b.h - 2.2, 4, 4.5, 0.04);
    const cx = ROOF_FIRE.x,
      cz = ROOF_FIRE.z;
    put(D, boxGeo(m.minX, b.h - 0.02, cz - 4, cx + 3, b.h + 0.03, cz + 3.5), "#0d0b0a");
    for (let k = 0; k < 7; k++) {
      const len = this.R(2.5, 5);
      const g = new THREE.BoxGeometry(0.22, len, 0.22);
      g.translate(0, len / 2, 0);
      g.rotateX(this.R(-0.7, 0.7));
      g.rotateZ(this.R(-0.8, 0.8));
      g.translate(cx + this.R(-2.5, 2.5), b.h, cz + this.R(-3, 3));
      put(D, g, "#0f0c0b");
    }
    for (let k = 0; k < 4; k++) {
      const g = new THREE.BoxGeometry(this.R(3, 5), 0.2, 0.2);
      g.rotateZ(this.R(-0.3, 0.3));
      g.rotateY(this.R(-0.4, 0.4));
      g.translate(cx + this.R(-1.5, 1.5), b.h + this.R(1, 2.4), cz + this.R(-2.5, 2.5));
      put(D, g, "#100d0c");
    }
    const P = "#6a3a22";
    put(D, boxGeo(m.minX, b.h, m.minZ, m.minX + 0.3, b.h + 0.8, cz - 3.6), P);
    put(D, boxGeo(m.minX, b.h, cz + 2.2, m.minX + 0.3, b.h + 0.8, m.maxZ), P);
    put(D, boxGeo(m.minX, b.h, m.minZ, m.maxX, b.h + 0.8, m.minZ + 0.3), P);
    put(D, boxGeo(m.minX, b.h, m.maxZ - 0.3, m.maxX, b.h + 0.8, m.maxZ), P);
    put(D, boxGeo(m.minX + 3, b.h, cz + 8, m.minX + 9, b.h + 3, cz + 14), "#8c8a84");
    put(D, boxGeo(m.minX + 10, b.h, cz + 16, m.minX + 13, b.h + 2, cz + 22), "#7e7c76");
    this.roof({ x: b.x + 4, z: b.z + 6, w: 6, d: 6, h: b.h + 0.01 }, { tank: true });
  }

  private diner(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    this.shell("plaster", m.minX, 0, m.minZ, m.maxX, b.h, m.maxZ, "#9a3530", b.h, { soot: 0.2, base: 0.3 }, m);
    const D = this.B.detail,
      FA = this.B.facade;
    this.fbox(D, f, -0.05, f.len + 0.05, 0, 0.95, 0, 0.08, "#6a6c6e");
    this.fbox(D, f, -0.05, f.len + 0.05, 0.92, 1.0, 0, 0.12, "#c9cdd0");
    this.fbox(D, f, -0.05, f.len + 0.05, 3.15, 3.25, 0, 0.12, "#c9cdd0");
    this.fbox(D, f, -0.1, f.len + 0.1, b.h - 0.35, b.h, 0, 0.3, "#c9cdd0");
    this.fbox(D, f, -0.08, f.len + 0.08, 3.25, 4.8, 0, 0.1, "#7a7c7e");
    const doorA = alongOf(f, DINER_DOOR.x, DINER_DOOR.z);
    const wy = 2.07,
      wh = 2.1;
    const left0 = doorA + 0.9,
      left1 = f.len - 0.6;
    const right0 = 0.6,
      right1 = doorA - 0.9;
    this.fquad(FA, f, this.cell.diner, (left0 + left1) / 2, wy, left1 - left0, wh, 0.02);
    this.fquad(FA, f, this.cell.diner, (right0 + right1) / 2, wy, right1 - right0, wh, 0.02);
    this.fquad(FA, f, this.cell.doorDiner, doorA, CURB_HEIGHT + 1.15, 1.2, 2.3, 0.03);
    for (const a of [left0, left1, right0, right1]) this.fbox(D, f, a - 0.06, a + 0.06, 0.95, 3.2, 0, 0.1, "#c9cdd0");
    this.fbox(D, f, doorA - 0.75, doorA + 0.75, 2.35, 2.45, 0, 0.12, "#c9cdd0");
    const fascia = this.signs.add(768, 128, drawBilingual("diner", { bg: "#2a2a2e", ink: "#ff3b30", inkEn: "#ffd2c8", row: true, glow: 14, grime: 0.3 }), 0.9);
    this.sign(fascia, f, f.len * 0.62, 4.02, 6.2, 1.05, 0.12);
    const eat = this.signs.add(256, 320, eatHereDraw(), 1.25);
    this.fbox(D, f, doorA + 2.1, doorA + 4.3, 4.85, 4.95, 0, 0.12, "#2a2a2a");
    this.sign(eat, f, doorA + 3.2, 5.0, 1.9, 2.4, 0.14);
    const e = faceOf(b, "e");
    const kA = alongOf(e, DINER_KITCHEN_DOOR.x, DINER_KITCHEN_DOOR.z);
    this.fquad(FA, e, this.cell.doorKitchen, kA, CURB_HEIGHT + 1.05, 1.0, 2.1, 0.02);
    this.fbox(D, e, kA - 0.6, kA + 0.6, 2.25, 2.35, 0, 0.1, "#3a3632");
    const staff = this.signs.add(256, 96, drawBilingual("staffOnly", { bg: "#e7e1d1", ink: "#7a1c16", grime: 0.6, jpShare: 0.6 }));
    this.sign(staff, e, kA, 1.85, 0.5, 0.19, 0.035);
    this.fquad(this.B.decal, e, this.dec.baseGrime[0], e.len / 2, 0.6, e.len, 1.2, 0.012);
    this.fquad(this.B.decal, e, this.dec.moss[0], kA - 2.2, 4.2, 1, 2.6, 0.012);
    this.finst(this.I.ac, e, kA + 1.2, kA + 2.0, 3.0, 3.6, 0, 0.35, "#a8a498");
    this.fquad(FA, e, this.cell.acFace, kA + 1.6, 3.3, 0.78, 0.56, 0.355);
    this.pipes(e, b.h, [kA + 2.6, kA - 1.2]);
    this.pipes(f, b.h, [0.3, f.len - 0.3]);
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.5, f.len, 1.0, 0.09);
    this.roof(b, { units: 4, antenna: true });
    put(D, boxGeo(m.maxX - 3, b.h, m.minZ + 4, m.maxX - 1.8, b.h + 2.2, m.minZ + 5.2), "#8a8c8e");
  }

  private stonks(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    const E = STONKS_ENTRY;
    const o = { soot: 0.3 };
    this.shell("brick", m.minX, 0, m.minZ + E.depth, m.maxX, b.h, m.maxZ, b.tint, b.h, o, m);
    this.shell("brick", m.minX, 0, m.minZ, E.minX, b.h, m.minZ + E.depth, b.tint, b.h, o, m);
    this.shell("brick", E.maxX, 0, m.minZ, m.maxX, b.h, m.minZ + E.depth, b.tint, b.h, o, m);
    this.shell("brick", E.minX, 2.7, m.minZ, E.maxX, b.h, m.minZ + E.depth, b.tint, b.h, o, m);
    const D = this.B.detail,
      FA = this.B.facade;
    for (let s = 0; s < 3; s++) put(this.B.concrete, boxGeo(E.minX, 0, m.minZ + 0.35 * s, E.maxX, CURB_HEIGHT + 0.17 * (s + 1), m.minZ + E.depth), s % 2 ? "#7a766e" : "#86827a");
    quad(FA, this.cell.doorSteel, 1.1, 2.15, new THREE.Vector3((E.minX + E.maxX) / 2, CURB_HEIGHT + 0.51 + 1.07, m.minZ + E.depth - 0.01), Math.PI);
    for (const x of [E.minX + 0.08, E.maxX - 0.08]) {
      put(D, boxGeo(x - 0.025, CURB_HEIGHT + 0.9, m.minZ - 0.25, x + 0.025, CURB_HEIGHT + 0.95, m.minZ + 0.9), "#2c2c2c");
      put(D, boxGeo(x - 0.025, CURB_HEIGHT, m.minZ - 0.25, x + 0.025, CURB_HEIGHT + 0.95, m.minZ - 0.2), "#2c2c2c");
    }
    this.fbox(D, f, alongOf(f, E.maxX, 0) - 0.15, alongOf(f, E.minX, 0) + 0.15, 2.7, 2.85, 0, 0.25, "#4a4642");
    const posterA = alongOf(f, -5.8, 13),
      cardA = alongOf(f, -14.6, 13);
    for (const a of [posterA, cardA]) {
      this.fquad(FA, f, this.win.dark[1], a, 1.75, 2.0, 1.6, 0.02);
      this.fbox(D, f, a - 1.1, a + 1.1, 0.85, 0.95, 0, 0.16, "#77726a");
      for (let k = -2; k <= 2; k++) this.fbox(D, f, a + k * 0.45 - 0.02, a + k * 0.45 + 0.02, 0.95, 2.55, 0.02, 0.06, "#1c1a18");
    }
    const graph = this.signs.add(256, 256, stockGraphDraw());
    this.sign(graph, f, posterA, 1.78, 0.95, 0.95, 0.025);
    const card = this.signs.add(256, 176, drawBilingual("topPrices", { bg: "#fff3c0", ink: "#c4161c", border: "#c4161c", grime: 0.3 }));
    this.sign(card, f, cardA + 0.35, 1.55, 0.8, 0.55, 0.025);
    this.windows(f, { rows: [5.3, 8.8], step: 2.9, w: 1.2, h: 1.5, zone: true, ac: 0.6, laundry: 0.5 });
    this.balconies(f, 1, 5.2, [4.2, 7.7]);
    this.lightbox(f, alongOf(f, -12.6, 13), 7.0, 2.6, "pawn", true);
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.5, f.len, 1.0, 0.012);
    this.fquad(this.B.decal, f, this.dec.graffiti[3], alongOf(f, -16.2, 13), 1.5, 1.6, 0.8, 0.013);
    this.pipes(f, b.h, [0.3, f.len - 0.3]);
    this.sideWindows(b, 3.5);
    this.roof(b, { tank: true, stair: true, antenna: true, units: 2, shack: true });
  }

  private scorched(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    this.shell("brick", m.minX, 0, m.minZ, m.maxX, b.h, m.maxZ, b.tint, b.h, { soot: 0.6, dark: 0.7, base: 0.55 }, m);
    const D = this.B.detail,
      FA = this.B.facade;
    const s0 = 0.8,
      s1 = 8.8;
    this.fquad(FA, f, this.cell.scorchedStore, (s0 + s1) / 2, 1.55, s1 - s0, 2.5, 0.02);
    // Plywood hoarding nailed across half the burnt storefront.
    for (let k = 0; k < 3; k++) this.fbox(this.B.wood, f, s0 + 0.2 + k * 1.25, s0 + 1.4 + k * 1.25, 0.3, 2.6 - k * 0.3, 0.04, 0.07, k % 2 ? "#8a7660" : "#7c6a56");
    this.fquad(this.B.decal, f, this.dec.graffiti[0], s0 + 2, 1.5, 2.6, 1.3, 0.08);
    this.fquad(this.B.decal, f, this.dec.plume[0], (s0 + s1) / 2, 4.3, 7, 5, 0.03);
    this.fbox(D, f, s0 - 0.1, s1 + 0.1, 2.8, 3.1, 0, 0.18, "#161210");
    const crateA = 11.2;
    this.fquad(FA, f, this.cell.crate, crateA, 1.6, 1.8, 1.35, 0.02);
    this.fquad(this.B.decal, f, this.dec.plume[0], crateA, 3.3, 2.4, 3.2, 0.03);
    this.fquad(FA, f, this.win.boarded[1], 14.2, 1.25, 1.2, 2.3, 0.02);
    this.fquad(this.B.decal, f, this.dec.char[0], f.len / 2, 0.8, f.len, 1.6, 0.012);
    this.windows(f, { rows: [5.0, 8.4], step: 2.6, w: 1.25, h: 1.5, zone: false, style: "burnt" });
    this.lightbox(f, f.len - 0.6, 8.6, 3.6, "karaoke", false);
    this.corrugatedPatch(f, 2.3, 4.3, 4.2, 5.8);
    for (let a = 0; a < f.len; a += 2.2) if (this.chance(0.65)) this.fbox(D, f, a, a + 2.0, b.h, b.h + this.R(0.2, 0.8), 0, 0.3, "#1e1a17");
    for (let k = 0; k < 6; k++) {
      const g = new THREE.BoxGeometry(0.18, this.R(1.5, 3), 0.18);
      g.rotateZ(this.R(-0.6, 0.6));
      g.translate(this.R(m.minX + 1, m.maxX - 1), b.h + 0.8, this.R(m.minZ + 1, m.minZ + 5));
      put(D, g, "#100d0c");
    }
    this.pipes(f, b.h, [0.3]);
    this.sideWindows(b, 3.4, "burnt");
  }

  private shuttered(b: BuildingSpec, f: Face) {
    const m = boundsOf(b);
    this.shell("tile", m.minX, 0, m.minZ, m.maxX, b.h, m.maxZ, "#9a968a", b.h, { soot: 0.3 }, m);
    const D = this.B.detail;
    const shutters: [number, number, string][] = [
      [0.5, 3.8, "#7f8a86"],
      [4.2, 7.5, "#9a8f78"],
    ];
    shutters.forEach(([a0, a1, tone], i) => {
      this.fbox(this.B.shutter, f, a0, a1, CURB_HEIGHT, 2.85, 0, 0.05, (_x, y, _z, c) => c.copy(col(tone)).multiplyScalar(0.7 + 0.3 * smooth(0, 1.4, y)));
      this.fbox(D, f, a0 - 0.1, a1 + 0.1, 2.85, 3.3, 0, 0.35, "#5d5a54");
      for (const a of [a0 - 0.08, a1]) this.fbox(D, f, a, a + 0.08, 0, 2.85, 0, 0.08, "#4a4744");
      this.fquad(this.B.decal, f, this.dec.graffiti[i * 2], (a0 + a1) / 2 + this.R(-0.3, 0.3), 1.6, 2.6, 1.3, 0.07);
      this.fquad(this.B.decal, f, this.dec.streaks[1], (a0 + a1) / 2 + 0.6, 2.2, 0.6, 1.3, 0.07);
    });
    this.fquad(this.B.decal, f, this.dec.graffiti[1], 4, 3.8, 2.2, 1.1, 0.012);
    this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.5, f.len, 1.0, 0.012);
    this.windows(f, { rows: [5.5], step: 2.6, w: 1.2, h: 1.4, zone: true, ac: 0.5, laundry: 0.3 });
    this.lightbox(f, 0.5, 7.4, 3.0, "denkiRepair", false);
    const e = faceOf(b, "e");
    this.fquad(this.B.decal, e, this.dec.graffiti[2], e.len - 2.5, 1.7, 3, 1.5, 0.012);
    this.fquad(this.B.decal, e, this.dec.baseGrime[0], e.len / 2, 0.5, e.len, 1.0, 0.012);
    this.corrugatedPatch(e, e.len - 7, e.len - 4.6, 0.2, 2.4, 0.04);
    this.pipes(f, b.h, [f.len - 0.25]);
    this.sideWindows(b, 3);
    this.roof(b, { units: 2, tank: true, shack: true });
  }

  // ───────────────────────── the dead street west of the barricade ─────────────────────────

  /** A generic dead building (no collision): shell, cramped storefronts, windows, signs, rooftop. */
  private deadBuilding(b: Box2 & { h: number }, side: Side, o: { fade?: boolean; ground?: boolean; crossSides?: Side[] } = {}) {
    const m = boundsOf(b);
    const tints = ["#7a7066", "#8a8478", "#6e6a64", "#857262", "#6a645e", "#7c7a72", "#8c7a6a", "#a09a8c"];
    const tint = this.one(tints);
    const r = this.rng();
    const mat: WallMat = r < 0.4 ? "brick" : r < 0.7 ? "tile" : "plaster";
    this.shell(mat, m.minX, 0, m.minZ, m.maxX, b.h, m.maxZ, tint, b.h, { soot: 0.35, fade: o.fade }, m);
    const f = faceOf(b, side);
    const D = this.B.detail;
    if (o.ground !== false) {
      // Cramped storefronts: shutters, dusty dark glass, a corrugated cover-up.
      const n = Math.max(1, Math.round(f.len / 3.6));
      const w = f.len / n;
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) * w;
        const k = this.rng();
        if (k < 0.55) {
          this.fbox(this.B.shutter, f, a - w / 2 + 0.3, a + w / 2 - 0.3, CURB_HEIGHT, 2.7, 0, 0.05, this.one(["#7f8a86", "#9a8f78", "#6e7a80", "#8a8a84"]));
          this.fbox(D, f, a - w / 2 + 0.2, a + w / 2 - 0.2, 2.7, 3.05, 0, 0.3, "#55524c");
        } else if (k < 0.85) this.fquad(this.B.facade, f, this.cell.darkStore, a, CURB_HEIGHT + 1.3, w - 0.6, 2.5, 0.03);
        else this.corrugatedPatch(f, a - w / 2 + 0.25, a + w / 2 - 0.25, CURB_HEIGHT, 2.8, 0.05);
        if (this.chance(0.35)) this.fquad(this.B.decal, f, this.one(this.dec.graffiti), a, 1.5, 2.2, 1.1, 0.08);
        this.fbox(D, f, a - w / 2, a - w / 2 + 0.2, 0, 3.4, 0, 0.1, "#4e4a46");
      }
      this.fbox(D, f, 0, f.len, 3.05, 3.6, 0, 0.14, this.one(["#4a4440", "#5a5650", "#3e4448", "#5a4a40"]));
      this.fquad(this.B.decal, f, this.dec.baseGrime[0], f.len / 2, 0.5, f.len, 1.0, 0.15);
    }
    const rows: number[] = [];
    const floorH = this.R(2.9, 3.3);
    for (let y = 4.9; y + 0.9 < b.h - 0.4; y += floorH) rows.push(y);
    this.windows(f, { rows, step: this.R(2.4, 3.2), w: 1.15, h: 1.4, zone: false, ac: 0.45, laundry: 0.2, sills: b.h < 22 });
    for (const s of o.crossSides ?? []) {
      const sf = faceOf(b, s);
      this.windows(sf, { rows, step: 3, w: 1.1, h: 1.4, zone: false, sills: false, ac: 0.3, a0: 0, a1: sf.len });
      this.pipes(sf, b.h, [sf.len * 0.5]);
    }
    this.pipes(f, b.h, [0.25, f.len - 0.25]);
    // Dead vertical lightboxes (tategaki), sometimes two.
    const nSigns = this.chance(0.75) ? (this.chance(0.4) ? 2 : 1) : 0;
    for (let k = 0; k < nSigns; k++) {
      const a = k === 0 ? this.R(0.6, f.len * 0.4) : this.R(f.len * 0.6, f.len - 0.6);
      const top = Math.min(b.h - 0.5, this.R(8, 13));
      this.lightbox(f, a, top, this.R(3, 5), this.one(LIGHTBOXES), false);
    }
    if (this.chance(0.35) && b.h < 20 && rows.length) this.balconies(f, 0.5, f.len - 0.5, rows.slice(0, 3).map((y) => y - 1.1), "#5e5a54");
    if (this.chance(0.3) && rows.length) {
      const a = this.R(1, f.len - 3);
      this.corrugatedPatch(f, a, a + this.R(1.6, 2.6), rows[0] - 0.9, rows[0] + 0.9);
    }
    this.roof(b, { tank: this.chance(0.5), antenna: this.chance(0.4), units: Math.floor(this.rng() * 3), stair: this.chance(0.4), shack: this.chance(0.3), billboard: this.chance(0.15) ? f : null });
  }

  private vista() {
    const edges = [-40, ...CROSS_STREETS.flat(), VISTA_END_X].sort((a, b) => b - a);
    for (let i = 0; i + 1 < edges.length; i += 2) {
      const x1 = edges[i],
        x0 = edges[i + 1];
      for (const north of [true, false]) {
        let x = x1;
        while (x > x0 + 3) {
          const w = Math.min(x - x0, this.R(6, 15));
          const h = this.chance(0.3) ? this.R(18, 30) : this.R(8, 17);
          const d = this.R(12, 16);
          const z = north ? STREET.northFront - d / 2 - this.R(0, 0.3) : STREET.southFront + d / 2 + this.R(0, 0.3);
          const cross: Side[] = [];
          if (x === x1 && x1 !== -40) cross.push("e");
          if (x - w <= x0 + 3.01) cross.push("w");
          this.deadBuilding({ x: x - w / 2, z, w, d, h }, north ? "s" : "n", { fade: true, crossSides: cross });
          x -= w;
        }
      }
    }
  }

  /** Taller blocks just behind the street rows and the casino, so the canyon has depth. */
  private midground() {
    const blocks: [number, number, number, number, number, Side][] = [
      [-30, -24, 16, 12, 22, "s"],
      [-12, -26, 14, 14, 18, "s"],
      [6, -27, 16, 12, 26, "s"],
      [22, -24, 12, 10, 20, "s"],
      [-46, -25, 12, 14, 24, "s"],
      [-28, 34, 18, 14, 20, "n"],
      [-6, 33, 14, 12, 16, "n"],
      [10, 34, 16, 14, 28, "n"],
      [26, 33, 12, 12, 19, "n"],
      [-48, 34, 14, 14, 26, "n"],
      [64, -8, 12, 20, 34, "w"],
      [62, 16, 10, 16, 26, "w"],
      [44, -28, 18, 12, 30, "s"],
      [44, 33, 18, 12, 24, "n"],
    ];
    for (const [x, z, w, d, h, side] of blocks) this.deadBuilding({ x, z, w, d, h }, side, { ground: false });
  }

  // ───────────────────────── skyline and horizon (unlit) ─────────────────────────

  private skyList(dist: number) {
    return dist < SKY_SPLIT ? this.B.skyNear : this.B.skyFar;
  }
  private skyBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, dist: number, top = maxY) {
    const haze = col("#3a2a48").clone().lerp(col("#5a3e5e"), clamp01((dist - 60) / 260));
    const dark = col("#0e0a13").clone().lerp(col("#1c1424"), clamp01((dist - 60) / 260));
    put(this.skyList(dist), boxGeo(minX, minY, minZ, maxX, maxY, maxZ, 0), (_x, y, _z, c) => c.copy(dark).lerp(haze, Math.pow(1 - clamp01(y / Math.max(1, top)), 2.2) * 0.7));
  }

  private skyline() {
    const rng = mulberry(731);
    const R = (a: number, b: number) => a + (b - a) * rng();
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 50; tries++) {
      const ang = rng() * Math.PI * 2;
      const dist = R(72, 290);
      const x = Math.cos(ang) * dist,
        z = 6.5 + Math.sin(ang) * dist;
      if (Math.cos(ang) < -0.86) continue;
      if (x < -40 && Math.abs(z - 6.5) < 60) continue;
      if (x > -60 && x < 80 && z > -50 && z < 60) continue;
      const w = R(14, 38),
        d = R(14, 38);
      if (Math.hypot(x, z) + Math.max(w, d) * 0.75 > 325) continue;
      const h = R(26, 60) + dist * R(0.08, 0.22);
      this.skyBox(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, dist);
      const r = rng();
      if (r < 0.3) this.skyBox(x - w * 0.3, h, z - d * 0.3, x + w * 0.3, h + R(4, 12), z + d * 0.3, dist, h + 12);
      else if (r < 0.55) this.skyBox(x - 0.4, h, z - 0.4, x + 0.4, h + R(8, 20), z + 0.4, dist, h + 20);
      else if (r < 0.7) {
        const g = new THREE.CylinderGeometry(2.4, 2.4, 3.2, 10);
        g.translate(x + R(-w / 4, w / 4), h + 4.2, z + R(-d / 4, d / 4));
        put(this.skyList(dist), g, "#0f0b14");
        this.skyBox(x - 2, h, z - 2, x + 2, h + 2.6, z + 2, dist);
      }
      placed++;
    }
    const F = this.B.skyFar;
    // The Triangle Co. glass tower straight down the street (east), crowned with the mark.
    const tx = 262,
      tz = 4,
      th = 104;
    this.skyBox(tx - 14, 0, tz - 14, tx + 14, th, tz + 14, 262);
    for (let y = 10; y < th; y += 8) put(F, boxGeo(tx - 14.3, y, tz - 14.3, tx - 14.1, y + 0.5, tz + 14.3), "#272436");
    this.skyBox(tx - 4, th, tz - 4, tx + 4, th + 4, tz + 4, 262);
    const tri = (a: THREE.Vector2, b: THREE.Vector2) => {
      const len = a.distanceTo(b);
      const g = new THREE.BoxGeometry(1.8, len + 1.6, 1.8);
      g.rotateX(-Math.atan2(b.x - a.x, b.y - a.y));
      g.translate(tx - 2, (a.y + b.y) / 2, tz + (a.x + b.x) / 2);
      put(F, g, "#141019");
    };
    const top = new THREE.Vector2(0, th + 24),
      bl = new THREE.Vector2(-11, th + 5),
      br = new THREE.Vector2(11, th + 5);
    tri(top, bl);
    tri(bl, br);
    tri(br, top);
    const dot = new THREE.CylinderGeometry(2, 2, 1.6, 12);
    dot.rotateZ(Math.PI / 2);
    dot.translate(tx - 2, th + 12.5, tz);
    put(F, dot, "#141019");
    // A construction crane over the north-east.
    const cx = 92,
      cz = -118;
    this.skyBox(cx - 1.4, 0, cz - 1.4, cx + 1.4, 88, cz + 1.4, 150);
    const crane = (g: THREE.BufferGeometry, lx: number, ly: number) => {
      g.translate(lx, ly, 0);
      g.rotateY(0.5);
      g.translate(cx, 0, cz);
      put(F, g, "#120e17");
    };
    crane(new THREE.BoxGeometry(72, 1.8, 1.8), 18, 88.9);
    crane(new THREE.BoxGeometry(4, 3.2, 3), 0, 86);
    crane(new THREE.BoxGeometry(1.2, 10, 1.2), 0, 94.8);
    crane(new THREE.BoxGeometry(5, 3, 3), -14, 87.5);
    crane(new THREE.BoxGeometry(0.2, 34, 0.2), 42, 72);
    // The stadium bowl, dark on its hill to the north-west.
    const hx = -150,
      hz = -205;
    const hill = new THREE.SphereGeometry(68, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    hill.scale(1, 0.42, 1);
    hill.translate(hx, -0.5, hz);
    put(F, hill, (_x, y, _z, c) => c.copy(col("#130f17")).lerp(col("#2e2436"), 1 - clamp01(y / 28)));
    const bowl = new THREE.CylinderGeometry(40, 31, 16, 36, 1, true);
    bowl.translate(hx, 34, hz);
    put(F, bowl, "#120e16");
    const rim = new THREE.CylinderGeometry(40.5, 40.5, 1.4, 36, 1, true);
    rim.translate(hx, 42, hz);
    put(F, rim, "#0e0b12");
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const mx = hx + Math.cos(a) * 42,
        mz = hz + Math.sin(a) * 42;
      put(F, boxGeo(mx - 0.6, 26, mz - 0.6, mx + 0.6, 66, mz + 0.6), "#0e0b12");
      put(F, boxGeo(mx - 3, 64, mz - 1, mx + 3, 68, mz + 1), "#0e0b12");
    }
    // A dark ground under everything, out to the horizon.
    const disc = new THREE.CircleGeometry(330, 48);
    disc.rotateX(-Math.PI / 2);
    disc.translate(0, -0.06, 6.5);
    put(F, disc, "#120e14");
  }

  /** The western horizon: the grassy hill and the facility's low silhouette under the sunset. */
  private horizon() {
    const S = this.B.skyFar;
    const hill = (x: number, z: number, r: number, sy: number, sz: number) => {
      const g = new THREE.SphereGeometry(r, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, sy, sz);
      g.translate(x, -0.5, z);
      put(S, g, (_x, y, _z, c) => c.copy(col("#1c1d14")).lerp(col("#3a3626"), Math.pow(1 - clamp01(y / (r * sy)), 1.5)));
    };
    hill(-268, 22, 52, 0.24, 1.0);
    hill(-245, -48, 44, 0.17, 0.9);
    hill(-252, 74, 38, 0.15, 0.8);
    const fac = "#16121a";
    put(S, boxGeo(-262, 0, -18, -226, 8, 6), fac);
    put(S, boxGeo(-256, 0, 6, -238, 12, 18), fac);
    put(S, boxGeo(-246, 0, -26, -242, 20, -22), fac);
    put(S, boxGeo(-232, 0, -32, -224, 6, 30), fac);
    put(S, boxGeo(-218, 0, -60, -217, 4, 60), "#141016");
    const N = this.B.skyNear;
    for (let x = VISTA_END_X - 4; x > -215; x -= 14) {
      put(N, boxGeo(x - 0.12, 0, 2.6, x + 0.12, 7, 2.84), "#141016");
      put(N, boxGeo(x - 0.1, 6.8, 2.6, x + 0.1, 6.95, 4.2), "#141016");
    }
    for (const [x, z, w, h] of [
      [-185, 18, 10, 6],
      [-196, -12, 14, 8],
      [-205, 30, 8, 4],
    ] as const)
      put(N, boxGeo(x - w / 2, 0, z - w / 2, x + w / 2, h, z + w / 2), "#120e15");
  }

  // ───────────────────────── assembly ─────────────────────────

  private assemble() {
    const B = this.B;
    const add = (geo: Geo, material: THREE.Material, name: string, cast: boolean, receive = true) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = name;
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.userData.keepDynamic = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
      return mesh;
    };
    /** A surfaces.* material with vertex colours on (the tint lives in the vertex colours). */
    const surf = (m: THREE.MeshStandardMaterial, name: string, roughness?: number) => {
      const c = m.clone();
      c.vertexColors = true;
      c.color.set("#ffffff");
      if (roughness !== undefined) c.roughness = roughness;
      c.name = `city:${name}`;
      return c;
    };
    const uv = (g: Geo, scale: number) => {
      physicalUVs(g, scale);
      return g;
    };
    add(uv(merge(B.asphalt), 0.25), surf(surfaces.wetAsphalt, "asphalt", 0.62), "city:asphalt", false);
    const damp = surf(surfaces.wetAsphalt, "damp", 0.1);
    damp.polygonOffset = true;
    damp.polygonOffsetFactor = -1;
    damp.polygonOffsetUnits = -2;
    damp.envMapIntensity = 1.6;
    add(uv(merge(B.damp), 0.25), damp, "city:damp", false);
    add(uv(merge(B.concrete), 0.45), surf(surfaces.concrete, "concrete"), "city:concrete", true);
    add(uv(merge(B.plaster), 0.45), surf(surfaces.plasterStained, "plaster"), "city:plaster", true);
    add(uv(merge(B.brick), 0.45), surf(surfaces.brick, "brick"), "city:brick", true);
    add(uv(merge(B.tile), 0.5), surf(surfaces.tiles, "tiles"), "city:tiles", true);
    add(uv(merge(B.corrugated), 0.6), surf(surfaces.corrugated, "corrugated"), "city:corrugated", true);
    add(uv(merge(B.wood), 0.6), surf(surfaces.woodWorn, "wood"), "city:wood", true);
    add(uv(merge(B.shutter), 0.5), surf(surfaces.shutter, "shutter"), "city:shutter", false);
    add(merge(B.detail), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.12, name: "city:details" }), "city:details", true);
    const F = this.facadeAtlas;
    add(
      merge(B.facade),
      new THREE.MeshStandardMaterial({ map: F.map(), emissiveMap: F.emissive(), emissive: new THREE.Color("#ffffff"), emissiveIntensity: 2.2, vertexColors: true, roughness: 0.55, metalness: 0.1, name: "city:facades" }),
      "city:facades",
      false,
    );
    const decals = add(
      merge(B.decal),
      new THREE.MeshStandardMaterial({
        name: "city:decals",
        map: this.decalAtlas.map(true),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.02,
        roughness: 0.9,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      "city:decals",
      false,
    );
    decals.renderOrder = 1;
    this.root.add(this.signs.build());
    // Repeated facade hardware: instanced unit boxes.
    const instanced = (list: Inst[], material: THREE.Material, name: string) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length);
      const m4 = new THREE.Matrix4(),
        q = new THREE.Quaternion(),
        up = new THREE.Vector3(0, 1, 0);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, m4.compose(it.p, q.setFromAxisAngle(up, it.rot), it.s));
        mesh.setColorAt(i, col(it.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = name;
      mesh.receiveShadow = true;
      mesh.userData.keepDynamic = true;
      this.root.add(mesh);
    };
    instanced(this.I.ac, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2, name: "city:ac" }), "city:ac-units");
    instanced(this.I.pipe, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.35, name: "city:pipes" }), "city:pipes");
    instanced(this.I.signBox, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3, name: "city:sign-boxes" }), "city:sign-boxes");
    instanced(this.I.rail, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.5, name: "city:rails" }), "city:rails");
    // Skyline: near ring and far ring, unlit and fog-free.
    const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, name: "city:skyline" });
    add(merge(B.skyNear), skyMat, "city:skyline-near", false, false);
    const far = add(merge(B.skyFar), skyMat, "city:skyline-far", false, false);
    far.frustumCulled = false;
  }

  /** Nothing animates in the city any more (rain moved to the particles module); kept for world.ts. */
  update(_dt: number, _camera: THREE.Camera) {}
}

// ─────────────────────────────── sign drawings ───────────────────────────────

/** One neon/back-lit letter on a transparent cell; dead letters are dull grey tubes. */
function letterDraw(ch: string, font: string, color: string, dead: boolean) {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    fitFont(c, ch, w * 0.86, h * 0.84, font, 800);
    if (dead) {
      c.fillStyle = "#5a524c";
      c.fillText(ch, w / 2, h * 0.54);
      c.strokeStyle = "#2e2a27";
      c.lineWidth = 2;
      c.strokeText(ch, w / 2, h * 0.54);
      return;
    }
    c.shadowColor = color;
    c.shadowBlur = 14;
    c.fillStyle = color;
    c.fillText(ch, w / 2, h * 0.54);
    c.shadowBlur = 0;
    c.strokeStyle = "rgba(255,255,255,0.75)";
    c.lineWidth = 2;
    c.strokeText(ch, w / 2, h * 0.54);
  };
}

/** A vertical lightbox face: the Japanese name top to bottom (tategaki), the English small at the foot. */
function tategakiDraw(key: SignKey, bg: string, ink: string, dead: boolean) {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    const s = SIGNS[key];
    c.fillStyle = dead ? "#8a857a" : bg;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = dead ? "#3a3632" : ink;
    c.lineWidth = 5;
    c.strokeRect(4, 4, w - 8, h - 8);
    const chars = [...s.jp].filter((ch) => ch.trim());
    const foot = 34;
    const size = Math.min(w * 0.74, (h - foot - 20) / chars.length);
    c.fillStyle = dead ? "#4a3f38" : ink;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = `800 ${size}px ${JP_FONT}`;
    const y0 = 12 + (h - foot - 20 - size * chars.length) / 2;
    chars.forEach((ch, i) => {
      // Long-vowel marks turn upright in vertical writing.
      if (ch === "ー") {
        c.save();
        c.translate(w / 2, y0 + size * (i + 0.5));
        c.rotate(Math.PI / 2);
        c.fillText(ch, 0, 0);
        c.restore();
      } else c.fillText(ch, w / 2, y0 + size * (i + 0.5));
    });
    fitFont(c, s.en, w * 0.86, 16, EN_FONT);
    c.fillText(s.en, w / 2, h - foot / 2 - 4);
    grime(c, w, h, dead ? 1 : 0.35, key.length * 13 + (dead ? 7 : 0));
  };
}

/** The diner's red neon arrow with yellow tubing: "EAT" down the shaft, "Here" along the turn. */
function eatHereDraw() {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.lineJoin = "round";
    const path = () => {
      c.beginPath();
      c.moveTo(20, 12);
      c.lineTo(104, 12);
      c.lineTo(104, h - 118);
      c.lineTo(w - 70, h - 118);
      c.lineTo(w - 70, h - 150);
      c.lineTo(w - 10, h - 78);
      c.lineTo(w - 70, h - 10);
      c.lineTo(w - 70, h - 40);
      c.lineTo(20, h - 40);
      c.closePath();
    };
    path();
    c.fillStyle = "#c81e1a";
    c.fill();
    c.shadowColor = "#ffd23a";
    c.shadowBlur = 16;
    c.strokeStyle = "#ffd23a";
    c.lineWidth = 7;
    path();
    c.stroke();
    c.shadowBlur = 0;
    c.strokeStyle = "#fff6c0";
    c.lineWidth = 2;
    path();
    c.stroke();
    c.fillStyle = "#fff4d0";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = "#ffffff";
    c.shadowBlur = 8;
    c.font = `800 52px ${EN_FONT}`;
    const word = EN_ONLY.eatHere.split(" ");
    [...word[0]].forEach((ch, i) => c.fillText(ch, 62, 50 + i * 54));
    c.font = `italic 700 40px ${EN_FONT}`;
    c.fillText(word[1] ?? "", 150, h - 78);
    c.shadowBlur = 0;
  };
}

/** Stonks's window poster: an ascending stock graph, sun-faded. */
function stockGraphDraw() {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    const r = mulberry(35);
    c.fillStyle = "#efe9d8";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(60,80,100,0.25)";
    c.lineWidth = 1;
    for (let x = 30; x < w; x += 22) {
      c.beginPath();
      c.moveTo(x, 20);
      c.lineTo(x, h - 30);
      c.stroke();
    }
    for (let y = 20; y < h - 30; y += 22) {
      c.beginPath();
      c.moveTo(30, y);
      c.lineTo(w - 12, y);
      c.stroke();
    }
    c.strokeStyle = "#2a2a2a";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(30, 16);
    c.lineTo(30, h - 30);
    c.lineTo(w - 10, h - 30);
    c.stroke();
    let y = h - 60;
    const pts: [number, number][] = [];
    for (let x = 42; x < w - 30; x += 16) {
      const ny = y - (r() * 16 - 4);
      c.fillStyle = ny < y ? "#2e9a4a" : "#c8322a";
      c.fillRect(x - 4, Math.min(y, ny), 8, Math.abs(ny - y) + 3);
      pts.push([x, ny]);
      y = ny;
    }
    c.strokeStyle = "#1e8a3e";
    c.lineWidth = 5;
    c.beginPath();
    pts.forEach(([x, py], i) => (i ? c.lineTo(x, py - 10) : c.moveTo(x, py - 10)));
    c.stroke();
    const [lx, ly] = pts[pts.length - 1];
    c.fillStyle = "#1e8a3e";
    c.beginPath();
    c.moveTo(lx + 22, ly - 26);
    c.lineTo(lx - 4, ly - 22);
    c.lineTo(lx + 10, ly);
    c.closePath();
    c.fill();
    c.fillStyle = "#2a2a2a";
    c.font = `800 26px ${EN_FONT}`;
    c.textAlign = "left";
    c.fillText("$ ↑↑↑", 40, h - 8);
    grime(c, w, h, 0.5, 35);
  };
}
