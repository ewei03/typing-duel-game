import { describe, it, expect } from "vitest";
import {
  ATTACK_THRESHOLD,
  getComboMultiplier,
  computeMeterGain,
  extractBurst,
  applyBurst,
  resolveBurstBetween,
  powerToWords,
  resolveDueAttacks,
  isOverCapacity,
} from "./attackEconomy";

describe("getComboMultiplier", () => {
  it("is 1x with no combo", () => {
    expect(getComboMultiplier(0)).toBe(1);
  });

  it("grows with combo, capped at 3x", () => {
    expect(getComboMultiplier(10)).toBeCloseTo(2);
    expect(getComboMultiplier(100)).toBe(3);
  });
});

describe("computeMeterGain", () => {
  it("scales with word length and combo", () => {
    expect(computeMeterGain("cat", 0)).toBe(3);
    expect(computeMeterGain("cat", 10)).toBeCloseTo(6);
  });
});

describe("extractBurst", () => {
  it("sends nothing below threshold", () => {
    expect(extractBurst(10)).toEqual({ burstPower: 0, remainingMeter: 10 });
  });

  it("sends whole multiples of the threshold, keeps the remainder", () => {
    expect(extractBurst(75)).toEqual({ burstPower: 60, remainingMeter: 15 });
  });
});

describe("applyBurst", () => {
  it("goes entirely outgoing with no pending attacks", () => {
    const { updatedPending, outgoingPower } = applyBurst([], 30);
    expect(updatedPending).toEqual([]);
    expect(outgoingPower).toBe(30);
  });

  it("fully cancels a smaller pending attack and sends the remainder", () => {
    const pending = [{ id: "a", power: 20, arrivalAt: 1000 }];
    const { updatedPending, outgoingPower } = applyBurst(pending, 30);
    expect(updatedPending).toEqual([]);
    expect(outgoingPower).toBe(10);
  });

  it("only partially cancels a larger pending attack, nothing goes out", () => {
    const pending = [{ id: "a", power: 50, arrivalAt: 1000 }];
    const { updatedPending, outgoingPower } = applyBurst(pending, 30);
    expect(updatedPending).toEqual([{ id: "a", power: 20, arrivalAt: 1000 }]);
    expect(outgoingPower).toBe(0);
  });

  it("cancels oldest pending attacks first", () => {
    const pending = [
      { id: "old", power: 20, arrivalAt: 1000 },
      { id: "new", power: 20, arrivalAt: 2000 },
    ];
    const { updatedPending, outgoingPower } = applyBurst(pending, 30);
    expect(updatedPending).toEqual([{ id: "new", power: 10, arrivalAt: 2000 }]);
    expect(outgoingPower).toBe(0);
  });
});

describe("resolveBurstBetween", () => {
  it("attaches the leftover as a new pending attack on the target", () => {
    const result = resolveBurstBetween([], [], 30, 5000);
    expect(result.senderPending).toEqual([]);
    expect(result.targetPending).toHaveLength(1);
    expect(result.targetPending[0].power).toBe(30);
    expect(result.targetPending[0].arrivalAt).toBe(5000 + 1000);
  });

  it("adds nothing to the target when the burst is fully self-canceled", () => {
    const senderPending = [{ id: "a", power: 40, arrivalAt: 1000 }];
    const result = resolveBurstBetween(senderPending, [], 30, 5000);
    expect(result.targetPending).toEqual([]);
    expect(result.senderPending).toEqual([{ id: "a", power: 10, arrivalAt: 1000 }]);
  });
});

describe("powerToWords", () => {
  it("converts power to a word count using the threshold as the unit", () => {
    expect(powerToWords(ATTACK_THRESHOLD)).toBe(1);
    expect(powerToWords(ATTACK_THRESHOLD * 3)).toBe(3);
  });
});

describe("resolveDueAttacks", () => {
  it("only resolves attacks whose arrival time has passed", () => {
    const pending = [
      { id: "a", power: ATTACK_THRESHOLD, arrivalAt: 1000 },
      { id: "b", power: ATTACK_THRESHOLD, arrivalAt: 3000 },
    ];
    const { stillPending, wordsToAdd } = resolveDueAttacks(pending, 2000);
    expect(stillPending).toEqual([pending[1]]);
    expect(wordsToAdd).toBe(1);
  });

  it("combines power across multiple due attacks before converting", () => {
    const pending = [
      { id: "a", power: 15, arrivalAt: 1000 },
      { id: "b", power: 15, arrivalAt: 1000 },
    ];
    const { wordsToAdd } = resolveDueAttacks(pending, 2000);
    expect(wordsToAdd).toBe(1);
  });
});

describe("isOverCapacity", () => {
  it("is false at or under capacity, true over it", () => {
    expect(isOverCapacity(20)).toBe(false);
    expect(isOverCapacity(21)).toBe(true);
  });
});
