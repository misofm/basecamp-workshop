/**
 * The cars on the dead street: the one smashable Triangle self-driving sedan, the older dead
 * cars dressing the road, and what happens when the sedan gets smashed.
 *
 * Owns: the sedan ("car:0" at PARKED_CARS[0]: dusty rounded 2030s pod, flat tyres, Triangle
 * badge on the nose, SELF-NAVIGATION DISABLED / MANUAL DRIVING PROHIBITED window stickers),
 * its collision and interactable (at SEDAN_INTERACT, on the south sidewalk); the static
 * DEAD_CARS (boxy unbranded sedans, a kei car, a van, one burned shell; not interactable,
 * merged into three draw calls) and their collision; and the smash effects, tuned to be
 * comedic and readable on a projector: the sidewalk-side front window is blown out and the
 * rest of the glass cracks, the door panel crumples, the body rocks on its flat tyres for
 * about a second, the Triangle badge pops off and tumbles to the road, an instanced burst of
 * glinting glass shards flies out (a few bounce off the player) and settles, and ~8 s of
 * hazards flash every lamp strip (emissive + one shared orange PointLight that exists from
 * the start so no shader recompiles happen mid-game; it counts toward the light budget).
 * Must not: play sounds or decide consequences; the swing itself is player.ts.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Collision } from "./collision";
import { Interactables } from "./interactables";
import { DEAD_CARS, groundHeight, PARKED_CARS, SEDAN_INTERACT } from "./layout";
import {
  BADGE_SPOT,
  carMaterials,
  deadCarParts,
  type DeadCarKind,
  SEDAN,
  sedanBodyGeometry,
  sedanGlassGeometry,
  sedanLampGeometry,
  sedanTrimGeometry,
  stickerSpot,
} from "./vehicle";
import { canvasTexture } from "./labels";
import { drawBilingual, drawTriangleMark, grime, SignAtlas } from "./signage";

const HAZARD_SECONDS = 8;
const SHARDS_PER_SMASH = 110;
/** Shards thrown back at the swinger, to bounce off them comedically. */
const SHARDS_AT_PLAYER = 18;
const ROCK_SECONDS = 1.3;
/** Lamp strips' brightness (vertex colour scale): dead, and flashing for the hazards. */
const LAMP_OFF = 0.2,
  LAMP_ON = 3.4;
/** Older dead cars, in DEAD_CARS order (kinds and faded paint). */
const DEAD_LOOKS: { kind: DeadCarKind; color: string }[] = [
  { kind: "sedan", color: "#5d6f7a" },
  { kind: "kei", color: "#b8a77a" },
  { kind: "van", color: "#c9c6bb" },
  { kind: "sedan", color: "#333" },
];

interface ParkedCar {
  id: string;
  group: THREE.Group;
  body: THREE.Mesh;
  glass: THREE.Mesh;
  lamps: THREE.MeshBasicMaterial;
  badge: THREE.Mesh;
  smashed: boolean;
  smashedAt: number;
  hazardUntil: number;
  x: number;
  z: number;
  heading: number;
}

