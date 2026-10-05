/**
 * Non-player characters: street pedestrians, the shop clerk and the collector buyer.
 *
 * Owns: cloning the rigged characters with per-NPC tinted clothing, pedestrians
 * spread along sidewalk routes (pausing / sidestepping when the player is in the way),
 * the clerk behind the counter with a status speech bubble, the collector
 * ("buyer:collector": a visibly different character with beanie, big headphones, gold
 * chain and a tote full of records, head-nodding to the beat and waving the player
 * over), the gold ground ring and "Got any wax?" bubble, the collector's walk-off
 * after a sale, and the walk back to the spot when the game asks for a rerun.
 * Must not: decide sale or purchase outcomes; world.ts relays the game layer's statuses.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Collision, type Obstacle } from "./collision";
import { loadCharacter, makeCharacter, rotateBoneAboutWorldAxis, type Character, type CharacterKind } from "./characters";
import { Interactables } from "./interactables";
import { BUYER_EXIT, BUYER_SPOT, COUNTER, groundHeight, PED_ROUTES, SHOP_FLOOR_Y } from "./layout";
import { SpeechBubble } from "./labels";
import { DISPLAY_SCALE, type Holder } from "./record-item";

export const BUYER_ID = "buyer:collector";

const BUYER_LINES = {
  idle: "Got any wax?",
  thinking: "Hmm, let me check it…",
  happy: "Mint condition! Pleasure doing business.",
  error: "Maybe some other time.",
} as const;
const CASHIER_LINES = {
  processing: "Processing…",
  success: "Paid ✓ Enjoy!",
  error: "Hmm, that didn't go through",
} as const;

interface Walker {
  character: Character;
  kind: CharacterKind;
  route: { x: number; z: number }[];
  loop: boolean;
  target: number;
  dir: 1 | -1;
  speed: number;
  side: number;
  pausedFor: number;
  heading: number;
  active?: THREE.AnimationAction;
}

/** Pick or crossfade to a named clip. */
function play(walker: { character: Character; active?: THREE.AnimationAction }, name: string, timeScale = 1) {
  const next = walker.character.actions[name];
  if (!next) return;
  next.timeScale = timeScale;
  if (next === walker.active) return;
  walker.active?.fadeOut(0.25);
  next.reset().fadeIn(0.25).play();
  walker.active = next;
}

function angleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export class Npcs {
  private pedestrians: Walker[] = [];
  private clerk?: { character: Character; active?: THREE.AnimationAction };
  readonly clerkBubble = new SpeechBubble(3.0, 7);
  private buyer?: Walker & {
    leaving: boolean;
    leftAt: number;
    gone: boolean;
    /** Walking back to BUYER_SPOT (see buyerReturn); `arrive` resolves its promise. */
    returning: boolean;
    returnTarget: number;
    arrive?: () => void;
  };
  readonly buyerBubble = new SpeechBubble(2.8, 6);
  private buyerRing: THREE.Mesh;
  private buyerObstacle: Obstacle;
  private buyerStatusTimer = 0;
  private buyerStatus: "idle" | "thinking" | "happy" | "error" = "idle";
  private time = 0;
  private player = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    collision: Collision,
    private interactables: Interactables,
  ) {
    scene.add(this.clerkBubble.sprite, this.buyerBubble.sprite);
    this.clerkBubble.occluders = this.buyerBubble.occluders = () => collision.occluders();
    this.clerkBubble.sprite.position.set(COUNTER.x, SHOP_FLOOR_Y + 2.15, COUNTER.clerkZ + 0.3);
    // Gold ring marks the collector from across the street.
    this.buyerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.86, 48),
      new THREE.MeshBasicMaterial({ color: "#ffc93c", transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    this.buyerRing.rotation.x = -Math.PI / 2;
    this.buyerRing.position.set(BUYER_SPOT.x, SHOP_FLOOR_Y + 0.02, BUYER_SPOT.z);
    this.buyerRing.renderOrder = 2;
    scene.add(this.buyerRing);
    this.buyerBubble.set(BUYER_LINES.idle, { accent: "#ffc93c" });
    this.buyerObstacle = collision.add({ x: BUYER_SPOT.x, z: BUYER_SPOT.z, w: 0.6, d: 0.6, h: 0, tag: "buyer" });
    interactables.register({ id: BUYER_ID, kind: "buyer", x: BUYER_SPOT.x, z: BUYER_SPOT.z + 0.9, radius: 2.0 });
    void Promise.all([loadCharacter("male"), loadCharacter("female")]).then(([male, female]) => {
      const templates = { male, female };
      // Pedestrians.
      // `along` = how far around the route (0..1) each walker starts, so they are spread
      // out rather than clumped at the corners.
      const looks: { kind: CharacterKind; tint: string; route: number; along: number; dir: 1 | -1 }[] = [
        // Michelle is ~28k triangles, the Vanguard ~11k: mostly Vanguards for the integrated GPU.
        { kind: "female", tint: "#9fd8ff", route: 0, along: 0.1, dir: 1 },
        { kind: "male", tint: "#9fc4ff", route: 0, along: 0.29, dir: -1 }, // walks past the spawn shot
        { kind: "male", tint: "#c9f2c0", route: 0, along: 0.62, dir: 1 },
        { kind: "male", tint: "#ffd0b0", route: 1, along: 0.45, dir: 1 },
        { kind: "female", tint: "#e0c8ff", route: 2, along: 0.3, dir: 1 },
        { kind: "male", tint: "#fff0a8", route: 3, along: 0.7, dir: -1 },
      ];
      for (const look of looks) {
        const route = PED_ROUTES[look.route];
        const character = makeCharacter(look.kind, templates[look.kind], look.tint);
        character.model.traverse((o) => (o.castShadow = false)); // only the player and collector cast
        const start = pointAlong(route.points, route.loop, look.along);
        character.root.position.set(start.x, 0, start.z);
        scene.add(character.root);
        const n = route.points.length;
        const walker: Walker = {
          character,
          kind: look.kind,
          route: route.points,
          loop: route.loop,
          // Walking forward heads for the segment's end point, backward for its start.
          target: look.dir === 1 ? (start.segment + 1) % n : start.segment,
          dir: look.dir,
          speed: look.kind === "female" ? 1.25 : 1.35,
          side: 0,
          pausedFor: 0,
          heading: 0,
        };
        play(walker, "Walk");
        walker.character.mixer.update(Math.random() * 2);
        this.pedestrians.push(walker);
      }
      // The clerk behind the counter.
      const clerk = makeCharacter("female", female, "#cfe8d8");
      clerk.model.traverse((o) => (o.castShadow = false));
      clerk.root.position.set(COUNTER.x, SHOP_FLOOR_Y, COUNTER.clerkZ);
      scene.add(clerk.root);
      this.clerk = { character: clerk };
      play(this.clerk, "Idle");
      // The collector: a different character from the player (Michelle, not the armoured
      // Vanguard) in a bright jacket, with beanie, big headphones, gold chain and a tote of records.
      const buyer = makeCharacter("female", female, "#ff9f43");
      buyer.root.position.set(BUYER_SPOT.x, SHOP_FLOOR_Y, BUYER_SPOT.z);
      buyer.root.rotation.y = BUYER_SPOT.heading;
      addCollectorGear(buyer);
      scene.add(buyer.root);
      this.buyer = {
        character: buyer,
        kind: "female",
        route: BUYER_EXIT,
        loop: false,
        target: 0,
        dir: 1,
        speed: 1.5,
        side: 0,
        pausedFor: 0,
        heading: BUYER_SPOT.heading,
        leaving: false,
        leftAt: 0,
        gone: false,
        returning: false,
        returnTarget: 0,
      };
      play(this.buyer, "Idle");
    });
  }

  setCashierStatus(status: "idle" | "processing" | "success" | "error") {
    if (status === "idle") this.clerkBubble.set(null);
    else
      this.clerkBubble.set(CASHIER_LINES[status], {
        accent: status === "success" ? "#3ccf7a" : status === "error" ? "#ff5c5c" : "#ffb35c",
        busy: status === "processing",
      });
  }

  setBuyerStatus(npcId: string, status: "idle" | "thinking" | "happy" | "error") {
    if (npcId !== BUYER_ID || this.buyer?.gone) return;
    const accent = status === "happy" ? "#3ccf7a" : status === "error" ? "#ff5c5c" : "#ffc93c";
    this.buyerBubble.set(BUYER_LINES[status], { accent, busy: status === "thinking" });
    this.buyerStatus = status;
    // Errors fall back to the idle line after a few seconds.
    this.buyerStatusTimer = status === "error" ? 4 : 0;
  }

  /** Holder that keeps a record in an NPC's right hand. */
  holderFor(npcId: string): Holder | null {
    if (npcId !== BUYER_ID) return null;
    return (out) => {
      const b = this.buyer;
      const hand = b?.character.bones.rightHand;
      if (!b || !hand || b.gone) return false;
      hand.getWorldPosition(HAND);
      const q = Q.copy(b.character.root.quaternion);
      OFFSET.set(-0.04, -0.2, 0.03).applyQuaternion(q);
      q.multiply(Q2.setFromEuler(E.set(0.1, -2.0, 0)));
      out.compose(HAND.add(OFFSET), q, S.setScalar(DISPLAY_SCALE));
      return true;
    };
  }

  /** The collector takes the record and strolls off down the sidewalk, then despawns. */
  buyerLeave(npcId: string) {
    if (npcId !== BUYER_ID || !this.buyer || this.buyer.leaving) return;
    this.buyer.leaving = true;
    this.buyer.leftAt = this.time;
    this.buyer.target = 0;
    this.buyerObstacle.enabled = false;
    this.interactables.setEnabled(BUYER_ID, false);
    this.buyerRing.visible = false;
    if (this.buyerBubble.current !== BUYER_LINES.happy) this.buyerBubble.set(BUYER_LINES.happy, { accent: "#3ccf7a" });
  }

  /**
   * The collector comes back for another round: from wherever they are on the way out
   * (or from down the street if they already despawned), empty-handed, back to the
   * spot. Resolves on arrival with the ring, bubble and collision restored; enabling
   * the interactable is the caller's call.
   */
  buyerReturn(npcId: string): Promise<void> {
    const b = this.buyer;
    if (npcId !== BUYER_ID || !b || (!b.leaving && !b.gone && !b.returning)) return Promise.resolve();
    if (b.gone) {
      b.character.root.position.set(BUYER_RETURN_START.x, groundHeight(BUYER_RETURN_START.x, BUYER_RETURN_START.z), BUYER_RETURN_START.z);
      b.heading = Math.PI / 2; // facing east, towards the shop
      b.character.root.visible = true;
    }
    b.leaving = false;
    b.gone = false;
    b.returning = true;
    b.returnTarget = 0;
    this.buyerBubble.set(null);
    const previous = b.arrive;
    return new Promise<void>((resolve) => {
      b.arrive = () => {
        previous?.();
        resolve();
      };
    });
  }

  get buyerPosition() {
    const p = this.buyer?.character.root.position;
    return p ? { x: p.x, z: p.z } : { x: BUYER_SPOT.x, z: BUYER_SPOT.z };
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Camera) {
    this.time += dt;
    this.player.copy(player);
    for (const w of this.pedestrians) this.walk(w, dt);
    if (this.clerk) {
      this.clerk.character.mixer.update(dt);
    }
    this.updateBuyer(dt);
    this.clerkBubble.update(dt, camera);
    this.buyerBubble.update(dt, camera);
    const pulse = 1 + Math.sin(this.time * 3) * 0.08;
    this.buyerRing.scale.set(pulse, pulse, pulse);
  }

  private walk(w: Walker, dt: number) {
    const root = w.character.root;
    const p = root.position;
    let t = w.route[w.target];
    for (let guard = 0; guard < 3 && Math.hypot(t.x - p.x, t.z - p.z) < 0.3; guard++) {
      this.advance(w);
      t = w.route[w.target];
    }
    let dx = t.x - p.x,
      dz = t.z - p.z;
    const dist = Math.max(0.001, Math.hypot(dx, dz));
    dx /= dist;
    dz /= dist;
    // Player in the way? Sidestep (and stop if very close).
    const px = this.player.x - p.x,
      pz = this.player.z - p.z;
    const ahead = px * dx + pz * dz;
    const lateral = -px * dz + pz * dx;
    let speed = w.speed;
    let wantSide = 0;
    if (ahead > -0.3 && ahead < 2.4 && Math.abs(lateral) < 1.1) {
      wantSide = lateral > 0 ? -1.1 : 1.1;
      // Don't sidestep into the collector standing by the bench; go round the other way.
      const b = this.buyerPosition;
      if (Math.hypot(p.x - dz * wantSide - b.x, p.z + dx * wantSide - b.z) < 1.0) wantSide = -wantSide;
      if (ahead < 0.9) speed = 0;
      else speed *= 0.6;
    }
    w.side += (wantSide - w.side) * Math.min(1, dt * 3);
    if (speed > 0 && dt > 0) {
      p.x += dx * speed * dt;
      p.z += dz * speed * dt;
    }
    // Lateral offset is applied to the drawn position only (route stays clean).
    const ox = -dz * w.side,
      oz = dx * w.side;
    root.userData.drawOffset = { x: ox, z: oz };
    const heading = Math.atan2(dx + ox * 0.15, dz + oz * 0.15);
    w.heading += angleDelta(w.heading, heading) * Math.min(1, dt * 6);
    root.rotation.y = w.heading;
    p.y = THREE.MathUtils.lerp(p.y, groundHeight(p.x, p.z), Math.min(1, dt * 10));
    // Draw the sidestep by shifting the child model in world space.
    const child = w.character.model;
    const cos = Math.cos(-w.heading),
      sin = Math.sin(-w.heading);
    child.position.x = ox * cos + oz * sin;
    child.position.z = -ox * sin + oz * cos;
    if (speed > 0.05) play(w, "Walk", speed / 1.3);
    else play(w, "Idle");
    w.character.mixer.update(dt);
  }

  private advance(w: Walker) {
    const n = w.route.length;
    if (w.loop) w.target = (w.target + w.dir + n) % n;
    else {
      if (w.target + w.dir >= n || w.target + w.dir < 0) w.dir = (w.dir * -1) as 1 | -1;
      w.target += w.dir;
    }
  }

  private updateBuyer(dt: number) {
    const b = this.buyer;
    if (!b) return;
    const root = b.character.root;
    const head = root.position;
    if (b.gone) return;
    if (this.buyerStatusTimer > 0) {
      this.buyerStatusTimer -= dt;
      if (this.buyerStatusTimer <= 0) {
        this.buyerBubble.set(BUYER_LINES.idle, { accent: "#ffc93c" });
        this.buyerStatus = "idle";
      }
    }
    if (b.returning) {
      const t = BUYER_RETURN_PATH[b.returnTarget];
      const dx = t.x - head.x,
        dz = t.z - head.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3 && b.returnTarget < BUYER_RETURN_PATH.length - 1) b.returnTarget++;
      if (dist > 0.05) {
        const step = Math.min(dist, b.speed * dt);
        head.x += (dx / dist) * step;
        head.z += (dz / dist) * step;
        b.heading += angleDelta(b.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 5);
        head.y = groundHeight(head.x, head.z);
        root.rotation.y = b.heading;
        play(b, "Walk", 1.1);
      } else if (b.returnTarget === BUYER_RETURN_PATH.length - 1) {
        // Back on the spot: same as a fresh spawn.
        b.returning = false;
        head.set(BUYER_SPOT.x, SHOP_FLOOR_Y, BUYER_SPOT.z);
        this.buyerObstacle.enabled = true;
        this.buyerRing.visible = true;
        this.buyerStatus = "idle";
        this.buyerStatusTimer = 0;
        this.buyerBubble.set(BUYER_LINES.idle, { accent: "#ffc93c" });
        const arrive = b.arrive;
        b.arrive = undefined;
        arrive?.();
      }
    } else if (b.leaving) {
      const elapsed = this.time - b.leftAt;
      const t = b.route[b.target];
      const dx = t.x - head.x,
        dz = t.z - head.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3 && b.target < b.route.length - 1) b.target++;
      if (dist > 0.05) {
        const step = Math.min(dist, b.speed * dt);
        head.x += (dx / dist) * step;
        head.z += (dz / dist) * step;
        b.heading += angleDelta(b.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 5);
      }
      root.rotation.y = b.heading;
      // A happy little bounce in his step.
      head.y = groundHeight(head.x, head.z) + Math.abs(Math.sin(elapsed * 6)) * 0.06;
      play(b, "Walk", 1.15);
      if (elapsed > 5) this.buyerBubble.set(null);
      if (elapsed > 12) {
        b.gone = true;
        root.visible = false;
        this.buyerBubble.set(null);
      }
    } else {
      // Face the player when they come close, otherwise look out at the street.
      const px = this.player.x - head.x,
        pz = this.player.z - head.z;
      const near = Math.hypot(px, pz) < 6;
      const want = near ? Math.atan2(px, pz) : BUYER_SPOT.heading;
      b.heading += angleDelta(b.heading, want) * Math.min(1, dt * 3);
      root.rotation.y = b.heading;
      play(b, "Idle");
    }
    b.character.mixer.update(dt);
    if (!b.leaving && !b.returning) this.collectorBodyLanguage(b.character, Math.hypot(this.player.x - head.x, this.player.z - head.z));
    this.buyerBubble.sprite.position.set(head.x, head.y + 2.25, head.z);
  }

  /**
   * Procedural layer over the idle clip so the collector reads as an NPC who wants
   * something: nods to the music in the headphones, and every few seconds waves the
   * player over when they are in view. Thinking = head tilted; happy = big nod.
   */
  private collectorBodyLanguage(c: Character, playerDistance: number) {
    const t = this.time;
    c.model.updateMatrixWorld(true);
    const forward = AXIS_F.set(0, 0, 1).applyQuaternion(c.root.quaternion);
    const right = AXIS_R.set(1, 0, 0).applyQuaternion(c.root.quaternion);
    const status = this.buyerStatus;
    // Head: nod on the beat (≈ 96 bpm), or a thoughtful tilt.
    const nod = status === "thinking" ? 0.06 : status === "happy" ? 0.22 : 0.12;
    rotateBoneAboutWorldAxis(c.bones.neck, right, Math.max(0, Math.sin(t * 5.0)) * nod);
    if (status === "thinking") rotateBoneAboutWorldAxis(c.bones.neck, forward, 0.22);
    rotateBoneAboutWorldAxis(c.bones.spine, forward, Math.sin(t * 2.5) * 0.045);
    // Wave: raise the right arm out to the side and wag the forearm (1.6 s every 4.5 s).
    if (status === "idle" && playerDistance < 16) {
      const u = (t % 4.5) / 1.6;
      if (u < 1) {
        const lift = Math.sin(Math.min(1, u * 1.25) * Math.PI) ** 0.6;
        rotateBoneAboutWorldAxis(c.bones.rightArm, forward, -2.3 * lift);
        rotateBoneAboutWorldAxis(c.bones.rightForeArm, forward, (-0.5 + Math.sin(u * Math.PI * 6) * 0.45) * lift);
      }
    }
  }

  positions() {
    const list = this.pedestrians.map((w) => {
      const p = w.character.root.position;
      const o = (w.character.root.userData.drawOffset as { x: number; z: number } | undefined) ?? { x: 0, z: 0 };
      return { x: p.x + o.x, z: p.z + o.z };
    });
    if (this.buyer && !this.buyer.gone) list.push(this.buyerPosition);
    return list;
  }
}

