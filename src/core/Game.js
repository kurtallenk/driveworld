import * as THREE from "three";
import * as CANNON from "cannon-es";
import { InputManager } from "../input/InputManager.js";
import { ArcadeController } from "../vehicle/ArcadeController.js";
import { VehiclePhysics } from "../vehicle/VehiclePhysics.js";
import { Vehicle } from "../vehicle/Vehicle.js";
import { createWorld } from "../world/World.js";
import { ManualController } from "../vehicle/ManualController.js";
import { CameraManager } from "../camera/CameraManager.js";
import { AudioManager } from "../audio/AudioManager.js";
import { loadPresentationSettings,savePresentationSettings } from "./PresentationSettings.js";
import { SettingsMenu } from "../ui/SettingsMenu.js";
import { VehicleFeedback } from "../vehicle/VehicleFeedback.js";
import { WheelCalibrationWizard } from "../ui/WheelCalibrationWizard.js";
import { MobileControls } from "../ui/MobileControls.js";
import { DeliverySystem, DELIVERY_SYSTEM_ENABLED } from "../gameplay/DeliverySystem.js";
import { Turret } from "../turret/Turret.js";
import { TargetSystem } from "../turret/TargetSystem.js";

const PLAYER_COLORS = [
  "#ef5350", "#4285f4", "#58b76b", "#f5ce47",
  "#aa70d6", "#f29b43", "#ee83bd", "#50cad5"
];

const FIXED_DT = 1 / 60;

export class Game {
  constructor(canvas) {
    this.presentationSettings = loadPresentationSettings();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();

this.camera = new THREE.PerspectiveCamera(
  65,
  1,
  0.1,
  400
);

this.cameraRig = new CameraManager(
  this.camera,
  canvas,
  this.presentationSettings
);

this.audio = new AudioManager();

this.audio.volume =
  this.presentationSettings.masterVolume;

this.audio.engineVolume =
  this.presentationSettings.engineVolume;

this.audio.environmentVolume =
  this.presentationSettings.environmentVolume;

this.audio.effectsVolume =
  this.presentationSettings.effectsVolume;

    this.physics = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.81, 0)
    });
    this.physics.broadphase = new CANNON.SAPBroadphase(this.physics);
    this.physics.solver.iterations = 10;

    this.world = createWorld(this.scene, this.physics);

    // multiplayer.js assigns this once the socket client connects, so the
    // delivery system can report completions for the session leaderboard.
    this.multiplayer = null;

    this.deliverySystem = new DeliverySystem(this.scene, this.world.terrain);

    this.deliverySystem.onDelivery = () => {
      this.multiplayer?.reportDelivery();
    };

    this.deliveryStatusElement = document.querySelector("#delivery-status");
    this.deliveryCountElement = document.querySelector("#delivery-count");

    // Delivery UI stays in the DOM (see DeliverySystem's own
    // DELIVERY_SYSTEM_ENABLED flag) but is hidden outright while the
    // mini-game is disabled, freeing HUD space instead of showing a
    // permanently-idle status line.
    if (!DELIVERY_SYSTEM_ENABLED) {
      if (this.deliveryStatusElement) this.deliveryStatusElement.style.display = "none";
      if (this.deliveryCountElement) this.deliveryCountElement.style.display = "none";
    }

    // Phase 2 replaces this local assignment with server session data.
    this.player = {
      playerId: "local",
      vehicleId: "local-car",
      vehicleColor: PLAYER_COLORS[0]
    };

    this.vehiclePhysics = new VehiclePhysics(this.physics);
this.vehiclePhysics.body.addEventListener("collide", event => {
  const impactSpeed = Math.abs(
    event.contact.getImpactVelocityAlongNormal()
  );

  this.audio.playImpact(impactSpeed);
  this.cameraRig.notifyImpact(impactSpeed);

  // Destructible map objects tag their cannon-es body with `onImpact`
  // (see world/Destructibles.js) rather than the game needing to know
  // about destructible geometry/visuals at all.
  event.body.onImpact?.(impactSpeed);
});

    this.vehicle = new Vehicle(
      this.scene, this.vehiclePhysics, this.player.vehicleColor
    );

    this.targetSystem = new TargetSystem(
      this.scene, this.world.terrain, this.world.roads
    );

    this.turret = new Turret(
      this.vehicle.root, this.scene, this.audio, this.player.vehicleColor
    );

    this.turretStatusElement = document.querySelector("#turret-status");

    this.input = new InputManager();
    this.controller = new ArcadeController();

    this.manualController = new ManualController();
    this.vehicleFeedback = new VehicleFeedback();
