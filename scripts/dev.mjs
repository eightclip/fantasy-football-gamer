#!/usr/bin/env node
// Local preview on http://localhost:3000 using .env.local. The access gate and push alerts are
// skipped locally; everything else calls the same code the deployed site runs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIntoProcess } from './env.mjs';

loadIntoProcess();
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const routes = {
  '/api/week': () => import('../api/week.js'),
  '/api/league': () => import('../api/league.js'),
  '/api/advice': () => import('../api/advice.js'),
  '/api/connect': () => import('../api/connect.js'),
};
const types = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (routes[url.pathname]) {
      const mod = await routes[url.pathname]();
      const r = await mod.GET(new Request(url));
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
      res.end(await r.text());
      return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404); res.end('{}'); return; }
    const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  } catch (err) {
    res.writeHead(500); res.end(String(err.message));
  }
}).listen(3000, '127.0.0.1', () => console.log('Preview at http://localhost:3000 (local only, no access gate)'));
