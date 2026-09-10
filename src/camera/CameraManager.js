import * as THREE from "three";

import { ThirdPersonCamera } from "./ThirdPersonCamera.js";
import { CameraObstacleAvoidance } from "./CameraObstacleAvoidance.js";

const SEAT_STORAGE_KEY = "driveworld.prototype-car-seat.v1";

const DEFAULT_CAMERA_SETTINGS = {
  driverFov: 72,
  chaseFov: 65,
  cameraDistance: 7.5,
  cameraHeight: 3.2,
  lookSensitivity: 0.003,
  vibrationEnabled: true
};

const DEFAULT_SEAT = {
  height: 0,
  forward: 0
};

function boundedNumber(value, fallback, min, max) {
  return Number.isFinite(value)
    ? THREE.MathUtils.clamp(value, min, max)
    : fallback;
}

function loadSeatPosition() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(SEAT_STORAGE_KEY)
    );

    if (saved?.version !== 1) {
      return { ...DEFAULT_SEAT };
    }

    return {
      height: boundedNumber(saved.height, 0, -0.08, 0.1),
      forward: boundedNumber(saved.forward, 0, -0.12, 0.1)
    };
  } catch {
    return { ...DEFAULT_SEAT };
  }
}

function saveSeatPosition(seat) {
  try {
    localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify({
      version: 1,
      height: seat.height,
      forward: seat.forward
    }));

    return true;
  } catch {
    return false;
  }
}

export class CameraManager {
  constructor(camera, canvas, settings = DEFAULT_CAMERA_SETTINGS) {
    this.camera = camera;
    this.canvas = canvas;

    // Keep the provided settings object by reference.
    // Existing menu sliders update this same object.
    this.settings = settings;

    this.chase = new ThirdPersonCamera(camera);
    this.obstacleAvoidance = new CameraObstacleAvoidance();

    this.mode = "third";
    this.vibrationEnabled = true;

    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;

    this.dragging = false;
    this.pointerId = null;
    this.lastPointerX = 0;
    this.lastPointerY = 0;

    this.seat = loadSeatPosition();

    this.eye = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();

    this.lookRotation = new THREE.Quaternion();
    this.lookEuler = new THREE.Euler(0, 0, 0, "YXZ");

    this.direction = new THREE.Vector3();
    this.target = new THREE.Vector3();

    this.seatOffset = new THREE.Vector3();
    this.headOffset = new THREE.Vector3();
    this.desiredHeadOffset = new THREE.Vector3();
    this.feedbackOffset = new THREE.Vector3();

    this.impactAmount = 0;

    this.registerInput();

    // The HTML already exists when Game constructs this manager.
    // SettingsMenu later moves presentation-status into its menu.
    this.createSeatControls();

    this.reset();
  }

  registerInput() {
    window.addEventListener("keydown", event => {
      const element = event.target;

      const editing =
        element instanceof HTMLElement &&
        (
          element.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
        );

      if (editing || event.repeat) return;

      if (event.code === "KeyC") {
        event.preventDefault();
        this.toggle();
      }
    });

    this.canvas.addEventListener("contextmenu", event => {
      event.preventDefault();
    });

    this.canvas.addEventListener("pointerdown", event => {
      if (event.button !== 2 || this.mode !== "driver") return;

      event.preventDefault();

      this.dragging = true;
      this.pointerId = event.pointerId;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;

      this.canvas.setPointerCapture(event.pointerId);
    });

    this.canvas.addEventListener("pointermove", event => {
      if (
        !this.dragging ||
        this.mode !== "driver" ||
        event.pointerId !== this.pointerId
      ) {
        return;
      }

      const deltaX = event.clientX - this.lastPointerX;
      const deltaY = event.clientY - this.lastPointerY;

      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;

      const sensitivity = boundedNumber(
        this.settings.lookSensitivity,
        0.003,
        0.001,
        0.008
      );

      // Looking along chassis +Z:
      // negative yaw looks toward the driver's right.
      this.targetYaw = THREE.MathUtils.clamp(
        this.targetYaw - deltaX * sensitivity,
        -1.4,
        1.4
      );

      this.targetPitch = THREE.MathUtils.clamp(
        this.targetPitch + deltaY * sensitivity,
        -0.55,
        0.55
      );
    });

    this.canvas.addEventListener("pointerup", event => {
      if (event.pointerId === this.pointerId) {
        this.stopDragging();
      }
    });

    this.canvas.addEventListener("pointercancel", () => {
      this.stopDragging();
    });

    this.canvas.addEventListener("lostpointercapture", () => {
      this.dragging = false;
      this.pointerId = null;
    });

    this.canvas.addEventListener("dblclick", event => {
      if (event.button !== 0 || this.mode !== "driver") return;
      this.centerLook();
    });

    window.addEventListener("blur", () => {
      this.stopDragging();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stopDragging();
    });
  }

