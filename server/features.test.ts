import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { harness, account, wsReady, type Harness } from './testkit';
import { createMailer } from './mail';
import type { ServerMsg } from '../src/protocol';

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(() => h.close());
const joined = (m: ServerMsg) => m.t === 'joined';

describe('email verification & password reset (dev outbox)', () => {
  it('verification token is one-time; wrong/expired tokens are rejected', async () => {
    const u = await account(h, 'verif1');
    const mail = h.app.mailer.outbox.find((m) => m.to === 'verif1@x.com')!;
    const token = mail.text.match(/verify=([\w-]+)/)![1];
    expect((await u.call('/api/me')).json.user.emailVerified).toBe(false);
    expect((await u.call('/api/email/verify', 'POST', { token: 'bogus' })).status).toBe(400);
    expect((await u.call('/api/email/verify', 'POST', { token })).status).toBe(200);
    expect((await u.call('/api/me')).json.user.emailVerified).toBe(true);
    expect((await u.call('/api/email/verify', 'POST', { token })).status).toBe(400); // reuse
    const raw = h.app.store.createToken(u.id, 'verify', 1000); h.clock.t += 2000;
    expect(() => h.app.store.consumeToken(raw, 'verify')).toThrow(); h.clock.t -= 2000;
    expect(JSON.stringify(h.app.store.all('SELECT hash FROM tokens'))).not.toContain(token); // only hashes stored
  });
  it('forgot-password reveals nothing, reset works once, kills old sessions, rate limited', async () => {
    const u = await account(h, 'resetme');
    const known = await fetch(`${h.base}/api/password/forgot`, { method: 'POST', body: JSON.stringify({ email: 'resetme@x.com' }) });
    const unknown = await fetch(`${h.base}/api/password/forgot`, { method: 'POST', body: JSON.stringify({ email: 'nobody@x.com' }) });
    expect([known.status, await known.json()]).toEqual([unknown.status, await unknown.json()]);
    expect(h.app.mailer.outbox.filter((m) => m.to === 'nobody@x.com')).toHaveLength(0);
    const token = h.app.mailer.outbox.filter((m) => m.to === 'resetme@x.com' && m.subject.includes('재설정')).at(-1)!.text.match(/reset=([\w-]+)/)![1];
    expect((await u.call('/api/password/reset', 'POST', { token, password: 'short' })).status).toBe(400);
    expect((await u.call('/api/password/reset', 'POST', { token, password: 'newpassword9' })).status).toBe(200);
    expect((await u.call('/api/password/reset', 'POST', { token, password: 'again12345' })).status).toBe(400); // one-time
    expect((await u.call('/api/me')).json.user).toBeNull(); // old session invalidated
    expect(h.app.store.login('resetme@x.com', 'newpassword9')).toBe(u.id);
    expect(() => h.app.store.login('resetme@x.com', 'password1')).toThrow();
    let made = 0; try { for (;;) { h.app.store.createToken(u.id, 'reset', 1000); made++; } } catch (e) { expect((e as Error).message).toMatch(/너무 많/); }
    expect(made).toBeLessThan(3); // at most 3 reset tokens per hour in total (1 already issued by forgot-password)
  });
  it('change password keeps the current device logged in but drops others', async () => {
    const u = await account(h, 'chgpw'); const other = await fetch(`${h.base}/api/login`, { method: 'POST', body: JSON.stringify({ email: 'chgpw@x.com', password: 'password1' }) });
    const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
    const r = await fetch(`${h.base}/api/password/change`, { method: 'POST', headers: { cookie: u.cookie }, body: JSON.stringify({ old: 'password1', password: 'brandnew123' }) });
    expect(r.status).toBe(200);
    const fresh = r.headers.get('set-cookie')!.split(';')[0];
    expect((await (await fetch(`${h.base}/api/me`, { headers: { cookie: fresh } })).json()).user.name).toBe('chgpw');
    expect((await (await fetch(`${h.base}/api/me`, { headers: { cookie: otherCookie } })).json()).user).toBeNull();
    expect((await (await fetch(`${h.base}/api/me`, { headers: { cookie: u.cookie } })).json()).user).toBeNull();
  });
  it('production without SMTP disables email features honestly; SMTP transport sends real mail', async () => {
    const prod = await harness({ NODE_ENV: 'production' });
    const cfg = await (await fetch(`${prod.base}/api/config`)).json();
    expect(cfg).toMatchObject({ email: false, emailDev: false });
    expect((await fetch(`${prod.base}/api/password/forgot`, { method: 'POST', body: JSON.stringify({ email: 'a@x.com' }) })).status).toBe(503);
    expect((await fetch(`${prod.base}/api/dev/outbox`)).status).toBe(404);
    await prod.close();
    const sent: any[] = [];
    const m = createMailer({ SMTP_URL: 'x' }, { sendMail: async (o: any) => { sent.push(o); } } as any);
    await m.send('a@x.com', 's', 't'); expect(sent[0]).toMatchObject({ to: 'a@x.com', subject: 's' }); expect(m.dev).toBe(false);
  });
  it('with real SMTP configured, rated play requires a verified email', async () => {
    const sent: any[] = [];
    const real = await harness({}, undefined, createMailer({}, { sendMail: async (o: any) => { sent.push(o); } } as any));
    const u = await account(real, 'unverif');
    const w = await wsReady(real, u.cookie);
    w.send({ t: 'create', game: 'chess', name: 'x', side: 'w', rated: true });
    expect((await w.until<any>((m) => m.t === 'error')).msg).toContain('이메일 인증');
    await new Promise((r) => setTimeout(r, 50)); expect(sent.some((m) => m.to === 'unverif@x.com' && m.text.includes('verify='))).toBe(true); // verification mail was really handed to the transport
    const token = sent.find((m) => m.to === 'unverif@x.com').text.match(/verify=([\w-]+)/)[1];
    await u.call('/api/email/verify', 'POST', { token }); w.msgs.length = 0;
    w.send({ t: 'create', game: 'chess', name: 'x', side: 'w', rated: true }); await w.until((m) => m.t === 'joined');
    w.close(); await real.close();
  });
});

