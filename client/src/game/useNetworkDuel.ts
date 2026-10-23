import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const SERVER_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export interface QueueWord {
  text: string;
  fromAttack: boolean;
}

export interface CompletedWord {
  word: string;
  correct: boolean;
}

export interface OpponentSnapshot {
  combo: number;
  maxCombo: number;
  wpm: number;
  accuracy: number;
  meter: number;
  backlog: number;
  ko: boolean;
}

export interface PlayerSnapshot extends OpponentSnapshot {
  words: QueueWord[];
  currentWordIndex: number;
  completedWords: CompletedWord[];
}

export type Phase = "countdown" | "playing" | "finished";

export interface MatchSnapshot {
  phase: Phase;
  countdownMs: number;
  you: PlayerSnapshot;
  opponent: OpponentSnapshot;
  result: { outcome: "win" | "loss" | "draw"; reason: "ko" | "forfeit" } | null;
  opponentKind: "human" | "bot";
  opponentConnected: boolean;
  rematch: { you: boolean; opponent: boolean };
}

export type LobbyStatus = "idle" | "queued";

// Thin client: the server is authoritative for matchmaking and for
// everything in a match except the characters currently being typed for
// the active word, which stay local purely for instant per-keystroke
// visual feedback. Every completed word is sent to the server and the
// resulting truth comes back via "match" — nothing here computes
// correctness, combo, or the attack economy itself.
export function useNetworkDuel() {
  const [connected, setConnected] = useState(false);
  const [lobbyStatus, setLobbyStatus] = useState<LobbyStatus>("idle");
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [countdownLeft, setCountdownLeft] = useState(0);
  const [currentInput, setCurrentInput] = useState("");
  const [currentWordHasError, setCurrentWordHasError] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const countdownEndsAtRef = useRef(0);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => {
      // The server forfeits us on disconnect, so any match we were in is
      // gone; a reconnect lands back in the lobby.
      setConnected(false);
      setMatch(null);
      setLobbyStatus("idle");
    });
    socket.on("lobby", (data: { status: LobbyStatus }) => {
      setLobbyStatus(data.status);
      setMatch(null);
    });
    socket.on("match", (data: MatchSnapshot) => {
      if (data.phase === "countdown") {
        // New match or rematch: drop any half-typed word from last time.
        countdownEndsAtRef.current = performance.now() + data.countdownMs;
        setCountdownLeft(data.countdownMs);
        setCurrentInput("");
        setCurrentWordHasError(false);
      }
      setMatch(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // The server only says how long the countdown is when it starts; tick
  // it down locally rather than having the server spam snapshots.
  const phase = match?.phase;
  useEffect(() => {
    if (phase !== "countdown") return;
    const id = setInterval(() => {
      setCountdownLeft(Math.max(0, countdownEndsAtRef.current - performance.now()));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  const emit = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  const submitWord = useCallback(() => {
    if (currentInput.length === 0) return;
    emit("submitWord", { text: currentInput, hadError: currentWordHasError });
    setCurrentInput("");
    setCurrentWordHasError(false);
  }, [currentInput, currentWordHasError, emit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (phase !== "playing") return;
      if (e.key === " ") {
        e.preventDefault();
        submitWord();
        return;
      }
      if (e.key === "Backspace" && currentInput.length > 0) {
        // Any correction breaks the combo for this word, even if it's
        // eventually typed correctly — mirrors the step 1/2 rule. The
        // server trusts this flag rather than re-deriving it from raw
        // keystrokes; see the note in duelSession.ts.
        setCurrentWordHasError(true);
      }
    },
    [phase, currentInput.length, submitWord]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (phase !== "playing") return;
      setCurrentInput(e.target.value);
    },
    [phase]
  );

  return {
    connected,
    lobbyStatus,
    match,
    countdownLeft,
    currentInput,
    currentWordHasError,
    handleKeyDown,
    handleChange,
    findMatch: useCallback(() => emit("findMatch"), [emit]),
    cancelQueue: useCallback(() => emit("cancelQueue"), [emit]),
    practice: useCallback(() => emit("practice"), [emit]),
    rematch: useCallback(() => emit("rematch"), [emit]),
    leaveMatch: useCallback(() => emit("leaveMatch"), [emit]),
  };
}
