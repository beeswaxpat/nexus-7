// FROZEN CONTRACT. Every process (main, preload, renderer) imports these channel
// names. Do not rename a value without updating all three sides. Request/response
// channels use ipcMain.handle/ipcRenderer.invoke; PUSH_* channels are one-way
// webContents.send from the scheduler to the renderer.
export const IPC = {
  // request / response (renderer -> main -> renderer)
  DATA_GET_SNAPSHOT: 'data:get-snapshot',
  DATA_REFRESH: 'data:refresh',
  ASSET_RESOLVE: 'asset:resolve',
  ASSET_ADD: 'asset:add',
  ASSET_REMOVE: 'asset:remove',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  OPEN_EXTERNAL: 'shell:open-external',

  // window controls (frameless custom titlebar; one-way send)
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE_TOGGLE: 'window:maximize-toggle',
  WINDOW_CLOSE: 'window:close',

  // encrypted chat transport (runs in MAIN: the renderer's network is blocked on
  // non-443 ports on some locked-down networks; the main process reaches the public
  // brokers fine). End-to-end crypto stays in the renderer; only opaque ciphertext
  // (base64 wire text) and the derived topic cross these channels.
  CHAT_CONNECT: 'chat:connect', // renderer -> main: (topic)
  CHAT_PUBLISH: 'chat:publish', // renderer -> main: (wireBase64)
  CHAT_DISCONNECT: 'chat:disconnect', // renderer -> main
  CHAT_MESSAGE: 'chat:message', // main -> renderer: (wireBase64)
  CHAT_STATUS: 'chat:status', // main -> renderer: ('connecting' | 'connected' | 'error')

  // push (main -> renderer, one-way)
  PUSH_CRYPTO: 'push:crypto',
  PUSH_STOCKS: 'push:stocks',
  PUSH_FNG: 'push:fng',
  PUSH_NEWS: 'push:news',
  PUSH_TICKER: 'push:ticker',
  PUSH_CANDLES_INIT: 'push:candles-init',
  PUSH_CANDLE_UPDATE: 'push:candle-update',
  PUSH_STATUS: 'push:source-status',
  PUSH_SATS: 'push:sats'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
