/**
 * Geometry plumbing for the Tamashi: a PartBuilder that collects coloured primitives bound
 * to rig bones and merges them into ONE skinned BufferGeometry, plus the primitive shapes.
 *
 * Owns: per-vertex colour / finish (`rme`) / skin binding, merging, small shape helpers.
 * Must not: know about traits (tv-head.ts, body.ts, headwear.ts decide what to build).
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CLOTH, type Finish } from "./materials";
import { BI, type RigBone } from "./rig";

/** A solid colour, or a function of the vertex position/normal (part-local, after `m`). */
export type Paint = THREE.Color | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.Color);

/** Per-vertex skin weights: up to two bones. Return [boneA, boneB, weightOfA]. */
export type Weights = (p: THREE.Vector3, index: number, count: number) => [RigBone, RigBone, number];

const V = new THREE.Vector3();
const N = new THREE.Vector3();

export class PartBuilder {
  private geos: THREE.BufferGeometry[] = [];
  /** Bone that subsequent parts bind to (coordinates relative to its rest joint). */
  bone: RigBone = "hips";

  constructor(
    readonly rest: THREE.Vector3[],
    /** 0 = full detail, 1 = far LOD. */
    readonly lod: 0 | 1,
  ) {}

  get hi(): boolean {
    return this.lod === 0;
  }

  /** Bind subsequent parts to `bone`. */
  on(bone: RigBone): this {
    this.bone = bone;
    return this;
  }

  /**
   * Add a part. `g` is consumed (mutated). Coordinates are relative to the bone's joint,
   * after applying `m`. `weights` (optional) spreads vertices over two bones.
   */
  add(g: THREE.BufferGeometry, paint: Paint, finish: Finish = CLOTH, m?: THREE.Matrix4, weights?: Weights): this {
    let geo = g.index ? g : indexed(g);
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    if (m) geo.applyMatrix4(m);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
    const n = pos.count;
    const color = new Float32Array(n * 3);
    const rme = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const origin = this.rest[BI[this.bone]];
    const solid = paint instanceof THREE.Color ? paint : null;
    for (let i = 0; i < n; i++) {
      V.fromBufferAttribute(pos, i);
      const c = solid ?? (paint as (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color)(V, N.fromBufferAttribute(nor, i));
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;
      rme[i * 3] = finish.r;
      rme[i * 3 + 1] = finish.m;
      rme[i * 3 + 2] = finish.e ?? 0;
      if (weights) {
        const [a, b, w] = weights(V, i, n);
        // Weights are expressed in body coordinates: convert below after offset.
        si[i * 4] = BI[a];
        si[i * 4 + 1] = BI[b];
        sw[i * 4] = w;
        sw[i * 4 + 1] = 1 - w;
      } else {
        si[i * 4] = BI[this.bone];
        sw[i * 4] = 1;
      }
    }
    geo.translate(origin.x, origin.y, origin.z);
    geo.setAttribute("color", new THREE.BufferAttribute(color, 3));
    geo.setAttribute("rme", new THREE.BufferAttribute(rme, 3));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    geo.morphAttributes = {};
    geo.clearGroups();
    this.geos.push(geo);
    return this;
  }

  /** Merge everything added so far into one indexed skinned geometry. */
  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos, false);
    if (!merged) throw new Error("Tamashi: geometry merge failed");
    for (const g of this.geos) g.dispose();
    this.geos = [];
    return merged;
  }
}

/** Add a trivial index to a non-indexed geometry. */
function indexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute("position").count;
  const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

export function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute("position").count) / 3;
}

// ── Transforms ──

const E = new THREE.Euler();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();

/** Matrix from translation, Euler rotation (XYZ) and scale. */
export function tr(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz));
}

/** Matrix placing a +y-aligned primitive from `a` to `b` (its length must be |b − a|, centred). */
export function between(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 {
  const d = b.clone().sub(a);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
}

// ── Primitives (all centred at the origin unless noted) ──

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function rbox(w: number, h: number, d: number, r: number, segs = 1): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, segs, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}