  stopDragging() {
    const pointerId = this.pointerId;

    this.dragging = false;
    this.pointerId = null;

    if (
      pointerId !== null &&
      this.canvas.hasPointerCapture(pointerId)
    ) {
      this.canvas.releasePointerCapture(pointerId);
    }
  }

  centerLook() {
    this.targetYaw = 0;
    this.targetPitch = 0;
  }

  toggle() {
    this.mode = this.mode === "third" ? "driver" : "third";
    this.reset();
  }

  notifyImpact(impactSpeed) {
    if (!Number.isFinite(impactSpeed) || impactSpeed < 1.5) return;

    this.impactAmount = Math.max(
      this.impactAmount,
      THREE.MathUtils.clamp(
        (impactSpeed - 1.5) / 12,
        0,
        1
      )
    );
  }

  reset() {
    this.stopDragging();

    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;

    this.headOffset.set(0, 0, 0);
    this.impactAmount = 0;

    this.chase.reset();

    this.camera.fov = this.getFov();
    this.camera.near = this.mode === "driver" ? 0.03 : 0.1;
    this.camera.up.set(0, 1, 0);
    this.camera.updateProjectionMatrix();
  }

  getFov() {
    return this.mode === "driver"
      ? boundedNumber(this.settings.driverFov, 72, 50, 100)
      : boundedNumber(this.settings.chaseFov, 65, 50, 100);
  }

  createSeatControls() {
    const statusElement = document.querySelector(
      "#presentation-status"
    );

    if (!statusElement) return;

    // Place beside the existing presentation status. Once SettingsMenu
    // moves that node, move this panel into the same menu destination.
    const panel = document.createElement("section");
    panel.className = "presentation-options";

    panel.innerHTML = `
      <h3>Driver seat</h3>

      <label class="presentation-setting">
        Seat height
        <input
          data-seat="height"
          type="range"
          min="-0.08"
          max="0.10"
          step="0.005"
        />
        <output data-seat-output="height"></output>
      </label>

      <label class="presentation-setting">
        Forward / back
        <input
          data-seat="forward"
          type="range"
          min="-0.12"
          max="0.10"
          step="0.005"
        />
        <output data-seat-output="forward"></output>
      </label>

      <div class="debug-actions">
        <button type="button" data-seat-action="center">
          Look forward
        </button>
        <button type="button" data-seat-action="reset">
          Reset seat
        </button>
      </div>

      <p class="settings-help">
        Positive height raises your eyes. Positive forward moves toward
        the dashboard. These offsets do not move the physical car.
        Double-click the game view to look forward.
      </p>

      <p data-seat-status role="status"></p>
    `;

    // Game construction is synchronous. This runs after SettingsMenu
    // has been constructed and moved the existing presentation controls.
    queueMicrotask(() => {
      const destination =
        document.querySelector("#menu-presentation") ||
        statusElement.parentElement;

      destination?.append(panel);
    });

    const status = panel.querySelector("[data-seat-status]");

    const updateLabels = () => {
      for (const key of ["height", "forward"]) {
        const slider = panel.querySelector(`[data-seat="${key}"]`);
        const output = panel.querySelector(
          `[data-seat-output="${key}"]`
        );

        slider.value = String(this.seat[key]);

        const centimeters = Math.round(this.seat[key] * 100);
        output.textContent =
          `${centimeters > 0 ? "+" : ""}${centimeters} cm`;
      }
    };

    const save = () => {
      status.textContent = saveSeatPosition(this.seat)
        ? "Seat position saved for this prototype vehicle."
        : "Storage unavailable. Seat position applies for this session.";
    };

    for (const key of ["height", "forward"]) {
      const slider = panel.querySelector(`[data-seat="${key}"]`);

      slider.addEventListener("input", () => {
        this.seat[key] = Number(slider.value);
        updateLabels();
      });

      slider.addEventListener("change", save);
    }

    panel.querySelector('[data-seat-action="center"]')
      .addEventListener("click", () => {
        this.centerLook();
        status.textContent = "Look direction will center when you resume.";
      });

    panel.querySelector('[data-seat-action="reset"]')
      .addEventListener("click", () => {
        this.seat = { ...DEFAULT_SEAT };
        updateLabels();
        save();
      });

    updateLabels();
  }

