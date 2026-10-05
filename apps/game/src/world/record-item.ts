/**
 * Record items: exactly one physical vinyl + sleeve object per record id.
 *
 * Owns: building the object (cover art from the record's coverUrl, vinyl label tinted
 * from its palette) and moving it between places — shelf display, the player's hand,
 * the deck platter, an NPC's hand, or hidden. Objects are reparented, never duplicated.
 * Must not: decide where a record should be (the game controller does, via WorldApi).
 */
import * as THREE from "three";
import type { RecordPlace, WorldRecord } from "./api";
import { aggregatorFallback } from "../miso/media";

const SLEEVE = 0.31;
/**
 * One draw call per part: the sleeve's thin edges sample a sliver of the cover, and the
 * vinyl's rim samples the black corner of its label texture, so each needs one material.
 */
const sleeveGeometry = (() => {
  const g = new THREE.BoxGeometry(SLEEVE, SLEEVE, 0.008);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < 16; i++) uv.setXY(i, 0.01 + (uv.getX(i) * 0.01), uv.getY(i)); // faces ±x, ±y
  g.clearGroups();
  return g;
})();
const discGeometry = (() => {
  const g = new THREE.CylinderGeometry(0.15, 0.15, 0.004, 48);
  const uv = g.getAttribute("uv");
  const torso = 49 * 2; // (radialSegments + 1) × (heightSegments + 1) side vertices come first
  for (let i = 0; i < torso; i++) uv.setXY(i, 0.01, 0.01);
  g.clearGroups();
  return g;
})();
const textureLoader = new THREE.TextureLoader();

/** Scale of the record when displayed/held, so it reads on a projector in third person. */
export const DISPLAY_SCALE = 1.55;

/** Something that can hold a record in its hand: writes the record's world matrix each frame. */
export type Holder = (out: THREE.Matrix4) => boolean;

function labelTexture(record: WorldRecord) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#0e1010";
  c.fillRect(0, 0, 256, 256);
  // Grooves.
  for (let r = 44; r < 127; r += 2.2) {
    c.strokeStyle = r % 6 < 2.2 ? "#262b2a" : "#161a19";
    c.lineWidth = 1;
    c.beginPath();
    c.arc(128, 128, r, 0, Math.PI * 2);
    c.stroke();
  }
  // Sheen.
  const sheen = c.createLinearGradient(0, 0, 256, 256);
  sheen.addColorStop(0.35, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.12)");
  sheen.addColorStop(0.65, "rgba(255,255,255,0)");
  c.fillStyle = sheen;
  c.beginPath();
  c.arc(128, 128, 127, 0, Math.PI * 2);
  c.fill();
  // Label in the record's palette.
  c.fillStyle = record.palette[1] ?? "#d4a24a";
  c.beginPath();
  c.arc(128, 128, 42, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = record.palette[2] ?? "#f4ead2";
  c.beginPath();
  c.arc(128, 128, 30, Math.PI * 0.1, Math.PI * 0.9);
  c.fill();
  c.fillStyle = "#050606";
  c.beginPath();
  c.arc(128, 128, 3, 0, Math.PI * 2);
  c.fill();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RecordItem {
  readonly root = new THREE.Group();
  readonly sleeve: THREE.Mesh;
  readonly disc: THREE.Mesh;
  place: RecordPlace = "hidden";
  private holder: Holder | null = null;
  private settle = 0;
  constructor(readonly record: WorldRecord) {
    this.root.name = `record:${record.id}`;
    this.root.userData.recordId = record.id;
    this.root.userData.keepDynamic = true;
    const coverMaterial = new THREE.MeshStandardMaterial({ color: record.palette[0] ?? "#888", roughness: 0.75 });
    const applyCover = (map: THREE.Texture) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      coverMaterial.map = map;
      coverMaterial.color.set("#ffffff");
      coverMaterial.needsUpdate = true;
    };
    textureLoader.load(record.coverUrl, applyCover, undefined, () => {
      // Not on the CDN: retry once from the Walrus aggregator (else keep the palette colour).
      const fallback = aggregatorFallback(record.coverUrl);
      if (fallback) textureLoader.load(fallback, applyCover);
    });
    this.sleeve = new THREE.Mesh(sleeveGeometry, coverMaterial);
    this.sleeve.castShadow = true;
    const label = new THREE.MeshStandardMaterial({ map: labelTexture(record), roughness: 0.32, metalness: 0.1 });
    this.disc = new THREE.Mesh(discGeometry, label);
    this.disc.castShadow = true;
    this.root.add(this.sleeve, this.disc);
    this.root.visible = false;
  }

  /** Displayed face-out on a shelf stand: sleeve upright, vinyl peeking out the side. */
  toShelf(anchor: THREE.Object3D) {
    this.reset("shelf");
    anchor.add(this.root);
    this.root.scale.setScalar(DISPLAY_SCALE);
    this.disc.rotation.set(Math.PI / 2, 0, 0);
    this.disc.position.set(0.085, 0.0, -0.008);
  }
  /** Held by a character; `holder` positions it every frame. */
  toHand(scene: THREE.Object3D, holder: Holder, place: "hand" | "npc") {
    this.reset(place);
    scene.add(this.root);
    this.holder = holder;
    this.root.matrixAutoUpdate = false;
    this.disc.rotation.set(Math.PI / 2, 0, 0);
    this.disc.position.set(0.075, -0.01, -0.007);
  }
  /** On the turntable: vinyl on the platter, sleeve standing behind it as a "now playing" display. */
  toDeck(platter: THREE.Object3D, sleeveSpot: THREE.Vector3) {
    this.reset("deck");
    platter.add(this.root);
    this.root.scale.setScalar(1);
    this.disc.position.set(0, 0.002 + 0.07, 0);
    this.settle = 0.07;
    this.sleeve.position.copy(sleeveSpot);
    this.sleeve.rotation.set(-0.18, 0, 0); // upright, leaning back, cover toward the listener
  }
  hide() {
    this.reset("hidden");
    this.root.visible = false;
  }
  private reset(place: RecordPlace) {
    this.place = place;
    this.holder = null;
    this.root.removeFromParent();
    this.root.matrixAutoUpdate = true;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.setScalar(1);
    this.sleeve.position.set(0, 0, 0);
    this.sleeve.rotation.set(0, 0, 0);
    this.disc.position.set(0, 0, 0);
    this.disc.rotation.set(0, 0, 0);
    this.root.visible = true;
  }
  update(dt: number, spinning: boolean) {
    if (this.holder) {
      this.root.visible = this.holder(this.root.matrix);
      this.root.matrixWorldNeedsUpdate = true;
    }
    if (this.place === "deck") {
      this.settle = THREE.MathUtils.lerp(this.settle, 0, 1 - Math.exp(-dt * 12));
      this.disc.position.y = 0.002 + this.settle;
      if (spinning) this.disc.rotation.y -= (dt * Math.PI * 2 * 33.333) / 60;
    }
  }
}

/** All record items, by record id. */
export class RecordItems {
  readonly items = new Map<string, RecordItem>();
  ensure(record: WorldRecord) {
    let item = this.items.get(record.id);
    if (!item) {
      item = new RecordItem(record);
      this.items.set(record.id, item);
    }
    return item;
  }
  get(id: string) {
    return this.items.get(id);
  }
  update(dt: number, deckSpinning: boolean) {
    for (const item of this.items.values()) item.update(dt, deckSpinning);
  }
}
