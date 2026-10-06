import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { RoomManager, type Conn, type Hooks } from './rooms';
import { Store, ApiError } from './store';
import { ITEMS } from '../src/catalog';
import { createMailer, type Mailer } from './mail';
import * as T from './tournaments';
import * as C from './clubs';
import { SEASONS, seasonAt } from '../src/seasons';
import type { ClientMsg, GameKind } from '../src/protocol';
import { ACTIVE_CATS, CATS } from '../src/ratingConfig';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" };
const COOKIE = 'bv_session';

export function makeHooks(store: Store, requireVerified = false): Hooks {
  return {
    blocked: (a, b) => store.isBlocked(a, b),
    canRate: (u) => !requireVerified || store.userRow(u)?.email_verified === 1,
    tournament: (tid, u) => T.eligibility(store, tid, u),
    rating: (u, g, c) => store.rating(u, g, c),
    isFriend: (a, b) => store.isFriend(a, b),
    userByName: (n) => { const u = store.userByName(n); return u ? { id: u.id } : undefined; },
    // Games between two guests are not stored at all (data minimisation).
    persist: (code, snap) => store.saveRoom(code, JSON.stringify(snap)),
    drop: (code) => store.dropRoom(code),
    alreadyRecorded: (id) => store.gameRecorded(id),
    heartbeat: (now) => store.setMeta('heartbeat', String(now)),
    record: (g) => (g.whiteId === null && g.blackId === null ? null : store.recordGame(g)),
  };
}

const parseCookies = (h: string | undefined) => Object.fromEntries((h ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v)]));
const isGame = (g: unknown): g is GameKind => g === 'chess' || g === 'gomoku';

export interface App { server: http.Server; mgr: RoomManager; store: Store; mailer: Mailer; tick(): void; close(): Promise<void> }

