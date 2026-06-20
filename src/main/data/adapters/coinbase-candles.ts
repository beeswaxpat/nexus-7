// Coinbase Exchange BTC candles for the bottom chart panel.
//   History: GET /products/BTC-USD/candles?granularity=60 (US-accessible; Binance.com
//            geo-blocks US). Rows arrive as [time, low, high, open, close, volume] in
//            DESCENDING order, so we remap to the Candle shape and sort ascending.
//   Live:    WS wss://ws-feed.exchange.coinbase.com ticker channel. Each ticker drives
//            the in-progress (current minute) candle. Reconnects with exponential backoff.
// Signatures are FROZEN (see the stub that preceded this).

import type { Candle } from '../../../shared/types';
import { httpJson } from '../http';

const REST_BASE = 'https://api.exchange.coinbase.com';
const WS_URL = 'wss://ws-feed.exchange.coinbase.com';
const PRODUCT = 'BTC-USD';

// Coinbase raw candle row order: [time, low, high, open, close, volume].
type RawRow = [number, number, number, number, number, number];

/** Recent BTC candle history at the given granularity (seconds), sorted ascending. */
export async function fetchCandles(granularity = 60): Promise<Candle[]> {
  const url = `${REST_BASE}/products/${PRODUCT}/candles?granularity=${granularity}`;
  const rows = await httpJson<RawRow[]>(url);
  if (!Array.isArray(rows)) throw new Error('Coinbase candles: unexpected response shape');

  const candles: Candle[] = [];
  for (const r of rows) {
    // Remap [time, low, high, open, close, volume] -> {time, open, high, low, close}.
    const [time, low, high, open, close] = r;
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    )
      continue;
    candles.push({ time, open, high, low, close });
  }
  // Coinbase returns newest-first; the chart needs oldest-first.
  candles.sort((a, b) => a.time - b.time);
  return candles;
}

export type CandleTickCallback = (candle: Candle) => void;

// Resolve a WebSocket constructor that works in both the Electron main process and a
// plain-Node self-test. Prefer a global WebSocket if the runtime exposes one (newer
// Node / Electron), otherwise fall back to the `ws` package (a transitive dep here).
type WsCtor = new (url: string) => WsLike;
interface WsLike {
  send(data: string): void;
  close(): void;
  // ws (Node) uses .on(); browser/global WebSocket uses on* handlers. We support both.
  on?(event: string, listener: (...args: unknown[]) => void): void;
  addEventListener?(event: string, listener: (ev: unknown) => void): void;
  onopen?: ((ev: unknown) => void) | null;
  onmessage?: ((ev: unknown) => void) | null;
  onerror?: ((ev: unknown) => void) | null;
  onclose?: ((ev: unknown) => void) | null;
}

async function resolveWsCtor(): Promise<WsCtor> {
  const g = globalThis as { WebSocket?: WsCtor };
  if (typeof g.WebSocket === 'function') return g.WebSocket;
  const mod = (await import('ws')) as unknown as { default: WsCtor };
  return mod.default;
}

/** Pull a string|number field off a parsed message safely. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Open the live BTC ticker. For each ticker message we build the current (in-progress)
 * candle from the parsed price and the CURRENT epoch-seconds time (computed at runtime,
 * bucketed to the granularity), then hand it to `cb` so the chart updates its live bar.
 * Reconnects with exponential backoff. Returns a synchronous disposer.
 */
export function openLiveTicker(cb: CandleTickCallback, granularity = 60): () => void {
  let closed = false;
  let socket: WsLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  // Track the open price of the current minute bucket so the live candle has a body.
  let bucket = -1;
  let open = NaN;
  let high = NaN;
  let low = NaN;

  const onPrice = (price: number): void => {
    if (!Number.isFinite(price)) return;
    const now = Math.floor(Date.now() / 1000); // compute current time at runtime
    const time = Math.floor(now / granularity) * granularity;
    if (time !== bucket) {
      // New minute: start a fresh candle.
      bucket = time;
      open = price;
      high = price;
      low = price;
    } else {
      high = Math.max(high, price);
      low = Math.min(low, price);
    }
    cb({ time, open, high, low, close: price });
  };

  const handleMessage = (raw: unknown): void => {
    let text: string;
    if (typeof raw === 'string') text = raw;
    else if (raw && typeof (raw as { data?: unknown }).data === 'string') text = (raw as { data: string }).data;
    else text = String(raw);
    let msg: { type?: string; price?: unknown };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'ticker') onPrice(num(msg.price));
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    // Exponential backoff capped at 30s, with jitter so two clients don't sync up.
    const base = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    const wait = base + Math.floor(Math.random() * 500);
    attempt++;
    reconnectTimer = setTimeout(connect, wait);
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    let Ctor: WsCtor;
    try {
      Ctor = await resolveWsCtor();
    } catch {
      scheduleReconnect();
      return;
    }
    if (closed) return;

    let ws: WsLike;
    try {
      ws = new Ctor(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;

    const subscribe = (): void => {
      attempt = 0; // healthy connection resets backoff
      try {
        ws.send(JSON.stringify({ type: 'subscribe', product_ids: [PRODUCT], channels: ['ticker'] }));
      } catch {
        /* send may race a close; the close/error path will reconnect */
      }
    };
    const handleClose = (): void => {
      if (socket === ws) socket = null;
      scheduleReconnect();
    };

    // Support both the Node `ws` (.on) and a global WebSocket (on* handlers).
    if (typeof ws.on === 'function') {
      ws.on('open', subscribe);
      ws.on('message', (d: unknown) => handleMessage(d));
      ws.on('error', () => {
        /* 'close' fires after 'error' on ws; let handleClose drive reconnect */
      });
      ws.on('close', handleClose);
    } else {
      ws.onopen = subscribe;
      ws.onmessage = (ev: unknown) => handleMessage(ev);
      ws.onerror = () => {
        /* onclose drives reconnect */
      };
      ws.onclose = handleClose;
    }
  };

  void connect();

  return (): void => {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      socket = null;
    }
  };
}
