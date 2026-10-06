import { Chess } from 'chess.js';
import { randomInt, randomUUID } from 'node:crypto';
import { newGomoku, playGomoku, type GomokuState } from '../src/games/gomoku';
import { chessEnd, TIME_CONTROLS } from '../src/games/chess';
import type { ClientMsg, RoomView, ServerMsg, Side, GameKind } from '../src/protocol';
import type { GameSummary } from './store';
import { catOf } from './store';

export interface Conn { send(m: ServerMsg): void; room?: Room; side?: Side; userId?: number; userName?: string; queued?: boolean; watching?: Room; chatTimes?: number[] }
export interface Hooks {
  blocked?(a: number, b: number): boolean;
  /** false when rated play requires a verified email that the user lacks */
  canRate?(userId: number): boolean;
  rating?(userId: number, game: GameKind, cat: string): number;
  /** Returns the tournament's fixed settings if the user may queue for it right now, else an error string. */
  tournament?(tid: number, userId: number): { game: GameKind; time: string; size: number } | string;
  isFriend?(a: number, b: number): boolean;
  userByName?(name: string): { id: number } | undefined;
  record?(g: GameSummary): { w: number; b: number } | null;
}
interface Player { token: string; name: string; side: Side; userId: number | null; conn: Conn | null; lostAt: number | null }
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const FORFEIT_MS = 120_000, IDLE_MS = 30 * 60_000, MAX_ROOMS = 1000, MAX_QUEUE = 500, RATING_WINDOW = 400;
interface Opts { game: GameKind; time: string; size: number; rated: boolean; spectate: boolean; tid?: number }
const MAX_SPECTATORS = 20, CHAT_MAX = 200;
const URL_RE = /(https?:|www\.|[a-z0-9-]+\.(com|net|org|io|kr|co|me|gg|xyz)\b)/i;

export class Room {
  players: Player[] = [];
  status: 'waiting' | 'playing' | 'over' = 'waiting';
  result?: { winner: Side | 'draw'; reason: string; ratingDelta?: { w: number; b: number } };
  chess?: Chess; lastMove: { from: string; to: string } | null = null;
  gomoku?: GomokuState;
  clocks: { w: number; b: number } | null = null; turnStart = 0; incMs = 0;
  drawOffer: Side | null = null; rematch = new Set<Side>(); recorded = false;
  spectators = new Set<Conn>(); chat: { name: string; side: Side; text: string; at: number }[] = [];
  touched: number; id: string;
  constructor(public code: string, public opts: Opts, now: number) { this.touched = now; this.id = `${code}-${now.toString(36)}-${randomInt(1e6).toString(36)}`; }
  get game() { return this.opts.game; }
  get n() { return this.game === 'chess' ? this.chess!.history().length : this.gomoku!.moves.length; }
  get turn(): Side { return this.game === 'chess' ? this.chess!.turn() : this.gomoku!.turn === 'B' ? 'w' : 'b'; }
  moveList(): string[] { return this.game === 'chess' ? this.chess!.history() : this.gomoku!.moves.map(String); }
  view(you: Side, spectator = false): RoomView {
    const v: RoomView = { code: this.code, spectators: this.spectators.size, spectate: this.opts.spectate, spectator: spectator || undefined, tournament: this.opts.tid, chat: spectator ? undefined : this.chat.slice(-30), game: this.game, status: this.status, rated: this.opts.rated, time: this.opts.time, drawOffer: this.drawOffer, rematch: [...this.rematch], you, n: this.n, turn: this.turn, result: this.result,
      players: this.players.map((p) => ({ name: p.name, side: p.side, connected: !!p.conn, registered: p.userId !== null })) };
    if (this.chess) v.chess = { fen: this.chess.fen(), history: this.chess.history(), last: this.lastMove, clocks: this.clocks && { ...this.clocks }, running: this.status === 'playing' && this.clocks ? this.turn : null };
    if (this.gomoku) v.gomoku = { size: this.gomoku.size, board: this.gomoku.board, moves: this.gomoku.moves, winLine: this.gomoku.winLine };
    return v;
  }
  broadcast() { for (const p of this.players) p.conn?.send({ t: 'view', view: this.view(p.side) }); for (const c of this.spectators) c.send({ t: 'view', view: this.view('w', true) }); }
}

function cleanName(s: unknown): string {
  const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) : '';
  return t || '게스트';
}