  update(
    vehicle,
    dt,
    timeSeconds,
    lugging = 0,
    acceleration = 0
  ) {
    dt = boundedNumber(dt, 0, 0, 0.1);

    this.impactAmount *= Math.exp(-7 * dt);

    const desiredFov = this.getFov();

    if (this.camera.fov !== desiredFov) {
      this.camera.fov = desiredFov;
      this.camera.updateProjectionMatrix();
    }

    this.vibrationEnabled = this.settings.vibrationEnabled !== false;

    if (this.mode === "third") {
      this.camera.up.set(0, 1, 0);

      this.chase.offset.set(
        0,
        boundedNumber(this.settings.cameraHeight, 3.2, 1.5, 6),
        -boundedNumber(this.settings.cameraDistance, 7.5, 4, 14)
      );

      this.chase.update(vehicle.root, dt);
      this.obstacleAvoidance.resolve(this.camera, vehicle);
      this.camera.lookAt(this.chase.lookPoint);
      return;
    }

    vehicle.root.updateMatrixWorld(true);
    vehicle.driverEye.getWorldPosition(this.eye);
    vehicle.driverEye.getWorldQuaternion(this.rotation);

    // Keep the corrected left/right seat placement from Vehicle.js.
    // Only add a local vertical and forward/back offset.
    this.seatOffset.set(
      0,
      this.seat.height,
      this.seat.forward
    ).applyQuaternion(this.rotation);

    this.eye.add(this.seatOffset);

    const amount = this.vibrationEnabled
      ? boundedNumber(lugging, 0, 0, 1)
      : 0;

    if (this.vibrationEnabled) {
      const safeAcceleration = boundedNumber(
        acceleration,
        0,
        -15,
        15
      );

      this.desiredHeadOffset.set(
        0,
        0,
        THREE.MathUtils.clamp(
          -safeAcceleration * 0.002,
          -0.015,
          0.015
        )
      );

      this.headOffset.lerp(
        this.desiredHeadOffset,
        1 - Math.exp(-10 * dt)
      );
    } else {
      this.headOffset.set(0, 0, 0);
    }

    const impact = this.vibrationEnabled
      ? this.impactAmount
      : 0;

    this.feedbackOffset.copy(this.headOffset);

    this.feedbackOffset.x +=
      Math.sin(timeSeconds * 83) * 0.002 * amount +
      Math.sin(timeSeconds * 41) * 0.006 * impact;

    this.feedbackOffset.y +=
      Math.sin(timeSeconds * 107) * 0.003 * amount +
      Math.sin(timeSeconds * 53) * 0.008 * impact;

    this.feedbackOffset.applyQuaternion(this.rotation);

    this.camera.position.copy(this.eye).add(this.feedbackOffset);

    const lookBlend = 1 - Math.exp(-16 * dt);

    this.yaw += (this.targetYaw - this.yaw) * lookBlend;
    this.pitch += (this.targetPitch - this.pitch) * lookBlend;

    this.lookEuler.set(this.pitch, this.yaw, 0);
    this.lookRotation.setFromEuler(this.lookEuler);

    this.direction.set(0, 0, 1)
      .applyQuaternion(this.lookRotation)
      .applyQuaternion(this.rotation);

    this.target.copy(this.camera.position).add(this.direction);

    this.camera.up.set(0, 1, 0).applyQuaternion(this.rotation);
    this.camera.lookAt(this.target);
  }
}