/**
 * Procedural car geometry: the dead Triangle self-driving sedan (the smashable one) and the
 * older boxy dead cars dressing the street.
 *
 * Owns: car part geometries in a car-local frame (forward = +z, y = 0 at the tyres'
 * contact patch), the dusty paint / grimy glass canvas textures and a few shared
 * materials. Every builder returns fresh geometry, so a caller may dent it.
 * Must not: create scene objects, animate, or know which cars exist (cars.ts does).
 *
 * The sedan is a smooth capsule-like 2030s pod: a lofted superellipse shell (dense enough
 * to dent), a glass band with a panoramic roof, no grille, flush light strips, aero wheel
 * covers, a dead lidar pod on the roof and four flat tyres. Seven years of dust: matte
 * paint, a dirt gradient up from the sills, haze and grime on the glass.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { canvasTexture } from "./labels";

// ─────────────────────────────── the sedan ───────────────────────────────

export const SEDAN = {
  length: 4.7,
  width: 1.86,
  /** Underside of the shell (it sits low on four flat tyres). */
  bottom: 0.34,
  /** Belt line: glass starts just above it. */
  belt: 1.0,
  roof: 1.52,
  /** Wheel centres (local z) and hub height (flat tyres: squashed). */
  wheelZ: 1.5,
  wheelY: 0.25,
  wheelR: 0.33,
};
const HALF_L = SEDAN.length / 2;
const SE = 3.2; // superellipse exponent of the cross-section (rounded box)
/** Glass band runs between these stations (t = z / half length). */
const GLASS_T = { rear: -0.66, front: 0.5 };
/** The front side window on the +x side: the one a swing from the sidewalk blows out. */
export const BLOWOUT_T = { rear: -0.16, front: 0.44 };
/** Skipped glass on the sides (B-pillar), as a station range. */
const PILLAR_T = { rear: -0.23, front: -0.17 };

const smooth = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** Roof line along the length: low rounded nose, long glass canopy, short raised tail. */
function topAt(t: number) {
  if (t > 0.18) return SEDAN.roof - (SEDAN.roof - 0.78) * Math.pow(smooth((t - 0.18) / 0.82), 0.85);
  if (t < -0.42) return SEDAN.roof - (SEDAN.roof - 0.98) * smooth((-0.42 - t) / 0.58);
  return SEDAN.roof;
}
/** Plan half-width: rounded ends (a superellipse in plan). */
function halfWidthAt(t: number) {
  return (SEDAN.width / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(t)), 3.2)), 1 / 3.2);
}
/** Tumblehome: the cabin leans in above the belt. */
function tumble(x: number, y: number, top: number) {
  const k = Math.min(1, Math.max(0, (y - SEDAN.belt) / Math.max(0.05, top - SEDAN.belt)));
  return x * (1 - 0.2 * k * k);
}

/** A point on the shell at station t (−1 tail … 1 nose) and section angle a (0 = +x side, π/2 = top). */
function shellPoint(t: number, a: number, grow = 0, out = new THREE.Vector3()) {
  const W = halfWidthAt(t) + grow,
    top = topAt(t) + grow,
    bot = SEDAN.bottom - grow;
  const yc = (top + bot) / 2,
    H = (top - bot) / 2;
  const c = Math.cos(a),
    s = Math.sin(a);
  const y = yc + H * Math.sign(s) * Math.pow(Math.abs(s), 2 / SE);
  const x = tumble(W * Math.sign(c) * Math.pow(Math.abs(c), 2 / SE), y, top);
  return out.set(x, y, t * (HALF_L + grow));
}

/** Half-width of the shell at station t and height y (0 outside it). */
function shellX(t: number, y: number, grow = 0) {
  const W = halfWidthAt(t) + grow,
    top = topAt(t) + grow,
    bot = SEDAN.bottom - grow;
  const yc = (top + bot) / 2,
    H = (top - bot) / 2;
  const u = Math.abs(y - yc) / H;
  if (u >= 1) return 0;
  const s = Math.pow(u, SE / 2);
  return tumble(W * Math.pow(Math.sqrt(1 - s * s), 2 / SE), y, top);
}

