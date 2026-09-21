import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyLookDelta,
  approachAngle,
  approachScalar,
  isDoubleTap,
  isTap,
  shortestAngleDelta,
  wrapAngle,
  DOUBLE_TAP_MAX_DELAY,
  ORBIT_PITCH_MAX,
  ORBIT_PITCH_MIN,
  TAP_MAX_MOVE,
  TOUCH_DRAG_THRESHOLD
} from "../src/camera/CameraMath.js";

const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// 3A - the snap/fly-out regression
// ---------------------------------------------------------------------------

test("wrapAngle normalizes into [-PI, PI)", () => {
  assert.ok(Math.abs(wrapAngle(0)) < 1e-12);
  assert.ok(Math.abs(wrapAngle(Math.PI * 2)) < 1e-12);
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) + Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapAngle(-3.3) - (-3.3 + Math.PI * 2)) < 1e-12);
  assert.equal(wrapAngle(NaN), 0);
});

test("shortestAngleDelta crosses the seam instead of going the long way", () => {
  // 3.0 rad -> -3.0 rad is +0.28 rad across the seam, NOT -6.0 rad.
  const delta = shortestAngleDelta(3.0, -3.0);

  assert.ok(delta > 0, "must keep orbiting the same direction");
  assert.ok(Math.abs(delta - (Math.PI * 2 - 6.0)) < 1e-12);
  assert.ok(Math.abs(delta) <= Math.PI);
});

test("REGRESSION: orbiting past the front never sweeps behind the car", () => {
  // Reproduces the reported bug. yaw = +-PI is the FRONT of the car,
  // yaw = 0 is directly BEHIND it. The player drags from 3.0 rad past the
  // seam to -3.0 rad; the smoothed yaw must stay near the front the whole
  // time and must never pass through 0.
  let yaw = 3.0;
  const target = -3.0;
  const blend = 1 - Math.exp(-10 * (1 / 60));

  let closestToBehind = Infinity;

  for (let frame = 0; frame < 240; frame += 1) {
    yaw = approachAngle(yaw, target, blend);
    closestToBehind = Math.min(closestToBehind, Math.abs(wrapAngle(yaw)));
  }

  assert.ok(
    closestToBehind > 2.9,
    `camera flew behind the car (got within ${closestToBehind} rad of yaw 0)`
  );
  assert.ok(
    Math.abs(shortestAngleDelta(yaw, target)) < 1e-6,
    "the orbit must still settle on the requested angle"
  );
});

test("the old linear approach is what used to produce the fly-out", () => {
  // Guards the explanation, so nobody reintroduces the plain lerp.
  let yaw = 3.0;
  const target = -3.0;
  const blend = 1 - Math.exp(-10 * (1 / 60));

  let passedBehind = false;

  for (let frame = 0; frame < 240; frame += 1) {
    yaw += (target - yaw) * blend;
    if (Math.abs(wrapAngle(yaw)) < 0.2) passedBehind = true;
  }

  assert.ok(passedBehind, "the buggy maths must demonstrably swing past the rear");
});

test("approachAngle settles without overshoot or drift", () => {
  let yaw = -2.5;

  for (let frame = 0; frame < 600; frame += 1) {
    yaw = approachAngle(yaw, 1.2, 0.1);
  }

  assert.ok(Math.abs(yaw - 1.2) < 1e-6);
  assert.ok(yaw >= -Math.PI && yaw < Math.PI, "yaw stays wrapped, never grows");
});

test("approachAngle is monotonic along the shortest arc", () => {
  // Every step moves toward the target and never jumps to the far side.
  let yaw = 0;
  let previousDistance = Math.abs(shortestAngleDelta(yaw, 3.05));

  for (let frame = 0; frame < 200; frame += 1) {
    yaw = approachAngle(yaw, 3.05, 0.08);
    const distance = Math.abs(shortestAngleDelta(yaw, 3.05));

    assert.ok(distance <= previousDistance + 1e-12, "no overshoot or teleport");
    previousDistance = distance;
  }
});

test("approachScalar leaves pitch unwrapped and bounded", () => {
  assert.ok(Math.abs(approachScalar(0, 1, 0.5) - 0.5) < 1e-12);
  assert.equal(approachScalar(0.4, 0.4, 1), 0.4);
  assert.equal(approachScalar(NaN, 0.5, 0.5), 0.25);
});

test("blend factors are clamped, so a long frame cannot overshoot", () => {
  assert.ok(Math.abs(approachAngle(0, 1, 5) - 1) < 1e-12);
  assert.ok(Math.abs(approachAngle(0, 1, -3)) < 1e-12);
});

// ---------------------------------------------------------------------------
// Look deltas (shared by mouse drag and touch drag)
// ---------------------------------------------------------------------------

