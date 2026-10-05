/**
 * Non-player characters: the named story cast, the street crowd, the shop clerk and the
 * collector buyer, all Tamashi (src/tamashi/; who plays whom is src/tamashi/cast.ts).
 *
 * Owns: the named NPCs (CAST.named) at their CAST_SPOTS (layout.ts) in their pose (the
 * band sits on the end curb, the fans on FAN_BENCH), with a small collision box, never
 * swapped out; their speech: ONE named bubble at a time, over the nearest named NPC within
 * NAMED_TALK_RADIUS, cycling its CAST lines (suppressed near the collector so it never
 * overlaps his bubble), Heart's reaction to the car smash, Inicio following Gamer home,
 * and Miné calling from HOTEL_WINDOW near the hotel door. The crowd (walkers spread along
 * the sidewalk routes, pausing / sidestepping when the player is in the way; idlers
 * chatting, window-shopping and browsing inside the shop, each with a small collision
 * box), cycling the crowd through every CAST.crowd id over time (one out-of-view member
 * swaps to the next unused id every few seconds). The clerk behind the counter (Jazz:
 * talks when the player is at the counter; cashier statuses always win). The collector
 * (Stonks, "buyer:collector", behind his BUYING table: nods to the beat, tilts his head
 * while thinking, waves the player over, cheers on a sale, carries a tote of records), the
 * gold ground ring at BUYER_INTERACT, his idle bubble ("Got any wax?" between his CAST
 * lines), his walk in at his door after a sale and the walk back out when the game asks
 * for a rerun.
 * Must not: decide sale or purchase outcomes; world.ts relays the game layer's statuses.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Collision, type Obstacle } from "./collision";
import { Interactables } from "./interactables";
import {
  BUYER_EXIT,
  BUYER_INTERACT,
  BUYER_SPOT,
  CAST_SPOTS,
  COUNTER,
  groundHeight,
  HOME_COMPANION,
  HOTEL_DOOR,
  HOTEL_WINDOW,
  PED_ROUTES,
  SHOP_FLOOR_Y,
} from "./layout";
import { SpeechBubble } from "./labels";
import type { Holder } from "./record-item";
import { createTamashi, type TamashiCharacter } from "../tamashi/character";
import { CAST, INICIO_HOME_LINE, type PlacedRole } from "../tamashi/cast";
import { J } from "../tamashi/rig";

export const BUYER_ID = "buyer:collector";

const BUYER_LINES = {
  idle: "Got any wax?",
  thinking: "Let me see…",
  happy: "Mint condition. Pleasure.",
  error: "Maybe some other time.",
} as const;
const CASHIER_LINES = {
  processing: "One sec…",
  success: "Paid. Enjoy.",
  error: "Register's jammed.",
} as const;

/** Every this many seconds, one crowd member that is out of view (or far) becomes the next cast id. */
const SWAP_EVERY = 3;
/** Beyond this camera distance a crowd member counts as "not really seen" and may be swapped. */
const SWAP_DISTANCE = 25;
/** Crowd members further than this (or off screen) advance their rig every few frames only. */
const FULL_RATE_DISTANCE = 30;

/** Walkers per route (PED_ROUTES index → count), spread evenly along it. Few people (bible §5.6). */
const WALKERS_PER_ROUTE = [3, 3, 2];

type IdleMode = "chat" | "window" | "browse";
/**
 * Idlers: fixed spots, off the walker routes (north sidewalk z 2.3, south z 10.75, the
 * loop at x ±14) and clear of every interactable, CAST_SPOTS, the props anchors and the
 * walk from the spawn to the shop door (z 1.6–2.5). Heading 0 = facing +z (south).
 * Inside the shop they browse the wall stands, away from the stands' interact points, the
 * deck, the counter and the centre aisle.
 */
const IDLE_SPOTS: { x: number; z: number; heading: number; mode: IdleMode }[] = [
  // A chatting pair by the diner's windows, west of its door (south sidewalk).
  { x: -34.4, z: 11.8, heading: Math.PI / 2, mode: "chat" },
  { x: -33.6, z: 11.8, heading: -Math.PI / 2, mode: "chat" },
  // Looking into Saisei's west window.
  { x: -6.5, z: 0.75, heading: Math.PI, mode: "window" },
  // At the sold-out vending machines (in front of the east one, north of the walkers).
  { x: 23.8, z: 1.45, heading: Math.PI, mode: "window" },
  // Browsing inside the shop.
  { x: -5.0, z: -8.0, heading: -Math.PI / 2, mode: "browse" },
  { x: 5.0, z: -4.8, heading: Math.PI / 2, mode: "browse" },
];

