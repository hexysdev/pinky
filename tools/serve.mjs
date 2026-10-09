// Static server for the pages in this folder. Wallet extensions do not inject into file:// pages.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2] ?? 8787);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '') || 'oracle-test.html';
  const file = join(root, path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  let body;
  try {
    body = await readFile(file);
  } catch {
    return res.writeHead(404).end('not found');
  }
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
