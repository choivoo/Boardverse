import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { RoomManager, type Conn, type Hooks } from './rooms';
import { Store, ApiError } from './store';
import { ITEMS } from '../src/catalog';
import { SEASONS, seasonAt } from '../src/seasons';
import type { ClientMsg, GameKind } from '../src/protocol';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" };
const COOKIE = 'bv_session';

export function makeHooks(store: Store): Hooks {
  return {
    blocked: (a, b) => store.isBlocked(a, b),
    rating: (u, g) => store.rating(u, g),
    isFriend: (a, b) => store.isFriend(a, b),
    userByName: (n) => { const u = store.userByName(n); return u ? { id: u.id } : undefined; },
    // Games between two guests are not stored at all (data minimisation).
    record: (g) => (g.whiteId === null && g.blackId === null ? null : store.recordGame(g)),
  };
}

const parseCookies = (h: string | undefined) => Object.fromEntries((h ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v)]));
const isGame = (g: unknown): g is GameKind => g === 'chess' || g === 'gomoku';

export interface App { server: http.Server; mgr: RoomManager; store: Store; tick(): void }

export function createApp(store: Store, opts: { dist: string; now?: () => number }): App {
  const mgr = new RoomManager(opts.now ?? Date.now, makeHooks(store));
  const loginFails = new Map<string, { n: number; until: number }>();

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
    res.writeHead(status, { ...SEC, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(body));
  const readJson = (req: http.IncomingMessage): Promise<any> => new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > 4096) { reject(new ApiError(413, '요청이 너무 큽니다.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new ApiError(400, '잘못된 JSON입니다.')); } });
  });
  const sameOrigin = (req: http.IncomingMessage) => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const secure = req.headers['x-forwarded-proto'] === 'https';
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const me = store.userBySession(token);
    const need = () => { if (!me) throw new ApiError(401, '로그인이 필요합니다.'); return me; };
    const method = req.method ?? 'GET', path = url.pathname;
    if (method !== 'GET' && !sameOrigin(req)) throw new ApiError(403, '허용되지 않은 출처입니다.');
    const body = method === 'GET' ? {} : await readJson(req);
    const ip = String(req.socket.remoteAddress);

    if (method === 'POST' && (path === '/api/register' || path === '/api/login')) {
      const f = loginFails.get(ip);
      if (f && f.n >= 10 && f.until > Date.now()) throw new ApiError(429, '시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
      let id: number;
      try { id = path === '/api/register' ? store.register(body.email, body.name, body.password) : store.login(body.email, body.password); }
      catch (e) { const c = loginFails.get(ip) ?? { n: 0, until: 0 }; loginFails.set(ip, { n: c.n + 1, until: Date.now() + 10 * 60_000 }); throw e; }
      loginFails.delete(ip);
      const t = store.createSession(id);
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure ? '; Secure' : ''}` });
    }
    if (method === 'POST' && path === '/api/logout') {
      if (token) store.endSession(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
    }
    if (path === '/api/me') {
      if (method === 'GET') {
        if (!me) return send(res, 200, { user: null });
        return send(res, 200, { user: { id: me.id, name: me.name, coins: store.coins(me.id), public: !!store.userByName(me.name)!.is_public },
          ratings: store.ratings(me.id), stats: store.stats(me.id), inventory: store.inventory(me.id), equipped: store.equipped(me.id) });
      }
      if (method === 'PATCH') { store.setPublic(need().id, !!body.public); return send(res, 200, { ok: true }); }
      if (method === 'DELETE') { store.deleteUser(need().id, body.password); return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }); }
    }
    if (method === 'GET' && path === '/api/me/export') return send(res, 200, store.exportUser(need().id), { 'Content-Disposition': 'attachment; filename="boardverse-export.json"' });
    if (method === 'GET' && path === '/api/leaderboard') {
      const game = url.searchParams.get('game'); if (!isGame(game)) throw new ApiError(400, '게임을 선택하세요.');
      return send(res, 200, store.leaderboard(game, Number(url.searchParams.get('offset') ?? 0) || 0, Number(url.searchParams.get('limit') ?? 20) || 20, me?.id));
    }
    if (method === 'POST' && path === '/api/shop/buy') { store.buy(need().id, String(body.item)); return send(res, 200, { coins: store.coins(me!.id) }); }
    if (method === 'POST' && path === '/api/shop/equip') { store.equip(need().id, String(body.item)); return send(res, 200, { equipped: store.equipped(me!.id) }); }
    if (method === 'GET' && path === '/api/shop') return send(res, 200, { items: ITEMS });
    if (method === 'GET' && path === '/api/season') {
      const now = (opts.now ?? Date.now)();
      const out: any = { now, seasons: SEASONS, current: seasonAt(now)?.id ?? null };
      if (me) out.progress = Object.fromEntries(SEASONS.map((s) => [s.id, store.seasonProgress(me.id, s)]));
      return send(res, 200, out);
    }
    if (method === 'POST' && path === '/api/season/claim') { store.claimSeasonReward(need().id, String(body.season), String(body.reward)); return send(res, 200, { coins: store.coins(me!.id), inventory: store.inventory(me!.id) }); }
    if (method === 'GET' && path === '/api/games') return send(res, 200, { games: store.gamesOf(need().id) });
    const gm = path.match(/^\/api\/games\/([\w-]{1,60})$/);
    if (method === 'GET' && gm) { const g = store.gameFor(need().id, gm[1]); if (!g) throw new ApiError(404, '기록을 찾을 수 없습니다.'); return send(res, 200, g); }
    if (method === 'GET' && path === '/api/friends') {
      const f = store.friends(need().id);
      return send(res, 200, { ...f, friends: f.friends.map((x) => ({ name: x.name, online: mgr.isOnline(x.id) })), incoming: f.incoming.map((x) => x.name), outgoing: f.outgoing.map((x) => x.name), blocked: f.blocked.map((x) => x.name) });
    }
    const social: Record<string, (id: number) => void> = {
      '/api/friends/request': (id) => store.friendRequest(id, body.name), '/api/friends/accept': (id) => store.acceptFriend(id, body.name),
      '/api/friends/remove': (id) => store.removeFriend(id, body.name), '/api/block': (id) => store.block(id, body.name),
      '/api/unblock': (id) => store.unblock(id, body.name), '/api/report': (id) => store.report(id, body.name, body.reason, body.gameId),
    };
    if (method === 'POST' && social[path]) { social[path](need().id); return send(res, 200, { ok: true }); }
    const um = path.match(/^\/api\/user\/([^/]{1,40})$/);
    if (method === 'GET' && um) {
      const u = store.userByName(decodeURIComponent(um[1])); if (!u) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
      const mine = me?.id === u.id;
      return send(res, 200, { name: u.name, ratings: store.ratings(u.id), online: mgr.isOnline(u.id), games: u.is_public || mine ? store.gamesOf(u.id, 10).map((g) => ({ ...g, white_id: undefined, black_id: undefined })) : null });
    }
    throw new ApiError(404, '존재하지 않는 API입니다.');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (url.pathname === '/healthz') { res.writeHead(200, SEC).end('ok'); return; }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.message });
      console.error('api error', (e as Error).message); return send(res, 500, { error: '서버 오류가 발생했습니다.' });
    }
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

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048,
    verifyClient: ({ req }: { req: http.IncomingMessage }) => !req.headers.origin || (() => { try { return new URL(req.headers.origin!).host === req.headers.host; } catch { return false; } })() });
  wss.on('connection', (ws, req) => {
    const conn: Conn = { send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); } };
    const u = store.userBySession(parseCookies(req.headers.cookie)[COOKIE]);
    if (u) mgr.attach(conn, u.id, u.name);
    let count = 0; const reset = setInterval(() => { count = 0; }, 1000);
    ws.on('message', (data) => {
      if (++count > 20) return;
      let msg: ClientMsg;
      try { msg = JSON.parse(data.toString()); } catch { conn.send({ t: 'error', msg: '잘못된 요청입니다.' }); return; }
      try { mgr.handle(conn, msg); } catch (e) { console.error('handler error', (e as Error).message); conn.send({ t: 'error', msg: '서버 오류가 발생했습니다.' }); }
    });
    ws.on('close', () => { clearInterval(reset); mgr.disconnect(conn); });
    ws.on('error', () => ws.close());
  });
  return { server, mgr, store, tick() { mgr.tick(); store.finalizeSeasons(); } };
}
