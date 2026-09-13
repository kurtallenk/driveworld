// Touch driving controls layer. Feeds the same InputManager the
// keyboard/wheel already use (see InputManager.enableMobile/sample) —
// this module never talks to the vehicle/transmission directly.

const GEAR_LABEL = gear =>
  gear === -1 ? "R" : gear === 0 ? "N" : String(gear);

// Column layout for the H-pattern: [up gear, down gear|null].
const SHIFTER_LANES = [
  [1, 2],
  [3, 4],
  [5, 6],
  [-1, null]
];

export class MobileControls {
  constructor(input) {
    this.input = input;
    this.active = false;
    this.mode = "arcade";

    this.isTouchDevice = Boolean(
      window.matchMedia?.("(pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0
    );

    this.pointers = new Map(); // pointerId -> control name, for isolation
    this.steeringValue = 0;
    this.steeringAnimId = null;
    this.shifterGear = 0;

    this.buildDOM();
    this.bindSteering();
    this.bindPedal(this.accelEl, "throttle");
    this.bindPedal(this.brakeEl, "brake");
    this.bindPedal(this.clutchEl, "clutch");
    this.bindShifter();
    this.bindTurret();
    this.bindTurbo();
    this.bindOrientation();

    this.root.hidden = true;
  }

  buildDOM() {
    this.root = document.createElement("div");
    this.root.id = "mobile-controls";
    this.root.setAttribute("aria-hidden", "true");

    // Left: steering pad.
    this.steeringEl = document.createElement("div");
    this.steeringEl.className = "mc-steering";
    this.steeringEl.innerHTML =
      '<div class="mc-steering-track"><div class="mc-steering-knob"></div></div>';
    this.steeringKnob = this.steeringEl.querySelector(".mc-steering-knob");

    // Right: pedal stack.
    this.pedalsEl = document.createElement("div");
    this.pedalsEl.className = "mc-pedals";

    this.clutchEl = this.makePedal("CLUTCH", "mc-pedal-clutch", "◆");
    this.brakeEl = this.makePedal("BRAKE", "mc-pedal-brake", "■");
    this.accelEl = this.makePedal("GAS", "mc-pedal-accel", "▲");

    this.pedalsEl.append(this.clutchEl, this.brakeEl, this.accelEl);

    // Turret deploy button, stacked directly above the pedal column so it
    // shares the bottom-right zone without ever overlapping a pedal's own
    // hit area. Always visible (arcade and manual alike) since turret
    // deployment isn't tied to driving mode.
    this.turretEl = document.createElement("button");
    this.turretEl.type = "button";
    this.turretEl.className = "mc-turret-btn";
    this.turretEl.setAttribute("aria-label", "Deploy turret");
    this.turretEl.innerHTML =
      '<span class="mc-turret-icon" aria-hidden="true">&#8982;</span>' +
      '<span class="mc-turret-text">TURRET</span>';

    // Turbo/boost button. Unlike the turret button (a tap-triggered
    // toggle), this one is press-and-hold -- same held semantics as
    // desktop SHIFT (see InputManager.isTurboRequested) -- and shows the
    // ready/active/cooldown state driven by Game via setTurboState().
    this.turboEl = document.createElement("button");
    this.turboEl.type = "button";
    this.turboEl.className = "mc-turbo-btn";
    this.turboEl.setAttribute("aria-label", "Turbo boost");
    this.turboEl.innerHTML =
      '<span class="mc-turbo-icon" aria-hidden="true">&#9889;</span>' +
      '<span class="mc-turbo-text">TURBO</span>';

    // Groups the turbo/turret buttons with the pedal stack under one fixed
    // bottom-right anchor, so the group reflows together instead of each
    // button needing its own separately-tuned position.
    this.rightClusterEl = document.createElement("div");
    this.rightClusterEl.className = "mc-right-cluster";
    this.rightClusterEl.append(this.turboEl, this.turretEl, this.pedalsEl);

    // Bottom center: H-shifter (manual mode only).
    this.shifterEl = document.createElement("div");
    this.shifterEl.className = "mc-shifter";
    this.shifterEl.innerHTML = `
      <svg class="mc-shifter-track" viewBox="0 0 200 130" aria-hidden="true">
        <line x1="25" y1="65" x2="175" y2="65" class="mc-shifter-rail"/>
        <line x1="25" y1="25" x2="25" y2="105" class="mc-shifter-rail"/>
        <line x1="75" y1="25" x2="75" y2="105" class="mc-shifter-rail"/>
        <line x1="125" y1="25" x2="125" y2="105" class="mc-shifter-rail"/>
        <line x1="175" y1="25" x2="175" y2="65" class="mc-shifter-rail"/>
        <text x="25" y="18" class="mc-shifter-label">1</text>
        <text x="25" y="118" class="mc-shifter-label">2</text>
        <text x="75" y="18" class="mc-shifter-label">3</text>
        <text x="75" y="118" class="mc-shifter-label">4</text>
        <text x="125" y="18" class="mc-shifter-label">5</text>
        <text x="125" y="118" class="mc-shifter-label">6</text>
        <text x="175" y="18" class="mc-shifter-label">R</text>
      </svg>
      <div class="mc-shifter-knob"></div>
      <div class="mc-shifter-gear">N</div>
    `;
    this.shifterKnob = this.shifterEl.querySelector(".mc-shifter-knob");
    this.shifterGearLabel = this.shifterEl.querySelector(".mc-shifter-gear");

    // Rotate-device overlay for when landscape is required but unavailable.
    this.orientationEl = document.createElement("div");
    this.orientationEl.className = "mc-orientation-overlay";
    this.orientationEl.innerHTML = `
      <div class="mc-orientation-icon">⟳</div>
      <p>Rotate your device<br><span>for the best driving experience</span></p>
    `;

    this.root.append(
      this.steeringEl,
      this.rightClusterEl,
      this.shifterEl,
      this.orientationEl
    );

    document.body.append(this.root);
  }

  makePedal(label, className, icon = "") {
    const el = document.createElement("div");
    el.className = `mc-pedal ${className}`;
    el.innerHTML = icon
      ? `<span class="mc-pedal-icon" aria-hidden="true">${icon}</span>` +
        `<span class="mc-pedal-label">${label}</span>`
      : `<span class="mc-pedal-label">${label}</span>`;
    return el;
  }

  setActive(active) {
    // isTouchDevice only gates the automatic default in Game's
    // constructor; an explicit "Use touch controls" click should
    // always show the layer — otherwise clicking it would silently
    // switch input.mode to "mobile" with no visible way to drive.
    this.active = active;
    this.root.hidden = !this.active;
    document.body.classList.toggle("mobile-controls-active", this.active);

    if (!this.active) {
      this.releaseAllPedals();
      this.resetSteering();
      this.input.setMobileTurboHeld(false);
    } else {
      requestAnimationFrame(() => this.centerShifterKnob?.());
    }
  }

  setDrivingMode(mode) {
    this.mode = mode;
    const manual = mode === "manual";

    this.clutchEl.hidden = !manual;
    this.shifterEl.hidden = !manual;

    if (!manual) {
      this.clutchEl.classList.remove("mc-pressed");
      this.input.setMobileInput({ clutch: 0 });
      this.snapShifterTo(0);
    }
  }

  // ---- Steering ----------------------------------------------------

  bindSteering() {
    const track = this.steeringEl.querySelector(".mc-steering-track");
    let startX = 0;
    let pointerId = null;

    const move = clientX => {
      const rect = track.getBoundingClientRect();
      const radius = rect.width / 2;
      const delta = clientX - startX;
      const value = Math.max(-1, Math.min(1, delta / radius));

      this.steeringValue = value;
      this.steeringKnob.style.transform =
        `translateX(${value * radius * 0.6}px)`;
      this.input.setMobileInput({ steering: value });
    };

    track.addEventListener("pointerdown", event => {
      if (pointerId !== null) return;

      pointerId = event.pointerId;
      startX = event.clientX - this.steeringValue *
        (track.getBoundingClientRect().width / 2);

      track.setPointerCapture(pointerId);
      cancelAnimationFrame(this.steeringAnimId);
      move(event.clientX);
    });

    track.addEventListener("pointermove", event => {
      if (event.pointerId !== pointerId) return;
      move(event.clientX);
    });

    const release = event => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      this.animateSteeringToCenter();
    };

    track.addEventListener("pointerup", release);
    track.addEventListener("pointercancel", release);
  }

