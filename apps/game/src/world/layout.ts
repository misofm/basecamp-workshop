/**
 * Street layout: every fixed coordinate of the level, as plain data.
 *
 * The level is one back street inside Nozomi's three powered blocks, at dusk on the
 * afternoon of Book 3.0 (world bible §7.3): the old hotel (Order's HQ, Gamer's home) at
 * the WEST end, the back of the casino closing the EAST end, Saisei Records in the middle
 * of the north side, TriMart (with the ATM in its vestibule) next door, and the diner,
 * Stonks's walk-up and the scorched block across the street. Past the barricade at the
 * west end the dead street runs on into the dark toward the city's edge and the sunset.
 *
 * Owns: world bounds, the road/sidewalk/building rectangles, the shop footprint and
 * doorway, the ATM, the cars, the collector's table, the hotel door (exit beat), props
 * anchors, pedestrian routes and the fixed positions of the named cast (CAST_SPOTS).
 * Must not: import Three.js or touch the scene. Other world modules read these numbers so
 * the minimap, collision, NPCs and rendering always agree.
 *
 * Axes: x = east (right on the minimap), z = south (down on the minimap), y = up.
 * 1 unit = 1 m. Heading: radians about +y, 0 = facing +z (south), π/2 = facing +x (east).
 * The shop faces south onto the street; its door is at (0, 0).
 *
 *   z -14 ┌hotel─────┐┌fitting──┐┌SAISEI──────┐┌trimart┐┌posters┐alley┌c┐┌─────────┐
 *         │  door    ││ center  ││  door(0,0) ││ ATM▯  ││vending│     │n││         │
 *   z   0 └──────────┘└─────────┘└────────────┘└───────┘└───────┘     └─┘│ CASINO  │
 *         north sidewalk  z 0 → 3   (utility poles, festival bulbs overhead)│ (back,  │
 *   ▓ barricade x -40     ROAD z 3 → 10  (dead cars; the Triangle sedan)    │ fire    │
 *         south sidewalk  z 10 → 13                          end sidewalk  │ exit)   │
 *   z  13 ┌diner─────────┐alley┌stonks walk-up┐┌scorched──┐┌shut┐ rubble ┌c┐│         │
 *         │ EAT Here     │     │ BUYING table ││          ││    │  lot   │s│└─────────┘
 *   z  25 └──────────────┘     └──────────────┘└──────────┘└────┘        └─┘
 *       x -40          -21  -17.5             -3          13    21      29 34
 */
import type { Rect } from "./api";

/** Walkable bounds of the level (74 × 34 m incl. the two alleys and the rubble lot). */
export const BOUNDS = { minX: -40, maxX: 34, minZ: -14.5, maxZ: 19.5 };

/** Sidewalks, the end sidewalk, alleys and the shop floor sit this high above the asphalt. */
export const CURB_HEIGHT = 0.15;

/** North building line (shop fronts), road edges and the south building line (z). */
export const STREET = {
  northFront: 0,
  roadNorth: 3,
  roadSouth: 10,
  southFront: 13,
  /** The road stops here; x 31 → 34 is the end sidewalk in front of the casino. */
  roadEast: 31,
  /** The casino's west facade (closes the street). */
  casinoFront: 34,
  /** The west barricade (end of the walkable street; the dead street continues beyond). */
  barricadeX: -40,
};

/**
 * The one street. Its asphalt continues west past the barricade (visual only, out of
 * bounds) toward the city's dark edge; within bounds it ends at the end sidewalk.
 */
export const MAIN_ROAD: Rect = { x: -4.5, z: 6.5, w: 71, d: 7 }; // x -40 → 31, z 3 → 10
export const ROADS: Rect[] = [MAIN_ROAD];

/**
 * Lane centre lines. Japan drives on the left: eastbound keeps to the north half,
 * westbound to the south half. Nothing drives any more (self-navigation is off and
 * manual driving is illegal), so these only place the dead cars.
 */
