import { describe, it, expect } from "vitest";
import {
  BACKSPACE,
  MAX_KEYSTROKES_PER_WORD,
  diffKeystrokes,
  parseKeystrokes,
  replayKeystrokes,
} from "../../shared/keystrokes";
import { TokenBucket } from "./tokenBucket";
import { WORD_BANK } from "./wordBank";

describe("keystroke logs", () => {
  it("diffs plain typing as one key per character", () => {
    expect(diffKeystrokes("ca", "cat")).toEqual(["t"]);
  });

  it("diffs a replacement as deletes back to the common prefix, then typing", () => {
    expect(diffKeystrokes("cart", "cat")).toEqual([BACKSPACE, BACKSPACE, "t"]);
  });

  it("replays the log a sequence of edits produced", () => {
    const edits = ["c", "cx", "c", "ca", "cat"];
    const keys = edits.flatMap((next, i) => diffKeystrokes(edits[i - 1] ?? "", next));
    expect(replayKeystrokes(keys)).toEqual({ text: "cat", corrected: true });
    expect(replayKeystrokes([..."cat"])).toEqual({ text: "cat", corrected: false });
  });

  it("rejects malformed logs off the wire", () => {
    expect(parseKeystrokes([..."cat"])).toEqual(["c", "a", "t"]);
    expect(parseKeystrokes("cat")).toBeNull();
    expect(parseKeystrokes(["ca", "t"])).toBeNull();
    expect(parseKeystrokes([1])).toBeNull();
    expect(parseKeystrokes(new Array(MAX_KEYSTROKES_PER_WORD + 1).fill("a"))).toBeNull();
  });
});

describe("TokenBucket", () => {
  it("allows a burst, then refills at the given rate", () => {
    const bucket = new TokenBucket(10, 5, 0);
    expect(bucket.take(5, 0)).toBe(true);
    expect(bucket.take(1, 0)).toBe(false);
    expect(bucket.take(1, 100)).toBe(true);
    expect(bucket.take(5, 10_000)).toBe(true); // capped at capacity, not 100
    expect(bucket.take(1, 10_000)).toBe(false);
  });
});

describe("WORD_BANK", () => {
  it("is plain lowercase words with no duplicates", () => {
    expect(WORD_BANK.length).toBeGreaterThan(500);
    expect(new Set(WORD_BANK).size).toBe(WORD_BANK.length);
    for (const word of WORD_BANK) expect(word).toMatch(/^[a-z]+$/);
  });
});
