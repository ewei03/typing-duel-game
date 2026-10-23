import { getRandomWords } from "./wordBank";
import {
  computeMeterGain,
  extractBurst,
  resolveBurstBetween,
  resolveDueAttacks,
  isOverCapacity,
  type PendingAttack,
} from "./attackEconomy";

const MIN_WORDS_AHEAD = 20;
const FETCH_BATCH_SIZE = 30;
const RESOLVE_TICK_MS = 100;
export const COUNTDOWN_MS = 3000;

export type Seat = 0 | 1;
export type Phase = "countdown" | "playing" | "finished";

export interface QueueWord {
  text: string;
  fromAttack: boolean;
}

interface CompletedWord {
  word: string;
  correct: boolean;
}

interface PlayerState {
  words: QueueWord[];
  currentWordIndex: number;
  combo: number;
  maxCombo: number;
  completedWords: CompletedWord[];
  meter: number;
  backlog: number;
  pendingIncoming: PendingAttack[];
  ko: boolean;
}

// Stats both players get to see about each other.
interface PublicStats {
  combo: number;
  maxCombo: number;
  wpm: number;
  accuracy: number;
  meter: number;
  backlog: number;
  ko: boolean;
}

// Your own seat additionally carries the queue you're typing through.
// The opponent's queue isn't sent: it's never rendered and only grows.
export interface PlayerSnapshot extends PublicStats {
  words: QueueWord[];
  currentWordIndex: number;
  completedWords: CompletedWord[];
}

export type OpponentSnapshot = PublicStats;

export interface MatchResult {
  outcome: "win" | "loss" | "draw";
  reason: "ko" | "forfeit";
}

export interface DuelSnapshot {
  phase: Phase;
  // Remaining countdown at the moment the snapshot was built. A duration
  // rather than a timestamp so client/server clock skew doesn't matter.
  countdownMs: number;
  you: PlayerSnapshot;
  opponent: OpponentSnapshot;
  result: MatchResult | null;
}

function freshPlayer(): PlayerState {
  return {
    words: getRandomWords(FETCH_BATCH_SIZE).map((text) => ({ text, fromAttack: false })),
    currentWordIndex: 0,
    combo: 0,
    maxCombo: 0,
    completedWords: [],
    meter: 0,
    backlog: 0,
    pendingIncoming: [],
    ko: false,
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
  const correctChars = p.completedWords
    .filter((w) => w.correct)
    .reduce((sum, w) => sum + w.word.length + 1, 0);
  const elapsedMinutes = startTime ? (now - startTime) / 60000 : 0;
  const wpm = elapsedMinutes > 0 ? Math.round(correctChars / 5 / elapsedMinutes) : 0;
  const accuracy =
    p.completedWords.length > 0
      ? Math.round((p.completedWords.filter((w) => w.correct).length / p.completedWords.length) * 100)
      : 100;

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
 * class's. Players only ever send what they typed; everything else
 * (correctness, combo, attack math, KO) is decided here.
 *
 * Known gap, intentionally deferred to the "harden and polish" step:
 * this trusts the client's self-reported `hadError` flag (whether a
 * backspace occurred) rather than independently verifying it from raw
 * keystrokes — closing that fully means streaming keystrokes instead of
 * just the finished word, which is more than this skeleton needs yet.
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

  submitWord(seat: Seat, text: string, hadError: boolean) {
    if (this.phase !== "playing") return;

    const me = this.players[seat];
    const them = this.players[other(seat)];
    const currentWord = this.getCurrentWord(seat);
    const isCorrect = text === currentWord && !hadError;
    const newCombo = isCorrect ? me.combo + 1 : 0;

    me.completedWords.push({ word: currentWord, correct: isCorrect });
    me.combo = newCombo;
    me.maxCombo = Math.max(me.maxCombo, newCombo);
    me.currentWordIndex += 1;
    me.backlog = Math.max(0, me.backlog - 1);
    ensureBuffer(me);

    if (isCorrect) {
      const meterAfter = me.meter + computeMeterGain(currentWord, newCombo);
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

    return {
      phase: this.phase,
      countdownMs: this.phase === "countdown" ? Math.max(0, this.countdownEndsAt - now) : 0,
      you: {
        ...toPublicStats(me, this.startTime, now),
        words: me.words,
        currentWordIndex: me.currentWordIndex,
        completedWords: me.completedWords,
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
