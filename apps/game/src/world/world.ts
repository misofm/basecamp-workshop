/**
 * GameWorld: the 3D world behind the WorldApi contract.
 *
 * Owns: the renderer, scene, lights, post-processing (bloom, FXAA, film grain),
 * adaptive quality (render scale / bloom drop on slow GPUs; `?quality=low`, or any
 * automated browser, starts at the bottom: lowest scale, no bloom, low Tamashi detail), the frame loop, and the
 * wiring between subsystems (city, shop, ATM, traffic, parked cars, NPCs, player, records,
 * interactables, waypoint). Translates WorldApi calls into subsystem calls and fires
 * the WorldApi events (onNear, onInteract, onMove, onZoneChange, onExitBlockedBump).
 * Must not: know about money, wallets, chains, menus or HUD; it never touches the DOM
 * beyond its own canvas.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Interactable, MapSnapshot, RecordPlace, WorldAnchors, WorldApi, WorldRecord, Zone } from "./api";
import { Collision } from "./collision";
import { Interactables } from "./interactables";
import { City } from "./city";
import { Shop } from "./shop";
import { Traffic } from "./traffic";
import { ParkedCars } from "./cars";
import { BUYER_ID, Npcs } from "./npcs";
import { Player } from "./player";
import { RecordItems } from "./record-item";
import { Waypoint } from "./waypoint";
import { Atm } from "./atm";
import { setTamashiQuality } from "../tamashi/character";
import { BOUNDS, BUILDINGS, COUNTER, DECK, DOOR, ROADS, SHOP, SPAWN, groundHeight, inShop } from "./layout";

const EXIT_BUMP_THROTTLE_MS = 1500;
/** Adaptive quality never goes below this render scale (pixel ratio). */
const MIN_RENDER_SCALE = 0.6;

/**
 * `?quality=low` (or an automated browser: navigator.webdriver) starts at the lowest
 * render scale with bloom off, for weak GPUs and test runs. `?quality=high` opts out.
 */
function startLowQuality(): boolean {
  const q = new URLSearchParams(location.search).get("quality");
  if (q === "low") return true;
  if (q === "high") return false;
  return navigator.webdriver === true;
}

