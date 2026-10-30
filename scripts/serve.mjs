// Tiny static server for local preview: node scripts/serve.mjs <folder> [port]
// Serves directory index.html files and returns 404.html with a 404 status, like typical static hosts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './content.mjs';
const dir = path.resolve(ROOT, process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(dir, u);
  if (!f.startsWith(dir)) { res.writeHead(403); return res.end('Forbidden'); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) {
    const nf = path.join(dir, '404.html');
    res.writeHead(404, { 'Content-Type': types['.html'] });
    return res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`Serving ${dir} at http://localhost:${port}/`));
