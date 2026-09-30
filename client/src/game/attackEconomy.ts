// Pure logic for the attack economy: no React, no networking. Safe to unit
// test directly, and shaped so it can move into a server-authoritative
// module later without changes.

export const ATTACK_THRESHOLD = 30; // meter needed to generate one "unit" of attack power
export const TELEGRAPH_MS = 1000; // delay between a send and it landing
export const QUEUE_CAPACITY = 20; // backlog size that triggers a KO
export const COMBO_STEP = 0.1; // multiplier growth per combo point
export const COMBO_CAP = 3; // multiplier ceiling

export interface PendingAttack {
  id: string;
  power: number;
  arrivalAt: number; // epoch ms
}

let attackIdCounter = 0;
function makeAttackId(): string {
  attackIdCounter += 1;
  return `attack-${attackIdCounter}`;
}

export function getWordValue(word: string): number {
  return word.length;
}

export function getComboMultiplier(combo: number): number {
  return Math.min(1 + combo * COMBO_STEP, COMBO_CAP);
}

export function computeMeterGain(word: string, combo: number): number {
  return getWordValue(word) * getComboMultiplier(combo);
}

// Splits a meter value into "whatever crosses the threshold" (sent as a
// burst, in whole multiples of the threshold) and the remainder, which
// stays in the meter.
export function extractBurst(meter: number): { burstPower: number; remainingMeter: number } {
  if (meter < ATTACK_THRESHOLD) {
    return { burstPower: 0, remainingMeter: meter };
  }
  const burstPower = Math.floor(meter / ATTACK_THRESHOLD) * ATTACK_THRESHOLD;
  return { burstPower, remainingMeter: meter - burstPower };
}

// A burst cancels the sender's own incoming pending attacks first (oldest
// first, like Tetris garbage-canceling). Whatever's left after fully
// clearing them becomes real outgoing power.
export function applyBurst(
  pending: PendingAttack[],
  burstPower: number
): { updatedPending: PendingAttack[]; outgoingPower: number } {
  let remaining = burstPower;
  const updatedPending: PendingAttack[] = [];

  for (const attack of pending) {
    if (remaining <= 0) {
      updatedPending.push(attack);
      continue;
    }
    if (attack.power <= remaining) {
      remaining -= attack.power; // fully canceled, drop it
    } else {
      updatedPending.push({ ...attack, power: attack.power - remaining });
      remaining = 0;
    }
  }

  return { updatedPending, outgoingPower: remaining };
}

export interface BurstResult {
  senderPending: PendingAttack[];
  targetPending: PendingAttack[];
}

// Combines applyBurst with attaching the leftover (if any) as a new
// telegraphed attack heading for the target.
export function resolveBurstBetween(
  senderPending: PendingAttack[],
  targetPending: PendingAttack[],
  burstPower: number,
  now: number
): BurstResult {
  const { updatedPending, outgoingPower } = applyBurst(senderPending, burstPower);
  if (outgoingPower <= 0) {
    return { senderPending: updatedPending, targetPending };
  }
  return {
    senderPending: updatedPending,
    targetPending: [
      ...targetPending,
      { id: makeAttackId(), power: outgoingPower, arrivalAt: now + TELEGRAPH_MS },
    ],
  };
}

export function powerToWords(power: number): number {
  return Math.round(power / ATTACK_THRESHOLD);
}

// Pulls out whichever pending attacks have arrived by `now`, converts
// their combined power into a word count, and returns what's still
// in flight.
export function resolveDueAttacks(
  pending: PendingAttack[],
  now: number
): { stillPending: PendingAttack[]; wordsToAdd: number } {
  const due = pending.filter((a) => a.arrivalAt <= now);
  const stillPending = pending.filter((a) => a.arrivalAt > now);
  const totalPower = due.reduce((sum, a) => sum + a.power, 0);
  return { stillPending, wordsToAdd: powerToWords(totalPower) };
}

export function isOverCapacity(backlog: number): boolean {
  return backlog > QUEUE_CAPACITY;
}
