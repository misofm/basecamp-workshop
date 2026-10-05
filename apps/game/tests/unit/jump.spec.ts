import { expect, test } from "@playwright/test";
import {
  cancelJump,
  initialJump,
  JUMP_APEX,
  JUMP_BUFFER,
  JUMP_CROUCH,
  requestJump,
  stepJump,
  type JumpState,
} from "../../src/world/jump";

const DT = 1 / 60;

/** Step until `until` returns true (or maxSeconds pass). Returns the peak height seen. */
function run(s: JumpState, floor: (t: number) => number, until: (s: JumpState) => boolean, maxSeconds = 3) {
  let t = 0;
  let peak = s.y;
  let landed = 0;
  let liftoffs = 0;
  while (t < maxSeconds) {
    const ev = stepJump(s, DT, floor(t));
    t += DT;
    peak = Math.max(peak, s.y);
    if (ev.landed) landed++;
    if (ev.liftoff) liftoffs++;
    if (until(s)) break;
  }
  return { t, peak, landed, liftoffs };
}

test("grounded → crouch → airborne → grounded, apex ≈ 1.1 m", () => {
  const s = initialJump(0);
  expect(s.phase).toBe("grounded");
  expect(requestJump(s)).toBe(true);
  expect(s.phase).toBe("crouch");
  // Still on the ground during the anticipation crouch.
  stepJump(s, JUMP_CROUCH / 2, 0);
  expect(s.phase).toBe("crouch");
  expect(s.y).toBe(0);
  const r = run(s, () => 0, (x) => x.phase === "grounded");
  expect(r.liftoffs).toBe(1);
  expect(r.landed).toBe(1);
  expect(s.phase).toBe("grounded");
  expect(s.y).toBe(0);
  expect(s.vy).toBe(0);
  expect(r.peak).toBeGreaterThan(JUMP_APEX - 0.03);
  expect(r.peak).toBeLessThan(JUMP_APEX + 0.03);
  // Total air time is a snappy ~0.6–0.7 s.
  expect(r.t).toBeGreaterThan(0.55);
  expect(r.t).toBeLessThan(0.8);
});

test("apex is the same at different frame rates", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const s = initialJump(0);
    requestJump(s);
    let peak = 0;
    for (let i = 0; i < 2 / dt && !(s.phase === "grounded" && i > 0); i++) {
      stepJump(s, dt, 0);
      peak = Math.max(peak, s.y);
    }
    expect(Math.abs(peak - JUMP_APEX)).toBeLessThan(0.03);
  }
});

test("no double jump: pressing mid-air does not jump again", () => {
  const s = initialJump(0);
  requestJump(s);
  run(s, () => 0, (x) => x.phase === "airborne" && x.vy < 1); // near the apex
  expect(requestJump(s)).toBe(false);
  expect(requestJump(s)).toBe(false);
  const vyBefore = s.vy;
  stepJump(s, DT, 0);
  expect(s.vy).toBeLessThan(vyBefore); // still falling under gravity, no new impulse
  // The press expired long before landing: one landing, then it stays grounded.
  const r = run(s, () => 0, () => false, 1.5);
  expect(r.landed).toBe(1);
  expect(r.liftoffs).toBe(0);
  expect(s.phase).toBe("grounded");
});

test("requesting during the crouch does not stack a second jump", () => {
  const s = initialJump(0);
  expect(requestJump(s)).toBe(true);
  expect(requestJump(s)).toBe(false);
  const r = run(s, () => 0, () => false, 1.5);
  expect(r.liftoffs).toBe(1);
  expect(r.landed).toBe(1);
});

test("a press just before touchdown is buffered and jumps on landing", () => {
  const s = initialJump(0);
  requestJump(s);
  run(s, () => 0, (x) => x.phase === "airborne" && x.vy < 0 && x.y < 0.15);
  expect(requestJump(s)).toBe(false); // buffered, not a mid-air jump
  expect(JUMP_BUFFER).toBeGreaterThan(0);
  run(s, () => 0, (x) => x.phase !== "airborne");
  expect(s.phase).toBe("crouch");
});

test("lands on a raised floor (jump from the road onto the sidewalk)", () => {
  const s = initialJump(0);
  requestJump(s);
  // The floor under the body becomes the 0.15 m sidewalk shortly after lift-off.
  const r = run(s, (t) => (t > 0.3 ? 0.15 : 0), (x) => x.phase === "grounded" && x.phaseT > 0);
  expect(r.landed).toBe(1);
  expect(s.y).toBeCloseTo(0.15, 5);
  expect(s.phase).toBe("grounded");
});

test("stepping off a curb mid-air lands on the lower floor", () => {
  const s = initialJump(0.15);
  requestJump(s);
  const r = run(s, (t) => (t > 0.3 ? 0 : 0.15), (x) => x.phase === "grounded" && x.phaseT > 0);
  expect(r.landed).toBe(1);
  expect(s.y).toBe(0);
  // Apex is measured from the take-off floor.
  expect(r.peak).toBeGreaterThan(0.15 + JUMP_APEX - 0.03);
});

test("grounded: curbs are eased, not fallen off", () => {
  const s = initialJump(0.15);
  const r = run(s, () => 0, () => false, 0.6);
  expect(r.landed).toBe(0);
  expect(s.phase).toBe("grounded");
  expect(s.y).toBeLessThan(0.001);
});

test("cancelJump aborts the crouch before lift-off", () => {
  const s = initialJump(0);
  requestJump(s);
  cancelJump(s);
  const r = run(s, () => 0, () => false, 0.5);
  expect(r.liftoffs).toBe(0);
  expect(s.y).toBe(0);
});
