/**
 * Solids: a vertex-coloured geometry collector for street props.
 *
 * Owns: turning many small primitives (boxes, cylinders, tubes, rocks) into ONE merged,
 * vertex-coloured BufferGeometry per call to `mesh()`, with world-scaled UVs (so a shared
 * grime texture tiles at a physical size) and a little ground dirt baked into the colours.
 * Must not: know about layout or gameplay; callers place every part.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { physicalUVs } from "../materials";

/** Deterministic PRNG (mulberry32) so the street dresses the same way every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rot = THREE.Euler | number | undefined;

const KEEP = ["position", "normal", "uv"];

export function compose(x: number, y: number, z: number, rot?: Rot, scale?: THREE.Vector3) {
  const q = new THREE.Quaternion();
  if (typeof rot === "number") q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  else if (rot) q.setFromEuler(rot);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, scale ?? new THREE.Vector3(1, 1, 1));
}

export class Solids {
  private parts: THREE.BufferGeometry[] = [];
  constructor(
    private readonly rand: () => number,
    /** Height of the surrounding ground: vertices near it get darker (dirt, soot, splash). */
    private readonly ground = 0.15,
  ) {}

  get count() {
    return this.parts.length;
  }

  /** Add any geometry (consumed) with a world matrix and a flat colour. */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m: THREE.Matrix4, dirt = 1, jitter = 0.08) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.applyMatrix4(m);
    for (const n of Object.keys(g.attributes)) if (!KEEP.includes(n)) g.deleteAttribute(n);
    if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    physicalUVs(g, 0.5);
    const pos = g.getAttribute("position");
    const cols = new Float32Array(pos.count * 3);
    const base = new THREE.Color(color).multiplyScalar(1 + (this.rand() - 0.5) * 2 * jitter);
    for (let i = 0; i < pos.count; i++) {
      const above = Math.max(0, pos.getY(i) - this.ground);
      const d = 1 - dirt * 0.42 * Math.exp(-above / 0.55);
      cols[i * 3] = base.r * d;
      cols[i * 3 + 1] = base.g * d;
      cols[i * 3 + 2] = base.b * d * 0.97;
    }
    g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    this.parts.push(g);
    return g;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, rot?: Rot, dirt = 1) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, compose(x, y, z, rot), dirt);
  }

  cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 8, rot?: Rot, dirt = 1) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), color, compose(x, y, z, rot), dirt);
  }

  /** A cylinder between two points (pipes, legs, rebar). */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.ColorRepresentation, seg = 5, dirt = 1) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    return this.add(g, color, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), dirt);
  }

  /** Irregular lump (rubble, trash bags). */
  rock(r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, scale = new THREE.Vector3(1, 1, 1), detail = 0, dirt = 1) {
    const rot = new THREE.Euler(this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28);
    const g = detail ? new THREE.IcosahedronGeometry(r, detail) : new THREE.DodecahedronGeometry(r, 0);
    return this.add(g, color, compose(x, y, z, rot, scale), dirt);
  }

  /** A tube through points (cables, wires). */
  tube(points: THREE.Vector3[], r: number, color: THREE.ColorRepresentation, seg = 14, radial = 4) {
    const curve = new THREE.CatmullRomCurve3(points);
    return this.add(new THREE.TubeGeometry(curve, seg, r, radial, false), color, new THREE.Matrix4(), 0, 0.04);
  }

  /** Merge everything collected so far into one mesh and reset. */
  mesh(material: THREE.Material, name: string) {
    const merged = this.parts.length ? mergeGeometries(this.parts) : new THREE.BufferGeometry();
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    const m = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), material);
    m.name = name;
    return m;
  }
}

/** Points along a hanging cable between a and b (parabolic sag, good enough for a catenary). */
export function sagCurve(a: THREE.Vector3, b: THREE.Vector3, sag: number, n = 10, wobble?: () => number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    if (wobble && i > 0 && i < n) p.z += wobble() * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}
