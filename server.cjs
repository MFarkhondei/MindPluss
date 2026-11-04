const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'public');
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/ai') {
    req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    res.send = value => res.end(value);
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024 * 1024) { res.status(413).json({error:{message:'Request too large'}}); return; }
    }
    try { req.body = body ? JSON.parse(body) : undefined; }
    catch { res.status(400).json({error:{message:'Invalid JSON'}}); return; }
    return require('./api/ai.js')(req, res);
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, content) => {
    if (error) { res.writeHead(404).end('Not found'); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
    res.end(content);
  });
}).listen(4173, '127.0.0.1', () => console.log('MindPluss: http://127.0.0.1:4173'));
