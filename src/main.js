import "./style.css";

import { Game } from "./core/Game.js";
import { setupDiagnosticsExport } from "./ui/DiagnosticsExport.js";
import { MultiplayerClient } from "./multiplayer/MultiplayerClient.js";

setupDiagnosticsExport();

const startButton = document.querySelector("#start");
const loading = document.querySelector("#loading");
const status = document.querySelector("#loading-status");

let multiplayer = null;

startButton.addEventListener("click", async () => {
  startButton.disabled = true;

  status.textContent =
    "Preparing renderer, terrain, and vehicle…";

  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });

  try {
    const game = new Game(document.querySelector("#game"));

    game.frame(performance.now());

    document.querySelector("#hud").hidden = false;
    loading.hidden = true;

    game.start();

    // A missing multiplayer server does not prevent local driving.
    try {
      multiplayer = new MultiplayerClient(game);
    } catch (error) {
      console.error("Multiplayer initialization failed:", error);
    }
  } catch (error) {
    console.error(error);

    status.textContent =
      `Could not start: ${error.message}. Check the console for details.`;

    startButton.textContent = "Reload the page to retry";
  }
}, { once: true });

window.addEventListener("beforeunload", () => {
  multiplayer?.dispose();
});