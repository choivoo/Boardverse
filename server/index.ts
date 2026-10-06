import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { RoomManager, type Conn } from './rooms';
import type { ClientMsg } from '../src/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(process.cwd(), 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" };

const mgr = new RoomManager();
setInterval(() => mgr.tick(), 500).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, SEC).end('ok'); return; }
  let file = normalize(join(DIST, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { ...SEC, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('sw.js') || file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' }).end(body);
  } catch {
    try { file = join(DIST, 'index.html'); res.writeHead(200, { ...SEC, 'Content-Type': TYPES['.html'] }).end(await readFile(file)); }
    catch { res.writeHead(404).end('Not built. Run npm run build.'); }
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
wss.on('connection', (ws) => {
  const conn: Conn = { send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); } };
  let count = 0; const reset = setInterval(() => { count = 0; }, 1000);
  ws.on('message', (data) => {
    if (++count > 20) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(data.toString()); } catch { conn.send({ t: 'error', msg: '잘못된 요청입니다.' }); return; }
    try { mgr.handle(conn, msg); } catch (e) { console.error('handler error', e); conn.send({ t: 'error', msg: '서버 오류가 발생했습니다.' }); }
  });
  ws.on('close', () => { clearInterval(reset); mgr.disconnect(conn); });
  ws.on('error', () => ws.close());
});

server.listen(PORT, () => console.log(`Boardverse listening on :${PORT}`));
