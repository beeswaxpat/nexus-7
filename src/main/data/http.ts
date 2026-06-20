// Tiny fetch helper used by every adapter. Uses the global fetch available in
// modern Electron/Node. 10s timeout, one retry with backoff, desktop UA so APIs
// that sniff headless clients still answer.

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NEXUS-7';

const TIMEOUT_MS = 10_000;

export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function once(url: string, opts: HttpOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json,text/*;q=0.9,*/*;q=0.8', ...opts.headers },
      signal: controller.signal
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch with timeout + one backoff retry. Throws on non-2xx or network error. */
export async function httpGet(url: string, opts: HttpOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await once(url, opts);
    } catch (err) {
      // Network / abort (incl. timeout): transient, fall through to backoff retry.
      lastErr = err;
      if (attempt < retries) await delay(500 * Math.pow(2, attempt));
      continue;
    }
    if (res.ok) return res;
    // Deterministic 4xx (bad request / auth / not found) will not change on a retry,
    // so fail immediately; only 429 and 5xx are transient and worth retrying.
    if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
    lastErr = new Error(`HTTP ${res.status} for ${url}`);
    if (attempt < retries) await delay(500 * Math.pow(2, attempt));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Convenience: GET + parse JSON. */
export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await httpGet(url, opts);
  return (await res.json()) as T;
}

/** Convenience: GET + return text (RSS, etc.). */
export async function httpText(url: string, opts: HttpOptions = {}): Promise<string> {
  const res = await httpGet(url, opts);
  return await res.text();
}
