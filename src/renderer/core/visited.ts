// Tracks which news headlines the user has opened so the list can restyle them
// (neon violet) like a classic visited link. Persists in localStorage, capped so
// it never grows unbounded. Pure renderer concern; safe under dev:web.

const STORAGE_KEY = 'nexus.visitedNews';
const MAX_ENTRIES = 300;

let cache: Set<string> | null = null;

function load(): Set<string> {
  if (cache) return cache;
  cache = new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        for (const v of arr) if (typeof v === 'string') cache.add(v);
      }
    }
  } catch {
    /* corrupted or unavailable storage: start fresh */
  }
  return cache;
}

function persist(set: Set<string>): void {
  // prune the in-memory cache to match what gets persisted, otherwise the Set
  // grows unbounded within a session (only the localStorage copy was capped).
  if (set.size > MAX_ENTRIES) {
    const drop = set.size - MAX_ENTRIES;
    let i = 0;
    for (const v of set) {
      if (i++ >= drop) break;
      set.delete(v); // insertion order = oldest first
    }
  }
  try {
    const arr = [...set];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* storage full/blocked: visited styling just will not persist */
  }
}

/** True when this headline URL has been opened before. */
export function isVisited(url: string): boolean {
  return url.length > 0 && load().has(url);
}

/** Record a headline URL as opened. */
export function markVisited(url: string): void {
  if (!url) return;
  const set = load();
  if (set.has(url)) return;
  set.add(url);
  persist(set);
}