export class RoomManager {
  rooms = new Map<string, Room>();
  queue: { conn: Conn; opts: Opts; rating: number }[] = [];
  users = new Map<number, Set<Conn>>();
  constructor(private now: () => number = Date.now, private hooks: Hooks = {}) {}

  // ---- presence ----
  attach(conn: Conn, userId: number, name: string) {
    conn.userId = userId; conn.userName = name;
    (this.users.get(userId) ?? this.users.set(userId, new Set()).get(userId)!).add(conn);
  }
  isOnline(userId: number) { return (this.users.get(userId)?.size ?? 0) > 0; }

  private code(): string | null {
    for (let i = 0; i < 20; i++) {
      const c = Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      if (!this.rooms.has(c)) return c;
    }
    return null;
  }
  private parseOpts(m: { game: GameKind; time?: string; size?: number; rated?: boolean; spectate?: boolean }, conn: Conn, spectateDefault = false): Opts | string {
    if (m.game !== 'chess' && m.game !== 'gomoku') return '지원하지 않는 게임입니다.';
    const rated = !!m.rated;
    if (rated && conn.userId === undefined) return '평가 대국은 로그인이 필요합니다.';
    if (rated && this.hooks.canRate && !this.hooks.canRate(conn.userId!)) return '평가 대국은 이메일 인증 후 이용할 수 있습니다.';
    const tc = m.game === 'chess' ? TIME_CONTROLS.find((t) => t.id === m.time) ?? TIME_CONTROLS[0] : TIME_CONTROLS[0];
    // rated games are never spectatable (no live relay of an ongoing rated game)
    return { game: m.game, time: tc.id, size: m.game === 'gomoku' && [13, 15, 19].includes(m.size as number) ? (m.size as number) : 15, rated, spectate: !rated && (m.spectate ?? spectateDefault) };
  }
  private makeRoom(o: Opts): Room | null {
    if (this.rooms.size >= MAX_ROOMS) return null;
    const code = this.code(); if (!code) return null;
    const room = new Room(code, o, this.now());
    if (o.game === 'chess') {
      room.chess = new Chess();
      const tc = TIME_CONTROLS.find((t) => t.id === o.time)!;
      if (tc.baseSec) { room.clocks = { w: tc.baseSec * 1000, b: tc.baseSec * 1000 }; room.incMs = tc.incSec * 1000; }
    } else room.gomoku = newGomoku(o.size);
    this.rooms.set(code, room);
    return room;
  }

  handle(conn: Conn, m: ClientMsg): void {
    const err = (msg: string, fatal = false) => conn.send({ t: 'error', msg, fatal });
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return err('잘못된 요청입니다.');
    switch (m.t) {
      case 'create': {
        const o = this.parseOpts(m, conn); if (typeof o === 'string') return err(o);
        const room = this.makeRoom(o); if (!room) return err('서버가 가득 찼습니다. 잠시 후 다시 시도하세요.');
        this.leaveQueue(conn);
        this.seat(conn, room, m.side === 'w' || m.side === 'b' ? m.side : randomInt(2) ? 'w' : 'b', cleanName(conn.userName ?? m.name));
        return;
      }
      case 'join': {
        const room = this.rooms.get(String(m.code ?? '').toUpperCase());
        if (!room) return err('방을 찾을 수 없습니다. 코드를 확인하세요.');
        if (room.players.length >= 2 || room.status !== 'waiting') return err('이미 가득 찬 방입니다.');
        if (room.opts.rated && conn.userId === undefined) return err('평가 대국은 로그인이 필요합니다.');
        const host = room.players[0];
        if (conn.userId !== undefined && host.userId === conn.userId) return err('자신이 만든 방에는 다시 들어갈 수 없습니다.');
        if (conn.userId !== undefined && host.userId !== null && this.hooks.blocked?.(conn.userId, host.userId)) return err('이 방에는 입장할 수 없습니다.');
        this.leaveQueue(conn);
        this.seat(conn, room, host.side === 'w' ? 'b' : 'w', cleanName(conn.userName ?? m.name));
        this.start(room);
        return;
      }
      case 'queue': return this.enqueue(conn, m, err);
      case 'watch': return this.watch(conn, m.code, err);
      case 'unwatch': this.unwatch(conn); return;
      case 'chat': return this.chat(conn, m.text, err);
      case 'unqueue': this.leaveQueue(conn); conn.send({ t: 'unqueued' }); return;
      case 'resume': {
        const room = this.rooms.get(String(m.code ?? '').toUpperCase());
        const p = room?.players.find((x) => x.token === m.token);
        if (!room || !p) return err('이전 대국을 찾을 수 없습니다.', true);
        if (p.conn && p.conn !== conn) p.conn.send({ t: 'error', msg: '다른 기기에서 접속했습니다.', fatal: true });
        p.conn = conn; p.lostAt = null; conn.room = room; conn.side = p.side; room.touched = this.now();
        conn.send({ t: 'joined', token: p.token, view: room.view(p.side) });
        room.broadcast();
        return;
      }
      case 'move': return this.move(conn, m, err);
      case 'resign': {
        const room = conn.room;
        if (!room || !conn.side || room.status !== 'playing') return err('진행 중인 대국이 없습니다.');
        this.finish(room, conn.side === 'w' ? 'b' : 'w', '기권'); room.broadcast(); return;
      }
      case 'draw': {
        const room = conn.room;
        if (!room || !conn.side || room.status !== 'playing') return err('진행 중인 대국이 없습니다.');
        if (m.action === 'offer') { if (room.drawOffer) return err('이미 제안이 진행 중입니다.'); room.drawOffer = conn.side; }
        else if (m.action === 'accept') { if (!room.drawOffer || room.drawOffer === conn.side) return err('수락할 제안이 없습니다.'); this.finish(room, 'draw', '합의 무승부'); }
        else if (m.action === 'decline') { if (!room.drawOffer || room.drawOffer === conn.side) return err('거절할 제안이 없습니다.'); room.drawOffer = null; }
        else return err('잘못된 요청입니다.');
        room.broadcast(); return;
      }
      case 'rematch': return this.rematch(conn, err);
      case 'invite': return this.invite(conn, m.to, err);
      default: return err('알 수 없는 요청입니다.');
    }
  }