test("third-person yaw wraps and pitch is clamped to a comfortable range", () => {
  const up = applyLookDelta({ pitch: 0, deltaY: -10000, sensitivity: 0.003 });
  const down = applyLookDelta({ pitch: 0, deltaY: 10000, sensitivity: 0.003 });

  assert.equal(up.pitch, ORBIT_PITCH_MIN);
  assert.equal(down.pitch, ORBIT_PITCH_MAX);

  const wrapped = applyLookDelta({
    yaw: 3.1, deltaX: -100, sensitivity: 0.003
  });

  assert.ok(wrapped.yaw >= -Math.PI && wrapped.yaw < Math.PI);
  assert.ok(wrapped.yaw < 0, "yaw wrapped across the seam rather than growing");
});

test("driver-view limits are preserved exactly", () => {
  const left = applyLookDelta({
    mode: "driver", deltaX: -100000, sensitivity: 0.003
  });
  const down = applyLookDelta({
    mode: "driver", deltaY: 100000, sensitivity: 0.003
  });

  assert.equal(left.yaw, 1.4);
  assert.equal(down.pitch, 0.55);
});

test("drag direction convention is unchanged", () => {
  // Dragging right yields negative yaw; dragging down yields positive pitch.
  const right = applyLookDelta({ deltaX: 50, sensitivity: 0.003 });
  const down = applyLookDelta({ deltaY: 50, sensitivity: 0.003 });

  assert.ok(right.yaw < 0);
  assert.ok(down.pitch > 0);
});

test("look sensitivity is respected rather than hardcoded", () => {
  const slow = applyLookDelta({ deltaX: 100, sensitivity: 0.001 });
  const fast = applyLookDelta({ deltaX: 100, sensitivity: 0.008 });

  assert.ok(Math.abs(fast.yaw) > Math.abs(slow.yaw) * 7);
});

// ---------------------------------------------------------------------------
// 3C - tap / double-tap thresholds
// ---------------------------------------------------------------------------

test("a small, short touch is a tap; a drag is not", () => {
  assert.equal(isTap({ moved: 3, duration: 120 }), true);
  assert.equal(isTap({ moved: TAP_MAX_MOVE + 1, duration: 120 }), false);
  assert.equal(isTap({ moved: 3, duration: 900 }), false);
});

test("double tap needs both a short delay and a nearby second tap", () => {
  const first = { x: 100, y: 200, time: 1000 };

  assert.equal(isDoubleTap(first, { x: 104, y: 203, time: 1150 }), true);
  assert.equal(
    isDoubleTap(first, { x: 104, y: 203, time: 1000 + DOUBLE_TAP_MAX_DELAY + 50 }),
    false,
    "too slow"
  );
  assert.equal(isDoubleTap(first, { x: 400, y: 600, time: 1150 }), false, "too far");
  assert.equal(isDoubleTap(null, { x: 1, y: 1, time: 1 }), false);
});

test("the drag threshold is smaller than the tap tolerance", () => {
  assert.ok(TOUCH_DRAG_THRESHOLD > 0);
  assert.ok(TOUCH_DRAG_THRESHOLD <= TAP_MAX_MOVE);
});

// ---------------------------------------------------------------------------
// 3B - wiring checks
// ---------------------------------------------------------------------------

test("CameraManager smooths orbit yaw with the shortest-arc helper", () => {
  const src = read("../src/camera/CameraManager.js");

  assert.match(src, /this\.yaw = approachAngle\(this\.yaw, this\.targetYaw, orbitBlend\)/);
  assert.doesNotMatch(
    src,
    /this\.yaw \+= \(this\.targetYaw - this\.yaw\)/,
    "the plain linear yaw approach must not come back"
  );
});

test("mouse and touch share one look-delta path", () => {
  const src = read("../src/camera/CameraManager.js");

  assert.match(src, /applyLook\(deltaX, deltaY\)/);
  assert.match(src, /applyLook\(deltaX, deltaY\)\s*\{[\s\S]*applyLookDelta\(\{/);
});

test("touch drag is pointer-event based, first-finger only, and cancel safe", () => {
  const src = read("../src/camera/CameraManager.js");

  assert.match(src, /pointerType !== "touch"/);
  assert.match(src, /if \(this\.touchPointerId !== null\) return;/);
  assert.match(src, /TOUCH_DRAG_THRESHOLD/);
  assert.match(src, /addEventListener\("pointercancel"/);
  assert.match(src, /addEventListener\("lostpointercapture"/);
  assert.match(src, /clearTouchGesture\(\)/);
  assert.match(src, /visibilitychange[\s\S]{0,200}clearTouchGesture\(\)/);
});

test("a touch tap does not fire the desktop click-to-center path", () => {
  const src = read("../src/camera/CameraManager.js");

  assert.match(
    src,
    /if \(event\.button !== 0 \|\| event\.pointerType === "touch"\) return;/
  );
});

test("double tap reuses the single centerLook entry point", () => {
  const src = read("../src/camera/CameraManager.js");

  assert.match(src, /isDoubleTap\(this\.lastTap, tap\)[\s\S]{0,200}this\.centerLook\(\)/);

  // One centering implementation, not a second copy of camera state.
  assert.equal((src.match(/centerLook\(\)\s*\{/g) ?? []).length, 1);
});

test("the gameplay canvas opts out of browser pan/zoom gestures", () => {
  const css = read("../src/style.css");

  assert.match(css, /#game \{\s*touch-action: none;/);
});
