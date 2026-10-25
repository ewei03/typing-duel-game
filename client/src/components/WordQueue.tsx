import type { QueueWord } from "../../../shared/protocol";

interface WordQueueProps {
  // The window of the queue the server sent; `words[0]` sits at absolute
  // index `wordOffset`.
  words: QueueWord[];
  wordOffset: number;
  currentWordIndex: number;
  currentInput: string;
  currentWordHasError: boolean;
}

export function WordQueue({
  words,
  wordOffset,
  currentWordIndex,
  currentInput,
  currentWordHasError,
}: WordQueueProps) {
  return (
    <div className="word-line">
      {words.map((entry, i) => {
        // Absolute indices as keys, so a word keeps its element as the
        // window slides past it.
        const absoluteIndex = wordOffset + i;
        // Attack-origin words get a brief fade-in highlight the first
        // time they mount into view, instead of a separate warning
        // banner — they already jump the queue to sit right after the
        // current word, so this is effectively immediate.
        const incomingClass = entry.fromAttack ? "incoming" : "";

        if (absoluteIndex < currentWordIndex) {
          return (
            <span
              key={absoluteIndex}
              className={`word done ${entry.correct ? "correct" : "incorrect"} ${incomingClass}`}
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
