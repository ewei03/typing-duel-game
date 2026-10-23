import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server, type Socket } from "socket.io";
import { getRandomWords } from "./wordBank";
import { Matchmaker } from "./matchmaker";

const app = express();
app.use(cors());

// Returns a batch of random words from the hard-coded bank.
// ?count controls how many (defaults to 50, capped at 200).
app.get("/api/words", (req, res) => {
  const requested = Number(req.query.count);
  const count = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 200) : 50;
  res.json({ words: getRandomWords(count) });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const matchmaker = new Matchmaker();

io.on("connection", (socket: Socket) => {
  console.log(`client connected: ${socket.id}`);
  socket.emit("lobby", { status: "idle" });

  socket.on("findMatch", () => matchmaker.findMatch(socket));
  socket.on("cancelQueue", () => matchmaker.cancelQueue(socket));
  socket.on("practice", () => matchmaker.practice(socket));
  socket.on("rematch", () => matchmaker.rematch(socket));
  socket.on("leaveMatch", () => matchmaker.leaveMatch(socket));

  socket.on("submitWord", (payload: { text?: unknown; hadError?: unknown }) => {
    // Words in the bank are short; anything huge is garbage, not a typo.
    if (!payload || typeof payload.text !== "string" || payload.text.length > 64) return;
    matchmaker.submitWord(socket, payload.text, Boolean(payload.hadError));
  });

  socket.on("disconnect", () => {
    matchmaker.disconnect(socket);
    console.log(`client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
httpServer.listen(PORT, () => {
  console.log(`Typing duel server listening on http://localhost:${PORT}`);
});