this.drivingMode = "arcade";
this.engineStartRequested = false;

this.engineStateElement = document.querySelector("#engine-state");
this.drivingStatusElement = document.querySelector("#driving-status");

const arcadeButton = document.querySelector("#select-arcade");
const manualButton = document.querySelector("#select-manual");
const startEngineButton = document.querySelector("#start-engine");

arcadeButton.disabled = false;
manualButton.disabled = false;
startEngineButton.disabled = false;

arcadeButton.addEventListener("click", () => {
  this.setDrivingMode("arcade");
});

manualButton.addEventListener("click", () => {
  this.setDrivingMode("manual");
});

startEngineButton.addEventListener("click", () => {
  if (this.drivingMode !== "manual") {
    this.drivingStatusElement.textContent =
      "Engine starting is available in Realistic Prototype mode.";
    return;
  }

  this.engineStartRequested = true;
});

// Presentation controls: camera, audio, and visual vibration.
const cameraButton = document.querySelector("#camera-toggle");
const audioButton = document.querySelector("#enable-audio");
const volumeSlider = document.querySelector("#master-volume");
const vibrationCheckbox = document.querySelector("#camera-vibration");
const presentationStatus =
  document.querySelector("#presentation-status");

cameraButton.disabled = false;
audioButton.disabled = false;

cameraButton.addEventListener("click", () => {
  this.cameraRig.toggle();
});

audioButton.addEventListener("click", async () => {
  try {
    const enabled = await this.audio.enable();

    audioButton.textContent = enabled
      ? "Resume audio"
      : "Enable audio";

    presentationStatus.textContent = enabled
      ? "Audio enabled · Driver View: C · Right-drag to look around"
      : "Audio is suspended. Click again to resume.";
  } catch (error) {
    presentationStatus.textContent =
      `Audio could not start: ${error.message}`;
  }
});

const settingsSaveStatus =
  document.querySelector("#settings-save-status");

const saveSettings = () => {
  const saved = savePresentationSettings(this.presentationSettings);

  settingsSaveStatus.textContent = saved
    ? "Settings saved on this browser."
    : "Storage unavailable. Settings apply for this session only.";
};

volumeSlider.value =
  String(this.presentationSettings.masterVolume);

vibrationCheckbox.checked =
  this.presentationSettings.vibrationEnabled;

volumeSlider.addEventListener("input", () => {
  const value = Number(volumeSlider.value);

  this.presentationSettings.masterVolume = value;
  this.audio.volume = value;
});

// Save when the user finishes adjusting, not on every slider event.
volumeSlider.addEventListener("change", saveSettings);

vibrationCheckbox.addEventListener("change", () => {
  this.presentationSettings.vibrationEnabled =
    vibrationCheckbox.checked;

  saveSettings();
});

document.querySelectorAll("[data-presentation]").forEach(slider => {
  const key = slider.dataset.presentation;

  slider.value = String(this.presentationSettings[key]);

  slider.addEventListener("input", () => {
    this.presentationSettings[key] = Number(slider.value);

    this.audio.engineVolume =
      this.presentationSettings.engineVolume;

    this.audio.environmentVolume =
      this.presentationSettings.environmentVolume;

    this.audio.effectsVolume =
      this.presentationSettings.effectsVolume;
  });

  slider.addEventListener("change", saveSettings);
});



    this.controlStatusElement =
  document.querySelector("#control-status");

const enableV99Button = document.querySelector("#enable-v99");
const keyboardButton = document.querySelector("#use-keyboard");
const mobileButton = document.querySelector("#use-mobile");

enableV99Button.disabled = false;
keyboardButton.disabled = false;

enableV99Button.addEventListener("click", () => {
  this.input.enableV99();
  this.mobileControls?.setActive(false);
});

keyboardButton.addEventListener("click", () => {
  this.input.useKeyboard();
  this.mobileControls?.setActive(false);
});

