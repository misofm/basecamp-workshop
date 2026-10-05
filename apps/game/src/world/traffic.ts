/**
 * Ambient traffic: a handful of procedural cars driving loops along the roads.
 *
 * Owns: lane paths (straight runs plus turns at the intersection), moving cars drawn
 * with InstancedMeshes (one draw call per car part for ALL cars), headlight/taillight
 * glow, and simple yielding: cars slow and stop for the player, pedestrians and the
 * car ahead.
 * Must not: collide physically with the player (they stop instead), or be interactable.
 */
import * as THREE from "three";
import { LANES } from "./layout";
import { bodyGeometry, carMaterials, CAR_COLORS, glassGeometry, headlightGeometry, taillightGeometry, trimGeometry } from "./vehicle";
import { canvasTexture } from "./labels";

type P = { x: number; z: number };

/** A polyline path with rounded corners, sampled by distance. */
class Path {
  readonly points: P[] = [];
  readonly lengths: number[] = [0];
  constructor(corners: P[], radius = 3.2) {
    // Insert a quadratic curve at each interior corner.
    this.points.push(corners[0]);
    for (let i = 1; i < corners.length - 1; i++) {
      const a = corners[i - 1],
        b = corners[i],
        c = corners[i + 1];
      const ab = Math.hypot(b.x - a.x, b.z - a.z),
        bc = Math.hypot(c.x - b.x, c.z - b.z);
      const r = Math.min(radius, ab / 2, bc / 2);
      const p0 = { x: b.x + ((a.x - b.x) / ab) * r, z: b.z + ((a.z - b.z) / ab) * r };
      const p2 = { x: b.x + ((c.x - b.x) / bc) * r, z: b.z + ((c.z - b.z) / bc) * r };
      for (let t = 0; t <= 1.0001; t += 0.125) {
        const u = 1 - t;
        this.points.push({ x: u * u * p0.x + 2 * u * t * b.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * b.z + t * t * p2.z });
      }
    }
    this.points.push(corners[corners.length - 1]);
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1],
        b = this.points[i];
      this.lengths.push(this.lengths[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
  }
  get length() {
    return this.lengths[this.lengths.length - 1];
  }
  sample(s: number, out: { x: number; z: number; heading: number }) {
    const L = this.lengths;
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const a = this.points[i - 1],
      b = this.points[i];
    const t = Math.min(1, Math.max(0, (s - L[i - 1]) / (L[i] - L[i - 1] || 1)));
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.heading = Math.atan2(b.x - a.x, b.z - a.z);
    return out;
  }
}

const FAR = 48;
const PATHS = [
  new Path([{ x: -FAR, z: LANES.eastbound }, { x: FAR, z: LANES.eastbound }]),
  new Path([{ x: FAR, z: LANES.westbound }, { x: -FAR, z: LANES.westbound }]),
  new Path([{ x: LANES.southbound, z: -FAR }, { x: LANES.southbound, z: FAR }]),
  new Path([{ x: LANES.northbound, z: FAR }, { x: LANES.northbound, z: -FAR }]),
  // Eastbound, right turn south at the intersection.
  new Path([{ x: -FAR, z: LANES.eastbound }, { x: LANES.southbound, z: LANES.eastbound }, { x: LANES.southbound, z: FAR }]),
  // Northbound, left turn west onto Main Street (passes the shop).
  new Path([{ x: LANES.northbound, z: FAR }, { x: LANES.northbound, z: LANES.westbound }, { x: -FAR, z: LANES.westbound }]),
];

interface Car {
  path: Path;
  s: number;
  speed: number;
  maxSpeed: number;
  x: number;
  z: number;
  heading: number;
  yielding: boolean;
}

export class Traffic {
  readonly cars: Car[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private body: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private one = new THREE.Vector3(1, 1, 1);
  private pos = new THREE.Vector3();
  constructor(scene: THREE.Scene, count = 6) {
    const assignments = [
      [0, 0.15],
      [1, 0.55],
      [5, 0.3],
      [2, 0.6],
      [4, 0.75],
      [3, 0.1],
      [1, 0.05],
    ];
    for (let i = 0; i < count; i++) {
      const [pi, f] = assignments[i % assignments.length];
      const path = PATHS[pi];
      const max = 6.5 + ((i * 1.7) % 3);
      this.cars.push({ path, s: path.length * f, speed: max, maxSpeed: max, x: 0, z: 0, heading: 0, yielding: false });
    }
    this.body = new THREE.InstancedMesh(bodyGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.5 }), count);
    const glass = new THREE.InstancedMesh(glassGeometry(), carMaterials.glass, count);
    const trim = new THREE.InstancedMesh(trimGeometry(), carMaterials.trim, count);
    const head = new THREE.InstancedMesh(headlightGeometry(), carMaterials.headlight, count);
    const tail = new THREE.InstancedMesh(taillightGeometry(), carMaterials.taillight, count);
    // Headlight beams on the road: one additive, elongated decal per car.
    const beamGeometry = new THREE.PlaneGeometry(3.2, 9).rotateX(-Math.PI / 2).translate(0, 0.03, 6.6);
    const beamTexture = canvasTexture(64, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h, 0, w / 2, h, h);
      g.addColorStop(0, "rgba(255,244,214,0.75)");
      g.addColorStop(0.6, "rgba(255,244,214,0.18)");
      g.addColorStop(1, "rgba(255,244,214,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const beam = new THREE.InstancedMesh(
      beamGeometry,
      new THREE.MeshBasicMaterial({ map: beamTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }),
      count,
    );
    beam.renderOrder = 1;
    for (let i = 0; i < count; i++) this.body.setColorAt(i, new THREE.Color(CAR_COLORS[(i * 3) % CAR_COLORS.length]));
    this.meshes = [this.body, glass, trim, head, tail, beam];
    for (const m of this.meshes) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.body.castShadow = true;
    this.update(0, []);
  }

