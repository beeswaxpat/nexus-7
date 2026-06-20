// IMPLEMENTED (pure reaction logic per PORTING_SPEC.md). Central source of truth so
// overlays, the wormhole, asset rows, and the F&G bar all react identically. No DOM
// here, no side effects: just inputs -> decisions. Thresholds come from constants.

import { REACTION } from '../../shared/constants';
import type { AssetQuote } from '../../shared/types';

export type Emoji = '' | 'happy' | 'rocket' | 'diamond' | 'poop' | 'skull';
export type BtcMode = 'normal' | 'pump' | 'dump' | 'lfg';

/**
 * Per-asset reactive emoji by 24h % change. Priority order, first match wins:
 *   bitcoin AND 5<=change<10 -> happy; >=20 -> diamond; >=10 -> rocket;
 *   <=-20 -> skull; <=-10 -> poop; otherwise none.
 * Returns a semantic token; the renderer maps it to a glyph + animation.
 */
export function emojiFor(change24h: number | null, isBitcoin: boolean): Emoji {
  if (change24h == null || !Number.isFinite(change24h)) return '';
  const e = REACTION.emoji;
  if (isBitcoin && change24h >= e.happyMin && change24h < e.happyMax) return 'happy';
  if (change24h >= e.diamond) return 'diamond';
  if (change24h >= e.rocket) return 'rocket';
  if (change24h <= e.skull) return 'skull';
  if (change24h <= e.poop) return 'poop';
  return '';
}

/** Map an emoji token to a display glyph. */
export function emojiGlyph(e: Emoji): string {
  switch (e) {
    case 'happy':
      return '\u{1F600}'; // grinning face
    case 'rocket':
      return '\u{1F680}'; // rocket
    case 'diamond':
      return '\u{1F48E}'; // gem stone
    case 'poop':
      return '\u{1F4A9}'; // pile of poo
    case 'skull':
      return '\u{1F480}'; // skull
    default:
      return '';
  }
}

/** Emoji tokens that pulse-scale (transform only, never resize the row). */
export function emojiPulses(e: Emoji): boolean {
  return e === 'diamond' || e === 'happy';
}

/**
 * BTC wormhole / global mode by BTC 24h % change.
 *   >=10 -> lfg; >5 -> pump; <-5 -> dump; otherwise normal.
 * Drives document.documentElement.dataset.btc and the --accent swap.
 */
export function btcMode(change24h: number | null): BtcMode {
  if (change24h == null || !Number.isFinite(change24h)) return 'normal';
  const w = REACTION.wormhole;
  if (change24h >= w.lfg) return 'lfg';
  if (change24h >= w.pump) return 'pump';
  if (change24h <= w.dump) return 'dump';
  return 'normal';
}

/**
 * Trigger banner text by the center asset's 24h % change. Bands at 5/10/15/20 up
 * and down (highest magnitude match wins). Returns null when |change| < 5. The
 * optional assetName names the +5 band's subject (defaults to 'Bitcoin' for
 * backward compatibility) so the banner tracks whatever asset is centered.
 */
export function bannerFor(change24h: number | null, assetName: string = 'Bitcoin'): string | null {
  if (change24h == null || !Number.isFinite(change24h)) return null;
  const b = REACTION.banner;
  if (change24h >= b.p20) return 'OHHHH MAAAAAAN!!!';
  if (change24h >= b.p15) return 'SOMETHING LIKE A PHENOMENON!';
  if (change24h >= b.p10) return 'Starting to like this guy!';
  if (change24h >= b.p5) return `${assetName} is feeling nicey`;
  if (change24h <= b.n20) return 'GGWP';
  if (change24h <= b.n15) return 'CAPITULATION WARNING';
  if (change24h <= b.n10) return 'Idk.';
  if (change24h <= b.n5) return "Isn't that just grape";
  return null;
}

export interface FngBand {
  level: string;
  color: string;
}

/**
 * Fear & Greed bands + bar color by value (0..100).
 *   <=24 Extreme Fear; <=49 Fear; ==50 Neutral; <=74 Greed; else Extreme Greed.
 *   color: red <50, green >=50 (Extreme Fear a darker red).
 */
export function fngBands(value: number): FngBand {
  if (value <= 24) return { level: 'Extreme Fear', color: '#8b0000' };
  if (value <= 49) return { level: 'Fear', color: '#ff4d4d' };
  if (value === 50) return { level: 'Neutral', color: '#cccccc' };
  if (value <= 74) return { level: 'Greed', color: '#37d67a' };
  return { level: 'Extreme Greed', color: '#00ff88' };
}

/**
 * True if ANY asset in a box has abs(24h change) >= the orbit threshold.
 * Pure, tested helper kept for reuse; no UI currently calls it (the avatar-orbit
 * overlay it was written for is not wired up).
 */
export function shouldOrbit(boxAssets: AssetQuote[]): boolean {
  return boxAssets.some(
    (q) => q.change24h != null && Math.abs(q.change24h) >= REACTION.avatarOrbit
  );
}
