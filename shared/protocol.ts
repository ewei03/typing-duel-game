// Wire types for everything the server and client send each other. The
// server is the source of truth for all of it; the client only renders.

export type Phase = "countdown" | "playing" | "finished";
export type LobbyStatus = "idle" | "queued";
export type PresenceStatus = "connected" | "reconnecting" | "left";

// How much of your own queue each snapshot carries, either side of the
// current word. Matches what the client actually draws.
export const QUEUE_WINDOW_BEHIND = 2;
export const QUEUE_WINDOW_AHEAD = 6;

export interface QueueWord {
  text: string;
  fromAttack: boolean;
  // Set once the word has been submitted.
  correct?: boolean;
}

// Stats both players get to see about each other.
export interface PublicStats {
  combo: number;
  maxCombo: number;
  wpm: number;
  accuracy: number;
  meter: number;
  backlog: number;
  ko: boolean;
}

// Your own seat additionally carries a window of the queue you're typing
// through: `words[0]` sits at absolute index `wordOffset`. The whole queue
// only ever grows, so sending all of it would make every snapshot bigger
// than the last.
export interface PlayerSnapshot extends PublicStats {
  words: QueueWord[];
  wordOffset: number;
  currentWordIndex: number;
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

export interface MatchSnapshot extends DuelSnapshot {
  opponentKind: "human" | "bot";
  opponentStatus: PresenceStatus;
  rematch: { you: boolean; opponent: boolean };
}

export interface LobbyEvent {
  status: LobbyStatus;
}

export interface SubmitWordPayload {
  keys: string[];
}
