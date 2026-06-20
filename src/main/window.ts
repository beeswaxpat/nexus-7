// Creates the single fullscreen, frameless main window. Dev loads the Vite server
// at :5173; prod loads the built renderer from dist-renderer. Security hardened:
// contextIsolation on, nodeIntegration off, sandbox off (preload needs local modules; see webPreferences note), preload bridge only.

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { startRendererServer } from './server';

const DEV_URL = 'http://localhost:5173';

/**
 * True when running against the Vite dev server (npm run dev).
 *
 * The packaged exe MUST load the bundled renderer, never localhost. `app.isPackaged`
 * is the only reliable signal for that: in a built exe it is true, so isDev() is
 * false and we loadFile() the bundled dist-renderer. In dev (electron launched from
 * node_modules) it is false, so isDev() is true and we loadURL() the Vite server.
 * VITE_DEV_SERVER is honored as an explicit override for unusual launch setups.
 */
function isDev(): boolean {
  if (app.isPackaged) return false;
  return process.env.VITE_DEV_SERVER !== '0';
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    // Frameless with a custom titlebar (min/max/close live in the renderer). Starts
    // MAXIMIZED (not fullscreen) so the taskbar + our controls stay reachable.
    frame: false,
    backgroundColor: '#05060a',
    show: false,
    // The dense 3-column grid degrades below this (the center instrument cluster
    // would start colliding with COMMS); keep the window above its design floor.
    minWidth: 1024,
    minHeight: 640,
    webPreferences: {
      // preload is compiled by tsc to dist-electron/preload/preload.js (CommonJS)
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox MUST be false: the preload is tsc-compiled CommonJS that requires
      // local modules (../shared/ipc-channels). A sandboxed preload only allows
      // require('electron') + a small polyfill set, so it would throw before
      // exposing window.nexus, silently dropping the renderer to mock data.
      // Isolation is still strong: contextIsolation on + nodeIntegration off.
      sandbox: false,
      webviewTag: false
    }
  });

  win.once('ready-to-show', () => win.show());

  // Hardening: the renderer embeds REMOTE YouTube iframes (TV / Video / MONITOR
  // tabs), which are untrusted remote content running in-app. Deny every native
  // window-open attempt (window.open, target=_blank, YouTube 'Watch on YouTube' /
  // ad clicks) so no uncontrolled BrowserWindow can be spawned at an arbitrary
  // remote URL inside the app shell. Route only http(s) to the OS browser, which
  // mirrors the OPEN_EXTERNAL IPC allowlist. The renderer's own deliberate external
  // links already go through that IPC path, not native window.open.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const p = new URL(url).protocol;
      if (p === 'http:' || p === 'https:') {
        void shell.openExternal(url);
      }
    } catch {
      // ignore malformed url
    }
    return { action: 'deny' };
  });

  // Hardening: keep the TOP frame pinned to the app origin. A scripted location
  // change or a redirect chain reaching the top-level webContents could navigate
  // the whole dashboard off its origin to an arbitrary remote page (which would
  // run with the preload bridge still attached and no longer under the index.html
  // meta CSP). The prod port is random, so gate on hostname 127.0.0.1; in dev gate
  // on the Vite origin. The file:// fallback boot (server start failure) is allowed.
  // YouTube iframes are subframes, not top-frame navigations, so playback is
  // unaffected.
  const guardNavigation = (e: Electron.Event, url: string): void => {
    try {
      const target = new URL(url);
      const okDev = isDev() && target.origin === new URL(DEV_URL).origin;
      const okProd = target.hostname === '127.0.0.1';
      const okFile = target.protocol === 'file:';
      if (!okDev && !okProd && !okFile) e.preventDefault();
    } catch {
      e.preventDefault();
    }
  };
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);

  if (isDev()) {
    void win.loadURL(DEV_URL);
  } else {
    // Serve the built renderer over http://127.0.0.1 (NOT file://) so embedded
    // YouTube players get a real origin and stop throwing Error 153. Fall back to
    // file:// only if the local server cannot start.
    const root = join(__dirname, '../../dist-renderer');
    startRendererServer(root)
      .then((url) => win.loadURL(url))
      .catch((err) => {
        console.error('[window] renderer server failed, using file://', err);
        void win.loadFile(join(root, 'index.html'));
      });
  }

  // Start maximized (fills the screen, keeps the taskbar + custom titlebar visible).
  win.maximize();

  return win;
}
