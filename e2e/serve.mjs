// Serves the web build of the app (apps/mobile/web-build) on port 8088. Unknown paths get
// index.html, so deep links like /pack/<id> load the app and its router takes over.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(import.meta.dirname, '../apps/mobile/web-build');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));
  try {
    const body = await readFile(join(root, path));
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(join(root, 'index.html')));
  }
}).listen(8088, '127.0.0.1');
