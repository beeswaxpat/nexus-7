// Center command-center stats for the
// FEATURED asset (Bitcoin by default, user-swappable via the picker): a clickable
// asset label, price, 24h % change (color + animated reaction emoji), market cap,
// 7d % change, and an SPCX (SpaceX) card underneath. Pre-IPO (before 2026-06-12)
// the card is a countdown placeholder; the moment a Yahoo quote with a finite SPCX
// price arrives on the 'stocks' store it swaps to a live row (price, 24h %,
// NASDAQ · LIVE tag) without changing the card's height. Once live it stays live:
// a vanished or stale quote keeps the last good values.
//
// While Bitcoin is the center asset, the big PRICE is taken from the live BTC
// candle stream (store.candles) when one is available, so it ALWAYS matches the
// candlestick chart's last close (both come from the same Coinbase feed). Other
// center assets use their poll quote. Geometry-stable. Signature FROZEN.

import type { AppContext } from '../../app-context';
import type { AssetQuote, Candle } from '../../../shared/types';
import { el, mount } from '../../core/dom';
import { formatPrice, formatMarketCap, formatPercent, formatHoldingValue } from '../../core/format';
import { emojiFor, emojiGlyph } from '../../core/reactions';
import { centerIsBitcoin, findCenterQuote, findQuoteByKey, secondaryKey, secondaryIsSpcx } from '../../core/center';
import { SPCX_IPO } from '../../../shared/constants';
import { computePortfolio } from '../../core/portfolio';
import { isPrivate, markPrivate, PRIVACY_EVENT } from '../../core/privacy';
import { openCenterPicker } from './center-picker';
import { openSecondaryPicker } from './secondary-picker';
import './spcx-live.css';

/** Fallback label for the combined-portfolio cell when settings has none. */
const BUG_NUT_DEFAULT = 'BUG NUT';

/** Last finite close in the candle series (matches the chart's latest bar). */
function lastCandleClose(candles: Candle[] | null | undefined): number | null {
  if (!Array.isArray(candles)) return null;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (c && Number.isFinite(c.close)) return c.close;
  }
  return null;
}

