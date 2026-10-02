import test from "node:test";
import assert from "node:assert/strict";
import { InputManager } from "../src/input/InputManager.js";

const sampleKeys = (...codes) =>
  InputManager.prototype.keyboardInput.call({ keys: new Set(codes) });

test("arrow keys drive exactly like WASD", () => {
  assert.equal(sampleKeys("ArrowUp").throttle, 1);
  assert.equal(sampleKeys("ArrowDown").brake, 1);
  assert.equal(sampleKeys("ArrowLeft").steering, -1);
  assert.equal(sampleKeys("ArrowRight").steering, 1);
});

test("an alias pair held together counts once, never doubles", () => {
  assert.equal(sampleKeys("KeyW", "ArrowUp").throttle, 1);
  assert.equal(sampleKeys("KeyD", "ArrowRight").steering, 1);
  assert.equal(sampleKeys("KeyA", "ArrowRight").steering, 0);
});

test("WASD behaviour is unchanged", () => {
  const input = sampleKeys("KeyW", "KeyA", "Space");
  assert.equal(input.throttle, 1);
  assert.equal(input.steering, -1);
  assert.equal(input.handbrake, 1);
});