  animateSteeringToCenter() {
    const track = this.steeringEl.querySelector(".mc-steering-track");
    const radius = track.getBoundingClientRect().width / 2;

    const step = () => {
      this.steeringValue *= 0.78;

      if (Math.abs(this.steeringValue) < 0.01) {
        this.steeringValue = 0;
        this.steeringKnob.style.transform = "translateX(0px)";
        this.input.setMobileInput({ steering: 0 });
        return;
      }

      this.steeringKnob.style.transform =
        `translateX(${this.steeringValue * radius * 0.6}px)`;
      this.input.setMobileInput({ steering: this.steeringValue });
      this.steeringAnimId = requestAnimationFrame(step);
    };

    this.steeringAnimId = requestAnimationFrame(step);
  }

  resetSteering() {
    cancelAnimationFrame(this.steeringAnimId);
    this.steeringValue = 0;
    this.steeringKnob.style.transform = "translateX(0px)";
    this.input.setMobileInput({ steering: 0 });
  }

  // ---- Pedals --------------------------------------------------------

  bindPedal(el, axisName) {
    let pointerId = null;

    const press = event => {
      // A pedal only ever tracks the finger that pressed it; a second
      // finger landing on it while held is ignored rather than
      // stealing/duplicating the control.
      if (pointerId !== null) return;

      pointerId = event.pointerId;
      el.setPointerCapture(pointerId);
      el.classList.add("mc-pressed");
      this.input.setMobileInput({ [axisName]: 1 });
    };

    const release = event => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      el.classList.remove("mc-pressed");
      this.input.setMobileInput({ [axisName]: 0 });
    };