/** Section angle at which the shell reaches height y at station t (right side; mirror with π − a). */
function angleAtHeight(t: number, y: number) {
  const top = topAt(t),
    bot = SEDAN.bottom;
  const yc = (top + bot) / 2,
    H = (top - bot) / 2;
  const u = Math.min(1, Math.max(-1, (y - yc) / H));
  return Math.asin(Math.sign(u) * Math.pow(Math.abs(u), SE / 2));
}

/** Indexed grid → geometry. */
function gridGeometry(nu: number, nv: number, at: (i: number, j: number, p: THREE.Vector3) => [number, number]) {
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const [u, v] = at(i, j, p);
      pos.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j,
        b = a + nv + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1); // outward-facing (j runs counter-clockwise seen from the nose)
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * The painted shell (dense, so it dents) plus body-coloured aero wheel covers.
 * `userData.shellVertices`: how many leading vertices belong to the shell (only those dent).
 */
export function sedanBodyGeometry() {
  const NU = 44,
    NV = 36;
  // Angle runs from the bottom centre (−π/2) all the way round, so the seam hides underneath.
  const shell = gridGeometry(NU, NV, (i, j, p) => {
    const t = -1 + (2 * i) / NU;
    const a = -Math.PI / 2 + (j / NV) * Math.PI * 2;
    shellPoint(t, a, 0, p);
    // Wheel arches: push the flank in around each wheel so the tyre shows under a lip.
    for (const wz of [-SEDAN.wheelZ, SEDAN.wheelZ]) {
      const d = Math.hypot(p.z - wz, (p.y - SEDAN.wheelY) * 1.05);
      if (d < 0.48 && Math.abs(p.x) > 0.6) p.x = Math.sign(p.x) * Math.min(Math.abs(p.x), 0.6 + Math.max(0, d - 0.42) * 2.5);
    }
    return [(t + 1) / 2, (p.y - SEDAN.bottom) / (SEDAN.roof - SEDAN.bottom)];
  });
  shell.computeVertexNormals();
  const flatShell = shell.toNonIndexed();
  const shellVertices = flatShell.getAttribute("position").count;
  const covers: THREE.BufferGeometry[] = [];
  for (const x of [-1, 1])
    for (const z of [-SEDAN.wheelZ, SEDAN.wheelZ]) {
      const c = new THREE.CylinderGeometry(0.19, 0.21, 0.05, 18).rotateZ(Math.PI / 2);
      c.translate(x * 0.94, SEDAN.wheelY + 0.02, z);
      const g = c.toNonIndexed();
      // Covers sample the dirtiest strip of the dust map.
      const uv = g.getAttribute("uv");
      for (let k = 0; k < uv.count; k++) uv.setXY(k, 0.1 + uv.getX(k) * 0.05, 0.08);
      covers.push(g);
    }
  const merged = mergeGeometries([flatShell, ...covers])!;
  merged.userData.shellVertices = shellVertices;
  return merged;
}

/**
 * The glass: windscreen, panoramic roof, side windows and rear screen, slightly proud of
 * the shell. Two groups: 0 = all glass that cracks, 1 = the +x front side window that blows
 * out (its UVs span 0..1 so the blown-out texture's jagged teeth fit its frame).
 */