/** Position `fraction` (0..1) of the way along a route, and which segment that is on. */
function pointAlong(points: { x: number; z: number }[], loop: boolean, fraction: number) {
  const segments = loop ? points.length : points.length - 1;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < segments; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    lengths.push(Math.hypot(b.x - a.x, b.z - a.z));
    total += lengths[i];
  }
  let left = (((fraction % 1) + 1) % 1) * total;
  for (let i = 0; i < segments; i++) {
    if (left <= lengths[i] || i === segments - 1) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const k = lengths[i] ? Math.min(1, left / lengths[i]) : 0;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, segment: i };
    }
    left -= lengths[i];
  }
  return { x: points[0].x, z: points[0].z, segment: 0 };
}

/** Geometry part painted with one flat vertex colour (so a whole outfit is one draw call). */
function painted(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const geometry = g.index ? g.toNonIndexed() : g;
  geometry.deleteAttribute("uv");
  const c = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Attach a merged mesh, modelled in the character's own frame (metres, y up, +z = facing,
 * origin at the bone), to a bone. Works whatever the rig's bone axes and scale are.
 */
function attachToBone(c: Character, bone: THREE.Object3D | undefined, parts: THREE.BufferGeometry[], material: THREE.Material) {
  if (!bone) return;
  c.root.updateMatrixWorld(true);
  const bonePosition = bone.getWorldPosition(new THREE.Vector3());
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, material);
  // World transform we want: character orientation, positioned at the bone.
  const want = new THREE.Matrix4().compose(bonePosition, c.root.getWorldQuaternion(new THREE.Quaternion()), new THREE.Vector3(1, 1, 1));
  mesh.matrix.copy(bone.matrixWorld).invert().multiply(want);
  mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.castShadow = false; // tiny in the shadow map; not worth a shadow draw call
  bone.add(mesh);
}