export class GameWorld implements WorldApi {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 220);
  readonly renderer: THREE.WebGLRenderer;
  readonly anchors: WorldAnchors = { deck: { x: DECK.x, z: DECK.z }, shopDoor: { x: DOOR.x, z: DOOR.z } };

  // Events (assign callbacks).
  onNear: (target: Interactable | null) => void = () => {};
  onInteract: (target: Interactable | null) => void = () => {};
  onMove: (x: number, z: number, heading: number) => void = () => {};
  onZoneChange: (zone: Zone) => void = () => {};
  onExitBlockedBump: () => void = () => {};

  private collision = new Collision();
  private interactables: Interactables;
  private city: City;
  private shop: Shop;
  private traffic: Traffic;
  private cars: ParkedCars;
  private npcs: Npcs;
  private player: Player;
  private records = new RecordItems();
  private waypoint: Waypoint;
  private moon: THREE.DirectionalLight;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private fxaa: ShaderPass;
  private film: ShaderPass;
  private blocked = false;
  /** The record in the player's hand, if any (drives the carry pose). */
  private handRecord: string | null = null;
  private deckPlaying = false;
  private zone: Zone = "street";
  private lastBump = -Infinity;
  private last = 0;
  private elapsed = 0;
  private perfFrames = 0;
  private perfMs = 0;
  private readonly lowQuality = startLowQuality();
  private renderScale = this.lowQuality ? MIN_RENDER_SCALE : Math.min(devicePixelRatio, 1.25);

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-label", "3D city with a record shop. WASD to walk, E to interact.");

    // Night, light rain — but lifted so it reads on a projector (no crushed blacks).
    this.scene.background = new THREE.Color("#3a4f62");
    this.scene.fog = new THREE.FogExp2("#3d5263", 0.0135);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    this.scene.add(new THREE.HemisphereLight("#a9c3dc", "#5a4a3c", 1.25));
    this.moon = new THREE.DirectionalLight("#bcd2f0", 1.25);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    Object.assign(this.moon.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 70 });
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.03;
    this.scene.add(this.moon, this.moon.target);

    if (this.lowQuality) setTamashiQuality("low");
    this.interactables = new Interactables(this.scene);
    this.city = new City(this.scene, this.collision);
    this.shop = new Shop(this.scene, this.collision, this.interactables);
    this.shop.registerStations();
    this.traffic = new Traffic(this.scene, 6);
    this.cars = new ParkedCars(this.scene, this.collision, this.interactables);
    this.npcs = new Npcs(this.scene, this.collision, this.interactables);
    new Atm(this.scene, this.collision, this.interactables);
    this.waypoint = new Waypoint(this.scene);
    this.player = new Player(this.scene, this.camera, this.collision, this.renderer.domElement);
    this.player.teleport(SPAWN.x, SPAWN.z, SPAWN.heading);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), 0.45, 0.5, 1.0);
    this.bloom.enabled = !this.lowQuality;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.film = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
      void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float vignette=1.-.2*pow(length((vUv-.5)*1.2),1.8);
      float noise=fract(sin(dot(vUv+mod(time,100.),vec2(12.9898,78.233)))*43758.5453)-.5;
      gl_FragColor=vec4(c*vignette+noise*.016,1.);}`,
    });
    this.composer.addPass(this.film);
    this.composer.setPixelRatio(this.renderScale);
    document.documentElement.dataset.renderScale = this.renderScale.toFixed(2);
    if (this.lowQuality) document.documentElement.dataset.quality = "low";

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ───────────────────────── WorldApi ─────────────────────────

  setShopRecords(records: WorldRecord[]) {
    this.shop.setRecords(records, this.records);
  }

  setRecordPlace(recordId: string, place: RecordPlace, npcId?: string) {
    const item = this.records.get(recordId);
    if (!item) return;
    if (place === "hand") this.handRecord = recordId;
    else if (this.handRecord === recordId) this.handRecord = null;
    this.player.carrying = this.handRecord !== null;
    switch (place) {
      case "shelf": {
        const anchor = this.shop.anchorFor(recordId);
        if (anchor) item.toShelf(anchor);
        else item.hide();
        break;
      }
      case "hand":
        item.toHand(this.scene, this.player.holdMatrix, "hand");
        break;
      case "deck":
        item.toDeck(this.shop.deckAnchor, this.shop.deckSleeveSpot);
        break;
      case "npc": {
        const holder = this.npcs.holderFor(npcId ?? BUYER_ID);
        if (holder) item.toHand(this.scene, holder, "npc");
        else item.hide();
        break;
      }
      case "hidden":
        item.hide();
        break;
    }
  }

  setDeckPlaying(playing: boolean) {
    this.deckPlaying = playing;
    this.shop.setPlaying(playing);
  }

  setBlocked(blocked: boolean) {
    this.blocked = blocked;
    this.player.setBlocked(blocked);
  }

  setExitBlocked(blocked: boolean) {
    this.collision.doorWall.enabled = blocked;
  }

  setInteractableEnabled(id: string, enabled: boolean) {
    this.interactables.setEnabled(id, enabled);
  }

  setWaypoint(target: { x: number; z: number } | null) {
    this.waypoint.set(target);
  }

  setCashierStatus(status: "idle" | "processing" | "success" | "error") {
    this.npcs.setCashierStatus(status);
  }

  async smashCar(carId: string): Promise<void> {
    const car = this.cars.get(carId);
    if (!car) return;
    const impact = this.cars.impactPoint(car);
    await this.player.swingAt(impact.x, impact.z);
    this.cars.smash(car, this.player.position.clone());
    this.player.shake(0.4);
    // Smashed cars stay smashed: no second prompt.
    this.interactables.setEnabled(carId, false);
  }

  setBuyerStatus(npcId: string, status: "idle" | "thinking" | "happy" | "error") {
    this.npcs.setBuyerStatus(npcId, status);
  }

  buyerLeave(npcId: string, recordId: string) {
    this.setRecordPlace(recordId, "npc", npcId);
    this.npcs.buyerLeave(npcId);
  }

  buyerReturn(npcId: string): Promise<void> {
    return this.npcs.buyerReturn(npcId);
  }

  teleport(x: number, z: number, headingRad?: number) {
    this.player.teleport(x, z, headingRad);
  }

  getPlayer() {
    const p = this.player.position;
    return { x: p.x, z: p.z, heading: this.player.heading, zone: this.zone };
  }

  getInteractable(id: string) {
    const i = this.interactables.get(id);
    return i ? { ...i } : undefined;
  }

  mapSnapshot(): MapSnapshot {
    const p = this.player.position;
    return {
      bounds: { ...BOUNDS },
      player: { x: p.x, z: p.z, heading: this.player.heading },
      roads: STATIC_ROADS,
      buildings: STATIC_BUILDINGS,
      shop: STATIC_SHOP,
      cars: [...this.traffic.positions(), ...this.cars.positions()],
      pedestrians: this.npcs.positions(),
      points: this.interactables.all().map((i) => ({ id: i.id, kind: i.kind, x: i.x, z: i.z, enabled: i.enabled })),
      waypoint: this.waypoint.target ? { ...this.waypoint.target } : null,
    };
  }

  // ───────────────────────── Diagnostics (tests / perf) ─────────────────────────

  /** Draw calls and triangles for one plain scene render (shadow passes included). */
  measure() {
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    this.renderer.render(this.scene, this.camera);
    const result = { calls: info.render.calls, triangles: info.render.triangles, renderScale: this.renderScale, bloom: this.bloom.enabled };
    info.autoReset = true;
    return result;
  }

  /** Street crowd: Tamashi on screen now, distinct ids shown so far (debug / tests). */
  crowdStats() {
    return this.npcs.crowdStats(this.camera);
  }

  get stationPositions() {
    return { spawn: SPAWN, door: DOOR, deck: DECK, counter: COUNTER };
  }

  // ───────────────────────── Internals ─────────────────────────

  private onKey(e: KeyboardEvent) {
    if (e.code !== "KeyE" && e.code !== "Enter" && e.code !== "NumpadEnter") return;
    if (e.repeat || this.blocked) return;
    const t = e.target as HTMLElement | null;
    if (t && (t instanceof HTMLButtonElement || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable)) return;
    e.preventDefault();
    this.onInteract(this.interactables.nearest);
  }

  private resize() {
    const w = this.host.clientWidth || window.innerWidth,
      h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fxaa.uniforms.resolution.value.set(1 / (w * this.renderScale), 1 / (h * this.renderScale));
  }

  /** Lower render scale, then drop bloom, if frames are slow (integrated GPUs on a big screen). */
  private adaptQuality(rawDelta: number) {
    this.perfFrames++;
    this.perfMs += rawDelta;
    if (this.perfFrames < 40) return;
    const average = this.perfMs / this.perfFrames;
    if (average > 24 && this.renderScale > MIN_RENDER_SCALE) {
      this.renderScale = Math.max(MIN_RENDER_SCALE, this.renderScale - 0.15);
      this.renderer.setPixelRatio(this.renderScale);
      this.composer.setPixelRatio(this.renderScale);
      this.resize();
    } else if (average > 40 && this.bloom.enabled) {
      this.bloom.enabled = false;
    }
    document.documentElement.dataset.renderScale = this.renderScale.toFixed(2);
    this.perfFrames = 0;
    this.perfMs = 0;
  }

  private frame(time: number) {
    const rawDelta = this.last ? time - this.last : 16.7;
    this.last = time;
    const dt = Math.min(rawDelta / 1000, 0.1);
    this.elapsed += dt;
    this.adaptQuality(rawDelta);

    this.player.update(dt);
    const p = this.player.position;
    if (this.player.bumpedDoor && this.collision.doorWall.enabled && time - this.lastBump > EXIT_BUMP_THROTTLE_MS) {
      this.lastBump = time;
      this.onExitBlockedBump();
    }
    const zone: Zone = inShop(p.x, p.z) ? "shop" : "street";
    if (zone !== this.zone) {
      this.zone = zone;
      this.onZoneChange(zone);
    }
    if (this.interactables.update(dt, p.x, p.z, groundHeight(p.x, p.z))) this.onNear(this.interactables.nearest);
    this.onMove(p.x, p.z, this.player.heading);

    const pedestrians = this.npcs.positions();
    this.traffic.update(dt, [{ x: p.x, z: p.z }, ...pedestrians]);
    this.cars.update(dt);
    this.npcs.update(dt, p, this.camera);
    this.shop.update(dt, this.elapsed);
    this.records.update(dt, this.deckPlaying);
    this.waypoint.update(dt, this.camera);
    this.player.updateCamera(dt);
    this.city.update(dt, this.camera);
    this.followShadow(p);

    this.film.uniforms.time.value = time * 0.001;
    this.composer.render();
  }

  /** Keep the one shadow-casting light's small frustum centred on the player, snapped to texels. */
  private followShadow(p: THREE.Vector3) {
    const texel = (this.moon.shadow.camera.right - this.moon.shadow.camera.left) / this.moon.shadow.mapSize.x;
    const x = Math.round(p.x / texel) * texel,
      z = Math.round(p.z / texel) * texel;
    this.moon.target.position.set(x, 0, z);
    this.moon.position.set(x - 10, 26, z + 14);
  }
}

const STATIC_ROADS = ROADS.map((r) => ({ ...r }));
const STATIC_BUILDINGS = BUILDINGS.map(({ x, z, w, d }) => ({ x, z, w, d }));
const STATIC_SHOP = { ...SHOP };
