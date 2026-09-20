import test from "node:test";
import assert from "node:assert/strict";

import { MobileControls } from "../src/ui/MobileControls.js";

// ---------------------------------------------------------------------------
// Regression cover for the "portrait shrinks after a rotation" bug.
//
// ui/portrait-fix.css derives its whole scale from --mc-vw:
//
//     --pf-u: min(calc(var(--mc-vw) / 412), 1.15px)
//
// so whatever measureViewport() publishes there multiplies every portrait
// offset, size and font. It used to publish window.visualViewport, which is
// the layout viewport divided by the current page scale -- and a rotation can
// leave a residual scale behind. These tests pin the measurement to the
// LAYOUT viewport instead, and pin the mid-rotation guard.
//
// measureViewport() and measurementIsSettled() touch no instance state, so
// they are exercised on a bare prototype rather than by constructing the whole
// touch layer (which would need a real DOM).
// ---------------------------------------------------------------------------

const probe = Object.create(MobileControls.prototype);

function setViewport({ client, inner, visual, mediaPortrait = null }) {
  globalThis.document = {
    documentElement: client
      ? { clientWidth: client[0], clientHeight: client[1] }
      : {}
  };

  globalThis.window = {
    innerWidth: inner?.[0],
    innerHeight: inner?.[1],
    visualViewport: visual ? { width: visual[0], height: visual[1] } : undefined,
    matchMedia:
      mediaPortrait === null
        ? undefined
        : () => ({ matches: mediaPortrait })
  };
}

test("layout viewport wins over a page-scaled visual viewport", () => {
  // The exact shape of the bug: the phone is really 412 CSS px wide, but the
  // visual viewport still reports a zoomed-in 366 after the rotation.
  setViewport({ client: [412, 915], inner: [412, 915], visual: [366, 813] });

  const measured = probe.measureViewport();

  assert.equal(measured.width, 412);
  assert.equal(measured.height, 915);
  assert.equal(measured.portrait, true);
});

test("the visual viewport is still reported, but separately", () => {
  setViewport({ client: [412, 915], inner: [412, 915], visual: [412, 640] });

  const measured = probe.measureViewport();

  // Control scale reads .height; only the chat ceiling reads .visualHeight.
  assert.equal(measured.height, 915);
  assert.equal(measured.visualHeight, 640);
});

test("a rotation round trip returns the original portrait measurement", () => {
  setViewport({ client: [412, 915], inner: [412, 915], visual: [412, 915] });
  const before = probe.measureViewport();

  setViewport({ client: [915, 412], inner: [915, 412], visual: [915, 412] });
  const landscape = probe.measureViewport();

  // Back to portrait, but with the page left at a residual scale.
  setViewport({ client: [412, 915], inner: [412, 915], visual: [349, 775] });
  const after = probe.measureViewport();

  assert.equal(landscape.portrait, false);
  assert.deepEqual(
    { w: after.width, h: after.height },
    { w: before.width, h: before.height }
  );
});

test("falls back through innerWidth then the visual viewport", () => {
  setViewport({ client: null, inner: [800, 600], visual: [700, 500] });
  assert.equal(probe.measureViewport().width, 800);

  setViewport({ client: null, inner: null, visual: [700, 500] });
  assert.equal(probe.measureViewport().width, 700);
});

test("a measurement disagreeing with the browser's orientation is not settled", () => {
  // Mid-rotation: the box still reads landscape while the browser already
  // reports portrait.
  setViewport({ client: [915, 412], inner: [915, 412], mediaPortrait: true });

  const measured = probe.measureViewport();

  assert.equal(measured.portrait, false);
  assert.equal(probe.measurementIsSettled(measured.portrait), false);
});

test("a settled measurement is accepted", () => {
  setViewport({ client: [412, 915], inner: [412, 915], mediaPortrait: true });

  const measured = probe.measureViewport();

  assert.equal(probe.measurementIsSettled(measured.portrait), true);
});

test("no matchMedia means every measurement is accepted", () => {
  setViewport({ client: [412, 915], inner: [412, 915] });

  assert.equal(probe.measurementIsSettled(true), true);
  assert.equal(probe.measurementIsSettled(false), true);
});