const GEAR_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });

/**
 * The collector's silhouette, from simple geometry: beanie with pom-pom and oversized
 * headphones (head), a chunky gold chain with a record pendant and a canvas tote with
 * records sticking out (chest, the tote hanging at the hip). Built in the bind pose.
 */
function addCollectorGear(c: Character) {
  const { head, chest } = c.bones;
  if (!head) return;
  // Head: offsets from the Head bone (≈ base of the skull).
  attachToBone(
    c,
    head,
    [
      painted(new THREE.SphereGeometry(0.142, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.1, 1.1).translate(0, 0.19, -0.01), "#e8432d"),
      painted(new THREE.CylinderGeometry(0.146, 0.148, 0.065, 18).scale(1, 1, 1.1).translate(0, 0.19, -0.01), "#b8261a"),
      painted(new THREE.SphereGeometry(0.055, 10, 8).translate(0, 0.35, -0.02), "#ffe7d0"),
      painted(new THREE.TorusGeometry(0.19, 0.024, 6, 22, Math.PI).translate(0, 0.12, 0), "#1c1f24"),
      ...[-1, 1].flatMap((side) => [
        painted(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 18).rotateZ(Math.PI / 2).translate(side * 0.175, 0.11, 0.0), "#1c1f24"),
        painted(new THREE.CylinderGeometry(0.07, 0.07, 0.086, 16).rotateZ(Math.PI / 2).translate(side * 0.182, 0.11, 0.0), "#34d6ff"),
      ]),
    ],
    GEAR_MATERIAL,
  );
  // Chest: chunky gold chain with a record pendant, and a tote bag on a strap over the
  // right shoulder hanging at the left hip, full of records. (Chain and bag share a mesh:
  // with the head gear that's two extra draw calls for the whole outfit.)
  const bag = [
    painted(new THREE.TorusGeometry(0.1, 0.017, 6, 24).rotateX(Math.PI / 2 - 0.55).scale(1.05, 1, 1.15).translate(0, 0.02, 0.04), "#ffc93c"),
    painted(new THREE.CylinderGeometry(0.042, 0.042, 0.014, 16).rotateX(Math.PI / 2 - 0.35).translate(0, -0.07, 0.12), "#ffd75a"),
    painted(new THREE.BoxGeometry(0.07, 0.3, 0.3).translate(0.22, -0.36, -0.07), "#5f6e3f"),
    painted(new THREE.BoxGeometry(0.02, 0.56, 0.035).rotateZ(0.62).translate(0.05, -0.04, 0.05), "#3f4a2a"),
    painted(new THREE.BoxGeometry(0.02, 0.56, 0.035).rotateZ(0.62).translate(0.05, -0.04, -0.17), "#3f4a2a"),
  ];
  ["#ff4f7b", "#3ad1ff", "#ffd23c"].forEach((color, i) => {
    bag.push(painted(new THREE.BoxGeometry(0.012, 0.26, 0.26).rotateX((i - 1) * 0.15).translate(0.205 + i * 0.012, -0.24 + i * 0.012, -0.07 + (i - 1) * 0.035), color));
  });
  attachToBone(c, chest ?? head, bag, GEAR_MATERIAL);
}

/** Where a despawned collector reappears, and the way back to the spot. */
const BUYER_RETURN_START = { x: -16, z: BUYER_EXIT[0].z };
const BUYER_RETURN_PATH = [BUYER_EXIT[0], { x: BUYER_SPOT.x, z: BUYER_SPOT.z }];

const AXIS_F = new THREE.Vector3();
const AXIS_R = new THREE.Vector3();
const HAND = new THREE.Vector3();
const OFFSET = new THREE.Vector3();
const S = new THREE.Vector3();
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const E = new THREE.Euler();
