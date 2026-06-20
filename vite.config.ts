import { defineConfig } from 'vite';

// The renderer is a plain TS web app (no UI framework). It must run BOTH inside
// Electron (loaded from dist-renderer) and in a plain browser via `npm run dev:web`
// (served at http://localhost:5173) for visual QA. base './' keeps asset URLs
// relative so the prod file:// load works.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  // Bare `global` -> globalThis at build time (harmless safety for any dep that
  // references it; chat's mqtt is now the vendored UMD build, see index.html).
  // This define is duplicated in vitest.config.mts; keep the two in sync.
  define: { global: 'globalThis' },
  build: {
    outDir: '../../dist-renderer',
    emptyOutDir: true,
    target: 'esnext'
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