export function sedanGlassGeometry() {
  const NU = 30,
    NV = 22;
  const yb = SEDAN.belt + 0.04;
  const crack: number[] = [],
    crackUv: number[] = [],
    blow: number[] = [],
    blowUv: number[] = [];
  const P = (i: number, j: number) => {
    const t = GLASS_T.rear + ((GLASS_T.front - GLASS_T.rear) * i) / NU;
    const a0 = angleAtHeight(t, Math.min(yb, topAt(t) - 0.02));
    const a = a0 + ((Math.PI - 2 * a0) * j) / NV;
    return { p: shellPoint(t, a, 0.014), t, a };
  };
  for (let i = 0; i < NU; i++)
    for (let j = 0; j < NV; j++) {
      const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      const tm = (q[0].t + q[1].t) / 2,
        am = (q[0].a + q[3].a) / 2;
      const side = am < 1.0 ? 1 : am > Math.PI - 1.0 ? -1 : 0;
      if (side !== 0 && tm > PILLAR_T.rear && tm < PILLAR_T.front) continue; // B-pillar
      const isBlow = side === 1 && tm > BLOWOUT_T.rear && tm < BLOWOUT_T.front;
      const target = isBlow ? blow : crack,
        tuv = isBlow ? blowUv : crackUv;
      for (const k of [0, 2, 1, 0, 3, 2]) {
        const v = q[k];
        target.push(v.p.x, v.p.y, v.p.z);
        if (isBlow) tuv.push((v.t - BLOWOUT_T.rear) / (BLOWOUT_T.front - BLOWOUT_T.rear), Math.min(1, v.a / 1.0));
        else tuv.push((v.t - GLASS_T.rear) / (GLASS_T.front - GLASS_T.rear), v.a / Math.PI);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([...crack, ...blow], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([...crackUv, ...blowUv], 2));
  g.computeVertexNormals();
  g.addGroup(0, crack.length / 3, 0);
  g.addGroup(crack.length / 3, blow.length / 3, 1);
  return g;
}

/** A tyre with a flat bottom and bulging sidewalls (seven years without air). */
function flatTyre(radius: number, width: number, flatten: number) {
  const g = new THREE.CylinderGeometry(radius, radius, width, 18, 2).rotateZ(Math.PI / 2);
  const p = g.getAttribute("position");
  const floor = -radius + flatten;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < floor) {
      p.setY(i, floor);
      p.setX(i, p.getX(i) * 1.25);
    } else if (y < floor + 0.08) p.setX(i, p.getX(i) * 1.12);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

function part(g: THREE.BufferGeometry, x: number, y: number, z: number) {
  g.translate(x, y, z);
  const n = g.index ? g.toNonIndexed() : g;
  if (!n.getAttribute("uv")) n.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n.getAttribute("position").count * 2), 2));
  return n;
}

/** Dark trim: four flat tyres, the dead lidar pod and camera stubs. */
export function sedanTrimGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const flatten = SEDAN.wheelR - SEDAN.wheelY;
  for (const x of [-0.84, 0.84])
    for (const z of [-SEDAN.wheelZ, SEDAN.wheelZ]) parts.push(part(flatTyre(SEDAN.wheelR, 0.25, flatten), x, SEDAN.wheelY, z));
  // Lidar pod: a low drum on a fairing, with a darker lens band, slightly askew (dead).
  const pod = new THREE.CylinderGeometry(0.15, 0.17, 0.14, 16);
  pod.rotateZ(0.04);
  parts.push(part(pod, 0, SEDAN.roof + 0.07, -0.25));
  parts.push(part(new THREE.CylinderGeometry(0.11, 0.15, 0.05, 16), 0, SEDAN.roof + 0.165, -0.25));
  parts.push(part(new THREE.BoxGeometry(0.4, 0.04, 0.6), 0, SEDAN.roof + 0.005, -0.25));
  // Side camera stubs where mirrors used to be.
  for (const x of [-1, 1]) {
    const t = 0.42,
      y = SEDAN.belt + 0.06;
    parts.push(part(new THREE.BoxGeometry(0.16, 0.07, 0.12), x * (shellX(t, y) + 0.06), y, t * HALF_L));
  }
  // Charging flap seam, dark, on the +x rear quarter.
  parts.push(part(new THREE.BoxGeometry(0.01, 0.12, 0.16), shellX(-0.62, 0.8) + 0.004, 0.8, -0.62 * HALF_L));
  return mergeGeometries(parts)!;
}

/**
 * Flush light strips as one geometry with vertex colours (one material, one draw call):
 * a warm-white strip across the nose, a red strip across the tail and four orange corner
 * indicators. Every lamp flashes together for the hazards.
 */
