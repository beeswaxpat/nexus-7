// News adapter. Headlines from the RSS feeds in shared/constants.NEWS_FEEDS,
// split into two categories: 'crypto' (Cointelegraph, Decrypt, CoinDesk) and
// 'econ' (CNBC, MarketWatch, Yahoo Finance). Parsed with rss-parser; we fetch
// the XML ourselves via httpText (shared 10s-timeout + 1-retry + desktop-UA
// helper; some feeds 403 the default rss-parser client) and hand the string to
// parser.parseString. Per-feed try/catch (one dead feed never sinks the rest),
// then merge + dedupe by link + sort newest first + cap PER CATEGORY so a busy
// finance day can never push crypto out of its own tab (or vice versa).
// Signature is FROZEN (see types.ts).

import Parser from 'rss-parser';
import type { NewsCategory, NewsItem } from '../../../shared/types';
import { NEWS_FEEDS, NEWS_MAX } from '../../../shared/constants';
import { httpText } from '../http';

const MAX_ITEMS = NEWS_MAX; // per category

// RSS is XML, not JSON; ask for it explicitly (httpGet defaults to a JSON Accept).
const RSS_ACCEPT = 'application/rss+xml,application/xml,text/xml,text/*;q=0.9,*/*;q=0.8';

const parser = new Parser();

/** Best available publish time as epoch ms; isoDate, then pubDate, then now. */
function toPublishedAt(item: Parser.Item): number {
  const raw = item.isoDate ?? item.pubDate;
  if (raw) {
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return ms;
  }
  return Date.now();
}

/** Map one parsed RSS item to a NewsItem; null if it has no usable link. */
function toNewsItem(item: Parser.Item, source: string, category: NewsCategory): NewsItem | null {
  const url = (item.link ?? '').trim();
  const title = (item.title ?? '').trim();
  if (!url || !title) return null;
  return {
    id: url, // link is the stable identifier (CoinDesk guid is a UUID, not the URL)
    title,
    url,
    source,
    publishedAt: toPublishedAt(item),
    category
  };
}

/** Fetch + parse a single feed. Throws so the caller's try/catch can isolate it. */
async function fetchFeed(name: string, url: string, category: NewsCategory): Promise<NewsItem[]> {
  const xml = await httpText(url, { headers: { Accept: RSS_ACCEPT } });
  const feed = await parser.parseString(xml);
  const items: NewsItem[] = [];
  for (const raw of feed.items ?? []) {
    const item = toNewsItem(raw, name, category);
    if (item) items.push(item);
  }
  return items;
}

/** Merged, deduped, newest-first headlines, capped per category. */
export async function fetchNews(): Promise<NewsItem[]> {
  const results = await Promise.all(
    NEWS_FEEDS.map(async ({ source, url, category }) => {
      try {
        return await fetchFeed(source, url, category);
      } catch (err) {
        // One bad feed must not sink the others. Log and move on.
        console.warn(`[news] feed failed: ${source} (${url}):`, err instanceof Error ? err.message : err);
        return [] as NewsItem[];
      }
    })
  );

  const byLink = new Map<string, NewsItem>();
  for (const item of results.flat()) {
    // First write wins; feeds are listed in priority order.
    if (!byLink.has(item.url)) byLink.set(item.url, item);
  }

  const newest = (a: NewsItem, b: NewsItem): number => b.publishedAt - a.publishedAt;
  const all = [...byLink.values()].sort(newest);
  const crypto = all.filter((i) => i.category !== 'econ').slice(0, MAX_ITEMS);
  const econ = all.filter((i) => i.category === 'econ').slice(0, MAX_ITEMS);
  return [...crypto, ...econ].sort(newest);
}
