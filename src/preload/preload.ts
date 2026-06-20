// Preload: the ONLY bridge between the sandboxed renderer and the main process.
// Exposes window.nexus with promise-returning invoke wrappers (request/response)
// and on* subscribe wrappers that return an unsubscribe function (push channels).
// This shape is the FROZEN contract the renderer's bridge.ts mirrors, and the
// browser-mock in bridge.ts must implement the same surface.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type {
  AssetQuote,
  Candle,
  FngData,
  NewsItem,
  ResolveResult,
  SatElement,
  Settings,
  Snapshot,
  SourceStatus,
  TickerCoin
} from '../shared/types';

type Unsubscribe = () => void;

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

export interface NexusBridge {
  // request / response
  getSnapshot(): Promise<Snapshot>;
  refresh(): Promise<{ ok: boolean }>;
  resolveAsset(query: string): Promise<ResolveResult>;
  addAsset(key: string): Promise<Settings>;
  removeAsset(key: string): Promise<Settings>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  openExternal(url: string): Promise<{ ok: boolean; error?: string }>;
  // window controls (frameless titlebar)
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
  // encrypted chat transport (MQTT runs in main; only ciphertext + topic cross here)
  chatConnect(topic: string): void;
  chatPublish(wireB64: string): void;
  chatDisconnect(): void;
  onChatMessage(cb: (wireB64: string) => void): Unsubscribe;
  onChatStatus(cb: (status: 'connecting' | 'connected' | 'error') => void): Unsubscribe;
  // push subscriptions (each returns an unsubscribe fn)
  onCrypto(cb: (q: AssetQuote[]) => void): Unsubscribe;
  onStocks(cb: (q: AssetQuote[]) => void): Unsubscribe;
  onFng(cb: (f: FngData) => void): Unsubscribe;
  onNews(cb: (n: NewsItem[]) => void): Unsubscribe;
  onTicker(cb: (t: TickerCoin[]) => void): Unsubscribe;
  onCandlesInit(cb: (c: Candle[]) => void): Unsubscribe;
  onCandleUpdate(cb: (c: Candle) => void): Unsubscribe;
  onStatus(cb: (s: SourceStatus) => void): Unsubscribe;
  onSats(cb: (s: SatElement[]) => void): Unsubscribe;
}

const nexus: NexusBridge = {
  getSnapshot: () => ipcRenderer.invoke(IPC.DATA_GET_SNAPSHOT),
  refresh: () => ipcRenderer.invoke(IPC.DATA_REFRESH),
  resolveAsset: (query) => ipcRenderer.invoke(IPC.ASSET_RESOLVE, query),
  addAsset: (key) => ipcRenderer.invoke(IPC.ASSET_ADD, key),
  removeAsset: (key) => ipcRenderer.invoke(IPC.ASSET_REMOVE, key),
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  openExternal: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  minimizeWindow: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  toggleMaximizeWindow: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE_TOGGLE),
  closeWindow: () => ipcRenderer.send(IPC.WINDOW_CLOSE),

  chatConnect: (topic) => ipcRenderer.send(IPC.CHAT_CONNECT, topic),
  chatPublish: (wireB64) => ipcRenderer.send(IPC.CHAT_PUBLISH, wireB64),
  chatDisconnect: () => ipcRenderer.send(IPC.CHAT_DISCONNECT),
  onChatMessage: (cb) => subscribe(IPC.CHAT_MESSAGE, cb),
  onChatStatus: (cb) => subscribe(IPC.CHAT_STATUS, cb),

  onCrypto: (cb) => subscribe(IPC.PUSH_CRYPTO, cb),
  onStocks: (cb) => subscribe(IPC.PUSH_STOCKS, cb),
  onFng: (cb) => subscribe(IPC.PUSH_FNG, cb),
  onNews: (cb) => subscribe(IPC.PUSH_NEWS, cb),
  onTicker: (cb) => subscribe(IPC.PUSH_TICKER, cb),
  onCandlesInit: (cb) => subscribe(IPC.PUSH_CANDLES_INIT, cb),
  onCandleUpdate: (cb) => subscribe(IPC.PUSH_CANDLE_UPDATE, cb),
  onStatus: (cb) => subscribe(IPC.PUSH_STATUS, cb),
  onSats: (cb) => subscribe(IPC.PUSH_SATS, cb)
};

contextBridge.exposeInMainWorld('nexus', nexus);
