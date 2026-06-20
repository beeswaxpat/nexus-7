// Live self-test for the news adapter. The .ts adapter cannot be imported from a
// plain .mjs without a build (and we do not build here), so this mirrors news.ts's
// fetch + parse + merge/dedupe/sort/cap path against the real feeds, asserts the
// normalized NewsItem shape, and prints the first 5 titles + sources. It throws on
// failure so scripts/selftest-all.mjs (which imports it) reports red.

import Parser from 'rss-parser';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NEXUS-7';
const RSS_ACCEPT = 'application/rss+xml,application/xml,text/xml,text/*;q=0.9,*/*;q=0.8';

const FEEDS = [
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' }
];

const MAX_ITEMS = 50;
const parser = new Parser();

function toPublishedAt(item) {
  const raw = item.isoDate ?? item.pubDate;
  if (raw) {
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return ms;
  }
  return Date.now();
}

async function fetchFeed(name, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let xml;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: RSS_ACCEPT },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } finally {
    clearTimeout(timer);
  }
  const feed = await parser.parseString(xml);
  const items = [];
  for (const raw of feed.items ?? []) {
    const u = (raw.link ?? '').trim();
    const title = (raw.title ?? '').trim();
    if (!u || !title) continue;
    items.push({ id: u, title, url: u, source: name, publishedAt: toPublishedAt(raw) });
  }
  return items;
}

async function fetchNews() {
  const results = await Promise.all(
    FEEDS.map(async ({ name, url }) => {
      try {
        return await fetchFeed(name, url);
      } catch (err) {
        console.warn(`[news] feed failed: ${name}:`, err instanceof Error ? err.message : err);
        return [];
      }
    })
  );
  const byLink = new Map();
  for (const item of results.flat()) {
    if (!byLink.has(item.url)) byLink.set(item.url, item);
  }
  return [...byLink.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, MAX_ITEMS);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`[selftest-news] assertion failed: ${msg}`);
}

const news = await fetchNews();

// Shape + invariant assertions on the normalized NewsItem[].
assert(Array.isArray(news), 'fetchNews returned an array');
assert(news.length > 0, 'got at least one headline across all feeds');
assert(news.length <= MAX_ITEMS, `capped at ${MAX_ITEMS} (got ${news.length})`);

const links = new Set();
let prev = Infinity;
for (const n of news) {
  assert(typeof n.id === 'string' && n.id.length > 0, 'id is a non-empty string');
  assert(typeof n.title === 'string' && n.title.length > 0, 'title is a non-empty string');
  assert(typeof n.url === 'string' && /^https?:\/\//.test(n.url), `url is http(s): ${n.url}`);
  assert(n.id === n.url, 'id equals url (link)');
  assert(typeof n.source === 'string' && n.source.length > 0, 'source is a non-empty string');
  assert(Number.isFinite(n.publishedAt) && n.publishedAt > 0, 'publishedAt is a positive epoch ms');
  assert(!links.has(n.url), `no duplicate links: ${n.url}`);
  links.add(n.url);
  assert(n.publishedAt <= prev, 'sorted newest first');
  prev = n.publishedAt;
}

const sources = [...new Set(news.map((n) => n.source))];
console.log(`[selftest-news] ${news.length} items from sources: ${sources.join(', ')}`);
console.log('[selftest-news] first 5 titles + sources:');
for (const n of news.slice(0, 5)) {
  console.log(`  - [${n.source}] ${n.title}`);
}
console.log('[selftest-news] OK');
