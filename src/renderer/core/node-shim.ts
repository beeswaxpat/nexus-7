// Defensive Node-global shims for the renderer. The chat's mqtt now loads as the
// self-contained UMD browser build (window.mqtt, see index.html + mqtt-client.ts),
// which needs none of these; but bundlers occasionally pull deps that probe for the
// Node globals `global` / `process` / `Buffer`, and Vite's dev server provides them
// while a rollup PRODUCTION build does not. Installing them here keeps dev and the
// packaged exe behaving identically and costs nothing.
//
// Side-effect-only: main.ts imports this FIRST so the shims exist before anything
// else evaluates. Every define is guarded so a real value (Electron, a future
// preload) is never clobbered.

import { Buffer as BufferPolyfill } from 'buffer';

const g = globalThis as any;

if (!g.global) g.global = globalThis;

if (!g.process) {
  g.process = {
    env: {},
    browser: true,
    version: '',
    nextTick: (fn: (...a: any[]) => void, ...args: any[]) =>
      queueMicrotask(() => fn(...args))
  };
}

if (!g.Buffer) g.Buffer = BufferPolyfill;

export {};
