import { timingSafeEqual } from 'node:crypto';
import { RoomManager, type Conn, type Hooks } from './rooms';
import { ApiError, type Store } from './store';
import { ITEMS } from '../src/catalog';
import { createMailer, type Mailer } from './mail';
import * as T from './tournaments';
import * as C from './clubs';
import { SEASONS, seasonAt } from '../src/seasons';
import type { ClientMsg, GameKind, ServerMsg } from '../src/protocol';
import { ACTIVE_CATS, CATS } from '../src/ratingConfig';

/** Runtime-independent application core: used by the Node server (server/app.ts) and the Cloudflare Durable Object (worker/index.ts). */
export const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" };
const COOKIE = 'bv_session';
export type Env = Record<string, string | undefined>;
export interface ApiReq { method: string; path: string; query: URLSearchParams; /** lower-case header names */ headers: Record<string, string | undefined>; ip: string; body: string }
export interface ApiRes { status: number; headers: Record<string, string>; body: string }
export const originOk = (origin: string | undefined | null, host: string | undefined | null) => { if (!origin) return true; try { return new URL(origin).host === host; } catch { return false; } };

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

export function createCore(store: Store, opts: { now?: () => number; mailer?: Mailer; env?: Env }) {
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

  const send = (status: number, body: unknown, headers: Record<string, string> = {}): ApiRes =>
    ({ status, headers: { ...SEC, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(body) });
  const parseBody = (raw: string): any => { if (raw.length > 4096) throw new ApiError(413, '요청이 너무 큽니다.'); if (!raw) return {}; try { return JSON.parse(raw); } catch { throw new ApiError(400, '잘못된 JSON입니다.'); } };
  const sameOrigin = (req: ApiReq) => originOk(req.headers.origin, req.headers.host);

  async function api(req: ApiReq): Promise<ApiRes> {
    const url = { pathname: req.path, searchParams: req.query };
    const secure = req.headers['x-forwarded-proto'] === 'https' || env.COOKIE_SECURE === '1';
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const me = store.userBySession(token);
    const need = () => { if (!me) throw new ApiError(401, '로그인이 필요합니다.'); return me; };
    const method = req.method, path = url.pathname;
    if (method !== 'GET' && !sameOrigin(req)) throw new ApiError(403, '허용되지 않은 출처입니다.');
    const body = method === 'GET' ? {} : parseBody(req.body);
    const ip = req.ip;
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
      return send(200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure ? '; Secure' : ''}` });
    }
    if (method === 'POST' && path === '/api/logout') {
      if (token) store.endSession(token);
      return send(200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
    }
    if (path === '/api/me') {
      if (method === 'GET') {
        if (!me) return send(200, { user: null });
        const row = store.userRow(me.id)!;
        return send(200, { user: { id: me.id, name: me.name, coins: store.coins(me.id), public: !!store.userByName(me.name)!.is_public, isAdmin: store.isAdmin(me.id), emailVerified: row.email_verified === 1, emailRequired: requireVerified },
          ratings: store.ratings(me.id), stats: store.stats(me.id), inventory: store.inventory(me.id), equipped: store.equipped(me.id) });
      }
      if (method === 'PATCH') { store.setPublic(need().id, !!body.public); return send(200, { ok: true }); }
      if (method === 'DELETE') { store.deleteUser(need().id, body.password); return send(200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }); }
    }
    if (method === 'GET' && path === '/api/me/export') return send(200, store.exportUser(need().id), { 'Content-Disposition': 'attachment; filename="boardverse-export.json"' });
    if (method === 'GET' && path === '/api/leaderboard') {
      const game = url.searchParams.get('game'); if (!isGame(game)) throw new ApiError(400, '게임을 선택하세요.');
      const cat = url.searchParams.get('cat') ?? ACTIVE_CATS[game][0];
      if (!CATS[game].includes(cat)) throw new ApiError(400, '알 수 없는 분류입니다.');
      return send(200, store.leaderboard(game, cat, Number(url.searchParams.get('offset') ?? 0) || 0, Number(url.searchParams.get('limit') ?? 20) || 20, me?.id));
    }
    if (method === 'POST' && path === '/api/shop/buy') { store.buy(need().id, String(body.item)); return send(200, { coins: store.coins(me!.id) }); }
    if (method === 'POST' && path === '/api/shop/equip') { store.equip(need().id, String(body.item)); return send(200, { equipped: store.equipped(me!.id) }); }
    if (method === 'GET' && path === '/api/shop') return send(200, { items: ITEMS });
    if (method === 'GET' && path === '/api/season') {
      const now = (opts.now ?? Date.now)();
      const out: any = { now, seasons: SEASONS, current: seasonAt(now)?.id ?? null };
      if (me) out.progress = Object.fromEntries(SEASONS.map((s) => [s.id, store.seasonProgress(me.id, s)]));
      return send(200, out);
    }
    if (method === 'POST' && path === '/api/season/claim') { store.claimSeasonReward(need().id, String(body.season), String(body.reward)); return send(200, { coins: store.coins(me!.id), inventory: store.inventory(me!.id) }); }
    if (method === 'GET' && path === '/api/games') return send(200, { games: store.gamesOf(need().id) });
    const gm = path.match(/^\/api\/games\/([\w-]{1,60})$/);
    if (method === 'GET' && gm) { const g = store.gameFor(need().id, gm[1]); if (!g) throw new ApiError(404, '기록을 찾을 수 없습니다.'); return send(200, g); }
    if (method === 'GET' && path === '/api/friends') {
      const f = store.friends(need().id);
      return send(200, { ...f, friends: f.friends.map((x) => ({ name: x.name, online: mgr.isOnline(x.id) })), incoming: f.incoming.map((x) => x.name), outgoing: f.outgoing.map((x) => x.name), blocked: f.blocked.map((x) => x.name) });
    }
    const social: Record<string, (id: number) => void> = {
      '/api/friends/request': (id) => store.friendRequest(id, body.name), '/api/friends/accept': (id) => store.acceptFriend(id, body.name),
      '/api/friends/remove': (id) => store.removeFriend(id, body.name), '/api/block': (id) => store.block(id, body.name),
      '/api/unblock': (id) => store.unblock(id, body.name), '/api/report': (id) => store.report(id, body.name, body.reason, body.gameId, body.room ? mgr.chatContextFor(id, body.room) ?? undefined : undefined),
    };
    if (method === 'POST' && social[path]) { social[path](need().id); return send(200, { ok: true }); }
    const um = path.match(/^\/api\/user\/([^/]{1,40})$/);
    if (method === 'GET' && um) {
      const u = store.userByName(decodeURIComponent(um[1])); if (!u) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
      const mine = me?.id === u.id;
      return send(200, { name: u.name, ratings: store.ratings(u.id), online: mgr.isOnline(u.id), games: u.is_public || mine ? store.gamesOf(u.id, 10).map((g) => ({ ...g, white_id: undefined, black_id: undefined })) : null });
    }

    // ---- config, email verification, password reset ----
    if (method === 'GET' && path === '/api/config') return send(200, { email: mailer.enabled, emailDev: mailer.dev, emailRequiredForRated: requireVerified });
    if (method === 'GET' && path === '/api/dev/outbox' && mailer.dev) return send(200, { outbox: mailer.outbox });
    if (method === 'POST' && path === '/api/email/send-verification') {
      const u = need(); if (!mailer.enabled) throw new ApiError(503, '이 서버에는 이메일 발송이 설정되어 있지 않습니다.');
      limit('ver:' + ip, 20, 3600_000);
      if (store.userRow(u.id)!.email_verified === 1) throw new ApiError(409, '이미 인증된 이메일입니다.');
      await sendVerification(u.id); return send(200, { ok: true });
    }
    if (method === 'POST' && path === '/api/email/verify') { store.markVerified(store.consumeToken(body.token, 'verify')); return send(200, { ok: true }); }
    if (method === 'POST' && path === '/api/password/forgot') {
      if (!mailer.enabled) throw new ApiError(503, '이 서버에는 이메일 발송이 설정되어 있지 않아 비밀번호 재설정을 사용할 수 없습니다.');
      limit('forgot:' + ip, 10, 3600_000);
      const u = store.userByEmail(body.email);
      if (u) {
        let t = '';
        try { t = store.createToken(u.id as number, 'reset', 3600_000); await mailer.send(u.email as string, '[Boardverse] 비밀번호 재설정', `아래 링크에서 1시간 안에 비밀번호를 재설정하세요(한 번만 사용 가능).\n${publicBase}/?reset=${t}\n\n요청하지 않았다면 무시하세요.`); }
        catch (e) { if (t) store.revokeToken(t); console.error(`reset mail failed: ${(e as Error).message}`); /* swallow: the response must not reveal whether the address exists */ }
      }
      return send(200, { ok: true }); // identical response whether or not the address is registered
    }
    if (method === 'POST' && path === '/api/password/reset') {
      limit('reset:' + ip, 20, 3600_000);
      const pw = String(body.password ?? '');
      if (pw.length < 8 || pw.length > 128) throw new ApiError(400, '비밀번호는 8자 이상이어야 합니다.'); // validate BEFORE burning the one-time token
      const uid = store.consumeToken(body.token, 'reset'); store.setPassword(uid, pw);
      return send(200, { ok: true });
    }
    if (method === 'POST' && path === '/api/password/change') {
      const u = need(); store.changePassword(u.id, body.old, body.password);
      const t = store.createSession(u.id); // all other sessions were invalidated
      return send(200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure ? '; Secure' : ''}` });
    }

    // ---- admin: reports, audit, tournaments ----
    const admin = () => { const u = need(); if (!store.isAdmin(u.id)) throw new ApiError(403, '관리자 권한이 필요합니다.'); return u; };
    if (method === 'GET' && path === '/api/admin/reports') return send(200, { reports: store.listReports(admin().id, url.searchParams.get('status') || undefined) });
    const rh = path.match(/^\/api\/admin\/reports\/(\d+)$/);
    if (method === 'POST' && rh) { store.handleReport(admin().id, Number(rh[1]), String(body.status), String(body.note ?? '')); return send(200, { ok: true }); }
    if (method === 'GET' && path === '/api/admin/audit') { admin(); return send(200, { log: store.auditLog() }); }
    if (method === 'POST' && path === '/api/admin/tournaments') return send(200, { id: T.createTournament(store, admin().id, body) });

    // ---- tournaments ----
    if (method === 'GET' && path === '/api/tournaments') return send(200, { tournaments: T.listTournaments(store, me?.id) });
    const tm = path.match(/^\/api\/tournaments\/(\d+)(?:\/(join|leave))?$/);
    if (tm) {
      const tid = Number(tm[1]);
      if (method === 'GET' && !tm[2]) return send(200, T.standings(store, tid));
      if (method === 'POST' && tm[2] === 'join') { const u = need(); if (requireVerified && store.userRow(u.id)!.email_verified !== 1) throw new ApiError(403, '이메일 인증 후 참가할 수 있습니다.'); T.joinTournament(store, u.id, tid); return send(200, { ok: true }); }
      if (method === 'POST' && tm[2] === 'leave') { T.leaveTournament(store, need().id, tid); return send(200, { ok: true }); }
    }

    // ---- clubs ----
    if (method === 'GET' && path === '/api/clubs') return send(200, { clubs: C.searchClubs(store, url.searchParams.get('q') ?? '', me?.id) });
    if (method === 'GET' && path === '/api/clubs/mine') return send(200, { clubs: C.myClubList(store, need().id) });
    if (method === 'POST' && path === '/api/clubs') { limit('club:' + need().id, 5, 3600_000); return send(200, { id: C.createClub(store, me!.id, body.name, body.about, body.public !== false) }); }
    const cm = path.match(/^\/api\/clubs\/(\d+)(?:\/([a-z]+))?$/);
    if (cm) {
      const cid = Number(cm[1]), act = cm[2];
      if (method === 'GET' && !act) return send(200, C.getClub(store, cid, me?.id));
      const u = need();
      const ok = () => send(200, { ok: true });
      if (method === 'POST') {
        switch (act) {
          case 'join': return send(200, { status: C.joinClub(store, u.id, cid) });
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

    // ---- operator (no SMTP / no DB shell, e.g. Cloudflare): mark an email as verified using a deployment secret ----
    if (method === 'POST' && path === '/api/operator/verify-email') {
      const secret = env.OPERATOR_TOKEN ?? '';
      if (secret.length < 24) throw new ApiError(404, '존재하지 않는 API입니다.'); // disabled unless a long secret is configured
      limit('op:' + ip, 10, 60_000);
      const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')), want = Buffer.from(secret);
      if (given.length !== want.length || !timingSafeEqual(given, want)) throw new ApiError(401, '인증에 실패했습니다.');
      const u = store.userByEmail(body.email); if (!u) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
      store.markVerified(u.id as number); store.audit(null, 'operator_verify_email', String(u.id));
      return send(200, { ok: true });
    }

    // ---- live games ----
    if (method === 'GET' && path === '/api/live') return send(200, { games: mgr.live() });
    throw new ApiError(404, '존재하지 않는 API입니다.');
  }

  async function sendVerification(userId: number) {
    const u = store.userRow(userId)!;
    const t = store.createToken(userId, 'verify', 24 * 3600_000);
    try { await mailer.send(u.email as string, '[Boardverse] 이메일 인증', `아래 링크를 열어 이메일을 인증하세요(24시간, 한 번만 사용 가능).\n${publicBase}/?verify=${t}`); }
    catch (e) { store.revokeToken(t); console.error(`verification mail failed: ${(e as Error).message}`); throw new ApiError(502, '메일을 보내지 못했습니다. 잠시 후 다시 시도하세요.'); } // nothing is left behind that could be used or counted
  }

  /** One request in, one response out (health + API). Never throws. */
  async function handle(req: ApiReq): Promise<ApiRes> {
    const hsts: Record<string, string> = req.headers['x-forwarded-proto'] === 'https' || env.COOKIE_SECURE === '1' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {};
    try {
      if (req.path === '/healthz') { try { store.get('SELECT 1'); return { status: 200, headers: { ...SEC, ...hsts }, body: 'ok' }; } catch { return { status: 503, headers: { ...SEC }, body: 'db' }; } }
      if (req.path.startsWith('/api/')) { const r = await api(req); return { ...r, headers: { ...r.headers, ...hsts } }; }
      return send(404, { error: 'not found' }, hsts);
    } catch (e) {
      if (e instanceof ApiError) return send(e.status, { error: e.message }, hsts);
      console.error('api error', (e as Error).message); return send(500, { error: '서버 오류가 발생했습니다.' }, hsts);
    }
  }

  /** A new realtime connection. `cookie` is the raw Cookie header (identifies the account). */
  function connect(cookie: string | undefined, sendMsg: (m: ServerMsg) => void) {
    const conn: Conn = { send: sendMsg };
    const u = store.userBySession(parseCookies(cookie)[COOKIE]);
    if (u) mgr.attach(conn, u.id, u.name);
    let count = 0, windowStart = Date.now();
    return {
      message(data: string) {
        const t = Date.now(); if (t - windowStart >= 1000) { windowStart = t; count = 0; }
        if (++count > 20) return; // flood protection: at most 20 messages per second
        let msg: ClientMsg;
        try { msg = JSON.parse(data); } catch { conn.send({ t: 'error', msg: '잘못된 요청입니다.' }); return; }
        try { mgr.handle(conn, msg); } catch (e) { console.error('handler error', (e as Error).message); conn.send({ t: 'error', msg: '서버 오류가 발생했습니다.' }); }
      },
      close() { mgr.disconnect(conn); },
    };
  }

  return {
    mgr, store, mailer, handle, connect,
    tick() { mgr.tick(); store.finalizeSeasons(); T.finalizeTournaments(store); },
    /** clean shutdown marker: downtime is counted from here */
    markShutdown() { store.setMeta('heartbeat', String((opts.now ?? Date.now)())); },
  };
}
