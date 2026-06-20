// Minimal static file server for the built renderer. The packaged app loads the
// renderer over http://127.0.0.1:<port> instead of file:// so that embedded YouTube
// players (CNBC Live / jukebox visuals) get a valid origin and stop throwing
// "Error 153 Video player configuration error". Localhost-only, no external exposure.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8'
};

/** Start a localhost static server rooted at rootDir; resolves to its base URL. */
export function startRendererServer(rootDir: string): Promise<string> {
  const root = normalize(rootDir);
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void (async () => {
        try {
          const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
          const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
          let target = normalize(join(root, rel));
          // path-traversal guard: never serve outside the root
          if (target !== root && !target.startsWith(root + sep)) {
            res.statusCode = 403;
            res.end('forbidden');
            return;
          }
          // unknown path -> index.html (single-page fallback)
          if (!existsSync(target)) target = join(root, 'index.html');
          const data = await readFile(target);
          res.statusCode = 200;
          res.setHeader('Content-Type', MIME[extname(target).toLowerCase()] ?? 'application/octet-stream');
          res.end(data);
        } catch {
          res.statusCode = 500;
          res.end('error');
        }
      })();
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(`http://127.0.0.1:${addr.port}`);
      else reject(new Error('renderer server: no address'));
    });
  });
}