  private seat(conn: Conn, room: Room, side: Side, name: string) {
    const p: Player = { token: randomUUID(), name, side, userId: conn.userId ?? null, conn, lostAt: null };
    room.players.push(p); conn.room = room; conn.side = side; room.touched = this.now();
    conn.send({ t: 'joined', token: p.token, view: room.view(side) });
  }
  private start(room: Room) { room.status = 'playing'; room.turnStart = this.now(); room.broadcast(); }

  // ---- matchmaking ----
  private enqueue(conn: Conn, m: Extract<ClientMsg, { t: 'queue' }>, err: (s: string) => void) {
    if (conn.room && conn.room.status !== 'over') return err('이미 대국 중입니다.');
    let o = this.parseOpts(m, conn, true); if (typeof o === 'string') return err(o); // quick-match games are watchable unless the player opts out
    if (m.tournament !== undefined) {
      if (conn.userId === undefined) return err('대회는 로그인이 필요합니다.');
      const t = this.hooks.tournament?.(Number(m.tournament), conn.userId);
      if (!t || typeof t === 'string') return err(t || '대회에 참가할 수 없습니다.');
      o = { game: t.game, time: t.time, size: t.size, rated: false, spectate: m.spectate ?? true, tid: Number(m.tournament) };
    }
    this.leaveQueue(conn);
    if (this.queue.length >= MAX_QUEUE) return err('대기열이 가득 찼습니다.');
    const rating = conn.userId !== undefined ? this.hooks.rating?.(conn.userId, o.game, catOf(o.game, o.time)) ?? 1200 : 1200;
    const same = (a: Opts, b: Opts) => a.game === b.game && a.time === b.time && a.size === b.size && a.rated === b.rated && a.tid === b.tid;
    const idx = this.queue.findIndex((q) => same(q.opts, o) && q.conn !== conn
      && !(conn.userId !== undefined && q.conn.userId === conn.userId)
      && !(conn.userId !== undefined && q.conn.userId !== undefined && this.hooks.blocked?.(conn.userId, q.conn.userId))
      && (!o.rated || Math.abs(q.rating - rating) <= RATING_WINDOW));
    if (idx < 0) { this.queue.push({ conn, opts: o, rating }); conn.queued = true; conn.send({ t: 'queued' }); return; }
    const other = this.queue.splice(idx, 1)[0]; other.conn.queued = false;
    const room = this.makeRoom(o); if (!room) return err('서버가 가득 찼습니다.');
    const first = randomInt(2) ? 'w' : 'b';
    this.seat(other.conn, room, first, cleanName(other.conn.userName ?? m.name));
    this.seat(conn, room, first === 'w' ? 'b' : 'w', cleanName(conn.userName ?? m.name));
    this.start(room);
  }
  private leaveQueue(conn: Conn) { this.queue = this.queue.filter((q) => q.conn !== conn); conn.queued = false; }

