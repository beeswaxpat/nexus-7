// Wires every push channel from the bridge into the store. Panels never touch the
// bridge for live data; they subscribe to store keys. On startup we also pull the
// full snapshot so the first paint is instant, then live pushes take over.

import type { Bridge } from './bridge';
import { store } from './state/store';
import type { SourceStatus } from '../shared/types';

/** Subscribe all feeds and seed from a snapshot. Returns a teardown function. */
export async function startFeeds(bridge: Bridge): Promise<() => void> {
  // instant first paint from cache
  try {
    const snap = await bridge.getSnapshot();
    store.set('crypto', snap.crypto);
    store.set('stocks', snap.stocks);
    store.set('fng', snap.fng);
    store.set('news', snap.news);
    store.set('ticker', snap.ticker);
    store.set('candles', snap.candles);
    store.set('statuses', snap.statuses);
    store.set('sats', snap.sats);
  } catch (err) {
    console.error('[feeds] snapshot failed:', err);
  }

  const unsubs: Array<() => void> = [];

  unsubs.push(bridge.onCrypto((q) => store.set('crypto', q)));
  unsubs.push(bridge.onStocks((q) => store.set('stocks', q)));
  unsubs.push(bridge.onFng((f) => store.set('fng', f)));
  unsubs.push(bridge.onNews((n) => store.set('news', n)));
  unsubs.push(bridge.onTicker((t) => store.set('ticker', t)));
  unsubs.push(bridge.onCandlesInit((c) => store.set('candles', c)));
  unsubs.push(bridge.onSats((s) => store.set('sats', s)));

  unsubs.push(
    bridge.onCandleUpdate((c) => {
      const arr = store.get('candles').slice();
      const idx = arr.findIndex((x) => x.time === c.time);
      if (idx >= 0) {
        arr[idx] = c;
      } else if (arr.length === 0 || c.time > arr[arr.length - 1].time) {
        // live candles arrive monotonically, so the common case is an in-order
        // append; only re-sort on a genuine out-of-order insert.
        arr.push(c);
      } else {
        arr.push(c);
        arr.sort((a, b) => a.time - b.time);
      }
      store.set('candles', arr);
    })
  );

  unsubs.push(
    bridge.onStatus((s: SourceStatus) => {
      const list = store.get('statuses').filter((x) => x.source !== s.source);
      list.push(s);
      store.set('statuses', list);
    })
  );

  return () => {
    for (const u of unsubs) u();
  };
}
