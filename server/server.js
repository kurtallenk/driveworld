import http from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocket, WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 3001);

// Public hosting needs to listen on all network interfaces.
const HOST = process.env.HOST || "0.0.0.0";

const MAX_PLAYERS = 8;
const SNAPSHOT_RATE = 15;

const SERVER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIRECTORY = path.resolve(SERVER_DIRECTORY, "../dist");

const COLORS = [
  "#ef5350",
  "#4285f4",
  "#58b76b",
  "#f5ce47",
  "#aa70d6",
  "#f29b43",
  "#ee83bd",
  "#50cad5"
];

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

const players = new Map();

function textResponse(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  response.end(message);
}

async function serveHTTP(request, response) {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD");
    textResponse(response, 405, "Method not allowed");
    return;
  }

  let pathname;

  try {
    pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname
    );
  } catch {
    textResponse(response, 400, "Invalid URL");
    return;
  }

  if (pathname === "/health") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    });

    response.end(
      request.method === "HEAD"
        ? undefined
        : JSON.stringify({
            ok: true,
            players: players.size,
            capacity: MAX_PLAYERS
          })
    );

    return;
  }

  if (pathname === "/multiplayer") {
    textResponse(response, 426, "WebSocket connection required");
    return;
  }

  if (pathname.includes("\0")) {
    textResponse(response, 400, "Invalid path");
    return;
  }

  const relativePath = pathname === "/"
    ? "index.html"
    : pathname.replace(/^\/+/, "");

  const filename = path.resolve(DIST_DIRECTORY, relativePath);
  const relative = path.relative(DIST_DIRECTORY, filename);

  // Only serve files inside the production build directory.
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    textResponse(response, 403, "Forbidden");
    return;
  }

  let fileInfo;

  try {
    fileInfo = await stat(filename);
  } catch {
    textResponse(
      response,
      404,
      pathname === "/"
        ? "Game build missing. Run npm run build first."
        : "Not found"
    );
    return;
  }

  if (!fileInfo.isFile()) {
    textResponse(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filename).toLowerCase();

  response.writeHead(200, {
    "Content-Type":
      MIME_TYPES[extension] || "application/octet-stream",
    "Content-Length": fileInfo.size,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control":
      relative.startsWith(`assets${path.sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache"
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(filename);

  stream.on("error", error => {
    console.error("Static file read failed:", error.message);
    response.destroy();
  });

  stream.pipe(response);
}

const server = http.createServer((request, response) => {
  serveHTTP(request, response).catch(error => {
    console.error("HTTP request failed:", error);

    if (!response.headersSent) {
      textResponse(response, 500, "Server error");
    } else {
      response.destroy();
    }
  });
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 4096,
  perMessageDeflate: false
});

server.on("upgrade", (request, socket, head) => {
  let pathname;

  try {
    pathname = new URL(
      request.url,
      "http://localhost"
    ).pathname;
  } catch {
    socket.destroy();
    return;
  }

  const origin = request.headers.origin;

  if (
    pathname !== "/multiplayer" ||
    (allowedOrigins.size > 0 && !allowedOrigins.has(origin))
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit("connection", ws, request);
  });
});

function send(ws, message) {
  if (ws.readyState !== WebSocket.OPEN) return;

  if (ws.bufferedAmount > 256 * 1024) {
    ws.close(1013, "Connection too slow");
    return;
  }

  ws.send(JSON.stringify(message));
}

function broadcast(message, exceptId = null) {
  for (const player of players.values()) {
    if (player.id !== exceptId) {
      send(player.ws, message);
    }
  }
}

function initialSpawn(slot) {
  return {
    position: [
      -15 + (slot % 4) * 10,
      1.2,
      -72 + Math.floor(slot / 4) * 10
    ],
    rotation: [0, 0, 0, 1]
  };
}

function initialState(spawn) {
  return {
    position: [...spawn.position],
    rotation: [...spawn.rotation],
    velocity: [0, 0, 0],
    steering: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    gear: 0,
    rpm: 0,
    engineRunning: false,
    mode: "arcade",
    paused: false
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    color: player.color,
    spawn: player.spawn,
    state: player.state
  };
}

function validVector(value, length, limit) {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(component =>
      Number.isFinite(component) &&
      Math.abs(component) <= limit
    )
  );
}

function bounded(value, min, max, fallback = 0) {
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function validateState(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (!validVector(raw.position, 3, 500)) return null;
  if (!validVector(raw.velocity, 3, 200)) return null;
  if (!validVector(raw.rotation, 4, 1.01)) return null;

  const length = Math.hypot(...raw.rotation);

  if (length < 0.5 || length > 1.5) return null;

  return {
    position: [...raw.position],
    rotation: raw.rotation.map(value => value / length),
    velocity: [...raw.velocity],

    steering: bounded(raw.steering, -1, 1),
    throttle: bounded(raw.throttle, 0, 1),
    brake: bounded(raw.brake, 0, 1),
    clutch: bounded(raw.clutch, 0, 1),

    gear:
      Number.isInteger(raw.gear) &&
      raw.gear >= -1 &&
      raw.gear <= 6
        ? raw.gear
        : 0,

    rpm: bounded(raw.rpm, 0, 12000),
    engineRunning: raw.engineRunning === true,
    mode: raw.mode === "manual" ? "manual" : "arcade",
    paused: raw.paused === true
  };
}

wss.on("connection", ws => {
  ws.on("error", error => {
    console.warn("WebSocket error:", error.message);
  });

  if (players.size >= MAX_PLAYERS) {
    send(ws, {
      type: "error",
      message: "This session is full. Maximum eight players."
    });

    ws.close(4001, "Session full");
    return;
  }

  const usedSlots = new Set(
    Array.from(players.values(), player => player.slot)
  );

  let slot = 0;
  while (usedSlots.has(slot)) slot++;

  const spawn = initialSpawn(slot);

  const player = {
    id: randomUUID(),
    ws,
    slot,
    color: COLORS[slot],
    spawn,
    state: initialState(spawn),
    lastSequence: -1,
    rateWindow: Date.now(),
    messageCount: 0
  };

  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  players.set(player.id, player);

  send(ws, {
    type: "welcome",
    protocol: 1,
    self: publicPlayer(player),
    players: Array.from(players.values(), publicPlayer)
  });

  broadcast({
    type: "join",
    player: publicPlayer(player)
  }, player.id);

  console.log(
    `Joined ${player.id} (${players.size}/${MAX_PLAYERS})`
  );

  ws.on("message", (data, isBinary) => {
    const now = Date.now();

    if (now - player.rateWindow >= 1000) {
      player.rateWindow = now;
      player.messageCount = 0;
    }

    player.messageCount++;

    if (player.messageCount > 50) {
      ws.close(1008, "Message rate exceeded");
      return;
    }

    if (isBinary) {
      ws.close(1003, "Text messages required");
      return;
    }

    let message;

    try {
      message = JSON.parse(data.toString());
    } catch {
      ws.close(1007, "Invalid JSON");
      return;
    }

    if (message?.type !== "state") return;

    if (
      !Number.isSafeInteger(message.sequence) ||
      message.sequence <= player.lastSequence
    ) {
      return;
    }

    const state = validateState(message.state);

    if (!state) return;

    player.lastSequence = message.sequence;
    player.state = state;
  });

  ws.on("close", () => {
    if (!players.delete(player.id)) return;

    broadcast({
      type: "leave",
      id: player.id
    });

    console.log(
      `Left ${player.id} (${players.size}/${MAX_PLAYERS})`
    );
  });
});

const snapshotTimer = setInterval(() => {
  if (!players.size) return;

  broadcast({
    type: "snapshot",
    players: Array.from(players.values(), player => ({
      id: player.id,
      state: player.state
    }))
  });
}, 1000 / SNAPSHOT_RATE);

const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}, 10000);

function shutdown() {
  clearInterval(snapshotTimer);
  clearInterval(heartbeatTimer);

  for (const ws of wss.clients) {
    ws.close(1001, "Server shutting down");
  }

  server.close();
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Driveworld listening on ${HOST}:${PORT}`);
  console.log(`Serving production game from ${DIST_DIRECTORY}`);
  console.log(`Multiplayer capacity: ${MAX_PLAYERS}`);
});