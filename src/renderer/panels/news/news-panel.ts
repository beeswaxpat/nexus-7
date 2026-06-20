// Tabbed right panel: Crypto News | US Economy | Jukebox | TV | Monitor.
// The two news tabs render store.news filtered by item.category (title + source
// + age via core/format.formatAge), clickable -> ctx.bridge.openExternal(url);
// visited headlines recolor neon violet (crypto) / neon gold (econ). TV and
// Monitor both delegate to mountLiveTv (Monitor = public city/surveillance webcams via
// the same YouTube embed). Active tab persists via ctx.updateSettings({ activeRightTab }).
// Signature FROZEN.
//
// Defensive throughout: also runs in a plain browser (dev:web) with mocked data,
// so every store read is null-coalesced and every URL/field is validated.

import type { AppContext } from '../../app-context';
import type { NewsCategory, NewsItem } from '../../../shared/types';
import { el, mount } from '../../core/dom';
import { formatAge } from '../../core/format';
import { isVisited, markVisited } from '../../core/visited';
import { mountLiveTv } from '../live-tv/live-tv';
import { mountJukebox } from '../jukebox/jukebox';
import { DEFAULT_MONITOR_URL } from '../../../shared/constants';
import './news-panel.css';

type RightTab = 'news' | 'econ' | 'live' | 'jukebox' | 'monitor';

interface TabDef {
  id: RightTab;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'news', label: 'Crypto News' },
  { id: 'econ', label: 'US Economy' },
  { id: 'jukebox', label: 'Jukebox' },
  { id: 'live', label: 'TV' },
  { id: 'monitor', label: 'MONITOR' }
];

// Monitor tab: public city / surveillance webcams routed through the same YouTube
// embed (mountLiveTv -> toEmbedUrl). Each src is either a '/embed/<id>' URL for a
// fixed video cam or a bare 'UC...' channel id (toEmbedUrl maps those to
// live_stream?channel=). Labels are uppercase, city middle-dot place (U+00B7), no
// em-dash. Default (CH-01, Times Square) matches DEFAULT_MONITOR_URL. The ISS feed
// is a NASA-style HD Earth-from-space view. Cams re-verified embeddable 2026-06-18.
const MONITOR_PRESETS: ReadonlyArray<{ label: string; src: string }> = [
  { label: 'NEW YORK · USA', src: 'https://www.youtube.com/embed/z-jYdOIKcTQ' },
  { label: 'HONG KONG · CHINA', src: 'UCNcY1o1xGgTX_19w0cXes9g' },
  { label: 'LONDON · UK', src: 'https://www.youtube.com/embed/M3EYAY2MftI' },
  { label: 'ISS · LIVE EARTH', src: 'https://www.youtube.com/embed/fO9e9jnhYK8' },
  { label: 'TOKYO · JAPAN', src: 'https://www.youtube.com/embed/DjdUEyjx8GM' },
  { label: 'DUBLIN · IRELAND', src: 'https://www.youtube.com/embed/u4UZ4UvZXrg' },
  { label: 'JACKSON HOLE · USA', src: 'https://www.youtube.com/embed/1EiC9bvVGnk' },
  { label: 'NAMIB DESERT · NAMIBIA', src: 'https://www.youtube.com/embed/ydYDqZQpim8' },
  { label: 'SAPSUCKER WOODS · USA', src: 'https://www.youtube.com/embed/N609loYkFJo' },
  { label: 'KATMAI BEARS · USA', src: 'UC2Sk0aXLq3ADkH_USGPKT_Q' }
];