  private rematch(conn: Conn, err: (s: string) => void) {
    const room = conn.room;
    if (!room || !conn.side || room.status !== 'over') return err('재대결할 수 없습니다.');
    if (room.players.some((p) => !p.conn)) return err('상대가 나갔습니다.');
    room.rematch.add(conn.side);
    if (room.rematch.size < 2) { room.broadcast(); return; }
    const next = this.makeRoom(room.opts); if (!next) return err('서버가 가득 찼습니다.');
    // colours swap
    for (const p of room.players) { this.seat(p.conn!, next, p.side === 'w' ? 'b' : 'w', p.name); }
    this.start(next);
    this.rooms.delete(room.code);
  }
  // ---- spectating (read-only) ----
  private watch(conn: Conn, code: string, err: (s: string) => void) {
    const room = this.rooms.get(String(code ?? '').toUpperCase());
    if (!room || !room.opts.spectate || room.status === 'waiting') return err('관전할 수 없는 대국입니다.');
    if (conn.room) return err('대국 중에는 관전할 수 없습니다.');
    if (room.spectators.size >= MAX_SPECTATORS) return err('관전 인원이 가득 찼습니다.');
    this.unwatch(conn);
    if (conn.userId !== undefined && room.players.some((p) => p.userId !== null && this.hooks.blocked?.(conn.userId!, p.userId))) return err('이 대국은 관전할 수 없습니다.');
    room.spectators.add(conn); conn.watching = room;
    conn.send({ t: 'view', view: room.view('w', true) });
    room.broadcast();
  }
  private unwatch(conn: Conn) { const r = conn.watching; if (r) { r.spectators.delete(conn); conn.watching = undefined; r.broadcast(); } }
  /** Public list of live games that allow spectators. */
  live() {
    return [...this.rooms.values()].filter((r) => r.opts.spectate && r.status === 'playing').slice(0, 50)
      .map((r) => ({ code: r.code, game: r.game, time: r.opts.time, n: r.n, spectators: r.spectators.size, players: r.players.map((p) => p.name) }));
  }

