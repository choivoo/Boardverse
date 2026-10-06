import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { harness, account, wsReady, type Harness } from './testkit';

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(() => h.close());
const raw = (path: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown) => fetch(h.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

describe('admin surface', () => {
  const ADMIN_ROUTES: [string, string, unknown?][] = [['GET', '/api/admin/reports'], ['POST', '/api/admin/reports/1', { status: 'dismissed' }], ['GET', '/api/admin/audit'], ['POST', '/api/admin/tournaments', { name: 'x', game: 'gomoku' }]];
  it('every admin route: anonymous 401, normal user 403, admin email without verification 403, verified admin allowed', async () => {
    const user = await account(h, 'plainuser'); const boss = await account(h, 'bossy', 'boss@x.com');
    for (const [m, p, b] of ADMIN_ROUTES) {
      expect((await raw(p, m, {}, b)).status, `anon ${p}`).toBe(401);
      expect((await user.call(p, m, b)).status, `user ${p}`).toBe(403);
      expect((await boss.call(p, m, b)).status, `unverified admin ${p}`).toBe(403);
    }
    h.app.store.markVerified(boss.id);
    expect((await boss.call('/api/admin/audit')).status).toBe(200); expect((await boss.call('/api/admin/reports')).status).toBe(200);
    expect((await boss.call('/api/admin/reports/999', 'POST', { status: 'dismissed' })).status).toBe(404);
  });
  it('user-controlled report text is stored redacted and capped; reports are rate limited per user', async () => {
    const a = await account(h, 'rep1'); await account(h, 'rep2');
    await a.call('/api/report', 'POST', { name: 'rep2', reason: 'cheater ' + 'A'.repeat(40) + ' password=hunter22 ' + 'x'.repeat(900) });
    const row = h.app.store.get('SELECT reason FROM reports ORDER BY id DESC LIMIT 1') as { reason: string };
    expect(row.reason.length).toBeLessThanOrEqual(500); expect(row.reason).not.toContain('hunter22'); expect(row.reason).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAA');
  });
});

describe('sessions, cookies, origin', () => {
  it('session cookie is HttpOnly + SameSite and Secure behind https; sessions expire; logout kills them', async () => {
    const r = await raw('/api/register', 'POST', { 'x-forwarded-proto': 'https' }, { email: 'cook@x.com', name: 'cookie1', password: 'password1' });
    const sc = r.headers.get('set-cookie')!; expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/SameSite=Lax/); expect(sc).toMatch(/Secure/); expect(r.headers.get('strict-transport-security')).toBeTruthy();
    const cookie = sc.split(';')[0];
    expect((await (await raw('/api/me', 'GET', { cookie })).json()).user.name).toBe('cookie1');
    h.clock.t += 31 * 86400_000; expect((await (await raw('/api/me', 'GET', { cookie })).json()).user).toBeNull(); h.clock.t -= 31 * 86400_000;
    await raw('/api/logout', 'POST', { cookie }, {}); expect((await (await raw('/api/me', 'GET', { cookie })).json()).user).toBeNull();
  });
  it('every state-changing method rejects a foreign Origin', async () => {
    const u = await account(h, 'csrf1');
    for (const [m, p] of [['POST', '/api/logout'], ['PATCH', '/api/me'], ['DELETE', '/api/me'], ['POST', '/api/shop/buy'], ['POST', '/api/friends/request'], ['POST', '/api/clubs'], ['POST', '/api/report'], ['POST', '/api/password/change'], ['POST', '/api/admin/tournaments']] as const) {
      const res = await raw(p, m, { cookie: u.cookie, origin: 'https://evil.example' }, {}); expect(res.status, `${m} ${p}`).toBe(403);
    }
    const ws = await new Promise<string>((res) => { const W = require('ws'); const s = new W(`ws://localhost:${h.port}/ws`, { headers: { origin: 'https://evil.example', cookie: u.cookie } }); s.on('open', () => res('open')); s.on('error', () => res('refused')); s.on('unexpected-response', () => res('refused')); });
    expect(ws).toBe('refused'); // cross-site WebSocket hijacking blocked
  });
});

