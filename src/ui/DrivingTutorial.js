// ---------------------------------------------------------------------------
// DRIVING TUTORIAL (first-time player guide)
// ---------------------------------------------------------------------------
// A small, self-contained, interactive coach card. It never drives the car
// and never touches physics: Game.frame() passes it the SAME normalized
// input sample the vehicle receives, plus the current speed, and the card
// simply watches for the player doing each action.
//
//   1 Steering  -> steer left AND right once
//   2 Gas       -> hold accelerate (or reach a little speed)
//   3 Brake     -> hold brake / reverse
//   4 Combine   -> accelerate while steering
//   5 Ready     -> short summary of the extra controls, then drive
//
// Always skippable ("Skip guide"), remembers completion/skip in
// localStorage, and can be replayed from Menu -> Controls / Help.
// Touch players see the real on-screen buttons highlighted; keyboard
// players see keycaps (WASD and arrows) and the keyboard panel lights up.
// ---------------------------------------------------------------------------

export const TUTORIAL_STORAGE_KEY = "driveworld.tutorial.v1";

const STEP_COUNT = 5;

// Pure step-progress logic, exported for unit tests. `state` is mutated.
// Returns true once the current step's goal has been met.
export function advanceTutorialProgress(step, state, input, speedKmh, dt) {
  const steer = input.steering ?? 0;
  const gas = input.throttle ?? 0;
  const brake = input.brake ?? 0;

  switch (step) {
    case 0:
      if (steer < -0.35) state.left = true;
      if (steer > 0.35) state.right = true;
      state.progress = (Number(Boolean(state.left)) + Number(Boolean(state.right))) / 2;
      return Boolean(state.left && state.right);

    case 1:
      if (gas > 0.4) state.time = (state.time ?? 0) + dt;
      state.progress = Math.max(
        Math.min(1, (state.time ?? 0) / 1.6),
        Math.min(1, speedKmh / 25)
      );
      return state.progress >= 1;

    case 2:
      if (brake > 0.4) state.time = (state.time ?? 0) + dt;
      state.progress = Math.min(1, (state.time ?? 0) / 1.4);
      return state.progress >= 1;

    case 3:
      if (gas > 0.4 && Math.abs(steer) > 0.35) state.time = (state.time ?? 0) + dt;
      state.progress = Math.min(1, (state.time ?? 0) / 1.8);
      return state.progress >= 1;

    default:
      return false;
  }
}

export function loadTutorialState(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(TUTORIAL_STORAGE_KEY);
    return value === "done" || value === "skipped" ? value : null;
  } catch {
    return null;
  }
}

function saveTutorialState(value) {
  try {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, value);
  } catch {
    /* Private mode: the guide may simply appear again next visit. */
  }
}

const key = (label, extra = "") =>
  `<span class="dw-tut-key${extra}">${label}</span>`;

const touchBtn = (label, cls) =>
  `<span class="dw-tut-touch dw-tut-touch--${cls}">${label}</span>`;

// Step content. `keys`/`touch` are the visual control demonstrations;
// `targets` are the real controls highlighted while the step is active.
const STEPS = [
  {
    title: "Steer",
    keyText: "Hold <b>A</b> or <b>←</b> to steer left, <b>D</b> or <b>→</b> to steer right.",
    touchText: "Hold the <b>◀</b> and <b>▶</b> buttons on the left to steer.",
    keys: () => `${key("A")}${key("←")}<span class="dw-tut-sep"></span>${key("D")}${key("→")}`,
    touch: () => `${touchBtn("◀", "steer")}${touchBtn("▶", "steer")}`,
    goals: ["Left", "Right"],
    touchTargets: [".mc-steer-btn--left", ".mc-steer-btn--right"],
    keyTargets: ["KeyA", "KeyD"]
  },
  {
    title: "Accelerate",
    keyText: "Hold <b>W</b> or <b>↑</b> to drive forward.",
    touchText: "Hold <b>GAS</b> with your right thumb to drive forward.",
    keys: () => `${key("W")}${key("↑")}`,
    touch: () => touchBtn("GAS", "gas"),
    touchTargets: [".mc-pedal-accel"],
    keyTargets: ["KeyW"]
  },
  {
    title: "Brake & reverse",
    keyText: "Hold <b>S</b> or <b>↓</b> to slow down. Keep holding when stopped to reverse.",
    touchText: "Hold <b>BRAKE</b> to slow down. Keep holding when stopped to reverse.",
    keys: () => `${key("S")}${key("↓")}`,
    touch: () => touchBtn("BRAKE", "brake"),
    touchTargets: [".mc-pedal-brake"],
    keyTargets: ["KeyS"]
  },
  {
    title: "Turn while driving",
    keyText: "Hold <b>W</b> and steer with <b>A</b> / <b>D</b> at the same time. Ease off to tighten the turn.",
    touchText: "Hold <b>GAS</b> and steer with <b>◀</b> / <b>▶</b> at the same time. Ease off to tighten the turn.",
    keys: () => `${key("W")}<span class="dw-tut-plus">+</span>${key("A")}${key("D")}`,
    touch: () => `${touchBtn("GAS", "gas")}<span class="dw-tut-plus">+</span>${touchBtn("◀", "steer")}${touchBtn("▶", "steer")}`,
    touchTargets: [".mc-pedal-accel", ".mc-steer-btn--left", ".mc-steer-btn--right"],
    keyTargets: ["KeyW", "KeyA", "KeyD"]
  },
  {
    title: "You're ready to drive!",
    keyText: "",
    touchText: "",
    summaryKeys: [
      ["SPACE", "Handbrake — sharp turns"],
      ["SHIFT", "Turbo boost"],
      ["R", "Reset if stuck"],
      ["ESC", "Menu & Controls / Help"]
    ],
    summaryTouch: [
      ["HAND BRAKE", "Sharp turns"],
      ["TURBO", "Speed boost"],
      ["☰ Menu", "Controls / Help, settings"]
    ],
    touchTargets: [],
    keyTargets: []
  }
];

