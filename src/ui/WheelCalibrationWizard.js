import { matchesV99Layout } from "../input/V99Profile.js";

import {
  defaultCalibration,
  validateCalibration,
  saveWheelCalibration,
  sanitizeAnalogAxis
} from "../input/WheelCalibration.js";

const STEPS = [
  {
    text: "Center the steering wheel.",
    axis: 0,
    target: ["steering", "center"]
  },
  {
    text: "Turn the steering wheel fully LEFT.",
    axis: 0,
    target: ["steering", "left"]
  },
  {
    text: "Turn the steering wheel fully RIGHT.",
    axis: 0,
    target: ["steering", "right"]
  },
  {
    text: "Center steering and RELEASE the accelerator.",
    axis: 2,
    target: ["pedals", "throttle", "released"]
  },
  {
    text: "Fully PRESS the accelerator. Release other pedals.",
    axis: 2,
    target: ["pedals", "throttle", "pressed"]
  },
  {
    text: "RELEASE the brake.",
    axis: 5,
    target: ["pedals", "brake", "released"]
  },
  {
    text: "Fully PRESS the brake. Release other pedals.",
    axis: 5,
    target: ["pedals", "brake", "pressed"]
  },
  {
    text: "RELEASE the clutch.",
    axis: 6,
    target: ["pedals", "clutch", "released"]
  },
  {
    text: "Fully PRESS the clutch. Release other pedals.",
    axis: 6,
    target: ["pedals", "clutch", "pressed"]
  }
];

export class WheelCalibrationWizard {
  constructor(input, menu) {
    this.input = input;
    this.menu = menu;

    this.stepIndex = 0;
    this.draft = null;
    this.busy = false;
    this.token = 0;
    this.lastCaptureError = null;

    this.element = document.createElement("section");
    this.element.className = "wheel-calibration";

    this.element.innerHTML = `
      <h3>V99 steering and pedal calibration</h3>

      <p class="settings-help">
        Uses your verified axis layout. The local game remains paused.
        Keep the shifter in neutral throughout calibration.
      </p>

      <div class="debug-actions">
        <button type="button" data-calibration="begin">
          Calibrate wheel
        </button>

        <button type="button" data-calibration="defaults">
          Restore default calibration
        </button>
      </div>

      <div data-calibration="wizard" hidden>
        <p data-calibration="instruction"></p>

        <div class="debug-actions">
          <button type="button" data-calibration="capture">
            Capture position
          </button>

          <button type="button" data-calibration="save" hidden>
            Save calibration
          </button>

          <button type="button" data-calibration="cancel">
            Cancel
          </button>
        </div>
      </div>

      <p data-calibration="status" role="status"></p>
    `;

    document.querySelector("#menu-controls").append(this.element);

    const get = name =>
      this.element.querySelector(
        `[data-calibration="${name}"]`
      );

    this.panel = get("wizard");
    this.instruction = get("instruction");
    this.status = get("status");
    this.captureButton = get("capture");
    this.saveButton = get("save");

    get("begin").addEventListener("click", () => {
      this.begin();
    });

    get("defaults").addEventListener("click", () => {
      this.restoreDefaults();
    });

    get("cancel").addEventListener("click", () => {
      this.cancel();
    });

    this.captureButton.addEventListener("click", () => {
      this.capture();
    });

    this.saveButton.addEventListener("click", () => {
      this.save();
    });

    // Cancel unfinished work when the settings dialog closes,
    // whether closed with ESC or the Resume button.
    this.menuObserver = new MutationObserver(() => {
      if (this.menu.element.hidden && this.draft) {
        this.cancel();
      }
    });

    this.menuObserver.observe(this.menu.element, {
      attributes: true,
      attributeFilter: ["hidden"]
    });
  }

  selectedPad() {
    const candidates = this.input.getGamepads()
      .filter(matchesV99Layout);

    if (candidates.length !== 1) {
      throw new Error(
        "Exactly one matching V99 must be connected. " +
        "Press a wheel button if needed."
      );
    }

    return candidates[0];
  }

  begin() {
    if (!this.menu.isOpen) return;

    try {
      this.selectedPad();
    } catch (error) {
      this.status.textContent = error.message;
      return;
    }

    // Invalidate any previous timed capture.
    this.token++;

    this.busy = false;
    this.stepIndex = 0;
    this.draft = defaultCalibration();
    this.lastCaptureError = null;

    this.input.disarm();

    this.panel.hidden = false;
    this.status.textContent =
      "Hold each requested position steady, then click Capture.";

    this.showStep();
  }

