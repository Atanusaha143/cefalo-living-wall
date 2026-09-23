import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../serve.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A raw GET, so the path reaches the server exactly as written (no URL normalising).
const get = (port, path) => new Promise((done, fail) => {
  request({ host: '127.0.0.1', port, path }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => done({ status: res.statusCode, type: res.headers['content-type'], body }));
  }).on('error', fail).end();
});

test('serves files with their type, 404s the rest, and refuses to leave the root', async () => {
  const server = createStaticServer(root);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const ok = await get(port, '/package.json');
    assert.equal(ok.status, 200);
    assert.equal(ok.type, 'application/json');
    assert.equal((await get(port, '/nope.txt')).status, 404);
    assert.equal((await get(port, '/..%2f..%2f..%2fetc%2fpasswd')).status, 403);
    assert.equal((await get(port, '/%E0%A4%A')).status, 404);
    assert.equal((await get(port, '/')).status, 302);
  } finally {
    server.close();
  }
});
