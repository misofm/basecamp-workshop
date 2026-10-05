/**
 * Jump: the player's vertical physics as a tiny PURE state machine (no Three.js, no DOM).
 *
 * Owns: the vertical position/velocity of a body over a floor height, the jump phases
 * (grounded → crouch (anticipation) → airborne → grounded), the jump buffer, the
 * no-double-jump rule, and easing up/down curbs while grounded.
 * Must not: read input, test horizontal collision or know about the world; player.ts
 * asks `requestJump` (after its own "may I jump now?" checks) and calls `stepJump`
 * every frame with the floor height under the body.
 */

/** Apex height above the take-off floor, metres. */
export const JUMP_APEX = 1.1;
/** Gravity, m/s² (snappy, game-feel rather than 9.81). */
export const JUMP_GRAVITY = 22;
/** Take-off speed that reaches JUMP_APEX: v² = 2 g h. */
export const JUMP_SPEED = Math.sqrt(2 * JUMP_GRAVITY * JUMP_APEX);
/** Anticipation crouch before lift-off, seconds. */
export const JUMP_CROUCH = 0.09;
/** A press this long before landing still jumps on landing, seconds. */
export const JUMP_BUFFER = 0.1;
/** Grounded: the body eases onto a new floor height (curbs) at this rate, 1/s. */
const STEP_RATE = 18;
/** Grounded but the floor dropped further than this: fall instead of easing down. */
const FALL_DROP = 0.35;

export type JumpPhase = "grounded" | "crouch" | "airborne";

export interface JumpState {
  phase: JumpPhase;
  /** Height of the feet, metres (world y). */
  y: number;
  /** Vertical velocity, m/s (up positive). 0 unless airborne. */
  vy: number;
  /** Seconds spent in the current phase. */
  phaseT: number;
  /** Seconds left on a buffered jump request (0 = none). */
  buffer: number;
  /** Floor height at take-off (the apex is measured from here). */
  takeoffY: number;
}

export interface JumpEvents {
  /** Left the ground this step (end of the crouch). */
  liftoff: boolean;
  /** Touched down this step. */
  landed: boolean;
  /** Downward speed at touchdown, m/s (0 if not landed). */
  impact: number;
}

export function initialJump(y = 0): JumpState {
  return { phase: "grounded", y, vy: 0, phaseT: 0, buffer: 0, takeoffY: y };
}

/** Put the body on the floor at `y` (teleport): grounded, no buffered jump. */
export function resetJump(s: JumpState, y: number): void {
  Object.assign(s, initialJump(y));
}

export const isAirborne = (s: JumpState) => s.phase === "airborne";

/**
 * Ask for a jump. Starts the crouch when grounded; while crouching or airborne it never
 * starts a second jump (no double jump), it only buffers the press for JUMP_BUFFER s so
 * a press just before touchdown jumps again on landing. Returns true if a jump started.
 */
export function requestJump(s: JumpState): boolean {
  if (s.phase === "grounded") {
    s.phase = "crouch";
    s.phaseT = 0;
    s.buffer = 0;
    return true;
  }
  if (s.phase === "airborne") s.buffer = JUMP_BUFFER;
  return false;
}

/** Abort a crouch that has not left the ground yet (e.g. a menu opened). */
export function cancelJump(s: JumpState): void {
  s.buffer = 0;
  if (s.phase === "crouch") {
    s.phase = "grounded";
    s.phaseT = 0;
  }
}

/** Advance by dt seconds over a floor at height `floor` (under the body's current x, z). */
export function stepJump(s: JumpState, dt: number, floor: number): JumpEvents {
  const ev: JumpEvents = { liftoff: false, landed: false, impact: 0 };
  s.phaseT += dt;
  if (s.buffer > 0) s.buffer = Math.max(0, s.buffer - dt);

  if (s.phase === "crouch" && s.phaseT >= JUMP_CROUCH) {
    s.phase = "airborne";
    s.phaseT = 0;
    s.takeoffY = s.y;
    s.vy = JUMP_SPEED;
    ev.liftoff = true;
  } else if (s.phase !== "airborne" && s.y - floor > FALL_DROP) {
    // Walked off something high: fall (not used by the town's 0.15 m curbs).
    s.phase = "airborne";
    s.phaseT = 0;
    s.takeoffY = s.y;
    s.vy = 0;
  }

  if (s.phase === "airborne") {
    // Semi-implicit Euler is fine at frame rate; the half-step term makes the apex exact for any dt.
    s.y += s.vy * dt - 0.5 * JUMP_GRAVITY * dt * dt;
    s.vy -= JUMP_GRAVITY * dt;
    if (s.vy <= 0 && s.y <= floor) {
      ev.landed = true;
      ev.impact = -s.vy;
      s.y = floor;
      s.vy = 0;
      s.phase = "grounded";
      s.phaseT = 0;
      if (s.buffer > 0) requestJump(s);
    }
  } else {
    // Grounded / crouching: ease onto curbs and the shop floor (no pop).
    s.y += (floor - s.y) * (1 - Math.exp(-dt * STEP_RATE));
    if (Math.abs(floor - s.y) < 1e-4) s.y = floor;
  }
  return ev;
}
