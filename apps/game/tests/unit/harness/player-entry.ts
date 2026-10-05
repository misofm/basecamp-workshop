/**
 * Browser-side entry: the real Player (three + the player's Tamashi, no renderer) on a
 * blank page with a <canvas>, for the held-key tests in input-routing.spec.ts.
 */
import * as THREE from "three";
import { Player } from "../../../src/world/player";
import { Collision } from "../../../src/world/collision";

function makePlayer() {
  const canvas = document.querySelector("canvas") ?? document.body.appendChild(document.createElement("canvas"));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const player = new Player(scene, camera, new Collision(), canvas);
  // Open street, away from walls.
  player.teleport(-20, 6.5, 0);
  const p = {
    player,
    /** Keys the player currently treats as held (private; the only peek at internals). */
    held: () => [...(player as unknown as { keys: Set<string> }).keys],
    pos: () => ({ x: player.position.x, z: player.position.z }),
    /** Advance n frames of 1/60 s. */
    step: (n = 10) => {
      for (let i = 0; i < n; i++) player.update(1 / 60);
    },
    phase: () => player.jumpState.phase,
  };
  (window as unknown as { __p: typeof p }).__p = p;
  return p;
}

(window as unknown as Record<string, unknown>).__playerKit = { makePlayer };