describe('admin: report triage + audit', () => {
  it('non-admins and unverified admin emails are refused; admin handles reports with audit trail; secrets redacted', async () => {
    const boss = await account(h, 'boss', 'boss@x.com'), a = await account(h, 'reporta'), b = await account(h, 'reportb');
    expect((await a.call('/api/admin/reports')).status).toBe(403);
    expect((await boss.call('/api/admin/reports')).status).toBe(403); // admin email but not verified yet
    h.app.store.markVerified(boss.id);
    expect((await boss.call('/api/me')).json.user.isAdmin).toBe(true);
    expect((await a.call('/api/report', 'POST', { name: 'reportb', reason: 'cheating, my password: hunter2hunter2 and token=abcdefghijklmnopqrstuvwxyz0123' })).status).toBe(200);
    const list = (await boss.call('/api/admin/reports')).json.reports;
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ reporter: 'reporta', target: 'reportb', status: 'open', kind: 'user' });
    expect(list[0].reason).not.toContain('hunter2'); expect(list[0].reason).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect((await a.call(`/api/admin/reports/${list[0].id}`, 'POST', { status: 'actioned' })).status).toBe(403);
    expect((await boss.call(`/api/admin/reports/${list[0].id}`, 'POST', { status: 'bogus' })).status).toBe(400);
    expect((await boss.call(`/api/admin/reports/${list[0].id}`, 'POST', { status: 'actioned', note: 'warned' })).status).toBe(200);
    expect((await boss.call('/api/admin/reports?status=actioned')).json.reports[0]).toMatchObject({ status: 'actioned', handled_by: 'boss', note: 'warned' });
    const log = (await boss.call('/api/admin/audit')).json.log.map((x: any) => x.action);
    expect(log).toContain('view_reports'); expect(log).toContain('handle_report');
    expect((await a.call('/api/admin/audit')).status).toBe(403);
    void b;
  });
});

