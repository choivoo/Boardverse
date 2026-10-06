import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, account, wsReady, type Harness } from './testkit';
import { createMailer } from './mail';
import type { ServerMsg } from '../src/protocol';

const joined = (m: ServerMsg) => m.t === 'joined';
const dbFile = () => join(mkdtempSync(join(tmpdir(), 'bv-rs-')), 'rs.db');
const boot = (db: string, clock: { t: number }) => harness({}, clock.t, createMailer({}), db, clock);
const T0 = Date.parse('2026-11-01T00:00:00Z');
const tokenOf = (c: { msgs: ServerMsg[] }) => (c.msgs.find(joined) as Extract<ServerMsg, { t: 'joined' }>).token;

/** two accounts, a started chess room; returns what a client needs to reconnect */
async function startChess(h: Harness, time = '5+0', rated = false) {
  const a = await account(h, 'rsa'), b = await account(h, 'rsb');
  const wa = await wsReady(h, a.cookie), wb = await wsReady(h, b.cookie);
  wa.send({ t: 'create', game: 'chess', name: 'x', side: 'w', time, rated }); const code = (await wa.until<any>(joined)).view.code;
  wb.send({ t: 'join', code, name: 'x' }); await wb.until(joined);
  return { a, b, wa, wb, code, ta: tokenOf(wa), tb: tokenOf(wb) };
}
const play = async (_h: Harness, g: Awaited<ReturnType<typeof startChess>>, who: 'a' | 'b', n: number, from: string, to: string) => {
  const c = who === 'a' ? g.wa : g.wb, o = who === 'a' ? g.wb : g.wa;
  c.send({ t: 'move', n, from, to }); await o.until((m) => 'view' in m && m.view.n === n + 1);
};

