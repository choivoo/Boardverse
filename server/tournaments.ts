import { ApiError, type Store } from './store';
import { TIME_CONTROLS } from '../src/games/chess';
import type { GameKind } from '../src/protocol';

/** Arena-style tournament: during [starts, ends] participants queue for games against each other.
 *  Win 2 / draw 1 / loss 0. Tournament games never change Elo. Ranking: points, wins, fewer games, join order. */
export type TStatus = 'upcoming' | 'running' | 'ended';
const statusOf = (t: { starts: number; ends: number }, now: number): TStatus => (now < t.starts ? 'upcoming' : now <= t.ends ? 'running' : 'ended');

export function createTournament(s: Store, adminId: number, b: { name: string; game: GameKind; time?: string; size?: number; starts: number; ends: number }) {
  const name = String(b.name ?? '').trim();
  if (name.length < 3 || name.length > 40) throw new ApiError(400, '대회 이름은 3~40자여야 합니다.');
  if (b.game !== 'chess' && b.game !== 'gomoku') throw new ApiError(400, '게임을 선택하세요.');
  const time = b.game === 'chess' ? (TIME_CONTROLS.find((t) => t.id === b.time && t.baseSec > 0)?.id ?? '') : 'none';
  if (!time) throw new ApiError(400, '체스 대회는 시계가 있는 시간 설정이 필요합니다.');
  const size = b.game === 'gomoku' && [13, 15, 19].includes(Number(b.size)) ? Number(b.size) : 15;
  const starts = Number(b.starts), ends = Number(b.ends);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts || ends - starts < 5 * 60_000 || ends - starts > 6 * 3600_000) throw new ApiError(400, '대회 시간은 5분 이상 6시간 이하여야 합니다.');
  if (ends <= s.now()) throw new ApiError(400, '이미 끝난 시간입니다.');
  const id = Number(s.run('INSERT INTO tournaments(name,game,time,size,starts,ends,created_by) VALUES(?,?,?,?,?,?,?)', name, b.game, time, size, starts, ends, adminId).lastInsertRowid);
  s.audit(adminId, 'create_tournament', String(id), name);
  return id;
}

export function listTournaments(s: Store, userId?: number) {
  const now = s.now();
  return s.all('SELECT t.*, (SELECT COUNT(*) FROM tournament_players p WHERE p.tid=t.id) players FROM tournaments t ORDER BY t.starts DESC LIMIT 50').map((t) => ({
    id: t.id, name: t.name, game: t.game, time: t.time, size: t.size, starts: t.starts, ends: t.ends, players: t.players, status: statusOf(t as any, now),
    joined: userId ? !!s.get('SELECT 1 FROM tournament_players WHERE tid=? AND user_id=?', t.id, userId) : false,
  }));
}
const row = (s: Store, tid: number) => { const t = s.get('SELECT * FROM tournaments WHERE id=?', tid); if (!t) throw new ApiError(404, '대회를 찾을 수 없습니다.'); return t as any; };

export function joinTournament(s: Store, userId: number, tid: number) {
  const t = row(s, tid);
  if (statusOf(t, s.now()) === 'ended') throw new ApiError(400, '이미 끝난 대회입니다.');
  s.tx(() => {
    if (s.get('SELECT 1 FROM tournament_players WHERE tid=? AND user_id=?', tid, userId)) throw new ApiError(409, '이미 참가했습니다.');
    s.run('INSERT INTO tournament_players(tid,user_id) VALUES(?,?)', tid, userId);
  });
}
export function leaveTournament(s: Store, userId: number, tid: number) {
  const t = row(s, tid);
  if (statusOf(t, s.now()) !== 'upcoming') throw new ApiError(400, '시작한 대회에서는 나갈 수 없습니다.');
  s.run('DELETE FROM tournament_players WHERE tid=? AND user_id=?', tid, userId);
}
export function standings(s: Store, tid: number) {
  const t = row(s, tid);
  const rows = s.all('SELECT u.name,p.points,p.played,p.wins,p.final_rank FROM tournament_players p JOIN users u ON u.id=p.user_id WHERE p.tid=? ORDER BY p.points DESC, p.wins DESC, p.played ASC, p.rowid ASC', tid);
  return { tournament: { id: t.id, name: t.name, game: t.game, time: t.time, size: t.size, starts: t.starts, ends: t.ends, status: statusOf(t, s.now()), finalized: !!t.finalized }, rows: rows.map((r, i) => ({ rank: r.final_rank ?? i + 1, ...r })) };
}
/** Hook for the room manager: may this user queue for this tournament right now? */
export function eligibility(s: Store, tid: number, userId: number): { game: GameKind; time: string; size: number } | string {
  const t = s.get('SELECT * FROM tournaments WHERE id=?', tid) as any;
  if (!t) return '대회를 찾을 수 없습니다.';
  if (statusOf(t, s.now()) !== 'running') return '진행 중인 대회가 아닙니다.';
  if (!s.get('SELECT 1 FROM tournament_players WHERE tid=? AND user_id=?', tid, userId)) return '대회에 참가하지 않았습니다.';
  return { game: t.game, time: t.time, size: t.size };
}
/** Idempotent: freezes final ranks once a tournament has ended. */
export function finalizeTournaments(s: Store) {
  for (const t of s.all('SELECT id FROM tournaments WHERE finalized=0 AND ends<?', s.now())) {
    s.tx(() => {
      s.all('SELECT user_id FROM tournament_players WHERE tid=? ORDER BY points DESC, wins DESC, played ASC, rowid ASC', t.id).forEach((p, i) => s.run('UPDATE tournament_players SET final_rank=? WHERE tid=? AND user_id=?', i + 1, t.id, p.user_id));
      s.run('UPDATE tournaments SET finalized=1 WHERE id=?', t.id);
    });
  }
}
