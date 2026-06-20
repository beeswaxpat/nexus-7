import { defineConfig } from 'vitest/config';

// Unit-test config for the NEXUS-7 renderer's pure/near-pure modules. The renderer
// is a plain TS web app, so we run tests in a DOM-like env (happy-dom) which also
// supplies WebCrypto (crypto.subtle) + TextEncoder/TextDecoder used by chat/crypto.
//
// `define: { global: 'globalThis' }` mirrors vite.config.ts so any dep referencing
// a bare `global` still resolves the same way it does in the app build. CSS imports
// (e.g. live-tv.ts does `import './live-tv.css'`) are turned into a no-op via
// `css: false` so importing those modules doesn't try to parse real stylesheets.
export default defineConfig({
  define: { global: 'globalThis' },
  test: {
    globals: true,
    environment: 'happy-dom',
    // Make `import './x.css'` a no-op so modules that pull in stylesheets import
    // cleanly under the test runner (no real CSS processing in unit tests).
    css: false,
    include: ['tests/**/*.test.ts']
  }
});