describe('server restart recovery', () => {
  it('create -> moves -> restart -> reconnect -> play on; board, turn and clock policy preserved', async () => {
    const db = dbFile(); const clock = { t: T0 };
    let h = await boot(db, clock);
    const g = await startChess(h);
    clock.t += 5000; await play(h, g, 'a', 0, 'e2', 'e4');
    clock.t += 7000; await play(h, g, 'b', 1, 'e7', 'e5');
    clock.t += 3000; await play(h, g, 'a', 2, 'g1', 'f3');
    const before = g.wa.view();
    expect(before.chess!.clocks).toEqual({ w: 292_000, b: 293_000 });
    clock.t += 2000; h.app.tick(); // heartbeat: black has been thinking for 2 s when the server dies
    g.wa.close(); g.wb.close(); await h.close();

    clock.t += 3600_000; // one hour of downtime
    h = await boot(db, clock);
    expect(h.app.mgr.rooms.size).toBe(1);
    const ra = await wsReady(h, g.a.cookie), rb = await wsReady(h, g.b.cookie);
    ra.send({ t: 'resume', code: g.code, token: g.ta }); const back = (await ra.until<any>(joined)).view;
    rb.send({ t: 'resume', code: g.code, token: g.tb }); await rb.until(joined);
    expect(back.chess.fen).toBe(before.chess!.fen); expect(back.turn).toBe('b'); expect(back.n).toBe(3); expect(back.status).toBe('playing');
    expect(back.chess.history).toEqual(['e4', 'e5', 'Nf3']);
    expect(back.notice).toContain('재시작'); expect(back.notice).toContain('60분');
    // stale/duplicate request (white's old n) must not change anything; black continues normally
    ra.send({ t: 'move', n: 2, from: 'g1', to: 'f3' }); await ra.quiet(); expect(rb.view().n).toBe(3);
    rb.send({ t: 'move', n: 3, from: 'b8', to: 'c6' }); await ra.until((m) => 'view' in m && m.view.n === 4);
    expect(ra.view().chess!.clocks!.b).toBe(293_000 - 2000); // only the 2 s before the crash were charged, not the hour of downtime
    expect(ra.view().notice).toBeUndefined();
    ra.close(); rb.close(); await h.close();
  });

  it('only the original seat can resume: wrong token, other account and (for rated rooms) guests are refused', async () => {
    const db = dbFile(); const clock = { t: T0 };
    let h = await boot(db, clock);
    const g = await startChess(h, '10+0', true);
    const eve = await account(h, 'eve');
    g.wa.close(); g.wb.close(); await h.close();
    h = await boot(db, clock);
    const e = await wsReady(h, (await h.app.store.createSession(h.app.store.userByName('eve')!.id as number)) ? `bv_session=${h.app.store.createSession(h.app.store.userByName('eve')!.id as number)}` : undefined);
    e.send({ t: 'resume', code: g.code, token: g.ta }); expect((await e.until<any>((m) => m.t === 'error')).fatal).toBe(true); // right token, wrong account
    const guest = await wsReady(h); guest.send({ t: 'resume', code: g.code, token: g.tb }); expect((await guest.until<any>((m) => m.t === 'error')).msg).toContain('로그인');
    const ok = await wsReady(h, g.b.cookie); ok.send({ t: 'resume', code: g.code, token: 'x'.repeat(36) }); expect((await ok.until<any>((m) => m.t === 'error')).fatal).toBe(true);
    ok.msgs.length = 0; ok.send({ t: 'resume', code: g.code, token: g.tb }); await ok.until(joined);
    expect(JSON.stringify(h.app.store.all('SELECT data FROM rooms'))).not.toContain(g.ta); // raw tokens never stored
    void eve; for (const c of [e, guest, ok]) c.close(); await h.close();
  });

  it('finished games are not restored; a crash between "recorded" and "dropped" cannot double-count Elo; old rooms expire', async () => {
    const db = dbFile(); const clock = { t: T0 };
    let h = await boot(db, clock);
    const g = await startChess(h, '5+0', true);
    clock.t += 1000; await play(h, g, 'a', 0, 'e2', 'e4'); await play(h, g, 'b', 1, 'e7', 'e5'); await play(h, g, 'a', 2, 'g1', 'f3'); await play(h, g, 'b', 3, 'b8', 'c6');
    const row = h.app.store.get('SELECT code,data FROM rooms WHERE code=?', g.code) as { code: string; data: string };
    g.wb.send({ t: 'resign' }); await g.wa.until((m) => 'view' in m && m.view.status === 'over' && !!m.view.result?.ratingDelta);
    expect(h.app.store.all('SELECT code FROM rooms')).toHaveLength(0); // dropped once finished
    const ratingA = h.app.store.rating(g.a.id, 'chess', 'blitz'); expect(ratingA).toBe(1220);
    h.app.store.saveRoom(row.code, row.data); // simulate: process died after recording but before the room row was deleted
    g.wa.close(); g.wb.close(); await h.close();
    h = await boot(db, clock);
    expect(h.app.mgr.rooms.size).toBe(0); expect(h.app.store.all('SELECT code FROM rooms')).toHaveLength(0);
    expect(h.app.store.rating(g.a.id, 'chess', 'blitz')).toBe(1220); expect(h.app.store.all('SELECT id FROM games')).toHaveLength(1);
    // expiry: an unfinished room older than 24 h is dropped at restore
    await startChess(h, '5+0'); await h.close();
    clock.t += 25 * 3600_000; h = await boot(db, clock); expect(h.app.mgr.rooms.size).toBe(0); await h.close();
  });

  it('gomoku and waiting rooms survive; both players gone after restart => cancelled, nothing recorded; one gone => forfeit', async () => {
    const db = dbFile(); const clock = { t: T0 };
    let h = await boot(db, clock);
    const a = await account(h, 'ga'), b = await account(h, 'gb'), c = await account(h, 'gc');
    const wa = await wsReady(h, a.cookie), wb = await wsReady(h, b.cookie), wc = await wsReady(h, c.cookie);
    wa.send({ t: 'create', game: 'gomoku', name: 'x', side: 'w', size: 13 }); const code = (await wa.until<any>(joined)).view.code; const ta = tokenOf(wa);
    wb.send({ t: 'join', code, name: 'x' }); await wb.until(joined);
    wa.send({ t: 'move', n: 0, idx: 84 }); await wb.until((m) => 'view' in m && m.view.n === 1);
    wc.send({ t: 'create', game: 'chess', name: 'x', side: 'b' }); const waitCode = (await wc.until<any>(joined)).view.code; const tc = tokenOf(wc); // still waiting for an opponent
    for (const w of [wa, wb, wc]) w.close(); await h.close();
    h = await boot(db, clock);
    expect(h.app.mgr.rooms.size).toBe(2);
    const ra = await wsReady(h, a.cookie); ra.send({ t: 'resume', code, token: ta }); const v = (await ra.until<any>(joined)).view;
    expect(v.gomoku.size).toBe(13); expect(v.gomoku.moves).toEqual([84]); expect(v.turn).toBe('b');
    const rc = await wsReady(h, c.cookie); rc.send({ t: 'resume', code: waitCode, token: tc }); expect((await rc.until<any>(joined)).view.status).toBe('waiting');
    // b never returns: after the 120 s window a (who is back) wins by disconnect-forfeit
    clock.t += 121_000; h.app.tick();
    await ra.until((m) => 'view' in m && m.view.status === 'over'); expect(ra.view().result).toMatchObject({ winner: 'w', reason: '상대 연결 끊김' });
    ra.close(); rc.close(); await h.close();
  });

  it('nobody returns after a restart: the room is cancelled quietly and nothing is recorded', async () => {
    const db = dbFile(); const clock = { t: T0 };
    let h = await boot(db, clock);
    const g = await startChess(h); clock.t += 1000; await play(h, g, 'a', 0, 'e2', 'e4'); g.wa.close(); g.wb.close(); await h.close();
    h = await boot(db, clock); expect(h.app.mgr.rooms.size).toBe(1);
    clock.t += 121_000; h.app.tick(); expect(h.app.mgr.rooms.size).toBe(0);
    expect(h.app.store.all('SELECT id FROM games')).toHaveLength(0);
    expect(h.app.store.all('SELECT code FROM rooms')).toHaveLength(0); await h.close();
  });
});
