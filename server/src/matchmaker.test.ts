import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Matchmaker, RECONNECT_GRACE_MS, type Connection } from "./matchmaker";
import { COUNTDOWN_MS } from "./duelSession";
import type { MatchSnapshot } from "../../shared/protocol";

interface FakeConn extends Connection {
  events: { event: string; payload: any }[];
  last(event: string): any;
}

let nextId = 0;
// Pass an existing conn's id to simulate that player reconnecting.
function conn(id?: string): FakeConn {
  nextId += 1;
  const events: FakeConn["events"] = [];
  return {
    id: id ?? `p${nextId}`,
    events,
    emit: (event, payload) => events.push({ event, payload }),
    last: (event) => [...events].reverse().find((e) => e.event === event)?.payload,
  };
}

const lastMatch = (c: FakeConn) => c.last("match") as MatchSnapshot | undefined;
const currentWord = (c: FakeConn) => {
  const you = lastMatch(c)!.you;
  return you.words[you.currentWordIndex - you.wordOffset].text;
};
const typeWord = (c: FakeConn) => mm.submitWord(c, [...currentWord(c)]);

let mm: Matchmaker;
beforeEach(() => {
  vi.useFakeTimers();
  mm = new Matchmaker();
});
afterEach(() => vi.useRealTimers());

describe("Matchmaker queue", () => {
  it("queues the first player and pairs the second", () => {
    const a = conn();
    const b = conn();
    mm.findMatch(a);
    expect(a.last("lobby")).toEqual({ status: "queued" });
    expect(mm.queueSize).toBe(1);

    mm.findMatch(b);
    expect(mm.queueSize).toBe(0);
    expect(mm.activeMatches).toBe(1);
    expect(lastMatch(a)?.phase).toBe("countdown");
    expect(lastMatch(b)?.opponentKind).toBe("human");
  });

  it("doesn't pair a player with themselves when they click twice", () => {
    const a = conn();
    mm.findMatch(a);
    mm.findMatch(a);
    expect(mm.queueSize).toBe(1);
    expect(mm.activeMatches).toBe(0);
  });

  it("cancelling or disconnecting removes a player from the queue", () => {
    const a = conn();
    const b = conn();
    mm.findMatch(a);
    mm.cancelQueue(a);
    expect(a.last("lobby")).toEqual({ status: "idle" });
    mm.findMatch(b);
    mm.disconnect(b);
    expect(mm.queueSize).toBe(0);
  });

  it("a new connection for a queued player keeps their place", () => {
    const a = conn();
    mm.findMatch(a);
    const a2 = conn(a.id);
    mm.connect(a2);
    mm.disconnect(a); // the replaced connection closing doesn't dequeue
    expect(a2.last("lobby")).toEqual({ status: "queued" });
    expect(mm.queueSize).toBe(1);
  });
});

