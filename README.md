# Typing Duel Game
(to be renamed once I have a better name in mind)

If you've ever played competitive tetr.io, then this is basically the TypeRacer version of that.

# Running this

Two terminals, both need `npm install` on first run.

**Terminal 1 — server**
```
cd server
npm install
npm run dev
```
Runs on http://localhost:3001. `/api/words?count=50` returns random words from the hard-coded bank in `src/wordBank.ts`.

**Terminal 2 — client**
```
cd client
npm install
npm run dev
```
Runs on http://localhost:5173 (Vite will tell you if it picks a different port). The client needs the server running — it shows "connecting to server…" until it can reach it.

**Playing a real match locally:** open the client in two browser tabs (or two browsers) and click **find match** in both. The first player waits in the queue; the second gets paired with them, and both start after a 3-second countdown. **practice vs bot** starts a solo match against a scripted opponent instead.

To play across machines on the same network, run the client with `VITE_API_URL=http://<server-machine-ip>:3001 npm run dev -- --host` and open the printed network URL on the other machine.

## What's implemented

- Word queue that auto-refills from the server as you type through it
- Per-character correctness highlighting on the current word
- Combo counter — resets on any backspace or a wrong word, not just a wrong word at submission
- Live WPM (standard 5-chars-per-word, counting only cleanly-typed words) and running accuracy
- Attack economy: clean words fill an attack meter (scaled by combo); full meter sends words to your opponent after a 1s telegraph, cancelling your own incoming attacks first. Backlog over 20 words = KO
- Server-authoritative matches: the server decides correctness, combo, attacks and KOs; clients just send finished words
- Quick-match queue pairing two real players, synced countdown, forfeit on leave/disconnect, rematch voting, and a practice bot

More to come!
