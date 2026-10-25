// A random id that identifies this player to the server for the life of
// the tab, surviving reloads, so a dropped connection can reclaim its
// seat. Kept in sessionStorage rather than localStorage so two tabs are
// two players, which is how local testing works.
//
// One catch: "duplicate tab" copies sessionStorage, which would make two
// tabs share an id and keep kicking each other off. So before using a
// stored id, ask any other open tabs whether they already hold it.

const STORAGE_KEY = "typeoff.playerId";
const CHANNEL_NAME = "typeoff.playerId";
const PROBE_MS = 150;

function randomId(): string {
  // getRandomValues, not randomUUID: the latter is missing over plain
  // http, which is how LAN play is served.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readStored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(id: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // No storage just means no reconnecting after a reload.
  }
}

type Message = { type: "probe" | "taken"; id: string };

async function claim(): Promise<string> {
  let id = readStored() ?? randomId();

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    let taken = false;
    // Left open for the life of the page so later tabs can ask us too.
    channel.onmessage = (e: MessageEvent<Message>) => {
      if (e.data.id !== id) return;
      if (e.data.type === "probe") channel.postMessage({ type: "taken", id } satisfies Message);
      else taken = true;
    };
    channel.postMessage({ type: "probe", id } satisfies Message);
    await new Promise((resolve) => setTimeout(resolve, PROBE_MS));
    if (taken) id = randomId();
  }

  store(id);
  return id;
}

let claimed: Promise<string> | null = null;

// Memoised so React's StrictMode double-mount doesn't make the page race
// itself for its own id.
export function getPlayerId(): Promise<string> {
  claimed ??= claim();
  return claimed;
}