describe("Matchmaker matches", () => {
  function paired() {
    const a = conn();
    const b = conn();
    mm.findMatch(a);
    mm.findMatch(b);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    return { a, b };
  }

  it("routes each player's words to their own seat only", () => {
    const { a, b } = paired();
    typeWord(a);
    expect(lastMatch(a)!.you.currentWordIndex).toBe(1);
    expect(lastMatch(a)!.you.combo).toBe(1);
    expect(lastMatch(b)!.you.currentWordIndex).toBe(0);
    expect(lastMatch(b)!.opponent.combo).toBe(1);
  });

  it("leaving mid-match forfeits to the opponent", () => {
    const { a, b } = paired();
    mm.leaveMatch(a);
    expect(lastMatch(b)!.result).toEqual({ outcome: "win", reason: "forfeit" });
    expect(lastMatch(b)!.opponentStatus).toBe("left");
    expect(lastMatch(a)!.result).toBeNull(); // the leaver isn't sent the result
  });

  it("rematch starts only once both players ask", () => {
    const { a, b } = paired();
    mm.leaveMatch(a); // forfeit → finished, but a is gone
    mm.rematch(b);
    expect(lastMatch(b)!.phase).toBe("finished"); // can't rematch someone who left
    expect(mm.activeMatches).toBe(1);
    mm.leaveMatch(b);
    expect(mm.activeMatches).toBe(0);
  });

  it("rematches when both players stay and agree", () => {
    const { a, b } = paired();
    // a types a long clean streak at a human pace; the attacks bury b.
    for (let i = 0; i < 150 && lastMatch(a)!.phase === "playing"; i++) {
      typeWord(a);
      vi.advanceTimersByTime(500);
    }
    expect(lastMatch(a)!.result).toEqual({ outcome: "win", reason: "ko" });
    expect(lastMatch(b)!.result).toEqual({ outcome: "loss", reason: "ko" });

    mm.rematch(a);
    expect(lastMatch(a)!.phase).toBe("finished");
    expect(lastMatch(b)!.rematch).toEqual({ you: false, opponent: true });

    mm.rematch(b);
    expect(lastMatch(a)!.phase).toBe("countdown");
    expect(lastMatch(b)!.you.currentWordIndex).toBe(0);
    expect(lastMatch(a)!.rematch).toEqual({ you: false, opponent: false });
  });

  it("finding a new match from a finished one leaves it cleanly", () => {
    const { a, b } = paired();
    mm.leaveMatch(b);
    mm.findMatch(a);
    expect(mm.activeMatches).toBe(0);
    expect(mm.queueSize).toBe(1);
  });
});

describe("Matchmaker reconnects", () => {
  function paired() {
    const a = conn();
    const b = conn();
    mm.findMatch(a);
    mm.findMatch(b);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    return { a, b };
  }

  it("holds a dropped player's seat and resumes it on reconnect", () => {
    const { a, b } = paired();
    typeWord(a);
    mm.disconnect(a);
    expect(lastMatch(b)!.opponentStatus).toBe("reconnecting");
    expect(lastMatch(b)!.result).toBeNull();

    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1000);
    const a2 = conn(a.id);
    mm.connect(a2);
    expect(lastMatch(a2)!.you.currentWordIndex).toBe(1);
    expect(lastMatch(b)!.opponentStatus).toBe("connected");

    // The grace timer was cancelled, so nothing forfeits later.
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(lastMatch(b)!.result?.reason).not.toBe("forfeit");
    typeWord(a2);
    expect(lastMatch(a2)!.you.currentWordIndex).toBe(2);
  });

  it("forfeits once the grace period runs out", () => {
    const { a, b } = paired();
    mm.disconnect(a);
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(lastMatch(b)!.result).toEqual({ outcome: "win", reason: "forfeit" });
    expect(lastMatch(b)!.opponentStatus).toBe("left");

    const a2 = conn(a.id);
    mm.connect(a2);
    expect(a2.last("lobby")).toEqual({ status: "idle" });
  });

  it("a connection replaced by a newer one closing doesn't count as a drop", () => {
    const { a, b } = paired();
    const a2 = conn(a.id);
    mm.connect(a2);
    mm.disconnect(a);
    expect(lastMatch(b)!.opponentStatus).toBe("connected");
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(lastMatch(b)!.result).toBeNull();
  });

  it("cleans the match up when both players drop for good", () => {
    const { a, b } = paired();
    mm.disconnect(a);
    mm.disconnect(b);
    expect(mm.activeMatches).toBe(1);
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(mm.activeMatches).toBe(0);
  });
});

describe("Matchmaker practice", () => {
  it("seats the player against a bot that actually types", () => {
    const a = conn();
    mm.practice(a);
    expect(lastMatch(a)!.opponentKind).toBe("bot");
    vi.advanceTimersByTime(COUNTDOWN_MS + 2000);
    expect(lastMatch(a)!.opponent.combo).toBeGreaterThan(0);
  });

  it("the bot always accepts a rematch", () => {
    const a = conn();
    mm.practice(a);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    mm.leaveMatch(a);
    mm.practice(a);
    expect(mm.activeMatches).toBe(1);
    expect(lastMatch(a)!.rematch.opponent).toBe(true);
  });
});
