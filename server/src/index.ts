import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server, type Socket } from "socket.io";
import { Matchmaker, type Connection } from "./matchmaker";
import { TokenBucket } from "./tokenBucket";
import { parseKeystrokes } from "../../shared/keystrokes";

// Per-socket ceiling on events of any kind. Typing at the speed cap is a
// handful of words a second, so this only ever bites floods.
const EVENTS_PER_SEC = 30;
const EVENT_BURST = 60;
const PLAYER_ID_PATTERN = /^[0-9a-f]{32}$/;

// Comma-separated list of other origins allowed to talk to this server.
// Only needed when the client is hosted somewhere else: unset means
// same-origin only in production, and any origin while developing.
function allowedOrigins(): string[] | "*" | false {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (raw) return raw.split(",").map((o) => o.trim()).filter(Boolean);
  return process.env.NODE_ENV === "production" ? false : "*";
}

const origin = allowedOrigins();
const app = express();
app.use(cors({ origin }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// In production the built client is served from here too, so the whole
// game is one service on one origin.
if (process.env.STATIC_DIR) {
  app.use(express.static(process.env.STATIC_DIR));
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin },
  // Every client→server message is tiny; refuse anything that isn't.
  maxHttpBufferSize: 16 * 1024,
});

const matchmaker = new Matchmaker();
// The live socket for each player, so a second tab can take over.
const socketsByPlayer = new Map<string, Socket>();

// The client sends a random id it keeps for the life of the tab, which is
// what lets a reconnect land back in the same seat. Without a valid one
// the player still gets to play, just without reconnects.
io.use((socket, next) => {
  const id: unknown = socket.handshake.auth?.playerId;
  socket.data.playerId =
    typeof id === "string" && PLAYER_ID_PATTERN.test(id) ? id : `anon-${socket.id}`;
  next();
});

io.on("connection", (socket: Socket) => {
  const playerId: string = socket.data.playerId;
  const conn: Connection = { id: playerId, emit: (event, payload) => socket.emit(event, payload) };
  console.log(`player connected: ${playerId} (socket ${socket.id})`);

  const events = new TokenBucket(EVENTS_PER_SEC, EVENT_BURST);
  socket.use((_packet, next) => {
    // Dropped silently: passing an error to next() would surface as an
    // "error" event, which isn't worth handling for a flood.
    if (events.take(1)) next();
  });

  // Register the new socket before hanging up on the old one, so the old
  // socket's disconnect is recognised as superseded rather than a drop.
  const previous = socketsByPlayer.get(playerId);
  socketsByPlayer.set(playerId, socket);
  matchmaker.connect(conn);
  previous?.disconnect(true);

  socket.on("findMatch", () => matchmaker.findMatch(conn));
  socket.on("cancelQueue", () => matchmaker.cancelQueue(conn));
  socket.on("practice", () => matchmaker.practice(conn));
  socket.on("rematch", () => matchmaker.rematch(conn));
  socket.on("leaveMatch", () => matchmaker.leaveMatch(conn));

  socket.on("submitWord", (payload: { keys?: unknown } | undefined) => {
    // A malformed log still uses up the word, as a miss, so the client's
    // queue doesn't silently fall out of step with ours.
    matchmaker.submitWord(conn, parseKeystrokes(payload?.keys) ?? []);
  });

  socket.on("disconnect", () => {
    if (socketsByPlayer.get(playerId) === socket) socketsByPlayer.delete(playerId);
    matchmaker.disconnect(conn);
    console.log(`player disconnected: ${playerId} (socket ${socket.id})`);
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
httpServer.listen(PORT, () => {
  console.log(`Typing duel server listening on http://localhost:${PORT}`);
});

// Hosts send SIGTERM before replacing the instance on a deploy. Matches
// live in memory, so they're lost either way, but closing the sockets
// cleanly sends every client off to reconnect to the new instance
// straight away instead of waiting to time out.
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  io.close(() => process.exit(0));
});