describe('tournaments (arena)', () => {
  it('admin creates, players join, server pairs only participants inside the window, standings and finalization', async () => {
    const boss = h.app.store.userByEmail('boss@x.com')!; const bossCookie = (await account(h, 'boss2', 'boss2@x.com')); void bossCookie;
    const admin = await (async () => { const r = await fetch(`${h.base}/api/login`, { method: 'POST', body: JSON.stringify({ email: 'boss@x.com', password: 'password1' }) }); const cookie = r.headers.get('set-cookie')!.split(';')[0]; return (p: string, m = 'GET', b?: unknown) => fetch(h.base + p, { method: m, headers: { cookie }, body: b ? JSON.stringify(b) : undefined }).then(async (x) => ({ status: x.status, json: await x.json().catch(() => null) as any })); })();
    void boss;
    const p1 = await account(h, 'tp1'), p2 = await account(h, 'tp2'), p3 = await account(h, 'tp3');
    const starts = h.clock.t + 60_000, ends = starts + 600_000;
    expect((await p1.call('/api/admin/tournaments', 'POST', { name: 'Hack', game: 'gomoku', starts, ends })).status).toBe(403);
    expect((await admin('/api/admin/tournaments', 'POST', { name: 'ab', game: 'gomoku', starts, ends })).status).toBe(400);
    expect((await admin('/api/admin/tournaments', 'POST', { name: 'Chess arena', game: 'chess', time: 'none', starts, ends })).status).toBe(400);
    const made = await admin('/api/admin/tournaments', 'POST', { name: '오목 아레나', game: 'gomoku', starts, ends }); expect(made.status).toBe(200);
    const tid = made.json.id;
    expect((await p1.call(`/api/tournaments/${tid}/join`, 'POST')).status).toBe(200);
    expect((await p1.call(`/api/tournaments/${tid}/join`, 'POST')).status).toBe(409);
    await p2.call(`/api/tournaments/${tid}/join`, 'POST');
    expect((await p1.call('/api/tournaments')).json.tournaments[0]).toMatchObject({ status: 'upcoming', players: 2, joined: true });
    const w1 = await wsReady(h, p1.cookie), w2 = await wsReady(h, p2.cookie), w3 = await wsReady(h, p3.cookie);
    w1.send({ t: 'queue', game: 'gomoku', name: 'x', tournament: tid }); expect((await w1.until((m) => m.t === 'error') as any).msg).toContain('진행 중인 대회가 아닙니다');
    h.clock.t = starts + 1000;
    w3.send({ t: 'queue', game: 'gomoku', name: 'x', tournament: tid }); expect((await w3.until((m) => m.t === 'error') as any).msg).toContain('참가하지 않았습니다');
    w1.msgs.length = 0;
    w1.send({ t: 'queue', game: 'chess', name: 'x', tournament: tid }); await w1.until((m) => m.t === 'queued'); // client settings are ignored: tournament decides game/time
    w2.send({ t: 'queue', game: 'gomoku', name: 'x', tournament: tid });
    await w1.until(joined); await w2.until(joined);
    expect(w1.view().game).toBe('gomoku'); expect(w1.view().rated).toBe(false); expect(w1.view().tournament).toBe(tid);
    const first = w1.view().you === 'w' ? w1 : w2, second = first === w1 ? w2 : w1;
    for (let i = 0; i < 5; i++) { first.send({ t: 'move', n: i * 2, idx: i }); await second.until((m) => 'view' in m && m.view.n === i * 2 + 1); if (i < 4) { second.send({ t: 'move', n: i * 2 + 1, idx: 15 * 3 + i }); await first.until((m) => 'view' in m && m.view.n === i * 2 + 2); } }
    await first.until((m) => 'view' in m && m.view.status === 'over');
    const st = (await p1.call(`/api/tournaments/${tid}`)).json;
    const winner = first === w1 ? 'tp1' : 'tp2';
    expect(st.rows[0]).toMatchObject({ name: winner, points: 2, played: 1, wins: 1 }); expect(st.rows[1]).toMatchObject({ points: 0, played: 1 });
    expect(h.app.store.rating(p1.id, 'gomoku', 'std')).toBe(1200); // tournaments never touch Elo
    expect((await p1.call(`/api/tournaments/${tid}/leave`, 'POST')).status).toBe(400); // already started
    h.clock.t = ends + 1; h.app.tick(); h.app.tick();
    const fin = (await p1.call(`/api/tournaments/${tid}`)).json; expect(fin.tournament).toMatchObject({ status: 'ended', finalized: true }); expect(fin.rows.map((r: any) => r.rank)).toEqual([1, 2]);
    expect((await p3.call(`/api/tournaments/${tid}/join`, 'POST')).status).toBe(400);
    for (const w of [w1, w2, w3]) w.close();
  });
});

