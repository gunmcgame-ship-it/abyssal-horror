import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.argv[2], OUT = process.argv[3];
http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  if (q.method === 'POST' && u.pathname === '/save') {
    const n = path.basename(u.searchParams.get('name') || 'x.png'); const c = [];
    q.on('data', (d) => c.push(d)); q.on('end', () => { fs.writeFileSync(path.join(OUT, n), Buffer.concat(c)); r.end('saved ' + n); }); return;
  }
  const f = path.join(ROOT, path.basename(u.pathname === '/' ? 'dev.html' : u.pathname));
  const f2 = path.join(OUT, path.basename(u.pathname)); fs.readFile(fs.existsSync(f) ? f : f2, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'application/octet-stream'); r.end(d); });
}).listen(8791, '127.0.0.1', () => console.log('listening 8791'));