export function sedanLampGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const strip = (tFrom: number, y0: number, y1: number, color: string) => {
    const tTo = tFrom > 0 ? 1 : -1;
    const n = 16;
    const pos: number[] = [];
    const ring = (s: number, y: number) => {
      // s: −1 … 1 across the end, through the tip at s = 0.
      const t = tTo + (tFrom - tTo) * Math.abs(s);
      const x = Math.sign(s) * shellX(t, y, 0.012);
      return new THREE.Vector3(x, y, t * (HALF_L + 0.012));
    };
    for (let k = 0; k < n; k++) {
      const s0 = -1 + (2 * k) / n,
        s1 = -1 + (2 * (k + 1)) / n;
      const a = ring(s0, y0),
        b = ring(s1, y0),
        c = ring(s1, y1),
        d = ring(s0, y1);
      for (const v of [a, b, c, a, c, d]) pos.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.computeVertexNormals();
    paint(g, color);
    parts.push(g);
  };
  strip(0.8, 0.7, 0.76, "#fff1d0");
  strip(-0.8, 0.86, 0.93, "#ff2a1a");
  // Corner indicators: short flush slits just behind the nose and ahead of the tail.
  for (const side of [-1, 1])
    for (const [t, y] of [
      [0.82, 0.6],
      [-0.84, 0.78],
    ]) {
      const g = part(new THREE.BoxGeometry(0.03, 0.05, 0.24), side * (shellX(t, y, 0.012) - 0.004), y, t * HALF_L);
      paint(g, "#ff8a00");
      parts.push(g);
    }
  return mergeGeometries(parts)!;
}

/** Where the Triangle badge sits on the nose (local), facing +z. */
export const BADGE_SPOT = new THREE.Vector3(0, 0.56, HALF_L + 0.016);
/** Where to put a window sticker (local, on the +x side glass at station t, height y), facing +x. */
export function stickerSpot(t: number, y: number) {
  return new THREE.Vector3(shellX(t, y, 0.014) + 0.014, y, t * HALF_L);
}

// ─────────────────────────────── older dead cars ───────────────────────────────

export type DeadCarKind = "sedan" | "kei" | "van";

/** Vertex colours (per triangle brightness jitter for a mottled look). */
function paint(g: THREE.BufferGeometry, color: string, jitter = 0, seed = 1) {
  const c = new THREE.Color(color);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  let s = seed;
  for (let i = 0; i < n; i += 3) {
    s = (s * 16807) % 2147483647;
    const k = 1 - jitter + ((s % 1000) / 1000) * jitter * 2;
    for (let v = 0; v < 3 && i + v < n; v++) arr.set([c.r * k, c.g * k, c.b * k], (i + v) * 3);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(arr, 3));
  return g;
}

/** A chamfered box (rounded-ish nose and tail), as in the old procedural cars. */
function chamferBox(w: number, h: number, l: number, round = 0.6) {
  const g = new THREE.BoxGeometry(w, h, l, 2, 2, 6);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i),
      y = p.getY(i);
    const end = Math.abs(z) / (l / 2);
    if (end > 0.85 && y > 0) p.setY(i, y - (end - 0.85) * round);
  }
  g.computeVertexNormals();
  return g;
}

/** A tapered glasshouse box (narrower and shorter at the top). */
function glasshouse(w: number, h: number, l: number, taperX = 0.88, taperZ = 0.78, shift = 0) {
  const g = new THREE.BoxGeometry(w, h, l);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++)
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * taperX);
      p.setZ(i, p.getZ(i) * taperZ + shift);
    }
  g.computeVertexNormals();
  return g;
}

/**
 * An older boxy, unbranded car in car-local space: { body, glass, trim } (non-indexed,
 * position/normal/uv; body with vertex colours). `burned`: a charred, rusting shell with
 * no glass, sitting on its rims.
 */
