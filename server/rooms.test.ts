import { describe, it, expect } from 'vitest';
import { RoomManager, type Conn } from './rooms';
import type { ServerMsg, RoomView } from '../src/protocol';

function client() {
  const msgs: ServerMsg[] = [];
  const c: Conn = { send: (m) => msgs.push(m) };
  return { c, msgs, last: () => msgs.at(-1)!, view: () => [...msgs].reverse().map((m) => ('view' in m ? m.view : null)).find(Boolean) as RoomView, token: () => (msgs.find((m) => m.t === 'joined') as Extract<ServerMsg, { t: 'joined' }>).token };
}
function setup(game: 'chess' | 'gomoku' = 'chess', time?: string) {
  let t = 1000; const mgr = new RoomManager(() => t);
  const a = client(), b = client();
  mgr.handle(a.c, { t: 'create', game, name: 'A', side: 'w', time });
  const code = a.view().code;
  mgr.handle(b.c, { t: 'join', code: code.toLowerCase(), name: 'B' });
  return { mgr, a, b, code, adv: (ms: number) => { t += ms; } };
}

describe('online rooms', () => {
  it('creates a room with a 5-char code and starts when joined', () => {
    const { a, b, code } = setup();
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(a.view().status).toBe('playing');
    expect(b.view().you).toBe('b');
  });
  it('rejects a third player', () => {
    const { mgr, code } = setup(); const x = client();
    mgr.handle(x.c, { t: 'join', code, name: 'X' });
    expect(x.last()).toMatchObject({ t: 'error' });
  });
  it('enforces turn order and legality on the server', () => {
    const { mgr, a, b } = setup();
    mgr.handle(b.c, { t: 'move', n: 0, from: 'e7', to: 'e5' });
    expect(b.last()).toMatchObject({ t: 'error', msg: '상대 차례입니다.' });
    mgr.handle(a.c, { t: 'move', n: 0, from: 'e2', to: 'e5' });
    expect(a.last()).toMatchObject({ t: 'error' });
    mgr.handle(a.c, { t: 'move', n: 0, from: 'e2', to: 'e4' });
    expect(b.view().n).toBe(1); expect(b.view().turn).toBe('b');
  });
  it('ignores duplicate/stale submissions without applying twice', () => {
    const { mgr, a } = setup();
    mgr.handle(a.c, { t: 'move', n: 0, from: 'e2', to: 'e4' });
    mgr.handle(a.c, { t: 'move', n: 0, from: 'e2', to: 'e4' });
    expect(a.view().n).toBe(1);
  });
  it('rejects bad gomoku input and plays to a win', () => {
    const { mgr, a, b } = setup('gomoku');
    mgr.handle(a.c, { t: 'move', n: 0, idx: -5 }); expect(a.last()).toMatchObject({ t: 'error' });
    mgr.handle(a.c, { t: 'move', n: 0, idx: 1e9 }); expect(a.last()).toMatchObject({ t: 'error' });
    for (let i = 0; i < 5; i++) {
      mgr.handle(a.c, { t: 'move', n: i * 2, idx: i });
      if (i < 4) mgr.handle(b.c, { t: 'move', n: i * 2 + 1, idx: 15 * 3 + i });
    }
    expect(a.view().status).toBe('over'); expect(a.view().result).toEqual({ winner: 'w', reason: '5목 완성' });
    mgr.handle(b.c, { t: 'move', n: 9, idx: 100 }); expect(b.last()).toMatchObject({ t: 'error' });
  });
  it('uses the server clock for timeouts', () => {
    const { mgr, a, b, adv } = setup('chess', '5+0');
    adv(301_000); mgr.tick();
    expect(b.view().result).toEqual({ winner: 'b', reason: '시간 초과' });
    mgr.handle(a.c, { t: 'move', n: 0, from: 'e2', to: 'e4' }); expect(a.view().n).toBe(0);
  });
  it('resigns', () => {
    const { mgr, a, b } = setup();
    mgr.handle(b.c, { t: 'resign' });
    expect(a.view().result).toEqual({ winner: 'w', reason: '기권' });
  });
  it('reconnects with token, rejects wrong token, forfeits after long disconnect', () => {
    const { mgr, a, b, code, adv } = setup();
    mgr.disconnect(b.c);
    expect(a.view().players.find((p) => p.side === 'b')!.connected).toBe(false);
    const b2 = client();
    mgr.handle(b2.c, { t: 'resume', code, token: 'nope' }); expect(b2.last()).toMatchObject({ t: 'error', fatal: true });
    mgr.handle(b2.c, { t: 'resume', code, token: b.token() }); expect(b2.view().you).toBe('b');
    mgr.disconnect(b2.c); adv(121_000); mgr.tick();
    expect(a.view().result?.reason).toBe('상대 연결 끊김');
  });
  it('sanitizes names and rejects malformed messages', () => {
    const mgr = new RoomManager(); const x = client();
    mgr.handle(x.c, { t: 'create', game: 'chess', name: '<b>' + 'x'.repeat(40), side: 'random' });
    expect(x.view().players[0].name.length).toBeLessThanOrEqual(16);
    expect(x.view().players[0].name).not.toContain('<');
    mgr.handle(x.c, null as never); expect(x.last()).toMatchObject({ t: 'error' });
  });
});
