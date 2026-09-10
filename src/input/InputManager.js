import {
  V99_PROFILE_ID,
  matchesV99Layout,
  readV99Input,
  isV99ReadyToArm
} from "./V99Profile.js";
import { loadWheelCalibration } from "./WheelCalibration.js";

const STORAGE_KEY = "driveworld.controls.v1";

const clamp = (value, min, max) =>
  Math.min(
    max,
    Math.max(min, Number.isFinite(value) ? value : 0)
  );

export function normalizeInput(raw = {}) {
  return {
    steering: clamp(raw.steering, -1, 1),
    throttle: clamp(raw.throttle, 0, 1),
    brake: clamp(raw.brake, 0, 1),
    clutch: clamp(raw.clutch, 0, 1),
    handbrake: clamp(raw.handbrake, 0, 1),
    gear:
      Number.isInteger(raw.gear) &&
      raw.gear >= -1 &&
      raw.gear <= 6
        ? raw.gear
        : 0,
    gearUp: raw.gearUp === true,
    gearDown: raw.gearDown === true
  };
}

function identifyFamily(id) {
  if (/pxn.*v99/i.test(id)) return "PXN V99 candidate";
  if (/pxn.*v9\b/i.test(id)) return "PXN V9 candidate";
  if (/\bg29\b/i.test(id)) return "Logitech G29 candidate";
  return "Unrecognized device";
}