if (mobileButton) {
  mobileButton.disabled = false;

  mobileButton.addEventListener("click", () => {
    this.input.enableMobile();
    this.mobileControls?.setActive(true);
  });
}

    this.speedElement = document.querySelector("#speed");
    this.gearElement = document.querySelector("#gear");
    this.debugElement = document.querySelector("#input-debug");

    this.accumulator = 0;
    this.lastTime = null;
    this.lastHudTime = -Infinity;

    this.resize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", this.resize);
    this.resize();

    this.frame = this.frame.bind(this);
    this.menu = new SettingsMenu();

    this.wheelCalibrationWizard = new WheelCalibrationWizard(
  this.input,
  this.menu
);

    this.mobileControls = new MobileControls(this.input);

    // Touch-primary devices default straight into touch controls;
    // desktop with a mouse/trackpad keeps the existing keyboard default.
    if (this.mobileControls.isTouchDevice) {
      this.input.enableMobile();
      this.mobileControls.setActive(true);
      this.mobileControls.setDrivingMode(this.drivingMode);
    }
  }

  setDrivingMode(mode) {
  if (this.vehiclePhysics.body.velocity.length() > 0.5) {
    this.drivingStatusElement.textContent =
      "Stop the vehicle before switching driving modes.";
    return;
  }

  if (mode === "manual" && !this.input.isManualCapable()) {
    this.drivingStatusElement.textContent =
      "Enable your V99 profile or touch controls before selecting Realistic Prototype.";
    return;
  }

  this.drivingMode = mode;
  this.controller.reset();
  this.manualController.reset();
  this.engineStartRequested = false;

  this.drivingStatusElement.textContent = mode === "manual"
    ? "Manual selected. Activate wheel, select neutral, then start engine."
    : "Arcade selected.";

  this.mobileControls?.setDrivingMode(mode);
}

  start() {
    this.renderer.setAnimationLoop(this.frame);
  }

  frame(timeMs) {

    if (this.menu.isOpen) {
  this.lastTime = null;
  this.accumulator = 0;

  this.input.keys.clear();
  this.input.resetRequested = false;
  this.input.turretToggleRequested = false;
  this.input.disarm();

  if (this.audio.context) {
    this.audio.master.gain.setTargetAtTime(
      0,
      this.audio.context.currentTime,
      0.03
    );
  }

  // Keep drawing the initialized scene, but do not advance simulation.
  this.renderer.render(this.scene, this.camera);
  return;
}

    if (document.hidden) {
      this.lastTime = null;
      this.accumulator = 0;
      return;
    }

    const dt = this.lastTime === null
      ? 0
      : Math.min((timeMs - this.lastTime) / 1000, 0.1);

    this.lastTime = timeMs;
    this.accumulator += dt;

    const input = this.input.sample();

    if (this.input.consumeTurretToggle()) {
      this.turret.toggle();
    }

    if (this.input.consumeReset()) {
        this.vehiclePhysics.reset();
        this.controller.reset();
        this.manualController.reset();
        this.vehicleFeedback.reset();

        this.engineStartRequested = false;
        this.cameraRig.reset();
        this.accumulator = 0;
    }

    // Keep every remote player's collider where it's currently being
    // rendered before stepping physics against it this frame.
    this.multiplayer?.syncPhysics();

    while (this.accumulator >= FIXED_DT) {
  // "wheelActive" here means "a source capable of clutch + H-shifter
  // input is currently live" — the physical wheel or touch controls.
  const wheelActive =
    this.input.activeSource === "PXN V99" ||
    this.input.activeSource === "Mobile Touch";
  const signedSpeed = this.vehiclePhysics.signedSpeed;

  if (this.engineStartRequested) {
    this.engineStartRequested = false;

    if (this.drivingMode === "manual") {
      this.manualController.startEngine(
        input,
        this.input.shifter,
        wheelActive
      );
    }
  }

  const controls = this.drivingMode === "manual"
    ? this.manualController.update(
        input,
        signedSpeed,
        this.input.shifter,
        wheelActive,
        FIXED_DT
      )
    : this.controller.update(
        input,
        signedSpeed,
        FIXED_DT
      );

  this.vehiclePhysics.applyControls(controls);
  this.physics.step(FIXED_DT);
  this.accumulator -= FIXED_DT;
}

    this.vehicle.sync();
    this.deliverySystem.update(this.vehiclePhysics.body.position, dt);
    this.world.destructibles.update(dt);

    this.targetSystem.update(dt, this.vehiclePhysics.body.position);
    this.turret.update(dt, this.targetSystem);

const speed = this.vehiclePhysics.body.velocity.length();
const manual = this.drivingMode === "manual";
const drivetrain = this.manualController.drivetrain;

// Arcade does not simulate engine RPM yet.
// This value is only an audio/presentation estimate.
const presentationRPM = manual
  ? drivetrain.rpm
  : Math.min(5500, 900 + speed * 100 + input.throttle * 800);

const engineRunning = manual
  ? drivetrain.engineRunning
  : true;

const selectedGear = manual
  ? drivetrain.engagedGear
  : this.controller.direction;

const gearLabel = selectedGear === -1
  ? "R"
  : selectedGear === 0
    ? "N"
    : manual
      ? String(selectedGear)
      : "D";

const feedback = this.vehicleFeedback.update({
  manual,
  engineRunning,
  rpm: presentationRPM,
  engagedGear: selectedGear,
  clutchTorque: manual ? drivetrain.clutchTorque : 0,
  signedSpeed: this.vehiclePhysics.signedSpeed,
  suspensionLengths:
    this.vehiclePhysics.vehicle.wheelInfos.map(wheel =>
      wheel.isInContact ? wheel.suspensionLength : null
    )
}, dt);

const lugging = feedback.lugging;

// First grounded wheel is a simple initial surface estimate.
const contactWheel = this.vehiclePhysics.vehicle.wheelInfos.find(
  wheel => wheel.isInContact
);

const contactBody = contactWheel?.raycastResult.body;

const surface = contactBody?.surfaceAt
  ? contactBody.surfaceAt(contactWheel.raycastResult.hitPointWorld)
  : contactBody?.surface ?? "asphalt";

let slip = 0;

for (const wheel of this.vehiclePhysics.vehicle.wheelInfos) {
  if (!wheel.isInContact || !Number.isFinite(wheel.skidInfo)) {
    continue;
  }

  // Cannon's solver grip-limit indicator, not a true tire slip ratio.
  slip = Math.max(
    slip,
    Math.max(0, Math.min(1, 1 - wheel.skidInfo))
  );
}

this.vehicle.updatePresentation({
  steering: input.steering,
  speedKmh: speed * 3.6,
  rpm: presentationRPM,
  gear: gearLabel,
  manual
}, timeMs);

this.cameraRig.update(
  this.vehicle,
  dt,
  timeMs / 1000,
  lugging,
  feedback.acceleration
);

this.audio.update({
  rpm: presentationRPM,
  throttle: input.throttle,
  speed: contactWheel ? speed : 0,
  engineRunning,
  gear: `${this.drivingMode}:${selectedGear}`,
  surface,
  driverView: this.cameraRig.mode === "driver",
  lugging,
  slip
});

this.audio.playFeedback(feedback.events);

this.renderer.render(this.scene, this.camera);

    if (timeMs - this.lastHudTime >= 100) {
      const speed = this.vehiclePhysics.body.velocity.length() * 3.6;
      this.speedElement.textContent = `${Math.round(speed)} km/h`;
      if (this.drivingMode === "manual") {
  const drivetrain = this.manualController.drivetrain;
  const state = this.manualController.telemetry;

  const gearLabel = gear =>
    gear === -1 ? "R" : gear === 0 ? "N" : String(gear);

  this.gearElement.textContent =
    `REALISTIC PROTOTYPE · ${gearLabel(drivetrain.engagedGear)}`;

  this.engineStateElement.textContent =
    `${Math.round(drivetrain.rpm)} RPM · ` +
    `${drivetrain.engineRunning ? "RUNNING" : "STOPPED"} · ` +
    `Clutch ${Math.round(input.clutch * 100)}%`;

  this.drivingStatusElement.textContent =
    state?.message ?? drivetrain.message;
} else {
  this.gearElement.textContent =
    `ARCADE · ${this.controller.direction === -1 ? "R" : "D"}`;

  this.engineStateElement.textContent = "Arcade drivetrain";
}

      this.controlStatusElement.textContent = [
  this.input.status,
  this.input.storageWarning
].filter(Boolean).join(" ");

if (DELIVERY_SYSTEM_ENABLED) {
  this.deliveryStatusElement.textContent = this.deliverySystem.statusText;
  this.deliveryCountElement.textContent =
    `Deliveries: ${this.deliverySystem.deliveries} · Score: ${this.deliverySystem.score}`;
}

if (this.turretStatusElement) {
  this.turretStatusElement.textContent = this.turret.statusText;
}

this.debugElement.textContent = JSON.stringify({
  activeInput: this.input.activeSource,
  selectedMode: this.input.mode,
  controlStatus: this.input.status,
  drivingMode: this.drivingMode,
  normalized: input,
  hShifter: this.input.shifter,
  drivetrain:
    this.drivingMode === "manual"
      ? this.manualController.telemetry
      : null,
  devices: this.input.inspectDevices()
}, null, 2);

      this.lastHudTime = timeMs;
    }
  }
}