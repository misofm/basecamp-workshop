/**
 * Parked cars at the curb outside the shop, and what happens when one gets smashed.
 *
 * Owns: 4 procedural parked cars (body, separate glass, trim, lamps, indicator lamps),
 * their collision and "car:<n>" interactables, and the smash effects, tuned to be
 * comedic and readable on a projector: the sidewalk-side window is blown out and the
 * rest of the glass cracks, the door panel crumples, the body rocks on its suspension
 * for about a second, an instanced burst of glinting glass shards flies out (a few
 * bounce off the player) and settles on the ground, and ~8 s of hazards flash every
 * lamp: indicators, headlights and taillights (emissive + one shared orange PointLight
 * that exists from the start so no shader recompiles happen mid-game).
 * Must not: play sounds or decide consequences; the swing itself is player.ts.
 */
import * as THREE from "three";
import { Collision } from "./collision";
import { Interactables } from "./interactables";
import { groundHeight, PARKED_CARS } from "./layout";
import { bodyGeometry, carMaterials, glassGeometry, headlightGeometry, indicatorGeometry, taillightGeometry, trimGeometry } from "./vehicle";
import { canvasTexture } from "./labels";

const PARKED_COLORS = ["#2f6fb5", "#c23b3b", "#e8e6df", "#3d8a6b"];
const HAZARD_SECONDS = 8;
const SHARDS_PER_SMASH = 110;
/** Shards thrown back at the swinger, to bounce off them comedically. */
const SHARDS_AT_PLAYER = 18;
const ROCK_SECONDS = 1.3;

interface ParkedCar {
  id: string;
  group: THREE.Group;
  body: THREE.Mesh;
  glass: THREE.Mesh;
  indicators: THREE.MeshStandardMaterial;
  headlights: THREE.MeshStandardMaterial;
  taillights: THREE.MeshStandardMaterial;
  smashed: boolean;
  smashedAt: number;
  hazardUntil: number;
  x: number;
  z: number;
}