export class ParkedCars {
  readonly cars: ParkedCar[] = [];
  private dead: { x: number; z: number }[] = [];
  private shards: THREE.InstancedMesh;
  private shardState: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number; active: boolean; glint: number }[] = [];
  /** Where the swinger stood at the last smash (shards bounce off a body-sized cylinder there). */
  private swinger = new THREE.Vector3(0, -100, 0);
  private blownOut: THREE.MeshStandardMaterial;
  private glintColor = new THREE.Color();
  private nextShard = 0;
  private hazardLight: THREE.PointLight;
  private time = 0;
  private crackedGlass: THREE.MeshStandardMaterial;
  /** The popped-off badge in flight (world space). */
  private badgeFlight: { mesh: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; resting: boolean } | null = null;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private scaleV = new THREE.Vector3();
  constructor(
    private scene: THREE.Scene,
    collision: Collision,
    interactables: Interactables,
  ) {
    const mats = carMaterials();
    const badgeMat = new THREE.MeshStandardMaterial({ map: badgeTexture(), roughness: 0.35, metalness: 0.7 });
    PARKED_CARS.forEach((spot, i) => {
      const group = new THREE.Group();
      group.position.set(spot.x, 0, spot.z);
      group.rotation.y = spot.heading;
      group.userData.keepDynamic = true;
      const body = new THREE.Mesh(sedanBodyGeometry(), mats.sedanPaint);
      body.castShadow = true;
      body.receiveShadow = true;
      const glassMesh = new THREE.Mesh(sedanGlassGeometry(), mats.glass);
      const trimMesh = new THREE.Mesh(sedanTrimGeometry(), mats.trim);
      trimMesh.castShadow = true;
      // Lamps are untonemapped from the start so the hazard flash can push them into bloom.
      const lamps = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
      lamps.color.setScalar(LAMP_OFF);
      const badge = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), badgeMat);
      badge.position.copy(BADGE_SPOT);
      group.add(body, glassMesh, trimMesh, new THREE.Mesh(sedanLampGeometry(), lamps), badge, sedanStickers());
      scene.add(group);
      const id = `car:${i}`;
      const along = Math.abs(Math.sin(spot.heading)) > 0.5;
      collision.add({ x: spot.x, z: spot.z, w: along ? SEDAN.length : SEDAN.width + 0.05, d: along ? SEDAN.width + 0.05 : SEDAN.length, h: 1.5, tag: id });
      const ip = i === 0 ? SEDAN_INTERACT : { x: spot.x, z: spot.z + 1.9 };
      interactables.register({ id, kind: "car", x: ip.x, z: ip.z, radius: 2.0 });
      this.cars.push({ id, group, body, glass: glassMesh, lamps, badge, smashed: false, smashedAt: 0, hazardUntil: 0, x: spot.x, z: spot.z, heading: spot.heading });
    });
    this.buildDeadCars(collision);
    this.blownOut = new THREE.MeshStandardMaterial({
      map: blownOutTexture(),
      color: "#cfdde2",
      emissive: "#2a3a40",
      alphaTest: 0.5,
      roughness: 0.25,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    this.crackedGlass = new THREE.MeshStandardMaterial({
      map: crackTexture(),
      color: "#b9c6c4",
      roughness: 0.35,
      metalness: 0.3,
      emissive: "#1c2528",
      side: THREE.DoubleSide,
    });
    // Shard pool: tiny triangles, one draw call for every shard of every smash.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.05, 0, -0.04, -0.03, 0, 0.045, -0.035, 0], 3));
    tri.computeVertexNormals();
    const total = SHARDS_PER_SMASH * Math.max(1, PARKED_CARS.length);
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

  /** The static dead cars: every body, glass and trim part merged (three draw calls in all). */
  private buildDeadCars(collision: Collision) {
    const mats = carMaterials();
    const bodies: THREE.BufferGeometry[] = [],
      glass: THREE.BufferGeometry[] = [],
      trim: THREE.BufferGeometry[] = [];
    DEAD_CARS.forEach((spot, i) => {
      const look = DEAD_LOOKS[i % DEAD_LOOKS.length];
      const parts = deadCarParts(look.kind, look.color, !!spot.burned, 17 + i * 13);
      const m = new THREE.Matrix4().makeRotationY(spot.heading).setPosition(spot.x, 0, spot.z);
      bodies.push(parts.body.applyMatrix4(m));
      if (parts.glass) glass.push(parts.glass.applyMatrix4(m));
      trim.push(parts.trim.applyMatrix4(m));
      // Axis-aligned collision around the (possibly askew) footprint.
      const c = Math.abs(Math.cos(spot.heading)),
        s = Math.abs(Math.sin(spot.heading));
      collision.add({ x: spot.x, z: spot.z, w: parts.length * s + parts.width * c, d: parts.length * c + parts.width * s, h: parts.height, tag: `dead-car:${i}` });
      this.dead.push({ x: spot.x, z: spot.z });
    });
    const add = (list: THREE.BufferGeometry[], material: THREE.Material, name: string) => {
      if (!list.length) return;
      for (const g of list) {
        if (!g.getAttribute("color")) g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(1), 3));
      }
      const mesh = new THREE.Mesh(mergeGeometries(list)!, material);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };
    add(bodies, mats.deadPaint, "dead-cars:body");
    add(glass, mats.glass, "dead-cars:glass");
    add(trim, mats.trim, "dead-cars:trim");
  }

  get(id: string) {
    return this.cars.find((c) => c.id === id);
  }

  /** Where the player's swing should land: the front side window on the sidewalk (+x local) side. */
  impactPoint(car: ParkedCar) {
    const local = new THREE.Vector3(0.88, 1.18, 0.33);
    return local.applyAxisAngle(new THREE.Vector3(0, 1, 0), car.heading).add(new THREE.Vector3(car.x, 0, car.z));
  }

  /** Apply all smash effects at once (called at the moment the swing lands). */
  smash(car: ParkedCar, from: THREE.Vector3) {
    const impact = this.impactPoint(car);
    // 1. Glass: the sidewalk-side front window (group 1) is blown out, the rest (group 0) cracks.
    car.glass.material = [this.crackedGlass, this.blownOut];
    // 2. Crumple: push shell vertices near the impact inward and down, with a lumpy
    //    position-hashed noise so the panel looks crushed rather than smoothly pressed.
    car.group.updateMatrixWorld(true);
    const local = car.group.worldToLocal(impact.clone());
    const pos = car.body.geometry.getAttribute("position") as THREE.BufferAttribute;
    const shellCount = (car.body.geometry.userData.shellVertices as number | undefined) ?? pos.count;
    for (let i = 0; i < shellCount; i++) {
      const vx = pos.getX(i),
        vy = pos.getY(i),
        vz = pos.getZ(i);
      if (Math.sign(vx) !== Math.sign(local.x)) continue; // only the struck flank
      const d = Math.hypot(vx - local.x, (vy - local.y) * 1.3, (vz - local.z) * 0.9);
      const radius = 1.35;
      if (d < radius) {
        const lumpy = 0.65 + 0.7 * hash3(vx, vy, vz);
        const k = Math.pow(1 - d / radius, 1.3) * 0.36 * lumpy;
        pos.setXYZ(i, vx - Math.sign(vx) * k, vy - k * 0.5, vz + (hash3(vz, vx, vy) - 0.5) * k * 0.5);
      }
    }
    pos.needsUpdate = true;
    car.body.geometry.computeVertexNormals();
    // 3. Glass burst away from the player (into the car and over the road), plus a handful
    //    thrown back at them.
    const away = impact.clone().sub(from).setY(0).normalize();
    const toward = away.clone().negate();
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
        s.v.set(away.x * 2.6 + (Math.random() - 0.5) * spread, 1.5 + Math.random() * 3.2, away.z * 2.6 + (Math.random() - 0.5) * spread);
      }
      s.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      s.w.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
      s.s = 1.3 + Math.random() * 1.9;
    }
    // 4. The Triangle badge pops off the nose and tumbles onto the road.
    const badge = car.badge;
    const world = new THREE.Vector3();
    badge.getWorldPosition(world);
    const wq = new THREE.Quaternion();
    badge.getWorldQuaternion(wq);
    this.scene.add(badge);
    badge.position.copy(world);
    badge.quaternion.copy(wq);
    const nose = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
    this.badgeFlight = {
      mesh: badge,
      v: nose.multiplyScalar(2.2).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 3.0, (Math.random() - 0.5) * 0.8)),
      w: new THREE.Vector3(9 + Math.random() * 5, (Math.random() - 0.5) * 6, 4),
      resting: false,
    };
    // 5. Suspension rock + hazards.
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
    // The badge: a spinning coin that bounces twice and lies face up on the road.
    const b = this.badgeFlight;
    if (b && !b.resting) {
      b.v.y -= 9.8 * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      b.mesh.rotation.x += b.w.x * dt;
      b.mesh.rotation.y += b.w.y * dt;
      b.mesh.rotation.z += b.w.z * dt;
      const floor = groundHeight(b.mesh.position.x, b.mesh.position.z) + 0.012;
      if (b.mesh.position.y < floor) {
        b.mesh.position.y = floor;
        b.v.y = -b.v.y * 0.35;
        b.v.x *= 0.5;
        b.v.z *= 0.5;
        b.w.multiplyScalar(0.45);
        if (Math.abs(b.v.y) < 0.5) {
          b.resting = true;
          b.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
        }
      }
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
      car.group.position.y = -0.06 * decay * Math.cos(t * 13);
    }
    // Hazard lights: the most recently smashed car with time left owns the shared light.
    let lit: ParkedCar | null = null;
    const on = Math.floor(this.time * 3) % 2 === 0;
    for (const car of this.cars) {
      const flashing = car.hazardUntil > this.time;
      car.lamps.color.setScalar(flashing && on ? LAMP_ON : LAMP_OFF);
      if (flashing) lit = car;
    }
    if (lit) {
      this.hazardLight.position.set(lit.x, 2.2, lit.z);
      this.hazardLight.intensity = on ? 7 : 0;
    } else this.hazardLight.intensity = 0;
  }

  /** Every car on the street (the sedan first, then the dead cars), for the minimap. */
  positions() {
    return [...this.cars.map((c) => ({ x: c.x, z: c.z })), ...this.dead];
  }
}

