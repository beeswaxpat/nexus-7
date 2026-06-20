import { describe, it, expect } from 'vitest';
import { toEmbedUrl, toWatchUrl } from '../src/renderer/panels/live-tv/live-tv';

const CH = 'UCvJJ_dzjViJCoLf5uKUTwoA'; // a valid-shaped bare channel id (UC + 22 chars)

// Parse a returned URL and return its query params as a flat object.
function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

describe('toEmbedUrl', () => {
  it('bare UC channel id -> live_stream?channel=...', () => {
    const out = toEmbedUrl(CH);
    expect(out).not.toBeNull();
    const u = new URL(out!);
    expect(u.hostname).toBe('www.youtube.com');
    expect(u.pathname).toBe('/embed/live_stream');
    expect(u.searchParams.get('channel')).toBe(CH);
  });

  it('watch?v=<id> -> /embed/<id>', () => {
    const out = toEmbedUrl('https://www.youtube.com/watch?v=abc123XYZ_-');
    expect(out).not.toBeNull();
    const u = new URL(out!);
    expect(u.hostname).toBe('www.youtube.com');
    expect(u.pathname).toBe('/embed/abc123XYZ_-');
  });

  it('youtu.be short url -> /embed/<id>', () => {
    const out = toEmbedUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(out).not.toBeNull();
    const u = new URL(out!);
    expect(u.hostname).toBe('www.youtube.com');
    expect(u.pathname).toBe('/embed/dQw4w9WgXcQ');
  });

  it('an existing /embed/<id> url is kept (path preserved)', () => {
    const out = toEmbedUrl('https://www.youtube.com/embed/KQp-e_XQnDE');
    expect(out).not.toBeNull();
    expect(new URL(out!).pathname).toBe('/embed/KQp-e_XQnDE');
  });

  it('an /embed/live_stream?channel=... url is kept', () => {
    const out = toEmbedUrl(`https://www.youtube.com/embed/live_stream?channel=${CH}`);
    expect(out).not.toBeNull();
    const u = new URL(out!);
    expect(u.pathname).toBe('/embed/live_stream');
    expect(u.searchParams.get('channel')).toBe(CH);
  });

  it('youtube-nocookie.com is normalized to www.youtube.com', () => {
    const out = toEmbedUrl('https://www.youtube-nocookie.com/embed/KQp-e_XQnDE');
    expect(out).not.toBeNull();
    expect(new URL(out!).hostname).toBe('www.youtube.com');
  });

  it('m.youtube.com watch url normalizes host + path', () => {
    const out = toEmbedUrl('https://m.youtube.com/watch?v=abc123XYZ_-');
    expect(out).not.toBeNull();
    const u = new URL(out!);
    expect(u.hostname).toBe('www.youtube.com');
    expect(u.pathname).toBe('/embed/abc123XYZ_-');
  });

  it('/live/<id> permalink form -> /embed/<id>', () => {
    const out = toEmbedUrl('https://www.youtube.com/live/abc123XYZ_-');
    expect(out).not.toBeNull();
    expect(new URL(out!).pathname).toBe('/embed/abc123XYZ_-');
  });

  it('forces autoplay=1 & mute=1 (and the safe playback defaults) on every embed', () => {
    for (const src of [
      CH,
      'https://www.youtube.com/watch?v=abc123XYZ_-',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/KQp-e_XQnDE'
    ]) {
      const out = toEmbedUrl(src);
      expect(out).not.toBeNull();
      const p = params(out!);
      expect(p.autoplay).toBe('1');
      expect(p.mute).toBe('1');
      expect(p.playsinline).toBe('1');
      expect(p.enablejsapi).toBe('1');
    }
  });

  it('non-YouTube host -> null', () => {
    expect(toEmbedUrl('https://vimeo.com/12345')).toBeNull();
    expect(toEmbedUrl('https://example.com/watch?v=abc')).toBeNull();
  });

  it('junk / non-url input -> null', () => {
    expect(toEmbedUrl('not a url')).toBeNull();
    expect(toEmbedUrl('')).toBeNull();
    expect(toEmbedUrl('   ')).toBeNull();
    expect(toEmbedUrl(null)).toBeNull();
    expect(toEmbedUrl(undefined)).toBeNull();
  });

  it('non-http(s) protocol -> null', () => {
    expect(toEmbedUrl('ftp://www.youtube.com/embed/abc')).toBeNull();
    expect(toEmbedUrl('javascript:alert(1)')).toBeNull();
  });

  it('YouTube url with no usable id -> null', () => {
    expect(toEmbedUrl('https://www.youtube.com/watch')).toBeNull();
    expect(toEmbedUrl('https://youtu.be/')).toBeNull();
  });
});

describe('toWatchUrl', () => {
  it('bare channel id -> /channel/<id>/live', () => {
    expect(toWatchUrl(CH)).toBe(`https://www.youtube.com/channel/${CH}/live`);
  });

  it('an embed video url -> its watch url', () => {
    expect(toWatchUrl('https://www.youtube.com/embed/KQp-e_XQnDE')).toBe(
      'https://www.youtube.com/watch?v=KQp-e_XQnDE'
    );
  });

  it('an /embed/live_stream?channel url -> the channel live page', () => {
    expect(toWatchUrl(`https://www.youtube.com/embed/live_stream?channel=${CH}`)).toBe(
      `https://www.youtube.com/channel/${CH}/live`
    );
  });

  it('a youtu.be short url -> its watch url', () => {
    expect(toWatchUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
  });

  it('empty / nullish input -> null', () => {
    expect(toWatchUrl('')).toBeNull();
    expect(toWatchUrl(null)).toBeNull();
    expect(toWatchUrl(undefined)).toBeNull();
  });

  it('a non-url string is returned unchanged', () => {
    expect(toWatchUrl('whatever')).toBe('whatever');
  });
});
