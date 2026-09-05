// Boot-test a packaged NEXUS-7 exe over the Chrome DevTools Protocol.
//
//   node scripts/probe-exe.mjs [path\to\NEXUS-7.exe] [--keep]
//
// Launches the exe with --remote-debugging-port=9222, waits for the renderer,
// evaluates a probe INSIDE the real renderer (bridge present? panels filled?
// chat connected? console errors?), prints a JSON report, then closes the app
// (unless --keep). This is the only faithful way to verify exe-only behavior
// (preload/sandbox, the 127.0.0.1 renderer server, the main-process chat relay):
// neither dev:web nor a static serve of dist-renderer exercises them.
//
// Uses a scratch userData dir (--user-data-dir) so the probe never touches or
// seeds a real profile. Requires the `ws` package (a transitive dependency).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const exeArg = args.find((a) => !a.startsWith('--'));
const exe = resolve(exeArg ?? 'dist/win-unpacked/NEXUS-7.exe');
if (!existsSync(exe)) {
  console.error('[probe] exe not found:', exe);
  process.exit(2);
}
const PORT = 9222;
const userData = mkdtempSync(join(tmpdir(), 'nexus7-probe-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pages() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json`);
    return await res.json();
  } catch {
    return [];
  }
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return new Promise((res) => ws.on('open', () => res({ send, close: () => ws.close() })));
}

const PROBE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  const text = (s) => document.querySelector(s)?.textContent ?? null;
  // give the feeds up to 25 s to fill the boxes + connect the chat
  let out = {};
  for (let i = 0; i < 25; i++) {
    out = {
      bridge: typeof window.nexus === 'object' && window.nexus !== null,
      relayChat: typeof window.nexus?.chatConnect === 'function',
      origin: location.origin,
      mqttScriptLoaded: !!document.querySelector('script[src*="mqtt.min.js"]'),
      rows: document.querySelectorAll('.asset-row:not(.asset-row--pending)').length,
      pendingRows: document.querySelectorAll('.asset-row--pending').length,
      btcPrice: text('.bstat__price'),
      chatStatus: text('.chat__status-text'),
      roomLabel: text('.chat__room-label'),
      leds: [...document.querySelectorAll('.titlebar__led')].map((l) => l.dataset.state),
      tabs: [...document.querySelectorAll('.tab')].map((t) => t.textContent),
      settingsSections: (() => { document.querySelector('.titlebar__btn--settings')?.click(); const s = [...document.querySelectorAll('.nx-set-section-label')].map((x) => x.textContent); document.querySelector('.nx-set-close')?.click(); return s; })(),
      ticker: document.querySelectorAll('.ticker__item').length,
      elapsedMs: Date.now() - t0
    };
    if (out.rows >= 5 && out.chatStatus === 'connected' && out.ticker > 0) break;
    await wait(1000);
  }
  return out;
})()`;

const child = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
  detached: false,
  stdio: 'ignore'
});

let report = null;
try {
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(500);
    const list = await pages();
    page = list.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
  }
  if (!page) throw new Error('renderer page never appeared on the debug port');
  const c = await cdp(page.webSocketDebuggerUrl);
  const errors = [];
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  // console errors are collected via Runtime.consoleAPICalled / Log.entryAdded
  const res = await c.send('Runtime.evaluate', { expression: PROBE, awaitPromise: true, returnByValue: true });
  report = res.result?.result?.value ?? { error: JSON.stringify(res).slice(0, 400) };
  report.pageUrl = page.url;
  report.consoleErrors = errors;
  c.close();
} catch (err) {
  report = { error: err instanceof Error ? err.message : String(err) };
} finally {
  if (!keep) {
    try {
      child.kill();
      // portable exe spawns the real app as a child; make sure the tree dies
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
    await sleep(1500);
    try {
      rmSync(userData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
console.log(JSON.stringify(report, null, 2));
const ok = report && report.bridge && report.relayChat && report.rows >= 1 && report.chatStatus === 'connected';
process.exit(ok ? 0 : 1);
