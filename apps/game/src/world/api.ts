/**
 * Contract between the 3D world (src/world/*) and the game layer (src/game/*, src/ui/*).
 *
 * The world knows how to draw and animate things and reports what the player is
 * near. It knows nothing about money, wallets, chains or menus. The game controller
 * decides what an interaction means and tells the world what to show.
 */

/** Everything the player can press E on. */
export type InteractableKind =
  | "record" // a featured record in a genre section of the shop
  | "deck" // the listening station turntable
  | "cashier" // shop counter / clerk NPC
  | "car" // a parked, smashable car
  | "buyer" // the collector NPC on the street
  | "atm" // the FakeUSD ATM in TriMart's vestibule, next door to the shop
  | "home"; // the hotel's side door: "Head home with Inicio" (exit beat; enabled after a sale)

export interface Interactable {
  /** Unique id, e.g. "record:low-tide-tapes", "deck", "cashier", "car:0", "buyer:collector", "atm", "home". */
  id: string;
  kind: InteractableKind;
  /** World position (x, z on the ground plane) used for proximity. */
  x: number;
  z: number;
  /** Proximity radius in metres within which the prompt appears. */
  radius: number;
  /** ShopRecord.id for kind "record". */
  recordId?: string;
  /** Disabled interactables never become "near" (e.g. a smashed car, a buyer who left). */
  enabled: boolean;
}

/** What a featured record in the shop needs to be drawn. Built from ShopRecord. */
export interface WorldRecord {
  id: string;
  title: string;
  artist: string;
  /** In-world section sign text, e.g. "HIP HOP". */
  section: string;
  coverUrl: string;
  palette: string[];
}

/** Where a record's physical object currently is. */
export type RecordPlace = "shelf" | "hand" | "deck" | "npc" | "hidden";

export type Zone = "street" | "shop";

/** A snapshot for drawing the minimap (world units, x right / z down on the map). */
export interface MapSnapshot {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  player: { x: number; z: number; heading: number };
  /** Static: computed once, the UI may cache it. */
  roads: Rect[];
  buildings: Rect[];
  shop: Rect;
  /** Dynamic markers. */
  cars: { x: number; z: number }[];
  pedestrians: { x: number; z: number }[];
  points: { id: string; kind: InteractableKind; x: number; z: number; enabled: boolean }[];
  waypoint: { x: number; z: number } | null;
}
export interface Rect {
  x: number; // centre
  z: number; // centre
  w: number; // size along x
  d: number; // size along z
}

/** Methods the game layer calls on the world. Implemented by GameWorld in world.ts. */
export interface WorldApi {
  /** Place the shop's featured records into their genre sections (call once after catalog loads). */
  setShopRecords(records: WorldRecord[]): void;
  /** Move a record's single physical object (one object per record; never duplicated). */
  setRecordPlace(recordId: string, place: RecordPlace, npcId?: string): void;
  /** Spin the platter / animate the tonearm. */
  setDeckPlaying(playing: boolean): void;
  /** Freeze player input while a menu is open. */
  setBlocked(blocked: boolean): void;
  /**
   * Allow or forbid Space-jumping (default true). The controller turns it off while a
   * chain transaction is pending. Menus (setBlocked) and the smash swing already forbid it.
   */
  setJumpAllowed(allowed: boolean): void;
  /** Invisible wall in the shop doorway (used to stop the player leaving with unpaid stock). */
  setExitBlocked(blocked: boolean): void;
  setInteractableEnabled(id: string, enabled: boolean): void;
  /** Floating GTA-style marker above a target (and on the minimap). null hides it. */
  setWaypoint(target: { x: number; z: number } | null): void;
  /** Cashier speech bubble / spinner while a transaction is in flight. null clears. */
  setCashierStatus(status: "idle" | "processing" | "success" | "error"): void;
  /** Swing the held record at a car: glass particles, dent, hazard lights, camera shake. Resolves when the swing lands. */
  smashCar(carId: string): Promise<void>;
  /** Collector reaction while the sale settles, then (on success) takes the record and walks away. */
  setBuyerStatus(npcId: string, status: "idle" | "thinking" | "happy" | "error"): void;
  buyerLeave(npcId: string, recordId: string): void;
  /**
   * Bring a buyer who left back: they walk back to their spot (empty-handed) and say
   * their idle line again. Resolves when they are standing there; the interactable
   * stays disabled until the caller re-enables it.
   */
  buyerReturn(npcId: string): Promise<void>;
  /**
   * The exit beat (bible §7.4): the boom from the facility. Camera shake, a two-second
   * brown-out with the lights stuttering back, Inicio now standing by the hotel door
   * beside Gamer. Resolves when the lights are back. Visual only: the caller plays the
   * sound and shows the title card.
   */
  homeBeat(): Promise<void>;
  /**
   * Heading convention (teleport, getPlayer, onMove, mapSnapshot): radians about +y,
   * 0 = facing +z (south, down on the minimap), π/2 = facing +x (east), π = facing north.
   * Forward vector = (sin heading, cos heading).
   */
  teleport(x: number, z: number, headingRad?: number): void;
  getPlayer(): { x: number; z: number; heading: number; zone: Zone };
  /** World position of an interactable (for waypoints). */
  getInteractable(id: string): Interactable | undefined;
  mapSnapshot(): MapSnapshot;
  /** Listener position for positional audio is pushed via onMove. */

  // Events (assign callbacks).
  onNear: (target: Interactable | null) => void;
  /** E pressed (or interaction button) while not blocked. */
  onInteract: (target: Interactable | null) => void;
  onMove: (x: number, z: number, heading: number) => void;
  onZoneChange: (zone: Zone) => void;
  /** Player walked into the blocked doorway. */
  onExitBlockedBump: () => void;
}

/** Fixed world positions the audio layer needs (deck for positional preview). */
export interface WorldAnchors {
  deck: { x: number; z: number };
  shopDoor: { x: number; z: number };
  /** The hotel's side door (exit beat waypoint). */
  homeDoor: { x: number; z: number };
  /** Fixed ambience sources the audio layer mixes by distance (layout.ts SOUND_SOURCES). */
  sounds: { fire: { x: number; z: number }; diner: { x: number; z: number }; band: { x: number; z: number }; vending: { x: number; z: number } };
}
