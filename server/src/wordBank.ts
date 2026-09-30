// Step 1: a flat, hard-coded word list. Later this becomes seeded-RNG
// generation shared with the client via a `packages/shared` module.
export const WORD_BANK: string[] = [
  "the", "of", "and", "to", "in", "is", "you", "that", "it", "he",
  "was", "for", "on", "are", "as", "with", "his", "they", "at", "be",
  "this", "have", "from", "or", "one", "had", "by", "word", "but", "not",
  "what", "all", "were", "we", "when", "your", "can", "said", "there", "use",
  "each", "which", "she", "how", "their", "will", "other", "about", "out", "many",
  "then", "them", "these", "so", "some", "her", "would", "make", "like", "him",
  "into", "time", "has", "look", "two", "more", "write", "see", "number", "way",
  "could", "people", "water", "than", "call", "first", "who", "may", "down", "side",
  "been", "now", "find", "any", "new", "work", "part", "take", "get", "place",
  "made", "live", "where", "after", "back", "little", "only", "round", "man", "year",
];

export function getRandomWords(count: number): string[] {
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    words.push(WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)]);
  }
  return words;
}