export function deadCarParts(kind: DeadCarKind, color: string, burned = false, seed = 1) {
  const body: THREE.BufferGeometry[] = [],
    glass: THREE.BufferGeometry[] = [],
    trim: THREE.BufferGeometry[] = [];
  const sink = burned ? -0.14 : -0.06; // flat tyres (or no tyres at all)
  const spec =
    kind === "van"
      ? { w: 1.8, l: 4.6, lowH: 0.9, cabH: 0.85, cabL: 3.6, cabShift: -0.35, wheelZ: 1.55 }
      : kind === "kei"
        ? { w: 1.48, l: 3.4, lowH: 0.62, cabH: 0.68, cabL: 2.3, cabShift: -0.15, wheelZ: 1.1 }
        : { w: 1.72, l: 4.3, lowH: 0.6, cabH: 0.5, cabL: 2.2, cabShift: -0.2, wheelZ: 1.35 };
  const lowY = 0.36 + spec.lowH / 2 + sink;
  const lower = part(chamferBox(spec.w, spec.lowH, spec.l, kind === "van" ? 0.3 : 0.6), 0, lowY, 0);
  const cabY = lowY + spec.lowH / 2 + spec.cabH / 2;
  const roofY = cabY + spec.cabH / 2 + 0.035;
  const roof = part(new THREE.BoxGeometry(spec.w * 0.86, 0.07, spec.cabL * (kind === "van" ? 0.9 : 0.74)), 0, roofY, spec.cabShift - (kind === "van" ? 0.1 : 0.12));
  const shellColor = burned ? "#2b211c" : color;
  body.push(paint(lower, shellColor, burned ? 0.5 : 0.08, seed), paint(roof, shellColor, burned ? 0.5 : 0.08, seed + 7));
  if (burned) {
    // Rust blooms on the charred shell, and the empty window frames (pillars only).
    const rust = part(chamferBox(spec.w + 0.01, 0.2, spec.l * 0.6), 0, lowY + 0.12, 0.2);
    body.push(paint(rust, "#5b2f1a", 0.6, seed + 3));
    for (const x of [-1, 1])
      for (const z of [-0.55, 0.05, 0.6]) {
        const pillar = part(new THREE.BoxGeometry(0.06, spec.cabH, 0.07), x * spec.w * 0.43, cabY, spec.cabShift + z * spec.cabL * 0.5);
        body.push(paint(pillar, "#231a16", 0.4, seed + 11));
      }
  } else {
    // Rust: along the sills, round the wheel arches, and a bloom on the roof edge.
    for (const x of [-1, 1]) {
      body.push(paint(part(new THREE.BoxGeometry(0.02, 0.16, spec.l * 0.82), x * (spec.w / 2 + 0.006), lowY - spec.lowH / 2 + 0.1, 0), "#6a3418", 0.5, seed + 5));
      for (const z of [-spec.wheelZ, spec.wheelZ])
        body.push(paint(part(new THREE.BoxGeometry(0.02, 0.2, 0.62), x * (spec.w / 2 + 0.008), lowY - spec.lowH / 2 + 0.3, z), "#7a3c1c", 0.6, seed + 9));
    }
    body.push(paint(part(new THREE.BoxGeometry(spec.w * 0.5, 0.012, 0.5), spec.w * 0.12, roofY + 0.036, spec.cabShift), "#73401f", 0.6, seed + 2));
    glass.push(part(glasshouse(spec.w * 0.92, spec.cabH, spec.cabL, 0.9, kind === "van" ? 0.92 : 0.76, kind === "van" ? -0.1 : -0.12), 0, cabY, spec.cabShift));
  }
  for (const x of [-1, 1])
    for (const z of [-spec.wheelZ, spec.wheelZ]) {
      if (burned) trim.push(part(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12).rotateZ(Math.PI / 2), x * (spec.w / 2 - 0.12), 0.22, z));
      else trim.push(part(flatTyre(0.32, 0.22, 0.08), x * (spec.w / 2 - 0.08), 0.24, z));
    }
  // Bumpers.
  for (const z of [-1, 1]) trim.push(part(new THREE.BoxGeometry(spec.w + 0.04, 0.14, 0.14), 0, 0.42 + sink, (z * spec.l) / 2));
  return {
    body: mergeGeometries(body)!,
    glass: glass.length ? mergeGeometries(glass)! : null,
    trim: mergeGeometries(trim)!,
    length: spec.l,
    width: spec.w,
    height: roofY + 0.04,
  };
}

