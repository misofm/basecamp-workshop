/**
 * GameWorld: the 3D world behind the WorldApi contract.
 *
 * Renderer: three's WebGPURenderer (WebGPU, with its automatic WebGL2 fallback; `?backend=webgl`
 * forces the fallback). Construction is synchronous (the scene is built at once); `ready`
 * resolves after the backend has initialised, the IBL is set, every material/compute pipeline
 * is compiled (no hitches later) and the frame loop is running.
 *
 * Owns: the renderer, scene, camera, the quality tier wiring (quality.ts: high = full post,
 * medium = WebGL2 fallback, low = tone mapping only; `?adapt=0` pins it), post-processing
 * (postfx.ts), adaptive quality (render scale, then GTAO, then bloom on slow frames), the
 * frame loop, the finale's brown-out (homeBeat), and the wiring between subsystems (city,
 * street props, atmosphere = dusk sky/sun/fog/lights, GPU particles, shop, ATM, the dead
 * Triangle sedan, NPCs, player, records, interactables, waypoint). Translates WorldApi calls
 * into subsystem calls and fires the WorldApi events (onNear, onInteract, onMove,
 * onZoneChange, onExitBlockedBump).
 * Must not: know about money, wallets, chains, menus, HUD or sound; it never touches the
 * DOM beyond its own canvas (and the `dataset` quality/backend flags).
 */
import * as THREE from "three/webgpu";
import type { Interactable, MapSnapshot, RecordPlace, WorldAnchors, WorldApi, WorldRecord, Zone } from "./api";
import { Collision } from "./collision";
import { Interactables } from "./interactables";
import { City } from "./city";
import { Shop } from "./shop";
import { StreetProps } from "./street-props";
import { Atmosphere } from "./atmosphere";
import { GpuParticles } from "./particles";
import { PostFx, stagesFor } from "./postfx";
import { activeBackend, adaptiveQuality, qualityTier, requestedBackend, setActiveBackend, type QualityTier } from "./quality";
import { initTextures } from "./materials";
import { ParkedCars } from "./cars";
import { BUYER_ID, Npcs } from "./npcs";
import { Player } from "./player";
import { RecordItems } from "./record-item";
import { Waypoint } from "./waypoint";
import { Atm } from "./atm";
import { Cameo } from "./cameo";
import { setTamashiQuality } from "../tamashi/character";
import { BOUNDS, BUILDINGS, COUNTER, DECK, DOOR, HOTEL_DOOR, ROADS, SHOP, SOUND_SOURCES, SPAWN, groundHeight, inShop } from "./layout";

const EXIT_BUMP_THROTTLE_MS = 1500;
/** Adaptive quality never goes below this render scale (pixel ratio). */
const MIN_RENDER_SCALE = 0.6;
/** Starting render scale per tier (capped by devicePixelRatio). */
const START_SCALE: Record<QualityTier, number> = { high: 2, medium: 1.25, low: MIN_RENDER_SCALE };
/** homeBeat timeline (s): dark by DROP, stutter back from STUTTER, lights fully back at BACK. */
const BEAT = { drop: 0.12, stutter: 2.0, back: 2.6, resolve: 2.8 };
/** Brown-out floor (fraction of normal light / exposure / bloom). */
const BROWN_OUT = 0.12;
/** Longest we wait for pipeline pre-compilation before starting frames anyway. */
const COMPILE_BUDGET_MS = 8000;