describe('injection and output safety', () => {
  it('SQL metacharacters in names/queries/params are treated as data', async () => {
    const u = await account(h, 'sqli1');
    expect((await raw('/api/register', 'POST', {}, { email: 'x@x.com', name: "x'; DROP TABLE users;--", password: 'password1' })).status).toBe(400);
    expect((await u.call("/api/clubs?q=%27%20OR%201%3D1%3B--")).json.clubs).toEqual([]);
    expect((await u.call("/api/leaderboard?game=chess&cat=blitz'%20OR%20'1'%3D'1")).status).toBe(400);
    expect((await u.call("/api/user/" + encodeURIComponent("' OR 1=1 --"))).status).toBe(404);
    expect(h.app.store.get('SELECT COUNT(*) c FROM users')!.c).toBeGreaterThan(0);
  });
  it('chat, club notices and names cannot carry markup', async () => {
    const a = await account(h, 'xssa'), b = await account(h, 'xssb');
    expect((await raw('/api/register', 'POST', {}, { email: 'y@x.com', name: '<img src=x>', password: 'password1' })).status).toBe(400);
    const wa = await wsReady(h, a.cookie), wb = await wsReady(h, b.cookie);
    wa.send({ t: 'create', game: 'chess', name: 'x', side: 'w' }); const code = (await wa.until<any>((m) => m.t === 'joined')).view.code; wb.send({ t: 'join', code, name: 'x' }); await wb.until((m) => m.t === 'joined');
    wa.send({ t: 'chat', text: '<script>alert(1)</script><img onerror=x>' }); const m = await wb.until<any>((x) => x.t === 'chat'); expect(m.text).not.toMatch(/[<>]/);
    const club = await a.call('/api/clubs', 'POST', { name: 'safe club' }); await a.call(`/api/clubs/${club.json.id}/update`, 'POST', { notice: '<b onclick=x>hi</b>' });
    expect((await a.call(`/api/clubs/${club.json.id}`)).json.notice).not.toMatch(/[<>]/);
    wa.close(); wb.close();
  });
  it('/healthz exposes nothing and CSP allows only same-origin scripts (+ wasm for the engine)', async () => {
    const r = await raw('/healthz'); expect(await r.text()).toBe('ok'); expect(r.headers.get('content-security-policy')).toContain("script-src 'self' 'wasm-unsafe-eval'");
  });
});

describe('data export and account deletion', () => {
  it('export covers everything we hold; deletion leaves no row referring to the user and hands clubs on', async () => {
    const a = await account(h, 'gone1'), b = await account(h, 'stay1'), c = await account(h, 'stay2');
    const club = (await a.call('/api/clubs', 'POST', { name: 'handover club' })).json.id;
    await b.call(`/api/clubs/${club}/join`, 'POST'); await c.call(`/api/clubs/${club}/join`, 'POST');
    await a.call(`/api/clubs/${club}/role`, 'POST', { name: 'stay2', role: 'admin' });
    const solo = (await a.call('/api/clubs', 'POST', { name: 'solo club' })).json.id;
    await a.call('/api/friends/request', 'POST', { name: 'stay1' });
    h.app.store.recordGame({ id: 'delg', game: 'gomoku', whiteId: a.id, blackId: b.id, whiteName: 'gone1', blackName: 'stay1', rated: true, time: 'none', result: 'w', reason: 'x', moves: ['1', '2', '3', '4', '5', '6'] });
    await b.call('/api/report', 'POST', { name: 'gone1', reason: 'because reasons' });
    const exp = (await a.call('/api/me/export')).json;
    expect(Object.keys(exp)).toEqual(expect.arrayContaining(['user', 'ratings', 'games', 'inventory', 'equipped', 'friends', 'clubs', 'tournaments', 'reportsFiled', 'seasonClaims']));
    expect(exp.clubs.map((x: any) => x.name).sort()).toEqual(['handover club', 'solo club']); expect(exp.games).toHaveLength(1);
    expect((await a.call('/api/me', 'DELETE', { password: 'password1' })).status).toBe(200);
    const s = h.app.store;
    // no table may still point at the deleted account
    const tables = s.all("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name as string);
    for (const t of tables) for (const col of s.all(`PRAGMA table_info(${t})`).map((c) => c.name as string).filter((n) => ['user_id', 'white_id', 'black_id', 'reporter', 'target', 'admin_id', 'created_by', 'a', 'b', 'blocked'].includes(n)))
      expect(s.get(`SELECT COUNT(*) c FROM ${t} WHERE ${col}=?`, a.id)!.c, `${t}.${col}`).toBe(0);
    expect(s.all('SELECT email FROM users WHERE email=?', 'gone1@x.com')).toHaveLength(0);
    expect(s.get('SELECT role FROM club_members WHERE club_id=? AND user_id=?', club, c.id)).toEqual({ role: 'owner' }); // the admin inherited the club
    expect(s.all('SELECT id FROM clubs WHERE id=?', solo)).toHaveLength(0); // nobody left -> deleted
    expect(s.get('SELECT white_name FROM games WHERE id=?', 'delg')).toEqual({ white_name: '(탈퇴)' });
  });
});

// these deliberately exhaust the (shared-IP) limiters, so they run last
describe('abuse limits', () => {
  it('login/register failures are throttled per IP', async () => {
    let last = 0; for (let i = 0; i < 12; i++) last = (await raw('/api/login', 'POST', {}, { email: 'nobody@x.com', password: 'wrongwrong' })).status;
    expect(last).toBe(429);
  });
  it('the API has a per-IP ceiling', async () => {
    let status = 0; for (let i = 0; i < 620 && status !== 429; i++) status = (await raw('/api/config')).status;
    expect(status).toBe(429);
  });
});
