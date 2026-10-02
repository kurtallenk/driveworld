import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceTutorialProgress,
  loadTutorialState,
  TUTORIAL_STORAGE_KEY
} from "../src/ui/DrivingTutorial.js";

const run = (step, frames, input, speed = 0, dt = 1 / 60) => {
  const state = {};
  let done = false;
  for (let i = 0; i < frames && !done; i++) {
    done = advanceTutorialProgress(step, state, input, speed, dt);
  }
  return { done, state };
};

test("steering step needs BOTH directions", () => {
  const state = {};
  assert.equal(advanceTutorialProgress(0, state, { steering: -1 }, 0, 0.016), false);
  assert.equal(state.progress, 0.5);
  assert.equal(advanceTutorialProgress(0, state, { steering: 0 }, 0, 0.016), false);
  assert.equal(advanceTutorialProgress(0, state, { steering: 1 }, 0, 0.016), true);
});

test("gas step completes by holding throttle or by reaching speed", () => {
  assert.equal(run(1, 60, { throttle: 1 }).done, false);
  assert.equal(run(1, 120, { throttle: 1 }).done, true);
  assert.equal(run(1, 1, { throttle: 0 }, 30).done, true);
  assert.equal(run(1, 600, { throttle: 0 }).done, false);
});

test("brake step requires holding brake", () => {
  assert.equal(run(2, 600, { brake: 0 }).done, false);
  assert.equal(run(2, 100, { brake: 1 }).done, true);
});

test("combine step requires gas AND steering together", () => {
  assert.equal(run(3, 600, { throttle: 1, steering: 0 }).done, false);
  assert.equal(run(3, 600, { throttle: 0, steering: 1 }).done, false);
  assert.equal(run(3, 120, { throttle: 1, steering: -1 }).done, true);
});

test("final step never auto-completes (player presses Start driving)", () => {
  assert.equal(run(4, 600, { throttle: 1, steering: 1, brake: 1 }, 50).done, false);
});

test("saved guide state is read defensively", () => {
  const store = value => ({ getItem: key => (key === TUTORIAL_STORAGE_KEY ? value : null) });
  assert.equal(loadTutorialState(store("done")), "done");
  assert.equal(loadTutorialState(store("skipped")), "skipped");
  assert.equal(loadTutorialState(store("garbage")), null);
  assert.equal(loadTutorialState(store(null)), null);
  assert.equal(loadTutorialState({ getItem() { throw new Error("blocked"); } }), null);
});