describe('clubs', () => {
  it('role permissions are enforced server-side; blocks apply; owner cannot abandon', async () => {
    const o = await account(h, 'cowner'), m = await account(h, 'cmember'), x = await account(h, 'coutsider'), adm = await account(h, 'cadmin');
    const c = await o.call('/api/clubs', 'POST', { name: '테스트 클럽', about: 'hi', public: false }); expect(c.status).toBe(200); const id = c.json.id;
    expect((await o.call('/api/clubs', 'POST', { name: '테스트 클럽' })).status).toBe(409);
    expect((await o.call('/api/clubs', 'POST', { name: '<b>' })).status).toBe(400);
    expect((await m.call(`/api/clubs/${id}/join`, 'POST')).json.status).toBe('pending'); // invite-only => request
    expect((await m.call(`/api/clubs/${id}`)).json.notice).toBeUndefined(); expect((await m.call(`/api/clubs/${id}`)).json.members).toBeUndefined(); // not a member yet
    expect((await x.call(`/api/clubs/${id}/accept`, 'POST', { name: 'cmember' })).status).toBe(403);
    expect((await o.call(`/api/clubs/${id}/accept`, 'POST', { name: 'cmember' })).status).toBe(200);
    expect((await m.call(`/api/clubs/${id}/update`, 'POST', { notice: 'hax' })).status).toBe(403);
    expect((await m.call(`/api/clubs/${id}/invite`, 'POST', { name: 'coutsider' })).status).toBe(403);
    expect((await o.call(`/api/clubs/${id}/role`, 'POST', { name: 'cmember', role: 'admin' })).status).toBe(200);
    expect((await m.call(`/api/clubs/${id}/update`, 'POST', { notice: '공지 <script>' })).status).toBe(200);
    expect((await m.call(`/api/clubs/${id}`)).json.notice).not.toContain('<');
    // blocks: owner blocks outsider -> outsider cannot join; admin cannot invite someone who blocked them
    await o.call('/api/block', 'POST', { name: 'coutsider' });
    expect((await x.call(`/api/clubs/${id}/join`, 'POST')).status).toBe(403);
    await adm.call('/api/block', 'POST', { name: 'cmember' });
    expect((await m.call(`/api/clubs/${id}/invite`, 'POST', { name: 'cadmin' })).status).toBe(403);
    expect((await o.call(`/api/clubs/${id}/invite`, 'POST', { name: 'cadmin' })).status).toBe(200);
    expect((await adm.call(`/api/clubs/${id}/answer`, 'POST', { accept: true })).status).toBe(200);
    // hierarchy
    expect((await m.call(`/api/clubs/${id}/kick`, 'POST', { name: 'cowner' })).status).toBe(403);
    expect((await m.call(`/api/clubs/${id}/role`, 'POST', { name: 'cadmin', role: 'admin' })).status).toBe(403);
    expect((await o.call(`/api/clubs/${id}/leave`, 'POST')).status).toBe(400);
    expect((await m.call(`/api/clubs/${id}/kick`, 'POST', { name: 'cadmin' })).status).toBe(200); // admin may remove a plain member
    expect((await m.call(`/api/clubs/${id}/report`, 'POST', { reason: 'spam club' })).status).toBe(200);
    expect(h.app.store.all('SELECT kind FROM reports WHERE kind=\'club\'')).toHaveLength(1);
    expect((await m.call(`/api/clubs/${id}`, 'DELETE')).status).toBe(403);
    expect((await o.call(`/api/clubs/${id}`, 'DELETE')).status).toBe(200);
    expect((await o.call('/api/clubs?q=테스트')).json.clubs).toHaveLength(0);
  });
});