  showStep() {
    const step = STEPS[this.stepIndex];
    const finished = !step;

    this.captureButton.hidden = finished;
    this.captureButton.disabled = false;
    this.saveButton.hidden = !finished;

    this.instruction.textContent = finished
      ? "All positions captured. Release pedals and center steering."
      : `Step ${this.stepIndex + 1}/${STEPS.length}: ${step.text}`;
  }

  async capture() {
    if (
      this.busy ||
      !this.draft ||
      !this.menu.isOpen
    ) {
      return;
    }

    const step = STEPS[this.stepIndex];

    if (!step) return;

    this.busy = true;
    this.captureButton.disabled = true;
    this.status.textContent =
      "Measuring for 0.6 seconds—hold steady…";

    const token = ++this.token;

    try {
      const initialPad = this.selectedPad();
      const values = [];

      for (let sample = 0; sample < 7; sample++) {
        if (sample > 0) {
          await new Promise(resolve => {
            setTimeout(resolve, 100);
          });
        }

        if (
          token !== this.token ||
          !this.menu.isOpen ||
          document.hidden ||
          !document.hasFocus()
        ) {
          throw new Error(
            "Capture interrupted. Try again with the menu open."
          );
        }

        const pad = this.selectedPad();

        if (pad.index !== initialPad.index) {
          throw new Error("Device changed during capture.");
        }

        const rawValue = pad.axes[step.axis];
        const value = sanitizeAnalogAxis(rawValue);

        if (value === null) {
          const details = {
            step: this.stepIndex + 1,
            axis: step.axis,
            value: String(rawValue),
            deviceId: pad.id,
            deviceIndex: pad.index,
            mapping: pad.mapping,
            axes: Array.from(
              pad.axes,
              axisValue => String(axisValue)
            )
          };

          console.error(
            "Wheel calibration rejected a raw input:",
            details
          );

          this.lastCaptureError = details;

          throw new Error(
            `Axis ${step.axis} reported ${String(rawValue)}. ` +
            "Outside the permitted endpoint tolerance. " +
            `Raw axes: [${details.axes.join(", ")}]`
          );
        }

        // Tiny overshoot is sanitized before averaging and saving.
        values.push(value);
      }

      const minimum = Math.min(...values);
      const maximum = Math.max(...values);

      if (maximum - minimum > 0.03) {
        throw new Error(
          "The control moved during capture. Hold steady and retry."
        );
      }

      const average =
        values.reduce((sum, value) => sum + value, 0) /
        values.length;

      let destination = this.draft;

      for (const key of step.target.slice(0, -1)) {
        destination = destination[key];
      }

      destination[step.target.at(-1)] = average;

      this.stepIndex++;
      this.showStep();

      this.status.textContent =
        `Captured axis ${step.axis}: ${average.toFixed(4)}`;
    } catch (error) {
      if (token === this.token) {
        this.status.textContent = error.message;
      }
    } finally {
      if (token === this.token) {
        this.busy = false;
        this.captureButton.disabled = false;
      }
    }
  }

  apply(calibration) {
    const saved = saveWheelCalibration(calibration);

    this.input.v99Calibration = structuredClone(calibration);
    this.input.disarm();

    this.status.textContent = saved
      ? "Calibration saved. Resume, center steering, " +
        "release pedals, and select neutral."
      : "Calibration applied for this session. " +
        "Browser storage was unavailable.";
  }

  save() {
    if (
      !this.menu.isOpen ||
      !this.draft ||
      this.busy ||
      this.stepIndex !== STEPS.length
    ) {
      return;
    }

    const error = validateCalibration(this.draft);

    if (error) {
      this.status.textContent =
        `${error} Click Calibrate wheel to repeat the sequence.`;
      return;
    }

    this.apply(this.draft);

    this.draft = null;
    this.panel.hidden = true;
  }

  restoreDefaults() {
    if (!this.menu.isOpen) return;

    this.cancel();
    this.apply(defaultCalibration());
  }

  cancel() {
    this.token++;
    this.busy = false;
    this.draft = null;
    this.panel.hidden = true;

    this.status.textContent =
      "Calibration cancelled. Existing settings retained.";
  }
}