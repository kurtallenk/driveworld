// ---------------------------------------------------------------------------
// CAMERA MATH
// ---------------------------------------------------------------------------
// The yaw/pitch/orbit arithmetic CameraManager used to do inline, pulled out
// into pure functions so it can be regression-tested without a browser, a
// renderer or a physics world.
//
// THE BUG THIS EXISTS FOR
//
// Third-person orbit yaw is wrapped into [-PI, PI) as the player drags. The
// smoothing step, however, used a plain linear approach:
//
//     yaw += (targetYaw - yaw) * blend;
//
// Dragging past the FRONT of the car crosses the +-PI seam, so targetYaw
// jumps from just under +PI to just over -PI. A plain approach then travels
// the long way round -- the whole 2*PI the other direction, straight through
// yaw = 0, which is directly BEHIND the car. That is the reported symptom:
// while looking at the front, the camera suddenly flies behind the vehicle
// and then swings forward again.
//
// approachAngle() below always moves along the SHORTEST arc, so the seam
// becomes invisible and the orbit is continuous all the way around.
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;

// Driver view can only look around the cabin.
export const DRIVER_YAW_LIMIT = 1.4;
export const DRIVER_PITCH_LIMIT = 0.55;

// Third-person orbit: yaw is unlimited (it wraps), pitch is clamped so the
// camera cannot flip over the roof or dip through the ground.
export const ORBIT_PITCH_MIN = -0.55;
export const ORBIT_PITCH_MAX = 0.75;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const finite = (value, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

// Normalizes any angle to [-PI, PI). The exact seam value maps to -PI,
// which is the same direction as +PI, so orbit continuity is unaffected.
export function wrapAngle(angle) {
  const wrapped = ((finite(angle) + Math.PI) % TAU + TAU) % TAU;
  return wrapped - Math.PI;
}

// Signed shortest rotation from `from` to `to`, always within [-PI, PI).
export function shortestAngleDelta(from, to) {
  return wrapAngle(finite(to) - finite(from));
}

// Exponential approach along the shortest arc. `blend` is the already
// frame-rate-corrected 1 - exp(-k*dt) factor the rest of the camera uses.
export function approachAngle(current, target, blend) {
  const step = clamp(finite(blend), 0, 1);
  return wrapAngle(
    finite(current) + shortestAngleDelta(current, target) * step
  );
}

// Same shape, for values that must NOT wrap (pitch).
export function approachScalar(current, target, blend) {
  const step = clamp(finite(blend), 0, 1);
  return finite(current) + (finite(target) - finite(current)) * step;
}

// One definition of "a look drag moved this far", shared by the mouse
// right-drag and the mobile one-finger drag so the two can never disagree
// about direction, sensitivity or limits.
//
// Convention (unchanged): looking along chassis +Z, dragging right gives a
// negative yaw, dragging down gives a positive pitch.
export function applyLookDelta({
  yaw = 0,
  pitch = 0,
  deltaX = 0,
  deltaY = 0,
  sensitivity = 0.003,
  mode = "third"
} = {}) {
  const rawYaw = finite(yaw) - finite(deltaX) * finite(sensitivity, 0.003);
  const rawPitch = finite(pitch) + finite(deltaY) * finite(sensitivity, 0.003);

  if (mode === "driver") {
    return {
      yaw: clamp(rawYaw, -DRIVER_YAW_LIMIT, DRIVER_YAW_LIMIT),
      pitch: clamp(rawPitch, -DRIVER_PITCH_LIMIT, DRIVER_PITCH_LIMIT)
    };
  }

  return {
    yaw: wrapAngle(rawYaw),
    pitch: clamp(rawPitch, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX)
  };
}

// Tap thresholds, shared by the touch gesture handler and its tests.
export const TAP_MAX_MOVE = 12;      // px of travel still counted as a tap
export const TAP_MAX_DURATION = 320; // ms a tap may last
export const DOUBLE_TAP_MAX_DELAY = 320;
export const DOUBLE_TAP_MAX_DISTANCE = 40;
export const TOUCH_DRAG_THRESHOLD = 6; // px before a drag starts rotating

export function isTap(gesture = {}) {
  return (
    finite(gesture.moved, Infinity) <= TAP_MAX_MOVE &&
    finite(gesture.duration, Infinity) <= TAP_MAX_DURATION
  );
}

// Two taps close together in both time and space. Deliberately strict so a
// double tap cannot be confused with two separate deliberate taps or with
// the start of a drag.
export function isDoubleTap(previous, current) {
  if (!previous || !current) return false;

  const delay = finite(current.time, Infinity) - finite(previous.time, 0);

  if (!(delay >= 0 && delay <= DOUBLE_TAP_MAX_DELAY)) return false;

  const distance = Math.hypot(
    finite(current.x) - finite(previous.x),
    finite(current.y) - finite(previous.y)
  );

  return distance <= DOUBLE_TAP_MAX_DISTANCE;
}
