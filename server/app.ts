import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import type { RoomManager } from './rooms';
import type { Store } from './store';
import type { Mailer } from './mail';
import { createCore, originOk, SEC, type Env } from './core';

export { makeHooks } from './core';

/** Node/Docker adapter: static files + the shared core over node:http and the `ws` library. */
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json' };

export interface App { server: http.Server; mgr: RoomManager; store: Store; mailer: Mailer; tick(): void; close(): Promise<void> }

export function createApp(store: Store, opts: { dist: string; now?: () => number; mailer?: Mailer; env?: Env }): App {
  const env = opts.env ?? process.env;
  const core = createCore(store, { now: opts.now, mailer: opts.mailer, env });

  const readBody = (req: http.IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > 4096) { reject(Object.assign(new Error('too large'), { tooLarge: true })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
  const lower = (h: http.IncomingHttpHeaders) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/healthz' || url.pathname.startsWith('/api/')) {
      let body = '';
      try { if (req.method !== 'GET' && req.method !== 'HEAD') body = await readBody(req); }
      catch { res.writeHead(413, { ...SEC, 'Content-Type': 'application/json' }).end(JSON.stringify({ error: '요청이 너무 큽니다.' })); return; }
      const r = await core.handle({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: lower(req.headers), ip: String(req.socket.remoteAddress), body });
      res.writeHead(r.status, r.headers).end(r.body); return;
    }
    if (req.headers['x-forwarded-proto'] === 'https' || env.COOKIE_SECURE === '1') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    let file = normalize(join(opts.dist, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(opts.dist)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { ...SEC, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('sw.js') || file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' }).end(body);
    } catch {
      try { file = join(opts.dist, 'index.html'); res.writeHead(200, { ...SEC, 'Content-Type': TYPES['.html'] }).end(await readFile(file)); }
      catch { res.writeHead(404).end('Not built. Run npm run build.'); }
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048, verifyClient: ({ req }: { req: http.IncomingMessage }, done: (ok: boolean, code?: number, msg?: string) => void) => (originOk(req.headers.origin, req.headers.host) ? done(true) : done(false, 403, 'Forbidden')) });
  wss.on('connection', (ws, req) => {
    const h = core.connect(req.headers.cookie, (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); });
    // dead-connection detection: ping every 15 s, drop sockets that did not answer the previous ping (so forfeit/disconnect logic stays accurate)
    let alive = true; ws.on('pong', () => { alive = true; });
    const beat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; try { ws.ping(); } catch { /* closing */ } }, 15_000); beat.unref();
    ws.on('message', (data) => h.message(data.toString()));
    ws.on('close', () => { clearInterval(beat); h.close(); });
    ws.on('error', () => ws.close());
  });

  return {
    server, mgr: core.mgr, store, mailer: core.mailer,
    tick: () => core.tick(),
    async close() {
      core.markShutdown();
      for (const c of wss.clients) c.close(1001, 'server shutting down');
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
      store.db.close?.();
    },
  };
}
