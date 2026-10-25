import { getRandomWords } from "./wordBank";
import { TokenBucket } from "./tokenBucket";
import {
  computeMeterGain,
  extractBurst,
  resolveBurstBetween,
  resolveDueAttacks,
  isOverCapacity,
  type PendingAttack,
} from "../../shared/attackEconomy";
import { replayKeystrokes } from "../../shared/keystrokes";
import {
  QUEUE_WINDOW_AHEAD,
  QUEUE_WINDOW_BEHIND,
  type DuelSnapshot,
  type MatchResult,
  type Phase,
  type PublicStats,
  type QueueWord,
} from "../../shared/protocol";

const MIN_WORDS_AHEAD = 20;
const FETCH_BATCH_SIZE = 30;
const RESOLVE_TICK_MS = 100;
export const COUNTDOWN_MS = 3000;

// Sustained keystrokes per second a human can plausibly hold (25/s is
// 300 WPM), plus enough burst to absorb a couple of seconds of words
// arriving bunched up after network jitter. Words typed faster than this
// still advance the queue but count as wrong.
export const MAX_KEYS_PER_SEC = 25;
export const KEY_BURST = 50;

export type Seat = 0 | 1;

interface PlayerState {
  words: QueueWord[];
  currentWordIndex: number;
  combo: number;
  maxCombo: number;
  wordsTyped: number;
  wordsCorrect: number;
  correctChars: number;
  meter: number;
  backlog: number;
  pendingIncoming: PendingAttack[];
  ko: boolean;
  typingBudget: TokenBucket;
  // Words rejected for arriving faster than a human could type them.
  flaggedWords: number;
}

function freshPlayer(): PlayerState {
  return {
    words: getRandomWords(FETCH_BATCH_SIZE).map((text) => ({ text, fromAttack: false })),
    currentWordIndex: 0,
    combo: 0,
    maxCombo: 0,
    wordsTyped: 0,
    wordsCorrect: 0,
    correctChars: 0,
    meter: 0,
    backlog: 0,
    pendingIncoming: [],
    ko: false,
    typingBudget: new TokenBucket(MAX_KEYS_PER_SEC, KEY_BURST),
    flaggedWords: 0,
  };
}

function ensureBuffer(player: PlayerState) {
  const remaining = player.words.length - player.currentWordIndex;
  if (remaining < MIN_WORDS_AHEAD) {
    const more = getRandomWords(FETCH_BATCH_SIZE).map((text) => ({ text, fromAttack: false }));
    player.words = [...player.words, ...more];
  }
}

// Attack words jump the queue — inserted right after the word currently
// being typed, rather than tacked onto the end of the buffer — so they
// create immediate pressure (and are immediately visible) instead of
// quietly waiting at the back of a 20-word buffer.
function insertAttackWords(player: PlayerState, words: string[]) {
  const insertAt = Math.min(player.currentWordIndex + 1, player.words.length);
  const entries = words.map((text) => ({ text, fromAttack: true }));
  player.words = [...player.words.slice(0, insertAt), ...entries, ...player.words.slice(insertAt)];
}

function toPublicStats(p: PlayerState, startTime: number | null, now: number): PublicStats {
  const elapsedMinutes = startTime ? (now - startTime) / 60000 : 0;
  const wpm = elapsedMinutes > 0 ? Math.round(p.correctChars / 5 / elapsedMinutes) : 0;
  const accuracy = p.wordsTyped > 0 ? Math.round((p.wordsCorrect / p.wordsTyped) * 100) : 100;

  return {
    combo: p.combo,
    maxCombo: p.maxCombo,
    wpm,
    accuracy,
    meter: p.meter,
    backlog: p.backlog,
    ko: p.ko,
  };
}

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/**
 * Owns one match's entire state server-side: both players' queues,
 * combo/meter/backlog, attacks in flight, and the countdown → playing →
 * finished lifecycle. Seats are symmetric — whether a seat is a human on
 * a socket or the practice bot is the matchmaker's business, not this
 * class's. Players only ever send the keystrokes they typed for a word;
 * everything else (the text, whether it was corrected, combo, attack
 * math, KO) is derived here.
 *
 * The keystroke log itself is still the client's word, so a script can
 * type perfectly at the speed cap. Catching that needs statistical checks
 * on keystroke timing, which is a later step.
 */
export class DuelSession {
  players: [PlayerState, PlayerState] = [freshPlayer(), freshPlayer()];
  phase: Phase = "countdown";
  result: { winner: Seat | null; reason: "ko" | "forfeit" } | null = null;

  private startTime: number | null = null;
  private countdownEndsAt = 0;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveInterval: ReturnType<typeof setInterval> | null = null;
  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  // Fresh queues for both seats, then a countdown so both players start
  // typing at the same instant. Also used for rematches.
  start(countdownMs = COUNTDOWN_MS) {
    this.stopTimers();
    this.players = [freshPlayer(), freshPlayer()];
    this.phase = "countdown";
    this.result = null;
    this.startTime = null;
    this.countdownEndsAt = Date.now() + countdownMs;
    this.countdownTimer = setTimeout(() => this.beginPlaying(), countdownMs);
    this.onChange();
  }

