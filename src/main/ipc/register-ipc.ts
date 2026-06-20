// Registers all request/response IPC handlers. Push channels are emitted by the
// scheduler, not here. Renderer talks to these via the preload `window.nexus`.

import { BrowserWindow, ipcMain, shell } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { Settings } from '../../shared/types';
import { cache } from '../data/cache';
import { resolveAsset } from '../data/asset-resolver';
import { addAsset, getSettings, removeAsset, setSettings } from '../store/settings-store';
import { notifySettingsChanged } from '../data/scheduler';
import { createChatRelay } from '../chat-relay';

/** Wire every ipcMain.handle. Call once after the window exists. */
export function registerIpc(win: BrowserWindow): void {
  ipcMain.handle(IPC.DATA_GET_SNAPSHOT, () => cache.snapshot());

  ipcMain.handle(IPC.DATA_REFRESH, () => {
    // Plumbing hook: a manual refresh re-pushes the current snapshot so the UI
    // repaints. Adapter-driven re-fetch is added when adapters go live (Phase 3).
    const snap = cache.snapshot();
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.PUSH_CRYPTO, snap.crypto);
      win.webContents.send(IPC.PUSH_STOCKS, snap.stocks);
      if (snap.fng) win.webContents.send(IPC.PUSH_FNG, snap.fng);
      win.webContents.send(IPC.PUSH_NEWS, snap.news);
      win.webContents.send(IPC.PUSH_TICKER, snap.ticker);
      win.webContents.send(IPC.PUSH_CANDLES_INIT, snap.candles);
      win.webContents.send(IPC.PUSH_SATS, snap.sats);
    }
    return { ok: true };
  });

  ipcMain.handle(IPC.ASSET_RESOLVE, (_e, query: string) => resolveAsset(query));

  ipcMain.handle(IPC.ASSET_ADD, (_e, key: string): Settings => {
    const next = addAsset(key);
    // Kick the scheduler so the newly added asset starts fetching now, not next tick.
    notifySettingsChanged();
    return next;
  });

  ipcMain.handle(IPC.ASSET_REMOVE, (_e, key: string): Settings => {
    const next = removeAsset(key);
    notifySettingsChanged();
    return next;
  });

  ipcMain.handle(IPC.SETTINGS_GET, (): Settings => getSettings());

  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<Settings>): Settings => {
    const next = setSettings(patch);
    // Refetch when the asset universe changed (friend list edit or a new center
    // asset) so the rows stay in sync without waiting for the next poll.
    const refetchKeys = ['friendAssets', 'ownerAssets', 'centerAsset', 'secondaryAsset'];
    if (patch && refetchKeys.some((k) => Object.prototype.hasOwnProperty.call(patch, k))) {
      notifySettingsChanged();
    }
    return next;
  });

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_e, url: string) => {
    // Only ever hand http/https URLs to the OS browser. Never navigate the renderer.
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'Blocked non-http(s) URL' };
      }
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- window controls (frameless custom titlebar) -------------------------
  ipcMain.on(IPC.WINDOW_MINIMIZE, () => {
    if (!win.isDestroyed()) win.minimize();
  });
  ipcMain.on(IPC.WINDOW_MAXIMIZE_TOGGLE, () => {
    if (win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(IPC.WINDOW_CLOSE, () => {
    if (!win.isDestroyed()) win.close();
  });

  // --- encrypted chat transport (MQTT runs here in MAIN; crypto stays in renderer) ---
  const chat = createChatRelay(win);
  ipcMain.removeAllListeners(IPC.CHAT_CONNECT);
  ipcMain.removeAllListeners(IPC.CHAT_PUBLISH);
  ipcMain.removeAllListeners(IPC.CHAT_DISCONNECT);
  ipcMain.on(IPC.CHAT_CONNECT, (_e, topic: string) => chat.connect(topic));
  ipcMain.on(IPC.CHAT_PUBLISH, (_e, wireB64: string) => chat.publish(wireB64));
  ipcMain.on(IPC.CHAT_DISCONNECT, () => chat.disconnect());
  win.on('closed', () => chat.dispose());
}