export class ParkedCars {
  readonly cars: ParkedCar[] = [];
  private shards: THREE.InstancedMesh;
  private shardState: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number; active: boolean; glint: number }[] = [];
  /** Where the swinger stood at the last smash (shards bounce off a body-sized cylinder there). */
  private swinger = new THREE.Vector3(0, -100, 0);
  private glassGeometry: THREE.BufferGeometry;
  private blownOut: THREE.MeshStandardMaterial;
  private glintColor = new THREE.Color();
  private nextShard = 0;
  private hazardLight: THREE.PointLight;
  private time = 0;
  private crackedGlass: THREE.MeshStandardMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private scaleV = new THREE.Vector3();
  constructor(scene: THREE.Scene, collision: Collision, interactables: Interactables) {
    const trim = trimGeometry(),
      glass = glassGeometry(),
      head = headlightGeometry(),
      tail = taillightGeometry(),
      indicator = indicatorGeometry();
    PARKED_CARS.forEach((spot, i) => {
      const group = new THREE.Group();
      group.position.set(spot.x, 0, spot.z);
      group.rotation.y = -Math.PI / 2; // facing west, nose toward -x
      group.userData.keepDynamic = true;
      const body = new THREE.Mesh(bodyGeometry(), new THREE.MeshStandardMaterial({ color: PARKED_COLORS[i % PARKED_COLORS.length], roughness: 0.28, metalness: 0.55 }));
      body.castShadow = true;
      body.receiveShadow = true;
      const glassMesh = new THREE.Mesh(glass, carMaterials.glass);
      const trimMesh = new THREE.Mesh(trim, carMaterials.trim);
      trimMesh.castShadow = true;
      // Lamps are untonemapped from the start so the hazard flash can push them into bloom.
      const headlights = carMaterials.lampOff.clone();
      headlights.toneMapped = false;
      const taillights = carMaterials.tailOff.clone();
      taillights.toneMapped = false;
      const indicators = new THREE.MeshStandardMaterial({ color: "#8a5a1a", emissive: "#ff8a00", emissiveIntensity: 0, roughness: 0.3, toneMapped: false });
      group.add(body, glassMesh, trimMesh, new THREE.Mesh(head, headlights), new THREE.Mesh(tail, taillights), new THREE.Mesh(indicator, indicators));
      scene.add(group);
      const id = `car:${i}`;
      collision.add({ x: spot.x, z: spot.z, w: 4.3, d: 1.9, h: 1.5, tag: id });
      interactables.register({ id, kind: "car", x: spot.x, z: spot.z - 1.75, radius: 2.0 });
      this.cars.push({ id, group, body, glass: glassMesh, indicators, headlights, taillights, smashed: false, smashedAt: 0, hazardUntil: 0, x: spot.x, z: spot.z });
    });
    this.glassGeometry = glass;
    this.blownOut = new THREE.MeshStandardMaterial({
      map: blownOutTexture(),
      color: "#e6f6ff",
      emissive: "#5a7a88",
      alphaTest: 0.5,
      roughness: 0.2,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    this.crackedGlass = new THREE.MeshStandardMaterial({
      map: crackTexture(),
      color: "#cfe3ea",
      transparent: true,
      opacity: 0.92,
      roughness: 0.3,
      metalness: 0.2,
      emissive: "#304048",
      side: THREE.DoubleSide,
    });
    // Shard pool: tiny triangles, one draw call for every shard of every smash.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.05, 0, -0.04, -0.03, 0, 0.045, -0.035, 0], 3));
    tri.computeVertexNormals();
    const total = SHARDS_PER_SMASH * PARKED_CARS.length;
    // Unlit and untonemapped: per-instance colours above 1.0 sparkle through the bloom pass.
    this.shards = new THREE.InstancedMesh(tri, new THREE.MeshBasicMaterial({ color: "#dff4ff", side: THREE.DoubleSide, toneMapped: false }), total);
    this.shards.frustumCulled = false;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < total; i++) {
      this.shardState.push({ p: new THREE.Vector3(0, -10, 0), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 1, active: false, glint: Math.random() * 100 });
      this.shards.setMatrixAt(i, this.m.makeTranslation(0, -10, 0));
      this.shards.setColorAt(i, this.glintColor.setScalar(1)); // allocate instanceColor before the first render
    }
    this.shards.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.shards);
    this.hazardLight = new THREE.PointLight("#ff9a1a", 0, 9, 1.8);
    this.hazardLight.position.set(0, -20, 0);
    scene.add(this.hazardLight);
  }

  get(id: string) {
    return this.cars.find((c) => c.id === id);
  }

  /** Where the player's swing should land (the window on the sidewalk side). */
  impactPoint(car: ParkedCar) {
    return new THREE.Vector3(car.x + 0.2, 1.2, car.z - 0.8);
  }

  /** Apply all smash effects at once (called at the moment the swing lands). */
  smash(car: ParkedCar, from: THREE.Vector3) {
    const impact = this.impactPoint(car);
    // 1. Glass: the sidewalk-side window (box face -x in car space) is blown out, the rest cracks.
    //    BoxGeometry faces are 6 indices each in the order +x, -x, +y, -y, +z, -z.
    const glass = this.glassGeometry.clone();
    glass.clearGroups();
    glass.addGroup(0, 6, 0);
    glass.addGroup(6, 6, 1);
    glass.addGroup(12, 24, 0);
    car.glass.geometry = glass;
    car.glass.material = [this.crackedGlass, this.blownOut];
    // 2. Crumple: push body vertices near the impact inward and down, with a lumpy
    //    position-hashed noise so the panel looks crushed rather than smoothly pressed.
    const local = car.group.worldToLocal(impact.clone());
    const pos = car.body.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i),
        vy = pos.getY(i),
        vz = pos.getZ(i);
      const d = Math.hypot(vx - local.x, (vy - local.y) * 1.3, (vz - local.z) * 0.9);
      const radius = 1.35;
      if (d < radius) {
        const lumpy = 0.65 + 0.7 * hash3(vx, vy, vz);
        const k = Math.pow(1 - d / radius, 1.3) * 0.42 * lumpy;
        pos.setXYZ(i, vx - Math.sign(vx) * k, vy - k * 0.55, vz + (hash3(vz, vx, vy) - 0.5) * k * 0.5);
      }
    }
    pos.needsUpdate = true;
    car.body.geometry.computeVertexNormals();
    // 3. Glass burst away from the player, plus a handful thrown back at them.
    const away = impact.clone().sub(from).setY(0).normalize();
    const toward = from.clone().sub(impact).setY(0).normalize();
    this.swinger.copy(from);
    for (let k = 0; k < SHARDS_PER_SMASH; k++) {
      const s = this.shardState[this.nextShard];
      this.nextShard = (this.nextShard + 1) % this.shardState.length;
      s.active = true;
      s.p.set(impact.x + (Math.random() - 0.5) * 1.2, impact.y + Math.random() * 0.4, impact.z + (Math.random() - 0.5) * 0.3);
      if (k < SHARDS_AT_PLAYER) {
        s.v.set(toward.x * (3 + Math.random() * 2) + (Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 2.2, toward.z * (3 + Math.random() * 2) + (Math.random() - 0.5) * 1.2);
      } else {
        const spread = 3.2;
        s.v.set(away.x * 2 + (Math.random() - 0.5) * spread, 1.5 + Math.random() * 3.2, away.z * 2 + (Math.random() - 0.5) * spread - 1.2);
      }
      s.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      s.w.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
      s.s = 1.3 + Math.random() * 1.9;
    }
    // 4. Suspension rock + hazards.
    car.smashed = true;
    car.smashedAt = this.time;
    car.hazardUntil = this.time + HAZARD_SECONDS;
  }

  update(dt: number) {
    this.time += dt;
    // Shards: gravity, bounce, friction, then rest on the ground for good.
    let any = false;
    for (let i = 0; i < this.shardState.length; i++) {
      const s = this.shardState[i];
      if (!s.active) continue;
      any = true;
      s.v.y -= 9.8 * dt;
      s.p.addScaledVector(s.v, dt);
      // Bounce off the swinger (a body-sized cylinder): reflect outward and lose some speed.
      const bx = s.p.x - this.swinger.x,
        bz = s.p.z - this.swinger.z;
      const bd = Math.hypot(bx, bz);
      if (bd < 0.38 && s.p.y > this.swinger.y + 0.1 && s.p.y < this.swinger.y + 1.9) {
        const nx = bx / (bd || 1),
          nz = bz / (bd || 1);
        const into = s.v.x * nx + s.v.z * nz;
        if (into < 0) {
          s.v.x -= 1.6 * into * nx;
          s.v.z -= 1.6 * into * nz;
          s.v.y = Math.abs(s.v.y) * 0.5 + 0.8;
        }
        s.p.x = this.swinger.x + nx * 0.38;
        s.p.z = this.swinger.z + nz * 0.38;
      }
      const floor = groundHeight(s.p.x, s.p.z) + 0.006;
      if (s.p.y < floor) {
        s.p.y = floor;
        s.v.y = -s.v.y * 0.28;
        s.v.x *= 0.55;
        s.v.z *= 0.55;
        s.w.multiplyScalar(0.5);
        // Lie flat once slow.
        if (Math.abs(s.v.y) < 0.4 && Math.hypot(s.v.x, s.v.z) < 0.3) {
          s.active = false;
          s.r.set(-Math.PI / 2, s.r.y, 0);
        }
      }
      s.r.x += s.w.x * dt;
      s.r.y += s.w.y * dt;
      s.r.z += s.w.z * dt;
      this.q.setFromEuler(s.r);
      this.shards.setMatrixAt(i, this.m.compose(s.p, this.q, this.scaleV.setScalar(s.s)));
      if (!s.active) any = true;
    }
    if (any) this.shards.instanceMatrix.needsUpdate = true;
    // Glints: flying shards flash as they tumble; settled ones twinkle now and then.
    if (any || this.cars.some((c) => c.smashed)) {
      for (let i = 0; i < this.shardState.length; i++) {
        const s = this.shardState[i];
        if (s.p.y < -5) continue;
        const phase = s.glint + this.time * (s.active ? 14 : 2.2);
        const sparkle = Math.pow(Math.max(0, Math.sin(phase)), s.active ? 6 : 40);
        this.shards.setColorAt(i, this.glintColor.setScalar((s.active ? 1.25 : 0.75) + sparkle * 3.2));
      }
      this.shards.instanceColor!.needsUpdate = true;
    }
    // Suspension: a damped roll and bounce for about a second after the hit.
    for (const car of this.cars) {
      if (!car.smashed) continue;
      const t = this.time - car.smashedAt;
      if (t > ROCK_SECONDS) {
        car.group.rotation.z = 0;
        car.group.position.y = 0;
        continue;
      }
      const decay = Math.exp(-3.2 * t);
      car.group.rotation.z = 0.13 * decay * Math.sin(t * 15);
      car.group.position.y = -0.07 * decay * Math.cos(t * 13);
    }
    // Hazard lights: the most recently smashed car with time left owns the shared light.
    let lit: ParkedCar | null = null;
    for (const car of this.cars) {
      const on = car.hazardUntil > this.time && Math.floor(this.time * 3) % 2 === 0;
      car.indicators.emissiveIntensity = on ? 8 : 0;
      car.headlights.emissive.set(on ? "#ffd27a" : "#000000");
      car.headlights.emissiveIntensity = on ? 4 : 0;
      car.taillights.emissive.set(on ? "#ff3a1a" : "#000000");
      car.taillights.emissiveIntensity = on ? 5 : 0;
      if (car.hazardUntil > this.time) lit = car;
    }
    if (lit) {
      const on = Math.floor(this.time * 3) % 2 === 0;
      this.hazardLight.position.set(lit.x, 2.2, lit.z);
      this.hazardLight.intensity = on ? 7 : 0;
    } else this.hazardLight.intensity = 0;
  }

  positions() {
    return this.cars.map((c) => ({ x: c.x, z: c.z }));
  }
}