  destroy() {
    this.stopTimers();
  }

  getCurrentWord(seat: Seat): string {
    const p = this.players[seat];
    return p.words[p.currentWordIndex]?.text ?? "";
  }

  // `keys` is the word's keystroke log (see shared/keystrokes.ts); the
  // space that submits it is implied.
  submitWord(seat: Seat, keys: readonly string[]) {
    if (this.phase !== "playing") return;

    const me = this.players[seat];
    const them = this.players[other(seat)];
    const entry = me.words[me.currentWordIndex];
    const { text, corrected } = replayKeystrokes(keys);
    const humanlyPossible = me.typingBudget.take(keys.length + 1);
    if (!humanlyPossible) me.flaggedWords += 1;

    // Any correction breaks the combo for this word, even if it's
    // eventually typed correctly.
    const isCorrect = humanlyPossible && !corrected && text === entry.text;
    const newCombo = isCorrect ? me.combo + 1 : 0;

    entry.correct = isCorrect;
    me.wordsTyped += 1;
    if (isCorrect) {
      me.wordsCorrect += 1;
      me.correctChars += entry.text.length + 1;
    }
    me.combo = newCombo;
    me.maxCombo = Math.max(me.maxCombo, newCombo);
    me.currentWordIndex += 1;
    me.backlog = Math.max(0, me.backlog - 1);
    ensureBuffer(me);

    if (isCorrect) {
      const meterAfter = me.meter + computeMeterGain(entry.text, newCombo);
      const { burstPower, remainingMeter } = extractBurst(meterAfter);
      me.meter = remainingMeter;
      if (burstPower > 0) {
        const { senderPending, targetPending } = resolveBurstBetween(
          me.pendingIncoming,
          them.pendingIncoming,
          burstPower,
          Date.now()
        );
        me.pendingIncoming = senderPending;
        them.pendingIncoming = targetPending;
      }
    }

    this.onChange();
  }

  // A player leaving mid-match hands the win to whoever's still there.
  // Leaving during the countdown counts too — otherwise dodging a match
  // you're about to lose would be free.
  forfeit(seat: Seat) {
    if (this.phase === "finished") return;
    this.finish(other(seat), "forfeit");
  }

  getSnapshot(seat: Seat): DuelSnapshot {
    const now = Date.now();
    const me = this.players[seat];
    const them = this.players[other(seat)];

    let result: MatchResult | null = null;
    if (this.result) {
      const outcome =
        this.result.winner === null ? "draw" : this.result.winner === seat ? "win" : "loss";
      result = { outcome, reason: this.result.reason };
    }

    const windowStart = Math.max(0, me.currentWordIndex - QUEUE_WINDOW_BEHIND);
    const windowEnd = me.currentWordIndex + QUEUE_WINDOW_AHEAD + 1;

    return {
      phase: this.phase,
      countdownMs: this.phase === "countdown" ? Math.max(0, this.countdownEndsAt - now) : 0,
      you: {
        ...toPublicStats(me, this.startTime, now),
        // Copies, since queue entries are mutated as they're typed.
        words: me.words.slice(windowStart, windowEnd).map((w) => ({ ...w })),
        wordOffset: windowStart,
        currentWordIndex: me.currentWordIndex,
      },
      opponent: toPublicStats(them, this.startTime, now),
      result,
    };
  }

  private beginPlaying() {
    this.countdownTimer = null;
    this.phase = "playing";
    this.startTime = Date.now();
    this.resolveInterval = setInterval(() => this.resolveTick(), RESOLVE_TICK_MS);
    this.onChange();
  }

  private resolveTick() {
    if (this.phase !== "playing") return;
    const now = Date.now();
    let changed = false;

    for (const p of this.players) {
      const resolved = resolveDueAttacks(p.pendingIncoming, now);
      if (resolved.wordsToAdd === 0 && resolved.stillPending.length === p.pendingIncoming.length) {
        continue;
      }
      p.pendingIncoming = resolved.stillPending;
      if (resolved.wordsToAdd > 0) {
        p.backlog += resolved.wordsToAdd;
        insertAttackWords(p, getRandomWords(resolved.wordsToAdd));
        if (isOverCapacity(p.backlog)) p.ko = true;
      }
      changed = true;
    }

    const [a, b] = this.players;
    if (a.ko || b.ko) {
      // Both topping out on the same tick is a draw rather than an
      // arbitrary tiebreak by seat order.
      this.finish(a.ko && b.ko ? null : a.ko ? 1 : 0, "ko");
      return;
    }

    if (changed) this.onChange();
  }

  private finish(winner: Seat | null, reason: "ko" | "forfeit") {
    this.stopTimers();
    this.phase = "finished";
    this.result = { winner, reason };
    this.onChange();
  }

  private stopTimers() {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (this.resolveInterval) clearInterval(this.resolveInterval);
    this.countdownTimer = null;
    this.resolveInterval = null;
  }
}
