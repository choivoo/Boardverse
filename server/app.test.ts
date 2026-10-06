import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { createApp, type App } from './app';
import { openStore } from './nodedb';
import type { ClientMsg, ServerMsg, RoomView } from '../src/protocol';

let app: App, base: string, port: number;
beforeAll(async () => { app = createApp(openStore(':memory:'), { dist: '/nonexistent' }); await new Promise<void>((r) => app.server.listen(0, r)); port = (app.server.address() as AddressInfo).port; base = `http://localhost:${port}`; });
afterAll(() => { app.server.close(); });

async function account(name: string) {
  const r = await fetch(`${base}/api/register`, { method: 'POST', body: JSON.stringify({ email: `${name}@x.com`, name, password: 'password1' }) });
  expect(r.status).toBe(200);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  expect(r.headers.get('set-cookie')).toMatch(/HttpOnly/);
  const call = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { cookie }, body: body ? JSON.stringify(body) : undefined }).then(async (x) => ({ status: x.status, json: await x.json().catch(() => null) as any }));
  return { name, cookie, call };
}
function ws(cookie?: string) {
  const s = new WebSocket(`ws://localhost:${port}/ws`, { headers: cookie ? { cookie } : {} });
  const msgs: ServerMsg[] = [];
  s.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const open = new Promise<void>((r) => s.on('open', () => r()));
  const send = (m: ClientMsg) => s.send(JSON.stringify(m));
  const until = async (pred: (m: ServerMsg) => boolean, ms = 2000) => { const t0 = Date.now(); for (;;) { const m = msgs.find(pred); if (m) return m; if (Date.now() - t0 > ms) throw new Error('timeout; got ' + JSON.stringify(msgs.slice(-3))); await new Promise((r) => setTimeout(r, 10)); } };
  const view = () => [...msgs].reverse().map((m) => ('view' in m ? m.view : null)).find(Boolean) as RoomView;
  return { s, open, send, until, view, msgs };
}
const ready = async (c: ReturnType<typeof ws>) => { await c.open; return c; };

describe('http api', () => {
  it('guest /api/me, protected routes need login, bad origin blocked', async () => {
    expect((await (await fetch(`${base}/api/me`)).json()).user).toBeNull();
    expect((await fetch(`${base}/api/friends`)).status).toBe(401);
    const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { origin: 'http://evil.example' }, body: '{}' });
    expect(bad.status).toBe(403);
    expect((await fetch(`${base}/api/healthz`)).status).toBe(404);
  });
  it('register/login/me/privacy/export/delete', async () => {
    const a = await account('hana');
    expect((await a.call('/api/me')).json.user.name).toBe('hana');
    const dup = await fetch(`${base}/api/register`, { method: 'POST', body: JSON.stringify({ email: 'hana@x.com', name: 'other', password: 'password1' }) });
    expect(dup.status).toBe(409);
    expect((await a.call('/api/me', 'PATCH', { public: false })).status).toBe(200);
    expect((await a.call('/api/me/export')).json.user.email).toBe('hana@x.com');
    expect((await a.call('/api/me', 'DELETE', { password: 'wrong' })).status).toBe(401);
    expect((await a.call('/api/me', 'DELETE', { password: 'password1' })).status).toBe(200);
    expect((await a.call('/api/me')).json.user).toBeNull() ;
  });
  it('shop rejects purchase without coins; leaderboard validates params', async () => {
    const a = await account('shopper');
    expect((await a.call('/api/shop/buy', 'POST', { item: 'board-ice' })).status).toBe(402);
    expect((await a.call('/api/shop/equip', 'POST', { item: 'board-night' })).status).toBe(403);
    expect((await a.call('/api/leaderboard?game=go')).status).toBe(400);
    expect((await a.call('/api/leaderboard?game=chess&limit=5')).json.rows).toEqual([]);
    expect((await a.call('/api/season')).json.current).not.toBeUndefined();
  });
});

