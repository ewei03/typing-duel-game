import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DuelSession, COUNTDOWN_MS, KEY_BURST, type Seat } from "./duelSession";
import { ATTACK_THRESHOLD, QUEUE_CAPACITY, TELEGRAPH_MS } from "../../shared/attackEconomy";
import { BACKSPACE } from "../../shared/keystrokes";

function startedSession() {
  const s = new DuelSession(() => {});
  s.start();
  vi.advanceTimersByTime(COUNTDOWN_MS);
  return s;
}

// Types the seat's current word cleanly, one keystroke per character.
function typeWord(s: DuelSession, seat: Seat) {
  s.submitWord(seat, [...s.getCurrentWord(seat)]);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("DuelSession lifecycle", () => {
  it("ignores typing during the countdown, then accepts it once playing", () => {
    const s = new DuelSession(() => {});
    s.start();
    expect(s.phase).toBe("countdown");
    expect(s.getSnapshot(0).countdownMs).toBe(COUNTDOWN_MS);

    typeWord(s, 0);
    expect(s.players[0].currentWordIndex).toBe(0);

    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(s.phase).toBe("playing");
    typeWord(s, 0);
    expect(s.players[0].currentWordIndex).toBe(1);
    expect(s.players[0].combo).toBe(1);
    s.destroy();
  });

  it("forfeit gives the other seat the win, from each seat's perspective", () => {
    const s = startedSession();
    s.forfeit(1);
    expect(s.phase).toBe("finished");
    expect(s.getSnapshot(0).result).toEqual({ outcome: "win", reason: "forfeit" });
    expect(s.getSnapshot(1).result).toEqual({ outcome: "loss", reason: "forfeit" });
  });

  it("start() again resets both players for a rematch", () => {
    const s = startedSession();
    typeWord(s, 1);
    s.forfeit(0);
    s.start();
    expect(s.phase).toBe("countdown");
    expect(s.result).toBeNull();
    expect(s.players[1].currentWordIndex).toBe(0);
    s.destroy();
  });
});

describe("DuelSession keystroke checks", () => {
  it("a word fixed with backspace still breaks the combo", () => {
    const s = startedSession();
    typeWord(s, 0);
    const word = s.getCurrentWord(0);
    s.submitWord(0, ["x", BACKSPACE, ...word]);
    expect(s.players[0].combo).toBe(0);
    expect(s.players[0].words[1].correct).toBe(false);
    s.destroy();
  });

  it("counts words typed faster than a human could as misses", () => {
    const s = startedSession();
    // Drain the burst allowance with no time passing.
    let typed = 0;
    while (typed < KEY_BURST) {
      typed += s.getCurrentWord(0).length + 1;
      typeWord(s, 0);
    }
    typeWord(s, 0);
    expect(s.players[0].combo).toBe(0);
    expect(s.players[0].flaggedWords).toBeGreaterThan(0);

    // After a pause the budget has refilled and words count again.
    vi.advanceTimersByTime(2000);
    typeWord(s, 0);
    expect(s.players[0].combo).toBe(1);
    s.destroy();
  });

  it("snapshots carry only a window of the queue around the current word", () => {
    const s = startedSession();
    for (let i = 0; i < 3; i++) typeWord(s, 0);
    const you = s.getSnapshot(0).you;
    expect(you.wordOffset).toBe(1);
    expect(you.words).toHaveLength(9);
    expect(you.words[you.currentWordIndex - you.wordOffset].text).toBe(s.getCurrentWord(0));
    expect(you.words[0].correct).toBe(true);
    s.destroy();
  });
});

describe("DuelSession attacks between seats", () => {
  it("a burst from one seat lands as attack words in the other seat's queue", () => {
    const s = startedSession();
    s.players[0].meter = ATTACK_THRESHOLD - 0.01; // next correct word bursts
    typeWord(s, 0);
    expect(s.players[1].pendingIncoming).toHaveLength(1);

    vi.advanceTimersByTime(TELEGRAPH_MS + 100);
    const target = s.players[1];
    expect(target.backlog).toBeGreaterThan(0);
    expect(target.words[target.currentWordIndex + 1].fromAttack).toBe(true);
    // The sender's own queue is untouched.
    expect(s.players[0].words.some((w) => w.fromAttack)).toBe(false);
    s.destroy();
  });

  it("KOs the seat that goes over capacity", () => {
    const s = startedSession();
    s.players[1].backlog = QUEUE_CAPACITY;
    s.players[1].pendingIncoming = [{ id: "x", power: ATTACK_THRESHOLD, arrivalAt: Date.now() }];
    vi.advanceTimersByTime(100);
    expect(s.phase).toBe("finished");
    expect(s.getSnapshot(0).result).toEqual({ outcome: "win", reason: "ko" });
  });

  it("is a draw when both seats top out on the same tick", () => {
    const s = startedSession();
    for (const p of s.players) {
      p.backlog = QUEUE_CAPACITY;
      p.pendingIncoming = [{ id: "x", power: ATTACK_THRESHOLD, arrivalAt: Date.now() }];
    }
    vi.advanceTimersByTime(100);
    expect(s.getSnapshot(0).result?.outcome).toBe("draw");
    expect(s.getSnapshot(1).result?.outcome).toBe("draw");
  });
});