/** A named NPC talks (one bubble at a time) when it is the nearest within this distance (m). */
const NAMED_TALK_RADIUS = 4.5;
/** No named bubble while the player is this close to the collector (his bubble wins). */
const COLLECTOR_QUIET_RADIUS = 6;
/** Jazz talks when the player is this close to the counter's interact point. */
const CLERK_TALK_RADIUS = 3.5;
/** Miné calls from the window when the player is this close to the hotel door. */
const MINE_RADIUS = 7;
/** Seconds per line while a bubble cycles. */
const LINE_SECONDS = 4;
/** Seconds a forced line (smash reaction, going home) stays up. */
const FORCED_SECONDS = 5;
const NAMED_ACCENT = "#7fd8e8";
const CLERK_ACCENT = "#e7a8ff";
const MINE_ACCENT = "#ff9ac1";
const COLLECTOR_ACCENT = "#ffc93c";

/**
 * Seated on something (not the ground): the seat's top height above the ground the spot
 * stands on is `seat`, and the thighs go level with the shins hanging (chair sit). The
 * band sits on the end curb (their feet hang onto the asphalt), the fans on FAN_BENCH.
 */
const SEATED: Record<string, { seat: number }> = {
  band1: { seat: 0 },
  band2: { seat: 0 },
  band3: { seat: 0 },
  band4: { seat: 0 },
  fan1: { seat: 0.45 },
  fan2: { seat: 0.45 },
};

interface Member {
  character: TamashiCharacter;
  id: number;
  /** Seconds of animation not yet given to character.update (throttled far members). */
  pendingDt: number;
  /** Spreads throttled updates over frames. */
  slot: number;
}

interface Walker extends Member {
  route: { x: number; z: number }[];
  loop: boolean;
  target: number;
  dir: 1 | -1;
  speed: number;
  side: number;
  heading: number;
  /** Sidestep offset of the drawn body from its route position (world x/z). */
  offset: { x: number; z: number };
}

interface Idler extends Member {
  x: number;
  z: number;
  heading: number;
  mode: IdleMode;
  phase: number;
  obstacle: Obstacle;
}

/** A named story character at its CAST_SPOTS spot. */
interface Named extends Member {
  role: PlacedRole;
  spot: string;
  phase: number;
  /** Chair sit (curb or bench) instead of the rig's ground sit. */
  chair: boolean;
  obstacle: Obstacle;
  /** Lines it cycles through (Inicio's home line only once he has gone home). */
  lines: string[];
}

/** A line a named NPC says regardless of the proximity rule (smash reaction, going home). */
interface Forced {
  who: Named;
  text: string;
  until: number;
  /** Said next, if the player is still within `nearRadius` of `who`. */
  then?: string;
  nearRadius?: number;
}

interface Buyer {
  character: TamashiCharacter;
  route: { x: number; z: number }[];
  target: number;
  speed: number;
  heading: number;
  leaving: boolean;
  leftAt: number;
  gone: boolean;
  /** Walking back to BUYER_SPOT (see buyerReturn); `arrive` resolves its promise. */
  returning: boolean;
  returnTarget: number;
  returnPath: { x: number; z: number }[];
  arrive?: () => void;
}

function angleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export class Npcs {
  private walkers: Walker[] = [];
  private idlers: Idler[] = [];
  private named: Named[] = [];
  private clerk: TamashiCharacter;
  readonly clerkBubble = new SpeechBubble(3.0, 7);
  private clerkStatus: "idle" | "processing" | "success" | "error" = "idle";
  private clerkLine = -1;
  private clerkTimer = 0;
  private buyer: Buyer;
  readonly buyerBubble = new SpeechBubble(2.8, 6);
  /** Stonks's idle lines: "Got any wax?" between each of his CAST lines. */
  private buyerIdleLines: string[];
  private buyerLine = 0;
  private buyerLineTimer = 0;
  /** The one bubble the named cast shares (over whoever is talking). */
  readonly namedBubble = new SpeechBubble(2.5, 7);
  private speaker: Named | null = null;
  private speakerLine = 0;
  private speakerTimer = 0;
  private forced: Forced | null = null;
  /** Miné's voice from the hotel window. */
  readonly mineBubble = new SpeechBubble(2.6, 7);
  private buyerRing: THREE.Mesh;
  /** HUD-like 3D helpers (speech bubbles, the collector's ground ring): hidden for clean screenshots. */
  helperObjects(): THREE.Object3D[] {
    return [this.clerkBubble.sprite, this.buyerBubble.sprite, this.namedBubble.sprite, this.mineBubble.sprite, this.buyerRing];
  }
  private buyerObstacle: Obstacle;
  private buyerStatusTimer = 0;
  private buyerStatus: "idle" | "thinking" | "happy" | "error" = "idle";
  private time = 0;
  private frameCount = 0;
  private player = new THREE.Vector3();
  /** Crowd ids waiting for their turn on the street (front = next). */
  private queue: number[] = [];
  /** Every crowd id that has been on the street this session. */
  private seen = new Set<number>();
  private swapTimer = 0;
  private swapCursor = 0;
  private frustum = new THREE.Frustum();
  private cameraPosition = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    collision: Collision,
    private interactables: Interactables,
  ) {
    scene.add(this.clerkBubble.sprite, this.buyerBubble.sprite, this.namedBubble.sprite, this.mineBubble.sprite);
    const occluders = () => collision.occluders();
    this.clerkBubble.occluders = this.buyerBubble.occluders = this.namedBubble.occluders = this.mineBubble.occluders = occluders;
    // Miné: below her window with the tail pointing up at it, a little in front of the facade.
    // Low enough (tip ≈ 4.7 m, above the door) that the street camera, which only sees the
    // facade up to about 5–6 m, keeps the whole bubble on screen.
    this.mineBubble.sprite.center.set(0.5, 1);
    this.mineBubble.sprite.position.set(HOTEL_WINDOW.x, HOTEL_WINDOW.y - 2.9, HOTEL_WINDOW.z + 0.35);
    this.clerkBubble.sprite.position.set(COUNTER.x, SHOP_FLOOR_Y + 2.15, COUNTER.clerkZ + 0.3);
    // Gold ring marks the collector from across the street.
    this.buyerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.86, 48),
      new THREE.MeshBasicMaterial({ color: "#ffc93c", transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    this.buyerRing.rotation.x = -Math.PI / 2;
    this.buyerRing.position.set(BUYER_INTERACT.x, groundHeight(BUYER_INTERACT.x, BUYER_INTERACT.z) + 0.02, BUYER_INTERACT.z);
    this.buyerRing.renderOrder = 2;
    scene.add(this.buyerRing);
    this.buyerIdleLines = CAST.collector.lines.flatMap((line) => [BUYER_LINES.idle, line]);
    this.buyerBubble.set(BUYER_LINES.idle, { accent: COLLECTOR_ACCENT, name: CAST.collector.name });
    this.buyerObstacle = collision.add({ x: BUYER_SPOT.x, z: BUYER_SPOT.z, w: 0.6, d: 0.6, h: 0, tag: "buyer" });
    interactables.register({ id: BUYER_ID, kind: "buyer", x: BUYER_INTERACT.x, z: BUYER_INTERACT.z, radius: 1.8 });

    // The crowd: the first ids of CAST.crowd go on the street, the rest wait in the queue.
    this.queue = [...CAST.crowd];
    let slot = 0;
    PED_ROUTES.forEach((route, r) => {
      const count = WALKERS_PER_ROUTE[r] ?? 0;
      for (let k = 0; k < count; k++) {
        const id = this.nextId();
        if (id === undefined) return;
        // `along` = how far around the route (0..1) each walker starts, so they are spread
        // out rather than clumped at the corners; directions alternate.
        const along = (k + 0.35 * ((k * 7 + r * 3) % 3)) / count;
        const dir: 1 | -1 = k % 2 === 0 ? 1 : -1;
        const start = pointAlong(route.points, route.loop, along);
        const n = route.points.length;
        const character = this.spawn(id, start.x, start.z);
        // Walking forward heads for the segment's end point, backward for its start.
        const target = dir === 1 ? (start.segment + 1) % n : start.segment;
        const t = route.points[target];
        const heading = Math.atan2(t.x - start.x, t.z - start.z);
        character.root.rotation.y = heading;
        slot++;
        this.walkers.push({
          character,
          id,
          pendingDt: 0,
          slot,
          route: route.points,
          loop: route.loop,
          target,
          dir,
          // 1.1–1.5 m/s, varied but deterministic.
          speed: 1.1 + ((slot * 0.618) % 1) * 0.4,
          side: 0,
          heading,
          offset: { x: 0, z: 0 },
        });
      }
    });
    IDLE_SPOTS.forEach((spot, i) => {
      const id = this.nextId();
      if (id === undefined) return;
      const character = this.spawn(id, spot.x, spot.z);
      character.root.rotation.y = spot.heading;
      this.idlers.push({
        character,
        id,
        pendingDt: 0,
        slot: slot++,
        ...spot,
        phase: i * 1.7,
        obstacle: collision.add({ x: spot.x, z: spot.z, w: 0.5, d: 0.5, h: 0, tag: "npc" }),
      });
    });

    // The named cast at their spots.
    CAST.named.forEach((role, i) => {
      const spot = role.spot ? CAST_SPOTS[role.spot] : undefined;
      if (!role.spot || !spot) return;
      const c = createTamashi(role.id, { role: "npc", castShadow: false });
      c.pose = role.pose;
      const seated = role.pose === "sit" ? SEATED[role.spot] : undefined;
      c.root.position.set(spot.x, groundHeight(spot.x, spot.z) + (seated?.seat ?? 0), spot.z);
      c.root.rotation.y = spot.heading;
      scene.add(c.root);
      const obstacle = collision.add({ x: spot.x, z: spot.z, w: 0.55, d: 0.55, h: 0, tag: "npc" });
      this.named.push({
        character: c,
        id: role.id,
        pendingDt: 0,
        slot: slot++,
        role,
        spot: role.spot,
        phase: i * 2.3,
        chair: !!seated,
        obstacle,
        lines: role.lines.filter((l) => l !== INICIO_HOME_LINE),
      });
    });

    // The clerk behind the counter.
    this.clerk = createTamashi(CAST.cashier.id, { role: "npc", castShadow: false });
    this.clerk.root.position.set(COUNTER.x, SHOP_FLOOR_Y, COUNTER.clerkZ);
    scene.add(this.clerk.root);

    // The collector, with a tote full of records.
    const buyer = createTamashi(CAST.collector.id, { role: "npc", castShadow: false });
    buyer.root.position.set(BUYER_SPOT.x, SHOP_FLOOR_Y, BUYER_SPOT.z);
    buyer.root.rotation.y = BUYER_SPOT.heading;
    addCollectorTote(buyer);
    scene.add(buyer.root);
    this.buyer = {
      character: buyer,
      route: BUYER_EXIT,
      target: 0,
      speed: 1.5,
      heading: BUYER_SPOT.heading,
      leaving: false,
      leftAt: 0,
      gone: false,
      returning: false,
      returnTarget: 0,
      returnPath: [],
    };
  }

  private nextId(): number | undefined {
    const id = this.queue.shift();
    if (id !== undefined) this.seen.add(id);
    return id;
  }

  private spawn(id: number, x: number, z: number): TamashiCharacter {
    const c = createTamashi(id, { role: "npc", castShadow: false });
    c.root.position.set(x, groundHeight(x, z), z);
    this.scene.add(c.root);
    return c;
  }

  setCashierStatus(status: "idle" | "processing" | "success" | "error") {
    this.clerkStatus = status;
    if (status === "idle") {
      // Back to small talk (or silence) on the next update.
      this.clerkBubble.set(null);
      this.clerkLine = -1;
    } else
      this.clerkBubble.set(CASHIER_LINES[status], {
        accent: status === "success" ? "#3ccf7a" : status === "error" ? "#ff5c5c" : "#ffb35c",
        busy: status === "processing",
      });
    if (status === "success") this.clerk.cheer();
  }

  /**
   * The car was smashed: Heart says her line (whatever the player's distance), then her
   * second one if the player is still around.
   */
  reactToSmash(): void {
    const heart = this.named.find((n) => n.id === 6);
    if (!heart) return;
    this.forced = {
      who: heart,
      text: heart.role.lines[0] ?? "They just want to feel something.",
      until: this.time + FORCED_SECONDS,
      then: heart.role.lines[1] ?? "But someone needs to look out for these people.",
      nearRadius: 12,
    };
    this.showForced();
  }

  /** The exit beat: Inicio gets up and is standing beside Gamer at the hotel door, and says so. */
  sendInicioHome(): void {
    const inicio = this.named.find((n) => n.id === 74);
    if (!inicio) return;
    const c = inicio.character;
    c.pose = "stand";
    inicio.chair = false;
    inicio.spot = "home";
    c.root.position.set(HOME_COMPANION.x, groundHeight(HOME_COMPANION.x, HOME_COMPANION.z), HOME_COMPANION.z);
    c.root.rotation.y = HOME_COMPANION.heading;
    inicio.obstacle.x = HOME_COMPANION.x;
    inicio.obstacle.z = HOME_COMPANION.z;
    inicio.lines = [INICIO_HOME_LINE, ...inicio.role.lines.filter((l) => l !== INICIO_HOME_LINE)];
    this.forced = { who: inicio, text: INICIO_HOME_LINE, until: this.time + FORCED_SECONDS };
    this.showForced();
  }

  setBuyerStatus(npcId: string, status: "idle" | "thinking" | "happy" | "error") {
    if (npcId !== BUYER_ID || this.buyer.gone) return;
    const accent = status === "happy" ? "#3ccf7a" : status === "error" ? "#ff5c5c" : COLLECTOR_ACCENT;
    if (status === "idle") this.restartBuyerIdle();
    else this.buyerBubble.set(BUYER_LINES[status], { accent, busy: status === "thinking", name: CAST.collector.name });
    if (status === "happy" && this.buyerStatus !== "happy") this.buyer.character.cheer();
    this.buyerStatus = status;
    // Errors fall back to the idle line after a few seconds.
    this.buyerStatusTimer = status === "error" ? 4 : 0;
  }

  /** Holder that keeps a record in an NPC's right hand. */
  holderFor(npcId: string): Holder | null {
    if (npcId !== BUYER_ID) return null;
    return (out) => !this.buyer.gone && this.buyer.character.recordMatrix(out);
  }

  /** Back to "Got any wax?", then his lines in turn. */
  private restartBuyerIdle() {
    this.buyerLine = 0;
    this.buyerLineTimer = 0;
    this.buyerBubble.set(this.buyerIdleLines[0] ?? BUYER_LINES.idle, { accent: COLLECTOR_ACCENT, name: CAST.collector.name });
  }

  /** The collector takes the record and walks in at his door (BUYER_EXIT), then is hidden. */
  buyerLeave(npcId: string) {
    if (npcId !== BUYER_ID || this.buyer.leaving) return;
    this.buyer.leaving = true;
    this.buyer.leftAt = this.time;
    this.buyer.target = 0;
    this.buyer.character.carry = 1;
    this.buyerObstacle.enabled = false;
    this.interactables.setEnabled(BUYER_ID, false);
    this.buyerRing.visible = false;
    if (this.buyerBubble.current !== BUYER_LINES.happy) this.buyerBubble.set(BUYER_LINES.happy, { accent: "#3ccf7a", name: CAST.collector.name });
  }

  /**
   * The collector comes back for another round: out of his door (or from wherever he is
   * on the way in), empty-handed, back along BUYER_EXIT in reverse to the spot. Resolves on
   * arrival with the ring, bubble and collision restored; enabling the interactable is
   * the caller's call.
   */
  buyerReturn(npcId: string): Promise<void> {
    const b = this.buyer;
    if (npcId !== BUYER_ID || (!b.leaving && !b.gone && !b.returning)) return Promise.resolve();
    if (!b.returning) {
      // The exit route back to front: the points already passed (or all of them, from inside), then the spot.
      const passed = b.gone ? BUYER_EXIT.length - 1 : Math.max(0, b.target - 1);
      b.returnPath = [...BUYER_EXIT.slice(0, passed).reverse(), { x: BUYER_SPOT.x, z: BUYER_SPOT.z }];
      b.returnTarget = 0;
    }
    if (b.gone) {
      const inside = BUYER_EXIT[BUYER_EXIT.length - 1];
      b.character.root.position.set(inside.x, groundHeight(inside.x, inside.z), inside.z);
      b.heading = Math.PI; // facing out of the door (north)
      b.character.root.rotation.y = b.heading;
      b.character.root.visible = true;
    }
    b.leaving = false;
    b.gone = false;
    b.returning = true;
    b.character.carry = 0;
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
    const p = this.buyer.character.root.position;
    return { x: p.x, z: p.z };
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Camera) {
    this.time += dt;
    this.frameCount++;
    this.player.copy(player);
    this.updateFrustum(camera);
    for (const w of this.walkers) {
      this.walk(w, dt);
      this.animateMember(w, dt, camera);
    }
    for (const i of this.idlers) {
      this.idle(i.character, i.mode, i.phase);
      this.animateMember(i, dt, camera);
    }
    for (const n of this.named) {
      this.idle(n.character, n.role.pose === "stand" ? "chat" : "browse", n.phase);
      if (n === this.speaker) n.character.nod = Math.max(n.character.nod, 0.07);
      this.animateMember(n, dt, camera);
      if (n.chair) chairSit(n.character);
    }
    this.clerk.update(dt, camera);
    this.updateBuyer(dt, camera);
    this.updateClerkTalk(dt);
    this.updateNamedTalk(dt);
    this.mineBubble.set(
      Math.hypot(player.x - HOTEL_DOOR.interactX, player.z - HOTEL_DOOR.interactZ) < MINE_RADIUS ? MINE_LINE : null,
      { accent: MINE_ACCENT, name: MINE_NAME, tailUp: true },
    );
    this.clerkBubble.update(dt, camera);
    this.buyerBubble.update(dt, camera);
    this.namedBubble.update(dt, camera);
    this.mineBubble.update(dt, camera);
    const pulse = 1 + Math.sin(this.time * 3) * 0.08;
    this.buyerRing.scale.set(pulse, pulse, pulse);
    this.swapTimer += dt;
    if (this.swapTimer >= SWAP_EVERY) {
      this.swapTimer = 0;
      this.swapOne();
    }
  }

  // ───────────────────────── speech ─────────────────────────

  /** Jazz's small talk at the counter; a cashier status always wins. */
  private updateClerkTalk(dt: number) {
    if (this.clerkStatus !== "idle") return;
    const near = Math.hypot(this.player.x - COUNTER.interactX, this.player.z - COUNTER.interactZ) <= CLERK_TALK_RADIUS;
    const lines = CAST.cashier.lines;
    if (!near || !lines.length) {
      if (this.clerkLine !== -1) this.clerkBubble.set(null);
      this.clerkLine = -1;
      return;
    }
    if (this.clerkLine === -1) {
      this.clerkLine = 0;
      this.clerkTimer = 0;
    } else if ((this.clerkTimer += dt) >= LINE_SECONDS) {
      this.clerkTimer = 0;
      this.clerkLine = (this.clerkLine + 1) % lines.length;
    }
    this.clerkBubble.set(lines[this.clerkLine], { accent: CLERK_ACCENT, name: CAST.cashier.name });
  }

  private showForced() {
    const f = this.forced;
    if (!f) return;
    this.speaker = f.who;
    this.speakerLine = 0;
    this.speakerTimer = 0;
    this.namedBubble.set(f.text, { accent: NAMED_ACCENT, name: f.who.role.name });
  }

  /** One named bubble: a forced line, else the nearest named NPC in range (quiet near the collector). */
  private updateNamedTalk(dt: number) {
    const f = this.forced;
    if (f && this.time >= f.until) {
      const near = f.nearRadius !== undefined && f.who.character.root.position.distanceTo(this.player) < f.nearRadius;
      this.forced = f.then && near ? { who: f.who, text: f.then, until: this.time + FORCED_SECONDS } : null;
      if (this.forced) this.showForced();
      else this.speaker = null;
    }
    if (this.forced) {
      this.placeNamedBubble(this.forced.who);
      return;
    }
    let best: Named | null = null;
    const b = this.buyer;
    const nearCollector = !b.gone && Math.hypot(this.player.x - b.character.root.position.x, this.player.z - b.character.root.position.z) < COLLECTOR_QUIET_RADIUS;
    if (!nearCollector) {
      let bestD = NAMED_TALK_RADIUS;
      for (const n of this.named) {
        if (!n.lines.length) continue;
        const p = n.character.root.position;
        const d = Math.hypot(this.player.x - p.x, this.player.z - p.z);
        // A little stickiness so two neighbours don't flicker back and forth.
        if (d - (n === this.speaker ? 0.4 : 0) < bestD) {
          bestD = d - (n === this.speaker ? 0.4 : 0);
          best = n;
        }
      }
    }
    if (best !== this.speaker) {
      this.speaker = best;
      this.speakerLine = 0;
      this.speakerTimer = 0;
    } else if (best && (this.speakerTimer += dt) >= LINE_SECONDS) {
      this.speakerTimer = 0;
      this.speakerLine = (this.speakerLine + 1) % best.lines.length;
    }
    if (!best) {
      this.namedBubble.set(null);
      return;
    }
    this.namedBubble.set(best.lines[this.speakerLine], { accent: NAMED_ACCENT, name: best.role.name });
    this.placeNamedBubble(best);
  }

  /** Just above the speaker's TV, wherever its pose puts it. */
  private placeNamedBubble(n: Named) {
    const c = n.character;
    c.bone("head").getWorldPosition(HEAD);
    this.namedBubble.sprite.position.set(HEAD.x, HEAD.y + (c.height - J.headY) + 0.3, HEAD.z);
  }

  // ───────────────────────── crowd ─────────────────────────

  private updateFrustum(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    PROJ.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(PROJ);
    camera.getWorldPosition(this.cameraPosition);
  }

  private inView(c: TamashiCharacter) {
    if (!c.root.visible) return false;
    SPHERE.center.copy(c.root.position);
    SPHERE.center.y += 0.9;
    SPHERE.radius = 1.3;
    return this.frustum.intersectsSphere(SPHERE);
  }

  /** Near and on screen: every frame. Otherwise every 4th frame (with the summed dt). */
  private animateMember(m: Member, dt: number, camera: THREE.Camera) {
    m.pendingDt += dt;
    const near = m.character.root.position.distanceTo(this.cameraPosition) < FULL_RATE_DISTANCE && this.inView(m.character);
    if (near || (this.frameCount + m.slot) % 4 === 0) {
      m.character.update(m.pendingDt, camera);
      m.pendingDt = 0;
    }
  }

  /** Swap the next crowd member nobody is looking at (off screen or far) to the next unused cast id. */
  private swapOne() {
    const members: Member[] = [...this.walkers, ...this.idlers];
    if (!members.length || !this.queue.length) return;
    for (let k = 0; k < members.length; k++) {
      const index = (this.swapCursor + k) % members.length;
      const m = members[index];
      const far = m.character.root.position.distanceTo(this.cameraPosition) > SWAP_DISTANCE;
      if (!far && this.inView(m.character)) continue;
      this.swapCursor = index + 1;
      const next = this.nextId()!;
      this.queue.push(m.id);
      const old = m.character;
      const c = createTamashi(next, { role: "npc", castShadow: false });
      c.root.position.copy(old.root.position);
      c.root.rotation.copy(old.root.rotation);
      c.model.position.copy(old.model.position);
      c.speed = old.speed;
      old.root.removeFromParent();
      old.dispose();
      this.scene.add(c.root);
      m.character = c;
      m.id = next;
      m.pendingDt = 0;
      return;
    }
  }

  /** For QA: crowd members on screen now, distinct crowd ids shown so far, and the named cast roster. */
  crowdStats(camera: THREE.Camera) {
    this.updateFrustum(camera);
    const members: Member[] = [...this.walkers, ...this.idlers];
    return {
      crowd: members.length,
      walkers: this.walkers.length,
      idlers: this.idlers.length,
      onScreen: members.filter((m) => this.inView(m.character)).length,
      distinctSeen: this.seen.size,
      castSize: CAST.crowd.length,
      queued: this.queue.length,
      showing: members.map((m) => m.id),
      named: this.named.map((n) => ({ id: n.id, name: n.role.name, spot: n.spot, onScreen: this.inView(n.character) })),
      /** Which bubbles are up now (QA): text, and the world position of the named one. */
      talking: {
        named: this.namedBubble.visible ? { who: this.speaker?.role.name ?? null, text: this.namedBubble.current, at: this.namedBubble.sprite.position.toArray(), opacity: this.namedBubble.opacity, camera: this.cameraPosition.toArray() } : null,
        clerk: this.clerkBubble.visible ? this.clerkBubble.current : null,
        collector: this.buyerBubble.visible ? this.buyerBubble.current : null,
        mine: this.mineBubble.visible ? this.mineBubble.current : null,
      },
    };
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
    w.offset.x = ox;
    w.offset.z = oz;
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
    w.character.speed = speed > 0.05 ? speed : 0;
  }

  private advance(w: Walker) {
    const n = w.route.length;
    if (w.loop) w.target = (w.target + w.dir + n) % n;
    else {
      if (w.target + w.dir >= n || w.target + w.dir < 0) w.dir = (w.dir * -1) as 1 | -1;
      w.target += w.dir;
    }
  }

  /** Idle body language: chatting pairs take turns talking; browsers and window-shoppers tilt their heads. */
  private idle(c: TamashiCharacter, mode: IdleMode, phase: number) {
    const t = this.time + phase;
    c.speed = 0;
    if (mode === "chat") {
      const talking = Math.floor(t / 4) % 2 === 0;
      c.nod = talking ? 0.08 : 0.03;
      c.tilt = Math.sin(t * 0.6) * (talking ? 0.05 : 0.12);
    } else {
      c.nod = 0;
      c.tilt = Math.sin(t * 0.35) * 0.16;
    }
  }

  // ───────────────────────── the collector ─────────────────────────

  private updateBuyer(dt: number, camera: THREE.Camera) {
    const b = this.buyer;
    const c = b.character;
    const root = c.root;
    const head = root.position;
    if (b.gone) return;
    if (this.buyerStatusTimer > 0) {
      this.buyerStatusTimer -= dt;
      if (this.buyerStatusTimer <= 0) {
        this.restartBuyerIdle();
        this.buyerStatus = "idle";
      }
    } else if (this.buyerStatus === "idle" && !b.leaving && !b.returning && (this.buyerLineTimer += dt) >= LINE_SECONDS) {
      this.buyerLineTimer = 0;
      this.buyerLine = (this.buyerLine + 1) % this.buyerIdleLines.length;
      this.buyerBubble.set(this.buyerIdleLines[this.buyerLine], { accent: COLLECTOR_ACCENT, name: CAST.collector.name });
    }
    c.speed = 0;
    c.nod = 0;
    c.tilt = 0;
    c.waving = false;
    if (b.returning) {
      const path = b.returnPath;
      const t = path[b.returnTarget];
      const dx = t.x - head.x,
        dz = t.z - head.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3 && b.returnTarget < path.length - 1) b.returnTarget++;
      if (dist > 0.05) {
        const step = Math.min(dist, b.speed * dt);
        head.x += (dx / dist) * step;
        head.z += (dz / dist) * step;
        b.heading += angleDelta(b.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 5);
        head.y = groundHeight(head.x, head.z);
        root.rotation.y = b.heading;
        c.speed = b.speed;
      } else if (b.returnTarget === path.length - 1) {
        // Back on the spot: same as a fresh spawn.
        b.returning = false;
        head.set(BUYER_SPOT.x, SHOP_FLOOR_Y, BUYER_SPOT.z);
        this.buyerObstacle.enabled = true;
        this.buyerRing.visible = true;
        this.buyerStatus = "idle";
        this.buyerStatusTimer = 0;
        b.heading = BUYER_SPOT.heading;
        root.rotation.y = b.heading;
        this.restartBuyerIdle();
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
        c.speed = b.speed;
      }
      root.rotation.y = b.heading;
      // A happy little bounce in their step.
      head.y = groundHeight(head.x, head.z) + Math.abs(Math.sin(elapsed * 6)) * 0.04;
      if (elapsed > 4) this.buyerBubble.set(null);
      // In at the door (the last point is just inside it): gone. 20 s is a safety net.
      if ((b.target === b.route.length - 1 && dist <= 0.05) || elapsed > 20) {
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
      this.collectorBodyLanguage(c, Math.hypot(px, pz));
    }
    c.update(dt, camera);
    this.buyerBubble.sprite.position.set(head.x, head.y + 2.25, head.z);
  }

  /**
   * The collector reads as an NPC who wants something: nods to the music, and every few
   * seconds waves the player over when they are in view. Thinking = head tilted;
   * happy = big nod (plus the cheer from setBuyerStatus).
   */
  private collectorBodyLanguage(c: TamashiCharacter, playerDistance: number) {
    const status = this.buyerStatus;
    c.nod = status === "thinking" ? 0.06 : status === "happy" ? 0.22 : 0.12;
    c.tilt = status === "thinking" ? 0.22 : 0;
    // Wave for 1.6 s every 4.5 s.
    c.waving = status === "idle" && playerDistance < 16 && this.time % 4.5 < 1.6;
  }

  positions() {
    const list: { x: number; z: number }[] = this.walkers.map((w) => {
      const p = w.character.root.position;
      return { x: p.x + w.offset.x, z: p.z + w.offset.z };
    });
    for (const i of this.idlers) list.push({ x: i.x, z: i.z });
    for (const n of this.named) list.push({ x: n.character.root.position.x, z: n.character.root.position.z });
    if (!this.buyer.gone) list.push(this.buyerPosition);
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

/** Geometry part painted with one flat vertex colour (so the whole tote is one draw call). */
function painted(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const geometry = g.index ? g.toNonIndexed() : g;
  geometry.deleteAttribute("uv");
  const c = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const TOTE_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
let toteGeometry: THREE.BufferGeometry | null = null;

/**
 * A canvas tote full of records on the collector's left side, hung from the chest joint
 * (bone axes = body axes: +x is the character's left, +z forward). One draw call.
 */
function addCollectorTote(c: TamashiCharacter) {
  if (!toteGeometry) {
    const parts = [
      painted(new THREE.BoxGeometry(0.07, 0.3, 0.3).translate(0.3, -0.42, -0.02), "#5f6e3f"),
      painted(new THREE.BoxGeometry(0.025, 0.36, 0.035).translate(0.27, -0.12, 0.06), "#3f4a2a"),
      painted(new THREE.BoxGeometry(0.025, 0.36, 0.035).translate(0.27, -0.12, -0.1), "#3f4a2a"),
    ];
    ["#ff4f7b", "#3ad1ff", "#ffd23c"].forEach((color, i) => {
      parts.push(painted(new THREE.BoxGeometry(0.012, 0.26, 0.26).rotateX((i - 1) * 0.15).translate(0.285 + i * 0.012, -0.3 + i * 0.012, -0.02 + (i - 1) * 0.035), color));
    });
    toteGeometry = mergeGeometries(parts);
  }
  const mesh = new THREE.Mesh(toteGeometry, TOTE_MATERIAL);
  mesh.name = "collector-tote";
  mesh.castShadow = false;
  c.bone("chest").add(mesh);
}

/** Miné's line from the hotel window (her CAST line; she has no body). */
const MINE = CAST.named.find((r) => r.id === 57);
const MINE_LINE = MINE?.lines[0] ?? "Ka-Gamer... home before dark!";
const MINE_NAME = MINE?.name ?? "Miné";

/**
 * Sitting on a seat (curb, bench) rather than the ground: thighs level, shins hanging
 * straight down. Applied after the rig's update over its ground-sit pose (absolute
 * values, so a skipped rig update does not accumulate).
 */
function chairSit(c: TamashiCharacter) {
  c.bone("thighL").rotation.x = -1.57;
  c.bone("thighR").rotation.x = -1.57;
  c.bone("shinL").rotation.x = 1.5;
  c.bone("shinR").rotation.x = 1.5;
  c.bone("footL").rotation.x = 0.05;
  c.bone("footR").rotation.x = 0.05;
}

const HEAD = new THREE.Vector3();

const PROJ = new THREE.Matrix4();
const SPHERE = new THREE.Sphere();
