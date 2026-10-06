import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { newGomoku, playGomoku, undoGomoku, gomokuBot, type GomokuState } from './gomoku';
import { chessEnd, tryMove, chessBot } from './chess';

const seq = (s: GomokuState, pts: [number, number][]) => pts.reduce((st, [x, y]) => playGomoku(st, y * st.size + x)!, s);

describe('gomoku', () => {
  it('starts empty with black to move', () => {
    const s = newGomoku();
    expect(s.board.every((c) => c === null)).toBe(true);
    expect(s.turn).toBe('B');
  });
  it('rejects occupied, out-of-range and post-game moves', () => {
    const s = playGomoku(newGomoku(), 0)!;
    expect(playGomoku(s, 0)).toBeNull();
    expect(playGomoku(s, -1)).toBeNull();
    expect(playGomoku(s, 225)).toBeNull();
    const won = seq(newGomoku(), [[0,0],[0,5],[1,0],[1,5],[2,0],[2,5],[3,0],[3,5],[4,0]]);
    expect(won.status).toBe('won');
    expect(playGomoku(won, 100)).toBeNull();
  });
  it('alternates turns', () => {
    const s = playGomoku(newGomoku(), 0)!;
    expect(s.turn).toBe('W');
    expect(s.board[0]).toBe('B');
  });
  it('detects horizontal win', () => {
    const s = seq(newGomoku(), [[0,0],[0,5],[1,0],[1,5],[2,0],[2,5],[3,0],[3,5],[4,0]]);
    expect(s.winner).toBe('B'); expect(s.winLine).toHaveLength(5);
  });
  it('detects vertical win', () => {
    const s = seq(newGomoku(), [[0,0],[5,0],[0,1],[5,1],[0,2],[5,2],[0,3],[5,3],[0,4]]);
    expect(s.winner).toBe('B');
  });
  it('detects both diagonals', () => {
    expect(seq(newGomoku(), [[0,0],[9,0],[1,1],[9,1],[2,2],[9,2],[3,3],[9,3],[4,4]]).winner).toBe('B');
    expect(seq(newGomoku(), [[4,0],[9,0],[3,1],[9,1],[2,2],[9,2],[1,3],[9,3],[0,4]]).winner).toBe('B');
  });
  it('four in a row does not win', () => {
    const s = seq(newGomoku(), [[0,0],[0,5],[1,0],[1,5],[2,0],[2,5],[3,0]]);
    expect(s.status).toBe('playing');
  });
  it('declares a draw on a full board without five', () => {
    let s = newGomoku(6);
    const order: number[] = [];
    const blacks: number[] = [], whites: number[] = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) (((x >> 1) + y) % 2 === 0 ? blacks : whites).push(y * 6 + x);
    for (let i = 0; i < 18; i++) order.push(blacks[i], whites[i]);
    for (const m of order) { const n = playGomoku(s, m); expect(n).not.toBeNull(); s = n!; }
    expect(s.status).toBe('draw');
  });
  it('undo restores earlier state', () => {
    const s = undoGomoku(seq(newGomoku(), [[0,0],[1,1]]), 1);
    expect(s.moves).toHaveLength(1); expect(s.turn).toBe('W');
  });
  it('bot takes an immediate win and blocks a loss', () => {
    const s = seq(newGomoku(), [[0,0],[0,5],[1,0],[1,5],[2,0],[2,5],[3,0],[8,8]]);
    expect(gomokuBot(s, 3)).toBe(4); // black wins at (4,0)
    const t = seq(newGomoku(), [[8,8],[0,5],[9,9],[1,5],[7,7],[2,5],[3,3],[3,5]]);
    expect(gomokuBot(t, 3)).toBe(5 * 15 + 4); // must block white at (4,5)
  });
});

describe('chess', () => {
  it('has standard start', () => {
    const g = new Chess();
    expect(g.turn()).toBe('w'); expect(g.moves()).toHaveLength(20);
  });
  it('rejects illegal moves', () => {
    const g = new Chess();
    expect(tryMove(g, 'e2', 'e5')).toBeNull();
    expect(tryMove(g, 'e7', 'e5')).toBeNull();
  });
  it('detects fool\'s mate checkmate', () => {
    const g = new Chess();
    for (const [f, t] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']]) tryMove(g, f, t);
    expect(g.isCheck()).toBe(true);
    expect(chessEnd(g)).toEqual({ over: true, result: 'b', reason: '체크메이트' });
    expect(tryMove(g, 'a2', 'a3')).toBeNull();
  });
  it('detects stalemate', () => {
    const g = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(chessEnd(g)).toMatchObject({ over: true, result: 'draw', reason: '스테일메이트' });
  });
  it('castling allowed and blocked when through check', () => {
    const ok = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(tryMove(ok, 'e1', 'g1')?.san).toBe('O-O');
    const blocked = new Chess('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1');
    expect(tryMove(blocked, 'e1', 'g1')).toBeNull();
  });
  it('en passant', () => {
    const g = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    expect(tryMove(g, 'e5', 'd6')?.flags).toContain('e');
  });
  it('promotion', () => {
    const g = new Chess('8/P6k/8/8/8/8/8/4K3 w - - 0 1');
    expect(tryMove(g, 'a7', 'a8', 'n')?.promotion).toBe('n');
  });
  it('bot returns legal moves and finds mate in one', () => {
    const g = new Chess();
    for (let i = 0; i < 20 && !g.isGameOver(); i++) { const m = chessBot(g, 1)!; expect(g.moves()).toContain(m.san); g.move(m); }
    const m1 = new Chess('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    expect(chessBot(m1, 2)!.san).toBe('Ra8#');
  });
});