/**
 * Rounded box whose x size tapers from `wBottom` to `wTop` (and optionally z from
 * `dBottom` to `dTop`) along its height. Good for chunky torsos with flat fronts.
 */
export function taperBox(wBottom: number, wTop: number, h: number, dBottom: number, dTop: number, r: number, segs = 1): THREE.BufferGeometry {
  const w = Math.max(wBottom, wTop);
  const d = Math.max(dBottom, dTop);
  const g = rbox(w, h, d, r, segs);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h + 0.5;
    pos.setX(i, (pos.getX(i) * (wBottom + (wTop - wBottom) * t)) / w);
    pos.setZ(i, (pos.getZ(i) * (dBottom + (dTop - dBottom) * t)) / d);
  }
  g.computeVertexNormals();
  return g;
}

/** Cylinder along +y, centred. */
export function cyl(rTop: number, rBottom: number, h: number, segs = 8, open = false, hs = 1): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, h, segs, hs, open);
}

/** Limb segment from `top` (joint) down by `len`, tapering, starting at the joint (y 0 → −len). */
export function limb(rTop: number, rBottom: number, len: number, segs = 8, scaleZ = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, len, segs, 1, true);
  g.translate(0, -len / 2, 0);
  if (scaleZ !== 1) g.scale(1, 1, scaleZ);
  return g;
}

export function sphere(r: number, ws = 8, hs = 6): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, ws, hs);
}

/** Upper hemisphere (dome), flat side down at y = 0. */
export function dome(r: number, ws = 10, hs = 4): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2);
}

export function cone(r: number, h: number, segs = 8, open = false): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, h, segs, 1, open);
}

export function torus(r: number, tube: number, rs = 4, ts = 12, arc = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, tube, rs, ts, arc);
}

/** Flat quad facing +z. */
export function quad(w: number, h: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(w, h);
}

/** Rounded rectangle path (centred) on a Shape or Path. */
export function roundRectPath<T extends THREE.Path>(p: T, w: number, h: number, r: number): T {
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

/** Flat rounded-rect ring (frame) facing +z: outer w×h, `t` thick. */
export function frame(w: number, h: number, r: number, t: number, curveSegs = 3): THREE.BufferGeometry {
  const s = roundRectPath(new THREE.Shape(), w, h, r);
  s.holes.push(roundRectPath(new THREE.Path(), w - 2 * t, h - 2 * t, Math.max(0.001, r - t)));
  return new THREE.ShapeGeometry(s, curveSegs);
}

/** Tube along a curve; `radial` sides. */
export function tube(points: THREE.Vector3[], radius: number, segs = 16, radial = 5): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  return new THREE.TubeGeometry(curve, segs, radius, radial, false);
}

/**
 * Smooth rounded torso piece: a superellipsoid (exponent `p`: 1 = ellipsoid, → 0 = box)
 * whose width/depth taper from bottom (w0, d0) to top (w1, d1). No chamfer ridges.
 */
export function softBox(w0: number, w1: number, h: number, d0: number, d1: number, p = 0.4, ws = 12, hs = 8): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const f = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), p);
  for (let i = 0; i < pos.count; i++) {
    const sx = f(pos.getX(i));
    const sy = f(pos.getY(i));
    const sz = f(pos.getZ(i));
    const t = (sy + 1) / 2;
    pos.setXYZ(i, (sx * (w0 + (w1 - w0) * t)) / 2, (sy * h) / 2, (sz * (d0 + (d1 - d0) * t)) / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** Front surface (z) of a softBox at normalised height sy ∈ [−1, 1], as a fraction of its half-depth. */
export function softFront(sy: number, p = 0.4): number {
  const a = Math.min(1, Math.abs(sy));
  return Math.pow(Math.max(0, 1 - Math.pow(a, 2 / p)), p / 2);
}