// ─────────────────────────────── textures & materials ───────────────────────────────

let dustMap: THREE.Texture | null = null;
/**
 * Dust and dirt over pale paint (multiplies the paint colour): a brown dirt gradient up from
 * the sills, splash speckle, rain-run streaks down from the belt, a dusty film over
 * everything and one finger-wiped swipe. u runs along the length, v up the side.
 */
export function carDustTexture() {
  if (dustMap) return dustMap;
  dustMap = canvasTexture(512, 256, (c, w, h) => {
    let s = 7;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    c.fillStyle = "#e9e3d6";
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, "rgba(62,50,38,0.95)");
    g.addColorStop(0.2, "rgba(100,86,68,0.6)");
    g.addColorStop(0.42, "rgba(150,138,118,0.22)");
    g.addColorStop(1, "rgba(170,162,145,0.2)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = rand() * w;
      c.fillStyle = `rgba(80,62,44,${0.04 + rand() * 0.1})`;
      c.fillRect(x, h * (0.25 + rand() * 0.2), 1 + rand() * 3, h * (0.2 + rand() * 0.4));
    }
    for (let i = 0; i < 2600; i++) {
      const y = h * Math.pow(rand(), 0.6);
      c.fillStyle = `rgba(${60 + rand() * 50},${45 + rand() * 40},${30 + rand() * 30},${0.1 + rand() * 0.35})`;
      c.fillRect(rand() * w, y, 1 + rand() * 2.5, 1 + rand() * 2.5);
    }
    c.strokeStyle = "rgba(235,232,225,0.35)";
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(w * 0.52, h * 0.5);
    c.bezierCurveTo(w * 0.58, h * 0.44, w * 0.62, h * 0.56, w * 0.68, h * 0.48);
    c.stroke();
  });
  return dustMap;
}

let glassMap: THREE.Texture | null = null;
/** Dark glass under seven years of haze: dust thickest at the bottom edge, speckle, a wiper arc. */
export function carGlassTexture() {
  if (glassMap) return glassMap;
  glassMap = canvasTexture(256, 256, (c, w, h) => {
    let s = 5;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    c.fillStyle = "#2c363b";
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(160,140,112,0.6)");
    g.addColorStop(0.35, "rgba(150,132,108,0.3)");
    g.addColorStop(1, "rgba(140,125,105,0.15)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(${150 + rand() * 50},${130 + rand() * 40},${100 + rand() * 30},${0.1 + rand() * 0.3})`;
      c.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
    }
    c.strokeStyle = "rgba(30,38,42,0.35)";
    c.lineWidth = 10;
    c.beginPath();
    c.arc(w * 0.5, h * 1.25, h * 0.8, Math.PI * 1.2, Math.PI * 1.8);
    c.stroke();
  });
  return glassMap;
}

/** Shared car materials (textures are canvas-backed, so built on first use). */
let materials: {
  sedanPaint: THREE.MeshPhysicalMaterial;
  deadPaint: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
} | null = null;
export function carMaterials() {
  materials ??= {
    // Pearl paint under a dull, dust-scattered clearcoat: rough base, a faint broad sheen on top.
    sedanPaint: new THREE.MeshPhysicalMaterial({
      color: "#d2d1cb",
      map: carDustTexture(),
      roughness: 0.78,
      metalness: 0.0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.6,
      name: "sedan-paint",
    }),
    deadPaint: new THREE.MeshStandardMaterial({ color: "#ffffff", map: carDustTexture(), vertexColors: true, roughness: 0.93, metalness: 0.0, name: "dead-car-paint" }),
    glass: new THREE.MeshStandardMaterial({ color: "#ffffff", map: carGlassTexture(), roughness: 0.32, metalness: 0.4, name: "car-glass" }),
    trim: new THREE.MeshStandardMaterial({ color: "#141617", roughness: 0.85, name: "car-trim" }),
  };
  return materials;
}