describe('spectating (read-only)', () => {
  it('spectators see updates but cannot act; private and rated games are not watchable; live list', async () => {
    const a = await account(h, 'speca'), b = await account(h, 'specb'), v = await account(h, 'specv');
    const wa = await wsReady(h, a.cookie), wb = await wsReady(h, b.cookie), wv = await wsReady(h, v.cookie), wg = await wsReady(h);
    // private friend room: not watchable
    wa.send({ t: 'create', game: 'chess', name: 'x', side: 'w' }); const priv = (await wa.until<any>(joined)).view.code;
    wg.send({ t: 'watch', code: priv }); expect((await wg.until<any>((m) => m.t === 'error')).msg).toContain('관전할 수 없는');
    wa.close(); await wa.quiet();
    // public quick-match room (spectate allowed)
    const qa = await wsReady(h, a.cookie), qb = await wsReady(h, b.cookie);
    qa.send({ t: 'queue', game: 'chess', name: 'x', time: '10+0' }); await qa.until((m) => m.t === 'queued'); qb.send({ t: 'queue', game: 'chess', name: 'x', time: '10+0' });
    await qa.until(joined); await qb.until((m) => 'view' in m && m.view.status === 'playing');
    const code = qa.view().code; expect((await (await fetch(`${h.base}/api/live`)).json()).games.map((g: any) => g.code)).toContain(code);
    wv.send({ t: 'watch', code }); await wv.until((m) => 'view' in m && !!m.view.spectator);
    wg.msgs.length = 0; wg.send({ t: 'watch', code }); await wg.until((m) => 'view' in m && !!m.view.spectator); // guests may watch
    const white = qa.view().you === 'w' ? qa : qb;
    white.send({ t: 'move', n: 0, from: 'e2', to: 'e4' });
    await wv.until((m) => 'view' in m && m.view.n === 1); expect(wv.view().chess!.history).toEqual(['e4']); expect(wv.view().chat).toBeUndefined();
    expect(wv.view().spectators).toBeGreaterThanOrEqual(2);
    for (const msg of [{ t: 'move', n: 1, from: 'e7', to: 'e5' }, { t: 'resign' }, { t: 'draw', action: 'offer' }, { t: 'chat', text: 'hi' }, { t: 'rematch' }] as const) {
      wv.msgs.length = 0; wv.send(msg as any); await wv.until((m) => m.t === 'error'); // all refused
    }
    await wv.quiet(); expect(qa.view().n).toBe(1); expect(qa.view().status).toBe('playing'); expect(qa.view().drawOffer).toBeNull();
    qa.send({ t: 'resign' }); await wv.until((m) => 'view' in m && m.view.status === 'over'); // result reaches spectators
    expect(wv.view().result?.reason).toBe('기권');
    // rated rooms are never spectatable
    const ra = await wsReady(h, a.cookie), rb = await wsReady(h, b.cookie), rv = await wsReady(h, v.cookie);
    ra.send({ t: 'create', game: 'chess', name: 'x', side: 'w', rated: true, spectate: true }); const rcode = (await ra.until<any>(joined)).view.code;
    rb.send({ t: 'join', code: rcode, name: 'x' }); await rb.until(joined);
    expect(ra.view().spectate).toBe(false); rv.send({ t: 'watch', code: rcode }); await rv.until((m) => m.t === 'error');
    for (const w of [wb, wv, wg, qa, qb, ra, rb, rv]) w.close();
  });
});

