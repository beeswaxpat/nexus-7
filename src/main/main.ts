// Electron main entry: app lifecycle, window creation, IPC wiring, scheduler boot.

import { app, BrowserWindow, session } from 'electron';
import { createMainWindow } from './window';
import { registerIpc } from './ipc/register-ipc';
import { startScheduler, stopScheduler } from './data/scheduler';

let mainWindow: BrowserWindow | null = null;

function boot(): void {
  mainWindow = createMainWindow();

  // Deny all web permission requests on the default session. The dashboard
  // uses no camera, mic, geolocation, notifications, or MIDI; embedded remote
  // YouTube frames have no legitimate need either, so this is a blanket deny
  // with no functional regression.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  registerIpc(mainWindow);
  startScheduler(mainWindow);

  mainWindow.on('closed', () => {
    stopScheduler();
    mainWindow = null;
  });
}

// Single instance: two copies would share (and clobber) the one settings.json and
// open two chat sockets. A second launch just focuses the running window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(boot);

  app.on('activate', () => {
    // macOS dock re-activation with no window. registerIpc/startScheduler are
    // idempotent enough for a re-boot here; Windows never takes this path.
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
}

app.on('window-all-closed', () => {
  stopScheduler();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopScheduler();
});
