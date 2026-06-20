// Renderer entry. Boot order: get the bridge (real or browser-mock), load settings
// first, start the feeds (snapshot + live pushes -> store), build the AppContext,
// then mount every top-level panel into its container. Panels are Phase-0 stubs but
// all imports resolve and the 3-column grid + ticker render with placeholders.

// node-shim MUST be the FIRST import: it installs the Node globals mqtt.js needs
// at eval time, before any module that pulls in mqtt loads (see core/node-shim.ts).
import './core/node-shim';

import './styles/tokens.css';
import './styles/fonts.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/effects.css';

import { getBridge } from './bridge';
import { store } from './state/store';
import { initSettings } from './state/settings';
import { createContext } from './app-context';
import { startFeeds } from './feeds';
import { resolve } from './core/dom';

import { mountAssetBox } from './panels/asset-box/asset-box';
import { mountBtcChart } from './panels/chart/btc-chart';
import { mountCommandCenter } from './panels/center/command-center';
import { mountNewsPanel } from './panels/news/news-panel';
import { mountScenes } from './core/scenes';
import { mountMarketTicker } from './panels/ticker/market-ticker';
import { mountOverlays } from './panels/overlays/overlay-root';
import { initLayoutSwap } from './core/layout-swap';
import { mountColResize } from './core/col-resize';
import { mountTitlebar } from './titlebar';

// Run one top-level mount in isolation: a throw inside any panel body (malformed
// settings, garbage feed data, chat/crypto init) or a missing dynamic mount target
// must not abort the remaining mounts. Logs and keeps the dashboard alive (priority
// 1: never white-screen or silently half-boot). `fn` is wrapped as a thunk so the
// resolve() calls in the mount statement are also guarded.
function safeMount(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[nexus] mount failed: ${label}`, err);
  }
}

async function boot(): Promise<void> {
  const bridge = getBridge();

  // settings first (panels read ctx.settings synchronously)
  const settings = await initSettings(bridge);

  // feeds: instant snapshot then live pushes into the store. Never let a snapshot
  // hiccup blank the UI; panels still mount and fill from the live pushes.
  try {
    await startFeeds(bridge);
  } catch (err) {
    console.error('[nexus] startFeeds failed; mounting panels anyway', err);
  }

  const ctx = createContext(bridge, store, settings);

  // custom titlebar (frameless window controls)
  safeMount('titlebar', () => mountTitlebar(resolve('#titlebar'), ctx));

  // top-level mounts (exact order + targets per the contract). Each is isolated so
  // one panel throwing does not cascade and abort the panels that follow.
  safeMount('asset-box/friend', () => mountAssetBox(resolve('#box-friend'), { editable: true, scope: 'friend' }, ctx));
  safeMount('asset-box/owner', () => mountAssetBox(resolve('#box-owner'), { editable: true, scope: 'owner' }, ctx));
  safeMount('btc-chart', () => mountBtcChart(resolve('#box-chart'), ctx));
  // resizable dividers between the three left boxes (after they mount, so the
  // slot divs and their content exist; dividers re-weight via flex-grow only)
  safeMount('col-resize', () => mountColResize(resolve('#col-left'), ctx));
  safeMount('command-center', () => mountCommandCenter(resolve('#center'), ctx));
  safeMount('news-panel', () => mountNewsPanel(resolve('#panel-news'), ctx));
  // the two ambient graphics (wormhole + NIGHT CITY): user-swappable and hideable.
  // The scene manager fills the center graphic cell and the bottom-right panel.
  safeMount('scenes', () => mountScenes(resolve('#cc-wormhole'), resolve('#panel-chat'), ctx));
  safeMount('market-ticker', () => mountMarketTicker(resolve('#ticker'), ctx));
  safeMount('overlays', () => mountOverlays(resolve('#overlay-root'), ctx));

  // enable drag-and-drop panel swapping (restores any saved arrangement)
  safeMount('layout-swap', () => initLayoutSwap(ctx));

  console.info('[nexus] renderer booted.');
}

// Global last-resort guards: surface any uncaught renderer error or unhandled
// promise rejection to the console and keep the app alive instead of letting it
// die silently. Registered before boot() so an early throw is still caught. We do
// not call preventDefault, so existing per-element error logging is unaffected.
window.addEventListener('error', (e) => console.error('[nexus] window error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[nexus] unhandled rejection', e.reason));

boot().catch((err) => console.error('[nexus] boot failed', err));