describe('realtime with accounts', () => {
  it('rated matchmaking: both players are paired, game is rated once, ratings/leaderboard update, replay stored', async () => {
    const a = await account('ratera'), b = await account('raterb');
    const wa = await ready(ws(a.cookie)), wb = await ready(ws(b.cookie));
    wa.send({ t: 'queue', game: 'gomoku', name: 'x', rated: true }); await wa.until((m) => m.t === 'queued');
    wb.send({ t: 'queue', game: 'gomoku', name: 'x', rated: true });
    await wa.until((m) => m.t === 'joined'); await wb.until((m) => m.t === 'joined');
    const first = wa.view().you === 'w' ? wa : wb, second = first === wa ? wb : wa;
    expect(first.view().rated).toBe(true);
    for (let i = 0; i < 5; i++) {
      first.send({ t: 'move', n: i * 2, idx: i }); await second.until((m) => 'view' in m && m.view.n === i * 2 + 1 && m.view.n > 0 || false);
      if (i < 4) { second.send({ t: 'move', n: i * 2 + 1, idx: 15 * 5 + i }); await first.until((m) => 'view' in m && m.view.n === i * 2 + 2); }
    }
    await first.until((m) => 'view' in m && m.view.status === 'over' && !!m.view.result?.ratingDelta);
    const d = first.view().result!.ratingDelta!; expect(d.w).toBe(20); expect(d.b).toBe(-20);
    const winner = first === wa ? a : b;
    expect((await winner.call('/api/me')).json.ratings[0]).toMatchObject({ game: 'gomoku', rating: 1220 });
    const lb = (await winner.call('/api/leaderboard?game=gomoku')).json; expect(lb.rows[0].rating).toBe(1220); expect(lb.mine.rank).toBe(1);
    const hist = (await winner.call('/api/games')).json.games; expect(hist).toHaveLength(1);
    const full = (await winner.call('/api/games/' + hist[0].id)).json; expect(full.moves).toHaveLength(9);
    // rematch swaps colours and creates a fresh room
    const code = first.view().code;
    first.send({ t: 'rematch' }); second.send({ t: 'rematch' });
    await first.until((m) => 'view' in m && m.view.code !== code && m.view.status === 'playing');
    expect(first.view()).toMatchObject({ you: 'b', status: 'playing', rated: true });
    wa.s.close(); wb.s.close();
  });
  it('guests cannot create or join rated games or queue rated', async () => {
    const g = await ready(ws()); g.send({ t: 'create', game: 'chess', name: 'g', side: 'w', rated: true });
    expect(await g.until((m) => m.t === 'error')).toMatchObject({ msg: '평가 대국은 로그인이 필요합니다.' });
    const u = await account('rhost'); const h = await ready(ws(u.cookie)); h.send({ t: 'create', game: 'chess', name: 'x', side: 'w', rated: true });
    const code = ((await h.until((m) => m.t === 'joined')) as Extract<ServerMsg, { t: 'joined' }>).view.code;
    g.msgs.length = 0; g.send({ t: 'join', code, name: 'g' }); expect(await g.until((m) => m.t === 'error')).toMatchObject({ t: 'error' });
    g.send({ t: 'queue', game: 'chess', name: 'g', rated: true }); await g.until((m) => m.t === 'error' && g.msgs.length > 1);
    g.s.close(); h.s.close();
  });
  it('blocked users are not matched, and cannot join each other\'s rooms', async () => {
    const a = await account('blka'), b = await account('blkb');
    await a.call('/api/block', 'POST', { name: 'blkb' });
    const wa = await ready(ws(a.cookie)), wb = await ready(ws(b.cookie));
    wa.send({ t: 'queue', game: 'chess', name: 'a' }); await wa.until((m) => m.t === 'queued');
    wb.send({ t: 'queue', game: 'chess', name: 'b' }); await wb.until((m) => m.t === 'queued');
    await new Promise((r) => setTimeout(r, 100)); expect(wa.msgs.some((m) => m.t === 'joined')).toBe(false);
    wa.send({ t: 'unqueue' }); wb.send({ t: 'unqueue' });
    wa.send({ t: 'create', game: 'chess', name: 'a', side: 'w' }); const code = ((await wa.until((m) => m.t === 'joined')) as Extract<ServerMsg, { t: 'joined' }>).view.code;
    wb.send({ t: 'join', code, name: 'b' }); expect(await wb.until((m) => m.t === 'error' && m.msg.includes('입장할 수 없'))).toBeTruthy();
    wa.s.close(); wb.s.close();
  });
  it('friends: request/accept, presence, invite delivered only to accepted friends; draw offers', async () => {
    const a = await account('frienda'), b = await account('friendb'), c = await account('friendc');
    expect((await a.call('/api/friends/request', 'POST', { name: 'friendb' })).status).toBe(200);
    expect((await b.call('/api/friends')).json.incoming).toEqual(['frienda']);
    await b.call('/api/friends/accept', 'POST', { name: 'frienda' });
    const wa = await ready(ws(a.cookie)), wb = await ready(ws(b.cookie)), wc = await ready(ws(c.cookie));
    expect((await a.call('/api/friends')).json.friends).toEqual([{ name: 'friendb', online: true }]);
    wa.send({ t: 'create', game: 'chess', name: 'a', side: 'w' }); const code = ((await wa.until((m) => m.t === 'joined')) as Extract<ServerMsg, { t: 'joined' }>).view.code;
    wa.send({ t: 'invite', to: 'friendc' }); await wa.until((m) => m.t === 'error');
    wa.send({ t: 'invite', to: 'friendb' });
    expect(await wb.until((m) => m.t === 'invited')).toMatchObject({ from: 'frienda', code });
    expect(wc.msgs.some((m) => m.t === 'invited')).toBe(false);
    wb.send({ t: 'join', code, name: 'x' }); await wb.until((m) => m.t === 'joined');
    wa.send({ t: 'draw', action: 'offer' }); await wb.until((m) => 'view' in m && m.view.drawOffer === 'w');
    wb.send({ t: 'draw', action: 'accept' }); await wa.until((m) => 'view' in m && m.view.result?.reason === '합의 무승부');
    wa.send({ t: 'move', n: 0, from: 'e2', to: 'e4' }); await wa.until((m) => m.t === 'error' && m.msg.includes('진행 중'));
    for (const w of [wa, wb, wc]) w.s.close();
  });
});
