import express from "express";
import cors from "cors";
import { getRandomWords } from "./wordBank";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

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

app.listen(PORT, () => {
  console.log(`Typing duel server listening on http://localhost:${PORT}`);
});