/** Whole days from now until an ISO timestamp (null if unparseable). A result <= 0 is rendered as IPO DAY by the caller. */
function daysUntil(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

/** Apply +/- color + text to a change cell. */
function setChange(cell: HTMLElement, val: number | null | undefined, prefix = ''): void {
  if (val == null || !Number.isFinite(val)) {
    cell.textContent = prefix ? prefix + '...' : '...';
    cell.classList.remove('up', 'down');
    return;
  }
  cell.textContent = prefix + formatPercent(val);
  cell.classList.toggle('up', val >= 0);
  cell.classList.toggle('down', val < 0);
}

/** Current BUG NUT label: persisted settings first, then the default. */
function bugNutLabelFor(ctx: AppContext): string {
  const saved = ctx?.settings?.bugNutLabel;
  return typeof saved === 'string' && saved.trim().length > 0 ? saved.trim() : BUG_NUT_DEFAULT;
}

/**
 * Make the BUG NUT label renamable in place: click to edit, Enter/blur commits
 * (persists via settings.bugNutLabel), Escape cancels. Empty input falls back to
 * 'BUG NUT', and the value is trimmed + capped at 18 chars. Local copy of the
 * asset-box makeTitleEditable pattern (kept here on purpose: no cross-panel
 * import). Stays editable while private (the name is not a bag value).
 */
function makeBugNutLabelEditable(label: HTMLElement, ctx: AppContext): void {
  label.classList.add('bstat__bn-label--editable');
  label.title = 'Click to rename';
  label.setAttribute('role', 'textbox');
  label.setAttribute('aria-label', 'Portfolio label (click to rename)');
  label.tabIndex = 0;

  let before = label.textContent ?? '';

  const beginEdit = (): void => {
    if (label.isContentEditable) return;
    before = label.textContent ?? '';
    label.contentEditable = 'true';
    label.spellcheck = false;
    label.focus();
    // select the whole label so typing replaces it
    const range = document.createRange();
    range.selectNodeContents(label);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const endEdit = (commit: boolean): void => {
    if (!label.isContentEditable) return;
    label.contentEditable = 'false';
    const raw = (label.textContent ?? '').replace(/\s+/g, ' ').trim();
    const next = commit && raw.length > 0 ? raw.slice(0, 18) : '';
    if (!commit || next === before) {
      label.textContent = before;
      return;
    }
    const value = next || BUG_NUT_DEFAULT;
    label.textContent = value;
    void ctx.updateSettings({ bugNutLabel: value }).catch(() => {
      label.textContent = before; // persist failed: restore the old name
    });
  };

  label.addEventListener('click', beginEdit);
  label.addEventListener('keydown', (e) => {
    if (!label.isContentEditable) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        beginEdit();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      endEdit(true); // blur handler is a no-op once contentEditable flips off
      label.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      endEdit(false);
      label.blur();
    }
  });
  label.addEventListener('blur', () => endEdit(true));
}

export function mountBtcStats(container: HTMLElement, ctx: AppContext): void {
  // clickable label naming the featured asset, e.g. "BITCOIN · BTC"
  const assetLabel = el('button', {
    class: 'bstat__asset',
    type: 'button',
    title: 'Featured asset (click to change)',
    'aria-label': 'Featured asset (click to change)',
    text: 'BITCOIN · BTC'
  });

  const price = el('span', { class: 'bstat__price', text: '$...' });
  const emoji = el('span', { class: 'bstat__emoji', 'aria-hidden': 'true' });
  const change = el('span', { class: 'bstat__change', text: '...' });

  const cap = el('span', { class: 'bstat__cap' },
    el('span', { class: 'bstat__cap-label', text: 'MCAP' }),
    el('span', { class: 'bstat__cap-value', text: '$...' })
  );
  const capValue = cap.querySelector<HTMLElement>('.bstat__cap-value')!;
  const change7d = el('span', { class: 'bstat__change7d', text: '' });

  // SPCX (SpaceX) card. Countdown placeholder until a live Yahoo quote arrives,
  // then the status/date pair swaps for price + 24h % + a NASDAQ · LIVE tag.
  // The sym + name spans are shared by both modes, so the row height (driven by
  // those spans) is identical and the swap never reflows the column.
  const d = daysUntil(SPCX_IPO.ipoDateUtc);
  const status = d == null ? 'PRE-IPO' : d > 0 ? `PRE-IPO · ${d}d` : 'IPO DAY';
  // derive the printed date from the constant so a slipped IPO date stays in sync
  const ipoDate = new Date(SPCX_IPO.ipoDateUtc);
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const ipoDateLabel = `${MONTHS[ipoDate.getUTCMonth()]} ${ipoDate.getUTCDate()} ${ipoDate.getUTCFullYear()}`;
  const spcxPrice = el('span', { class: 'spcx-live__price', text: '$...', 'aria-hidden': 'true' });
  const spcxChange = el('span', { class: 'spcx-live__change', text: '...', 'aria-hidden': 'true' });
  const spcxTag = el('span', { class: 'spcx-live__tag', text: 'NASDAQ · LIVE', 'aria-hidden': 'true' });
  // After-hours (post/pre market) line: a crescent moon glyph then the extended
  // price + its percent change. Empty (no text) when the quote has no after-hours
  // data; it is smaller than the sym span so toggling it never reflows the card.
  const spcxAh = el('span', { class: 'spcx-live__ah', 'aria-hidden': 'true' },
    el('span', { class: 'spcx-live__ah-moon', text: '\u{1F319}' }),
    el('span', { class: 'spcx-live__ah-price' }),
    el('span', { class: 'spcx-live__ah-change' })
  );
  const spcxAhPrice = spcxAh.querySelector<HTMLElement>('.spcx-live__ah-price')!;
  const spcxAhChange = spcxAh.querySelector<HTMLElement>('.spcx-live__ah-change')!;
  // The gold card is the re-pointable SECOND SLOT (defaults to SpaceX): click /
  // Enter / Space opens the second-slot picker. The countdown + sticky-live SPCX
  // machinery below stays intact and runs only while the slot is still SPCX.
  // aria-label fixes the button's accessible name to its PURPOSE (it wins over
  // child text), so screen readers announce 'Second slot, click to change'
  // instead of the live price string churning on every tick; the data spans are
  // aria-hidden so they are not re-read as the label.
  const spcx = el('div', {
    class: 'bstat__spcx bstat__spcx--pick',
    role: 'button',
    tabindex: '0',
    'aria-label': 'Second slot, click to change',
    title: 'Second slot (click to change)'
  },
    el('span', { class: 'bstat__spcx-sym', text: SPCX_IPO.symbol, 'aria-hidden': 'true' }),
    el('span', { class: 'bstat__spcx-name', text: SPCX_IPO.name, 'aria-hidden': 'true' }),
    el('span', { class: 'bstat__spcx-status', text: status, 'aria-hidden': 'true' }),
    el('span', { class: 'bstat__spcx-date', text: ipoDateLabel, 'aria-hidden': 'true' }),
    spcxPrice,
    spcxChange,
    spcxTag,
    spcxAh
  );
  const spcxSym = spcx.querySelector<HTMLElement>('.bstat__spcx-sym')!;
  const spcxName = spcx.querySelector<HTMLElement>('.bstat__spcx-name')!;

  // Paint (or clear) the after-hours line from a quote. Shows the crescent + the
  // extended price + percent change only when afterHoursPrice is finite; otherwise
  // empties the price/change text (the moon glyph hides via CSS :empty siblings)
  // so the line collapses without changing the card height.
  const setAfterHours = (q: AssetQuote | null): void => {
    const ah = q && q.afterHoursPrice != null && Number.isFinite(q.afterHoursPrice)
      ? q.afterHoursPrice
      : null;
    if (ah == null) {
      spcxAhPrice.textContent = '';
      spcxAhChange.textContent = '';
      spcxAhChange.classList.remove('up', 'down');
      spcxAh.classList.remove('spcx-live__ah--on');
      return;
    }
    spcxAhPrice.textContent = formatPrice(ah);
    setChange(spcxAhChange, q?.afterHoursChangePercent ?? null);
    spcxAh.classList.add('spcx-live__ah--on');
  };

  // LEFT cell: the existing featured-asset stats (unchanged look), wrapped so the
  // strip can split into two columns without disturbing this content. The SPCX
  // card is NOT a child here: it is appended to the grid root below so it can span
  // the full center-box width as its own row.
  const main = el('div', { class: 'bstat__main' },
    el('div', { class: 'bstat__asset-row' }, assetLabel),
    el('div', { class: 'bstat__row' }, price, emoji, change),
    el('div', { class: 'bstat__row2' }, cap, change7d)
  );

  // RIGHT cell: the combined-portfolio BUG NUT total. Label is editable in place;
  // value is gold + blurs under privacy; the 24H / 7D chips stay visible.
  const bnLabel = el('span', { class: 'bstat__bn-label', text: bugNutLabelFor(ctx) });
  makeBugNutLabelEditable(bnLabel, ctx);
  const bnValue = el('span', {
    class: 'bstat__bn-value',
    text: '...',
    title: 'Combined value of every holding (both boxes)'
  });
  const bnChange24 = el('span', { class: 'bstat__bn-chip bstat__change', text: '...' });
  const bnChange7d = el('span', { class: 'bstat__bn-chip bstat__change7d', text: '...' });
  const bugnut = el('div', { class: 'bstat__bugnut' },
    bnLabel,
    bnValue,
    el('div', { class: 'bstat__bn-row' }, bnChange24, bnChange7d)
  );

  // The SPCX / second-slot gold card spans both columns as its own full-width row
  // below the price + TOTAL row (grid-column: 1 / -1 in center.css).
  const root = el('div', { class: 'bstat' }, main, bugnut, spcx);

  mount(container, root);

  // Latest known quote lists + latest candle close. Any can update; render()
  // combines them so the price tracks the chart while % / cap track the poll.
  let lastCrypto: AssetQuote[] | null = null;
  let lastStocks: AssetQuote[] | null = null;
  let candleClose: number | null = null;

  // SPCX live state. Sticky: once a finite-priced quote has been seen the card
  // stays in live mode showing the last good values, even if later pushes drop
  // the symbol or mark it stale.
  let spcxIsLive = false;

  const findSpcxQuote = (list: AssetQuote[] | null): AssetQuote | null => {
    if (!Array.isArray(list)) return null;
    for (const q of list) {
      if (
        q &&
        (q.symbol ?? '').toUpperCase() === SPCX_IPO.symbol &&
        q.price != null &&
        Number.isFinite(q.price)
      ) {
        return q;
      }
    }
    return null;
  };

  // dev QA override: ?spcx=live forces the live card regardless of the calendar
  const spcxForced =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('spcx') === 'live';

  // The original SPCX countdown + sticky-live machinery, UNCHANGED except: the
  // sym/name are restored at the top (so returning from another asset resets
  // them), and the --live class toggle is made authoritative (idempotent).
  const renderSpcx = (): void => {
    // restore the SPCX identity in case the slot was just re-pointed back here
    spcxSym.textContent = 'SPCX';
    spcxName.textContent = 'SpaceX';
    // HARD GATE on the IPO timestamp: Yahoo serves a when-issued placeholder
    // quote (finite price, zero volume) BEFORE the listing trades, so a
    // finite-priced quote alone must not flip the card early. Verified live
    // 2026-06-11: /v8/finance/chart/SPCX already returned price 135.0 pre-IPO.
    // Pre-IPO returns early AFTER the restore above so the countdown shows.
    if (!spcxForced && Date.now() < Date.parse(SPCX_IPO.ipoDateUtc)) {
      setAfterHours(null); // no after-hours line in the pre-IPO countdown
      spcx.classList.toggle('bstat__spcx--live', spcxIsLive);
      return;
    }
    const q = findSpcxQuote(lastStocks);
    // No usable quote: keep the current mode (countdown pre-IPO, or the last
    // good live values if we already flipped).
    if (!q) {
      spcx.classList.toggle('bstat__spcx--live', spcxIsLive);
      return;
    }
    // A stale push re-serves the previous good values, so reading them here
    // still satisfies "keep the last good values".
    spcxPrice.textContent = formatPrice(q.price);
    setChange(spcxChange, q.change24h ?? null);
    setAfterHours(q);
    spcxTag.textContent = 'NASDAQ · LIVE';
    if (!spcxIsLive) {
      spcxIsLive = true;
      // keep the editability hint in the live title (matches the generic path)
      spcx.title = 'SpaceX · live NASDAQ quote · click to change';
    }
    // authoritative + idempotent: replaces the old add-only call
    spcx.classList.toggle('bstat__spcx--live', spcxIsLive);
  };

  // Generic second-slot render: any stock/crypto the user re-points the gold
  // card at. Pulls the quote by canonical key from the same crypto/stock lists.
  const renderGenericSecondary = (key: string): void => {
    const id = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    const q = findQuoteByKey(key, lastCrypto, lastStocks);
    if (q && q.price != null && Number.isFinite(q.price)) {
      spcxSym.textContent = (q.symbol || id).toUpperCase();
      spcxName.textContent = q.name || '';
      spcxPrice.textContent = formatPrice(q.price);
      setChange(spcxChange, q.change24h ?? null);
      setAfterHours(q);
      spcxTag.textContent = q.source === 'yahoo' ? 'NASDAQ · LIVE' : 'LIVE';
    } else {
      // no quote yet: connecting placeholder, still in live layout
      spcxSym.textContent = id.toUpperCase();
      spcxName.textContent = '';
      spcxPrice.textContent = '$...';
      spcxChange.textContent = '...';
      spcxChange.classList.remove('up', 'down');
      setAfterHours(null);
      spcxTag.textContent = 'CONNECTING';
    }
    spcx.classList.add('bstat__spcx--live');
    spcx.title = 'Second slot · click to change';
  };

  // Dispatch the gold card: SPCX keeps the original countdown/live machinery; any
  // other asset goes through the generic renderer.
  const renderSecondary = (): void => {
    if (secondaryIsSpcx()) {
      renderSpcx();
    } else {
      renderGenericSecondary(secondaryKey());
    }
  };

  // Recompute + paint the combined-portfolio cell. Total equals STONKS TOTAL +
  // CRYPTO TOTAL; the chips are value-weighted 24H / 7D. The value blurs while
  // private; the chips do not (percentages are not bag-revealing). Below $0 the
  // value reads '...' rather than '$0.00' (the placeholder formatHoldingValue
  // returns at <= 0 anyway, but the chips also fall to '...').
  const renderBugNut = (): void => {
    const p = computePortfolio(ctx);
    bnValue.textContent = p.totalUsd > 0 ? formatHoldingValue(p.totalUsd) : '...';
    setChange(bnChange24, p.totalUsd > 0 ? p.change24h : null, '24H ');
    setChange(bnChange7d, p.totalUsd > 0 ? p.change7d : null, '7D ');
    markPrivate(bnValue, isPrivate(ctx));
  };

  const render = (): void => {
    renderBugNut();
    const center = findCenterQuote(lastCrypto, lastStocks);
    const isBtc = centerIsBitcoin();

    // label: "NAME · SYM"; falls back to the default while loading
    if (center) {
      const name = (center.name || center.symbol || '').toUpperCase();
      const sym = (center.symbol || '').toUpperCase();
      assetLabel.textContent = sym && name && sym !== name ? `${name} · ${sym}` : name || sym;
    } else if (isBtc) {
      assetLabel.textContent = 'BITCOIN · BTC';
    }

    // the candle stream is BTC only; other center assets show their poll price
    const live =
      isBtc && candleClose != null && Number.isFinite(candleClose)
        ? candleClose
        : center && center.price != null && Number.isFinite(center.price)
          ? center.price
          : null;

    price.textContent = live == null ? '$...' : formatPrice(live);

    if (!center || center.price == null || !Number.isFinite(center.price)) {
      capValue.textContent = '$...';
      setChange(change, null);
      change7d.textContent = '';
      emoji.textContent = '';
      delete emoji.dataset.emoji;
      return;
    }

    capValue.textContent = formatMarketCap(center.marketCap);
    setChange(change, center.change24h ?? null);
    setChange(change7d, center.change7d ?? null, '7d ');

    const tok = emojiFor(center.change24h ?? null, true);
    emoji.textContent = emojiGlyph(tok);
    if (tok) emoji.dataset.emoji = tok;
    else delete emoji.dataset.emoji;
  };

  assetLabel.addEventListener('click', () => {
    openCenterPicker(ctx, () => render());
  });

  // The gold card opens the second-slot picker. No editing-state to guard here:
  // a click just opens the picker.
  const openSecondary = (): void => {
    openSecondaryPicker(ctx, () => renderSecondary());
  };
  spcx.addEventListener('click', openSecondary);
  spcx.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openSecondary();
    }
  });

  const onCenterChanged = (): void => render();
  window.addEventListener('nexus:center-changed', onCenterChanged);

  // re-point the gold card when the second slot changes (from the picker)
  const onSecondaryChanged = (): void => renderSecondary();
  window.addEventListener('nexus:secondary-changed', onSecondaryChanged);

  // a row's quantity editor bubbles nexus:holdings-changed to window after
  // persisting; recompute the BUG NUT total at once AND again after 250 ms,
  // because the settings persist is async (mirrors asset-box.ts: the cache
  // refreshes after the event fires).
  const onHoldingsChanged = (): void => {
    renderBugNut();
    setTimeout(renderBugNut, 250);
  };
  window.addEventListener('nexus:holdings-changed', onHoldingsChanged);

  // re-apply the BUG NUT value's blur on any privacy flip from another panel
  const onPrivacyChanged = (): void => renderBugNut();
  window.addEventListener(PRIVACY_EVENT, onPrivacyChanged);

  // first paint of the gold card so it shows before any push arrives
  renderSecondary();

  const unsubs = [
    ctx.store.subscribe('crypto', (list) => {
      lastCrypto = list;
      // a crypto second slot pulls its quote from this list
      renderSecondary();
      render();
    }),
    ctx.store.subscribe('stocks', (list) => {
      lastStocks = list;
      renderSecondary();
      render();
    }),
    ctx.store.subscribe('candles', (candles) => {
      candleClose = lastCandleClose(candles);
      render();
    }),
    () => window.removeEventListener('nexus:center-changed', onCenterChanged),
    () => window.removeEventListener('nexus:secondary-changed', onSecondaryChanged),
    () => window.removeEventListener('nexus:holdings-changed', onHoldingsChanged),
    () => window.removeEventListener(PRIVACY_EVENT, onPrivacyChanged)
  ];

  const h = container as HTMLElement & { __bstatUnsub?: () => void };
  h.__bstatUnsub?.();
  h.__bstatUnsub = () => {
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
  };
}
