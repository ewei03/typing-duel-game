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
Runs on http://localhost:5173 (Vite will tell you if it picks a different port). Open it in a browser and start typing — the currently-active word is underlined, characters go green/red as you type them, and pressing space submits the word.

If the server isn't running, the client falls back to a small local word list automatically (you'll see a note about it on screen), so you can still poke at the UI without both terminals up.

## What's implemented

- Word queue that auto-refills from the server as you type through it
- Per-character correctness highlighting on the current word
- Combo counter — resets on any backspace or a wrong word, not just a wrong word at submission
- Live WPM (standard 5-chars-per-word, counting only cleanly-typed words) and running accuracy

More to come!