export class InputManager {
  constructor() {
    this.v99Calibration = loadWheelCalibration();
    this.keys = new Set();
    this.resetRequested = false;
    this.devices = [];

    this.mode = "keyboard";
    this.activeSource = "Keyboard";
    this.status = "Keyboard controls active";
    this.storageWarning = "";
    this.shifter = null;

    this.armed = false;
    this.armedIndex = null;
    this.readySince = null;

    this.restorePreference();

    const handled = new Set([
      "KeyW", "KeyS", "KeyA", "KeyD", "Space", "KeyR"
    ]);

    window.addEventListener("keydown", (event) => {
      if (!handled.has(event.code)) return;

      event.preventDefault();
      this.keys.add(event.code);

      if (event.code === "KeyR" && !event.repeat) {
        this.resetRequested = true;
      }
    });

    window.addEventListener("keyup", (event) => {
      if (handled.has(event.code)) event.preventDefault();
      this.keys.delete(event.code);
    });

    const clear = () => {
      this.keys.clear();
      this.resetRequested = false;
      this.disarm();
    };

    window.addEventListener("blur", clear);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clear();
    });

    // Never retain armed state through a disconnect, even when an index
    // is later reused by a reconnected device.
    window.addEventListener("gamepaddisconnected", () => {
      this.disarm();
    });
  }

  restorePreference() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

      if (
        saved?.version === 1 &&
        saved.mode === "v99" &&
        saved.profileId === V99_PROFILE_ID
      ) {
        this.mode = "v99";
        this.status = "Saved V99 profile restored; waiting for device";
      }
    } catch {
      this.storageWarning =
        "Saved settings unavailable; select a control mode again.";
    }
  }

  savePreference() {
    try {
      // This versioned profile ID refers to the complete mapping in
      // V99Profile.js. Future user calibration will store its parameters.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        mode: this.mode,
        profileId: V99_PROFILE_ID
      }));

      this.storageWarning = "";
    } catch {
      this.storageWarning =
        "Storage unavailable. Selection works for this session only.";
    }
  }

  getGamepads() {
    try {
      return Array.from(navigator.getGamepads?.() ?? [])
        .filter(gamepad => gamepad?.connected);
    } catch {
      return [];
    }
  }

  enableV99() {
    const candidates = this.getGamepads().filter(matchesV99Layout);

    if (candidates.length !== 1) {
      this.status = candidates.length > 1
        ? "Multiple matching V99 devices: device selection is required."
        : "Matching V99 not visible. Press a wheel button and try again.";

      return;
    }

    this.mode = "v99";
    this.keys.clear();
    this.disarm();
    this.savePreference();

    this.status =
      "V99 profile selected. Center wheel, release pedals, select neutral.";
  }

  useKeyboard() {
    this.mode = "keyboard";
    this.keys.clear();
    this.shifter = null;
    this.disarm();
    this.savePreference();
    this.activeSource = "Keyboard";
    this.status = "Keyboard controls active";
  }

  disarm() {
    this.armed = false;
    this.armedIndex = null;
    this.readySince = null;
  }

  keyboardInput() {
    const pressed = code => Number(this.keys.has(code));

    return normalizeInput({
      steering: pressed("KeyD") - pressed("KeyA"),
      throttle: pressed("KeyW"),
      brake: pressed("KeyS"),
      handbrake: pressed("Space")
    });
  }

  sample() {
    if (this.mode === "keyboard") {
      this.activeSource = "Keyboard";
      return this.keyboardInput();
    }

    // Do not apply unattended gamepad input to an unfocused page.
    if (document.hidden || !document.hasFocus()) {
      this.disarm();
      this.activeSource = "None — waiting";
      this.status = "Wheel paused while the page is unfocused";
      return normalizeInput();
    }

    const candidates = this.getGamepads().filter(matchesV99Layout);

    if (candidates.length !== 1) {
      this.disarm();
      this.shifter = null;
      this.activeSource = "None — waiting";
      this.status = candidates.length > 1
        ? "Multiple matching devices; wheel input disabled"
        : "Waiting for saved V99 device; wheel input disabled";

      return normalizeInput();
    }

    const gamepad = candidates[0];

    if (this.armed && gamepad.index !== this.armedIndex) {
      this.disarm();
    }

    const reading = readV99Input(gamepad, this.v99Calibration);
    this.shifter = reading.shifter;

    if (!reading.valid) {
      this.disarm();
      this.activeSource = "None — invalid input";
      this.status = reading.reason;
      return normalizeInput();
    }

    if (!this.armed) {
      if (!isV99ReadyToArm(reading)) {
        this.readySince = null;
      } else {
        this.readySince ??= performance.now();

        if (performance.now() - this.readySince >= 500) {
          this.armed = true;
          this.armedIndex = gamepad.index;
        }
      }

      if (!this.armed) {
        this.activeSource = "None — safety check";
        this.status =
          "Center wheel, release ALL pedals, and select neutral for ½ second.";

        return normalizeInput();
      }
    }

    this.activeSource = "PXN V99";
    this.status = reading.shifter.valid
      ? "Saved V99 profile active · Arcade driving"
      : "Arcade driving active · conflicting/invalid shifter reading";

    return normalizeInput({
      ...reading.input,
      // Keyboard handbrake remains available until hardware is mapped.
      handbrake: Number(this.keys.has("Space"))
    });
  }

  consumeReset() {
    const requested = this.resetRequested;
    this.resetRequested = false;
    return requested;
  }

  inspectDevices() {
    this.devices = this.getGamepads().map(gamepad => ({
      id: gamepad.id,
      index: gamepad.index,
      mapping: gamepad.mapping || "non-standard",
      family: identifyFamily(gamepad.id),
      status:
        this.mode === "v99" && matchesV99Layout(gamepad)
          ? this.status
          : "Diagnostic only — no enabled binding",
      axes: Array.from(
        gamepad.axes,
        value => Number(value.toFixed(3))
      ),
      invalidAnalogAxes: Array.from(gamepad.axes)
        .map((value, index) => ({ index, value }))
        .filter(({ value }) =>
          !Number.isFinite(value) || value < -1 || value > 1
        ),
      buttons: gamepad.buttons.map((button, index) => ({
        index,
        value: Number(button.value.toFixed(3)),
        pressed: button.pressed
      }))
    }));

    return this.devices;
  }
}