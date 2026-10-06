import { describe, it, expect } from 'vitest';
import { Store, ApiError, eloDelta, START_RATING, type GameSummary } from './store';

const mk = (t = Date.parse('2026-11-01T00:00:00Z')) => { let now = t; const s = new Store(':memory:', () => now); return { s, set: (n: number) => { now = n; } }; };
const g = (id: string, w: number, b: number, result: 'w' | 'b' | 'draw', over: Partial<GameSummary> = {}): GameSummary =>
  ({ id, game: 'chess', whiteId: w, blackId: b, whiteName: 'W', blackName: 'B', rated: true, time: '5+0', result, reason: 'x', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], ...over });
const fails = (fn: () => unknown, status: number) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).status).toBe(status); return; } throw new Error('expected failure'); };

describe('accounts', () => {
  it('registers, logs in, hashes passwords, validates input', () => {
    const { s } = mk();
    const id = s.register('A@x.com', 'alice', 'password1');
    expect(s.login('a@x.com', 'password1')).toBe(id);
    fails(() => s.login('a@x.com', 'wrong'), 401);
    fails(() => s.register('a@x.com', 'other', 'password1'), 409);
    fails(() => s.register('b@x.com', 'ALICE', 'password1'), 409);
    fails(() => s.register('b@x.com', 'b', 'password1'), 400);
    fails(() => s.register('b@x.com', 'bob', 'short'), 400);
    fails(() => s.register('nope', 'bob', 'password1'), 400);
    expect(JSON.stringify(s.db.prepare('SELECT hash FROM users').all())).not.toContain('password1');
  });
  it('sessions expire and can be ended', () => {
    const { s, set } = mk(1000);
    const id = s.register('a@x.com', 'alice', 'password1'); const tok = s.createSession(id);
    expect(s.userBySession(tok)?.id).toBe(id);
    set(1000 + 31 * 86400_000); expect(s.userBySession(tok)).toBeNull();
    set(1000); s.endSession(tok); expect(s.userBySession(tok)).toBeNull();
  });
  it('deleting an account removes personal data but keeps anonymised games', () => {
    const { s } = mk(); const a = s.register('a@x.com', 'alice', 'password1'), b = s.register('b@x.com', 'bobby', 'password1');
    s.recordGame(g('g1', a, b, 'w'));
    fails(() => s.deleteUser(a, 'bad'), 401);
    s.deleteUser(a, 'password1');
    expect(s.userByName('alice')).toBeUndefined();
    expect(s.db.prepare('SELECT white_name,white_id FROM games').get()).toMatchObject({ white_name: '(탈퇴)', white_id: null });
  });
});

describe('ratings', () => {
  it('only rated games between two accounts change ratings, per game kind', () => {
    const { s } = mk(); const a = s.register('a@x.com', 'alice', 'password1'), b = s.register('b@x.com', 'bobby', 'password1');
    expect(s.recordGame(g('u1', a, b, 'w', { rated: false }))).toEqual({ w: 0, b: 0 });
    expect(s.rating(a, 'chess')).toBe(START_RATING);
    const d = s.recordGame(g('r1', a, b, 'w'))!;
    expect(d.w).toBe(20); expect(d.b).toBe(-20);
    expect(s.rating(a, 'chess')).toBe(1220); expect(s.rating(b, 'chess')).toBe(1180);
    expect(s.rating(a, 'gomoku')).toBe(START_RATING);
    s.recordGame(g('r2', a, null as never, 'w')); // guest opponent: not rated
    expect(s.rating(a, 'chess')).toBe(1220);
  });
  it('is idempotent per game id and ignores abandoned (<2 moves) games', () => {
    const { s } = mk(); const a = s.register('a@x.com', 'alice', 'password1'), b = s.register('b@x.com', 'bobby', 'password1');
    s.recordGame(g('r1', a, b, 'w')); expect(s.recordGame(g('r1', a, b, 'w'))).toBeNull();
    expect(s.rating(a, 'chess')).toBe(1220);
    s.recordGame(g('r2', a, b, 'b', { moves: ['e4'] })); expect(s.rating(a, 'chess')).toBe(1220);
    expect(() => s.recordGame(g('self', a, a, 'w'))).not.toThrow(); expect(s.rating(a, 'chess')).toBe(1220);
  });
  it('elo is zero-sum for equal K and draws between equals do nothing', () => {
    expect(eloDelta(1200, 1200, 0.5, 0)).toBe(0);
    expect(eloDelta(1200, 1200, 1, 0)).toBe(20);
    expect(eloDelta(1600, 1200, 1, 30)).toBeLessThan(10);
  });
  it('leaderboard ranks, paginates and reports own position', () => {
    const { s } = mk(); const ids = ['aa', 'bb', 'cc'].map((n) => s.register(n + '@x.com', n + 'user', 'password1'));
    s.recordGame(g('1', ids[0], ids[1], 'w')); s.recordGame(g('2', ids[0], ids[2], 'w', { moves: ['a', 'b', 'c'] }));
    const lb = s.leaderboard('chess', 0, 2, ids[1]);
    expect(lb.rows).toHaveLength(2); expect(lb.rows[0].name).toBe('aauser'); expect(lb.total).toBe(3);
    expect(lb.mine?.rank).toBeGreaterThan(1);
    expect(s.leaderboard('gomoku', 0, 10).rows).toEqual([]);
  });
});