/** Cheap deterministic 0..1 noise from a position (same vertex position → same value). */
function hash3(x: number, y: number, z: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

/** A blown-out side window: a hole with jagged glass teeth left in the frame (alpha-tested). */
function blownOutTexture() {
  return canvasTexture(256, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = "rgba(225,245,255,1)";
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Teeth along all four edges, pointing inward.
    const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number, count: number) => {
      c.beginPath();
      c.moveTo(x0, y0);
      for (let k = 0; k <= count; k++) {
        const t = k / count;
        const depth = k % 2 ? 6 + rand() * 30 : 2 + rand() * 6;
        c.lineTo(x0 + (x1 - x0) * t + nx * depth, y0 + (y1 - y0) * t + ny * depth);
      }
      c.lineTo(x1, y1);
      c.closePath();
      c.fill();
    };
    edge(0, 0, w, 0, 0, 1, 14);
    edge(0, h, w, h, 0, -1, 14);
    edge(0, 0, 0, h, 1, 0, 6);
    edge(w, 0, w, h, -1, 0, 6);
    c.fillRect(0, 0, w, 4);
    c.fillRect(0, h - 4, w, 4);
  });
}

function crackTexture() {
  return canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = "rgba(160,190,200,0.55)";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(255,255,255,0.95)";
    c.lineWidth = 2;
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [cx, cy] of [
      [w * 0.3, h * 0.45],
      [w * 0.72, h * 0.55],
    ]) {
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2 + rand() * 0.3;
        c.beginPath();
        c.moveTo(cx, cy);
        let x = cx,
          y = cy;
        for (let s = 0; s < 5; s++) {
          x += Math.cos(a + (rand() - 0.5) * 0.6) * 26;
          y += Math.sin(a + (rand() - 0.5) * 0.6) * 26;
          c.lineTo(x, y);
        }
        c.stroke();
      }
      for (let ring = 1; ring < 5; ring++) {
        c.beginPath();
        for (let k = 0; k <= 18; k++) {
          const a = (k / 18) * Math.PI * 2;
          const r = ring * 24 + rand() * 8;
          if (k === 0) c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          else c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        c.stroke();
      }
      c.fillStyle = "rgba(20,30,35,0.9)";
      c.beginPath();
      c.arc(cx, cy, 14, 0, Math.PI * 2);
      c.fill();
    }
  });
}
