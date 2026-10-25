import { DuelSession, type Seat } from "./duelSession";
import { PracticeBot } from "./practiceBot";
import type { LobbyEvent, MatchSnapshot, PresenceStatus } from "../../shared/protocol";

// How long a dropped player's seat is held for them before it counts as
// a forfeit. The match keeps running meanwhile, attacks and all.
export const RECONNECT_GRACE_MS = 15_000;

// The slice of a socket the matchmaker needs. Keeping it this small means
// tests can drive the whole lobby/match lifecycle with plain objects.
// `id` identifies the player, not the socket: a player who reconnects
// shows up as a new Connection with the same id.
export interface Connection {
  id: string;
  emit(event: string, payload: unknown): void;
}

interface HumanOccupant {
  kind: "human";
  conn: Connection;
  status: "connected" | "away" | "left";
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
      status: "connected",
      wantsRematch: false,
    });
    this.seats = [human(a), b === "bot" ? { kind: "bot", bot: null } : human(b)];
    for (const [seat, occupant] of this.seats.entries()) {
      if (occupant.kind === "bot") occupant.bot = new PracticeBot(this.session, seat as Seat);
    }
    this.session.start();
  }

  // Someone dropped but still within their grace period counts as here.
  hasHumans(): boolean {
    return this.seats.some((o) => o.kind === "human" && o.status !== "left");
  }

  isConnectionFor(seat: Seat, conn: Connection): boolean {
    const o = this.seats[seat];
    return o.kind === "human" && o.conn === conn;
  }

  // Bots always want a rematch; a human who isn't connected can't.
  wantsRematch(seat: Seat): boolean {
    const o = this.seats[seat];
    return o.kind === "bot" || (o.status === "connected" && o.wantsRematch);
  }

  presence(seat: Seat): PresenceStatus {
    const o = this.seats[seat];
    if (o.kind === "bot" || o.status === "connected") return "connected";
    return o.status === "away" ? "reconnecting" : "left";
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

  markAway(seat: Seat) {
    const o = this.seats[seat];
    if (o.kind !== "human") return;
    o.status = "away";
    this.broadcast();
  }

  // Also sends the returning player a fresh snapshot to resume from.
  reconnect(seat: Seat, conn: Connection) {
    const o = this.seats[seat];
    if (o.kind !== "human") return;
    o.conn = conn;
    o.status = "connected";
    this.broadcast();
  }

  // Marks the seat as gone *before* forfeiting so the departing player
  // isn't sent the result screen of a match they've already left.
  removeHuman(seat: Seat) {
    const o = this.seats[seat];
    if (o.kind !== "human") return;
    o.status = "left";
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
      if (occupant.kind !== "human" || occupant.status !== "connected") continue;
      const seat = i as Seat;
      const opp: Seat = seat === 0 ? 1 : 0;
      const snapshot: MatchSnapshot = {
        ...this.session.getSnapshot(seat),
        opponentKind: this.seats[opp].kind,
        opponentStatus: this.presence(opp),
        rematch: { you: this.wantsRematch(seat), opponent: this.wantsRematch(opp) },
      };
      occupant.conn.emit("match", snapshot);
    }
  }
}

function lobby(conn: Connection, status: LobbyEvent["status"]) {
  conn.emit("lobby", { status } satisfies LobbyEvent);
}

/**
 * Lobby + quick-match queue. A player is always in exactly one of three
 * places: idle in the lobby, waiting in the queue, or seated in a match.
 * Clients learn which via "lobby" ({ status }) and "match" (a per-seat
 * MatchSnapshot) events.
 */
export class Matchmaker {
  private queue: Connection[] = [];
  private seated = new Map<string, { match: Match; seat: Seat }>();
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // A player's socket (re)connected: put them back wherever they were.
  connect(conn: Connection) {
    this.clearGrace(conn.id);

    const entry = this.seated.get(conn.id);
    if (entry) {
      entry.match.reconnect(entry.seat, conn);
      return;
    }
    const queued = this.queue.findIndex((c) => c.id === conn.id);
    if (queued !== -1) {
      this.queue[queued] = conn;
      lobby(conn, "queued");
      return;
    }
    lobby(conn, "idle");
  }

  // Pairs with whoever has been waiting longest, or starts waiting.
  findMatch(conn: Connection) {
    this.leaveMatch(conn, false);
    if (this.queue.some((c) => c.id === conn.id)) return;

    const opponent = this.queue.shift();
    if (!opponent) {
      this.queue.push(conn);
      lobby(conn, "queued");
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
    if (notify) lobby(conn, "idle");
  }

  submitWord(conn: Connection, keys: readonly string[]) {
    const entry = this.seated.get(conn.id);
    entry?.match.session.submitWord(entry.seat, keys);
  }

  rematch(conn: Connection) {
    const entry = this.seated.get(conn.id);
    entry?.match.requestRematch(entry.seat);
  }

  // Back to the lobby. Leaving a live match forfeits it.
  leaveMatch(conn: Connection, notify = true) {
    this.clearGrace(conn.id);
    const entry = this.seated.get(conn.id);
    if (entry) {
      this.seated.delete(conn.id);
      entry.match.removeHuman(entry.seat);
      if (!entry.match.hasHumans()) entry.match.destroy();
    }
    if (notify) lobby(conn, "idle");
  }

  // Dropping out of the queue is immediate — otherwise someone could be
  // paired while gone — but a seat in a match is held for the grace
  // period. A connection that's already been replaced by a newer one for
  // the same player (a second tab taking over) has nothing to clean up.
  disconnect(conn: Connection) {
    this.queue = this.queue.filter((c) => c !== conn);

    const entry = this.seated.get(conn.id);
    if (!entry || !entry.match.isConnectionFor(entry.seat, conn)) return;
    entry.match.markAway(entry.seat);
    this.graceTimers.set(
      conn.id,
      setTimeout(() => {
        this.graceTimers.delete(conn.id);
        this.leaveMatch(conn, false);
      }, RECONNECT_GRACE_MS)
    );
  }

  // Introspection for tests / logging.
  get queueSize() {
    return this.queue.length;
  }
  get activeMatches() {
    return new Set([...this.seated.values()].map((e) => e.match)).size;
  }

  private clearGrace(playerId: string) {
    const timer = this.graceTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(playerId);
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