  /** Advance cars. `obstacles` = things they must not run over (player, pedestrians). */
  update(dt: number, obstacles: P[]) {
    const cars = this.cars;
    for (const car of cars) car.path.sample(car.s, car);
    // Yielding: look ahead along the car's heading.
    cars.forEach((car, i) => {
      const fx = Math.sin(car.heading),
        fz = Math.cos(car.heading);
      let limit = car.maxSpeed;
      const check = (x: number, z: number, halfWidth: number) => {
        const dx = x - car.x,
          dz = z - car.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(-dx * fz + dz * fx);
        if (ahead > 0.5 && ahead < 10 && side < halfWidth) limit = Math.min(limit, car.maxSpeed * Math.max(0, (ahead - 3.4) / 6));
      };
      for (const o of obstacles) check(o.x, o.z, 1.6);
      car.yielding = false;
      cars.forEach((other, j) => {
        if (i === j) return;
        // Break deadlocks at the junction: the lower index wins if both see each other.
        const dx = other.x - car.x,
          dz = other.z - car.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(-dx * fz + dz * fx);
        if (ahead > 0.5 && ahead < 11 && side < 2.0) {
          const ofx = Math.sin(other.heading),
            ofz = Math.cos(other.heading);
          const otherAhead = -dx * ofx - dz * ofz;
          const otherSide = Math.abs(dx * ofz - dz * ofx);
          const mutual = otherAhead > 0.5 && otherAhead < 11 && otherSide < 2.0;
          if (mutual && i < j) return;
          limit = Math.min(limit, car.maxSpeed * Math.max(0, (ahead - 5.2) / 6));
          car.yielding = true;
        }
      });
      const accel = limit < car.speed ? 14 : 3;
      car.speed += Math.sign(limit - car.speed) * Math.min(Math.abs(limit - car.speed), accel * dt);
      car.s += car.speed * dt;
      if (car.s > car.path.length) car.s -= car.path.length;
    });
    cars.forEach((car, i) => {
      car.path.sample(car.s, car);
      this.q.setFromAxisAngle(this.up, car.heading);
      this.matrix.compose(this.pos.set(car.x, 0, car.z), this.q, this.one);
      for (const m of this.meshes) m.setMatrixAt(i, this.matrix);
    });
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  positions() {
    return this.cars.filter((c) => Math.abs(c.x) < 40 && Math.abs(c.z) < 35).map((c) => ({ x: c.x, z: c.z }));
  }
}
