import { DuelSession, type DuelSnapshot, type Seat } from "./duelSession";
import { PracticeBot } from "./practiceBot";

// The slice of a socket the matchmaker needs. Keeping it this small means
// tests can drive the whole lobby/match lifecycle with plain objects.
export interface Connection {
  id: string;
  emit(event: string, payload: unknown): void;
}

export type LobbyStatus = "idle" | "queued";

export interface MatchSnapshot extends DuelSnapshot {
  opponentKind: "human" | "bot";
  opponentConnected: boolean;
  rematch: { you: boolean; opponent: boolean };
}

interface HumanOccupant {
  kind: "human";
  conn: Connection;
  connected: boolean;
  wantsRematch: boolean;
}

interface BotOccupant {
  kind: "bot";
  bot: PracticeBot | null;
}

type Occupant = HumanOccupant | BotOccupant;

class Match {
  readonly session: DuelSession;
  readonly seats: [Occupant, Occupant];

  constructor(a: Connection, b: Connection | "bot") {
    this.session = new DuelSession(() => this.broadcast());
    const human = (conn: Connection): HumanOccupant => ({
      kind: "human",
      conn,
      connected: true,
      wantsRematch: false,
    });
    this.seats = [human(a), b === "bot" ? { kind: "bot", bot: null } : human(b)];
    for (const [seat, occupant] of this.seats.entries()) {
      if (occupant.kind === "bot") occupant.bot = new PracticeBot(this.session, seat as Seat);
    }
    this.session.start();
  }

  hasConnectedHumans(): boolean {
    return this.seats.some((o) => o.kind === "human" && o.connected);
  }

  // Bots always want a rematch; a human who has left never will.
  wantsRematch(seat: Seat): boolean {
    const o = this.seats[seat];
    return o.kind === "bot" || (o.connected && o.wantsRematch);
  }

  isPresent(seat: Seat): boolean {
    const o = this.seats[seat];
    return o.kind === "bot" || o.connected;
  }

  requestRematch(seat: Seat) {
    const o = this.seats[seat];
    if (this.session.phase !== "finished" || o.kind !== "human") return;
    o.wantsRematch = true;
    if (this.wantsRematch(0) && this.wantsRematch(1)) {
      for (const occ of this.seats) if (occ.kind === "human") occ.wantsRematch = false;
      this.session.start(); // broadcasts the new countdown
    } else {
      this.broadcast();
    }
  }

  // Marks the seat as gone *before* forfeiting so the departing player
  // isn't sent the result screen of a match they've already left.
  removeHuman(seat: Seat) {
    const o = this.seats[seat];
    if (o.kind !== "human") return;
    o.connected = false;
    o.wantsRematch = false;
    if (this.session.phase === "finished") this.broadcast();
    else this.session.forfeit(seat);
  }

  destroy() {
    this.session.destroy();
    for (const o of this.seats) if (o.kind === "bot") o.bot?.destroy();
  }

  private broadcast() {
    for (const [i, occupant] of this.seats.entries()) {
      if (occupant.kind !== "human" || !occupant.connected) continue;
      const seat = i as Seat;
      const opp: Seat = seat === 0 ? 1 : 0;
      const snapshot: MatchSnapshot = {
        ...this.session.getSnapshot(seat),
        opponentKind: this.seats[opp].kind,
        opponentConnected: this.isPresent(opp),
        rematch: { you: this.wantsRematch(seat), opponent: this.wantsRematch(opp) },
      };
      occupant.conn.emit("match", snapshot);
    }
  }
}

/**
 * Lobby + quick-match queue. A connection is always in exactly one of
 * three places: idle in the lobby, waiting in the queue, or seated in a
 * match. Clients learn which via "lobby" ({ status }) and "match"
 * (a per-seat MatchSnapshot) events.
 */
export class Matchmaker {
  private queue: Connection[] = [];
  private seated = new Map<string, { match: Match; seat: Seat }>();

  // Pairs with whoever has been waiting longest, or starts waiting.
  findMatch(conn: Connection) {
    this.leaveMatch(conn, false);
    if (this.queue.some((c) => c.id === conn.id)) return;

    const opponent = this.queue.shift();
    if (!opponent) {
      this.queue.push(conn);
      conn.emit("lobby", { status: "queued" satisfies LobbyStatus });
      return;
    }
    this.seat(new Match(opponent, conn));
  }

  practice(conn: Connection) {
    this.cancelQueue(conn, false);
    this.leaveMatch(conn, false);
    this.seat(new Match(conn, "bot"));
  }

  cancelQueue(conn: Connection, notify = true) {
    this.queue = this.queue.filter((c) => c.id !== conn.id);
    if (notify) conn.emit("lobby", { status: "idle" satisfies LobbyStatus });
  }

  submitWord(conn: Connection, text: string, hadError: boolean) {
    const entry = this.seated.get(conn.id);
    entry?.match.session.submitWord(entry.seat, text, hadError);
  }

  rematch(conn: Connection) {
    const entry = this.seated.get(conn.id);
    entry?.match.requestRematch(entry.seat);
  }

  // Back to the lobby. Leaving a live match forfeits it.
  leaveMatch(conn: Connection, notify = true) {
    const entry = this.seated.get(conn.id);
    if (entry) {
      this.seated.delete(conn.id);
      entry.match.removeHuman(entry.seat);
      if (!entry.match.hasConnectedHumans()) entry.match.destroy();
    }
    if (notify) conn.emit("lobby", { status: "idle" satisfies LobbyStatus });
  }

  disconnect(conn: Connection) {
    this.cancelQueue(conn, false);
    this.leaveMatch(conn, false);
  }

  // Introspection for tests / logging.
  get queueSize() {
    return this.queue.length;
  }
  get activeMatches() {
    return new Set([...this.seated.values()].map((e) => e.match)).size;
  }

  // The match broadcasts its opening countdown from its constructor,
  // before it's registered here; that's fine since `seated` only routes
  // *incoming* events.
  private seat(match: Match) {
    for (const [seat, occupant] of match.seats.entries()) {
      if (occupant.kind === "human") this.seated.set(occupant.conn.id, { match, seat: seat as Seat });
    }
  }
}