export class GameWorld implements WorldApi {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 620);
  readonly renderer: THREE.WebGPURenderer;
  /** Resolves once the backend is up, pipelines are compiled and frames are running. */
  readonly ready: Promise<void>;
  readonly anchors: WorldAnchors = {
    deck: { x: DECK.x, z: DECK.z },
    shopDoor: { x: DOOR.x, z: DOOR.z },
    homeDoor: { x: HOTEL_DOOR.x, z: HOTEL_DOOR.z },
    sounds: {
      fire: { ...SOUND_SOURCES.fire },
      diner: { ...SOUND_SOURCES.diner },
      band: { ...SOUND_SOURCES.band },
      vending: { ...SOUND_SOURCES.vending },
    },
  };

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
  private props: StreetProps;
  private atmosphere: Atmosphere;
  private particles: GpuParticles | null = null;
  private postfx: PostFx | null = null;
  private cars: ParkedCars;
  private npcs: Npcs;
  /** Consented stage cameo by Saisei's window (src/world/cameo.ts); `?cameo=0` removes him. */
  private cameo: Cameo;
  private player: Player;
  private records = new RecordItems();
  private waypoint: Waypoint;
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
  /** Smoothed frame time (ms), for diagnostics. */
  private frameMs = 16.7;
  private started = false;
  private tier: QualityTier = qualityTier();
  private readonly adaptive = adaptiveQuality();
  /** Brown-out: 1 = normal. While < 1, every other module's point/spot light is scaled for the render. */
  private dim = 1;
  private foreignLights: { light: THREE.PointLight | THREE.SpotLight; saved: number }[] = [];
  private renderScale = Math.min(devicePixelRatio, START_SCALE[this.tier]);

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGPURenderer({
      antialias: false,
      powerPreference: "high-performance",
      forceWebGL: requestedBackend() === "webgl",
    });
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-label", "3D city street with a record shop. WASD to walk, E to interact.");

    // Dusk: sky dome, low western sun (the only shadow caster), hemisphere, fog, street lights.
    const low = this.tier === "low";
    this.atmosphere = new Atmosphere(this.scene, this.renderer, { tier: this.tier });

    if (low) setTamashiQuality("low");
    this.interactables = new Interactables(this.scene);
    this.city = new City(this.scene, this.collision);
    this.shop = new Shop(this.scene, this.collision, this.interactables, { lowQuality: low });
    this.shop.registerStations();
    this.props = new StreetProps(this.scene, this.collision, { low });
    this.cars = new ParkedCars(this.scene, this.collision, this.interactables);
    this.npcs = new Npcs(this.scene, this.collision, this.interactables);
    new Atm(this.scene, this.collision, this.interactables);
    this.cameo = new Cameo(this.scene, this.collision, { enabled: new URLSearchParams(location.search).get("cameo") !== "0" });
    this.interactables.register({
      id: "home",
      kind: "home",
      x: HOTEL_DOOR.interactX,
      z: HOTEL_DOOR.interactZ,
      radius: HOTEL_DOOR.radius,
      enabled: false,
    });
    this.waypoint = new Waypoint(this.scene);
    this.player = new Player(this.scene, this.camera, this.collision, this.renderer.domElement);
    this.player.teleport(SPAWN.x, SPAWN.z, SPAWN.heading);

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.resize();
    this.ready = this.start();
    // Dev-only console handle for perf triage (`__world.census()`); never in production builds.
    if (import.meta.env.DEV) (window as unknown as { __world: GameWorld }).__world = this;
  }

  /** Backend init → tier → IBL → post → particles → compile everything → start the loop. */
  private async start() {
    await this.renderer.init();
    // A lost WebGPU device would freeze the stage demo: reload once on the WebGL2 fallback.
    this.renderer.onDeviceLost = (info) => {
      console.error("WebGPU device lost", info);
      const url = new URL(location.href);
      if (url.searchParams.get("backend") === "webgl") return;
      url.searchParams.set("backend", "webgl");
      location.replace(url.toString());
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isWebGPU = (this.renderer.backend as any).isWebGPUBackend === true;
    setActiveBackend(isWebGPU ? "webgpu" : "webgl");
    this.tier = qualityTier();
    this.renderScale = Math.min(devicePixelRatio, START_SCALE[this.tier]);
    this.renderer.setPixelRatio(this.renderScale);
    this.atmosphere.setShadowTier(this.tier);
    const html = document.documentElement.dataset;
    html.backend = activeBackend();
    html.quality = this.tier;
    html.renderScale = this.renderScale.toFixed(2);

    // First-frame texture maps (KTX2); 4K hero maps swap in later on their own.
    try {
      await initTextures(this.renderer);
    } catch (e) {
      console.warn("texture init failed; flat tints until maps load", e);
    }
    await this.atmosphere.initEnvironment(this.tier);
    const stages = stagesFor(this.tier);
    if (stages) this.postfx = new PostFx(this.renderer, this.scene, this.camera, stages);
    const params = new URLSearchParams(location.search);
    // `?particles=0`: no GPU particles (perf / GPU triage).
    if (params.get("particles") !== "0")
      this.particles = new GpuParticles(this.scene, this.renderer, { tier: this.tier, rain: params.get("rain") === "1" });
    this.resize();
    this.player.updateCamera(0);
    if (import.meta.env.DEV) {
      // Dev triage: `?hide=shop,city,…` hides top-level scene children by name; `?shadows=0`.
      const hide = (params.get("hide") ?? "").split(",").filter(Boolean);
      for (const c of this.scene.children) if (hide.some((h) => (c.name || c.type).startsWith(h))) c.visible = false;
      if (params.get("shadows") === "0") this.renderer.shadowMap.enabled = false;
    }
    // Pre-compile every pipeline (no hitch at the first purchase/receipt), time-boxed so a
    // slow machine never holds the intro: whatever isn't ready compiles on first use.
    const warm = (async () => {
      await this.renderer.compileAsync(this.scene, this.camera);
      await this.particles?.warm();
    })().catch((e) => console.warn("pipeline pre-compile failed; continuing", e));
    await Promise.race([warm, new Promise((r) => setTimeout(r, COMPILE_BUDGET_MS))]);
    this.started = true;
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /**
   * Second, time-boxed pipeline warm-up once the records are on the shelves (main.ts runs
   * it after `ready` and the catalog load, while the intro still shows): everything in the
   * scene compiles now, not at the first purchase, receipt or smash.
   */
  async warmUp(): Promise<void> {
    await this.ready;
    const compile = this.renderer.compileAsync(this.scene, this.camera).catch((e: unknown) => console.warn("warm-up compile failed; continuing", e));
    await Promise.race([compile, new Promise((r) => setTimeout(r, COMPILE_BUDGET_MS))]);
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

  setJumpAllowed(allowed: boolean) {
    this.player.setJumpAllowed(allowed);
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
    this.npcs.reactToSmash();
    // Smashed cars stay smashed: no second prompt.
    this.interactables.setEnabled(carId, false);
  }

  /**
   * The boom (bible §7.4 / §7.7 finale): camera shake, a two-second brown-out (exposure,
   * sun, hemisphere, every point light, bloom down to ~12%), Inicio sent to the hotel door
   * while it is dark, then the lights stutter back over ~0.6 s. Resolves at ~2.8 s.
   */
  homeBeat(): Promise<void> {
    this.player.shake(0.55);
    this.collectForeignLights();
    const start = this.elapsed;
    let sentHome = false;
    let stutterAt = -1,
      stutterLevel = BROWN_OUT;
    return new Promise((resolve) => {
      const step = () => {
        const t = this.elapsed - start;
        if (t < BEAT.drop) this.dim = 1 - (1 - BROWN_OUT) * (t / BEAT.drop);
        else if (t < BEAT.stutter) {
          // Dark, with one weak attempt to come back half way through.
          this.dim = BROWN_OUT + (t > 1.05 && t < 1.13 ? 0.18 : 0);
        } else if (t < BEAT.back) {
          // Stutter: hold a random level for 50-110 ms, ramping up overall.
          if (this.elapsed >= stutterAt) {
            const k = (t - BEAT.stutter) / (BEAT.back - BEAT.stutter);
            stutterLevel = Math.random() < 0.4 + 0.4 * k ? 0.55 + 0.45 * Math.random() : BROWN_OUT + 0.15 * Math.random();
            stutterAt = this.elapsed + 0.05 + Math.random() * 0.06;
          }
          this.dim = stutterLevel;
        } else this.dim = 1;
        if (!sentHome && t > 0.35) {
          sentHome = true;
          this.npcs.sendInicioHome();
        }
        if (t >= BEAT.resolve) {
          this.dim = 1;
          resolve();
        } else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
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
      cars: this.cars.positions(),
      pedestrians: this.npcs.positions(),
      points: this.interactables.all().map((i) => ({ id: i.id, kind: i.kind, x: i.x, z: i.z, enabled: i.enabled })),
      waypoint: this.waypoint.target ? { ...this.waypoint.target } : null,
    };
  }

  // ───────────────────────── Diagnostics (tests / perf) ─────────────────────────

  /**
   * Draw calls and triangles for one plain scene render (shadow pass included, post passes
   * not), plus the live tier, backend, smoothed frame time and GPU memory counters.
   */
  measure() {
    const info = this.renderer.info;
    const base = {
      backend: activeBackend(),
      tier: this.tier,
      renderScale: this.renderScale,
      post: this.postfx ? { ...this.postfx.stages } : null,
      started: this.started,
      dim: +this.dim.toFixed(2),
      frameMs: +this.frameMs.toFixed(2),
      lights: this.lightCount(),
    };
    if (!this.started) return { calls: 0, triangles: 0, ...base };
    info.autoReset = false;
    info.reset();
    this.renderer.render(this.scene, this.camera);
    const result = {
      calls: info.render.drawCalls,
      triangles: info.render.triangles,
      ...base,
      memory: { geometries: info.memory.geometries, textures: info.memory.textures, textureMB: +(this.textureBytes() / 1048576).toFixed(1) },
    };
    info.autoReset = true;
    return result;
  }

  /** Rough GPU bytes of every texture referenced by scene materials (RGBA8 + mips; compressed as stored). */
  private textureBytes() {
    const seen = new Set<THREE.Texture>();
    let bytes = 0;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        for (const v of Object.values(mat)) {
          const t = v as THREE.Texture;
          if (!t || !t.isTexture || seen.has(t)) continue;
          seen.add(t);
          const img = t.image as { width?: number; height?: number; data?: ArrayBufferView } | undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mip = (t as any).mipmaps as { data?: ArrayBufferView }[] | undefined;
          if ((t as THREE.CompressedTexture).isCompressedTexture && mip?.length) bytes += mip.reduce((a, l) => a + (l.data?.byteLength ?? 0), 0);
          else if (img?.width && img.height) bytes += img.width * img.height * 4 * (t.generateMipmaps ? 1.33 : 1);
        }
      }
    });
    return bytes;
  }

  /**
   * Dev/QA: the scene (no post) rendered into a 640×360 target and returned as a PNG data URL.
   * Headless WebGPU canvases don't show up in screenshots; this does. Tone mapping is applied.
   */
  async grab(): Promise<string> {
    const w = 640,
      h = 360;
    const rt = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace });
    const aspect = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const px = (await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
    rt.dispose();
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    // WebGPU rows are top-down, WebGL2 bottom-up.
    const flip = activeBackend() === "webgl";
    for (let y = 0; y < h; y++) {
      const src = (flip ? h - 1 - y : y) * w * 4;
      img.data.set(px.subarray(src, src + w * 4), y * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }

  /** Visible meshes per top-level scene child: [meshes, shadow casters, instanced] (perf triage). */
  census() {
    const out: Record<string, [number, number, number]> = {};
    for (const child of this.scene.children) {
      const key = child.name || child.type;
      const row = (out[key] ??= [0, 0, 0]);
      child.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh && !(o as THREE.Sprite).isSprite && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
        row[0]++;
        if (m.castShadow) row[1]++;
        if ((m as THREE.InstancedMesh).isInstancedMesh) row[2]++;
      });
    }
    return out;
  }

  /** Real point/spot lights in the scene (light budget check). */
  lightCount() {
    let point = 0,
      spot = 0;
    this.scene.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) point++;
      else if ((o as THREE.SpotLight).isSpotLight) spot++;
    });
    return { point, spot };
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Lower render scale, then drop GTAO, then bloom, if frames are slow. `?adapt=0` pins it. */
  private adaptQuality(rawDelta: number) {
    this.frameMs += (rawDelta - this.frameMs) * 0.05;
    if (!this.adaptive) return;
    this.perfFrames++;
    this.perfMs += rawDelta;
    if (this.perfFrames < 40) return;
    const average = this.perfMs / this.perfFrames;
    const post = this.postfx;
    if (average > 20 && this.renderScale > MIN_RENDER_SCALE) {
      this.renderScale = Math.max(MIN_RENDER_SCALE, this.renderScale - 0.15);
      this.renderer.setPixelRatio(this.renderScale);
      this.resize();
    } else if (average > 20 && post?.stages.ao) {
      post.set({ ao: false });
    } else if (average > 40 && post?.stages.bloom) {
      post.set({ bloom: false });
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

    this.cars.update(dt);
    this.props.update(dt, this.elapsed);
    this.particles?.update(dt, this.elapsed, this.camera);
    this.npcs.update(dt, p, this.camera);
    this.cameo.update(dt, p, this.camera, this.deckPlaying);
    this.shop.update(dt, this.elapsed);
    this.records.update(dt, this.deckPlaying);
    this.waypoint.update(dt, this.camera);
    this.player.updateCamera(dt);
    this.city.update(dt, this.camera);
    this.applyDim();
    this.atmosphere.update(dt, this.elapsed, this.camera);

    if (this.dim < 1) {
      for (const f of this.foreignLights) {
        f.saved = f.light.intensity;
        f.light.intensity *= this.dim;
      }
      this.render(time);
      for (const f of this.foreignLights) f.light.intensity = f.saved;
    } else this.render(time);
  }

  private render(time: number) {
    if (this.postfx) this.postfx.render(time * 0.001);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Brown-out levels: exposure and bloom follow `dim`; the atmosphere dims its own lights. */
  private applyDim() {
    const exposure = 0.15 + 0.85 * this.dim;
    this.renderer.toneMappingExposure = this.atmosphere.exposure * exposure;
    this.postfx?.setBloomScale(this.dim);
    this.particles?.setDim(this.dim);
    this.atmosphere.setDim(this.dim, exposure);
  }

  /** Every point/spot light that isn't the atmosphere's (shop, sedan hazard, props…). */
  private collectForeignLights() {
    const own = new Set<THREE.Object3D>(this.atmosphere.pointLights);
    this.foreignLights = [];
    this.scene.traverse((o) => {
      const l = o as THREE.PointLight | THREE.SpotLight;
      if ((l as THREE.PointLight).isPointLight || (l as THREE.SpotLight).isSpotLight) {
        if (!own.has(l)) this.foreignLights.push({ light: l, saved: l.intensity });
      }
    });
  }
}

const STATIC_ROADS = ROADS.map((r) => ({ ...r }));
const STATIC_BUILDINGS = BUILDINGS.map(({ x, z, w, d }) => ({ x, z, w, d }));
const STATIC_SHOP = { ...SHOP };