// Extra summary row shown only when driving the Heavy vehicle.
export const HEAVY_NOTE = ["HEAVY", "Brake earlier &mdash; wider turns, tougher armor"];

export class DrivingTutorial {
  constructor({ input, mobileControls = null, menu = null, vehicleClass = "light" } = {}) {
    this.input = input;
    this.vehicleClass = vehicleClass;
    this.mobileControls = mobileControls;
    this.menu = menu;
    this.active = false;
    this.step = 0;
    this.state = {};
    this.completeTimer = 0;
    this.highlighted = [];
    this.buildDOM();
  }

  get isTouch() {
    return this.input?.mode === "mobile";
  }

  buildDOM() {
    const root = document.createElement("section");
    root.id = "driving-tutorial";
    root.className = "dw-tut";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");
    root.setAttribute("aria-labelledby", "dw-tut-title");

    root.innerHTML = `
      <header class="dw-tut-head">
        <div class="dw-tut-progress" aria-hidden="true">
          ${Array.from({ length: STEP_COUNT }, () => '<span class="dw-tut-dot"></span>').join("")}
        </div>
        <span class="dw-tut-count" id="dw-tut-count">Step 1 of ${STEP_COUNT}</span>
        <button type="button" class="dw-tut-skip" id="dw-tut-skip">Skip guide</button>
      </header>
      <div class="dw-tut-body">
        <div class="dw-tut-visual" id="dw-tut-visual" aria-hidden="true"></div>
        <div class="dw-tut-copy">
          <h2 class="dw-tut-title" id="dw-tut-title"></h2>
          <p class="dw-tut-text" id="dw-tut-text"></p>
        </div>
      </div>
      <ul class="dw-tut-summary" id="dw-tut-summary" hidden></ul>
      <footer class="dw-tut-foot">
        <div class="dw-tut-meter" id="dw-tut-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Step progress">
          <div class="dw-tut-meter-fill" id="dw-tut-meter-fill"></div>
        </div>
        <div class="dw-tut-goals" id="dw-tut-goals"></div>
        <span class="dw-tut-status" id="dw-tut-status" role="status" aria-live="polite"></span>
        <button type="button" class="dw-tut-next" id="dw-tut-next">Next</button>
      </footer>
    `;

    document.body.append(root);

    this.root = root;
    this.dots = [...root.querySelectorAll(".dw-tut-dot")];
    this.countEl = root.querySelector("#dw-tut-count");
    this.titleEl = root.querySelector("#dw-tut-title");
    this.textEl = root.querySelector("#dw-tut-text");
    this.visualEl = root.querySelector("#dw-tut-visual");
    this.summaryEl = root.querySelector("#dw-tut-summary");
    this.meterEl = root.querySelector("#dw-tut-meter");
    this.meterFillEl = root.querySelector("#dw-tut-meter-fill");
    this.goalsEl = root.querySelector("#dw-tut-goals");
    this.statusEl = root.querySelector("#dw-tut-status");
    this.nextEl = root.querySelector("#dw-tut-next");
    this.skipEl = root.querySelector("#dw-tut-skip");

    // Buttons are blurred after use so a later Space/Enter keypress goes to
    // driving, never to a focused tutorial button.
    this.nextEl.addEventListener("click", () => {
      this.nextEl.blur();
      this.next();
    });

    this.skipEl.addEventListener("click", () => {
      this.skipEl.blur();
      this.finish("skipped");
    });
  }