    el.addEventListener("pointerdown", press);
    el.addEventListener("pointerup", release);
    // Losing the pointer (finger slides off-screen, gesture interrupted,
    // OS takes over) must release the pedal — never leave it stuck.
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
  }

  releaseAllPedals() {
    for (const [el, axis] of [
      [this.accelEl, "throttle"],
      [this.brakeEl, "brake"],
      [this.clutchEl, "clutch"]
    ]) {
      el.classList.remove("mc-pressed");
      this.input.setMobileInput({ [axis]: 0 });
    }
  }

  // ---- Turret --------------------------------------------------------

  bindTurret() {
    const el = this.turretEl;
    let pointerId = null;

    // A tap requests exactly one toggle via InputManager.requestTurretToggle
    // -- the same edge-triggered flag the KeyF keyboard binding sets (see
    // InputManager) -- so this button drives the existing turret toggle
    // instead of a second, competing turret trigger.
    const press = event => {
      if (pointerId !== null) return;

      pointerId = event.pointerId;
      el.setPointerCapture(pointerId);
      el.classList.add("mc-pressed");
      this.input.requestTurretToggle();
    };

    const release = event => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      el.classList.remove("mc-pressed");
    };

    el.addEventListener("pointerdown", press);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
  }

  // ---- Turbo -----------------------------------------------------------

  bindTurbo() {
    const el = this.turboEl;
    let pointerId = null;

    // Press/release drives InputManager.mobileTurboHeld directly -- the
    // same held-while-pressed pattern as the pedals above, since turbo
    // (unlike the turret) needs to stay active for as long as the button
    // is down, not just fire once per tap.
    const press = event => {
      if (pointerId !== null) return;

      pointerId = event.pointerId;
      el.setPointerCapture(pointerId);
      this.input.setMobileTurboHeld(true);
    };

    const release = event => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      this.input.setMobileTurboHeld(false);
    };

    el.addEventListener("pointerdown", press);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
  }

  // Called by Game once per HUD tick with the shared TurboSystem's current
  // state, so desktop's dashboard pill and this button always agree --
  // there is exactly one turbo state machine (see TurboSystem.js), this
  // just reflects it visually.
  setTurboState(state, cooldownFraction = 0) {
    this.turboEl.classList.toggle("mc-turbo-btn--active", state === "active");
    this.turboEl.classList.toggle("mc-turbo-btn--cooldown", state === "cooldown");

    this.turboEl.style.setProperty(
      "--mc-turbo-cooldown-frac",
      String(state === "cooldown" ? cooldownFraction : 0)
    );
  }

  // ---- H-shifter -----------------------------------------------------

  bindShifter() {
    const track = this.shifterEl.querySelector(".mc-shifter-track");
    let pointerId = null;

    const geometry = () => {
      const rect = track.getBoundingClientRect();
      return {
        rect,
        colWidth: rect.width / SHIFTER_LANES.length
      };
    };

    const positionKnob = (col, rowFrac) => {
      const { rect, colWidth } = geometry();
      const x = (col + 0.5) * colWidth;
      const y = rowFrac * rect.height;

      this.shifterKnob.style.left = `${x}px`;
      this.shifterKnob.style.top = `${y}px`;
    };

    const gearAtPointer = (clientX, clientY) => {
      const { rect, colWidth } = geometry();
      const col = Math.max(
        0,
        Math.min(
          SHIFTER_LANES.length - 1,
          Math.floor((clientX - rect.left) / colWidth)
        )
      );

      const rowFrac = Math.max(
        0,
        Math.min(1, (clientY - rect.top) / rect.height)
      );

      const [upGear, downGear] = SHIFTER_LANES[col];
      const NEUTRAL_BAND = 0.28;

      let gear = 0;
      if (rowFrac < 0.5 - NEUTRAL_BAND) gear = upGear;
      else if (downGear !== null && rowFrac > 0.5 + NEUTRAL_BAND) gear = downGear;

      positionKnob(col, rowFrac);

      return gear;
    };

    const preview = gear => {
      this.shifterGearLabel.textContent = GEAR_LABEL(gear);
      this.shifterEl.classList.toggle("mc-shifter-engaged", gear !== 0);
    };

    track.addEventListener("pointerdown", event => {
      if (pointerId !== null) return;
      pointerId = event.pointerId;
      track.setPointerCapture(pointerId);
      preview(gearAtPointer(event.clientX, event.clientY));
    });

    track.addEventListener("pointermove", event => {
      if (event.pointerId !== pointerId) return;
      preview(gearAtPointer(event.clientX, event.clientY));
    });

    const release = event => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;

      const gear = gearAtPointer(event.clientX, event.clientY);
      this.shifterGear = gear;
      this.input.setMobileGear(gear);
      preview(gear);

      // The knob itself always settles back to the neutral rail; the
      // engaged gear stays reflected in the label, matching a real
      // shifter's spring-loaded return-to-center behavior.
      const col = SHIFTER_LANES.findIndex(([up, down]) =>
        up === gear || down === gear
      );
      positionKnob(col === -1 ? 1.5 : col, 0.5);
    };

    track.addEventListener("pointerup", release);
    track.addEventListener("pointercancel", release);

    // Exposed so setActive() can re-center once the layout has real
    // dimensions (it is zero-sized while `hidden`).
    this.centerShifterKnob = () => positionKnob(1.5, 0.5);
    requestAnimationFrame(this.centerShifterKnob);
  }

  snapShifterTo(gear) {
    this.shifterGear = gear;
    this.input.setMobileGear(gear);
    this.shifterGearLabel.textContent = GEAR_LABEL(gear);
    this.shifterEl.classList.remove("mc-shifter-engaged");
  }

  // ---- Orientation -----------------------------------------------------

  bindOrientation() {
    const check = () => {
      if (!this.active) {
        this.orientationEl.classList.remove("mc-visible");
        return;
      }

      const portrait = window.innerHeight > window.innerWidth;
      // Manual mode needs the full pedal + shifter layout; arcade is
      // playable (if cramped) in portrait, so only gate manual mode.
      const needsLandscape = this.mode === "manual";

      this.orientationEl.classList.toggle(
        "mc-visible",
        portrait && needsLandscape
      );
    };

    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    this._checkOrientation = check;

    const originalSetActive = this.setActive.bind(this);
    this.setActive = active => {
      originalSetActive(active);
      check();
    };

    const originalSetMode = this.setDrivingMode.bind(this);
    this.setDrivingMode = mode => {
      originalSetMode(mode);
      check();
    };
  }
}