  // ---- in-game chat (players only, registered users, text only) ----
  private chat(conn: Conn, text: string, err: (s: string) => void) {
    const room = conn.room;
    if (!room || !conn.side) return err('대국 중에만 채팅할 수 있습니다.');
    if (conn.userId === undefined) return err('채팅은 로그인한 사용자만 사용할 수 있습니다.');
    text = String(text ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (text.length > CHAT_MAX) return err(`메시지는 ${CHAT_MAX}자 이하여야 합니다.`);
    if (URL_RE.test(text)) return err('링크는 보낼 수 없습니다.');
    const t = this.now(); const times = (conn.chatTimes ??= []).filter((x) => t - x < 10_000);
    if (times.length >= 5 || (times.length && t - times[times.length - 1] < 1000)) { conn.chatTimes = times; return err('메시지를 너무 빨리 보내고 있습니다.'); }
    times.push(t); conn.chatTimes = times;
    const me = room.players.find((p) => p.conn === conn)!;
    const msg = { name: me.name, side: conn.side, text, at: t };
    room.chat.push(msg); if (room.chat.length > 50) room.chat.shift();
    for (const p of room.players) p.conn?.send({ t: 'chat', ...msg });
  }
  /** Last chat lines of a room, only for one of its registered participants (used as report evidence). */
  chatContextFor(userId: number, code: string): string | null {
    const room = this.rooms.get(String(code ?? '').toUpperCase());
    if (!room || !room.players.some((p) => p.userId === userId)) return null;
    return room.chat.slice(-20).map((c) => `${c.name}: ${c.text}`).join('\n');
  }

  private invite(conn: Conn, to: string, err: (s: string) => void) {
    const room = conn.room;
    if (conn.userId === undefined) return err('초대는 로그인이 필요합니다.');
    if (!room || room.status !== 'waiting') return err('초대할 방이 없습니다.');
    const target = this.hooks.userByName?.(String(to ?? ''));
    if (!target || !this.hooks.isFriend?.(conn.userId, target.id) || this.hooks.blocked?.(conn.userId, target.id)) return err('초대할 수 없는 사용자입니다.');
    const conns = this.users.get(target.id);
    if (!conns?.size) return err('친구가 오프라인입니다.');
    for (const c of conns) c.send({ t: 'invited', from: conn.userName ?? '', code: room.code });
    conn.send({ t: 'info', msg: '초대를 보냈습니다.' });
  }

  private finish(room: Room, winner: Side | 'draw', reason: string) {
    if (room.status === 'over') return;
    room.status = 'over'; room.result = { winner, reason }; room.drawOffer = null;
    if (room.recorded || !this.hooks.record) return;
    room.recorded = true;
    const w = room.players.find((p) => p.side === 'w')!, b = room.players.find((p) => p.side === 'b')!;
    const delta = this.hooks.record({ id: room.id, game: room.game, whiteId: w.userId, blackId: b.userId, whiteName: w.name, blackName: b.name,
      rated: room.opts.rated, time: room.opts.time, result: winner, reason, moves: room.moveList(), tid: room.opts.tid ?? null });
    if (delta && room.opts.rated) room.result.ratingDelta = delta;
  }

  private move(conn: Conn, m: Extract<ClientMsg, { t: 'move' }>, err: (s: string) => void) {
    const room = conn.room;
    if (!room || !conn.side) return err('방에 참가하지 않았습니다.');
    if (room.status !== 'playing') return err('진행 중인 대국이 아닙니다.');
    if (this.checkClock(room)) return room.broadcast();
    if (m.n !== room.n) return conn.send({ t: 'view', view: room.view(conn.side) }); // stale or duplicate: resync, no error
    if (room.turn !== conn.side) return err('상대 차례입니다.');
    room.touched = this.now();
    if (room.game === 'chess') {
      const g = room.chess!;
      if (typeof m.from !== 'string' || typeof m.to !== 'string') return err('잘못된 수입니다.');
      const promo = m.promotion && 'qrbn'.includes(m.promotion) && m.promotion.length === 1 ? m.promotion : 'q';
      try { g.move({ from: m.from, to: m.to, promotion: promo }); } catch { return err('둘 수 없는 수입니다.'); }
      room.lastMove = { from: m.from, to: m.to };
      if (room.clocks) {
        const t = this.now();
        room.clocks[conn.side] += room.incMs - (t - room.turnStart);
        room.turnStart = t;
      }
      room.drawOffer = null;
      const e = chessEnd(g);
      if (e.over) this.finish(room, e.result, e.reason);
    } else {
      const next = playGomoku(room.gomoku!, m.idx as number);
      if (!next) return err('둘 수 없는 자리입니다.');
      room.gomoku = next; room.drawOffer = null;
      if (next.status === 'won') this.finish(room, conn.side, '5목 완성');
      else if (next.status === 'draw') this.finish(room, 'draw', '판이 가득 참');
    }
    room.broadcast();
  }

  private checkClock(room: Room): boolean {
    if (room.status !== 'playing' || !room.clocks) return false;
    const side = room.turn;
    if (room.clocks[side] - (this.now() - room.turnStart) <= 0) {
      room.clocks[side] = 0; this.finish(room, side === 'w' ? 'b' : 'w', '시간 초과'); return true;
    }
    return false;
  }

  disconnect(conn: Conn) {
    this.leaveQueue(conn); this.unwatch(conn);
    if (conn.userId !== undefined) { const s = this.users.get(conn.userId); s?.delete(conn); if (s && !s.size) this.users.delete(conn.userId); }
    const room = conn.room; if (!room) return;
    const p = room.players.find((x) => x.conn === conn);
    if (p) { p.conn = null; p.lostAt = this.now(); room.broadcast(); }
  }

  /** Call periodically: clock expiry, disconnect forfeits, idle room cleanup. */
  tick() {
    const t = this.now();
    for (const [code, room] of this.rooms) {
      if (this.checkClock(room)) room.broadcast();
      if (room.status === 'playing') {
        const gone = room.players.find((p) => p.lostAt !== null && t - p.lostAt > FORFEIT_MS);
        if (gone) { this.finish(room, gone.side === 'w' ? 'b' : 'w', '상대 연결 끊김'); room.broadcast(); }
      }
      if (t - room.touched > IDLE_MS && room.players.every((p) => !p.conn)) this.rooms.delete(code);
    }
  }
}
