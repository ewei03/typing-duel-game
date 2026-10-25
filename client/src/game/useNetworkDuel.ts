import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { BACKSPACE, diffKeystrokes } from "../../../shared/keystrokes";
import type {
  LobbyEvent,
  LobbyStatus,
  MatchSnapshot,
  SubmitWordPayload,
} from "../../../shared/protocol";
import { getPlayerId } from "./playerToken";

// In dev the server runs separately on :3001; a production build is served
// by the server itself, so it connects back to wherever it was loaded from.
const SERVER_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);

// Thin client: the server is authoritative for matchmaking and for
// everything in a match except the characters currently being typed for
// the active word, which stay local purely for instant per-keystroke
// visual feedback. Each completed word is sent as its keystroke log and
// the resulting truth comes back via "match" — nothing here decides
// correctness, combo, or the attack economy itself.
export function useNetworkDuel() {
  const [connected, setConnected] = useState(false);
  // Set when the server hung up on us because this player opened the game
  // in another tab. socket.io doesn't auto-retry that, which is the point.
  const [superseded, setSuperseded] = useState(false);
  const [lobbyStatus, setLobbyStatus] = useState<LobbyStatus>("idle");
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [countdownLeft, setCountdownLeft] = useState(0);
  const [currentInput, setCurrentInput] = useState("");
  const [currentWordHasError, setCurrentWordHasError] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const keystrokesRef = useRef<string[]>([]);
  const countdownEndsAtRef = useRef(0);

  const resetWord = useCallback(() => {
    keystrokesRef.current = [];
    setCurrentInput("");
    setCurrentWordHasError(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    getPlayerId().then((playerId) => {
      if (cancelled) return;
      const socket = io(SERVER_URL, { transports: ["websocket"], auth: { playerId } });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        setSuperseded(false);
      });
      // Keep showing the match: the server holds our seat for a while and
      // sends us back into it (or to the lobby, if it's gone) on reconnect.
      socket.on("disconnect", (reason) => {
        setConnected(false);
        if (reason === "io server disconnect") setSuperseded(true);
      });
      socket.on("lobby", (data: LobbyEvent) => {
        setLobbyStatus(data.status);
        setMatch(null);
      });
      socket.on("match", (data: MatchSnapshot) => {
        if (data.phase === "countdown") {
          // New match or rematch: drop any half-typed word from last time.
          countdownEndsAtRef.current = performance.now() + data.countdownMs;
          setCountdownLeft(data.countdownMs);
          resetWord();
        }
        setMatch(data);
      });
    });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [resetWord]);

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

  // Dropped rather than queued while offline: socket.io would otherwise
  // buffer the events and replay them, stale, on reconnect.
  const emit = useCallback((event: string, payload?: unknown) => {
    const socket = socketRef.current;
    if (socket?.connected) socket.emit(event, payload);
  }, []);

  const canType = phase === "playing" && connected;

  const submitWord = useCallback(() => {
    if (currentInput.length === 0) return;
    emit("submitWord", { keys: keystrokesRef.current } satisfies SubmitWordPayload);
    resetWord();
  }, [currentInput, emit, resetWord]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!canType) return;
      if (e.key === " ") {
        e.preventDefault();
        submitWord();
      }
    },
    [canType, submitWord]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!canType) return;
      const next = e.target.value;
      const keys = diffKeystrokes(currentInput, next);
      keystrokesRef.current.push(...keys);
      // Any correction breaks the combo for this word, even if it's
      // eventually typed correctly. The server works this out from the
      // keystroke log on its own; this is just so it shows straight away.
      if (keys.includes(BACKSPACE)) setCurrentWordHasError(true);
      setCurrentInput(next);
    },
    [canType, currentInput]
  );

  // After being superseded, reconnecting takes the game back from the
  // other tab.
  const reconnect = useCallback(() => socketRef.current?.connect(), []);

  return {
    connected,
    superseded,
    lobbyStatus,
    match,
    countdownLeft,
    currentInput,
    currentWordHasError,
    canType,
    handleKeyDown,
    handleChange,
    reconnect,
    findMatch: useCallback(() => emit("findMatch"), [emit]),
    cancelQueue: useCallback(() => emit("cancelQueue"), [emit]),
    practice: useCallback(() => emit("practice"), [emit]),
    rematch: useCallback(() => emit("rematch"), [emit]),
    leaveMatch: useCallback(() => emit("leaveMatch"), [emit]),
  };
}
