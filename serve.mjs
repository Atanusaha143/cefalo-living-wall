// Serves the repository for browser development: npm start, then open /scene/.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};

export function createStaticServer(root) {
  const base = resolve(root);
  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://local');
      if (pathname === '/') { res.writeHead(302, { Location: '/scene/' }); res.end(); return; }
      let path = decodeURIComponent(pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(base, `.${path}`);
      if (!file.startsWith(base + sep)) { res.writeHead(403); res.end('forbidden'); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  createStaticServer(dirname(fileURLToPath(import.meta.url))).listen(port, '127.0.0.1', () => {
    console.log(`Cefalo Living Wall: http://127.0.0.1:${port}/scene/  (Ctrl+C to stop)`);
  });
}
