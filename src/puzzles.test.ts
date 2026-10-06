import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { chessPuzzles, gomokuPuzzles, dailyPuzzle, forcesMate2, isCorrectChessMove, isCorrectGomokuMove, matesNow, gomokuPuzzleBoard, winningCells } from './puzzles';

describe('bundled puzzles are valid', () => {
  it('has content', () => { expect(chessPuzzles.length).toBeGreaterThanOrEqual(10); expect(gomokuPuzzles.length).toBeGreaterThanOrEqual(10); });
  it('chess ids unique, every puzzle has a correct first move and rejects a wrong one', () => {
    expect(new Set(chessPuzzles.map((p) => p.id)).size).toBe(chessPuzzles.length);
    for (const p of chessPuzzles) {
      const g = new Chess(p.fen);
      const moves = g.moves({ verbose: true });
      const good = moves.filter((m) => isCorrectChessMove(p, g, m, 0));
      expect(good.length, p.id).toBeGreaterThanOrEqual(1);
      if (p.kind === 'mate1') { expect(matesNow(g).length, p.id).toBe(good.length); expect(good.length).toBe(1); }
      else { expect(matesNow(g), p.id).toHaveLength(0); expect(good.every((m) => forcesMate2(g, m))).toBe(true); }
      expect(moves.some((m) => !good.includes(m)), p.id).toBe(true);
      expect(g.fen()).toBe(p.fen); // solvers leave the position untouched
    }
  });
  it('gomoku puzzles: exactly one winning/blocking answer, position is legal and not already won', () => {
    for (const p of gomokuPuzzles) {
      const s = gomokuPuzzleBoard(p);
      expect(p.black.length, p.id).toBe(p.white.length); expect(p.toMove).toBe('B');
      const cells = s.board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
      const good = cells.filter((i) => isCorrectGomokuMove(p, i));
      expect(good.length, p.id).toBeGreaterThanOrEqual(1);
      if (p.kind === 'win1') { expect(good).toEqual(winningCells(s.board, s.size, 'B')); expect(winningCells(s.board, s.size, 'W')).toHaveLength(0); }
      else { expect(winningCells(s.board, s.size, 'B')).toHaveLength(0); expect(winningCells(s.board, s.size, 'W')).toHaveLength(1); expect(good).toEqual(winningCells(s.board, s.size, 'W')); }
      expect(cells.some((i) => !good.includes(i))).toBe(true);
      expect(isCorrectGomokuMove(p, p.black[0])).toBe(false); // occupied cell
    }
  });
  it('daily puzzle is deterministic per UTC day', () => {
    const t = Date.parse('2026-10-06T10:00:00Z');
    expect(dailyPuzzle(t).p.id).toBe(dailyPuzzle(t + 3600_000).p.id);
    expect(dailyPuzzle(t).p.id).not.toBe(dailyPuzzle(t + 86400_000).p.id);
  });
});