describe('coins & shop', () => {
  it('awards capped coins once per game, rejects poor/duplicate purchases, equips only owned items', () => {
    const { s } = mk(); const a = s.register('a@x.com', 'alice', 'password1'), b = s.register('b@x.com', 'bobby', 'password1');
    s.recordGame(g('c1', a, b, 'w')); expect(s.coins(a)).toBe(10); expect(s.coins(b)).toBe(3);
    s.recordGame(g('c1', a, b, 'w')); expect(s.coins(a)).toBe(10);
    s.recordGame(g('short', a, b, 'w', { moves: ['e4', 'e5'] })); expect(s.coins(a)).toBe(10);
    for (let i = 0; i < 20; i++) s.recordGame(g('cap' + i, a, b, 'w', { rated: false }));
    expect(s.coins(a)).toBe(100);
    fails(() => s.buy(b, 'board-night'), 402);
    fails(() => s.buy(a, 'board-s1'), 400); fails(() => s.buy(a, 'nope'), 404); fails(() => s.buy(a, 'board-classic'), 409);
    s.buy(a, 'board-ice'); expect(s.coins(a)).toBe(0); fails(() => s.buy(a, 'board-ice'), 409);
    fails(() => s.equip(a, 'board-night'), 403);
    s.equip(a, 'board-ice'); expect(s.equipped(a).boardTheme).toBe('board-ice');
    expect(s.inventory(a).filter((i) => i === 'board-ice')).toHaveLength(1);
  });
});

describe('seasons', () => {
  it('claims rewards once, only when the condition is met, within the window', () => {
    const { s, set } = mk(); const a = s.register('a@x.com', 'alice', 'password1'), b = s.register('b@x.com', 'bobby', 'password1');
    fails(() => s.claimSeasonReward(a, 's1', 'r5'), 400);
    for (let i = 0; i < 5; i++) s.recordGame(g('s' + i, a, b, 'w'));
    const before = s.coins(a);
    s.claimSeasonReward(a, 's1', 'r5'); expect(s.coins(a)).toBe(before + 100);
    fails(() => s.claimSeasonReward(a, 's1', 'r5'), 409);
    fails(() => s.claimSeasonReward(a, 's1', 'zzz'), 404);
    set(Date.parse('2027-02-01T00:00:00Z')); fails(() => s.claimSeasonReward(a, 's1', 'w10'), 400);
  });
  it('finalizes once, preserves results, and grants top rank reward', () => {
    const { s, set } = mk(); const a = s.register('a@x.com', 'alice', 'password1'), b = s.register('b@x.com', 'bobby', 'password1');
    s.recordGame(g('f1', a, b, 'w'));
    fails(() => s.claimSeasonReward(a, 's1', 'top3'), 400);
    set(Date.parse('2027-01-02T00:00:00Z')); s.finalizeSeasons(); s.finalizeSeasons();
    expect(s.db.prepare('SELECT COUNT(*) c FROM season_results WHERE game=\'chess\'').get()).toMatchObject({ c: 2 });
    s.claimSeasonReward(a, 's1', 'top3'); expect(s.inventory(a)).toContain('frame-s1-top');
    s.recordGame(g('later', b, a, 'w')); // ratings move on, snapshot stays
    expect(s.db.prepare('SELECT rating FROM season_results WHERE game=\'chess\' AND rank=1').get()).toMatchObject({ rating: 1220 });
  });
});

describe('social', () => {
  it('friend requests, accept, block removes friendship, reports validated and limited', () => {
    const { s } = mk(); const a = s.register('a@x.com', 'alice', 'password1'), b = s.register('b@x.com', 'bobby', 'password1');
    s.friendRequest(a, 'bobby'); expect(s.friends(b).incoming.map((x) => x.name)).toEqual(['alice']);
    s.acceptFriend(b, 'alice'); expect(s.isFriend(a, b)).toBe(true); expect(s.isFriend(b, a)).toBe(true);
    fails(() => s.friendRequest(a, 'bobby'), 409); fails(() => s.friendRequest(a, 'alice'), 404);
    s.block(b, 'alice'); expect(s.isFriend(a, b)).toBe(false); expect(s.isBlocked(a, b)).toBe(true);
    fails(() => s.friendRequest(a, 'bobby'), 404);
    s.unblock(b, 'alice'); expect(s.isBlocked(a, b)).toBe(false);
    fails(() => s.report(a, 'bobby', 'x'), 400);
    for (let i = 0; i < 10; i++) s.report(a, 'bobby', 'abusive behaviour');
    fails(() => s.report(a, 'bobby', 'abusive behaviour'), 429);
  });
});