export function mountNewsPanel(container: HTMLElement, ctx: AppContext): void {
  if (!container) return;

  // Start from the persisted tab, defaulting to Crypto News if absent/invalid.
  const savedTab = ctx?.settings?.activeRightTab;
  let active: RightTab =
    savedTab === 'econ' ||
    savedTab === 'live' ||
    savedTab === 'jukebox' ||
    savedTab === 'monitor'
      ? savedTab
      : 'news';

  const tabBar = el('div', { class: 'tabs', role: 'tablist' });
  const newsBody = el('div', { class: 'news-panel__body news-panel__news' });
  const econBody = el('div', { class: 'news-panel__body news-panel__news' });
  const liveBody = el('div', { class: 'news-panel__body news-panel__live' });
  const jukeBody = el('div', { class: 'news-panel__body news-panel__juke' });
  const monitorBody = el('div', { class: 'news-panel__body news-panel__live' });
  const root = el(
    'div',
    { class: 'news-panel' },
    tabBar,
    newsBody,
    econBody,
    liveBody,
    jukeBody,
    monitorBody
  );

  // --- tab buttons ---------------------------------------------------------
  const tabButtons = new Map<RightTab, HTMLButtonElement>();
  for (const def of TABS) {
    const btn = el('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      text: def.label,
      'data-tab': def.id
    }) as HTMLButtonElement;
    btn.addEventListener('click', () => void selectTab(def.id));
    tabButtons.set(def.id, btn);
    tabBar.append(btn);
  }

  // Release any prior subscription BEFORE creating the new one, so a re-mount
  // does not leave two 'news' subscriptions live at once.
  (container as HTMLElement & { __newsPanelCleanup?: () => void }).__newsPanelCleanup?.();

  // --- News tabs: subscribe once, render each category into its body -------
  const unsubNews = ctx.store.subscribe('news', (items) => {
    renderNews(newsBody, items, ctx, 'crypto');
    renderNews(econBody, items, ctx, 'econ');
  });

  // Lazy-mount each heavy player (TV / Jukebox / Monitor) the first time its tab is shown.
  let liveMounted = false;
  const ensureLive = (): void => {
    if (liveMounted) return;
    liveMounted = true;
    try {
      mountLiveTv(liveBody, ctx);
    } catch (err) {
      liveMounted = false;
      liveBody.replaceChildren(
        el('div', { class: 'news-panel__empty', text: 'TV failed to load.' })
      );
      console.error('[news-panel] mountLiveTv failed', err);
    }
  };

  let jukeMounted = false;
  const ensureJukebox = (): void => {
    if (jukeMounted) return;
    jukeMounted = true;
    try {
      mountJukebox(jukeBody, ctx);
    } catch (err) {
      jukeMounted = false;
      jukeBody.replaceChildren(
        el('div', { class: 'news-panel__empty', text: 'Jukebox failed to load.' })
      );
      console.error('[news-panel] mountJukebox failed', err);
    }
  };

  let monitorMounted = false;
  const ensureMonitor = (): void => {
    if (monitorMounted) return;
    monitorMounted = true;
    try {
      mountLiveTv(monitorBody, ctx, {
        settingsKey: 'monitorUrl',
        defaultUrl: DEFAULT_MONITOR_URL,
        presets: MONITOR_PRESETS,
        title: 'SURVEILLANCE'
      });
    } catch (err) {
      monitorMounted = false;
      monitorBody.replaceChildren(
        el('div', { class: 'news-panel__empty', text: 'Monitor failed to load.' })
      );
      console.error('[news-panel] mountLiveTv (monitor) failed', err);
    }
  };

  async function selectTab(id: RightTab): Promise<void> {
    if (id === active) {
      applyActive(); // still ensure DOM matches (e.g. first paint)
      return;
    }
    active = id;
    applyActive();
    // Persist; ignore failures so the UI stays responsive (dev:web safe).
    try {
      await ctx.updateSettings({ activeRightTab: id });
    } catch (err) {
      console.warn('[news-panel] could not persist activeRightTab', err);
    }
  }

  function applyActive(): void {
    for (const [id, btn] of tabButtons) {
      const on = id === active;
      btn.classList.toggle('tab--active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (active === 'live') ensureLive();
    if (active === 'jukebox') ensureJukebox();
    if (active === 'monitor') ensureMonitor();
    newsBody.hidden = active !== 'news';
    econBody.hidden = active !== 'econ';
    liveBody.hidden = active !== 'live';
    jukeBody.hidden = active !== 'jukebox';
    monitorBody.hidden = active !== 'monitor';
  }

  applyActive();
  mount(container, root);

  // Stash teardown so a future re-mount can clean up the store subscription.
  (container as HTMLElement & { __newsPanelCleanup?: () => void }).__newsPanelCleanup = () => {
    unsubNews();
  };
}

// --- rendering helpers ------------------------------------------------------

function renderNews(
  body: HTMLElement,
  items: NewsItem[] | null | undefined,
  ctx: AppContext,
  category: NewsCategory
): void {
  // Old caches/mocks may lack item.category; those default to the crypto tab.
  const list = (Array.isArray(items) ? items : []).filter(
    (i) => i && (i.category ?? 'crypto') === category
  );
  if (list.length === 0) {
    body.replaceChildren(
      el('div', { class: 'news-panel__empty', text: 'No headlines yet.' })
    );
    return;
  }

  const now = Date.now();
  const ul = el('ul', { class: 'news-list' });
  for (const item of list) {
    if (!item) continue;
    ul.append(newsRow(item, now, ctx, category));
  }
  body.replaceChildren(ul);
}

function newsRow(item: NewsItem, now: number, ctx: AppContext, category: NewsCategory): HTMLElement {
  const title = (item.title ?? '').trim() || 'Untitled';
  const source = (item.source ?? '').trim();
  const age = formatAge(item.publishedAt, now);
  const url = typeof item.url === 'string' ? item.url.trim() : '';

  const meta: Array<Node | string> = [];
  if (source) meta.push(el('span', { class: 'news-item__source', text: source }));
  if (age) meta.push(el('span', { class: 'news-item__age', text: age }));

  const row = el(
    'li',
    { class: 'news-item' },
    el('button', { class: `news-item__link news-item__link--${category}`, type: 'button', title }, title),
    el('div', { class: 'news-item__meta' }, ...meta)
  );

  const link = row.querySelector<HTMLButtonElement>('.news-item__link');

  const open = (): void => {
    if (!url) return;
    try {
      void ctx.bridge.openExternal(url);
      // restyle immediately (neon violet) and remember across re-renders/restarts
      markVisited(url);
      link?.classList.add('news-item__link--visited');
    } catch (err) {
      console.error('[news-panel] openExternal failed', err);
    }
  };

  if (link) {
    if (!url) link.disabled = true;
    if (url && isVisited(url)) link.classList.add('news-item__link--visited');
    link.addEventListener('click', open);
  }

  return row;
}