  // Shows the guide on a first visit only.
  autoStart() {
    if (loadTutorialState() === null) this.start();
  }

  start() {
    this.active = true;
    this.step = 0;
    this.root.hidden = false;
    document.body.dataset.tutorial = "on";
    this.render();
  }

  next() {
    if (this.step >= STEP_COUNT - 1) {
      this.finish("done");
      return;
    }

    this.step += 1;
    this.render();
  }

  finish(result) {
    saveTutorialState(result);
    this.active = false;
    this.root.hidden = true;
    delete document.body.dataset.tutorial;
    this.clearHighlights();
  }

  render() {
    const step = STEPS[this.step];
    const touch = this.isTouch;
    this.state = {};
    this.completeTimer = 0;
    this.renderedTouch = touch;

    this.root.dataset.step = String(this.step + 1);
    this.root.dataset.complete = "false";
    this.root.dataset.input = touch ? "touch" : "keys";

    this.dots.forEach((dot, index) => {
      dot.classList.toggle("is-done", index < this.step);
      dot.classList.toggle("is-current", index === this.step);
    });

    this.countEl.textContent = `Step ${this.step + 1} of ${STEP_COUNT}`;
    this.titleEl.textContent = step.title;
    this.textEl.innerHTML = touch ? step.touchText : step.keyText;
    this.textEl.hidden = !this.textEl.innerHTML;

    const isLast = this.step === STEP_COUNT - 1;

    if (isLast) {
      const rows = touch ? step.summaryTouch : step.summaryKeys;
      this.summaryEl.innerHTML = [...rows, ...(this.vehicleClass === "heavy" ? [HEAVY_NOTE] : [])]
        .map(([control, label]) =>
          `<li>${touch ? touchBtn(control, "chip") : key(control, " dw-tut-key--wide")}<span>${label}</span></li>`)
        .join("");
      this.summaryEl.hidden = false;
      this.visualEl.innerHTML = '<span class="dw-tut-flag">🏁</span>';
    } else {
      this.summaryEl.hidden = true;
      this.visualEl.innerHTML = touch ? step.touch() : step.keys();
    }

    this.meterEl.hidden = isLast;
    this.goalsEl.innerHTML = (step.goals ?? [])
      .map(goal => `<span class="dw-tut-goal" data-goal="${goal}">${goal}</span>`)
      .join("");
    this.goalsEl.hidden = !step.goals;

    this.statusEl.textContent = "";
    this.nextEl.textContent = isLast ? "Start driving" : "Next";
    this.nextEl.classList.toggle("dw-tut-next--primary", isLast);
    this.setMeter(0);
    this.applyHighlights(step, touch);
  }

  setMeter(fraction) {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    if (pct === this._lastPct) return;
    this._lastPct = pct;
    this.meterFillEl.style.transform = `scaleX(${pct / 100})`;
    this.meterEl.setAttribute("aria-valuenow", String(pct));
  }

  applyHighlights(step, touch) {
    this.clearHighlights();

    if (touch) {
      for (const selector of step.touchTargets) {
        const el = document.querySelector(`#mobile-controls ${selector}`);
        if (el) this.highlighted.push(el);
      }
    } else {
      for (const code of step.keyTargets) {
        for (const el of document.querySelectorAll(`#keyboard-panel .kbd-key[data-key="${code}"]`)) {
          this.highlighted.push(el);
        }
      }
    }

    this.highlighted.forEach(el => el.classList.add("dw-tut-target"));
  }

  clearHighlights() {
    this.highlighted.forEach(el => el.classList.remove("dw-tut-target"));
    this.highlighted = [];
  }

  // Called by Game.frame() with the frame's normalized input sample.
  update(input, speedKmh, dt) {
    if (!this.active || !input) return;

    // The player switched input device mid-guide: re-render so the
    // instructions always match the controls actually in use.
    if (this.renderedTouch !== this.isTouch) {
      this.render();
    }

    if (this.step >= STEP_COUNT - 1) return;

    if (this.root.dataset.complete === "true") {
      this.completeTimer -= dt;
      if (this.completeTimer <= 0) this.next();
      return;
    }

    const done = advanceTutorialProgress(this.step, this.state, input, speedKmh, dt);
    this.setMeter(this.state.progress ?? 0);

    if (this.step === 0) {
      this.goalsEl.querySelector('[data-goal="Left"]')?.classList.toggle("is-done", Boolean(this.state.left));
      this.goalsEl.querySelector('[data-goal="Right"]')?.classList.toggle("is-done", Boolean(this.state.right));
    }

    if (done) {
      this.root.dataset.complete = "true";
      this.statusEl.textContent = "✓ Nice!";
      this.completeTimer = 0.9;
    }
  }
}