export const LANES = {
  eastbound: 5.2,
  westbound: 7.8,
  parkingNorth: 4.15, // z of a car parked at the north curb (facing east)
  parkingSouth: 8.85, // z of a car parked at the south curb (facing west)
};

/** The record shop building (outer walls). Interior is x -9 → 9, z -14 → -0.3. */
export const SHOP: Rect = { x: 0, z: -7.15, w: 18.6, d: 14.3 };
export const SHOP_INTERIOR = { minX: -9, maxX: 9, minZ: -14, maxZ: -0.3 };
export const SHOP_FLOOR_Y = CURB_HEIGHT;
/** Doorway gap in the front wall (x range) and the wall's z extent. */
export const DOOR = { x: 0, z: 0, halfWidth: 1.25, wallMinZ: -0.3, wallMaxZ: 0 };

export type BuildingKind =
  | "hotel"
  | "fitting"
  | "trimart"
  | "posters"
  | "alley-back"
  | "casino"
  | "casino-wing"
  | "diner"
  | "stonks"
  | "scorched"
  | "shuttered"
  | "lot-back";

/** Buildings: rect + height + base tint + what it is (city.ts styles each kind). The shop is separate. */
export interface BuildingSpec extends Rect {
  id: string;
  kind: BuildingKind;
  h: number;
  tint: string;
  /** Which way its street face looks: "south" (north side of the street), "north", or "west" (the casino). */
  faces: "south" | "north" | "west";
  /** An open recess in the street face (walkable, not solid): TriMart's ATM vestibule. */
  cutout?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export const BUILDINGS: BuildingSpec[] = [
  // ── North side (fronts at z 0, facing south) ──
  { id: "hotel", kind: "hotel", x: -31, z: -7, w: 18, d: 14, h: 15, tint: "#8a7766", faces: "south" },
  { id: "fitting", kind: "fitting", x: -15.65, z: -7, w: 12.7, d: 14, h: 8.5, tint: "#9aa1a0", faces: "south" },
  {
    id: "trimart",
    kind: "trimart",
    x: 14.65,
    z: -7,
    w: 10.7,
    d: 14,
    h: 7.5,
    tint: "#b9b4a6",
    faces: "south",
    cutout: { minX: 10.2, maxX: 13.8, minZ: -2.6, maxZ: 0 },
  },
  { id: "posters", kind: "posters", x: 23, z: -7, w: 6, d: 14, h: 8, tint: "#7d6a5e", faces: "south" },
  // The north alley (x 26 → 29) is open for 7 m, then a wall.
  { id: "alley-n-back", kind: "alley-back", x: 27.5, z: -10.5, w: 3, d: 7, h: 5, tint: "#5e4f47", faces: "south" },
  { id: "casino-n", kind: "casino-wing", x: 31.5, z: -7, w: 5, d: 14, h: 14, tint: "#d8d2c4", faces: "south" },
  // ── East end: the back of the casino (white tile, chestnut trim), facing west down the street ──
  { id: "casino", kind: "casino", x: 43, z: 2.5, w: 18, d: 37, h: 18, tint: "#e2dccd", faces: "west" },
  // ── South side (fronts at z 13, facing north) ──
  { id: "diner", kind: "diner", x: -30.5, z: 19, w: 19, d: 12, h: 6.5, tint: "#9b3a35", faces: "north" },
  // The diner alley (x -21 → -17.5) is open for 6 m, then a wall.
  { id: "alley-s-back", kind: "alley-back", x: -19.25, z: 22.25, w: 3.5, d: 5.5, h: 5, tint: "#5e4f47", faces: "north" },
  { id: "stonks", kind: "stonks", x: -10.25, z: 19, w: 14.5, d: 12, h: 10.5, tint: "#8c7f73", faces: "north" },
  { id: "scorched", kind: "scorched", x: 5, z: 19, w: 16, d: 12, h: 11, tint: "#6f655c", faces: "north" },
  { id: "shuttered", kind: "shuttered", x: 17, z: 19, w: 8, d: 12, h: 8, tint: "#8d8a7f", faces: "north" },
  // The rubble lot (x 21 → 29) is open to a chain-link fence at z 19.5; behind it, a low wall.
  { id: "lot-back", kind: "lot-back", x: 25, z: 22.25, w: 8, d: 5.5, h: 3, tint: "#6b6058", faces: "north" },
  { id: "casino-s", kind: "casino-wing", x: 31.5, z: 19, w: 5, d: 12, h: 14, tint: "#d8d2c4", faces: "north" },
];

/** Solid footprints of a building (its rect minus any cutout), for collision. */
export function buildingSolids(b: BuildingSpec): Rect[] {
  const c = b.cutout;
  if (!c) return [{ x: b.x, z: b.z, w: b.w, d: b.d }];
  const minX = b.x - b.w / 2,
    maxX = b.x + b.w / 2,
    minZ = b.z - b.d / 2,
    maxZ = b.z + b.d / 2;
  const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
  const out = [rect(minX, minZ, maxX, c.minZ)];
  if (c.minX > minX) out.push(rect(minX, c.minZ, c.minX, maxZ));
  if (c.maxX < maxX) out.push(rect(c.maxX, c.minZ, maxX, maxZ));
  return out;
}

/** Player spawn: just outside the hotel's side door (west end), looking east down the street. */
export const SPAWN = { x: -24.6, z: 2.0, heading: Math.PI / 2 };

/**
 * The hotel's side door: Gamer's way home. The "home" interactable (exit beat: "Head home
 * with Inicio") sits here and is only enabled after the player has sold a record.
 * WINDOW is Miné's lit window above it (she calls from it; voice only).
 */
export const HOTEL_DOOR = { x: -26.5, z: 0, interactX: -26.5, interactZ: 1.1, radius: 1.6 };
export const HOTEL_WINDOW = { x: -26.5, y: 7.6, z: 0.05 };
/** Where Inicio stands once he has followed Gamer home (exit beat). */
export const HOME_COMPANION = { x: -25.4, z: 1.2, heading: -2.6 };

/** Shop stations (all on the shop floor). */
export const DECK = { x: -5.5, z: -12.9, interactX: -5.5, interactZ: -11.5 };
export const COUNTER = { x: 5.5, z: -12.6, interactX: 5.5, interactZ: -11.2, clerkZ: -13.5 };

/**
 * The ATM: chunky beige casing, CRT screen, steel keypad, against the back wall of
 * TriMart's open vestibule (BUILDINGS trimart.cutout), facing the street (+z).
 * `x, z` is the cabinet centre; the player stands at `interactX, interactZ`.
 */
export const ATM = { x: 12.0, z: -2.25, w: 0.84, d: 0.6, interactX: 12.0, interactZ: -1.15 };
/** TriMart's cracked glass door (looted, shut) beside the vestibule. */
export const TRIMART_DOOR = { x: 16.5, z: 0 };

/**
 * The smashable car: a dead Triangle self-driving sedan at the south curb across from the
 * shop, nose west (x, z = centre). Its id is "car:0". The player swings from the
 * sidewalk side (south), so the interact point is south of the car.
 */
export const PARKED_CARS = [{ x: 4.5, z: LANES.parkingSouth, heading: -Math.PI / 2 }];
/** The sedan's interact point (on the south sidewalk, facing north at the car). */
export const SEDAN_INTERACT = { x: 4.5, z: 10.75 };

/**
 * Dead cars (static set dressing, not smashable): dusty, flat tyres. `burned` = a
 * charred shell from Chaos's fires.
 */
export const DEAD_CARS: { x: number; z: number; heading: number; burned?: boolean }[] = [
  { x: -17.5, z: LANES.parkingNorth, heading: Math.PI / 2 },
  { x: -33.5, z: LANES.parkingSouth, heading: -Math.PI / 2 },
  { x: 18.5, z: 6.3, heading: Math.PI / 2 + 0.38 }, // abandoned askew mid-road
  { x: 25.5, z: LANES.parkingSouth, heading: -Math.PI / 2 + 0.08, burned: true },
];

/**
 * Stonks's walk-up (south side): he stands on his stoop behind a folding "買取 / BUYING"
 * table, facing the street (north). The player talks to him from the sidewalk.
 */
export const BUYER_SPOT = { x: -8, z: 12.45, heading: Math.PI };
export const BUYER_TABLE = { x: -8, z: 11.75, w: 1.7, d: 0.7 };
export const BUYER_INTERACT = { x: -8, z: 10.7 };
/** After a sale Stonks takes the record inside: along his stoop and in at his door. */
export const BUYER_EXIT = [
  { x: -9.3, z: 12.55 },
  { x: -10.6, z: 12.6 },
  { x: -10.6, z: 13.8 },
];
/** His front door (walk-up stairs) on the facade. */
export const STONKS_DOOR = { x: -10.6, z: 13 };

/** The diner's front door (south side) and its kitchen door in the alley (on the diner's east wall). */
export const DINER_DOOR = { x: -27, z: 13 };
export const DINER_KITCHEN_DOOR = { x: -21, z: 16.4 };
/** Itamae's knife, lodged in a brick at head height on the alley wall. */
export const KNIFE_IN_BRICK = { x: -21, y: 1.75, z: 14.7 };

/** The casino's fire exit (on its west face, at the end of the street) and the smoldering roof corner. */
export const CASINO_FIRE_DOOR = { x: 34, z: 6.5 };
export const ROOF_FIRE = { x: 37.5, y: 18.2, z: -6.5 };

/** Vine's fist dent in the concrete by the hotel door (canon 2.5). */
export const VINE_DENT = { x: -30.1, z: 2.0 };

/** The dead hydrant (Mizuto's buckets around it, puddles). */
export const HYDRANT = { x: 32.9, z: 2.6 };

/** Vending machines (sold out, humming) in front of the poster wall, facing south. */
export const VENDING = [
  { x: 21.3, z: 0.48 },
  { x: 22.55, z: 0.48 },
  { x: 23.8, z: 0.48 },
];
export const VENDING_SIZE = { w: 1.05, d: 0.85, h: 1.85 };

/** The fans' bench on the south sidewalk in front of the rubble lot, facing the band. */
export const FAN_BENCH = { x: 25, z: 12.4, w: 1.9, d: 0.55 };

/**
 * Utility poles (Japanese street poles with crossarms, a transformer here and there and
 * tangled cables) along both curbs. `lamp` = carries the one flickering street lamp;
 * `camera` = the dead surveillance camera on a bracket.
 */
export const UTILITY_POLES: { x: number; z: number; lamp?: boolean; camera?: boolean; transformer?: boolean }[] = [
  { x: -35, z: 2.85, transformer: true },
  { x: -21.4, z: 2.85, camera: true },
  { x: -9.9, z: 2.85 },
  { x: 8.9, z: 2.85, transformer: true },
  { x: 19.6, z: 2.85 },
  { x: 29.6, z: 2.85 },
  { x: -37, z: 10.15 },
  { x: -23.5, z: 10.15, lamp: true },
  { x: -3.4, z: 10.15, transformer: true },
  { x: 12.4, z: 10.15 },
  { x: 21.3, z: 10.15 },
];
/** The street sign with a small box sitting on top (canon 2.2), at the north alley mouth. */
export const STREET_SIGN = { x: 26.35, z: 2.6 };

/** Festival bulbs: wires zig-zag across the street between the facades, this high (m). */
export const FESTIVAL = { minX: -25, maxX: 31, height: 6.4, sag: 0.9 };

/** Fixed audio sources the ambience mixes by distance (controller → audio). */
export const SOUND_SOURCES = {
  fire: { x: 36, z: -4 },
  diner: { x: DINER_DOOR.x, z: 12.4 },
  band: { x: 31.3, z: 6.1 },
  vending: { x: 22.55, z: 1.2 },
};

/**
 * Where the named story characters (src/tamashi/cast.ts, `spot` keys) stand, sit or crouch
 * (world bible §7.9). Heading: radians, 0 = facing +z (south).
 * Kept clear of the walker routes, interactables (records, deck, counter, ATM, the sedan,
 * Stonks, the hotel door), the props and the walk from the spawn to the shop door.
 */
export const CAST_SPOTS: Record<string, { x: number; z: number; heading: number }> = {
  // Inside the shop: crouched just east of the listening deck's right speaker, facing the
  // deck (2.9 m from its interact point, outside its 1.6 m radius).
  inicio: { x: -2.8, z: -12.3, heading: -1.79 },
  // The band, sitting on the end curb in front of the casino's fire exit, looking west
  // down the street into the sunset, sharing Disco's sake.
  band1: { x: 31.35, z: 4.7, heading: -Math.PI / 2 - 0.15 },
  band2: { x: 31.35, z: 5.75, heading: -Math.PI / 2 - 0.05 },
  band3: { x: 31.35, z: 6.8, heading: -Math.PI / 2 + 0.05 },
  band4: { x: 31.35, z: 7.85, heading: -Math.PI / 2 + 0.15 },
  // Kasimir and Natsuki on the bench across from the band (FAN_BENCH), whispering.
  fan1: { x: 24.5, z: 12.4, heading: Math.PI - 0.35 },
  fan2: { x: 25.5, z: 12.4, heading: Math.PI - 0.6 },
  // Mizuto and Heart sitting against the casino wing's wall by the dead hydrant.
  casinoWall1: { x: 30.4, z: 0.55, heading: 0.1 },
  casinoWall2: { x: 31.5, z: 0.55, heading: -0.1 },
  // Shimo crossing to the casino fire door with a med kit.
  casinoDoor: { x: 33.0, z: 9.3, heading: Math.PI / 2 - 0.5 },
  // Noir and Itamae in the diner alley.
  alley1: { x: -19.9, z: 15.5, heading: Math.PI / 2 },
  alley2: { x: -18.75, z: 15.5, heading: -Math.PI / 2 },
  // The waitress beside the diner door.
  dinerDoor: { x: -25.6, z: 12.5, heading: Math.PI },
  // The tableau at the hotel front (west of the spawn): Kasumi kneeling by Vine, who sits
  // by her dent; Birdcage and Hero standing by.
  hotel1: { x: -29.3, z: 1.55, heading: -2.39 },
  hotel2: { x: -30.0, z: 0.75, heading: 0.25 },
  hotel3: { x: -31.0, z: 2.1, heading: 2.2 },
  hotel4: { x: -31.5, z: 0.95, heading: 1.6 },
};

/**
 * Pedestrian routes (closed loops or ping-pong lines), on the sidewalks and across the
 * dead road. Few people: the living population is tiny (bible §5.6).
 */
export const PED_ROUTES: { points: { x: number; z: number }[]; loop: boolean }[] = [
  // North sidewalk, past the shop and TriMart (east of the hotel tableau and the spawn).
  { loop: false, points: [{ x: -23, z: 2.3 }, { x: 28, z: 2.3 }] },
  // South sidewalk, from the diner past Stonks to the shuttered shop.
  { loop: false, points: [{ x: -37, z: 10.75 }, { x: 20, z: 10.75 }] },
  // A loop across the dead road.
  {
    loop: true,
    points: [
      { x: -14, z: 2.3 },
      { x: -14, z: 10.75 },
      { x: 14, z: 10.75 },
      { x: 14, z: 2.3 },
    ],
  },
];

export function inRect(r: Rect, x: number, z: number, pad = 0) {
  return Math.abs(x - r.x) <= r.w / 2 + pad && Math.abs(z - r.z) <= r.d / 2 + pad;
}
export function onRoad(x: number, z: number) {
  return ROADS.some((r) => inRect(r, x, z));
}
export function inShop(x: number, z: number) {
  const s = SHOP_INTERIOR;
  return x > s.minX && x < s.maxX && z > s.minZ && z < DOOR.wallMinZ + 0.05;
}
/** Ground height for anything walking: asphalt is 0, sidewalks and the shop floor are raised. */
export function groundHeight(x: number, z: number) {
  return onRoad(x, z) ? 0 : CURB_HEIGHT;
}