describe('in-game chat', () => {
  it('only registered players, text-only, length/rate limited, reports carry server-side evidence', async () => {
    const a = await account(h, 'chata'), b = await account(h, 'chatb');
    const wa = await wsReady(h, a.cookie), wb = await wsReady(h, b.cookie), wg = await wsReady(h);
    wa.send({ t: 'create', game: 'chess', name: 'x', side: 'w' }); const code = (await wa.until<any>(joined)).view.code;
    wb.send({ t: 'join', code, name: 'x' }); await wb.until(joined);
    wa.send({ t: 'chat', text: '안녕하세요 <b>hi</b>' }); const got = await wb.until<any>((m) => m.t === 'chat');
    expect(got).toMatchObject({ name: 'chata', side: 'w' }); expect(got.text).not.toContain('<');
    await wa.until((m) => m.t === 'chat');
    const err = async (c: typeof wa, text: string) => { c.msgs.length = 0; c.send({ t: 'chat', text }); return (await c.until<any>((m) => m.t === 'error')).msg as string; };
    await wa.quiet(1100);
    expect(await err(wa, 'visit http://spam.example now')).toContain('링크'); await wa.quiet(1100);
    expect(await err(wa, 'buy at shop.com')).toContain('링크'); await wa.quiet(1100);
    expect(await err(wa, 'x'.repeat(201))).toContain('200자');
    await wa.quiet(1100); wa.send({ t: 'chat', text: 'one' }); await wa.quiet(50);
    expect(await err(wa, 'two too fast')).toContain('빨리'); // 1 msg/sec
    wg.send({ t: 'create', game: 'chess', name: 'g', side: 'w' }); await wg.until(joined);
    expect(await err(wg, 'guest chat')).toContain('로그인');
    // chat history is kept for reconnects and used as report evidence only for participants
    const outsider = await account(h, 'chatc');
    expect((await outsider.call('/api/report', 'POST', { name: 'chata', reason: 'abuse', room: code })).status).toBe(200);
    expect((await b.call('/api/report', 'POST', { name: 'chata', reason: '심한 욕설을 했어요', room: code })).status).toBe(200);
    const reps = h.app.store.all('SELECT context,reporter FROM reports WHERE reason=\'심한 욕설을 했어요\' OR reason=\'abuse\' ORDER BY id') as any[];
    expect(reps[0].context).toBeNull(); expect(reps[1].context).toContain('chata: 안녕하세요');
    for (const w of [wa, wb, wg]) w.close();
  });
});

describe('time-control rating categories', () => {
  it('rates blitz and rapid separately via the server', async () => {
    const a = await account(h, 'catsa'), b = await account(h, 'catsb');
    const play = async (time: string) => {
      const wa = await wsReady(h, a.cookie), wb = await wsReady(h, b.cookie);
      wa.send({ t: 'create', game: 'chess', name: 'x', side: 'w', time, rated: true }); const code = (await wa.until<any>(joined)).view.code;
      wb.send({ t: 'join', code, name: 'x' }); await wb.until(joined);
      for (const [n, f, t, who] of [[0, 'e2', 'e4', wa], [1, 'e7', 'e5', wb], [2, 'g1', 'f3', wa], [3, 'b8', 'c6', wb]] as const) { who.send({ t: 'move', n, from: f, to: t }); await (who === wa ? wb : wa).until((m) => 'view' in m && m.view.n === n + 1); }
      wb.send({ t: 'resign' }); await wa.until((m) => 'view' in m && m.view.status === 'over' && !!m.view.result?.ratingDelta);
      wa.close(); wb.close();
    };
    await play('5+0'); await play('15+10');
    const s = h.app.store;
    expect(s.rating(a.id, 'chess', 'blitz')).toBe(1220); expect(s.rating(a.id, 'chess', 'rapid')).toBe(1220); expect(s.rating(a.id, 'chess', 'bullet')).toBe(1200);
    expect(s.rating(b.id, 'chess', 'blitz')).toBe(1180);
    const lb = (await a.call('/api/leaderboard?game=chess&cat=blitz')).json; expect(lb.rows.map((r: any) => r.name)).toEqual(['catsa', 'catsb']);
    expect((await a.call('/api/leaderboard?game=chess&cat=std')).status).toBe(400);
    expect((await a.call('/api/leaderboard?game=gomoku')).status).toBe(200);
  });
});