export function createApp(store: Store, opts: { dist: string; now?: () => number; mailer?: Mailer; env?: Record<string, string | undefined> }): App {
  const env = opts.env ?? process.env;
  const mailer = opts.mailer ?? createMailer(env);
  store.admins = new Set((env.ADMIN_EMAILS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const requireVerified = mailer.enabled && !mailer.dev; // real SMTP configured -> rated play needs a verified email
  const mgr = new RoomManager(opts.now ?? Date.now, makeHooks(store, requireVerified));
  const restored = mgr.restore(store.loadRooms(), store.getMeta('heartbeat') ? Number(store.getMeta('heartbeat')) : null);
  if (restored) console.log(`restored ${restored} unfinished room(s)`);
  const rate = new Map<string, number[]>();
  const limit = (key: string, max: number, ms: number) => { const t = Date.now(); const a = (rate.get(key) ?? []).filter((x) => t - x < ms); if (a.length >= max) throw new ApiError(429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'); a.push(t); rate.set(key, a); };
  const publicBase = env.PUBLIC_URL ?? '';
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
    const secure = req.headers['x-forwarded-proto'] === 'https' || env.COOKIE_SECURE === '1';
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const me = store.userBySession(token);
    const need = () => { if (!me) throw new ApiError(401, '로그인이 필요합니다.'); return me; };
    const method = req.method ?? 'GET', path = url.pathname;
    if (method !== 'GET' && !sameOrigin(req)) throw new ApiError(403, '허용되지 않은 출처입니다.');
    const body = method === 'GET' ? {} : await readJson(req);
    const ip = String(req.socket.remoteAddress);
    limit('api:' + ip, 600, 60_000); // coarse per-IP ceiling for every API call

    if (method === 'POST' && (path === '/api/register' || path === '/api/login')) {
      const f = loginFails.get(ip);
      if (f && f.n >= 10 && f.until > Date.now()) throw new ApiError(429, '시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
      let id: number;
      try { id = path === '/api/register' ? store.register(body.email, body.name, body.password) : store.login(body.email, body.password); }
      catch (e) { const c = loginFails.get(ip) ?? { n: 0, until: 0 }; loginFails.set(ip, { n: c.n + 1, until: Date.now() + 10 * 60_000 }); throw e; }
      loginFails.delete(ip);
      if (path === '/api/register' && mailer.enabled) void sendVerification(id).catch(() => { /* logged without secrets; the user can request another mail */ });
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
        const row = store.userRow(me.id)!;
        return send(res, 200, { user: { id: me.id, name: me.name, coins: store.coins(me.id), public: !!store.userByName(me.name)!.is_public, isAdmin: store.isAdmin(me.id), emailVerified: row.email_verified === 1, emailRequired: requireVerified },
          ratings: store.ratings(me.id), stats: store.stats(me.id), inventory: store.inventory(me.id), equipped: store.equipped(me.id) });
      }
      if (method === 'PATCH') { store.setPublic(need().id, !!body.public); return send(res, 200, { ok: true }); }
      if (method === 'DELETE') { store.deleteUser(need().id, body.password); return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }); }
    }
    if (method === 'GET' && path === '/api/me/export') return send(res, 200, store.exportUser(need().id), { 'Content-Disposition': 'attachment; filename="boardverse-export.json"' });
    if (method === 'GET' && path === '/api/leaderboard') {
      const game = url.searchParams.get('game'); if (!isGame(game)) throw new ApiError(400, '게임을 선택하세요.');
      const cat = url.searchParams.get('cat') ?? ACTIVE_CATS[game][0];
      if (!CATS[game].includes(cat)) throw new ApiError(400, '알 수 없는 분류입니다.');
      return send(res, 200, store.leaderboard(game, cat, Number(url.searchParams.get('offset') ?? 0) || 0, Number(url.searchParams.get('limit') ?? 20) || 20, me?.id));
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
      '/api/unblock': (id) => store.unblock(id, body.name), '/api/report': (id) => store.report(id, body.name, body.reason, body.gameId, body.room ? mgr.chatContextFor(id, body.room) ?? undefined : undefined),
    };
    if (method === 'POST' && social[path]) { social[path](need().id); return send(res, 200, { ok: true }); }
    const um = path.match(/^\/api\/user\/([^/]{1,40})$/);
    if (method === 'GET' && um) {
      const u = store.userByName(decodeURIComponent(um[1])); if (!u) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
      const mine = me?.id === u.id;
      return send(res, 200, { name: u.name, ratings: store.ratings(u.id), online: mgr.isOnline(u.id), games: u.is_public || mine ? store.gamesOf(u.id, 10).map((g) => ({ ...g, white_id: undefined, black_id: undefined })) : null });
    }

    // ---- config, email verification, password reset ----
    if (method === 'GET' && path === '/api/config') return send(res, 200, { email: mailer.enabled, emailDev: mailer.dev, emailRequiredForRated: requireVerified });
    if (method === 'GET' && path === '/api/dev/outbox' && mailer.dev) return send(res, 200, { outbox: mailer.outbox });
    if (method === 'POST' && path === '/api/email/send-verification') {
      const u = need(); if (!mailer.enabled) throw new ApiError(503, '이 서버에는 이메일 발송이 설정되어 있지 않습니다.');
      limit('ver:' + ip, 20, 3600_000);
      if (store.userRow(u.id)!.email_verified === 1) throw new ApiError(409, '이미 인증된 이메일입니다.');
      await sendVerification(u.id); return send(res, 200, { ok: true });
    }
    if (method === 'POST' && path === '/api/email/verify') { store.markVerified(store.consumeToken(body.token, 'verify')); return send(res, 200, { ok: true }); }
    if (method === 'POST' && path === '/api/password/forgot') {
      if (!mailer.enabled) throw new ApiError(503, '이 서버에는 이메일 발송이 설정되어 있지 않아 비밀번호 재설정을 사용할 수 없습니다.');
      limit('forgot:' + ip, 10, 3600_000);
      const u = store.userByEmail(body.email);
      if (u) {
        let t = '';
        try { t = store.createToken(u.id as number, 'reset', 3600_000); await mailer.send(u.email as string, '[Boardverse] 비밀번호 재설정', `아래 링크에서 1시간 안에 비밀번호를 재설정하세요(한 번만 사용 가능).\n${publicBase}/?reset=${t}\n\n요청하지 않았다면 무시하세요.`); }
        catch (e) { if (t) store.revokeToken(t); console.error(`reset mail failed: ${(e as Error).message}`); /* swallow: the response must not reveal whether the address exists */ }
      }
      return send(res, 200, { ok: true }); // identical response whether or not the address is registered
    }
    if (method === 'POST' && path === '/api/password/reset') {
      limit('reset:' + ip, 20, 3600_000);
      const pw = String(body.password ?? '');
      if (pw.length < 8 || pw.length > 128) throw new ApiError(400, '비밀번호는 8자 이상이어야 합니다.'); // validate BEFORE burning the one-time token
      const uid = store.consumeToken(body.token, 'reset'); store.setPassword(uid, pw);
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && path === '/api/password/change') {
      const u = need(); store.changePassword(u.id, body.old, body.password);
      const t = store.createSession(u.id); // all other sessions were invalidated
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure ? '; Secure' : ''}` });
    }

    // ---- admin: reports, audit, tournaments ----
    const admin = () => { const u = need(); if (!store.isAdmin(u.id)) throw new ApiError(403, '관리자 권한이 필요합니다.'); return u; };
    if (method === 'GET' && path === '/api/admin/reports') return send(res, 200, { reports: store.listReports(admin().id, url.searchParams.get('status') || undefined) });
    const rh = path.match(/^\/api\/admin\/reports\/(\d+)$/);
    if (method === 'POST' && rh) { store.handleReport(admin().id, Number(rh[1]), String(body.status), String(body.note ?? '')); return send(res, 200, { ok: true }); }
    if (method === 'GET' && path === '/api/admin/audit') { admin(); return send(res, 200, { log: store.auditLog() }); }
    if (method === 'POST' && path === '/api/admin/tournaments') return send(res, 200, { id: T.createTournament(store, admin().id, body) });

    // ---- tournaments ----
    if (method === 'GET' && path === '/api/tournaments') return send(res, 200, { tournaments: T.listTournaments(store, me?.id) });
    const tm = path.match(/^\/api\/tournaments\/(\d+)(?:\/(join|leave))?$/);
    if (tm) {
      const tid = Number(tm[1]);
      if (method === 'GET' && !tm[2]) return send(res, 200, T.standings(store, tid));
      if (method === 'POST' && tm[2] === 'join') { const u = need(); if (requireVerified && store.userRow(u.id)!.email_verified !== 1) throw new ApiError(403, '이메일 인증 후 참가할 수 있습니다.'); T.joinTournament(store, u.id, tid); return send(res, 200, { ok: true }); }
      if (method === 'POST' && tm[2] === 'leave') { T.leaveTournament(store, need().id, tid); return send(res, 200, { ok: true }); }
    }

    // ---- clubs ----
    if (method === 'GET' && path === '/api/clubs') return send(res, 200, { clubs: C.searchClubs(store, url.searchParams.get('q') ?? '', me?.id) });
    if (method === 'GET' && path === '/api/clubs/mine') return send(res, 200, { clubs: C.myClubList(store, need().id) });
    if (method === 'POST' && path === '/api/clubs') { limit('club:' + need().id, 5, 3600_000); return send(res, 200, { id: C.createClub(store, me!.id, body.name, body.about, body.public !== false) }); }
    const cm = path.match(/^\/api\/clubs\/(\d+)(?:\/([a-z]+))?$/);
    if (cm) {
      const cid = Number(cm[1]), act = cm[2];
      if (method === 'GET' && !act) return send(res, 200, C.getClub(store, cid, me?.id));
      const u = need();
      const ok = () => send(res, 200, { ok: true });
      if (method === 'POST') {
        switch (act) {
          case 'join': return send(res, 200, { status: C.joinClub(store, u.id, cid) });
          case 'leave': C.leaveClub(store, u.id, cid); return ok();
          case 'accept': C.decideRequest(store, u.id, cid, body.name, true); return ok();
          case 'reject': C.decideRequest(store, u.id, cid, body.name, false); return ok();
          case 'invite': C.inviteToClub(store, u.id, cid, body.name); return ok();
          case 'answer': C.answerInvite(store, u.id, cid, !!body.accept); return ok();
          case 'kick': C.kickMember(store, u.id, cid, body.name); return ok();
          case 'role': C.setRole(store, u.id, cid, body.name, body.role); return ok();
          case 'update': C.updateClub(store, u.id, cid, body); return ok();
          case 'report': { const owner = C.clubOwner(store, cid); if (!owner) throw new ApiError(404, '클럽을 찾을 수 없습니다.'); store.report(u.id, owner, body.reason, undefined, `club:${cid}`, 'club'); return ok(); }
        }
      }
      if (method === 'DELETE' && !act) { C.deleteClub(store, u.id, cid); return ok(); }
    }

    // ---- live games ----
    if (method === 'GET' && path === '/api/live') return send(res, 200, { games: mgr.live() });
    throw new ApiError(404, '존재하지 않는 API입니다.');
  }

  async function sendVerification(userId: number) {
    const u = store.userRow(userId)!;
    const t = store.createToken(userId, 'verify', 24 * 3600_000);
    try { await mailer.send(u.email as string, '[Boardverse] 이메일 인증', `아래 링크를 열어 이메일을 인증하세요(24시간, 한 번만 사용 가능).\n${publicBase}/?verify=${t}`); }
    catch (e) { store.revokeToken(t); console.error(`verification mail failed: ${(e as Error).message}`); throw new ApiError(502, '메일을 보내지 못했습니다. 잠시 후 다시 시도하세요.'); } // nothing is left behind that could be used or counted
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.headers['x-forwarded-proto'] === 'https' || env.COOKIE_SECURE === '1') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (url.pathname === '/healthz') { try { store.get('SELECT 1'); res.writeHead(200, SEC).end('ok'); } catch { res.writeHead(503).end('db'); } return; }
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
    // dead-connection detection: ping every 15 s, drop sockets that did not answer the previous ping (so forfeit/disconnect logic stays accurate)
    let alive = true; ws.on('pong', () => { alive = true; });
    const beat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; try { ws.ping(); } catch { /* closing */ } }, 15_000); beat.unref();
    ws.on('message', (data) => {
      if (++count > 20) return;
      let msg: ClientMsg;
      try { msg = JSON.parse(data.toString()); } catch { conn.send({ t: 'error', msg: '잘못된 요청입니다.' }); return; }
      try { mgr.handle(conn, msg); } catch (e) { console.error('handler error', (e as Error).message); conn.send({ t: 'error', msg: '서버 오류가 발생했습니다.' }); }
    });
    ws.on('close', () => { clearInterval(reset); clearInterval(beat); mgr.disconnect(conn); });
    ws.on('error', () => ws.close());
  });
  return {
    server, mgr, store, mailer,
    tick() { mgr.tick(); store.finalizeSeasons(); T.finalizeTournaments(store); },
    async close() {
      store.setMeta('heartbeat', String((opts.now ?? Date.now)())); // clean shutdown: downtime counts from here
      for (const c of wss.clients) c.close(1001, 'server shutting down');
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
      store.db.close();
    },
  };
}
