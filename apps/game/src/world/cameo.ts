/**
 * Consented cameo for the Basecamp stage build: a guest (src/tamashi/cameo.ts) hanging out
 * on the north sidewalk by Saisei's east window, headphones on, a record sleeve in hand,
 * nodding to the music. Disable with ?cameo=0 for the public take-home build.
 *
 * Owns: his spot, a small collision box, his idle behaviour (nod to the beat, harder while
 * the deck plays; an occasional foot tap; now and then lifting the sleeve to glance at it;
 * a head turn toward a nearby player) and his small speech bubble (friendly generic lines,
 * only while the player is within a few metres).
 * Must not: touch the commerce loop, the shared cast or other NPCs' bubbles.
 */
import * as THREE from "three";
import { createCameo, type CameoCharacter } from "../tamashi/cameo";
import type { Collision, Obstacle } from "./collision";
import { groundHeight } from "./layout";
import { SpeechBubble } from "./labels";

/** His spot: in front of Saisei's east window, facing the street (south-south-west). Local to this file. */
const CAMEO_SPOT = { x: 5.0, z: 0.95, heading: -0.35 };
/** Bubble shows while the player is this close (m). */
const TALK_RADIUS = 4;
/** Seconds per line. */
const LINE_SECONDS = 4;
const ACCENT = "#e8a65a";
const NAME = "Adeniyi";
const LINES = ["This one's on repeat.", "Good music should travel.", "Turn it up a little?", "Found anything good in there?"];
const PLAYING_LINES = ["Now that's a groove.", "This one's on repeat.", "Turn it up a little?", "Good music should travel."];

export class Cameo {
  readonly enabled: boolean;
  private character: CameoCharacter | null = null;
  private bubble: SpeechBubble | null = null;
  private obstacle: Obstacle | null = null;
  private time = 0;
  private nod = 0.06;
  // Behaviour timers.
  private nextGlance = 6 + Math.random() * 6;
  private glanceT = -1;
  private nextTap = 3 + Math.random() * 4;
  private tapT = -1;
  private tapLen = 0;
  private tap = 0;
  // Bubble.
  private talking = false;
  private line = 0;
  private lineT = 0;

  constructor(scene: THREE.Scene, collision: Collision, opts?: { enabled: boolean }) {
    this.enabled = opts ? opts.enabled : typeof location === "undefined" || new URLSearchParams(location.search).get("cameo") !== "0";
    if (!this.enabled) return;
    const c = createCameo();
    c.root.position.set(CAMEO_SPOT.x, groundHeight(CAMEO_SPOT.x, CAMEO_SPOT.z), CAMEO_SPOT.z);
    c.root.rotation.y = CAMEO_SPOT.heading;
    scene.add(c.root);
    this.character = c;
    this.obstacle = collision.add({ x: CAMEO_SPOT.x, z: CAMEO_SPOT.z, w: 0.55, d: 0.5, h: 0, tag: "cameo" });
    const bubble = new SpeechBubble(2.1, 7);
    bubble.occluders = () => collision.occluders();
    scene.add(bubble.sprite);
    this.bubble = bubble;
  }

  /** World position of the guest (null when disabled), e.g. for a minimap dot. */
  get position(): THREE.Vector3 | null {
    return this.character ? this.character.root.position : null;
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Camera, deckPlaying: boolean): void {
    const c = this.character;
    if (!c || !this.bubble) return;
    this.time += dt;

    // Nod: gentle to his own headphones, more emphatic while the deck plays.
    const nodTarget = deckPlaying ? 0.17 : 0.07;
    this.nod += (nodTarget - this.nod) * (1 - Math.exp(-dt * 2));
    c.nod = this.nod;

    // Foot tap: bursts of a few beats every several seconds (more often with the deck on).
    if (this.tapT < 0 && this.time >= this.nextTap) {
      this.tapT = 0;
      this.tapLen = 2.5 + Math.random() * 2.5;
    }
    let tapTarget = 0;
    if (this.tapT >= 0) {
      this.tapT += dt;
      tapTarget = 1;
      if (this.tapT > this.tapLen) {
        this.tapT = -1;
        this.nextTap = this.time + (deckPlaying ? 2 : 5) + Math.random() * 5;
      }
    }
    this.tap += (tapTarget - this.tap) * (1 - Math.exp(-dt * 6));
    c.tap = this.tap;

    // Sleeve glance: lift (0.8 s), look (~2.6 s), lower (0.8 s), then a while before the next.
    let glance = 0;
    if (this.glanceT < 0 && this.time >= this.nextGlance) this.glanceT = 0;
    if (this.glanceT >= 0) {
      this.glanceT += dt;
      const g = this.glanceT;
      glance = g < 0.8 ? smooth(g / 0.8) : g < 3.4 ? 1 : g < 4.2 ? 1 - smooth((g - 3.4) / 0.8) : 0;
      if (g >= 4.2) {
        this.glanceT = -1;
        this.nextGlance = this.time + 9 + Math.random() * 9;
      }
    }
    c.glance = glance;

    // Look toward a nearby player (head only, within his neck's range).
    const p = c.root.position;
    const dx = player.x - p.x;
    const dz = player.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < TALK_RADIUS + 1) {
      let rel = Math.atan2(dx, dz) - CAMEO_SPOT.heading;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      c.lookYaw = Math.abs(rel) < 1.6 ? rel : 0;
    } else c.lookYaw = 0;

    c.update(dt, camera);

    // Bubble: only near; cycles friendly lines.
    const near = d < (this.talking ? TALK_RADIUS + 0.4 : TALK_RADIUS);
    if (near !== this.talking) {
      this.talking = near;
      this.line = 0;
      this.lineT = 0;
    } else if (near && (this.lineT += dt) >= LINE_SECONDS) {
      this.lineT = 0;
      this.line++;
    }
    if (near) {
      const lines = deckPlaying ? PLAYING_LINES : LINES;
      this.bubble.set(lines[this.line % lines.length], { accent: ACCENT, name: NAME });
      c.bone("head").getWorldPosition(HEAD);
      this.bubble.sprite.position.set(HEAD.x, HEAD.y + 0.42, HEAD.z);
      this.bubble.update(dt, camera);
    } else this.bubble.set(null);
  }

  /** Remove him (e.g. switching the cameo off at runtime). */
  dispose(collision?: Collision): void {
    this.character?.dispose();
    this.bubble?.sprite.removeFromParent();
    if (collision && this.obstacle) {
      this.obstacle.enabled = false;
    }
    this.character = null;
    this.bubble = null;
  }
}

const smooth = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const HEAD = new THREE.Vector3();
