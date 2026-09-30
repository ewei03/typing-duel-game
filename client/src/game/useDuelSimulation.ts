import { useCallback, useEffect, useReducer, useRef } from "react";
import { useTypingGame } from "./useTypingGame";
import {
  computeMeterGain,
  extractBurst,
  resolveBurstBetween,
  resolveDueAttacks,
  isOverCapacity,
  type PendingAttack,
} from "./attackEconomy";

// A scripted, fixed-cadence opponent — just enough pressure to playtest
// the attack economy solo. A real networked opponent replaces this in
// step 4; nothing else here should need to change when it does, since
// both sides already go through the same reducer actions.
const BOT_TICK_MS = 500;
const BOT_WORDS = ["quick", "fox", "types", "fast", "clean", "words"];
const RESOLUTION_TICK_MS = 100;

interface DuelSide {
  meter: number;
  backlog: number;
  pendingIncoming: PendingAttack[];
  ko: boolean;
}

interface DuelState {
  you: DuelSide;
  bot: DuelSide;
  botCombo: number;
  isRunning: boolean;
}

const freshSide = (): DuelSide => ({ meter: 0, backlog: 0, pendingIncoming: [], ko: false });
const freshState = (): DuelState => ({
  you: freshSide(),
  bot: freshSide(),
  botCombo: 0,
  isRunning: true,
});

type DuelAction =
  | { type: "YOU_WORD_SUBMITTED"; word: string; correct: boolean; combo: number }
  | { type: "BOT_TICK" }
  | { type: "RESOLVE_TICK"; now: number }
  | { type: "RESET" };

function duelReducer(state: DuelState, action: DuelAction): DuelState {
  if (!state.isRunning && action.type !== "RESET") return state;

  switch (action.type) {
    case "YOU_WORD_SUBMITTED": {
      const backlog = Math.max(0, state.you.backlog - 1);
      if (!action.correct) {
        return { ...state, you: { ...state.you, backlog } };
      }
      const meterAfter = state.you.meter + computeMeterGain(action.word, action.combo);
      const { burstPower, remainingMeter } = extractBurst(meterAfter);
      if (burstPower === 0) {
        return { ...state, you: { ...state.you, backlog, meter: remainingMeter } };
      }
      const { senderPending, targetPending } = resolveBurstBetween(
        state.you.pendingIncoming,
        state.bot.pendingIncoming,
        burstPower,
        Date.now()
      );
      return {
        ...state,
        you: { ...state.you, backlog, meter: remainingMeter, pendingIncoming: senderPending },
        bot: { ...state.bot, pendingIncoming: targetPending },
      };
    }

    case "BOT_TICK": {
      const newCombo = state.botCombo + 1;
      const word = BOT_WORDS[Math.floor(Math.random() * BOT_WORDS.length)];
      const backlog = Math.max(0, state.bot.backlog - 1);
      const meterAfter = state.bot.meter + computeMeterGain(word, newCombo);
      const { burstPower, remainingMeter } = extractBurst(meterAfter);
      if (burstPower === 0) {
        return { ...state, botCombo: newCombo, bot: { ...state.bot, backlog, meter: remainingMeter } };
      }
      const { senderPending, targetPending } = resolveBurstBetween(
        state.bot.pendingIncoming,
        state.you.pendingIncoming,
        burstPower,
        Date.now()
      );
      return {
        ...state,
        botCombo: newCombo,
        bot: { ...state.bot, backlog, meter: remainingMeter, pendingIncoming: senderPending },
        you: { ...state.you, pendingIncoming: targetPending },
      };
    }

    case "RESOLVE_TICK": {
      const youResolved = resolveDueAttacks(state.you.pendingIncoming, action.now);
      const botResolved = resolveDueAttacks(state.bot.pendingIncoming, action.now);
      const nothingChanged =
        youResolved.wordsToAdd === 0 &&
        botResolved.wordsToAdd === 0 &&
        youResolved.stillPending.length === state.you.pendingIncoming.length &&
        botResolved.stillPending.length === state.bot.pendingIncoming.length;
      if (nothingChanged) return state;

      const youBacklog = state.you.backlog + youResolved.wordsToAdd;
      const botBacklog = state.bot.backlog + botResolved.wordsToAdd;
      const youKO = isOverCapacity(youBacklog);
      const botKO = isOverCapacity(botBacklog);

      return {
        ...state,
        isRunning: !youKO && !botKO,
        you: { ...state.you, pendingIncoming: youResolved.stillPending, backlog: youBacklog, ko: youKO },
        bot: { ...state.bot, pendingIncoming: botResolved.stillPending, backlog: botBacklog, ko: botKO },
      };
    }

    case "RESET":
      return freshState();

    default:
      return state;
  }
}

export function useDuelSimulation() {
  const [state, dispatch] = useReducer(duelReducer, undefined, freshState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const you = useTypingGame({
    onWordSubmitted: ({ word, correct, combo }) => {
      dispatch({ type: "YOU_WORD_SUBMITTED", word, correct, combo });
    },
  });

  useEffect(() => {
    if (!state.isRunning) return;
    const interval = setInterval(() => dispatch({ type: "BOT_TICK" }), BOT_TICK_MS);
    return () => clearInterval(interval);
  }, [state.isRunning]);

  // Resolves attacks whose telegraph window has elapsed, and pushes the
  // resulting words into the player's visible queue.
  useEffect(() => {
    if (!state.isRunning) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const { wordsToAdd } = resolveDueAttacks(stateRef.current.you.pendingIncoming, now);
      if (wordsToAdd > 0) you.addWords(wordsToAdd);
      dispatch({ type: "RESOLVE_TICK", now });
    }, RESOLUTION_TICK_MS);
    return () => clearInterval(interval);
  }, [state.isRunning, you.addWords]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    you.reset();
  }, [you.reset]);

  return {
    you,
    youSide: state.you,
    botSide: state.bot,
    botCombo: state.botCombo,
    isRunning: state.isRunning,
    winner: state.you.ko ? ("bot" as const) : state.bot.ko ? ("you" as const) : null,
    reset,
  };
}
