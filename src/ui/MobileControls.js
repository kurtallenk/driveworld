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
    this.steeringTarget = 0;
    this.steeringLeftHeld = false;
    this.steeringRightHeld = false;
    this.steeringAnimId = null;
    this.shifterGear = 0;

    this.buildDOM();
    this.bindSteering();
    this.bindCornerActions();
    this.bindUtilActions();
    this.bindPedal(this.accelEl, "throttle");
    this.bindPedal(this.brakeEl, "brake");
    this.bindPedal(this.clutchEl, "clutch");
    this.bindPedal(this.handbrakeEl, "handbrake");
    this.bindShifter();
    this.bindTurret();
    this.bindTurbo();
    this.bindOrientation();
    this.bindFocusLoss();

    this.root.hidden = true;
  }

  buildDOM() {
    this.root = document.createElement("div");
    this.root.id = "mobile-controls";
    this.root.setAttribute("aria-hidden", "true");

    // ---------------------------------------------------------------
    // LEFT: STEERING
    // ---------------------------------------------------------------

    const ICON_ARROW_LEFT =
      '<svg viewBox="0 0 24 24"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const ICON_ARROW_RIGHT =
      '<svg viewBox="0 0 24 24"><path d="M9 4l8 8-8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    this.steeringEl = document.createElement("div");
    this.steeringEl.className = "mc-steer-cluster";

    this.steerLeftEl = document.createElement("div");
    this.steerLeftEl.className = "mc-steer-btn mc-steer-btn--left";
    this.steerLeftEl.setAttribute("role", "button");
    this.steerLeftEl.setAttribute("aria-label", "Steer left");
    this.steerLeftEl.innerHTML =
      `<span class="mc-steer-icon" aria-hidden="true">${ICON_ARROW_LEFT}</span>`;

    this.steerRightEl = document.createElement("div");
    this.steerRightEl.className = "mc-steer-btn mc-steer-btn--right";
    this.steerRightEl.setAttribute("role", "button");
    this.steerRightEl.setAttribute("aria-label", "Steer right");
    this.steerRightEl.innerHTML =
      `<span class="mc-steer-icon" aria-hidden="true">${ICON_ARROW_RIGHT}</span>`;

    this.steeringEl.append(
      this.steerLeftEl,
      this.steerRightEl
    );

    // ---------------------------------------------------------------
    // TOP-RIGHT: FULLSCREEN + CAMERA
    // ---------------------------------------------------------------

    this.fullscreenBtnEl = document.createElement("button");
    this.fullscreenBtnEl.type = "button";
    this.fullscreenBtnEl.className =
      "mc-corner-btn mc-corner-btn--fullscreen";
    this.fullscreenBtnEl.setAttribute(
      "aria-label",
      "Toggle fullscreen"
    );
    this.fullscreenBtnEl.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    this.cameraBtnEl = document.createElement("button");
    this.cameraBtnEl.type = "button";
    this.cameraBtnEl.className =
      "mc-corner-btn mc-corner-btn--camera";
    this.cameraBtnEl.setAttribute(
      "aria-label",
      "Change camera"
    );
    this.cameraBtnEl.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

    this.cornerActionsEl = document.createElement("div");
    this.cornerActionsEl.className = "mc-corner-actions";

    this.cornerActionsEl.append(
      this.fullscreenBtnEl,
      this.cameraBtnEl
    );

    // ---------------------------------------------------------------
    // HUD TOP ACTIONS
    //
    // Groups:
    // .mc-corner-actions
    // #hud-mode-toggle
    //
    // The HUD mode toggle is an existing element created elsewhere.
    // We move it into this wrapper instead of creating a duplicate.
    // ---------------------------------------------------------------

    this.pedal_clusters = document.createElement("div");
    this.pedal_clusters.className = "mc-hud-pedal_clusters";

    this.hudTopActionsEl = document.createElement("div");
    this.hudTopActionsEl.className = "mc-hud-top-actions";

    this.hudModeToggleEl =
      document.getElementById("hud-mode-toggle");

    this.hudTopActionsEl.append(
      this.cornerActionsEl
    );

    if (this.hudModeToggleEl) {
      this.hudTopActionsEl.append(
        this.hudModeToggleEl
      );
    }

    // ---------------------------------------------------------------
    // RIGHT: PEDALS
    // ---------------------------------------------------------------



    this.pedalsEl = document.createElement("div");
    this.pedalsEl.className = "mc-pedals";
    

    const ICON_ACCEL =
      '<svg viewBox="0 0 24 24"><path d="M12 3 3 19h18L12 3z"/></svg>';

    const ICON_BRAKE =
      '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';

    const ICON_CLUTCH =
      '<svg viewBox="0 0 24 24"><path d="M12 2 2 12l10 10 10-10L12 2z"/></svg>';

    const ICON_HANDBRAKE =
      '<svg viewBox="0 0 24 24"><path d="M12 2 4 6v6c0 5.2 3.4 9 8 10 4.6-1 8-4.8 8-10V6l-8-4z"/></svg>';

    this.clutchEl = this.makePedal(
      "CLUTCH",
      "mc-pedal-clutch",
      ICON_CLUTCH
    );

    this.brakeEl = this.makePedal(
      "BRAKE",
      "mc-pedal-brake",
      ICON_BRAKE
    );

    this.accelEl = this.makePedal(
      "GAS",
      "mc-pedal-accel",
      ICON_ACCEL
    );

    this.pedalsEl.append(
      this.clutchEl,
      this.brakeEl,
      this.accelEl
    );

    this.pedal_clusters.append(this.pedalsEl);

    

    // ---------------------------------------------------------------
    // ACTION CLUSTER
    //
    // Handbrake + Turbo + Turret are intentionally grouped together
    // inside one container.
    // ---------------------------------------------------------------

    this.actionClusterEl = document.createElement("div");
    this.actionClusterEl.className = "mc-action-cluster";
    

    // Handbrake
    // Two words, not one: portrait sets this control in a narrow tile and
    // wraps the label onto two lines (see ui/portrait-fix.css). Landscape
    // still truncates single-line, exactly as it did before.
    this.handbrakeEl = this.makePedal(
      "HAND BRAKE",
      "mc-handbrake-btn",
      ICON_HANDBRAKE
    );

    this.handbrakeEl.setAttribute(
      "role",
      "button"
    );

    this.handbrakeEl.setAttribute(
      "aria-label",
      "Handbrake"
    );

    this.handbrakeEl.tabIndex = 0;

    // Turret
    this.turretEl = document.createElement("button");
    this.turretEl.type = "button";
    this.turretEl.className = "mc-turret-btn";
    this.turretEl.setAttribute(
      "aria-label",
      "Deploy turret"
    );

    this.turretEl.innerHTML =
      '<span class="mc-turret-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M12 2 4 6v6c0 5.2 3.4 9 8 10 4.6-1 8-4.8 8-10V6l-8-4z"/></svg>' +
      '</span>' +
      '<span class="mc-turret-text">TURRET</span>';

    // Turbo
    this.turboEl = document.createElement("button");
    this.turboEl.type = "button";
    this.turboEl.className = "mc-turbo-btn";
    this.turboEl.setAttribute(
      "aria-label",
      "Turbo boost"
    );

    this.turboEl.innerHTML =
      '<span class="mc-turbo-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M13 2 3 14h7l-1 8 11-14h-8z"/></svg>' +
      '</span>' +
      '<span class="mc-turbo-text">TURBO</span>';

    // ---------------------------------------------------------------
    // IMPORTANT:
    //
    // These three controls are now siblings inside the same div:
    //
    // .mc-action-cluster
    // ├── .mc-handbrake-btn
    // ├── .mc-turbo-btn
    // └── .mc-turret-btn
    // ---------------------------------------------------------------

    this.actionClusterEl.append(
      this.handbrakeEl,
      this.turboEl,
      this.turretEl
    );


    this.pedal_clusters.append(this.actionClusterEl);

    // ---------------------------------------------------------------
    // BOTTOM CENTER: H-SHIFTER
    // ---------------------------------------------------------------

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

    this.shifterKnob =
      this.shifterEl.querySelector(
        ".mc-shifter-knob"
      );

    this.shifterGearLabel =
      this.shifterEl.querySelector(
        ".mc-shifter-gear"
      );

    // ---------------------------------------------------------------
    // ORIENTATION OVERLAY
    // ---------------------------------------------------------------

    this.orientationEl = document.createElement("div");
    this.orientationEl.className =
      "mc-orientation-overlay";

    this.orientationEl.innerHTML = `
      <div class="mc-orientation-icon">⟳</div>
      <p>
        Rotate your device<br>
        <span>for the best driving experience</span>
      </p>
    `;

    // ---------------------------------------------------------------
    // ROOT DOM
    // ---------------------------------------------------------------

    // -----------------------------------------------------------------
    // UTILITY RAIL: map / inventory / pause.
    //
    // Deliberately placed in their own rail, away from the driving
    // controls, so they can never be hit while steering or braking. Each
    // one only calls back out (see setActions) -- this class never owns
    // map/inventory/pause state itself.
    // -----------------------------------------------------------------

    this.utilEl = document.createElement("div");
    this.utilEl.className = "mc-util";

    this.mapBtnEl = this.makeUtilButton(
      "map",
      "Map",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
    );

    this.inventoryBtnEl = this.makeUtilButton(
      "bag",
      "Bag",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16l-1.3 11.2a2 2 0 0 1-2 1.8H7.3a2 2 0 0 1-2-1.8L4 8zm4.5 0V6.2A3.2 3.2 0 0 1 11.7 3h.6A3.2 3.2 0 0 1 15.5 6.2V8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
    );

    // Auto Loot lives in the utility rail rather than the driving action
    // cluster: it is a deliberate, stateful toggle (like MAP and BAG,
    // which already use the mc-util-btn--on state), it is nowhere near
    // steering or the pedals, and the rail is already placed clear of the
    // minimap and the chat panel in BOTH orientations with safe-area
    // insets and the shared --mc-hit-min touch floor applied.
    this.autoLootBtnEl = this.makeUtilButton(
      "loot",
      "LOOT",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-1.2 10.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 9zm4-1a4 4 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12v5m-2.2-2.8L12 17l2.2-2.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );

    // Announced as a toggle, not an action, and its state is carried by
    // aria-pressed AND by the visible label text -- never by colour alone.
    this.autoLootBtnEl.setAttribute("aria-label", "Auto loot, off");
    this.autoLootBtnEl.setAttribute("aria-pressed", "false");
    this.autoLootBtnEl.title = "AUTO LOOT";

    this.pauseBtnEl = this.makeUtilButton(
      "pause",
      "Menu",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    );

    this.utilEl.append(
      this.mapBtnEl,
      this.inventoryBtnEl,
      this.autoLootBtnEl,
      this.pauseBtnEl
    );

    // -----------------------------------------------------------------
    // INTERACTION BUTTON
    //
    // Hidden unless something is actually in range (see
    // setInteraction()). It sits above the pedal column, inside easy
    // right-thumb reach but with its own clear spacing so it can never be
    // confused with GAS.
    // -----------------------------------------------------------------

    this.interactEl = document.createElement("button");
    this.interactEl.type = "button";
    this.interactEl.className = "mc-interact-btn";
    this.interactEl.hidden = true;
    this.interactEl.innerHTML =
      '<span class="mc-interact-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</span>' +
      '<span class="mc-interact-text">TAP TO PICK UP</span>';

    // -----------------------------------------------------------------
    // ZONES
    //
    // Landscape and portrait share this markup but are laid out by two
    // completely separate CSS compositions (see ui/mobile.css) keyed off
    // #mobile-controls[data-orientation].
    // -----------------------------------------------------------------

    this.leftZoneEl = document.createElement("div");
    this.leftZoneEl.className = "mc-zone mc-zone--left";
    this.leftZoneEl.append(this.steeringEl);

    this.rightZoneEl = document.createElement("div");
    this.rightZoneEl.className = "mc-zone mc-zone--right";
    this.rightZoneEl.append(this.interactEl, this.pedal_clusters);

    this.root.append(
      this.utilEl,
      this.hudTopActionsEl,
      this.leftZoneEl,
      this.rightZoneEl,
      this.shifterEl,
      this.orientationEl
    );

    document.body.append(this.root);
  }

  makePedal(label, className, icon = "") {
    const el = document.createElement("div");

    el.className = `mc-pedal ${className}`;

    el.innerHTML =
      `<span class="mc-pedal-cap">` +
      `<span class="mc-pedal-icon" aria-hidden="true">${icon}</span>` +
      `</span>` +
      `<span class="mc-pedal-label">${label}</span>`;

    return el;
  }

  // Utility-rail button (map / inventory / pause). Same visual family as
  // the corner buttons, but a larger touch target and always labelled,
  // because these are deliberate taps rather than driving inputs.
  makeUtilButton(name, label, icon) {
    const el = document.createElement("button");

    el.type = "button";
    el.className = `mc-util-btn mc-util-btn--${name}`;
    el.dataset.util = name;
    el.setAttribute("aria-label", label);

    el.innerHTML =
      `<span class="mc-util-icon" aria-hidden="true">${icon}</span>` +
      `<span class="mc-util-label">${label}</span>`;

    return el;
  }

  // -----------------------------------------------------------------
  // UTILITY + INTERACTION BINDINGS
  // -----------------------------------------------------------------

  bindUtilActions() {
    this._onMap = null;
    this._onInventory = null;
    this._onPause = null;
    this._onInteract = null;

    this.mapBtnEl.addEventListener("click", () => this._onMap?.());

    // Goes through the SAME edge-triggered request the F key sets, so the
    // touch button and the keyboard can never drive two Auto Loot states.
    // This class deliberately holds no Auto Loot state of its own -- the
    // button's appearance is only ever written by setAutoLootActive(),
    // which Game calls from AutoLootController.onChange.
    this.autoLootBtnEl.addEventListener(
      "click",
      () => this.input.requestAutoLootToggle()
    );
    this.inventoryBtnEl.addEventListener("click", () => this._onInventory?.());
    this.pauseBtnEl.addEventListener("click", () => this._onPause?.());
    this.interactEl.addEventListener("click", () => this._onInteract?.());
  }

  // Shows/hides the touch interaction button. `label` comes from whatever
  // the player is actually standing next to, so this class never invents
  // prompt text of its own.
  setInteraction(available, label = "TAP TO PICK UP") {
    if (!this.interactEl) return;

    this.interactEl.hidden = !available;

    const text = this.interactEl.querySelector(".mc-interact-text");
    if (text && available) text.textContent = label;
  }

  // Mirrors the desktop inventory panel's open state onto the bag button
  // so the control reads as a toggle rather than a one-way action.
  setInventoryOpen(open) {
    this.inventoryBtnEl?.classList.toggle("mc-util-btn--on", Boolean(open));
  }

  setMapOpen(open) {
    this.mapBtnEl?.classList.toggle("mc-util-btn--on", Boolean(open));
  }

  // Mirrors the one shared Auto Loot state onto the touch button. Called
  // by Game.renderAutoLootState(), the same place the desktop dash pill is
  // written, so the two readouts cannot drift apart.
  setAutoLootActive(active) {
    const on = Boolean(active);
    const el = this.autoLootBtnEl;

    if (!el) return;

    el.classList.toggle("mc-util-btn--on", on);
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.setAttribute("aria-label", on ? "Auto loot, on" : "Auto loot, off");
    el.title = on ? "AUTO LOOT \u2022 ON" : "AUTO LOOT";

    const label = el.querySelector(".mc-util-label");
    if (label) label.textContent = on ? "LOOT ON" : "LOOT";
  }

  // ---------------------------------------------------------------
  // ACTIVE STATE
  // ---------------------------------------------------------------

    setActive(active) {
    this.active = active;

    this.root.hidden = !this.active;
    // Keep aria-hidden in sync with actual visibility -- it was only ever
    // set once (to "true") when the layer was built, so once the controls
    // became active their focusable buttons (e.g. the fullscreen corner
    // button) would still sit under an ancestor claiming to be hidden
    // from assistive tech.
    this.root.setAttribute("aria-hidden", this.active ? "false" : "true");

    document.body.classList.toggle(
      "mobile-controls-active",
      this.active
    );

    document.body.dataset.mcOrientation = this.active
      ? (this.orientation ?? "landscape")
      : "";

    if (!this.active) {
      this.releaseAllPedals();
      this.resetSteering();
      this.input.setMobileTurboHeld(false);
    } else {
      requestAnimationFrame(() =>
        this.centerShifterKnob?.()
      );
    }
  }

  // ---------------------------------------------------------------
  // DRIVING MODE
  // ---------------------------------------------------------------

  setDrivingMode(mode) {
    this.mode = mode;

    const manual = mode === "manual";

    // Arcade shows accelerator + brake only; clutch and the H-shifter are
    // manual-only controls and are removed from the layout entirely (not
    // just dimmed) so they cannot be tapped by accident.
    this.clutchEl.hidden = !manual;
    this.shifterEl.hidden = !manual;

    this.root.dataset.mode = mode;

    if (!manual) {
      this.clutchEl.classList.remove(
        "mc-pressed"
      );

      this.input.setMobileInput({
        clutch: 0
      });

      this.snapShifterTo(0);
    }
  }

  // ---------------------------------------------------------------
  // STEERING
  // ---------------------------------------------------------------

  bindSteering() {
    const updateTarget = () => {
      this.steeringTarget =
        (this.steeringRightHeld ? 1 : 0) -
        (this.steeringLeftHeld ? 1 : 0);

      if (this.steeringAnimId === null) {
        this.runSteeringLoop();
      }
    };

    const bindHeldButton = (
      el,
      setHeld
    ) => {
      let pointerId = null;

      const press = event => {
        if (pointerId !== null) return;

        pointerId = event.pointerId;

        el.setPointerCapture(
          pointerId
        );

        el.classList.add(
          "mc-pressed"
        );

        setHeld(true);
        updateTarget();
      };

      const release = event => {
        if (
          event.pointerId !==
          pointerId
        ) {
          return;
        }

        pointerId = null;

        el.classList.remove(
          "mc-pressed"
        );

        setHeld(false);
        updateTarget();
      };

      el.addEventListener(
        "pointerdown",
        press
      );

      el.addEventListener(
        "pointerup",
        release
      );

      el.addEventListener(
        "pointercancel",
        release
      );

      el.addEventListener(
        "lostpointercapture",
        release
      );
    };

    bindHeldButton(
      this.steerLeftEl,
      held => {
        this.steeringLeftHeld = held;
      }
    );

    bindHeldButton(
      this.steerRightEl,
      held => {
        this.steeringRightHeld = held;
      }
    );

    this._updateSteeringTarget =
      updateTarget;
  }

  runSteeringLoop() {
    const ATTACK = 0.35;
    const RETURN = 0.22;

    const step = () => {
      const factor =
        this.steeringTarget === 0
          ? RETURN
          : ATTACK;

      this.steeringValue +=
        (
          this.steeringTarget -
          this.steeringValue
        ) *
        factor;

      if (
        this.steeringTarget === 0 &&
        Math.abs(
          this.steeringValue
        ) < 0.01
      ) {
        this.steeringValue = 0;

        this.input.setMobileInput({
          steering: 0
        });

        this.steeringAnimId =
          null;

        return;
      }

      if (
        this.steeringTarget !== 0 &&
        Math.abs(
          this.steeringValue -
          this.steeringTarget
        ) < 0.01
      ) {
        this.steeringValue =
          this.steeringTarget;
      }

      this.input.setMobileInput({
        steering:
          this.steeringValue
      });

      this.steeringAnimId =
        requestAnimationFrame(
          step
        );
    };

    this.steeringAnimId =
      requestAnimationFrame(
        step
      );
  }

  resetSteering() {
    cancelAnimationFrame(
      this.steeringAnimId
    );

    this.steeringAnimId = null;

    this.steeringLeftHeld = false;
    this.steeringRightHeld = false;

    this.steeringTarget = 0;
    this.steeringValue = 0;

    this.steerLeftEl.classList.remove(
      "mc-pressed"
    );

    this.steerRightEl.classList.remove(
      "mc-pressed"
    );

    this.input.setMobileInput({
      steering: 0
    });
  }

  // ---------------------------------------------------------------
  // CORNER ACTIONS
  // ---------------------------------------------------------------

  bindCornerActions() {
    this._onFullscreen = null;
    this._onCamera = null;

    this.fullscreenBtnEl.addEventListener(
      "click",
      () => this._onFullscreen?.()
    );

    this.cameraBtnEl.addEventListener(
      "click",
      () => this._onCamera?.()
    );
  }

  setActions({
    onFullscreen,
    onCamera,
    onMap,
    onInventory,
    onPause,
    onInteract
  } = {}) {
    this._onFullscreen =
      onFullscreen ??
      this._onFullscreen;

    this._onCamera =
      onCamera ??
      this._onCamera;

    this._onMap = onMap ?? this._onMap;
    this._onInventory = onInventory ?? this._onInventory;
    this._onPause = onPause ?? this._onPause;
    this._onInteract = onInteract ?? this._onInteract;
  }

  setFullscreenActive(active) {
    this.fullscreenBtnEl.classList.toggle(
      "mc-corner-btn--active",
      active
    );

    this.fullscreenBtnEl.setAttribute(
      "aria-label",
      active
        ? "Exit fullscreen"
        : "Enter fullscreen"
    );
  }

  // ---------------------------------------------------------------
  // PEDALS
  // ---------------------------------------------------------------

  bindPedal(
    el,
    axisName
  ) {
    let pointerId = null;

    const press = event => {
      if (pointerId !== null) return;

      pointerId = event.pointerId;

      el.setPointerCapture(
        pointerId
      );

      el.classList.add(
        "mc-pressed"
      );

      this.input.setMobileInput({
        [axisName]: 1
      });
    };

    const release = event => {
      if (
        event.pointerId !==
        pointerId
      ) {
        return;
      }

      pointerId = null;

      el.classList.remove(
        "mc-pressed"
      );

      this.input.setMobileInput({
        [axisName]: 0
      });
    };

    el.addEventListener(
      "pointerdown",
      press
    );

    el.addEventListener(
      "pointerup",
      release
    );

    el.addEventListener(
      "pointercancel",
      release
    );

    el.addEventListener(
      "lostpointercapture",
      release
    );
  }

  releaseAllPedals() {
    for (const [
      el,
      axis
    ] of [
      [this.accelEl, "throttle"],
      [this.brakeEl, "brake"],
      [this.clutchEl, "clutch"],
      [this.handbrakeEl, "handbrake"]
    ]) {
      el.classList.remove(
        "mc-pressed"
      );

      this.input.setMobileInput({
        [axis]: 0
      });
    }
  }

  // ---------------------------------------------------------------
  // FOCUS LOSS
  // ---------------------------------------------------------------

  bindFocusLoss() {
    const releaseEverything = () => {
      if (!this.active) return;

      this.releaseAllPedals();
      this.resetSteering();

      this.input.setMobileTurboHeld(
        false
      );

      this.turboEl.classList.remove(
        "mc-pressed"
      );
    };

    window.addEventListener(
      "blur",
      releaseEverything
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          releaseEverything();
        }
      }
    );
  }

  // ---------------------------------------------------------------
  // TURRET
  // ---------------------------------------------------------------

  bindTurret() {
    const el = this.turretEl;

    let pointerId = null;

    const press = event => {
      if (pointerId !== null) return;

      pointerId = event.pointerId;

      el.setPointerCapture(
        pointerId
      );

      el.classList.add(
        "mc-pressed"
      );

      this.input.requestTurretToggle();
    };

    const release = event => {
      if (
        event.pointerId !==
        pointerId
      ) {
        return;
      }

      pointerId = null;

      el.classList.remove(
        "mc-pressed"
      );
    };

    el.addEventListener(
      "pointerdown",
      press
    );

    el.addEventListener(
      "pointerup",
      release
    );

    el.addEventListener(
      "pointercancel",
      release
    );

    el.addEventListener(
      "lostpointercapture",
      release
    );
  }

  // ---------------------------------------------------------------
  // TURBO
  // ---------------------------------------------------------------

  bindTurbo() {
    const el = this.turboEl;

    let pointerId = null;

    const press = event => {
      if (pointerId !== null) return;

      pointerId = event.pointerId;

      el.setPointerCapture(
        pointerId
      );

      el.classList.add(
        "mc-pressed"
      );

      this.input.setMobileTurboHeld(
        true
      );
    };

    const release = event => {
      if (
        event.pointerId !==
        pointerId
      ) {
        return;
      }

      pointerId = null;

      el.classList.remove(
        "mc-pressed"
      );

      this.input.setMobileTurboHeld(
        false
      );
    };

    el.addEventListener(
      "pointerdown",
      press
    );

    el.addEventListener(
      "pointerup",
      release
    );

    el.addEventListener(
      "pointercancel",
      release
    );

    el.addEventListener(
      "lostpointercapture",
      release
    );
  }

  setTurboState(
    state,
    cooldownFraction = 0
  ) {
    this.turboEl.classList.toggle(
      "mc-turbo-btn--active",
      state === "active"
    );

    this.turboEl.classList.toggle(
      "mc-turbo-btn--cooldown",
      state === "cooldown"
    );

    this.turboEl.style.setProperty(
      "--mc-turbo-cooldown-frac",
      String(
        state === "cooldown"
          ? cooldownFraction
          : 0
      )
    );
  }

  // ---------------------------------------------------------------
  // H-SHIFTER
  // ---------------------------------------------------------------

  bindShifter() {
    const track =
      this.shifterEl.querySelector(
        ".mc-shifter-track"
      );

    let pointerId = null;

    const geometry = () => {
      const rect =
        track.getBoundingClientRect();

      return {
        rect,
        colWidth:
          rect.width /
          SHIFTER_LANES.length
      };
    };

    const positionKnob = (
      col,
      rowFrac
    ) => {
      const {
        rect,
        colWidth
      } = geometry();

      const x =
        (col + 0.5) *
        colWidth;

      const y =
        rowFrac *
        rect.height;

      this.shifterKnob.style.left =
        `${x}px`;

      this.shifterKnob.style.top =
        `${y}px`;
    };

    const gearAtPointer = (
      clientX,
      clientY
    ) => {
      const {
        rect,
        colWidth
      } = geometry();

      const col = Math.max(
        0,
        Math.min(
          SHIFTER_LANES.length - 1,
          Math.floor(
            (clientX - rect.left) /
            colWidth
          )
        )
      );

      const rowFrac = Math.max(
        0,
        Math.min(
          1,
          (clientY - rect.top) /
          rect.height
        )
      );

      const [
        upGear,
        downGear
      ] = SHIFTER_LANES[col];

      const NEUTRAL_BAND = 0.28;

      let gear = 0;

      if (
        rowFrac <
        0.5 - NEUTRAL_BAND
      ) {
        gear = upGear;
      } else if (
        downGear !== null &&
        rowFrac >
        0.5 + NEUTRAL_BAND
      ) {
        gear = downGear;
      }

      positionKnob(
        col,
        rowFrac
      );

      return gear;
    };

    const preview = gear => {
      this.shifterGearLabel.textContent =
        GEAR_LABEL(gear);

      this.shifterEl.classList.toggle(
        "mc-shifter-engaged",
        gear !== 0
      );
    };

    track.addEventListener(
      "pointerdown",
      event => {
        if (pointerId !== null) return;

        pointerId =
          event.pointerId;

        track.setPointerCapture(
          pointerId
        );

        preview(
          gearAtPointer(
            event.clientX,
            event.clientY
          )
        );
      }
    );

    track.addEventListener(
      "pointermove",
      event => {
        if (
          event.pointerId !==
          pointerId
        ) {
          return;
        }

        preview(
          gearAtPointer(
            event.clientX,
            event.clientY
          )
        );
      }
    );

    const release = event => {
      if (
        event.pointerId !==
        pointerId
      ) {
        return;
      }

      pointerId = null;

      const gear =
        gearAtPointer(
          event.clientX,
          event.clientY
        );

      this.shifterGear = gear;

      this.input.setMobileGear(
        gear
      );

      preview(gear);

      const col =
        SHIFTER_LANES.findIndex(
          ([up, down]) =>
            up === gear ||
            down === gear
        );

      positionKnob(
        col === -1
          ? 1.5
          : col,
        0.5
      );
    };

    track.addEventListener(
      "pointerup",
      release
    );

    track.addEventListener(
      "pointercancel",
      release
    );

    this.centerShifterKnob =
      () =>
        positionKnob(
          1.5,
          0.5
        );

    requestAnimationFrame(
      this.centerShifterKnob
    );
  }

  snapShifterTo(gear) {
    this.shifterGear = gear;

    this.input.setMobileGear(
      gear
    );

    this.shifterGearLabel.textContent =
      GEAR_LABEL(gear);

    this.shifterEl.classList.remove(
      "mc-shifter-engaged"
    );
  }

  // ---------------------------------------------------------------
  // ORIENTATION
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // ORIENTATION / LAYOUT ENGINE
  // ---------------------------------------------------------------
  // Portrait and landscape are two INDEPENDENT compositions (see
  // ui/mobile.css). Everything below is recomputed from the LIVE viewport
  // on every resize / orientationchange / visual-viewport change, so a
  // rotation genuinely reflows the interface instead of rescaling the
  // previous layout.
  //
  // The decision is made here, in JS, and published as data-attributes +
  // CSS custom properties, so the CSS layout and the JS-measured geometry
  // (the H-shifter rail) can never disagree the way separate media
  // queries would.
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // WHY THIS READS THE *LAYOUT* VIEWPORT
  // ---------------------------------------------------------------
  // This used to read window.visualViewport and publish it as --mc-vw /
  // --mc-vh. That was the cause of the "portrait shrinks after a rotation"
  // bug: ui/portrait-fix.css derives its entire scale from one number,
  //
  //     --pf-u: min(calc(var(--mc-vw) / 412), 1.15px)
  //
  // and --pf-u multiplies every portrait offset, size and font. But the
  // VISUAL viewport is the layout viewport divided by the current page
  // scale, and it also shrinks under the on-screen keyboard. A rotation is
  // exactly the event that can leave a residual page scale behind, so
  // landscape -> portrait came back reporting LESS than the real layout
  // width, --pf-u shrank with it, and the whole portrait UI shrank in
  // proportion -- permanently, because nothing fired afterwards to correct
  // it. First load looked right only because the page scale starts at 1.
  //
  // document.documentElement.clientWidth/clientHeight is the CSS layout
  // viewport: immune to pinch-zoom, page scale and the virtual keyboard, and
  // it is the same box `@media (max-width: ...)` evaluates against -- so the
  // media query in portrait-fix.css and --pf-u can no longer disagree about
  // how wide the phone is.
  //
  // The visual viewport is still measured, but it is published separately as
  // --mc-visual-vh and never feeds a control scale.
  measureViewport() {
    const doc = document.documentElement;
    const vv = window.visualViewport;

    const width = Math.round(
      doc?.clientWidth || window.innerWidth || vv?.width || 0
    );

    const height = Math.round(
      doc?.clientHeight || window.innerHeight || vv?.height || 0
    );

    const visualHeight = Math.round(vv?.height || height);

    return { width, height, visualHeight, portrait: height >= width };
  }

  // Mobile browsers report a box from the orientation they are LEAVING while
  // the rotation animation runs. Latching one of those frames is the other
  // half of the stale-layout problem, so a measurement is only accepted once
  // it agrees with what the browser itself calls the current orientation.
  measurementIsSettled(portrait) {
    const query = window.matchMedia?.("(orientation: portrait)");
    if (!query) return true;

    return query.matches === portrait;
  }

  applyLayout() {
    const { width, height, visualHeight, portrait } = this.measureViewport();

    if (!width || !height) return;

    // Drop transitional mid-rotation frames rather than publishing them. The
    // retry cap keeps this from ever becoming a rAF loop if matchMedia and
    // the measured box disagree persistently (a square viewport, say).
    if (!this.measurementIsSettled(portrait)) {
      this._settleRetries = (this._settleRetries ?? 0) + 1;

      if (this._settleRetries <= 8) {
        this.scheduleLayout();
        return;
      }
    }

    this._settleRetries = 0;

    this.viewportWidth = width;
    this.viewportHeight = height;
    this.orientation = portrait ? "portrait" : "landscape";

    // The legacy "rotate your device" gate stays permanently hidden:
    // portrait is a fully supported layout now. The element is kept so
    // nothing referencing it throws.
    this.orientationEl?.classList.remove("mc-visible");

    // Layout-viewport size exposed to CSS. Every pass rewrites these from
    // freshly measured absolutes, so repeated rotation is idempotent:
    // nothing accumulates and no previous orientation's value survives.
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--mc-vw", `${width}px`);
    rootStyle.setProperty("--mc-vh", `${height}px`);

    // The genuinely-visible box, for the few rules that want it (chat's
    // ceiling). Deliberately NOT --mc-vh: nothing that sizes a control may
    // depend on a value that moves when the keyboard opens.
    rootStyle.setProperty("--mc-visual-vh", `${visualHeight}px`);

    // Control scale bucket, derived from the real viewport rather than a
    // media query so it always matches the orientation decided here.
    const shortest = Math.min(width, height);

    const size =
      shortest <= 340 ? "xs" :
      shortest <= 400 ? "sm" :
      shortest <= 520 ? "md" : "lg";

    this.root.dataset.orientation = this.orientation;
    this.root.dataset.size = size;

    // Short landscape phones get a denser variant of the landscape layout.
    this.root.dataset.compact =
      !portrait && height <= 480 ? "true" : "false";

    // Page-level signals for the HUD rules that reflow around this layer.
    document.body.dataset.mcOrientation = this.active ? this.orientation : "";
    document.body.dataset.mcSize = this.active ? size : "";

    // The portrait deck is arranged differently for arcade and manual (manual
    // adds a clutch pedal and the H-shifter), and those rules live on <body>
    // because they also have to combine with body[data-hud-mode]. Published
    // here rather than read off #mobile-controls so a single selector can
    // match both signals without :has().
    document.body.dataset.mcMode = this.active ? this.mode : "";

    // Geometry-positioned widgets must be re-placed after any reflow or
    // they end up off their rail.
    if (this.active && this.mode === "manual") {
      requestAnimationFrame(() => this.centerShifterKnob?.());
    }
  }

  // Coalesces bursts of resize/scroll events into one layout pass per frame.
  scheduleLayout() {
    if (this._layoutFrame) cancelAnimationFrame(this._layoutFrame);

    this._layoutFrame = requestAnimationFrame(() => {
      this._layoutFrame = null;
      this.applyLayout();
    });
  }

  bindOrientation() {
    const check = () => this.scheduleLayout();

    window.addEventListener("resize", check);

    // Mobile browsers report stale dimensions while the rotation
    // animation is still running, so re-measure as it settles instead of
    // trusting the single event.
    const settle = () => {
      check();
      for (const delay of [50, 150, 350, 600]) setTimeout(check, delay);
    };

    window.addEventListener("orientationchange", settle);

    try {
      window.screen?.orientation?.addEventListener?.("change", settle);
    } catch {
      /* Safari <16.4 has no ScreenOrientation events; the listeners
         above already cover it. */
    }

    // Browser chrome hiding/showing changes the usable viewport without
    // always firing a window resize.
    window.visualViewport?.addEventListener("resize", check);
    window.visualViewport?.addEventListener("scroll", check);

    if (typeof ResizeObserver !== "undefined") {
      this._viewportObserver = new ResizeObserver(check);
      this._viewportObserver.observe(document.documentElement);
    }

    this.orientation = "landscape";

    this.applyLayout();

    this._checkOrientation = check;

    const originalSetActive = this.setActive.bind(this);

    this.setActive = active => {
      originalSetActive(active);
      this.applyLayout();
    };

    const originalSetMode = this.setDrivingMode.bind(this);

    this.setDrivingMode = mode => {
      originalSetMode(mode);
      this.applyLayout();
    };
  }
}