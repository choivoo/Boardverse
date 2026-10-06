import { Chess } from 'chess.js';
import { randomInt, randomUUID } from 'node:crypto';
import { newGomoku, playGomoku, type GomokuState } from '../src/games/gomoku';
import { chessEnd, TIME_CONTROLS } from '../src/games/chess';
import type { ClientMsg, RoomView, ServerMsg, Side, GameKind } from '../src/protocol';

export interface Conn { send(m: ServerMsg): void; room?: Room; side?: Side }
interface Player { token: string; name: string; side: Side; conn: Conn | null; lostAt: number | null }
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const FORFEIT_MS = 120_000, IDLE_MS = 30 * 60_000, MAX_ROOMS = 1000;

export class Room {
  players: Player[] = [];
  status: 'waiting' | 'playing' | 'over' = 'waiting';
  result?: { winner: Side | 'draw'; reason: string };
  chess?: Chess; lastMove: { from: string; to: string } | null = null;
  gomoku?: GomokuState;
  clocks: { w: number; b: number } | null = null; turnStart = 0; incMs = 0;
  touched: number;
  constructor(public code: string, public game: GameKind, now: number) { this.touched = now; }
  get n() { return this.game === 'chess' ? this.chess!.history().length : this.gomoku!.moves.length; }
  get turn(): Side { return this.game === 'chess' ? this.chess!.turn() : this.gomoku!.turn === 'B' ? 'w' : 'b'; }
  view(you: Side): RoomView {
    const v: RoomView = { code: this.code, game: this.game, status: this.status, you, n: this.n, turn: this.turn, result: this.result,
      players: this.players.map((p) => ({ name: p.name, side: p.side, connected: !!p.conn })) };
    if (this.chess) v.chess = { fen: this.chess.fen(), history: this.chess.history(), last: this.lastMove, clocks: this.clocks && { ...this.clocks }, running: this.status === 'playing' && this.clocks ? this.turn : null };
    if (this.gomoku) v.gomoku = { size: this.gomoku.size, board: this.gomoku.board, moves: this.gomoku.moves, winLine: this.gomoku.winLine };
    return v;
  }
  broadcast() { for (const p of this.players) p.conn?.send({ t: 'view', view: this.view(p.side) }); }
  finish(winner: Side | 'draw', reason: string) { this.status = 'over'; this.result = { winner, reason }; }
}

function cleanName(s: unknown): string {
  const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) : '';
  return t || '게스트';
}

export class RoomManager {
  rooms = new Map<string, Room>();
  constructor(private now: () => number = Date.now) {}

  private code(): string | null {
    for (let i = 0; i < 20; i++) {
      const c = Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      if (!this.rooms.has(c)) return c;
    }
    return null;
  }

  handle(conn: Conn, m: ClientMsg): void {
    const err = (msg: string, fatal = false) => conn.send({ t: 'error', msg, fatal });
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return err('잘못된 요청입니다.');
    switch (m.t) {
      case 'create': {
        if (m.game !== 'chess' && m.game !== 'gomoku') return err('지원하지 않는 게임입니다.');
        if (this.rooms.size >= MAX_ROOMS) return err('서버가 가득 찼습니다. 잠시 후 다시 시도하세요.');
        const code = this.code(); if (!code) return err('방을 만들 수 없습니다.');
        const room = new Room(code, m.game, this.now());
        if (m.game === 'chess') {
          room.chess = new Chess();
          const tc = TIME_CONTROLS.find((t) => t.id === m.time) ?? TIME_CONTROLS[0];
          if (tc.baseSec) { room.clocks = { w: tc.baseSec * 1000, b: tc.baseSec * 1000 }; room.incMs = tc.incSec * 1000; }
        } else {
          room.gomoku = newGomoku([13, 15, 19].includes(m.size as number) ? (m.size as number) : 15);
        }
        const side: Side = m.side === 'w' || m.side === 'b' ? m.side : randomInt(2) ? 'w' : 'b';
        this.rooms.set(code, room);
        this.seat(conn, room, side, cleanName(m.name));
        return;
      }
      case 'join': {
        const room = this.rooms.get(String(m.code ?? '').toUpperCase());
        if (!room) return err('방을 찾을 수 없습니다. 코드를 확인하세요.');
        if (room.players.length >= 2) return err('이미 가득 찬 방입니다.');
        this.seat(conn, room, room.players[0].side === 'w' ? 'b' : 'w', cleanName(m.name));
        room.status = 'playing'; room.turnStart = this.now();
        room.broadcast();
        return;
      }
      case 'resume': {
        const room = this.rooms.get(String(m.code ?? '').toUpperCase());
        const p = room?.players.find((x) => x.token === m.token);
        if (!room || !p) return err('이전 대국을 찾을 수 없습니다.', true);
        p.conn?.send({ t: 'error', msg: '다른 기기에서 접속했습니다.', fatal: true });
        p.conn = conn; p.lostAt = null; conn.room = room; conn.side = p.side; room.touched = this.now();
        conn.send({ t: 'joined', token: p.token, view: room.view(p.side) });
        room.broadcast();
        return;
      }
      case 'move': return this.move(conn, m, err);
      case 'resign': {
        const room = conn.room;
        if (!room || !conn.side || room.status !== 'playing') return err('진행 중인 대국이 없습니다.');
        room.finish(conn.side === 'w' ? 'b' : 'w', '기권'); room.broadcast(); return;
      }
      default: return err('알 수 없는 요청입니다.');
    }
  }

  private seat(conn: Conn, room: Room, side: Side, name: string) {
    const p: Player = { token: randomUUID(), name, side, conn, lostAt: null };
    room.players.push(p); conn.room = room; conn.side = side; room.touched = this.now();
    conn.send({ t: 'joined', token: p.token, view: room.view(side) });
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
      const e = chessEnd(g);
      if (e.over) room.finish(e.result, e.reason);
    } else {
      const next = playGomoku(room.gomoku!, m.idx as number);
      if (!next) return err('둘 수 없는 자리입니다.');
      room.gomoku = next;
      if (next.status === 'won') room.finish(conn.side, '5목 완성');
      else if (next.status === 'draw') room.finish('draw', '판이 가득 참');
    }
    room.broadcast();
  }

  private checkClock(room: Room): boolean {
    if (room.status !== 'playing' || !room.clocks) return false;
    const side = room.turn;
    if (room.clocks[side] - (this.now() - room.turnStart) <= 0) {
      room.clocks[side] = 0; room.finish(side === 'w' ? 'b' : 'w', '시간 초과'); return true;
    }
    return false;
  }

  disconnect(conn: Conn) {
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
        if (gone) { room.finish(gone.side === 'w' ? 'b' : 'w', '상대 연결 끊김'); room.broadcast(); }
      }
      if (t - room.touched > IDLE_MS && room.players.every((p) => !p.conn)) this.rooms.delete(code);
    }
  }
}
