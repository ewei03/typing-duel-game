import type { QueueWord, CompletedWord } from "../game/useNetworkDuel";

const VISIBLE_BEFORE = 2;
const VISIBLE_AFTER = 6;

interface WordQueueProps {
  words: QueueWord[];
  currentWordIndex: number;
  currentInput: string;
  currentWordHasError: boolean;
  completedWords: CompletedWord[];
}

export function WordQueue({
  words,
  currentWordIndex,
  currentInput,
  currentWordHasError,
  completedWords,
}: WordQueueProps) {
  const start = Math.max(0, currentWordIndex - VISIBLE_BEFORE);
  const end = Math.min(words.length, currentWordIndex + VISIBLE_AFTER + 1);
  const visible = words.slice(start, end);

  return (
    <div className="word-line">
      {visible.map((entry, i) => {
        const absoluteIndex = start + i;
        // Attack-origin words get a brief fade-in highlight the first
        // time they mount into view, instead of a separate warning
        // banner — they already jump the queue to sit right after the
        // current word, so this is effectively immediate.
        const incomingClass = entry.fromAttack ? "incoming" : "";

        if (absoluteIndex < currentWordIndex) {
          const done = completedWords[absoluteIndex];
          return (
            <span
              key={absoluteIndex}
              className={`word done ${done?.correct ? "correct" : "incorrect"} ${incomingClass}`}
            >
              {entry.text}
            </span>
          );
        }

        if (absoluteIndex === currentWordIndex) {
          return (
            <span
              key={absoluteIndex}
              className={`word current ${currentWordHasError ? "has-error" : ""} ${incomingClass}`}
            >
              {entry.text.split("").map((char, ci) => {
                const typedChar = currentInput[ci];
                let charClass = "untyped";
                if (typedChar !== undefined) {
                  charClass = typedChar === char ? "correct-char" : "incorrect-char";
                }
                return (
                  <span key={ci} className={charClass}>
                    {char}
                  </span>
                );
              })}
              {currentInput.length > entry.text.length && (
                <span className="incorrect-char">{currentInput.slice(entry.text.length)}</span>
              )}
            </span>
          );
        }

        return (
          <span key={absoluteIndex} className={`word upcoming ${incomingClass}`}>
            {entry.text}
          </span>
        );
      })}
    </div>
  );
}
