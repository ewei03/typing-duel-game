import type { CompletedWord } from "../game/useTypingGame";

const VISIBLE_BEFORE = 2;
const VISIBLE_AFTER = 6;

interface WordQueueProps {
  words: string[];
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
      {visible.map((word, i) => {
        const absoluteIndex = start + i;

        if (absoluteIndex < currentWordIndex) {
          const done = completedWords[absoluteIndex];
          return (
            <span
              key={absoluteIndex}
              className={`word done ${done?.correct ? "correct" : "incorrect"}`}
            >
              {word}
            </span>
          );
        }

        if (absoluteIndex === currentWordIndex) {
          return (
            <span
              key={absoluteIndex}
              className={`word current ${currentWordHasError ? "has-error" : ""}`}
            >
              {word.split("").map((char, ci) => {
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
              {currentInput.length > word.length && (
                <span className="incorrect-char">{currentInput.slice(word.length)}</span>
              )}
            </span>
          );
        }

        return (
          <span key={absoluteIndex} className="word upcoming">
            {word}
          </span>
        );
      })}
    </div>
  );
}
