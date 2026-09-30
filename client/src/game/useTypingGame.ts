import { useCallback, useEffect, useRef, useState } from "react";

// How many un-typed words to keep buffered ahead of the player,
// and how many to fetch each time we top up.
const MIN_WORDS_AHEAD = 20;
const FETCH_BATCH_SIZE = 30;

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

// Used only if the server can't be reached, so the game is still playable.
const FALLBACK_WORDS = [
  "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog",
  "hello", "world", "type", "fast", "clean", "code", "react", "node",
  "server", "client", "queue", "combo",
];

function randomFallbackWords(count: number): string[] {
  return Array.from(
    { length: count },
    () => FALLBACK_WORDS[Math.floor(Math.random() * FALLBACK_WORDS.length)]
  );
}

async function fetchWords(count: number): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/words?count=${count}`);
  if (!res.ok) throw new Error("Failed to fetch words");
  const data = (await res.json()) as { words: string[] };
  return data.words;
}

export interface CompletedWord {
  word: string;
  correct: boolean;
}

export interface WordSubmittedResult {
  word: string;
  correct: boolean;
  combo: number;
}

export interface UseTypingGameOptions {
  onWordSubmitted?: (result: WordSubmittedResult) => void;
}

export function useTypingGame(options?: UseTypingGameOptions) {
  const [words, setWords] = useState<string[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentInput, setCurrentInput] = useState("");
  const [currentWordHasError, setCurrentWordHasError] = useState(false);
  const [completedWords, setCompletedWords] = useState<CompletedWord[]>([]);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchingMore = useRef(false);
  const comboRef = useRef(0);
  const onWordSubmittedRef = useRef(options?.onWordSubmitted);
  useEffect(() => {
    onWordSubmittedRef.current = options?.onWordSubmitted;
  });

  const loadWords = useCallback(async (count: number, replace: boolean) => {
    try {
      const newWords = await fetchWords(count);
      setWords((prev) => (replace ? newWords : [...prev, ...newWords]));
      setError(null);
    } catch {
      const fallback = randomFallbackWords(count);
      setWords((prev) => (replace ? fallback : [...prev, ...fallback]));
      setError("Couldn't reach the word server — using a local word list instead.");
    } finally {
      setIsLoading(false);
      fetchingMore.current = false;
    }
  }, []);

  // Initial load.
  useEffect(() => {
    loadWords(FETCH_BATCH_SIZE, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the queue topped up as the player advances through it.
  useEffect(() => {
    const remaining = words.length - currentWordIndex;
    if (remaining < MIN_WORDS_AHEAD && !fetchingMore.current && !isLoading) {
      fetchingMore.current = true;
      loadWords(FETCH_BATCH_SIZE, false);
    }
  }, [words.length, currentWordIndex, isLoading, loadWords]);

  // Live-ticking timer once the player starts typing.
  useEffect(() => {
    if (startTime === null) return;
    const interval = setInterval(() => {
      setElapsedSeconds((Date.now() - startTime) / 1000);
    }, 200);
    return () => clearInterval(interval);
  }, [startTime]);

  const currentWord = words[currentWordIndex] ?? "";

  const submitWord = useCallback(() => {
    if (currentInput.length === 0) return;
    const isCorrect = currentInput === currentWord && !currentWordHasError;
    const newCombo = isCorrect ? comboRef.current + 1 : 0;
    comboRef.current = newCombo;

    setCompletedWords((prev) => [...prev, { word: currentWord, correct: isCorrect }]);
    setCombo(newCombo);
    setMaxCombo((max) => Math.max(max, newCombo));
    setCurrentWordIndex((i) => i + 1);
    setCurrentInput("");
    setCurrentWordHasError(false);

    onWordSubmittedRef.current?.({ word: currentWord, correct: isCorrect, combo: newCombo });
  }, [currentInput, currentWord, currentWordHasError]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (startTime === null && e.key.length === 1) {
        setStartTime(Date.now());
      }
      if (e.key === " ") {
        e.preventDefault();
        submitWord();
        return;
      }
      if (e.key === "Backspace" && currentInput.length > 0) {
        // Any correction breaks the combo for this word, even if it's
        // eventually typed correctly — clean, uncorrected words are
        // what should build a streak.
        setCurrentWordHasError(true);
      }
    },
    [currentInput.length, startTime, submitWord]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentInput(e.target.value);
  }, []);

  const reset = useCallback(() => {
    comboRef.current = 0;
    setCurrentWordIndex(0);
    setCurrentInput("");
    setCurrentWordHasError(false);
    setCompletedWords([]);
    setCombo(0);
    setMaxCombo(0);
    setStartTime(null);
    setElapsedSeconds(0);
    setIsLoading(true);
    loadWords(FETCH_BATCH_SIZE, true);
  }, [loadWords]);

  // Appends more words to the queue — used to inject an incoming attack's
  // words on top of the normal auto-refill.
  const addWords = useCallback(
    (count: number) => {
      loadWords(count, false);
    },
    [loadWords]
  );

  // Standard "5 characters = 1 word" WPM, counting only cleanly-typed words.
  const correctChars = completedWords
    .filter((w) => w.correct)
    .reduce((sum, w) => sum + w.word.length + 1, 0);
  const elapsedMinutes = elapsedSeconds / 60;
  const wpm = elapsedMinutes > 0 ? Math.round(correctChars / 5 / elapsedMinutes) : 0;

  const accuracy =
    completedWords.length > 0
      ? Math.round(
          (completedWords.filter((w) => w.correct).length / completedWords.length) * 100
        )
      : 100;

  return {
    words,
    currentWordIndex,
    currentInput,
    currentWordHasError,
    completedWords,
    combo,
    maxCombo,
    wpm,
    accuracy,
    isLoading,
    error,
    handleKeyDown,
    handleChange,
    reset,
    addWords,
  };
}