/** The stickers on the sedan's +x rear side window, and a small corporate line on the tail. */
function sedanStickers() {
  const atlas = new SignAtlas("sedan-stickers", 512, 0);
  const nav = atlas.add(320, 176, (c, w, h) => {
    c.fillStyle = "#e9e1c8";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#c8321e";
    c.fillRect(0, 0, w, h * 0.16);
    c.fillRect(0, h * 0.9, w, h * 0.1);
    c.save();
    c.translate(0, h * 0.12);
    drawBilingual("selfNavOff", { ink: "#1a1a1a", inkEn: "#5a1a10", jpShare: 0.56 })(c, w, h * 0.76);
    c.restore();
    grime(c, w, h, 0.9, 41);
  });
  const ban = atlas.add(256, 160, (c, w, h) => {
    c.fillStyle = "#f2c230";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#1a1a1a";
    c.lineWidth = 8;
    c.strokeRect(6, 6, w - 12, h - 12);
    drawBilingual("manualBanned", { ink: "#1a1a1a", jpShare: 0.56 })(c, w, h);
    grime(c, w, h, 1, 77);
  });
  const corp = atlas.add(256, 64, (c, w, h) => {
    drawTriangleMark(c, h * 0.5, h * 0.5, h * 0.7, "#2a2a2a");
    c.save();
    c.translate(h * 0.6, 0);
    drawBilingual("triangleCo", { ink: "#2a2a2a", row: true })(c, w - h * 0.6, h);
    c.restore();
  });
  const right = Math.PI / 2;
  atlas.quad(nav, 0.34, 0.19, stickerSpot(-0.37, 1.2), right);
  atlas.quad(ban, 0.24, 0.15, stickerSpot(-0.56, 1.15), right);
  // Small Triangle line on the tail, under the light strip.
  atlas.quad(corp, 0.4, 0.1, new THREE.Vector3(0, 0.74, -SEDAN.length / 2 - 0.02), Math.PI);
  const mesh = atlas.build();
  const m = mesh.material as THREE.MeshStandardMaterial;
  m.roughness = 0.6;
  m.emissiveIntensity = 0;
  return mesh;
}

/** The Triangle badge: brushed-steel disc, dark mark, a little rust. */
function badgeTexture() {
  return canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w * 0.4, h * 0.35, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, "#d8d8d2");
    g.addColorStop(1, "#7d7c76");
    c.fillStyle = g;
    c.beginPath();
    c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    c.fill();
    drawTriangleMark(c, w / 2, h / 2 + 4, w * 0.62, "#1d1d1f");
    grime(c, w, h, 0.8, 9);
  });
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

/** Cracked, dusty glass: spiderweb impacts over a hazy brown film. */
function crackTexture() {
  return canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = "#3a4548";
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(150,132,108,0.5)");
    g.addColorStop(1, "rgba(150,132,108,0.15)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(235,240,240,0.9)";
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
