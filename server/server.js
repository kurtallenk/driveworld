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
const MAX_NAME_LENGTH = 16;
const MAX_CHAT_LENGTH = 200;
const CHAT_WINDOW_MS = 4000;
const CHAT_LIMIT_PER_WINDOW = 6;

// Session-only delivery stats (Phase 2). There is no database in this
// project, so the leaderboard tracks players connected during the
// current server process rather than persisting across restarts.
const DELIVERY_REWARD = 25;
const MIN_DELIVERY_INTERVAL_MS = 3000;
const LEADERBOARD_SIZE = 10;

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

// Strip control characters and bidi/zero-width tricks; the client-sent
// name is never trusted beyond this sanitization.
function sanitizeName(raw) {
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E<>]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);

  return cleaned.length > 0 ? cleaned : null;
}

function fallbackName(id) {
  return `Racer${id.slice(0, 4)}`;
}

function sanitizeChatMessage(raw) {
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_CHAT_LENGTH);

  return cleaned.length > 0 ? cleaned : null;
}

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

const TURRET_STATES = new Set([
  "undeployed", "deploying", "deployed", "undeploying"
]);

function initialTurretState() {
  return { state: "undeployed", yaw: 0, pitch: 0, fireSeq: 0 };
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
    paused: false,
    turret: initialTurretState(),
    health: 100,
    maxHealth: 100,
    turbo: false
  };
}

// Only the turret's state/aim/fire-event fields are ever synchronized (see
// client MultiplayerClient.sendState / RemoteTurret.js) -- never the
// individual mechanical parts, so this validator stays this small.
function validateTurret(raw) {
  if (!raw || typeof raw !== "object") return initialTurretState();

  return {
    state: TURRET_STATES.has(raw.state) ? raw.state : "undeployed",
    yaw: bounded(raw.yaw, -Math.PI, Math.PI),
    pitch: bounded(raw.pitch, -Math.PI, Math.PI),
    fireSeq: Number.isInteger(raw.fireSeq)
      ? Math.max(0, Math.min(65535, raw.fireSeq))
      : 0
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    spawn: player.spawn,
    state: player.state
  };
}

function buildLeaderboard() {
  return Array.from(players.values())
    .filter(player => player.deliveries > 0)
    .sort((a, b) => b.deliveries - a.deliveries)
    .slice(0, LEADERBOARD_SIZE)
    .map(player => ({
      name: player.name,
      deliveries: player.deliveries,
      score: player.score
    }));
}

function broadcastLeaderboard() {
  broadcast({ type: "leaderboard", entries: buildLeaderboard() });
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
    paused: raw.paused === true,
    turret: validateTurret(raw.turret),

    // No PvP damage exists server-side (see MultiplayerClient.sendState),
    // so health is just another client-reported presentation value like
    // steering/throttle above -- bounded here the same way, never trusted
    // for anything beyond drawing an HP bar.
    maxHealth: bounded(raw.maxHealth, 1, 100000, 100),
    health: bounded(raw.health, 0, bounded(raw.maxHealth, 1, 100000, 100)),

    turbo: raw.turbo === true
  };
}

wss.on("connection", (ws, request) => {
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
  const id = randomUUID();

  let requestedName = null;

  try {
    const { searchParams } = new URL(request.url, "http://localhost");
    requestedName = sanitizeName(searchParams.get("name"));
  } catch {
    requestedName = null;
  }

  const player = {
    id,
    ws,
    slot,
    name: requestedName || fallbackName(id),
    color: COLORS[slot],
    spawn,
    state: initialState(spawn),
    lastSequence: -1,
    rateWindow: Date.now(),
    messageCount: 0,
    chatWindow: Date.now(),
    chatCount: 0,
    deliveries: 0,
    score: 0,
    lastDeliveryAt: 0
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
    players: Array.from(players.values(), publicPlayer),
    leaderboard: buildLeaderboard()
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

    if (message?.type === "state") {
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
      return;
    }

    if (message?.type === "delivery") {
      const now = Date.now();

      // The client determines completion locally (proximity to a beacon);
      // this only guards the shared leaderboard against spam, it does not
      // re-validate the delivery itself.
      if (now - player.lastDeliveryAt < MIN_DELIVERY_INTERVAL_MS) return;

      player.lastDeliveryAt = now;
      player.deliveries++;
      player.score += DELIVERY_REWARD;

      broadcastLeaderboard();
      return;
    }

    if (message?.type === "chat") {
      const chatNow = Date.now();

      if (chatNow - player.chatWindow >= CHAT_WINDOW_MS) {
        player.chatWindow = chatNow;
        player.chatCount = 0;
      }

      player.chatCount++;

      // Silently drop messages over the burst limit instead of
      // disconnecting; the generic message-rate check above already
      // guards against outright flooding.
      if (player.chatCount > CHAT_LIMIT_PER_WINDOW) return;

      const text = sanitizeChatMessage(message.message);

      if (!text) return;

      // The server, never the client, is the source of truth for who
      // sent a message and under what name.
      broadcast({
        type: "chat",
        playerId: player.id,
        playerName: player.name,
        message: text,
        timestamp: Date.now()
      });

      return;
    }
  });

  ws.on("close", () => {
    if (!players.delete(player.id)) return;

    broadcast({
      type: "leave",
      id: player.id
    });

    broadcastLeaderboard();

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