// A word's typing history as the client saw it: one entry per character
// typed, or BACKSPACE per character deleted. The server replays this to
// get both the submitted text and whether it was corrected along the way,
// rather than trusting the client to report the latter itself.

export const BACKSPACE = "\b";
export const MAX_KEYSTROKES_PER_WORD = 128;

// The keystrokes that turn `prev` into `next`: delete back to their common
// prefix, then type the rest. Covers plain typing and backspacing as well
// as edits like select-all-and-retype.
export function diffKeystrokes(prev: string, next: string): string[] {
  let common = 0;
  while (common < prev.length && common < next.length && prev[common] === next[common]) {
    common += 1;
  }
  const deletes: string[] = new Array(prev.length - common).fill(BACKSPACE);
  return [...deletes, ...next.slice(common).split("")];
}

export function replayKeystrokes(keys: readonly string[]): { text: string; corrected: boolean } {
  let text = "";
  let corrected = false;
  for (const key of keys) {
    if (key === BACKSPACE) {
      corrected = true;
      text = text.slice(0, -1);
    } else {
      text += key;
    }
  }
  return { text, corrected };
}

// Validates an untrusted keystroke log off the wire. Null means garbage.
export function parseKeystrokes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_KEYSTROKES_PER_WORD) return null;
  return value.every((k) => typeof k === "string" && k.length === 1) ? value : null;
}
